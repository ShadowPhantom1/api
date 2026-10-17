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
    if (!caller.isAdmin) {
      throw new GatewayError("forbidden", "Administrator access is required to view discovery runs.", 403);
    }

    const params = requestSearchParams(request);
    const limit = clampInt(params.get("limit"), 20, 1, 100);

    const { data, error } = await admin
      .from("discovery_runs")
      .select(
        "id, adapter, source_url, status, attempted_methods, notes, created_count, updated_count, unchanged_count, failed_count, endpoint_ids, started_at, finished_at, provider:providers(name, slug)",
      )
      .order("started_at", { ascending: false })
      .limit(limit);

    if (error) throw new GatewayError("query_failed", error.message, 500);
    return Response.json({ items: data ?? [], limit });
  } catch (error) {
    return errorResponse(error);
  }
}
