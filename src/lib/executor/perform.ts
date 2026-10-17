import {
  isJsonContentType,
  isTextContentType,
  safeFetch,
} from "@/lib/http/safe-fetch";
import { env } from "@/lib/env";
import { GatewayError } from "@/lib/executor/errors";
import {
  buildAuthHeaders,
  buildTargetUrl,
  resolvePath,
  validateBody,
  validateHeaders,
  validateQueryParams,
  type UpstreamAuthConfig,
} from "@/lib/registry/params";
import type { ApiRecord, ExecuteResult, HttpMethod } from "@/lib/db/types";

export interface PerformInput {
  query?: Record<string, unknown>;
  pathParams?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  body?: unknown;
}

export interface PerformOptions {
  allowedHosts?: string[];
  enforceAllowlist?: boolean;
  allowPrivate?: boolean;
  /** Test-only port override used by the integration suite. */
  allowedPorts?: number[];
}

export interface PerformResult extends ExecuteResult {
  request: {
    method: HttpMethod;
    url: string;
    queryNames: string[];
    headerNames: string[];
  };
}

const SAFE_RESPONSE_HEADERS = new Set([
  "content-type",
  "content-length",
  "date",
  "cache-control",
  "etag",
  "last-modified",
  "retry-after",
  "content-language",
  "content-disposition",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
]);

function safeResponseHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SAFE_RESPONSE_HEADERS.has(key.toLowerCase())) out[key.toLowerCase()] = value;
  }
  return out;
}

function decodeBody(
  buffer: Buffer,
  contentType: string,
  truncated: boolean,
): Pick<ExecuteResult, "body" | "bodyText"> {
  if (buffer.length === 0) return { body: null, bodyText: null };

  const asText = buffer.toString("utf8");
  if (isJsonContentType(contentType)) {
    try {
      return { body: JSON.parse(asText), bodyText: asText };
    } catch {
      return { body: null, bodyText: asText };
    }
  }
  if (isTextContentType(contentType)) {
    return { body: asText, bodyText: asText };
  }
  return {
    body: {
      encoding: "base64",
      data: buffer.toString("base64"),
      bytes: buffer.length,
      truncated,
      note: "Binary upstream response, base64 encoded.",
    },
    bodyText: null,
  };
}

export async function performUpstreamRequest(
  api: ApiRecord,
  authConfig: UpstreamAuthConfig | null,
  input: PerformInput,
  options: PerformOptions = {},
): Promise<PerformResult> {
  const query = validateQueryParams(api.query_params ?? [], input.query, {
    allowExtra: api.allow_extra_query,
  });
  const pathParams = validatePathParams(api, input.pathParams);
  const resolvedPath = resolvePath(api.path, api.path_params ?? [], pathParams);
  const url = buildTargetUrl(api.base_url, resolvedPath);

  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }

  const clientHeaders = validateHeaders(api.headers_schema ?? [], input.headers);
  const { body, contentType } = validateBody(api.method, api.body_schema, input.body, api.content_type);

  const headers: Record<string, string> = {
    Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
    "User-Agent": "Anvex-Gateway/1.0",
    ...clientHeaders,
  };
  if (contentType) headers["Content-Type"] = contentType;

  const authHeaders = buildAuthHeaders(api.auth_type, api.auth_config_meta ?? {}, authConfig);
  Object.assign(headers, authHeaders);

  // Defense in depth: never forward platform or ambient credentials.
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === "cookie" || key.toLowerCase() === "host") delete headers[key];
  }

  const timeoutMs = Math.min(Math.max(api.timeout_ms ?? 15000, 1000), 30_000);
  const result = await safeFetch(url.toString(), {
    method: api.method,
    headers,
    body,
    timeoutMs,
    maxBytes: env.maxResponseBytes,
    onExceed: "throw",
    allowPrivate: options.allowPrivate,
    allowedHosts: options.allowedHosts,
    enforceAllowlist: options.enforceAllowlist,
    allowedPorts: options.allowedPorts,
  });

  const decoded = decodeBody(result.body, result.contentType, result.truncated);

  return {
    ok: result.status >= 200 && result.status < 400,
    status: result.status,
    statusText: result.statusText,
    contentType: result.contentType,
    headers: safeResponseHeaders(result.headers),
    durationMs: result.durationMs,
    size: result.body.length,
    truncated: result.truncated,
    body: decoded.body,
    bodyText: decoded.bodyText,
    finalUrl: result.finalUrl,
    redirects: result.redirects,
    request: {
      method: api.method,
      url: url.toString(),
      queryNames: Object.keys(query),
      headerNames: Object.keys(headers).filter(
        (name) => !["authorization", "x-api-key", "api-key", "cookie"].includes(name.toLowerCase()),
      ),
    },
  };
}

function validatePathParams(api: ApiRecord, supplied: Record<string, unknown> | undefined): Record<string, string> {
  const defs = api.path_params ?? [];
  const input = supplied ?? {};
  const placeholders = Array.from(api.path.matchAll(/\{([A-Za-z0-9_.-]{1,64})\}/g)).map((m) => m[1]);
  const out: Record<string, string> = {};
  for (const name of placeholders) {
    const def = defs.find((d) => d.name === name);
    const value = input[name] ?? def?.default;
    if (value === undefined || value === null || value === "") {
      if (def?.required === false) continue;
      throw new GatewayError("missing_parameter", `Path parameter "${name}" is required.`);
    }
    if (typeof value === "object" || String(value).length > 512) {
      throw new GatewayError("invalid_parameter", `Path parameter "${name}" is invalid.`);
    }
    out[name] = String(value);
  }
  return out;
}
