import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { safeFetch, safeFetchStream, type SafeStreamHandle } from "@/lib/http/safe-fetch";
import { GatewayError } from "@/lib/executor/errors";
import { decryptJson } from "@/lib/security/crypto";
import { buildAuthHeaders, type UpstreamAuthConfig } from "@/lib/registry/params";
import { performUpstreamRequest } from "@/lib/executor/perform";
import { env } from "@/lib/env";
import type { AiModelRecord, ApiRecord } from "@/lib/db/types";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequestParams {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string | string[];
  stream?: boolean;
}

export interface ChatResult {
  content: string;
  finishReason: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
  upstreamModel: string;
  raw?: unknown;
}

export function modelAuthConfig(model: AiModelRecord): UpstreamAuthConfig | null {
  if (!model.auth_config_encrypted) return null;
  try {
    return decryptJson<UpstreamAuthConfig>(model.auth_config_encrypted);
  } catch {
    throw new GatewayError(
      "credential_unavailable",
      "Stored provider credentials could not be decrypted. Re-save the model credentials.",
      500,
    );
  }
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function baseHeaders(model: AiModelRecord, auth: UpstreamAuthConfig | null, accept: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: accept,
    "User-Agent": "Anvex-Gateway/1.0",
  };
  Object.assign(headers, buildAuthHeaders(model.auth_type, model.auth_config_meta ?? {}, auth));
  return headers;
}

function upstreamError(status: number, text: string): GatewayError {
  let message = text.slice(0, 500) || `Upstream returned HTTP ${status}.`;
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    if (typeof parsed.error === "string") message = parsed.error;
    else if (parsed.error && typeof parsed.error === "object" && parsed.error.message) {
      message = parsed.error.message;
    } else if (typeof parsed.message === "string") {
      message = parsed.message;
    }
  } catch {
    /* keep raw text */
  }
  return new GatewayError("upstream_error", message, 502, { upstream_status: status });
}

function normalizeUsage(usage: unknown): ChatResult["usage"] {
  if (!usage || typeof usage !== "object") return null;
  const record = usage as Record<string, unknown>;
  const prompt = Number(record.prompt_tokens ?? record.input_tokens ?? record.promptTokenCount);
  const completion = Number(
    record.completion_tokens ?? record.output_tokens ?? record.candidatesTokenCount,
  );
  const total = Number(record.total_tokens ?? record.totalTokenCount);
  if (![prompt, completion].every((value) => Number.isFinite(value) && value >= 0)) return null;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: Number.isFinite(total) ? total : prompt + completion,
  };
}

function stopArray(stop: string | string[] | undefined): string[] | undefined {
  if (!stop) return undefined;
  return Array.isArray(stop) ? stop : [stop];
}

export async function callOpenAiCompatible(
  model: AiModelRecord,
  params: ChatRequestParams,
): Promise<ChatResult> {
  if (!model.base_url) {
    throw new GatewayError("invalid_configuration", "This model has no base URL configured.", 500);
  }
  const auth = modelAuthConfig(model);
  const url = joinUrl(model.base_url, model.chat_path || "/chat/completions");
  const body: Record<string, unknown> = {
    model: model.upstream_model || model.slug,
    messages: params.messages,
    stream: false,
  };
  if (params.temperature !== undefined) body.temperature = params.temperature;
  if (params.top_p !== undefined) body.top_p = params.top_p;
  if (params.max_tokens !== undefined) body.max_tokens = params.max_tokens;
  if (params.stop !== undefined) body.stop = params.stop;

  const response = await safeFetch(url, {
    method: "POST",
    headers: baseHeaders(model, auth, "application/json"),
    body: JSON.stringify(body),
    timeoutMs: 120_000,
    maxBytes: 4 * 1024 * 1024,
    onExceed: "throw",
  });

  if (response.status < 200 || response.status >= 300) {
    throw upstreamError(response.status, response.body.toString("utf8"));
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(response.body.toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new GatewayError("invalid_upstream_response", "Upstream returned non-JSON content.", 502);
  }

  const choices = Array.isArray(json.choices) ? json.choices : [];
  const first = choices[0] as
    | { message?: { content?: unknown }; text?: unknown; finish_reason?: string }
    | undefined;
  let content = first?.message?.content ?? first?.text;
  if (Array.isArray(content)) {
    content = content
      .map((part) =>
        part && typeof part === "object" && typeof (part as { text?: string }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .join("");
  }
  if (typeof content !== "string" || content.length === 0) {
    throw new GatewayError(
      "invalid_upstream_response",
      "Upstream did not return assistant text in a supported OpenAI-compatible shape.",
      502,
    );
  }

  return {
    content,
    finishReason: typeof first?.finish_reason === "string" ? first.finish_reason : "stop",
    usage: normalizeUsage(json.usage),
    upstreamModel: typeof json.model === "string" ? json.model : model.upstream_model || model.slug,
    raw: json,
  };
}

export async function startOpenAiCompatibleStream(
  model: AiModelRecord,
  params: ChatRequestParams,
): Promise<SafeStreamHandle> {
  if (!model.base_url) {
    throw new GatewayError("invalid_configuration", "This model has no base URL configured.", 500);
  }
  const auth = modelAuthConfig(model);
  const url = joinUrl(model.base_url, model.chat_path || "/chat/completions");
  const body: Record<string, unknown> = {
    model: model.upstream_model || model.slug,
    messages: params.messages,
    stream: true,
  };
  if (params.temperature !== undefined) body.temperature = params.temperature;
  if (params.top_p !== undefined) body.top_p = params.top_p;
  if (params.max_tokens !== undefined) body.max_tokens = params.max_tokens;
  if (params.stop !== undefined) body.stop = params.stop;

  const handle = await safeFetchStream(url, {
    method: "POST",
    headers: baseHeaders(model, auth, "text/event-stream"),
    body: JSON.stringify(body),
    timeoutMs: 30_000,
    streamTimeoutMs: 120_000,
  });

  if (handle.status < 200 || handle.status >= 300) {
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = handle.body?.getReader();
    if (reader) {
      while (total < 8192) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          total += value.byteLength;
        }
      }
      reader.releaseLock();
    }
    await handle.body?.cancel().catch(() => undefined);
    await handle.cleanup();
    throw upstreamError(handle.status, Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8"));
  }

  return handle;
}

export async function callAnthropicMessages(
  model: AiModelRecord,
  params: ChatRequestParams,
): Promise<ChatResult> {
  if (!model.base_url) {
    throw new GatewayError("invalid_configuration", "Anthropic models require a base URL.", 500);
  }
  const auth = modelAuthConfig(model);
  const path = model.chat_path === "/chat/completions" ? "/v1/messages" : model.chat_path;
  const systemMessages = params.messages.filter((message) => message.role === "system");
  const conversation = params.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({ role: message.role, content: message.content }));

  const body: Record<string, unknown> = {
    model: model.upstream_model || model.slug,
    max_tokens: params.max_tokens ?? 1024,
    messages: conversation,
  };
  if (systemMessages.length) body.system = systemMessages.map((message) => message.content).join("\n\n");
  if (params.temperature !== undefined) body.temperature = params.temperature;
  if (params.top_p !== undefined) body.top_p = params.top_p;
  if (params.stop !== undefined) body.stop_sequences = stopArray(params.stop);

  const headers = baseHeaders(model, auth, "application/json");
  if (!headers["anthropic-version"]) headers["anthropic-version"] = "2023-06-01";

  const response = await safeFetch(joinUrl(model.base_url, path), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    timeoutMs: 120_000,
    maxBytes: 4 * 1024 * 1024,
    onExceed: "throw",
  });

  if (response.status < 200 || response.status >= 300) {
    throw upstreamError(response.status, response.body.toString("utf8"));
  }

  const json = JSON.parse(response.body.toString("utf8")) as {
    content?: Array<{ type?: string; text?: string }>;
    stop_reason?: string;
    usage?: unknown;
    model?: string;
  };
  const content = (json.content ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("");
  if (!content) {
    throw new GatewayError("invalid_upstream_response", "Anthropic returned no text content.", 502);
  }
  const stopMap: Record<string, string> = {
    end_turn: "stop",
    max_tokens: "length",
    stop_sequence: "stop",
    tool_use: "tool_calls",
  };
  return {
    content,
    finishReason: stopMap[json.stop_reason ?? "stop"] ?? "stop",
    usage: normalizeUsage(json.usage),
    upstreamModel: json.model ?? model.upstream_model ?? model.slug,
    raw: json,
  };
}

export async function callGeminiGenerate(
  model: AiModelRecord,
  params: ChatRequestParams,
): Promise<ChatResult> {
  if (!model.base_url) {
    throw new GatewayError("invalid_configuration", "Gemini models require a base URL.", 500);
  }
  const auth = modelAuthConfig(model);
  const upstreamModel = model.upstream_model || model.slug;
  const defaultPath = `/v1beta/models/${encodeURIComponent(upstreamModel)}:generateContent`;
  const path =
    model.chat_path === "/chat/completions"
      ? defaultPath
      : model.chat_path.replace("{model}", encodeURIComponent(upstreamModel));

  const systemMessages = params.messages.filter((message) => message.role === "system");
  const contents = params.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));

  const body: Record<string, unknown> = { contents };
  if (systemMessages.length) {
    body.systemInstruction = {
      parts: [{ text: systemMessages.map((message) => message.content).join("\n\n") }],
    };
  }
  const generationConfig: Record<string, unknown> = {};
  if (params.temperature !== undefined) generationConfig.temperature = params.temperature;
  if (params.top_p !== undefined) generationConfig.topP = params.top_p;
  if (params.max_tokens !== undefined) generationConfig.maxOutputTokens = params.max_tokens;
  if (params.stop !== undefined) generationConfig.stopSequences = stopArray(params.stop);
  if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;

  const response = await safeFetch(joinUrl(model.base_url, path), {
    method: "POST",
    headers: baseHeaders(model, auth, "application/json"),
    body: JSON.stringify(body),
    timeoutMs: 120_000,
    maxBytes: 4 * 1024 * 1024,
    onExceed: "throw",
  });

  if (response.status < 200 || response.status >= 300) {
    throw upstreamError(response.status, response.body.toString("utf8"));
  }

  const json = JSON.parse(response.body.toString("utf8")) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    usageMetadata?: unknown;
  };
  const candidate = json.candidates?.[0];
  const content = (candidate?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("");
  if (!content) {
    throw new GatewayError("invalid_upstream_response", "Gemini returned no text content.", 502);
  }
  const finishMap: Record<string, string> = {
    STOP: "stop",
    MAX_TOKENS: "length",
    SAFETY: "content_filter",
    RECITATION: "content_filter",
  };
  return {
    content,
    finishReason: finishMap[candidate?.finishReason ?? "STOP"] ?? "stop",
    usage: normalizeUsage(json.usageMetadata),
    upstreamModel,
    raw: json,
  };
}

function extractPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (current && typeof current === "object" && key in (current as Record<string, unknown>)) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, value);
}

/**
 * Adapter for simple text-style providers (such as Rebix) that expose a
 * GET ?q= endpoint and are NOT OpenAI-compatible. It is explicitly
 * capability-limited: no tools, no streaming, no token usage reporting.
 */
export async function callRebixText(
  admin: SupabaseClient,
  model: AiModelRecord,
  api: ApiRecord,
  params: ChatRequestParams,
): Promise<ChatResult> {
  if (!api.is_enabled) {
    throw new GatewayError("model_unavailable", "The underlying API is disabled.", 503);
  }
  const queryParam =
    typeof model.config?.query_param === "string" ? model.config.query_param : "q";
  const lastUser = [...params.messages].reverse().find((message) => message.role === "user");
  if (!lastUser) {
    throw new GatewayError("invalid_request", "A user message is required.", 400);
  }
  const systemPrompt = params.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const prompt = systemPrompt ? `${systemPrompt}\n\n${lastUser.content}` : lastUser.content;

  let auth: UpstreamAuthConfig | null = null;
  if (api.auth_config_encrypted) {
    try {
      auth = decryptJson<UpstreamAuthConfig>(api.auth_config_encrypted);
    } catch {
      throw new GatewayError("credential_unavailable", "Stored API credentials are unavailable.", 500);
    }
  }
  const host = new URL(api.base_url).hostname.toLowerCase();

  const result = await performUpstreamRequest(
    api,
    auth,
    { query: { [queryParam]: prompt } },
    {
      allowedHosts: [host],
      enforceAllowlist: env.enforceHostAllowlist,
    },
  );

  if (!result.ok) {
    throw new GatewayError(
      "upstream_error",
      `Provider returned HTTP ${result.status}.`,
      502,
      { upstream_status: result.status },
    );
  }

  const configuredPaths = Array.isArray(model.config?.response_paths)
    ? (model.config.response_paths as string[])
    : [];
  const paths = configuredPaths.length
    ? configuredPaths
    : ["message", "response", "result", "reply", "answer", "quotes", "fact", "data", "text"];

  let content: string | null = null;
  for (const path of paths) {
    const value = extractPath(result.body, path);
    if (typeof value === "string" && value.trim()) {
      content = value;
      break;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      content = String(value);
      break;
    }
  }
  if (!content) {
    throw new GatewayError(
      "invalid_upstream_response",
      "The provider response did not contain a text field configured for this adapter.",
      502,
    );
  }

  return {
    content,
    finishReason: "stop",
    usage: null,
    upstreamModel: model.upstream_model || model.slug,
    raw: result.body,
  };
}

export async function dispatchChat(
  admin: SupabaseClient,
  model: AiModelRecord,
  params: ChatRequestParams,
  linkedApi: ApiRecord | null,
): Promise<ChatResult> {
  switch (model.adapter) {
    case "openai_compatible":
      return callOpenAiCompatible(model, params);
    case "anthropic_messages":
      return callAnthropicMessages(model, params);
    case "gemini_generate":
      return callGeminiGenerate(model, params);
    case "rebix_text": {
      if (!linkedApi) {
        throw new GatewayError(
          "invalid_configuration",
          "This model is not linked to a registry API. Link one in the model settings.",
          500,
        );
      }
      return callRebixText(admin, model, linkedApi, params);
    }
    default:
      throw new GatewayError("unsupported_adapter", "Unsupported model adapter.", 400);
  }
}
