import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { slugify, titleCase } from "@/lib/utils";
import { categorySortOrder } from "@/lib/discovery/normalize";
import type { CategoryRecord, ProviderRecord } from "@/lib/db/types";

export async function resolveCategory(
  admin: SupabaseClient,
  slug?: string,
  name?: string,
): Promise<CategoryRecord> {
  const targetSlug = (slug ?? (name ? slugify(name) : "general")).slice(0, 63) || "general";
  const targetName = name?.slice(0, 80) ?? titleCase(targetSlug);

  const { data: existing } = await admin
    .from("categories")
    .select("*")
    .eq("slug", targetSlug)
    .maybeSingle();
  if (existing) return existing as CategoryRecord;

  const { data, error } = await admin
    .from("categories")
    .insert({ slug: targetSlug, name: targetName, sort_order: categorySortOrder(targetSlug) })
    .select("*")
    .single();
  if (!error && data) return data as CategoryRecord;

  if (error?.code === "23505") {
    const { data: raced } = await admin
      .from("categories")
      .select("*")
      .eq("slug", targetSlug)
      .maybeSingle();
    if (raced) return raced as CategoryRecord;
  }
  throw new Error(`Unable to resolve category "${targetSlug}": ${error?.message ?? "unknown error"}`);
}

export async function resolveProvider(
  admin: SupabaseClient,
  input: { slug?: string; name?: string; baseUrl: string },
): Promise<ProviderRecord> {
  const hostname = new URL(input.baseUrl).hostname.toLowerCase();
  const origin = new URL(input.baseUrl).origin;

  if (input.slug) {
    const { data } = await admin.from("providers").select("*").eq("slug", input.slug).maybeSingle();
    if (data) return data as ProviderRecord;
  }

  const { data: byHost } = await admin
    .from("providers")
    .select("*")
    .contains("allowed_hosts", [hostname])
    .limit(1)
    .maybeSingle();
  if (byHost) return byHost as ProviderRecord;

  const label = input.name ?? titleCase(hostname.split(".")[0].replace(/^api-/, "")) ?? hostname;
  const baseSlug = slugify(input.slug ?? label) || slugify(hostname);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
    const { data, error } = await admin
      .from("providers")
      .insert({
        slug,
        name: label,
        base_url: origin,
        homepage_url: origin,
        allowed_hosts: [hostname],
        discovery_adapter: "none",
        discovery_config: {},
      })
      .select("*")
      .single();
    if (!error && data) return data as ProviderRecord;
    if (error && error.code !== "23505") {
      throw new Error(`Unable to create provider: ${error.message}`);
    }
  }
  throw new Error("Unable to create a unique provider slug.");
}

export async function uniqueApiSlug(
  admin: SupabaseClient,
  desired: string,
  excludeId?: string,
): Promise<string> {
  const base = slugify(desired).slice(0, 72) || "api";
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const { data } = await admin
      .from("apis")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (!data || data.id === excludeId) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export function buildRequestExample(input: {
  method: string;
  baseUrl: string;
  path: string;
  queryParams: { name: string; example?: string; default?: string; required?: boolean }[];
}) {
  const url = `${input.baseUrl.replace(/\/+$/, "")}${input.path.startsWith("/") ? "" : "/"}${input.path}`;
  const query = Object.fromEntries(
    input.queryParams
      .filter((param) => param.example !== undefined || param.default !== undefined)
      .map((param) => [param.name, param.example ?? param.default ?? ""]),
  );
  return {
    method: input.method,
    url,
    ...(Object.keys(query).length ? { query } : {}),
  };
}
