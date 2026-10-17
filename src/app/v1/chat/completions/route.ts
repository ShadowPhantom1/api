import { randomUUID } from "node:crypto";
import { getApiContext } from "@/lib/api/context";
import { parseJsonBody } from "@/lib/api/http";
import { openAiErrorResponse } from "@/lib/ai/http";
import { GatewayError } from "@/lib/executor/errors";
import { chatCompletionSchema } from "@/lib/registry/schemas";
import {
  dispatchChat,
  startOpenAiCompatibleStream,
  type ChatRequestParams,
} from "@/lib/ai/adapters";
import { logRequest } from "@/lib/usage/log";
import type { AiModelRecord, ApiRecord } from "@/lib/db/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function extractStreamUsage(line: string): { prompt?: number; completion?: number } | null {
  try {
    const parsed = JSON.parse(line) as {
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    if (!parsed.usage) return null;
    return {
      prompt: parsed.usage.prompt_tokens,
      completion: parsed.usage.completion_tokens,
    };
  } catch {
    return null;
  }
}

function instrumentStream(
  handle: Awaited<ReturnType<typeof startOpenAiCompatibleStream>>,
  admin: SupabaseClient,
  meta: {
    userId: string;
    keyId: string | null;
    modelId: string;
    startedAt: number;
    modelSlug: string;
  },
): ReadableStream<Uint8Array> {
  const reader = handle.body?.getReader();
  if (!reader) throw new GatewayError("invalid_upstream_response", "Upstream stream unavailable.", 502);
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  let usage: { prompt?: number; completion?: number } | null = null;
  let finalized = false;

  const finalize = async (ok: boolean) => {
    if (finalized) return;
    finalized = true;
    await handle.cleanup().catch(() => undefined);
    await logRequest(admin, {
      userId: meta.userId,
      aiModelId: meta.modelId,
      platformKeyId: meta.keyId,
      kind: "ai_chat",
      method: "POST",
      statusCode: 200,
      durationMs: Date.now() - meta.startedAt,
      responseBytes: bytes,
      ok,
      errorCode: ok ? null : "stream_error",
      promptTokens: usage?.prompt ?? null,
      completionTokens: usage?.completion ?? null,
    });
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          await finalize(true);
          controller.close();
          return;
        }
        bytes += value.byteLength;
        if (bytes > 8 * 1024 * 1024) {
          await reader.cancel();
          await finalize(false);
          controller.error(new Error("Upstream stream exceeded the 8 MB limit."));
          return;
        }
        controller.enqueue(value);
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          const parsedUsage = extractStreamUsage(data);
          if (parsedUsage) usage = { ...usage, ...parsedUsage };
        }
      } catch (error) {
        await finalize(false);
        controller.error(error);
      }
    },
    async cancel() {
      await reader.cancel().catch(() => undefined);
      await finalize(false);
    },
  });
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const { admin, caller } = await getApiContext(request, { scopes: ["chat"] });
    const body = await parseJsonBody(request, chatCompletionSchema);

    if (body.tools !== undefined || body.tool_choice !== undefined) {
      throw new GatewayError(
        "unsupported_parameter",
        "Tool calling is not implemented by this gateway. Remove tools/tool_choice from the request.",
        400,
      );
    }
    if (body.response_format !== undefined) {
      throw new GatewayError(
        "unsupported_parameter",
        "response_format is not supported by this gateway.",
        400,
      );
    }

    const { data, error } = await admin
      .from("ai_models")
      .select("*")
      .eq("slug", body.model)
      .maybeSingle();
    if (error) throw new GatewayError("query_failed", error.message, 500);
    if (!data) throw new GatewayError("model_not_found", `Model "${body.model}" not found.`, 404);

    const model = data as AiModelRecord;
    const accessible =
      model.is_enabled &&
      (model.is_public || model.owner_id === caller.userId || caller.isAdmin);
    if (!accessible) {
      throw new GatewayError("model_not_found", `Model "${body.model}" not found.`, 404);
    }

    let linkedApi: ApiRecord | null = null;
    if (model.api_id) {
      const { data: apiRow } = await admin.from("apis").select("*").eq("id", model.api_id).maybeSingle();
      linkedApi = (apiRow as ApiRecord | null) ?? null;
      if (
        linkedApi &&
        !linkedApi.is_enabled &&
        linkedApi.owner_id !== caller.userId &&
        !caller.isAdmin
      ) {
        throw new GatewayError("model_unavailable", "The underlying API is disabled.", 503);
      }
    }
    if (model.adapter === "rebix_text" && !linkedApi) {
      throw new GatewayError(
        "model_unavailable",
        "This model is not linked to a registry API.",
        503,
      );
    }

    const params: ChatRequestParams = {
      model: body.model,
      messages: body.messages,
      temperature: body.temperature,
      top_p: body.top_p,
      max_tokens: body.max_tokens,
      stop: body.stop,
      stream: body.stream,
    };

    if (body.stream) {
      if (model.adapter !== "openai_compatible" || !model.capabilities?.streaming) {
        throw new GatewayError(
          "unsupported_parameter",
          "Streaming is not supported for this model. Set stream=false.",
          400,
        );
      }
      const handle = await startOpenAiCompatibleStream(model, params);
      const stream = instrumentStream(handle, admin, {
        userId: caller.userId,
        keyId: caller.platformKeyId,
        modelId: model.id,
        startedAt,
        modelSlug: model.slug,
      });
      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
          "X-Anvex-Model": model.slug,
        },
      });
    }

    const result = await dispatchChat(admin, model, params, linkedApi);
    await logRequest(admin, {
      userId: caller.userId,
      aiModelId: model.id,
      platformKeyId: caller.platformKeyId,
      kind: "ai_chat",
      method: "POST",
      statusCode: 200,
      durationMs: Date.now() - startedAt,
      responseBytes: result.content.length,
      ok: true,
      promptTokens: result.usage?.prompt_tokens ?? null,
      completionTokens: result.usage?.completion_tokens ?? null,
    });

    const id = `chatcmpl-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    return Response.json({
      id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: model.slug,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: result.content },
          finish_reason: result.finishReason,
          logprobs: null,
        },
      ],
      ...(result.usage ? { usage: result.usage } : {}),
      anvex: {
        adapter: model.adapter,
        upstream_model: result.upstreamModel,
        usage_reported: Boolean(result.usage),
      },
    });
  } catch (error) {
    return openAiErrorResponse(error);
  }
}
