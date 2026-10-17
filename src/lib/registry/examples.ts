import type { BodySchema, HeaderDef, HttpMethod, ParamDef } from "@/lib/db/types";

export interface ExampleApiShape {
  base_url: string;
  path: string;
  method: HttpMethod;
  query_params: ParamDef[];
  path_params: ParamDef[];
  headers_schema: HeaderDef[];
  body_schema: BodySchema | null;
  request_example?: Record<string, unknown> | null;
  discovery_metadata?: Record<string, unknown>;
  content_type?: string;
}

export interface ExampleRequest {
  url: string;
  query: Record<string, string>;
  pathParams: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
  missingRequired: string[];
}

function sampleFor(param: ParamDef, metadata: Record<string, unknown> | undefined): string {
  const manifestExamples =
    metadata && typeof metadata.example_params === "object" && metadata.example_params
      ? (metadata.example_params as Record<string, unknown>)
      : {};
  const metadataValue = manifestExamples[param.name];
  if (typeof metadataValue === "string" && metadataValue.trim()) return metadataValue;
  if (param.example !== undefined && param.example !== "") return param.example;
  if (param.default !== undefined && param.default !== "") return param.default;
  if (param.enum?.length) return param.enum[0];
  if (param.type === "number" || param.type === "integer") return "1";
  if (param.type === "boolean") return "true";
  return "";
}

/**
 * Builds a display/example request from the stored configuration only. It does
 * not pretend values exist: parameters without an example are reported as
 * missing rather than filled with invented data.
 */
export function buildExampleRequest(api: ExampleApiShape): ExampleRequest {
  const metadata = api.discovery_metadata;
  const requestSample =
    api.request_example && typeof api.request_example === "object" ? api.request_example : null;
  const sampleQuery =
    requestSample && typeof requestSample.query === "object" && requestSample.query
      ? (requestSample.query as Record<string, unknown>)
      : {};

  const query: Record<string, string> = {};
  const missingRequired: string[] = [];
  for (const param of api.query_params ?? []) {
    let value = sampleFor(param, metadata);
    if (!value && typeof sampleQuery[param.name] === "string") {
      value = String(sampleQuery[param.name]);
    }
    if (!value) {
      if (param.required) missingRequired.push(`query.${param.name}`);
      continue;
    }
    query[param.name] = value;
  }

  const pathParams: Record<string, string> = {};
  let path = api.path;
  for (const param of api.path_params ?? []) {
    const value = sampleFor(param, metadata);
    if (value) pathParams[param.name] = value;
    if (!value && param.required) missingRequired.push(`path.${param.name}`);
    path = path.replace(new RegExp(`\\{${param.name}\\}`, "g"), encodeURIComponent(value || `{${param.name}}`));
  }

  const headers: Record<string, string> = {};
  for (const header of api.headers_schema ?? []) {
    if (header.secret) continue;
    if (header.example) headers[header.name] = header.example;
  }

  const url = new URL(`${api.base_url.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

  const body =
    api.body_schema?.example ??
    (requestSample ? requestSample.body ?? null : null);

  return { url: url.toString(), query, pathParams, headers, body, missingRequired };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildUpstreamCurl(api: ExampleApiShape): string {
  const example = buildExampleRequest(api);
  const lines = [`curl -s -i -X ${api.method} ${shellQuote(example.url)}`];
  for (const [name, value] of Object.entries(example.headers)) {
    lines.push(`  -H ${shellQuote(`${name}: ${value}`)}`);
  }
  if (api.method !== "GET" && example.body !== null && example.body !== undefined) {
    if (!example.headers["Content-Type"]) {
      lines.push(`  -H ${shellQuote(`Content-Type: ${api.content_type ?? "application/json"}`)}`);
    }
    lines.push(`  --data-raw ${shellQuote(JSON.stringify(example.body))}`);
  }
  if (api.query_params.some((param) => param.required) || example.missingRequired.length) {
    lines.push(
      `# Missing required inputs: ${example.missingRequired.length ? example.missingRequired.join(", ") : "none in the stored example"}`,
    );
  }
  return lines.join(" \\\n");
}

export function buildAnvexCurl(api: { slug: string } & ExampleApiShape, appUrl = "$APP_URL"): string {
  const example = buildExampleRequest(api);
  const payload = {
    apiSlug: api.slug,
    query: example.query,
    ...(Object.keys(example.pathParams).length ? { pathParams: example.pathParams } : {}),
    ...(Object.keys(example.headers).length ? { headers: example.headers } : {}),
    ...(example.body !== null && example.body !== undefined ? { body: example.body } : {}),
  };
  return [
    `curl -s -X POST ${shellQuote(`${appUrl}/api/gateway/execute`)} \\`,
    `  -H "Authorization: Bearer $ANVEX_KEY" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d ${shellQuote(JSON.stringify(payload))}`,
  ].join("\n");
}
