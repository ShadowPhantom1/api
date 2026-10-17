/**
 * Environment access. Every accessor is lazy so that `next build` never fails
 * when optional configuration is absent (e.g. during CI).
 */

export class SetupError extends Error {
  readonly code = "setup_required";
  constructor(message: string) {
    super(message);
    this.name = "SetupError";
  }
}

function read(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

export const env = {
  get supabaseUrl() {
    return read("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseAnonKey() {
    return read("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  get supabaseServiceRoleKey() {
    return read("SUPABASE_SERVICE_ROLE_KEY");
  },
  get appEncryptionKey() {
    return read("APP_ENCRYPTION_KEY");
  },
  get platformKeyPepper() {
    return read("PLATFORM_KEY_PEPPER");
  },
  get appUrl() {
    return read("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000";
  },
  get siteName() {
    return read("NEXT_PUBLIC_SITE_NAME") ?? "Anvex";
  },
  get allowedHosts(): string[] {
    return (read("GATEWAY_ALLOWED_HOSTS") ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
  },
  get allowedPorts(): number[] {
    return (read("GATEWAY_ALLOWED_PORTS") ?? "80,443")
      .split(",")
      .map((p) => Number.parseInt(p.trim(), 10))
      .filter((p) => Number.isInteger(p) && p > 0 && p < 65536);
  },
  get maxResponseBytes(): number {
    const n = Number.parseInt(read("GATEWAY_MAX_RESPONSE_BYTES") ?? "2097152", 10);
    return Number.isFinite(n) ? Math.min(Math.max(n, 1024), 10 * 1024 * 1024) : 2_097_152;
  },
  get requestTimeoutMs(): number {
    const n = Number.parseInt(read("GATEWAY_REQUEST_TIMEOUT_MS") ?? "20000", 10);
    return Number.isFinite(n) ? Math.min(Math.max(n, 1000), 60_000) : 20_000;
  },
  get enforceHostAllowlist(): boolean {
    return (read("GATEWAY_ENFORCE_HOST_ALLOWLIST") ?? "true") !== "false";
  },
};

export function isSupabaseConfigured(): boolean {
  return Boolean(env.supabaseUrl && env.supabaseAnonKey);
}

export function isAdminBackendConfigured(): boolean {
  return Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);
}

export function assertAdminBackend(): void {
  if (!isAdminBackendConfigured()) {
    throw new SetupError(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
}

export function isEncryptionConfigured(): boolean {
  const raw = env.appEncryptionKey;
  if (!raw) return false;
  try {
    return Buffer.from(raw, "base64").length === 32;
  } catch {
    return false;
  }
}

export const APP_NAME = "Anvex";
export const KEY_PREFIX = "anx_live_";
