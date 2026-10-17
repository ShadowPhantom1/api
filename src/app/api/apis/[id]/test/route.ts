import { z } from "zod";
import { getApiContext } from "@/lib/api/context";
import { parseJsonBody, setupGuard } from "@/lib/api/http";
import { errorResponse, GatewayError } from "@/lib/executor/errors";
import { assertUserCaller } from "@/lib/api/auth";
import { executeRegistryApi } from "@/lib/executor/registry";
import type { ApiRecord } from "@/lib/db/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const testBodySchema = z.object({
  query: z.record(z.unknown()).optional(),
  pathParams: z.record(z.unknown()).optional(),
  headers: z.record(z.unknown()).optional(),
  body: z.unknown().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    setupGuard();
    const { admin, caller } = await getApiContext(request, { scopes: ["execute"] });
    assertUserCaller(caller);
    const { id } = await context.params;
    const input = await parseJsonBody(request, testBodySchema);

    const { data, error } = await admin.from("apis").select("*").eq("id", id).maybeSingle();
    if (error) throw new GatewayError("query_failed", error.message, 500);
    if (!data) throw new GatewayError("not_found", "API not found.", 404);
    const api = data as ApiRecord;

    const isOwner = api.owner_id === caller.userId;
    const canRecord = isOwner || caller.isAdmin;

    const { result, verification } = await executeRegistryApi({
      admin,
      api,
      caller,
      input,
      recordVerification: canRecord,
    });

    return Response.json({
      verification: verification ?? null,
      result: {
        ok: result.ok,
        status: result.status,
        statusText: result.statusText,
        contentType: result.contentType,
        headers: result.headers,
        durationMs: result.durationMs,
        size: result.size,
        truncated: result.truncated,
        body: result.body,
        bodyText: result.bodyText,
        request: result.request,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
