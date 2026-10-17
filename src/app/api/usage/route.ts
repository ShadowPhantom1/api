import { getApiContext } from "@/lib/api/context";
import { clampInt, requestSearchParams, setupGuard } from "@/lib/api/http";
import { errorResponse, GatewayError } from "@/lib/executor/errors";
import type { RequestKind } from "@/lib/db/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RequestRow {
  api_id: string | null;
  kind: RequestKind;
  ok: boolean;
  status_code: number | null;
  duration_ms: number | null;
  response_bytes: number | null;
  created_at: string;
}

interface ApiNameRow {
  id: string;
  name: string;
  slug: string;
}

const MAX_ROWS = 20_000;

export async function GET(request: Request) {
  try {
    setupGuard();
    const { admin, caller } = await getApiContext(request, { scopes: [] });
    const params = requestSearchParams(request);
    const days = clampInt(params.get("days"), 30, 1, 90);
    const scope = params.get("scope") === "all" ? "all" : "mine";
    if (scope === "all" && !caller.isAdmin) {
      throw new GatewayError("forbidden", "Administrator access is required for the all-users view.", 403);
    }

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    let query = admin
      .from("api_requests")
      .select("api_id, kind, ok, status_code, duration_ms, response_bytes, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(MAX_ROWS);
    if (scope === "mine") query = query.eq("user_id", caller.userId);

    const { data, error } = await query;
    if (error) throw new GatewayError("query_failed", error.message, 500);
    const rows = (data ?? []) as RequestRow[];

    const dayKey = (iso: string) => iso.slice(0, 10);
    const daysMap = new Map<string, { requests: number; errors: number; durations: number[] }>();
    for (let i = days - 1; i >= 0; i -= 1) {
      const key = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      daysMap.set(key, { requests: 0, errors: 0, durations: [] });
    }

    let totalRequests = 0;
    let totalErrors = 0;
    let totalDuration = 0;
    let durationSamples = 0;
    let totalBytes = 0;
    const kindMap = new Map<string, { requests: number; errors: number }>();
    const statusBuckets = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0, network: 0 };
    const apiMap = new Map<string, { requests: number; errors: number; durations: number[] }>();

    for (const row of rows) {
      totalRequests += 1;
      if (!row.ok) totalErrors += 1;
      if (typeof row.duration_ms === "number") {
        totalDuration += row.duration_ms;
        durationSamples += 1;
      }
      if (typeof row.response_bytes === "number") totalBytes += row.response_bytes;

      const bucket = daysMap.get(dayKey(row.created_at));
      if (bucket) {
        bucket.requests += 1;
        if (!row.ok) bucket.errors += 1;
        if (typeof row.duration_ms === "number") bucket.durations.push(row.duration_ms);
      }

      const kind = kindMap.get(row.kind) ?? { requests: 0, errors: 0 };
      kind.requests += 1;
      if (!row.ok) kind.errors += 1;
      kindMap.set(row.kind, kind);

      if (row.status_code === null) statusBuckets.network += 1;
      else if (row.status_code >= 500) statusBuckets["5xx"] += 1;
      else if (row.status_code >= 400) statusBuckets["4xx"] += 1;
      else if (row.status_code >= 300) statusBuckets["3xx"] += 1;
      else statusBuckets["2xx"] += 1;

      if (row.api_id) {
        const api = apiMap.get(row.api_id) ?? { requests: 0, errors: 0, durations: [] };
        api.requests += 1;
        if (!row.ok) api.errors += 1;
        if (typeof row.duration_ms === "number") api.durations.push(row.duration_ms);
        apiMap.set(row.api_id, api);
      }
    }

    const topApiIds = [...apiMap.entries()]
      .sort((a, b) => b[1].requests - a[1].requests)
      .slice(0, 8)
      .map(([id]) => id);
    let apiNames = new Map<string, ApiNameRow>();
    if (topApiIds.length) {
      const { data: apis } = await admin.from("apis").select("id, name, slug").in("id", topApiIds);
      apiNames = new Map(((apis ?? []) as ApiNameRow[]).map((row) => [row.id, row]));
    }

    const average = (values: number[]) =>
      values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;

    return Response.json({
      rangeDays: days,
      scope,
      generatedAt: new Date().toISOString(),
      truncated: rows.length === MAX_ROWS,
      totals: {
        requests: totalRequests,
        successes: totalRequests - totalErrors,
        errors: totalErrors,
        successRate: totalRequests ? Math.round(((totalRequests - totalErrors) / totalRequests) * 1000) / 10 : null,
        avgDurationMs: durationSamples ? Math.round(totalDuration / durationSamples) : null,
        responseBytes: totalBytes,
      },
      daily: [...daysMap.entries()].map(([date, value]) => ({
        date,
        requests: value.requests,
        errors: value.errors,
        avgDurationMs: average(value.durations),
      })),
      byKind: [...kindMap.entries()].map(([kind, value]) => ({ kind, ...value })),
      byStatus: Object.entries(statusBuckets).map(([bucket, requests]) => ({ bucket, requests })),
      topApis: topApiIds.map((id) => {
        const stats = apiMap.get(id)!;
        const meta = apiNames.get(id);
        return {
          apiId: id,
          name: meta?.name ?? "Deleted or hidden API",
          slug: meta?.slug ?? null,
          requests: stats.requests,
          errors: stats.errors,
          avgDurationMs: average(stats.durations),
        };
      }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
