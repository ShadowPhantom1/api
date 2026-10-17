import { getApiContext } from "@/lib/api/context";
import { parseJsonBody, setupGuard } from "@/lib/api/http";
import { assertAdmin } from "@/lib/api/auth";
import { errorResponse } from "@/lib/executor/errors";
import { discoveryVerifySchema } from "@/lib/registry/schemas";
import { executeRegistryApi } from "@/lib/executor/registry";
import type { ApiRecord } from "@/lib/db/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function exampleQuery(api: ApiRecord): Record<string, string> {
  const metadata = api.discovery_metadata ?? {};
  const examples =
    metadata.example_params && typeof metadata.example_params === "object"
      ? (metadata.example_params as Record<string, unknown>)
      : {};
  const query: Record<string, string> = {};
  for (const param of api.query_params ?? []) {
    const fromMetadata = examples[param.name];
    if (fromMetadata !== undefined && fromMetadata !== null && fromMetadata !== "") {
      query[param.name] = String(fromMetadata);
    } else if (param.example) {
      query[param.name] = param.example;
    } else if (param.default) {
      query[param.name] = param.default;
    } else if (param.required) {
      throw new Error(`No documented example value for required parameter "${param.name}".`);
    }
  }
  return query;
}

export async function POST(request: Request) {
  try {
    setupGuard();
    const { admin, caller } = await getApiContext(request, { scopes: [] });
    assertAdmin(caller);
    const body = await parseJsonBody(request, discoveryVerifySchema);

    let query = admin.from("apis").select("*").eq("is_enabled", true);
    if (body.apiIds?.length) {
      query = query.in("id", body.apiIds);
    } else {
      query = query
        .eq("is_public", true)
        .eq("is_managed", true)
        .eq("verification_status", "unverified")
        .order("created_at", { ascending: true })
        .limit(body.limit);
    }
    const { data, error } = await query;
    if (error) return errorResponse(error);

    const apis = ((data ?? []) as ApiRecord[]).slice(0, 20);
    const results: Array<Record<string, unknown>> = [];

    const queue = [...apis];
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      for (;;) {
        const api = queue.shift();
        if (!api) return;
        try {
          const input = { query: exampleQuery(api) };
          const { verification, result } = await executeRegistryApi({
            admin,
            api,
            caller,
            input,
            recordVerification: true,
          });
          results.push({
            slug: api.slug,
            name: api.name,
            status: result.status,
            verification: verification?.status ?? "unverified",
            message: verification?.message ?? null,
            durationMs: result.durationMs,
          });
        } catch (verifyError) {
          results.push({
            slug: api.slug,
            name: api.name,
            status: null,
            verification: "failed",
            message: verifyError instanceof Error ? verifyError.message : "Test failed",
          });
        }
      }
    });
    await Promise.all(workers);

    return Response.json({
      tested: results.length,
      verified: results.filter((row) => row.verification === "verified").length,
      failed: results.filter((row) => row.verification !== "verified").length,
      results,
      rateLimitNote:
        "Verification requests are sequential-ish (3 concurrent) and respect provider rate limits.",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
