import type {
  AiModelRecord,
  ApiRecord,
  CategorySummary,
  PlatformKeyRecord,
  ProviderSummary,
  SafeAiModel,
  SafeApi,
} from "@/lib/db/types";

export interface ApiRowWithRelations extends ApiRecord {
  category?: { slug: string; name: string; icon: string | null } | null;
  provider?: { slug: string; name: string; homepage_url: string | null } | null;
}

export function serializeApi(row: ApiRowWithRelations): SafeApi {
  const { auth_config_encrypted, category, provider, ...rest } = row;
  const categorySummary: CategorySummary | null = category
    ? { slug: category.slug, name: category.name, icon: category.icon }
    : null;
  const providerSummary: ProviderSummary | null = provider
    ? { slug: provider.slug, name: provider.name, homepage_url: provider.homepage_url }
    : null;

  return {
    ...rest,
    credential_configured: Boolean(auth_config_encrypted),
    category: categorySummary,
    provider: providerSummary,
  };
}

export function serializeAiModel(row: AiModelRecord): SafeAiModel {
  const { auth_config_encrypted, ...rest } = row;
  return { ...rest, credential_configured: Boolean(auth_config_encrypted) };
}

export function serializePlatformKey(row: PlatformKeyRecord) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    lastFour: row.last_four,
    permissions: row.permissions,
    rateLimitPerMinute: row.rate_limit_per_minute,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

export const API_RELATION_SELECT =
  "*, category:categories(slug, name, icon), provider:providers(slug, name, homepage_url)";
