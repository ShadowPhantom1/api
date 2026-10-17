export type VerificationStatus = "unverified" | "verified" | "failed";
export type AuthType = "none" | "bearer" | "api_key" | "basic";
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type RequestKind = "rest" | "ai_chat" | "discovery_test";
export type AiAdapter =
  | "openai_compatible"
  | "anthropic_messages"
  | "gemini_generate"
  | "rebix_text";

export type ParamType = "string" | "number" | "integer" | "boolean" | "enum";

export interface ParamDef {
  name: string;
  type?: ParamType;
  required?: boolean;
  description?: string;
  example?: string;
  default?: string;
  enum?: string[];
}

export interface HeaderDef {
  name: string;
  required?: boolean;
  description?: string;
  example?: string;
  secret?: boolean;
}

export interface BodySchema {
  /** simple JSON-schema-like description: properties + required */
  type?: string;
  properties?: Record<string, { type?: string; description?: string; example?: unknown }>;
  required?: string[];
  example?: unknown;
}

export interface ProviderRecord {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  homepage_url: string | null;
  base_url: string | null;
  docs_url: string | null;
  terms_url: string | null;
  allowed_hosts: string[];
  discovery_adapter: "none" | "rebix_manifest" | "openapi" | "json_manifest";
  discovery_config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CategoryRecord {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
  created_at: string;
}

export interface ApiRecord {
  id: string;
  owner_id: string | null;
  provider_id: string | null;
  category_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  base_url: string;
  path: string;
  method: HttpMethod;
  query_params: ParamDef[];
  path_params: ParamDef[];
  headers_schema: HeaderDef[];
  body_schema: BodySchema | null;
  auth_type: AuthType;
  auth_config_encrypted: string | null;
  auth_config_meta: Record<string, unknown>;
  content_type: string;
  request_example: Record<string, unknown> | null;
  response_example: unknown;
  response_schema: unknown;
  docs_url: string | null;
  source_url: string | null;
  discovery_source: string;
  discovery_metadata: Record<string, unknown>;
  verification_status: VerificationStatus;
  last_status_code: number | null;
  last_tested_at: string | null;
  last_error: string | null;
  is_public: boolean;
  is_enabled: boolean;
  is_nsfw: boolean;
  is_managed: boolean;
  allow_extra_query: boolean;
  supports_streaming: boolean;
  timeout_ms: number;
  source_key: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** API record safe to serialize to the browser (no encrypted credentials). */
export type SafeApi = Omit<ApiRecord, "auth_config_encrypted"> & {
  credential_configured: boolean;
  category?: CategorySummary | null;
  provider?: ProviderSummary | null;
};

export interface CategorySummary {
  slug: string;
  name: string;
  icon?: string | null;
}

export interface ProviderSummary {
  slug: string;
  name: string;
  homepage_url?: string | null;
}

export interface AiModelRecord {
  id: string;
  owner_id: string | null;
  provider_id: string | null;
  api_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  adapter: AiAdapter;
  base_url: string | null;
  chat_path: string;
  upstream_model: string | null;
  auth_type: AuthType;
  auth_config_encrypted: string | null;
  auth_config_meta: Record<string, unknown>;
  config: Record<string, unknown>;
  capabilities: AiCapabilities;
  context_window: number | null;
  is_public: boolean;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AiCapabilities {
  chat: boolean;
  streaming: boolean;
  tools: boolean;
  usage: boolean;
  [key: string]: unknown;
}

export type SafeAiModel = Omit<AiModelRecord, "auth_config_encrypted"> & {
  credential_configured: boolean;
};

export interface PlatformKeyRecord {
  id: string;
  user_id: string;
  name: string;
  prefix: string;
  key_hash: string;
  last_four: string;
  permissions: string[];
  rate_limit_per_minute: number;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  rotated_from: string | null;
}

export interface UsageRecord {
  id: number;
  user_id: string | null;
  api_id: string | null;
  ai_model_id: string | null;
  platform_key_id: string | null;
  kind: RequestKind;
  method: string | null;
  status_code: number | null;
  duration_ms: number | null;
  response_bytes: number | null;
  ok: boolean;
  error_code: string | null;
  created_at: string;
}

export interface DiscoveryRunRecord {
  id: string;
  user_id: string | null;
  provider_id: string | null;
  adapter: string;
  source_url: string;
  status: "running" | "success" | "partial" | "failed";
  attempted_methods: DiscoveryAttempt[];
  notes: string | null;
  created_count: number;
  updated_count: number;
  unchanged_count: number;
  failed_count: number;
  endpoint_ids: string[];
  started_at: string;
  finished_at: string | null;
}

export interface DiscoveryAttempt {
  method: string;
  target: string;
  outcome: "success" | "not_found" | "error" | "skipped";
  detail?: string;
  status?: number;
  endpoints?: number;
}

export interface DiscoveredEndpoint {
  name: string;
  path: string;
  method: HttpMethod;
  description: string;
  categorySlug: string;
  categoryName: string;
  baseUrl?: string;
  queryParams: ParamDef[];
  pathParams: ParamDef[];
  headersSchema: HeaderDef[];
  bodySchema: BodySchema | null;
  contentType: string;
  authType: AuthType;
  authMeta: Record<string, unknown>;
  requestExample: Record<string, unknown> | null;
  responseExample: unknown;
  isNsfw: boolean;
  supportsStreaming: boolean;
  sourceUrl: string;
  sourceKey: string;
  metadata: Record<string, unknown>;
}

export interface ExecuteResult {
  ok: boolean;
  status: number;
  statusText: string;
  contentType: string;
  headers: Record<string, string>;
  durationMs: number;
  size: number;
  truncated: boolean;
  body: unknown;
  bodyText: string | null;
  finalUrl: string;
  redirects: number;
}

export interface GatewayErrorShape {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
