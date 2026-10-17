import { createHash } from "node:crypto";
import { titleCase } from "@/lib/utils";
import type { HttpMethod, ParamDef, ParamType } from "@/lib/db/types";

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export function normalizeMethod(value: unknown): HttpMethod | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  return (METHODS as string[]).includes(upper) ? (upper as HttpMethod) : null;
}

export function categoryDisplayName(key: string): string {
  const normalized = key.trim().toLowerCase();
  if (!normalized) return "General";
  const special: Record<string, string> = {
    ai: "AI",
    nsfw: "NSFW",
    "tools-extra": "Extra Tools",
    "extra-tools": "Extra Tools",
    stalk: "Stalk",
    api: "API",
  };
  return special[normalized] ?? titleCase(normalized);
}

export function categorySlugFor(key: string): string {
  const slug = key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  return slug || "general";
}

export function inferParamType(value: unknown): ParamType {
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "boolean") return "boolean";
  return "string";
}

/** Convert a documented example object into parameter definitions. */
export function paramsFromExamples(examples: unknown): ParamDef[] {
  if (!examples || typeof examples !== "object" || Array.isArray(examples)) return [];
  return Object.entries(examples as Record<string, unknown>).map(([name, value]) => ({
    name,
    type: inferParamType(value),
    required: false,
    example: value == null ? "" : String(value),
    description: "Discovered from the provider's public route manifest (example value).",
  }));
}

export function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

export function endpointHash(endpoint: {
  name: string;
  description: string;
  path: string;
  method: string;
  queryParams: ParamDef[];
  categorySlug: string;
  isNsfw: boolean;
}): string {
  return stableHash({
    name: endpoint.name,
    description: endpoint.description,
    path: endpoint.path,
    method: endpoint.method,
    queryParams: endpoint.queryParams,
    categorySlug: endpoint.categorySlug,
    isNsfw: endpoint.isNsfw,
  });
}

export function pathParamsFromPath(path: string): ParamDef[] {
  return Array.from(path.matchAll(/\{([A-Za-z0-9_.-]{1,64})\}/g)).map((match) => ({
    name: match[1],
    type: "string" as const,
    required: true,
    description: "Path parameter declared in the provider's specification.",
  }));
}

export function absoluteEndpointUrl(baseUrl: string, path: string): string {
  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return `${baseUrl.replace(/\/+$/, "")}${path}`;
  }
}

export function categorySortOrder(slug: string): number {
  const order = [
    "ai",
    "search",
    "downloader",
    "anime",
    "stalk",
    "tools",
    "tools-extra",
    "random",
    "images",
    "nsfw",
    "system",
    "general",
  ];
  const index = order.indexOf(slug);
  return index === -1 ? 100 : index;
}
