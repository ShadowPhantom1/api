/**
 * Seed the Anvex registry from the captured Rebix catalog fixture.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY and network access to the Supabase
 * project. In sandboxes without egress, use `npm run seed:sql` and run the
 * generated SQL in the Supabase SQL editor instead.
 *
 * The script is idempotent: provider/categories are upserted, APIs are inserted
 * on their unique source_key with duplicates ignored so manual edits and
 * verification results are never clobbered.
 */
import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: [".env.local", ".env"], quiet: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.argv.includes("--dry-run");

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. See SETUP.md.");
  process.exit(1);
}

interface FixtureEndpoint {
  name: string;
  slug: string;
  path: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  description: string;
  category_slug: string;
  query_params: Array<{
    name: string;
    type?: string;
    required?: boolean;
    example?: string;
    description?: string;
  }>;
  is_nsfw: boolean;
  source_key: string;
  source_url: string;
  request_example: Record<string, unknown> | null;
  example_params: Record<string, string>;
  verification_status: "unverified" | "verified" | "failed";
  last_error: string | null;
  response_example: unknown;
}

const fixturePath = join(process.cwd(), "tests/fixtures/rebix-normalized.json");
const endpoints = JSON.parse(readFileSync(fixturePath, "utf8")) as FixtureEndpoint[];

const MANIFEST_TIMESTAMP = "2026-10-17T16:39:11.102Z";
const MANIFEST_URL = "https://api-rebix.zone.id/allEnds";
const BASE_URL = "https://api-rebix.zone.id";

const CATEGORY_NAMES: Record<string, string> = {
  ai: "AI",
  downloader: "Downloaders",
  search: "Search",
  anime: "Anime",
  stalk: "Stalk",
  tools: "Tools",
  "tools-extra": "Extra Tools",
  random: "Random",
  images: "Images",
  nsfw: "NSFW",
  system: "System",
  general: "General",
};

const categorySlugs = [...new Set(endpoints.map((endpoint) => endpoint.category_slug))];

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log(`Seeding ${endpoints.length} endpoints from ${fixturePath}${dryRun ? " (dry run)" : ""}`);

  if (dryRun) {
    const counts = new Map<string, number>();
    for (const endpoint of endpoints) {
      counts.set(endpoint.category_slug, (counts.get(endpoint.category_slug) ?? 0) + 1);
    }
    console.log("Provider: rebix");
    console.log("Categories:", categorySlugs.join(", "));
    console.log("Endpoints by category:", Object.fromEntries(counts));
    console.log("Models: rebix-claude-haiku, rebix-gemini, rebix-deepseek-v3 (disabled)");
    return;
  }

  const provider = await admin
    .from("providers")
    .upsert(
      {
        slug: "rebix",
        name: "Rebix API",
        description:
          "Public multi-purpose API provider discovered at api-rebix.zone.id. Catalog imported from its public /allEnds manifest.",
        homepage_url: "https://api-rebix.zone.id/",
        base_url: BASE_URL,
        docs_url: "https://api-rebix.zone.id/",
        allowed_hosts: ["api-rebix.zone.id"],
        discovery_adapter: "rebix_manifest",
        discovery_config: { manifest_path: "/allEnds" },
      },
      { onConflict: "slug" },
    )
    .select("id, slug")
    .single();
  if (provider.error) throw new Error(`Provider upsert failed: ${provider.error.message}`);

  const categoryRows = categorySlugs.map((slug, index) => ({
    slug,
    name: CATEGORY_NAMES[slug] ?? slug,
    description:
      slug === "stalk"
        ? "No publicly documented routes existed at discovery time."
        : `Rebix ${CATEGORY_NAMES[slug] ?? slug} endpoints.`,
    sort_order: index,
  }));
  const categories = await admin
    .from("categories")
    .upsert(categoryRows, { onConflict: "slug" })
    .select("id, slug");
  if (categories.error) throw new Error(`Category upsert failed: ${categories.error.message}`);
  const categoryIds = new Map((categories.data ?? []).map((row) => [row.slug, row.id]));

  const apiRows = endpoints.map((endpoint) => ({
    owner_id: null,
    provider_id: provider.data.id,
    category_id: categoryIds.get(endpoint.category_slug) ?? null,
    slug: endpoint.slug,
    name: endpoint.name,
    description: endpoint.description,
    base_url: BASE_URL,
    path: endpoint.path,
    method: endpoint.method,
    query_params: endpoint.query_params,
    path_params: [],
    headers_schema: [],
    body_schema: null,
    auth_type: "none",
    auth_config_encrypted: null,
    auth_config_meta: {},
    content_type: "application/json",
    request_example: endpoint.request_example,
    response_example: endpoint.response_example,
    docs_url: "https://api-rebix.zone.id/",
    source_url: endpoint.source_url,
    discovery_source: "rebix_manifest",
    discovery_metadata: {
      discovery: "rebix_manifest",
      manifest_url: MANIFEST_URL,
      manifest_category: endpoint.category_slug,
      category_key: endpoint.category_slug,
      example_params: endpoint.example_params,
      manifest_timestamp: MANIFEST_TIMESTAMP,
      discovered_at: MANIFEST_TIMESTAMP,
    },
    verification_status: endpoint.verification_status,
    last_status_code: endpoint.verification_status === "unverified" ? null : 200,
    last_tested_at: endpoint.verification_status === "unverified" ? null : new Date().toISOString(),
    last_error: endpoint.last_error,
    is_public: true,
    is_enabled: true,
    is_nsfw: endpoint.is_nsfw,
    is_managed: true,
    allow_extra_query: false,
    supports_streaming: false,
    timeout_ms: 15000,
    source_key: endpoint.source_key,
    created_by: null,
  }));

  let inserted = 0;
  for (let index = 0; index < apiRows.length; index += 25) {
    const chunk = apiRows.slice(index, index + 25);
    const result = await admin
      .from("apis")
      .upsert(chunk, { onConflict: "source_key", ignoreDuplicates: true })
      .select("id");
    if (result.error) throw new Error(`API seed failed: ${result.error.message}`);
    inserted += result.data?.length ?? 0;
  }

  const apis = await admin.from("apis").select("id, slug");
  const apiBySlug = new Map((apis.data ?? []).map((row) => [row.slug, row.id]));

  const modelRows = [
    {
      owner_id: null,
      provider_id: provider.data.id,
      api_id: apiBySlug.get("claude-haiku") ?? null,
      slug: "rebix-claude-haiku",
      name: "Claude Haiku 4.5 via Rebix",
      description:
        "Maps OpenAI chat messages onto the documented Rebix GET /api/claude-haiku?q= endpoint. Rebix is not an OpenAI-compatible upstream: streaming, tool calling and token usage reporting are unavailable.",
      adapter: "rebix_text",
      base_url: null,
      chat_path: "/chat/completions",
      upstream_model: null,
      auth_type: "none",
      auth_config_meta: {},
      config: {
        query_param: "q",
        response_paths: ["response", "message", "result", "reply", "answer"],
      },
      capabilities: { chat: true, streaming: false, tools: false, usage: false },
      is_public: true,
      is_enabled: true,
    },
    {
      owner_id: null,
      provider_id: provider.data.id,
      api_id: apiBySlug.get("gemini") ?? null,
      slug: "rebix-gemini",
      name: "Gemini via Rebix",
      description:
        "Maps OpenAI chat messages onto the documented Rebix GET /api/gemini?q= endpoint. Not an OpenAI-compatible upstream; no streaming, tools or usage reporting.",
      adapter: "rebix_text",
      base_url: null,
      chat_path: "/chat/completions",
      upstream_model: null,
      auth_type: "none",
      auth_config_meta: {},
      config: {
        query_param: "q",
        response_paths: ["message", "response", "result", "reply", "answer"],
      },
      capabilities: { chat: true, streaming: false, tools: false, usage: false },
      is_public: true,
      is_enabled: true,
    },
    {
      owner_id: null,
      provider_id: provider.data.id,
      api_id: apiBySlug.get("deepseek-v3") ?? null,
      slug: "rebix-deepseek-v3",
      name: "DeepSeek V3 via Rebix (disabled)",
      description:
        'Disabled on purpose: at discovery time the provider returned HTTP 422 ("The selected messages.0.role is invalid") for this route. It is registered so the failure is documented, not hidden, and can be enabled after the provider fixes it.',
      adapter: "rebix_text",
      base_url: null,
      chat_path: "/chat/completions",
      upstream_model: null,
      auth_type: "none",
      auth_config_meta: {},
      config: {
        query_param: "q",
        response_paths: ["message", "response", "result", "reply", "answer"],
      },
      capabilities: { chat: true, streaming: false, tools: false, usage: false },
      is_public: true,
      is_enabled: false,
    },
  ];
  const models = await admin
    .from("ai_models")
    .upsert(modelRows, { onConflict: "slug", ignoreDuplicates: true })
    .select("slug");
  if (models.error) throw new Error(`Model seed failed: ${models.error.message}`);

  const existingRun = await admin
    .from("discovery_runs")
    .select("id")
    .eq("source_url", "https://api-rebix.zone.id/")
    .maybeSingle();
  if (!existingRun.data) {
    const run = await admin.from("discovery_runs").insert({
      user_id: null,
      provider_id: provider.data.id,
      adapter: "rebix_manifest",
      source_url: "https://api-rebix.zone.id/",
      status: "success",
      attempted_methods: [
        { method: "homepage", target: "https://api-rebix.zone.id/", outcome: "success", status: 200 },
        {
          method: "javascript_bundle_scan",
          target: "https://api-rebix.zone.id/script.js",
          outcome: "success",
          status: 200,
          detail: "Bundle fetches /allEnds and renders tables from it.",
        },
        {
          method: "manifest_probe",
          target: MANIFEST_URL,
          outcome: "success",
          status: 200,
          endpoints: endpoints.length,
        },
        { method: "openapi_probe", target: "https://api-rebix.zone.id/openapi.json", outcome: "not_found", status: 404 },
        { method: "openapi_probe", target: "https://api-rebix.zone.id/swagger.json", outcome: "not_found", status: 404 },
      ],
      notes:
        "Seeded from a captured live discovery run. Verification reflects real requests: 7 verified, 2 failed with upstream 422, 46 unverified.",
      created_count: endpoints.length,
      updated_count: 0,
      unchanged_count: 0,
      failed_count: 0,
      endpoint_ids: (apis.data ?? []).map((row) => row.id),
      started_at: MANIFEST_TIMESTAMP,
      finished_at: new Date().toISOString(),
    });
    if (run.error) throw new Error(`Discovery run seed failed: ${run.error.message}`);
  }

  console.log(
    `Done. Inserted ${inserted} new endpoints (existing rows left untouched), ${categorySlugs.length} categories, ${modelRows.length} model aliases.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
