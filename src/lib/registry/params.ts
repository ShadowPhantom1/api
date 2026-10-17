import { GatewayError } from "@/lib/executor/errors";
import type {
  AuthType,
  BodySchema,
  HeaderDef,
  HttpMethod,
  ParamDef,
  ParamType,
} from "@/lib/db/types";

const PARAM_NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_PARAMS = 50;
const MAX_VALUE_LENGTH = 2048;

const FORBIDDEN_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "upgrade",
  "keep-alive",
  "te",
  "trailer",
  "proxy-authorization",
  "proxy-connection",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
  "cookie",
  "set-cookie",
  "authorization",
  "x-vercel-id",
  "x-vercel-forwarded-for",
]);

export function isForbiddenHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("proxy-") || FORBIDDEN_HEADERS.has(lower) || lower.startsWith("x-supabase");
}

function coerceValue(name: string, raw: unknown, type: ParamType | undefined): string {
  if (raw === undefined || raw === null || raw === "") {
    throw new GatewayError("invalid_parameter", `Parameter "${name}" must not be empty.`);
  }
  if (typeof raw === "object") {
    throw new GatewayError("invalid_parameter", `Parameter "${name}" must be a scalar value.`);
  }
  const value = String(raw);
  if (value.length > MAX_VALUE_LENGTH) {
    throw new GatewayError(
      "invalid_parameter",
      `Parameter "${name}" exceeds the ${MAX_VALUE_LENGTH} character limit.`,
    );
  }

  switch (type) {
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        throw new GatewayError("invalid_parameter", `Parameter "${name}" must be a number.`);
      }
      return String(n);
    }
    case "integer": {
      const n = Number(value);
      if (!Number.isInteger(n)) {
        throw new GatewayError("invalid_parameter", `Parameter "${name}" must be an integer.`);
      }
      return String(n);
    }
    case "boolean": {
      if (!["true", "false", "1", "0"].includes(value.toLowerCase())) {
        throw new GatewayError("invalid_parameter", `Parameter "${name}" must be a boolean.`);
      }
      return value.toLowerCase();
    }
    case "enum":
    case "string":
    default:
      return value;
  }
}

export function validateQueryParams(
  defs: ParamDef[],
  supplied: Record<string, unknown> | undefined,
  options: { allowExtra?: boolean } = {},
): Record<string, string> {
  const input = supplied ?? {};
  const entries = Object.entries(input);
  if (entries.length > MAX_PARAMS) {
    throw new GatewayError("too_many_parameters", `At most ${MAX_PARAMS} parameters are allowed.`);
  }

  const declared = new Map(defs.map((def) => [def.name, def]));
  const out: Record<string, string> = {};

  for (const [name, value] of entries) {
    if (!PARAM_NAME_RE.test(name)) {
      throw new GatewayError("invalid_parameter", `Invalid parameter name "${name}".`);
    }
    if (!declared.has(name) && !options.allowExtra) {
      throw new GatewayError(
        "unknown_parameter",
        `Parameter "${name}" is not declared for this endpoint. Declared: ${
          defs.map((d) => d.name).join(", ") || "none"
        }.`,
      );
    }
    out[name] = coerceValue(name, value, declared.get(name)?.type);
  }

  for (const def of defs) {
    if (!(def.name in out) && def.default !== undefined && def.default !== "") {
      out[def.name] = coerceValue(def.name, def.default, def.type);
    }
    if (def.required && !(def.name in out)) {
      throw new GatewayError("missing_parameter", `Required parameter "${def.name}" is missing.`);
    }
    if (def.type === "enum" && def.enum?.length && out[def.name] !== undefined) {
      if (!def.enum.includes(out[def.name])) {
        throw new GatewayError(
          "invalid_parameter",
          `Parameter "${def.name}" must be one of: ${def.enum.join(", ")}.`,
        );
      }
    }
    if (!PARAM_NAME_RE.test(def.name)) {
      throw new GatewayError(
        "invalid_configuration",
        `The stored endpoint declares an invalid parameter name "${def.name}".`,
        500,
      );
    }
  }

  return out;
}

export function resolvePath(path: string, defs: ParamDef[], supplied: Record<string, unknown> | undefined) {
  const input = supplied ?? {};
  let resolved = path;
  const placeholders = Array.from(path.matchAll(/\{([A-Za-z0-9_.-]{1,64})\}/g)).map((m) => m[1]);

  for (const name of placeholders) {
    const def = defs.find((d) => d.name === name);
    const raw = input[name];
    if (raw === undefined || raw === null || raw === "") {
      if (def?.required === false || def?.default) {
        resolved = resolved.replace(new RegExp(`\\{${name}\\}`, "g"), encodeURIComponent(String(def?.default)));
        continue;
      }
      throw new GatewayError("missing_parameter", `Path parameter "${name}" is required.`);
    }
    resolved = resolved.replace(
      new RegExp(`\\{${name}\\}`, "g"),
      encodeURIComponent(String(raw)),
    );
  }

  if (/\{[^}]+\}/.test(resolved)) {
    throw new GatewayError("invalid_configuration", "The endpoint path has unresolved placeholders.", 500);
  }
  return resolved;
}

export function buildTargetUrl(baseUrl: string, path: string): URL {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new GatewayError("invalid_configuration", "The stored base URL is invalid.", 500);
  }
  if (path.includes("://") || path.startsWith("//")) {
    throw new GatewayError("invalid_configuration", "The endpoint path must be relative.", 500);
  }
  if (path.split("/").some((segment) => segment === "..")) {
    throw new GatewayError("invalid_configuration", "Path traversal is not allowed.", 500);
  }
  const basePath = base.pathname.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  base.pathname = `${basePath}${suffix}`.replace(/\/{2,}/g, "/");
  base.search = "";
  base.hash = "";
  return base;
}

export function validateHeaders(
  defs: HeaderDef[],
  supplied: Record<string, unknown> | undefined,
): Record<string, string> {
  const input = supplied ?? {};
  const declared = new Map(defs.map((def) => [def.name.toLowerCase(), def]));
  const out: Record<string, string> = {};

  for (const [name, value] of Object.entries(input)) {
    if (!PARAM_NAME_RE.test(name)) {
      throw new GatewayError("invalid_header", `Invalid header name "${name}".`);
    }
    if (isForbiddenHeader(name)) {
      throw new GatewayError("forbidden_header", `Header "${name}" cannot be forwarded upstream.`);
    }
    if (!declared.has(name.toLowerCase())) {
      throw new GatewayError("unknown_header", `Header "${name}" is not declared for this endpoint.`);
    }
    if (typeof value === "object" || value === null || value === undefined) {
      throw new GatewayError("invalid_header", `Header "${name}" must be a string value.`);
    }
    const stringValue = String(value);
    if (stringValue.length > 1024) {
      throw new GatewayError("invalid_header", `Header "${name}" is too long.`);
    }
    out[name] = stringValue;
  }

  const providedLower = new Set(Object.keys(out).map((k) => k.toLowerCase()));
  for (const def of defs) {
    if (isForbiddenHeader(def.name)) continue;
    if (def.required && !providedLower.has(def.name.toLowerCase())) {
      throw new GatewayError("missing_header", `Required header "${def.name}" is missing.`);
    }
  }

  return out;
}

export interface UpstreamAuthConfig {
  token?: string;
  apiKey?: string;
  username?: string;
  password?: string;
  headerName?: string;
}

export function buildAuthHeaders(
  authType: AuthType,
  meta: Record<string, unknown>,
  config: UpstreamAuthConfig | null,
): Record<string, string> {
  if (authType === "none") return {};
  if (!config) {
    throw new GatewayError(
      "auth_not_configured",
      "This endpoint requires upstream credentials that have not been configured yet. Edit the API configuration to add them.",
      424,
    );
  }
  switch (authType) {
    case "bearer": {
      if (!config.token) {
        throw new GatewayError("auth_not_configured", "Bearer token is not configured.", 424);
      }
      return { Authorization: `Bearer ${config.token}` };
    }
    case "api_key": {
      if (!config.apiKey) {
        throw new GatewayError("auth_not_configured", "API key is not configured.", 424);
      }
      const headerName =
        typeof meta.header_name === "string" && PARAM_NAME_RE.test(meta.header_name)
          ? meta.header_name
          : config.headerName && PARAM_NAME_RE.test(config.headerName)
            ? config.headerName
            : "X-API-Key";
      return { [headerName]: config.apiKey };
    }
    case "basic": {
      if (!config.username || config.password === undefined) {
        throw new GatewayError("auth_not_configured", "Basic credentials are not configured.", 424);
      }
      return {
        Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`,
      };
    }
    default:
      return {};
  }
}

export function validateBody(
  method: HttpMethod,
  bodySchema: BodySchema | null,
  body: unknown,
  contentType: string,
): { body: string | undefined; contentType: string | undefined } {
  if (body === undefined || body === null) {
    if (bodySchema?.required?.length) {
      throw new GatewayError(
        "missing_body",
        `A request body is required (fields: ${bodySchema.required.join(", ")}).`,
      );
    }
    return { body: undefined, contentType: undefined };
  }
  if (method === "GET") {
    throw new GatewayError("invalid_body", "GET endpoints cannot send a request body.");
  }
  if (typeof body !== "object" || Array.isArray(body)) {
    throw new GatewayError("invalid_body", "The request body must be a JSON object.");
  }

  const record = body as Record<string, unknown>;
  if (bodySchema?.required?.length) {
    for (const key of bodySchema.required) {
      if (!(key in record)) {
        throw new GatewayError("missing_body_field", `Request body field "${key}" is required.`);
      }
    }
  }

  const serialized =
    contentType === "application/x-www-form-urlencoded"
      ? new URLSearchParams(
          Object.entries(record).flatMap(([key, value]) =>
            value === undefined || value === null || typeof value === "object"
              ? []
              : [[key, String(value)]],
          ),
        ).toString()
      : JSON.stringify(record);

  if (Buffer.byteLength(serialized, "utf8") > 256 * 1024) {
    throw new GatewayError("body_too_large", "Request bodies are limited to 256 KB.", 413);
  }

  return {
    body: serialized,
    contentType:
      contentType === "application/x-www-form-urlencoded"
        ? "application/x-www-form-urlencoded"
        : "application/json",
  };
}
