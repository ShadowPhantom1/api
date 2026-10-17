import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { slugify, titleCase } from "@/lib/utils";
import { inspectProviderSite, type InspectionResult } from "@/lib/discovery/rebix";
import { importDiscoveredEndpoints, type ImportSummary } from "@/lib/discovery/importer";
import type { DiscoveryRunRecord, ProviderRecord } from "@/lib/db/types";

export interface RunDiscoveryOptions {
  admin: SupabaseClient;
  userId: string;
  sourceUrl?: string;
  providerId?: string;
  providerSlug?: string;
  adapter: "auto" | "rebix_manifest" | "json_manifest" | "openapi";
  manifestPath?: string;
}

export interface RunDiscoveryResult {
  provider: ProviderRecord;
  run: DiscoveryRunRecord;
  inspection: InspectionResult;
  summary: ImportSummary;
}

async function findOrCreateProvider(
  admin: SupabaseClient,
  options: RunDiscoveryOptions,
  sourceUrl: string,
): Promise<ProviderRecord> {
  if (options.providerId) {
    const { data, error } = await admin.from("providers").select("*").eq("id", options.providerId).maybeSingle();
    if (error) throw new Error(`Provider lookup failed: ${error.message}`);
    if (!data) throw new Error("Provider not found.");
    return data as ProviderRecord;
  }
  if (options.providerSlug) {
    const { data, error } = await admin
      .from("providers")
      .select("*")
      .eq("slug", options.providerSlug)
      .maybeSingle();
    if (error) throw new Error(`Provider lookup failed: ${error.message}`);
    if (!data) throw new Error(`Provider "${options.providerSlug}" not found.`);
    return data as ProviderRecord;
  }

  const origin = new URL(sourceUrl).origin;
  const hostname = new URL(origin).hostname;
  const { data: byBase } = await admin
    .from("providers")
    .select("*")
    .eq("base_url", origin)
    .maybeSingle();
  if (byBase) return byBase as ProviderRecord;

  const label = hostname.split(".")[0].replace(/^api-/, "");
  const baseSlug = slugify(label) || slugify(hostname);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
    const { data, error } = await admin
      .from("providers")
      .insert({
        slug,
        name: titleCase(label) || hostname,
        base_url: origin,
        homepage_url: origin,
        allowed_hosts: [hostname],
        discovery_adapter: options.adapter === "auto" ? "rebix_manifest" : options.adapter,
        discovery_config: { manifest_path: options.manifestPath ?? "/allEnds" },
      })
      .select("*")
      .single();
    if (!error && data) return data as ProviderRecord;
    if (error && error.code !== "23505") throw new Error(`Unable to create provider: ${error.message}`);
  }
  throw new Error("Unable to create a unique provider slug.");
}

export async function runProviderDiscovery(options: RunDiscoveryOptions): Promise<RunDiscoveryResult> {
  const { admin } = options;
  const provider = await findOrCreateProvider(admin, options, options.sourceUrl ?? "https://example.com");
  const sourceUrl = options.sourceUrl ?? provider.base_url ?? provider.homepage_url;
  if (!sourceUrl) {
    throw new Error("A source URL or provider base URL is required.");
  }

  const manifestPath =
    options.manifestPath ??
    (typeof provider.discovery_config?.manifest_path === "string"
      ? provider.discovery_config.manifest_path
      : undefined);

  const { data: runRow, error: runError } = await admin
    .from("discovery_runs")
    .insert({
      user_id: options.userId,
      provider_id: provider.id,
      adapter: options.adapter === "auto" ? provider.discovery_adapter : options.adapter,
      source_url: sourceUrl,
      status: "running",
      attempted_methods: [],
    })
    .select("*")
    .single();

  if (runError || !runRow) {
    throw new Error(`Unable to start discovery run: ${runError?.message ?? "unknown error"}`);
  }

  try {
    const inspection = await inspectProviderSite({
      sourceUrl,
      providerSlug: provider.slug,
      manifestPath,
      adapter: options.adapter,
    });

    const summary = await importDiscoveredEndpoints({
      admin,
      provider,
      endpoints: inspection.endpoints,
      ownerId: null,
      createdBy: options.userId,
      isPublic: true,
      isManaged: true,
      discoverySource: provider.discovery_adapter === "none" ? "manifest" : provider.discovery_adapter,
      defaultBaseUrl: sourceUrl,
    });

    const status =
      inspection.endpoints.length === 0
        ? "failed"
        : summary.failed > 0
          ? "partial"
          : "success";

    const notes = [
      inspection.notes,
      inspection.manifestUrl ? `Manifest: ${inspection.manifestUrl}.` : "No manifest accepted.",
      inspection.openapiUrl ? `OpenAPI: ${inspection.openapiUrl}.` : "No OpenAPI document found.",
      summary.errors.length ? `${summary.errors.length} import issue(s).` : null,
    ]
      .filter(Boolean)
      .join(" ");

    const { data: updatedRun, error: updateError } = await admin
      .from("discovery_runs")
      .update({
        status,
        attempted_methods: inspection.attempts,
        notes,
        created_count: summary.created,
        updated_count: summary.updated,
        unchanged_count: summary.unchanged,
        failed_count: summary.failed,
        endpoint_ids: summary.ids,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runRow.id)
      .select("*")
      .single();

    if (updateError) console.error("[discovery] run update failed:", updateError.message);

    if (manifestPath && provider.discovery_config?.manifest_path !== manifestPath) {
      await admin
        .from("providers")
        .update({ discovery_config: { ...provider.discovery_config, manifest_path: manifestPath } })
        .eq("id", provider.id);
    }

    return {
      provider,
      run: (updatedRun ?? { ...runRow, status, attempted_methods: inspection.attempts, notes }) as DiscoveryRunRecord,
      inspection,
      summary,
    };
  } catch (error) {
    await admin
      .from("discovery_runs")
      .update({
        status: "failed",
        notes: error instanceof Error ? error.message.slice(0, 1000) : "Discovery failed.",
        finished_at: new Date().toISOString(),
      })
      .eq("id", runRow.id);
    throw error;
  }
}
