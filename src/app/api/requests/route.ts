import { getApiContext } from "@/lib/api/context";
import { clampInt, requestSearchParams, setupGuard } from "@/lib/api/http";
import { errorResponse, GatewayError } from "@/lib/executor/errors";
import { assertUserCaller } from "@/lib/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    setupGuard();
    const { admin, caller } = await getApiContext(request, { scopes: [] });
    assertUserCaller(caller);
    const params = requestSearchParams(request);
    const page = clampInt(params.get("page"), 1, 1, 10_000);
    const perPage = clampInt(params.get("perPage"), 25, 1, 100);
    const days = clampInt(params.get("days"), 30, 1, 90);
    const scope = params.get("scope") === "all" ? "all" : "mine";
    const kind = params.get("kind");
    const status = params.get("status");
    const apiId = params.get("apiId");

    if (scope === "all" && !caller.isAdmin) {
      throw new GatewayError("forbidden", "Administrator access is required for the all-users view.", 403);
    }

    const since = new Date(Date.now() - days * 86400000).toISOString();
    let query = admin
      .from("api_requests")
      .select(
        "id, kind, method, status_code, duration_ms, response_bytes, ok, error_code, created_at, api_id, ai_model_id, api:apis(id, name, slug), model:ai_models(id, name, slug)",
        { count: "exact" },
      )
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .range((page - 1) * perPage, page * perPage - 1);

    if (scope === "mine") query = query.eq("user_id", caller.userId);
    if (kind && ["rest", "ai_chat", "discovery_test"].includes(kind)) query = query.eq("kind", kind);
    if (status === "success") query = query.eq("ok", true);
    if (status === "error") query = query.eq("ok", false);
    if (apiId) query = query.eq("api_id", apiId);

    const { data, error, count } = await query;
    if (error) throw new GatewayError("query_failed", error.message, 500);

    const total = count ?? 0;
    return Response.json({
      items: data ?? [],
      page,
      perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
      filters: { days, scope, kind: kind ?? null, status: status ?? null, apiId: apiId ?? null },
      note: total === 0 ? "No requests match these filters yet." : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
