import "server-only";
import { KEY_PREFIX } from "@/lib/env";
import { hmacSha256Hex, randomToken } from "@/lib/security/crypto";

export interface GeneratedPlatformKey {
  /** Full secret. Only returned once, at creation time. */
  secret: string;
  /** Non-secret display prefix. */
  prefix: string;
  lastFour: string;
  /** HMAC-SHA256 digest stored in the database. */
  hash: string;
}

/**
 * Generate a cryptographically secure platform key: anx_live_<random>.
 * 24 random bytes => 32 base64url characters (~192 bits of entropy).
 */
export function generatePlatformKey(): GeneratedPlatformKey {
  const secret = `${KEY_PREFIX}${randomToken(24)}`;
  return {
    secret,
    prefix: secret.slice(0, KEY_PREFIX.length + 6),
    lastFour: secret.slice(-4),
    hash: hmacSha256Hex(secret),
  };
}

export function hashPlatformKey(secret: string): string {
  return hmacSha256Hex(secret);
}

export function isPlatformKey(value: string): boolean {
  return value.startsWith(KEY_PREFIX);
}

export function extractBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? null;
}

export function keyPrefixOf(secret: string): string {
  return secret.slice(0, KEY_PREFIX.length + 6);
}
