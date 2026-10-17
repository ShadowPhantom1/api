import { getApiContext } from "@/lib/api/context";
import { parseJsonBody, setupGuard } from "@/lib/api/http";
import { errorResponse, GatewayError } from "@/lib/executor/errors";
import { assertUserCaller } from "@/lib/api/auth";
import { createAiModelSchema } from "@/lib/registry/schemas";
import { normalizeCapabilities, defaultAuthHeaderName } from "@/lib/ai/models";
import { loadLinkableApi, rebixQueryParam } from "@/lib/ai/link";
import { resolveProvider } from "@/lib/registry/persist";
import { encryptJson } from "@/lib/security/crypto";
import { serializeAiModel } from "@/lib/api/serialize";
import type { AiModelRecord, ApiRecord } from "@/lib/db/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    setupGuard();
    const { admin, caller } = await getApiContext(request, { scopes: [] });
    assertUserCaller(caller);
    const { data, error } = await admin
      .from("ai_models")
      .select("*")
      .or(`owner_id.eq.${caller.userId},and(is_public.eq.true,is_enabled.eq.true)`)
      .order("created_at", { ascending: false });
    if (error) throw new GatewayError("query_failed", error.message, 500);
    return Response.json({
      items: ((data ?? []) as AiModelRecord[]).map(serializeAiModel),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    setupGuard();
    const { admin, caller } = await getApiContext(request, { scopes: [] });
    assertUserCaller(caller);
    const body = await parseJsonBody(request, createAiModelSchema);

    const { data: clash } = await admin.from("ai_models").select("id").eq("slug", body.slug).maybeSingle();
    if (clash) throw new GatewayError("slug_taken", `Model slug "${body.slug}" is already in use.`, 409);

    let linkedApi: ApiRecord | null = null;
    if (body.adapter === "rebix_text") {
      if (!body.apiSlug) {
        throw new GatewayError("validation_error", "apiSlug is required for the simple text adapter.", 422);
      }
      linkedApi = await loadLinkableApi(admin, body.apiSlug, caller);
    } else if (!body.baseUrl) {
      throw new GatewayError("validation_error", "baseUrl is required for this adapter.", 422);
    }

    const provider = linkedApi?.provider_id
      ? { id: linkedApi.provider_id }
      : body.baseUrl
        ? await resolveProvider(admin, { name: body.name, baseUrl: body.baseUrl })
        : null;

    const encPayload: Record<string, string> = {};
    if (body.authType === "bearer" && body.auth?.token) encPayload.token = body.auth.token;
    if (body.authType === "api_key" && body.auth?.apiKey) encPayload.apiKey = body.auth.apiKey;
    if (body.authType === "basic" && body.auth?.username) {
      encPayload.username = body.auth.username;
      if (body.auth.password !== undefined) encPayload.password = body.auth.password;
    }
    const capabilities = normalizeCapabilities(body.adapter, body.capabilities);
    const config: Record<string, unknown> = {};
    if (body.adapter === "rebix_text" && linkedApi) {
      config.query_param = rebixQueryParam(linkedApi);
      config.response_paths = ["message", "response", "result", "reply", "answer", "quotes", "fact", "data", "text"];
    }

    const { data, error } = await admin
      .from("ai_models")
      .insert({
        owner_id: caller.userId,
        provider_id: provider?.id ?? null,
        api_id: linkedApi?.id ?? null,
        slug: body.slug,
        name: body.name,
        description: body.description ?? null,
        adapter: body.adapter,
        base_url: body.baseUrl ?? null,
        chat_path: body.chatPath,
        upstream_model: body.upstreamModel ?? null,
        auth_type: body.authType,
        auth_config_encrypted: Object.keys(encPayload).length
          ? encryptJson(encPayload)
          : null,
        auth_config_meta:
          body.authType === "api_key"
            ? { header_name: defaultAuthHeaderName(body.adapter, body.auth?.headerName) }
            : {},
        config,
        capabilities,
        context_window: body.contextWindow ?? null,
        is_public: body.isPublic,
        is_enabled: body.isEnabled,
      })
      .select("*")
      .single();
    if (error) throw new GatewayError("insert_failed", error.message, 400);

    return Response.json({ model: serializeAiModel(data as AiModelRecord) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
