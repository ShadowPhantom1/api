import "server-only";
import { safeFetch } from "@/lib/http/safe-fetch";
import { absoluteEndpointUrl, categoryDisplayName, categorySlugFor, normalizeMethod, paramsFromExamples } from "@/lib/discovery/normalize";
import { parseOpenApiDocument } from "@/lib/discovery/openapi";
import type {
  DiscoveryAttempt,
  DiscoveredEndpoint,
  HeaderDef,
  ParamDef,
} from "@/lib/db/types";

export interface InspectionResult {
  attempts: DiscoveryAttempt[];
  endpoints: DiscoveredEndpoint[];
  notes: string;
  manifestUrl: string | null;
  openapiUrl: string | null;
  homepageTitle: string | null;
}

export interface InspectOptions {
  sourceUrl: string;
  providerSlug: string;
  manifestPath?: string;
  adapter?: "auto" | "rebix_manifest" | "json_manifest" | "openapi";
  timeoutMs?: number;
}

const COMMON_MANIFEST_PATHS = [
  "/allEnds",
  "/endpoints",
  "/api/endpoints",
  "/routes",
  "/api/routes",
  "/api/catalog",
  "/manifest.json",
];

const COMMON_OPENAPI_PATHS = [
  "/openapi.json",
  "/swagger.json",
  "/docs/openapi.json",
  "/.well-known/openapi.json",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractScriptSources(html: string, baseUrl: string): string[] {
  const sources = Array.from(html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)).map((m) => m[1]);
  const urls: string[] = [];
  for (const src of sources) {
    try {
      const url = new URL(src, baseUrl);
      if (url.origin === new URL(baseUrl).origin && !urls.includes(url.toString())) {
        urls.push(url.toString());
      }
    } catch {
      /* ignore malformed script tags */
    }
  }
  return urls.slice(0, 5);
}

function extractScriptText(html: string): string {
  return Array.from(html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi))
    .map((match) => match[1])
    .join("\n");
}

function discoverCandidatePaths(scriptText: string): string[] {
  const found = new Set<string>();
  const matches = scriptText.matchAll(/["'`](\/[A-Za-z0-9_\-./{}:]{2,80})["'`]/g);
  for (const match of matches) {
    const path = match[1];
    if (!/(ends|route|endpoint|catalog|manifest|openapi|swagger)/i.test(path)) continue;
    if (path.includes("..") || path.includes("://")) continue;
    found.add(path.split("?")[0]);
  }
  return Array.from(found).slice(0, 10);
}

function looksLikeEndpointManifest(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (!isRecord(value)) return false;
  if (typeof value.openapi === "string" || typeof value.swagger === "string") return true;
  if (Array.isArray(value.endpoints) || Array.isArray(value.routes)) return true;
  if (isRecord(value.data)) return Object.values(value.data).some(Array.isArray);
  if (Array.isArray(value.data)) return true;
  return false;
}

function normalizeEndpointPath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const value = raw.trim();
  if (value.startsWith("http://") || value.startsWith("https://")) {
    try {
      return new URL(value).pathname;
    } catch {
      return null;
    }
  }
  if (!value.startsWith("/")) return null;
  return value.split("?")[0];
}

function endpointFromItem(
  item: Record<string, unknown>,
  categoryKey: string,
  options: { providerSlug: string; baseUrl: string; manifestUrl: string; manifestTimestamp: string | null },
): { endpoint: DiscoveredEndpoint | null; error?: string } {
  const path = normalizeEndpointPath(item.path ?? item.endpoint ?? item.route ?? item.url);
  if (!path) return { endpoint: null, error: "missing or invalid path" };
  const method = normalizeMethod(item.method ?? "GET");
  if (!method) return { endpoint: null, error: `unsupported method for ${path}` };

  const name =
    (typeof item.name === "string" && item.name.trim()) ||
    (typeof item.title === "string" && item.title.trim()) ||
    path.split("/").filter(Boolean).pop() ||
    path;
  const description =
    typeof item.description === "string"
      ? item.description
      : typeof item.desc === "string"
        ? item.desc
        : "";
  const isNsfw = item.nsfw === true || categoryKey === "nsfw";

  const queryParams: ParamDef[] = Array.isArray(item.params)
    ? paramsFromExampleArray(item.params)
    : paramsFromExamples(item.params);

  const now = new Date().toISOString();
  const categorySlug = categorySlugFor(categoryKey);

  return {
    endpoint: {
      name: String(name).slice(0, 160),
      path,
      method,
      description: description.slice(0, 1900),
      categorySlug,
      categoryName: categoryDisplayName(categoryKey),
      baseUrl: options.baseUrl,
      queryParams,
      pathParams: [],
      headersSchema: [] as HeaderDef[],
      bodySchema: null,
      contentType: "application/json",
      authType: "none",
      authMeta: {},
      requestExample: {
        method,
        url: absoluteEndpointUrl(options.baseUrl, path),
        ...(queryParams.length
          ? {
              query: Object.fromEntries(
                queryParams.map((param) => [param.name, param.example ?? ""]),
              ),
            }
          : {}),
      },
      responseExample: null,
      isNsfw,
      supportsStreaming:
        item.supports_streaming === true || item.streaming === true,
      sourceUrl: `${options.manifestUrl}#${path}`,
      sourceKey: `${options.providerSlug}:${method}:${path}`,
      metadata: {
        discovery: "rebix_manifest",
        manifest_url: options.manifestUrl,
        manifest_category: categoryKey,
        example_params: Object.fromEntries(
          queryParams.map((param) => [param.name, param.example ?? ""]),
        ),
        manifest_timestamp: options.manifestTimestamp,
        discovered_at: now,
      },
    },
  };
}

function paramsFromExampleArray(raw: unknown[]): ParamDef[] {
  const params: ParamDef[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.name !== "string") continue;
    params.push({
      name: entry.name,
      type: entry.type === "number" || entry.type === "integer" || entry.type === "boolean" || entry.type === "enum" ? entry.type : "string",
      required: entry.required === true,
      description: typeof entry.description === "string" ? entry.description : undefined,
      example: entry.example !== undefined ? String(entry.example) : undefined,
      default: entry.default !== undefined ? String(entry.default) : undefined,
    });
  }
  return params;
}

export function parseManifestDocument(
  document: unknown,
  options: {
    providerSlug: string;
    baseUrl: string;
    manifestUrl: string;
    sourceUrl?: string;
  },
): { endpoints: DiscoveredEndpoint[]; manifestTimestamp: string | null; errors: string[] } {
  const endpoints: DiscoveredEndpoint[] = [];
  const errors: string[] = [];
  const manifestTimestamp =
    isRecord(document) && typeof document.timestamp === "string" ? document.timestamp : null;

  const push = (item: unknown, categoryKey: string) => {
    if (!isRecord(item)) {
      errors.push("Skipped a non-object endpoint entry.");
      return;
    }
    const { endpoint, error } = endpointFromItem(item, categoryKey, {
      providerSlug: options.providerSlug,
      baseUrl: options.baseUrl,
      manifestUrl: options.manifestUrl,
      manifestTimestamp,
    });
    if (endpoint) endpoints.push(endpoint);
    else if (error) errors.push(error);
  };

  if (Array.isArray(document)) {
    for (const item of document) push(item, "general");
  } else if (isRecord(document)) {
    if (isRecord(document.data)) {
      for (const [categoryKey, items] of Object.entries(document.data)) {
        if (!Array.isArray(items)) continue;
        for (const item of items) push(item, categoryKey);
      }
    } else if (Array.isArray(document.data)) {
      for (const item of document.data) {
        push(item, isRecord(item) && typeof item.category === "string" ? item.category : "general");
      }
    } else if (Array.isArray(document.endpoints)) {
      for (const item of document.endpoints) {
        push(item, isRecord(item) && typeof item.category === "string" ? item.category : "general");
      }
    } else if (Array.isArray(document.routes)) {
      for (const item of document.routes) {
        push(item, isRecord(item) && typeof item.category === "string" ? item.category : "general");
      }
    }
  }

  const seen = new Set<string>();
  const deduped = endpoints.filter((endpoint) => {
    const key = `${endpoint.method}:${endpoint.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { endpoints: deduped, manifestTimestamp, errors };
}

async function tryFetchJson(url: string, timeoutMs: number) {
  const response = await safeFetch(url, {
    timeoutMs,
    maxBytes: 2 * 1024 * 1024,
    onExceed: "truncate",
    maxRedirects: 2,
  });
  if (response.status < 200 || response.status >= 300) {
    return { status: response.status, json: null as unknown };
  }
  try {
    return { status: response.status, json: JSON.parse(response.body.toString("utf8")) as unknown };
  } catch {
    return { status: response.status, json: null as unknown };
  }
}

/**
 * Inspect a provider's public site. Everything here is read-only, rate-limit
 * friendly (a handful of requests) and strictly limited to the provider origin.
 */
export async function inspectProviderSite(options: InspectOptions): Promise<InspectionResult> {
  const sourceUrl = new URL(options.sourceUrl).toString();
  const origin = new URL(sourceUrl).origin;
  const timeoutMs = options.timeoutMs ?? 12_000;
  const attempts: DiscoveryAttempt[] = [];
  const notes: string[] = [];
  let homepageTitle: string | null = null;
  let manifestUrl: string | null = null;
  let openapiUrl: string | null = null;
  let endpoints: DiscoveredEndpoint[] = [];
  const candidatePaths = new Set<string>();

  if (options.manifestPath) candidatePaths.add(options.manifestPath);

  // 1) Homepage inspection
  try {
    const homepage = await safeFetch(origin, {
      timeoutMs,
      maxBytes: 1_500_000,
      onExceed: "truncate",
      maxRedirects: 2,
    });
    attempts.push({
      method: "homepage",
      target: origin,
      outcome: homepage.status >= 200 && homepage.status < 300 ? "success" : "error",
      status: homepage.status,
      detail: `HTTP ${homepage.status}; ${homepage.body.length} bytes`,
    });
    const html = homepage.body.toString("utf8");
    const titleMatch = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
    homepageTitle = titleMatch?.[1]?.trim() ?? null;

    const inlineText = extractScriptText(html);
    for (const path of discoverCandidatePaths(inlineText)) candidatePaths.add(path);

    const scriptUrls = extractScriptSources(html, origin);
    attempts.push({
      method: "javascript_bundles",
      target: `${scriptUrls.length} bundle(s) discovered`,
      outcome: scriptUrls.length ? "success" : "skipped",
      detail: scriptUrls.join(", ").slice(0, 500) || "No same-origin script bundles in the HTML.",
    });

    for (const scriptUrl of scriptUrls.slice(0, 4)) {
      try {
        const bundle = await safeFetch(scriptUrl, {
          timeoutMs,
          maxBytes: 750_000,
          onExceed: "truncate",
          maxRedirects: 1,
        });
        const text = bundle.body.toString("utf8");
        const found = discoverCandidatePaths(text);
        for (const path of found) candidatePaths.add(path);
        attempts.push({
          method: "javascript_bundle_scan",
          target: scriptUrl,
          outcome: bundle.status >= 200 && bundle.status < 300 ? "success" : "error",
          status: bundle.status,
          detail: `HTTP ${bundle.status}; candidate paths: ${found.join(", ") || "none"}`,
        });
      } catch (error) {
        attempts.push({
          method: "javascript_bundle_scan",
          target: scriptUrl,
          outcome: "error",
          detail: error instanceof Error ? error.message : "bundle fetch failed",
        });
      }
    }
  } catch (error) {
    attempts.push({
      method: "homepage",
      target: origin,
      outcome: "error",
      detail: error instanceof Error ? error.message : "homepage fetch failed",
    });
    notes.push(
      "Homepage could not be fetched; continuing with well-known manifest paths recorded in provider configuration.",
    );
  }

  // 2) Probe manifest candidates
  const manifestCandidates = Array.from(
    new Set([...candidatePaths, ...COMMON_MANIFEST_PATHS]),
  ).slice(0, 8);

  let manifestDocument: unknown = null;

  for (const path of manifestCandidates) {
    const target = new URL(path, origin).toString();
    try {
      const result = await tryFetchJson(target, timeoutMs);
      const accepted = result.json !== null && looksLikeEndpointManifest(result.json);
      attempts.push({
        method: "manifest_probe",
        target,
        outcome: accepted ? "success" : result.status >= 200 && result.status < 300 ? "skipped" : "not_found",
        status: result.status,
        detail: accepted ? "Accepted as an endpoint manifest." : `HTTP ${result.status}; not a manifest.`,
      });
      if (accepted) {
        manifestUrl = target;
        manifestDocument = result.json;
        break;
      }
    } catch (error) {
      attempts.push({
        method: "manifest_probe",
        target,
        outcome: "error",
        detail: error instanceof Error ? error.message : "manifest fetch failed",
      });
    }
  }

  // 3) OpenAPI discovery (also used when the manifest itself is a spec)
  if (manifestDocument && looksLikeSpec(manifestDocument)) {
    const parsed = parseOpenApiDocument(manifestDocument, {
      sourceUrl: manifestUrl ?? sourceUrl,
      providerSlug: options.providerSlug,
    });
    endpoints = parsed.endpoints;
    attempts.push({
      method: "manifest_probe",
      target: manifestUrl ?? sourceUrl,
      outcome: "success",
      endpoints: parsed.endpoints.length,
      detail: `Manifest is an OpenAPI ${parsed.version} document.`,
    });
  } else {
    const openapiCandidates = Array.from(
      new Set([...COMMON_OPENAPI_PATHS, ...Array.from(candidatePaths).filter((path) => /openapi|swagger/i.test(path))]),
    ).slice(0, 5);

    for (const path of openapiCandidates) {
      const target = new URL(path, origin).toString();
      try {
        const result = await tryFetchJson(target, timeoutMs);
        if (result.json !== null && looksLikeSpec(result.json)) {
          const parsed = parseOpenApiDocument(result.json, {
            sourceUrl: target,
            providerSlug: options.providerSlug,
          });
          endpoints = [...endpoints, ...parsed.endpoints];
          openapiUrl = target;
          attempts.push({
            method: "openapi_probe",
            target,
            outcome: "success",
            status: result.status,
            endpoints: parsed.endpoints.length,
            detail: `OpenAPI ${parsed.version} document accepted.`,
          });
          break;
        }
        attempts.push({
          method: "openapi_probe",
          target,
          outcome: result.status >= 200 && result.status < 300 ? "skipped" : "not_found",
          status: result.status,
          detail: `HTTP ${result.status}; no OpenAPI document.`,
        });
      } catch (error) {
        attempts.push({
          method: "openapi_probe",
          target,
          outcome: "error",
          detail: error instanceof Error ? error.message : "OpenAPI probe failed",
        });
      }
    }

    if (manifestDocument && isRecord(manifestDocument) && !looksLikeSpec(manifestDocument)) {
      const parsed = parseManifestDocument(manifestDocument, {
        providerSlug: options.providerSlug,
        baseUrl: origin,
        manifestUrl: manifestUrl ?? `${origin}/allEnds`,
        sourceUrl,
      });
      endpoints = [...endpoints, ...parsed.endpoints];
      if (parsed.errors.length) {
        notes.push(`${parsed.errors.length} manifest entries were skipped: ${parsed.errors.slice(0, 5).join("; ")}`);
      }
      attempts.push({
        method: "manifest_parse",
        target: manifestUrl ?? origin,
        outcome: parsed.endpoints.length ? "success" : "error",
        endpoints: parsed.endpoints.length,
        detail: `Parsed ${parsed.endpoints.length} endpoints${
          parsed.manifestTimestamp ? ` (manifest timestamp ${parsed.manifestTimestamp})` : ""
        }.`,
      });
    }
  }

  const deduped = dedupeEndpoints(endpoints);

  notes.unshift(
    `Discovery inspected the homepage, JavaScript bundles, ${manifestCandidates.length} manifest candidate(s) and ${COMMON_OPENAPI_PATHS.length} common OpenAPI locations.`,
  );
  notes.push(
    deduped.length
      ? `${deduped.length} unique endpoints normalized from public sources.`
      : "No publicly accessible endpoint manifest or OpenAPI document was found. Use manual URL import or paste an OpenAPI document.",
  );

  return {
    attempts,
    endpoints: deduped,
    notes: notes.join(" "),
    manifestUrl,
    openapiUrl,
    homepageTitle,
  };
}

function looksLikeSpec(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && (typeof value.openapi === "string" || typeof value.swagger === "string");
}

function dedupeEndpoints(endpoints: DiscoveredEndpoint[]): DiscoveredEndpoint[] {
  const map = new Map<string, DiscoveredEndpoint>();
  for (const endpoint of endpoints) {
    const key = `${endpoint.method}:${endpoint.path}`;
    if (!map.has(key)) map.set(key, endpoint);
  }
  return Array.from(map.values());
}
