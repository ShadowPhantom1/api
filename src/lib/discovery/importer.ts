import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { slugify } from "@/lib/utils";
import {
  categorySortOrder,
  endpointHash,
  pathParamsFromPath,
} from "@/lib/discovery/normalize";
import type { DiscoveredEndpoint } from "@/lib/db/types";

export interface ImportProvider {
  id: string;
  slug: string;
  name: string;
  base_url: string | null;
  docs_url: string | null;
}

export interface ImportOptions {
  admin: SupabaseClient;
  provider: ImportProvider;
  endpoints: DiscoveredEndpoint[];
  ownerId: string | null;
  createdBy: string | null;
  isPublic: boolean;
  isManaged: boolean;
  discoverySource: string;
  defaultBaseUrl: string;
}

export interface ImportSummary {
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  ids: string[];
  errors: string[];
}

interface CategoryRow {
  id: string;
  slug: string;
  name: string;
}

async function loadCategories(admin: SupabaseClient): Promise<Map<string, CategoryRow>> {
  const { data, error } = await admin.from("categories").select("id, slug, name");
  if (error) throw new Error(`Unable to load categories: ${error.message}`);
  return new Map((data ?? []).map((row) => [row.slug as string, row as CategoryRow]));
}

async function ensureCategory(
  admin: SupabaseClient,
  cache: Map<string, CategoryRow>,
  slug: string,
  name: string,
): Promise<CategoryRow | null> {
  const existing = cache.get(slug);
  if (existing) return existing;
  const { data, error } = await admin
    .from("categories")
    .insert({ slug, name, sort_order: categorySortOrder(slug) })
    .select("id, slug, name")
    .single();
  if (error) {
    if (error.code === "23505") {
      const { data: raced } = await admin
        .from("categories")
        .select("id, slug, name")
        .eq("slug", slug)
        .maybeSingle();
      if (raced) {
        cache.set(slug, raced as CategoryRow);
        return raced as CategoryRow;
      }
    }
    return null;
  }
  const row = data as CategoryRow;
  cache.set(slug, row);
  return row;
}

async function loadExistingSlugs(admin: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await admin.from("apis").select("slug");
  if (error) throw new Error(`Unable to load existing API slugs: ${error.message}`);
  return new Set((data ?? []).map((row) => row.slug as string));
}

function uniqueSlug(base: string, taken: Set<string>): string {
  let candidate = base.slice(0, 76) || "api";
  if (!taken.has(candidate)) {
    taken.add(candidate);
    return candidate;
  }
  for (let i = 2; i < 500; i += 1) {
    const next = `${candidate.slice(0, 72)}-${i}`;
    if (!taken.has(next)) {
      taken.add(next);
      return next;
    }
  }
  const fallback = `${candidate.slice(0, 60)}-${Date.now().toString(36)}`;
  taken.add(fallback);
  return fallback;
}

function sourceKeyFor(endpoint: DiscoveredEndpoint, ownerId: string | null, isManaged: boolean): string {
  return isManaged || !ownerId
    ? endpoint.sourceKey
    : `user:${ownerId}:${endpoint.sourceKey}`;
}

export async function importDiscoveredEndpoints(options: ImportOptions): Promise<ImportSummary> {
  const {
    admin,
    provider,
    endpoints,
    ownerId,
    createdBy,
    isPublic,
    isManaged,
    discoverySource,
    defaultBaseUrl,
  } = options;

  const summary: ImportSummary = {
    created: 0,
    updated: 0,
    unchanged: 0,
    failed: 0,
    ids: [],
    errors: [],
  };

  const categoryCache = await loadCategories(admin);
  const takenSlugs = await loadExistingSlugs(admin);
  const keyed = endpoints.map((endpoint) => ({
    endpoint,
    sourceKey: sourceKeyFor(endpoint, ownerId, isManaged),
  }));

  const existingByKey = new Map<string, Record<string, unknown>>();
  const chunks: string[][] = [];
  const keys = keyed.map((entry) => entry.sourceKey);
  for (let i = 0; i < keys.length; i += 100) chunks.push(keys.slice(i, i + 100));

  for (const chunk of chunks) {
    const { data, error } = await admin.from("apis").select("*").in("source_key", chunk);
    if (error) {
      summary.errors.push(`Existing API lookup failed: ${error.message}`);
      continue;
    }
    for (const row of data ?? []) {
      if (row.source_key) existingByKey.set(row.source_key as string, row as Record<string, unknown>);
    }
  }

  for (const { endpoint, sourceKey } of keyed) {
    const category = await ensureCategory(
      admin,
      categoryCache,
      endpoint.categorySlug,
      endpoint.categoryName,
    );
    if (!category) {
      summary.failed += 1;
      summary.errors.push(`Could not create category "${endpoint.categorySlug}" for ${endpoint.name}.`);
      continue;
    }

    const pathParams = endpoint.pathParams.length
      ? endpoint.pathParams
      : pathParamsFromPath(endpoint.path);
    const baseUrl = (endpoint.baseUrl ?? provider.base_url ?? defaultBaseUrl).replace(/\/+$/, "");
    const hash = endpointHash(endpoint);
    const metadata = {
      ...endpoint.metadata,
      hash,
      category_key: endpoint.categorySlug,
      example_params: endpoint.metadata.example_params ?? null,
    };

    const existing = existingByKey.get(sourceKey);
    if (existing) {
      const existingHash =
        existing.discovery_metadata &&
        typeof existing.discovery_metadata === "object" &&
        (existing.discovery_metadata as Record<string, unknown>).hash;
      const existingOwnedByUser = existing.owner_id === ownerId;
      const canUpdate = isManaged ? existing.is_managed === true : existingOwnedByUser;

      if (!canUpdate || existingHash === hash) {
        summary.unchanged += 1;
        summary.ids.push(existing.id as string);
        continue;
      }

      const credentialConfigured = Boolean(existing.auth_config_encrypted);
      const update: Record<string, unknown> = {
        provider_id: provider.id,
        category_id: category.id,
        name: endpoint.name,
        description: endpoint.description,
        base_url: baseUrl,
        path: endpoint.path,
        method: endpoint.method,
        query_params: endpoint.queryParams,
        path_params: pathParams,
        headers_schema: endpoint.headersSchema,
        body_schema: endpoint.bodySchema,
        content_type: endpoint.contentType,
        request_example: endpoint.requestExample,
        response_example: endpoint.responseExample,
        docs_url: provider.docs_url,
        source_url: endpoint.sourceUrl,
        discovery_metadata: metadata,
        is_nsfw: endpoint.isNsfw,
        supports_streaming: endpoint.supportsStreaming,
        updated_at: new Date().toISOString(),
      };
      if (!credentialConfigured) {
        update.auth_type = endpoint.authType;
        update.auth_config_meta = endpoint.authMeta;
      }

      const { error } = await admin.from("apis").update(update).eq("id", existing.id as string);
      if (error) {
        summary.failed += 1;
        summary.errors.push(`Update failed for ${endpoint.name}: ${error.message}`);
      } else {
        summary.updated += 1;
        summary.ids.push(existing.id as string);
      }
      continue;
    }

    const slug = uniqueSlug(slugify(endpoint.name), takenSlugs);
    const isNewPublic = isManaged ? true : isPublic;

    const { data, error } = await admin
      .from("apis")
      .insert({
        owner_id: ownerId,
        provider_id: provider.id,
        category_id: category.id,
        slug,
        name: endpoint.name,
        description: endpoint.description,
        base_url: baseUrl,
        path: endpoint.path,
        method: endpoint.method,
        query_params: endpoint.queryParams,
        path_params: pathParams,
        headers_schema: endpoint.headersSchema,
        body_schema: endpoint.bodySchema,
        auth_type: endpoint.authType,
        auth_config_meta: endpoint.authMeta,
        content_type: endpoint.contentType,
        request_example: endpoint.requestExample,
        response_example: endpoint.responseExample,
        docs_url: provider.docs_url,
        source_url: endpoint.sourceUrl,
        discovery_source: discoverySource,
        discovery_metadata: metadata,
        verification_status: "unverified",
        is_public: isNewPublic,
        is_enabled: true,
        is_nsfw: endpoint.isNsfw,
        is_managed: isManaged,
        supports_streaming: endpoint.supportsStreaming,
        timeout_ms: 15000,
        source_key: sourceKey,
        created_by: createdBy,
      })
      .select("id")
      .single();

    if (error) {
      summary.failed += 1;
      summary.errors.push(`Insert failed for ${endpoint.name}: ${error.message}`);
    } else {
      summary.created += 1;
      summary.ids.push(data.id as string);
      existingByKey.set(sourceKey, { id: data.id, discovery_metadata: metadata, owner_id: ownerId });
    }
  }

  return summary;
}
