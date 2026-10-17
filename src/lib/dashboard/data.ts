import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSessionUser } from "@/lib/api/auth";
import {
  API_RELATION_SELECT,
  serializeApi,
  type ApiRowWithRelations,
} from "@/lib/api/serialize";
import type {
  AiModelRecord,
  ApiRecord,
  CategoryRecord,
  PlatformKeyRecord,
  ProviderRecord,
  SafeApi,
} from "@/lib/db/types";
import type { Caller } from "@/lib/api/auth";

export async function requireUser() {
  const admin = createAdminClient();
  const session = await requireSessionUser(admin);
  if (!session) redirect("/login");
  const caller: Caller = {
    userId: session.user.id,
    isAdmin: session.isAdmin,
    authMethod: "session",
    platformKeyId: null,
    rateLimitPerMinute: 120,
  };
  return { admin, user: session.user, isAdmin: session.isAdmin, caller };
}

export interface ProfileRow {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string;
  created_at: string;
}

export async function getProfile(admin: SupabaseClient, userId: string): Promise<ProfileRow | null> {
  const { data } = await admin
    .from("profiles")
    .select("id, email, display_name, role, created_at")
    .eq("id", userId)
    .maybeSingle();
  return (data as ProfileRow | null) ?? null;
}

export interface ApiListOptions {
  scope: "public" | "mine" | "all";
  q?: string;
  category?: string;
  page?: number;
  perPage?: number;
  includeNsfw?: boolean;
}

export interface ApiListResult {
  items: SafeApi[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export async function listApis(
  admin: SupabaseClient,
  caller: Caller,
  options: ApiListOptions,
): Promise<ApiListResult> {
  const page = Math.max(1, options.page ?? 1);
  const perPage = Math.min(100, Math.max(1, options.perPage ?? 24));
  const from = (page - 1) * perPage;

  let query = admin
    .from("apis")
    .select(API_RELATION_SELECT, { count: "exact" })
    .order("updated_at", { ascending: false });

  if (options.scope === "public") {
    query = query.eq("is_public", true).eq("is_enabled", true);
    if (!options.includeNsfw) query = query.eq("is_nsfw", false);
  } else if (options.scope === "mine") {
    query = query.eq("owner_id", caller.userId);
  } else if (!caller.isAdmin) {
    throw new Error("Administrator access is required for this view.");
  }

  if (options.category) {
    const { data: category } = await admin
      .from("categories")
      .select("id")
      .eq("slug", options.category)
      .maybeSingle();
    if (category?.id) query = query.eq("category_id", category.id);
  }

  const q = options.q?.trim();
  if (q) {
    const escaped = q.replace(/[%_,()]/g, " ").slice(0, 120);
    query = query.or(`name.ilike.%${escaped}%,description.ilike.%${escaped}%,path.ilike.%${escaped}%`);
  }

  const { data, error, count } = await query.range(from, from + perPage - 1);
  if (error) throw new Error(error.message);

  return {
    items: ((data ?? []) as ApiRowWithRelations[]).map(serializeApi),
    total: count ?? 0,
    page,
    perPage,
    totalPages: count ? Math.max(1, Math.ceil(count / perPage)) : 0,
  };
}

export async function getApiForViewer(
  admin: SupabaseClient,
  caller: Caller,
  slug: string,
): Promise<SafeApi | null> {
  const { data } = await admin
    .from("apis")
    .select(API_RELATION_SELECT)
    .eq("slug", slug)
    .maybeSingle();
  if (!data) return null;
  const api = data as ApiRowWithRelations;
  const permitted =
    (api.is_public && api.is_enabled) || api.owner_id === caller.userId || caller.isAdmin;
  if (!permitted) return null;
  return serializeApi(api);
}

export async function getApiRecordForViewer(
  admin: SupabaseClient,
  caller: Caller,
  slug: string,
): Promise<ApiRecord | null> {
  const { data } = await admin.from("apis").select("*").eq("slug", slug).maybeSingle();
  if (!data) return null;
  const api = data as ApiRecord;
  const permitted =
    (api.is_public && api.is_enabled) || api.owner_id === caller.userId || caller.isAdmin;
  return permitted ? api : null;
}

export interface CategoryWithCounts extends CategoryRecord {
  api_count: number;
  verified_count: number;
  nsfw_count: number;
}

export async function getCategoriesWithCounts(
  admin: SupabaseClient,
  options: { includeNsfw?: boolean } = {},
): Promise<CategoryWithCounts[]> {
  const { data: categories } = await admin
    .from("categories")
    .select("*")
    .order("sort_order", { ascending: true });
  const { data: apis } = await admin
    .from("apis")
    .select("category_id, verification_status, is_nsfw")
    .eq("is_public", true)
    .eq("is_enabled", true);

  const counts = new Map<string, { total: number; verified: number; nsfw: number }>();
  for (const api of (apis ?? []) as Array<Pick<ApiRecord, "category_id" | "verification_status" | "is_nsfw">>) {
    if (!api.category_id) continue;
    if (api.is_nsfw && !options.includeNsfw) continue;
    const current = counts.get(api.category_id) ?? { total: 0, verified: 0, nsfw: 0 };
    current.total += 1;
    if (api.verification_status === "verified") current.verified += 1;
    if (api.is_nsfw) current.nsfw += 1;
    counts.set(api.category_id, current);
  }

  return ((categories ?? []) as CategoryRecord[]).map((category) => {
    const counted = counts.get(category.id) ?? { total: 0, verified: 0, nsfw: 0 };
    return {
      ...category,
      api_count: counted.total,
      verified_count: counted.verified,
      nsfw_count: counted.nsfw,
    };
  });
}

export interface ProviderWithCounts extends ProviderRecord {
  api_count: number;
  verified_count: number;
}

export async function getProvidersWithCounts(admin: SupabaseClient): Promise<ProviderWithCounts[]> {
  const [{ data: providers }, { data: apis }] = await Promise.all([
    admin.from("providers").select("*").order("name", { ascending: true }),
    admin
      .from("apis")
      .select("provider_id, verification_status")
      .eq("is_public", true)
      .eq("is_enabled", true)
      .eq("is_nsfw", false),
  ]);

  const counts = new Map<string, { total: number; verified: number }>();
  for (const api of (apis ?? []) as Array<Pick<ApiRecord, "provider_id" | "verification_status">>) {
    if (!api.provider_id) continue;
    const current = counts.get(api.provider_id) ?? { total: 0, verified: 0 };
    current.total += 1;
    if (api.verification_status === "verified") current.verified += 1;
    counts.set(api.provider_id, current);
  }

  return ((providers ?? []) as ProviderRecord[]).map((provider) => {
    const counted = counts.get(provider.id) ?? { total: 0, verified: 0 };
    return { ...provider, api_count: counted.total, verified_count: counted.verified };
  });
}

export async function getModelsForViewer(
  admin: SupabaseClient,
  caller: Caller,
): Promise<AiModelRecord[]> {
  let query = admin.from("ai_models").select("*").order("created_at", { ascending: true });
  if (!caller.isAdmin) {
    query = query.or(
      `owner_id.eq.${caller.userId},and(is_public.eq.true,is_enabled.eq.true)`,
    );
  }
  const { data } = await query;
  return (data ?? []) as AiModelRecord[];
}

export async function getKeysForUser(
  admin: SupabaseClient,
  userId: string,
): Promise<PlatformKeyRecord[]> {
  const { data } = await admin
    .from("platform_api_keys")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  return (data ?? []) as PlatformKeyRecord[];
}

export async function getCategoryOptions(admin: SupabaseClient) {
  const { data } = await admin
    .from("categories")
    .select("slug, name")
    .order("sort_order", { ascending: true });
  return (data ?? []) as Array<{ slug: string; name: string }>;
}

export async function getApiOptions(admin: SupabaseClient, caller: Caller) {
  const { data } = await admin
    .from("apis")
    .select("id, slug, name, method, is_public, is_enabled, owner_id")
    .or(`owner_id.eq.${caller.userId},and(is_public.eq.true,is_enabled.eq.true)`)
    .order("name", { ascending: true })
    .limit(200);
  return (data ?? []) as Array<{
    id: string;
    slug: string;
    name: string;
    method: string;
    is_public: boolean;
    is_enabled: boolean;
    owner_id: string | null;
  }>;
}

export interface RecentRequestRow {
  id: number;
  kind: string;
  method: string | null;
  status_code: number | null;
  duration_ms: number | null;
  response_bytes: number | null;
  ok: boolean;
  error_code: string | null;
  created_at: string;
  api: { name: string; slug: string } | null;
  model: { name: string; slug: string } | null;
}

export interface OverviewData {
  stats: {
    publicEndpoints: number;
    verifiedEndpoints: number;
    myEndpoints: number;
    activeKeys: number;
    requests24h: number;
    requests7d: number;
    errors7d: number;
    avgDuration7dMs: number | null;
  };
  recentRequests: RecentRequestRow[];
  recentDiscoveries: Array<{
    id: string;
    status: string;
    adapter: string;
    source_url: string;
    created_count: number;
    updated_count: number;
    started_at: string;
  }>;
}

export async function getOverviewData(
  admin: SupabaseClient,
  caller: Caller,
): Promise<OverviewData> {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    publicCount,
    verifiedCount,
    myCount,
    keysCount,
    requests24h,
    weekRows,
    recentRequests,
    recentDiscoveries,
  ] = await Promise.all([
    admin
      .from("apis")
      .select("id", { count: "exact", head: true })
      .eq("is_public", true)
      .eq("is_enabled", true)
      .eq("is_nsfw", false),
    admin
      .from("apis")
      .select("id", { count: "exact", head: true })
      .eq("is_public", true)
      .eq("is_enabled", true)
      .eq("verification_status", "verified")
      .eq("is_nsfw", false),
    admin.from("apis").select("id", { count: "exact", head: true }).eq("owner_id", caller.userId),
    admin
      .from("platform_api_keys")
      .select("id", { count: "exact", head: true })
      .eq("user_id", caller.userId)
      .is("revoked_at", null),
    admin
      .from("api_requests")
      .select("id", { count: "exact", head: true })
      .eq("user_id", caller.userId)
      .gte("created_at", dayAgo),
    admin
      .from("api_requests")
      .select("ok, duration_ms")
      .eq("user_id", caller.userId)
      .gte("created_at", weekAgo)
      .limit(2000),
    admin
      .from("api_requests")
      .select(
        "id, kind, method, status_code, duration_ms, response_bytes, ok, error_code, created_at, api:apis(name, slug), model:ai_models(name, slug)",
      )
      .eq("user_id", caller.userId)
      .order("created_at", { ascending: false })
      .limit(8),
    caller.isAdmin
      ? admin
          .from("discovery_runs")
          .select("id, status, adapter, source_url, created_count, updated_count, started_at")
          .order("started_at", { ascending: false })
          .limit(4)
      : Promise.resolve({ data: [] as OverviewData["recentDiscoveries"] }),
  ]);

  const rows = (weekRows.data ?? []) as Array<{ ok: boolean; duration_ms: number | null }>;
  const durations = rows
    .map((row) => row.duration_ms)
    .filter((value): value is number => typeof value === "number");

  return {
    stats: {
      publicEndpoints: publicCount.count ?? 0,
      verifiedEndpoints: verifiedCount.count ?? 0,
      myEndpoints: myCount.count ?? 0,
      activeKeys: keysCount.count ?? 0,
      requests24h: requests24h.count ?? 0,
      requests7d: rows.length,
      errors7d: rows.filter((row) => !row.ok).length,
      avgDuration7dMs: durations.length
        ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
        : null,
    },
    recentRequests: (recentRequests.data ?? []) as unknown as RecentRequestRow[],
    recentDiscoveries: (recentDiscoveries.data ?? []) as OverviewData["recentDiscoveries"],
  };
}

export function canManageApi(
  api: { owner_id: string | null } & Record<string, unknown>,
  caller: Caller,
): boolean {
  return api.owner_id === caller.userId || caller.isAdmin;
}
