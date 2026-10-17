import { getApiContext } from "@/lib/api/context";
import { parseJsonBody, setupGuard } from "@/lib/api/http";
import { errorResponse, GatewayError } from "@/lib/executor/errors";
import { assertUserCaller } from "@/lib/api/auth";
import { updateAiModelSchema } from "@/lib/registry/schemas";
import { normalizeCapabilities, defaultAuthHeaderName } from "@/lib/ai/models";
import { loadLinkableApi, rebixQueryParam } from "@/lib/ai/link";
import { resolveProvider } from "@/lib/registry/persist";
import { encryptJson } from "@/lib/security/crypto";
import { serializeAiModel } from "@/lib/api/serialize";
import type { AiModelRecord } from "@/lib/db/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Caller } from "@/lib/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadEditableModel(
  admin: SupabaseClient,
  id: string,
  caller: Caller,
): Promise<AiModelRecord> {
  const { data, error } = await admin.from("ai_models").select("*").eq("id", id).maybeSingle();
  if (error) throw new GatewayError("query_failed", error.message, 500);
  if (!data) throw new GatewayError("not_found", "Model not found.", 404);
  const model = data as AiModelRecord;
  if (model.owner_id !== caller.userId && !caller.isAdmin) {
    throw new GatewayError("not_found", "Model not found.", 404);
  }
  return model;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    setupGuard();
    const { admin, caller } = await getApiContext(request, { scopes: [] });
    assertUserCaller(caller);
    const { id } = await context.params;
    const existing = await loadEditableModel(admin, id, caller);
    const body = await parseJsonBody(request, updateAiModelSchema);

    const adapter = body.adapter ?? existing.adapter;
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.adapter !== undefined) patch.adapter = body.adapter;
    if (body.chatPath !== undefined) patch.chat_path = body.chatPath;
    if (body.upstreamModel !== undefined) patch.upstream_model = body.upstreamModel;
    if (body.contextWindow !== undefined) patch.context_window = body.contextWindow;
    if (body.isPublic !== undefined) patch.is_public = body.isPublic;
    if (body.isEnabled !== undefined) patch.is_enabled = body.isEnabled;

    let linkedApiId: string | null | undefined;
    let config = { ...(existing.config ?? {}) };

    if (body.apiSlug !== undefined && body.apiSlug !== null) {
      const linked = await loadLinkableApi(admin, body.apiSlug, caller);
      linkedApiId = linked.id;
      config.query_param = rebixQueryParam(linked);
      config.response_paths = [
        "message",
        "response",
        "result",
        "reply",
        "answer",
        "quotes",
        "fact",
        "data",
        "text",
      ];
    }

    if (adapter === "rebix_text") {
      if (!body.apiSlug && !existing.api_id) {
        throw new GatewayError(
          "validation_error",
          "The simple text adapter requires a linked API. Provide apiSlug.",
          422,
        );
      }
      patch.api_id = linkedApiId ?? existing.api_id;
    } else {
      if (body.adapter !== undefined) patch.api_id = null;
      if (body.baseUrl !== undefined) patch.base_url = body.baseUrl;
      if (body.adapter !== undefined && !body.baseUrl && !existing.base_url) {
        throw new GatewayError("validation_error", "baseUrl is required for this adapter.", 422);
      }
    }

    if (body.baseUrl != null && adapter !== "rebix_text") {
      const provider = await resolveProvider(admin, { name: body.name ?? existing.name ?? existing.slug, baseUrl: body.baseUrl });
      patch.provider_id = provider.id;
    }

    if (body.authType !== undefined) patch.auth_type = body.authType;
    if (body.clearAuth) {
      patch.auth_config_encrypted = null;
      patch.auth_config_meta = {};
    } else if (body.auth != null) {
      const auth = body.auth;
      const authType = body.authType ?? existing.auth_type;
      const payload: Record<string, string> = {};
      if (authType === "bearer" && auth.token) payload.token = auth.token;
      if (authType === "api_key" && auth.apiKey) payload.apiKey = auth.apiKey;
      if (authType === "basic" && auth.username) {
        payload.username = auth.username;
        if (auth.password !== undefined) payload.password = auth.password;
      }
      if (Object.keys(payload).length) patch.auth_config_encrypted = encryptJson(payload);
      if (authType === "api_key") {
        patch.auth_config_meta = {
          header_name: defaultAuthHeaderName(adapter, auth.headerName),
        };
      }
    } else if (body.authType === "none") {
      patch.auth_config_encrypted = null;
      patch.auth_config_meta = {};
    }

    if (body.capabilities !== undefined || body.adapter !== undefined) {
      patch.capabilities = normalizeCapabilities(
        adapter,
        body.capabilities ?? (existing.capabilities as Record<string, boolean>),
      );
    }

    if (Object.keys(config).length) patch.config = config;

    if (Object.keys(patch).length > 0) {
      const { error } = await admin.from("ai_models").update(patch).eq("id", id);
      if (error) throw new GatewayError("update_failed", error.message, 400);
    }

    const { data, error } = await admin.from("ai_models").select("*").eq("id", id).single();
    if (error) throw new GatewayError("query_failed", error.message, 500);
    return Response.json({ model: serializeAiModel(data as AiModelRecord) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    setupGuard();
    const { admin, caller } = await getApiContext(request, { scopes: [] });
    assertUserCaller(caller);
    const { id } = await context.params;
    await loadEditableModel(admin, id, caller);
    const { error } = await admin.from("ai_models").delete().eq("id", id);
    if (error) throw new GatewayError("delete_failed", error.message, 400);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
