import { getApiContext } from "@/lib/api/context";
import { parseJsonBody, setupGuard } from "@/lib/api/http";
import { errorResponse, GatewayError } from "@/lib/executor/errors";
import { assertUserCaller } from "@/lib/api/auth";
import { probeSchema } from "@/lib/registry/schemas";
import { isForbiddenHeader } from "@/lib/registry/params";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { redactHeaders } from "@/lib/security/redact";
import { isJsonContentType, isTextContentType, safeFetch } from "@/lib/http/safe-fetch";
import { inferParamType } from "@/lib/discovery/normalize";
import { logRequest } from "@/lib/usage/log";
import { titleCase, truncate } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PROBE_BYTES = 512 * 1024;

export async function POST(request: Request) {
  const started = Date.now();
  try {
    setupGuard();
    const { admin, caller } = await getApiContext(request, { scopes: [] });
    assertUserCaller(caller);
    const limit = await consumeRateLimit(admin, `probe:${caller.userId}`, 20, 60);
    if (!limit.allowed) {
      throw new GatewayError("rate_limited", "Probe limit reached (20 requests / minute).", 429);
    }

    const body = await parseJsonBody(request, probeSchema);
    const target = new URL(body.url);

    const headers: Record<string, string> = {
      Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
      "User-Agent": "Anvex-Explorer/1.0",
    };
    for (const [name, value] of Object.entries(body.headers ?? {})) {
      if (isForbiddenHeader(name)) {
        throw new GatewayError(
          "forbidden_header",
          `Header "${name}" cannot be set manually. Use the authentication fields instead.`,
        );
      }
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name)) {
        throw new GatewayError("invalid_header", `Invalid header name "${name}".`);
      }
      headers[name] = String(value).slice(0, 1024);
    }

    let credentialsTested = false;
    const auth = body.auth;
    if (auth && auth.type !== "none") {
      if (auth.type === "bearer" && auth.token) {
        headers.Authorization = `Bearer ${auth.token}`;
        credentialsTested = true;
      } else if (auth.type === "api_key" && auth.apiKey) {
        const headerName = auth.headerName && /^[A-Za-z0-9_.-]{1,64}$/.test(auth.headerName)
          ? auth.headerName
          : "X-API-Key";
        headers[headerName] = auth.apiKey;
        credentialsTested = true;
      } else if (auth.type === "basic" && auth.username && auth.password !== undefined) {
        headers.Authorization = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`;
        credentialsTested = true;
      }
    }

    let requestBody: string | undefined;
    if (body.method !== "GET" && body.body !== undefined) {
      requestBody = JSON.stringify(body.body);
      if (Buffer.byteLength(requestBody, "utf8") > 256 * 1024) {
        throw new GatewayError("body_too_large", "Probe bodies are limited to 256 KB.", 413);
      }
      headers["Content-Type"] = "application/json";
    }

    const result = await safeFetch(body.url, {
      method: body.method,
      headers,
      body: requestBody,
      timeoutMs: body.timeoutMs,
      maxBytes: MAX_PROBE_BYTES,
      onExceed: "truncate",
      maxRedirects: 2,
    });

    let parsedBody: unknown = null;
    let bodyPreview: string | null = null;
    if (isJsonContentType(result.contentType)) {
      try {
        parsedBody = JSON.parse(result.body.toString("utf8"));
      } catch {
        bodyPreview = truncate(result.body.toString("utf8"), 20_000);
      }
    } else if (isTextContentType(result.contentType)) {
      bodyPreview = truncate(result.body.toString("utf8"), 20_000);
    } else {
      bodyPreview = `[binary ${result.body.length} bytes — not displayed]`;
    }

    const queryParams = Array.from(target.searchParams.entries()).map(([name, value]) => ({
      name,
      type: inferParamType(value),
      required: false,
      example: value,
    }));

    await logRequest(admin, {
      userId: caller.userId,
      apiId: null,
      platformKeyId: caller.platformKeyId,
      kind: "discovery_test",
      method: body.method,
      statusCode: result.status,
      durationMs: result.durationMs,
      responseBytes: result.body.length,
      ok: result.status >= 200 && result.status < 400,
    });

    return Response.json({
      reachable: true,
      ok: result.status >= 200 && result.status < 400,
      status: result.status,
      statusText: result.statusText,
      contentType: result.contentType,
      durationMs: result.durationMs,
      bytes: result.body.length,
      truncated: result.truncated,
      redirects: result.redirects,
      finalUrl: result.finalUrl,
      headers: redactHeaders(result.headers),
      body: parsedBody,
      bodyPreview,
      credentialsTested,
      suggestedConfig: {
        name: titleCase(
          target.pathname.split("/").filter(Boolean).pop()?.replace(/[^A-Za-z0-9]+/g, " ") ??
            target.hostname,
        ),
        baseUrl: target.origin,
        path: target.pathname,
        method: body.method,
        queryParams,
        authType: auth?.type ?? "none",
      },
      note:
        "This probe is a live request; however, the endpoint is not marked verified until you save it and run Test.",
      elapsedMs: Date.now() - started,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
