import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
  createHmac,
} from "node:crypto";
import { env, isEncryptionConfigured } from "@/lib/env";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

function encryptionKey(): Buffer {
  const raw = env.appEncryptionKey;
  if (!raw) {
    throw new Error(
      "APP_ENCRYPTION_KEY is not configured. Generate one with `openssl rand -base64 32`.",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256).");
  }
  return key;
}

/**
 * Encrypt an upstream credential (or any secret) with AES-256-GCM.
 * Returns a compact, versioned string: v1.<iv>.<tag>.<ciphertext> (base64url).
 */
export function encryptSecret(plaintext: string): string {
  if (!isEncryptionConfigured()) throw new Error("Credential encryption is not configured.");
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(
    ".",
  );
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Malformed encrypted payload.");
  }
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const ciphertext = Buffer.from(parts[3], "base64url");
    const decipher = createDecipheriv(ALGORITHM, encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Unable to decrypt credential: wrong key or tampered payload.");
  }
}

export function encryptJson(value: unknown): string {
  return encryptSecret(JSON.stringify(value));
}

export function decryptJson<T>(payload: string): T {
  return JSON.parse(decryptSecret(payload)) as T;
}

export function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** HMAC helper used for API key digests (pepper never leaves the server). */
export function hmacSha256Hex(value: string): string {
  const pepper = env.platformKeyPepper;
  if (!pepper) {
    throw new Error(
      "PLATFORM_KEY_PEPPER is not configured. Generate one with `openssl rand -hex 32`.",
    );
  }
  return createHmac("sha256", pepper).update(value).digest("hex");
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}
