import { z } from "zod";
import { getApiContext } from "@/lib/api/context";
import { parseJsonBody, setupGuard } from "@/lib/api/http";
import { errorResponse, GatewayError } from "@/lib/executor/errors";
import { executeRegistryApi } from "@/lib/executor/registry";
import type { ApiRecord } from "@/lib/db/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const executeSchema = z.object({
  apiSlug: z.string().min(1).max(120),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
  query: z.record(z.unknown()).optional(),
  pathParams: z.record(z.unknown()).optional(),
  headers: z.record(z.unknown()).optional(),
  body: z.unknown().optional(),
});

export async function POST(request: Request) {
  try {
    setupGuard();
    const { admin, caller } = await getApiContext(request, { scopes: ["execute"] });
    const body = await parseJsonBody(request, executeSchema);

    const { data, error } = await admin
      .from("apis")
      .select("*")
      .eq("slug", body.apiSlug)
      .maybeSingle();
    if (error) throw new GatewayError("query_failed", error.message, 500);
    if (!data) throw new GatewayError("not_found", "API not found.", 404);
    const api = data as ApiRecord;

    if (body.method && body.method !== api.method) {
      throw new GatewayError(
        "method_not_allowed",
        `This endpoint is registered for ${api.method}. Register a separate endpoint for ${body.method}.`,
        405,
      );
    }

    const { result } = await executeRegistryApi({
      admin,
      api,
      caller,
      input: {
        query: body.query,
        pathParams: body.pathParams,
        headers: body.headers,
        body: body.body,
      },
    });

    const url = new URL(request.url);
    const wantsRaw = url.searchParams.get("raw") === "1" || request.headers.get("x-anvex-raw") === "1";
    if (wantsRaw) {
      const rawBody = result.body as { encoding?: string; data?: string } | string | null;
      let payload: BodyInit;
      if (rawBody && typeof rawBody === "object" && rawBody.encoding === "base64" && rawBody.data) {
        payload = Buffer.from(rawBody.data, "base64");
      } else if (typeof rawBody === "string") {
        payload = rawBody;
      } else if (result.bodyText) {
        payload = result.bodyText;
      } else {
        payload = JSON.stringify(rawBody ?? null);
      }
      return new Response(payload, {
        status: result.status,
        headers: {
          "Content-Type": result.contentType,
          "X-Anvex-Upstream-Status": String(result.status),
          "X-Anvex-Duration-Ms": String(result.durationMs),
          "X-Anvex-Truncated": String(result.truncated),
        },
      });
    }

    return Response.json({
      ok: result.ok,
      api: { slug: api.slug, name: api.name, method: api.method },
      request: result.request,
      response: {
        status: result.status,
        statusText: result.statusText,
        contentType: result.contentType,
        headers: result.headers,
        durationMs: result.durationMs,
        size: result.size,
        truncated: result.truncated,
        redirects: result.redirects,
        finalUrl: result.finalUrl,
        body: result.body,
        bodyText: result.bodyText,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
