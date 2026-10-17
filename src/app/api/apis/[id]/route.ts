import { getApiContext } from "@/lib/api/context";
import { parseJsonBody, setupGuard } from "@/lib/api/http";
import { errorResponse, GatewayError } from "@/lib/executor/errors";
import { updateApiSchema } from "@/lib/registry/schemas";
import { resolveCategory, resolveProvider } from "@/lib/registry/persist";
import { encryptJson } from "@/lib/security/crypto";
import { API_RELATION_SELECT, serializeApi, type ApiRowWithRelations } from "@/lib/api/serialize";
import { slugify } from "@/lib/utils";
import type { UpstreamAuthConfig } from "@/lib/registry/params";
import type { Caller } from "@/lib/api/auth";
import type { ApiRecord } from "@/lib/db/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadAccessibleApi(
  admin: SupabaseClient,
  id: string,
  caller: Caller,
): Promise<ApiRecord> {
  const { data, error } = await admin.from("apis").select("*").eq("id", id).maybeSingle();
  if (error) throw new GatewayError("query_failed", error.message, 500);
  if (!data) throw new GatewayError("not_found", "API not found.", 404);
  const api = data as ApiRecord;
  if (api.owner_id !== caller.userId && !caller.isAdmin) {
    throw new GatewayError("not_found", "API not found.", 404);
  }
  return api;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    setupGuard();
    const { admin, caller } = await getApiContext(_request, { scopes: [] });
    const { id } = await context.params;
    await loadAccessibleApi(admin, id, caller);
    const { data, error } = await admin
      .from("apis")
      .select(API_RELATION_SELECT)
      .eq("id", id)
      .single();
    if (error) throw new GatewayError("query_failed", error.message, 500);
    return Response.json({ api: serializeApi(data as ApiRowWithRelations) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    setupGuard();
    const { admin, caller } = await getApiContext(request, { scopes: [] });
    const { id } = await context.params;
    const existing = await loadAccessibleApi(admin, id, caller);
    const body = await parseJsonBody(request, updateApiSchema);

    const patch: Record<string, unknown> = {};
    const map: [keyof typeof body, string][] = [
      ["name", "name"],
      ["description", "description"],
      ["baseUrl", "base_url"],
      ["path", "path"],
      ["method", "method"],
      ["queryParams", "query_params"],
      ["pathParams", "path_params"],
      ["headersSchema", "headers_schema"],
      ["bodySchema", "body_schema"],
      ["authType", "auth_type"],
      ["contentType", "content_type"],
      ["requestExample", "request_example"],
      ["responseExample", "response_example"],
      ["docsUrl", "docs_url"],
      ["sourceUrl", "source_url"],
      ["isPublic", "is_public"],
      ["isEnabled", "is_enabled"],
      ["isNsfw", "is_nsfw"],
      ["allowExtraQuery", "allow_extra_query"],
      ["supportsStreaming", "supports_streaming"],
      ["timeoutMs", "timeout_ms"],
    ];
    for (const [camel, snake] of map) {
      if (body[camel] !== undefined) patch[snake] = body[camel];
    }

    if (body.slug !== undefined && body.slug !== existing.slug) {
      const { data: clash } = await admin.from("apis").select("id").eq("slug", body.slug).maybeSingle();
      if (clash && clash.id !== id) {
        throw new GatewayError("slug_taken", `The slug "${body.slug}" is already in use.`, 409);
      }
      patch.slug = body.slug;
    }

    if (body.categorySlug !== undefined || body.categoryName !== undefined) {
      const category = await resolveCategory(admin, body.categorySlug, body.categoryName);
      patch.category_id = category.id;
    }

    if (
      body.providerSlug !== undefined ||
      body.providerName !== undefined ||
      body.baseUrl !== undefined
    ) {
      const provider = await resolveProvider(admin, {
        slug: body.providerSlug,
        name: body.providerName,
        baseUrl: body.baseUrl ?? existing.base_url,
      });
      patch.provider_id = provider.id;
    }

    if (body.clearAuth) {
      patch.auth_config_encrypted = null;
      patch.auth_config_meta = {};
      if (body.authType === undefined) patch.auth_type = "none";
    } else if (body.auth != null) {
      const auth = body.auth;
      const authType = body.authType ?? existing.auth_type;
      if (authType === "none") {
        patch.auth_config_encrypted = null;
        patch.auth_config_meta = {};
      } else {
        const payload: UpstreamAuthConfig = {};
        if (authType === "bearer" && auth.token) payload.token = auth.token;
        if (authType === "api_key" && auth.apiKey) payload.apiKey = auth.apiKey;
        if (authType === "basic") {
          if (auth.username) payload.username = auth.username;
          if (auth.password !== undefined) payload.password = auth.password;
        }
        if (Object.keys(payload).length) {
          patch.auth_config_encrypted = encryptJson(payload);
        }
        if (authType === "api_key") {
          const headerName = auth.headerName ?? (existing.auth_config_meta.header_name as string) ?? "X-API-Key";
          patch.auth_config_meta = { header_name: headerName };
        }
      }
    } else if (body.authType === "none") {
      patch.auth_config_encrypted = null;
      patch.auth_config_meta = {};
    }

    if (body.discoveryMetadata !== undefined) {
      patch.discovery_metadata = body.discoveryMetadata;
    }

    if (Object.keys(patch).length > 0) {
      const { error } = await admin.from("apis").update(patch).eq("id", id);
      if (error) throw new GatewayError("update_failed", error.message, 400);
    }

    const { data, error } = await admin
      .from("apis")
      .select(API_RELATION_SELECT)
      .eq("id", id)
      .single();
    if (error) throw new GatewayError("query_failed", error.message, 500);
    return Response.json({ api: serializeApi(data as ApiRowWithRelations) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    setupGuard();
    const { admin, caller } = await getApiContext(request, { scopes: [] });
    const { id } = await context.params;
    await loadAccessibleApi(admin, id, caller);
    const { error } = await admin.from("apis").delete().eq("id", id);
    if (error) throw new GatewayError("delete_failed", error.message, 400);
    return Response.json({ ok: true, deletedId: id, slug: slugify(id) });
  } catch (error) {
    return errorResponse(error);
  }
}
