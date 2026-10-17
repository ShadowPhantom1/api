import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  extractBearerToken,
  hashPlatformKey,
  isPlatformKey,
} from "@/lib/security/keys";
import { GatewayError } from "@/lib/executor/errors";
import { consumeRateLimit } from "@/lib/security/rate-limit";

export type Scope = "execute" | "chat" | "models";

export interface Caller {
  userId: string;
  isAdmin: boolean;
  authMethod: "session" | "platform_key" | "supabase_jwt";
  platformKeyId: string | null;
  rateLimitPerMinute: number;
}

export async function isAdminUser(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (error) return false;
  return data?.role === "admin";
}

async function callersRateLimit(
  admin: SupabaseClient,
  subject: string,
  userId: string,
  isAdmin: boolean,
  platformKeyId: string | null,
  authMethod: Caller["authMethod"],
  limit: number,
): Promise<Caller> {
  const rate = await consumeRateLimit(admin, subject, limit, 60);
  if (!rate.allowed) {
    throw new GatewayError(
      "rate_limited",
      `Rate limit exceeded (${rate.limit} requests / 60s).`,
      429,
      { retryAfterSeconds: rate.windowSeconds },
    );
  }
  return { userId, isAdmin, platformKeyId, rateLimitPerMinute: limit, authMethod };
}

/**
 * Authenticate a gateway/API request. Supports:
 *  - platform API keys: Authorization: Bearer anx_live_...
 *  - Supabase access tokens: Authorization: Bearer <jwt>
 *  - browser session cookies (Supabase SSR)
 */
export async function authenticateRequest(
  request: Request,
  admin: SupabaseClient,
  options: { scopes?: Scope[]; sessionRateLimit?: number } = {},
): Promise<Caller> {
  const scopes = options.scopes ?? ["execute"];
  const token = extractBearerToken(request.headers.get("authorization"));

  if (token && isPlatformKey(token)) {
    const hash = hashPlatformKey(token);
    const { data: key, error } = await admin
      .from("platform_api_keys")
      .select(
        "id, user_id, permissions, rate_limit_per_minute, revoked_at, expires_at",
      )
      .eq("key_hash", hash)
      .maybeSingle();

    if (error) {
      console.error("[auth] key lookup failed:", error.message);
      throw new GatewayError("auth_error", "Unable to verify the API key.", 500);
    }
    if (!key) throw new GatewayError("invalid_api_key", "Invalid platform API key.", 401);
    if (key.revoked_at) throw new GatewayError("key_revoked", "This API key has been revoked.", 401);
    if (key.expires_at && new Date(key.expires_at).getTime() < Date.now()) {
      throw new GatewayError("key_expired", "This API key has expired.", 401);
    }
    const permissions = (key.permissions as string[] | null) ?? [];
    const missing = scopes.filter((scope) => !permissions.includes(scope));
    if (missing.length) {
      throw new GatewayError(
        "insufficient_scope",
        `This API key is missing the required permission: ${missing.join(", ")}.`,
        403,
      );
    }

    const isAdmin = await isAdminUser(admin, key.user_id);
    const caller = await callersRateLimit(
      admin,
      `key:${key.id}`,
      key.user_id,
      isAdmin,
      key.id,
      "platform_key",
      key.rate_limit_per_minute,
    );

    await admin
      .from("platform_api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", key.id)
      .then(({ error: updateError }) => {
        if (updateError) console.error("[auth] last_used_at update failed:", updateError.message);
      });

    return caller;
  }

  if (token) {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) {
      throw new GatewayError("invalid_token", "Invalid or expired access token.", 401);
    }
    const isAdmin = await isAdminUser(admin, data.user.id);
    return callersRateLimit(
      admin,
      `user:${data.user.id}`,
      data.user.id,
      isAdmin,
      null,
      "supabase_jwt",
      options.sessionRateLimit ?? 120,
    );
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new GatewayError("setup_required", "Authentication is not configured.", 503);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new GatewayError(
      "unauthorized",
      "Authentication required. Send an Anvex API key as `Authorization: Bearer anx_live_...` or sign in.",
      401,
    );
  }
  const isAdmin = await isAdminUser(admin, data.user.id);
  return callersRateLimit(
    admin,
    `user:${data.user.id}`,
    data.user.id,
    isAdmin,
    null,
    "session",
    options.sessionRateLimit ?? 120,
  );
}

export function assertAdmin(caller: Caller): void {
  if (!caller.isAdmin) {
    throw new GatewayError("forbidden", "Administrator access is required.", 403);
  }
}

export async function requireSessionUser(admin: SupabaseClient) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const isAdmin = await isAdminUser(admin, data.user.id);
  return { user: data.user, isAdmin };
}
