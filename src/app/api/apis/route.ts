import { getApiContext } from "@/lib/api/context";
import { clampInt, parseJsonBody, requestSearchParams, setupGuard } from "@/lib/api/http";
import { errorResponse, GatewayError } from "@/lib/executor/errors";
import { createApiSchema } from "@/lib/registry/schemas";
import { buildRequestExample, resolveCategory, resolveProvider, uniqueApiSlug } from "@/lib/registry/persist";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptJson } from "@/lib/security/crypto";
import type { UpstreamAuthConfig } from "@/lib/registry/params";
import { API_RELATION_SELECT, serializeApi, type ApiRowWithRelations } from "@/lib/api/serialize";
import { slugify } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authToEncrypted(
  authType: string,
  auth: { token?: string; apiKey?: string; username?: string; password?: string } | null | undefined,
): string | null {
  if (!auth || authType === "none") return null;
  const payload: UpstreamAuthConfig = {};
  if (authType === "bearer" && auth.token) payload.token = auth.token;
  if (authType === "api_key" && auth.apiKey) payload.apiKey = auth.apiKey;
  if (authType === "basic" && auth.username && auth.password !== undefined) {
    payload.username = auth.username;
    payload.password = auth.password;
  }
  if (!Object.keys(payload).length) return null;
  return encryptJson(payload);
}

export async function GET(request: Request) {
  try {
    setupGuard();
    const { admin, caller } = await getApiContext(request, { scopes: [] });
    const params = requestSearchParams(request);
    const scope = params.get("scope") ?? "mine";
    const page = clampInt(params.get("page"), 1, 1, 10_000);
    const perPage = clampInt(params.get("perPage"), 20, 1, 100);
    const q = (params.get("q") ?? "").trim().slice(0, 120);
    const categorySlug = params.get("category");

    let query = admin
      .from("apis")
      .select(API_RELATION_SELECT, { count: "exact" })
      .order("updated_at", { ascending: false });

    if (scope === "all") {
      if (!caller.isAdmin) throw new GatewayError("forbidden", "Administrator access is required.", 403);
    } else if (scope === "public") {
      query = query.eq("is_public", true).eq("is_enabled", true).eq("is_nsfw", false);
    } else {
      query = query.eq("owner_id", caller.userId);
    }

    if (q) {
      const escaped = q.replace(/[%_,]/g, "");
      query = query.or(`name.ilike.%${escaped}%,description.ilike.%${escaped}%,slug.ilike.%${escaped}%`);
    }
    if (categorySlug) {
      const { data: category } = await admin
        .from("categories")
        .select("id")
        .eq("slug", categorySlug)
        .maybeSingle();
      query = query.eq("category_id", category?.id ?? "00000000-0000-0000-0000-000000000000");
    }

    const from = (page - 1) * perPage;
    const { data, error, count } = await query.range(from, from + perPage - 1);
    if (error) throw new GatewayError("query_failed", error.message, 500);

    return Response.json({
      items: ((data ?? []) as ApiRowWithRelations[]).map(serializeApi),
      page,
      perPage,
      total: count ?? 0,
      totalPages: Math.max(1, Math.ceil((count ?? 0) / perPage)),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    setupGuard();
    const { admin, caller } = await getApiContext(request, { scopes: [] });
    const body = await parseJsonBody(request, createApiSchema);

    if (body.slug) {
      const { data: clash } = await admin.from("apis").select("id").eq("slug", body.slug).maybeSingle();
      if (clash) throw new GatewayError("slug_taken", `The slug "${body.slug}" is already in use.`, 409);
    }
    const slug = body.slug
      ? body.slug
      : await uniqueApiSlug(admin, slugify(body.name) || "api");

    const [category, provider] = await Promise.all([
      resolveCategory(admin, body.categorySlug, body.categoryName),
      resolveProvider(admin, {
        slug: body.providerSlug,
        name: body.providerName,
        baseUrl: body.baseUrl,
      }),
    ]);

    const encrypted = authToEncrypted(body.authType, body.auth);
    const headerName =
      body.auth?.headerName && /^[A-Za-z0-9_.-]{1,64}$/.test(body.auth.headerName)
        ? body.auth.headerName
        : "X-API-Key";

    const { data, error } = await admin
      .from("apis")
      .insert({
        owner_id: caller.userId,
        provider_id: provider.id,
        category_id: category.id,
        slug,
        name: body.name,
        description: body.description ?? null,
        base_url: body.baseUrl,
        path: body.path,
        method: body.method,
        query_params: body.queryParams,
        path_params: body.pathParams,
        headers_schema: body.headersSchema,
        body_schema: body.bodySchema ?? null,
        auth_type: body.authType,
        auth_config_encrypted: encrypted,
        auth_config_meta: body.authType === "api_key" ? { header_name: headerName } : {},
        content_type: body.contentType,
        request_example:
          body.requestExample ??
          buildRequestExample({
            method: body.method,
            baseUrl: body.baseUrl,
            path: body.path,
            queryParams: body.queryParams,
          }),
        response_example: body.responseExample ?? null,
        docs_url: body.docsUrl ?? provider.docs_url,
        source_url: body.sourceUrl ?? null,
        discovery_source: "manual",
        discovery_metadata: body.discoveryMetadata ?? {},
        verification_status: "unverified",
        is_public: body.isPublic,
        is_enabled: body.isEnabled,
        is_nsfw: body.isNsfw,
        allow_extra_query: body.allowExtraQuery,
        supports_streaming: body.supportsStreaming,
        timeout_ms: body.timeoutMs,
        created_by: caller.userId,
      })
      .select(API_RELATION_SELECT)
      .single();

    if (error) throw new GatewayError("insert_failed", error.message, 400);

    return Response.json({ api: serializeApi(data as ApiRowWithRelations) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

