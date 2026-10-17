import { describe, expect, it } from "vitest";
import {
  SafeFetchError,
  hostMatches,
  isPrivateIp,
  validateTargetUrl,
} from "@/lib/http/safe-fetch";
import {
  REDACTION_MARKER,
  redactHeaders,
  redactObject,
  redactUrl,
  safeErrorMessage,
} from "@/lib/security/redact";
import { decryptJson, decryptSecret, encryptJson, encryptSecret } from "@/lib/security/crypto";
import {
  extractBearerToken,
  generatePlatformKey,
  hashPlatformKey,
  isPlatformKey,
  keyPrefixOf,
} from "@/lib/security/keys";

async function expectSafeFetchError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(SafeFetchError);
  await promise.catch((error: SafeFetchError) => {
    expect(error.code).toBe(code);
  });
}

describe("SSRF IP classification", () => {
  it.each([
    "127.0.0.1",
    "127.10.0.2",
    "10.1.2.3",
    "172.16.5.4",
    "192.168.1.10",
    "169.254.169.254",
    "100.64.0.9",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])("blocks %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "2001:4860:4860::8888", "not-an-ip"])(
    "classifies %s safely",
    (ip) => {
      expect(isPrivateIp(ip)).toBe(ip === "not-an-ip");
    },
  );
});

describe("host allowlist matching", () => {
  it("matches exact and wildcard hosts", () => {
    expect(hostMatches("api.example.com", "api.example.com")).toBe(true);
    expect(hostMatches("API.EXAMPLE.COM", "api.example.com")).toBe(true);
    expect(hostMatches("*.example.com", "api.example.com")).toBe(true);
    expect(hostMatches("*.example.com", "example.com")).toBe(true);
    expect(hostMatches("*.example.com", "evil-example.com")).toBe(false);
    expect(hostMatches("api.example.com", "example.com")).toBe(false);
  });
});

describe("validateTargetUrl", () => {
  it("rejects non-http protocols", async () => {
    await expectSafeFetchError(validateTargetUrl("file:///etc/passwd"), "unsupported_protocol");
  });

  it("rejects private IP literals even with skipDns", async () => {
    await expectSafeFetchError(
      validateTargetUrl("http://127.0.0.1/", { skipDns: true }),
      "blocked_destination",
    );
    await expectSafeFetchError(
      validateTargetUrl("http://169.254.169.254/latest/meta-data", { skipDns: true }),
      "blocked_destination",
    );
  });

  it("enforces the host allowlist when enabled", async () => {
    await expectSafeFetchError(
      validateTargetUrl("https://evil.example.com/", {
        skipDns: true,
        enforceAllowlist: true,
        allowedHosts: ["api-rebix.zone.id"],
      }),
      "host_not_allowed",
    );
  });

  it("enforces port restrictions", async () => {
    await expectSafeFetchError(
      validateTargetUrl("http://api-rebix.zone.id:8080/allEnds", {
        skipDns: true,
        allowedPorts: [80, 443],
      }),
      "blocked_port",
    );
  });

  it("accepts an allowlisted https host without DNS in tests", async () => {
    const result = await validateTargetUrl("https://api-rebix.zone.id/allEnds", {
      skipDns: true,
      enforceAllowlist: true,
      allowedHosts: ["api-rebix.zone.id"],
    });
    expect(result.hostname).toBe("api-rebix.zone.id");
    expect(result.url.pathname).toBe("/allEnds");
  });
});

describe("secret redaction", () => {
  it("redacts sensitive headers but keeps ordinary ones", () => {
    const redacted = redactHeaders({
      Authorization: "Bearer secret",
      cookie: "a=b",
      "X-Api-Key": "abc",
      "Content-Type": "application/json",
    });
    expect(redacted.Authorization).toBe(REDACTION_MARKER);
    expect(redacted.cookie).toBe(REDACTION_MARKER);
    expect(redacted["X-Api-Key"]).toBe(REDACTION_MARKER);
    expect(redacted["Content-Type"]).toBe("application/json");
  });

  it("redacts nested sensitive keys and platform keys", () => {
    const redacted = redactObject({
      name: "ok",
      password: "hunter2",
      nested: { apiKey: "abc", note: "anx_live_abc", count: 2 },
    });
    expect(redacted.name).toBe("ok");
    expect(redacted.password).toBe(REDACTION_MARKER);
    expect((redacted.nested as Record<string, unknown>).apiKey).toBe(REDACTION_MARKER);
    expect((redacted.nested as Record<string, unknown>).note).toBe(REDACTION_MARKER);
    expect((redacted.nested as Record<string, unknown>).count).toBe(2);
  });

  it("redacts sensitive URL query values", () => {
    const url = redactUrl("https://example.com/x?api_key=abcdef&q=hello&token=xyz");
    expect(url).toContain("api_key=%5BREDACTED%5D");
    expect(url).toContain("token=%5BREDACTED%5D");
    expect(url).toContain("q=hello");
  });

  it("safeErrorMessage never stringifies objects", () => {
    expect(safeErrorMessage(new Error("boom"))).toBe("boom");
    expect(safeErrorMessage(" plain ")).toBe(" plain ");
    expect(safeErrorMessage({ token: "secret" })).toBe("Unexpected error");
  });
});

describe("AES-256-GCM credential encryption", () => {
  it("round-trips secrets and JSON", () => {
    const payload = encryptSecret("super-secret-token");
    expect(payload.startsWith("v1.")).toBe(true);
    expect(payload).not.toContain("super-secret-token");
    expect(decryptSecret(payload)).toBe("super-secret-token");

    const json = encryptJson({ token: "abc", username: "u" });
    expect(decryptJson<{ token: string }>(json).token).toBe("abc");
  });

  it("uses a fresh IV per encryption", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("fails closed on tampering", () => {
    const payload = encryptSecret("value");
    const parts = payload.split(".");
    const tampered = [parts[0], parts[1], parts[2], `${parts[3].slice(0, -2)}AA`].join(".");
    expect(() => decryptSecret(tampered)).toThrow(/tampered|decrypt/i);
  });
});

describe("platform API keys", () => {
  it("generates anx_live keys with digest-only storage fields", () => {
    const key = generatePlatformKey();
    expect(key.secret.startsWith("anx_live_")).toBe(true);
    expect(key.secret.length).toBeGreaterThan(30);
    expect(key.prefix).toBe(keyPrefixOf(key.secret));
    expect(key.lastFour).toBe(key.secret.slice(-4));
    expect(key.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(key.hash).not.toContain(key.secret);
    expect(generatePlatformKey().secret).not.toBe(key.secret);
  });

  it("hashes deterministically with the deployment pepper", () => {
    const secret = "anx_live_example";
    expect(hashPlatformKey(secret)).toBe(hashPlatformKey(secret));
    expect(hashPlatformKey(secret)).not.toBe(hashPlatformKey(`${secret}x`));
  });

  it("detects platform keys and parses bearer headers", () => {
    expect(isPlatformKey("anx_live_abc")).toBe(true);
    expect(isPlatformKey("eyJhbGciOi...")).toBe(false);
    expect(extractBearerToken("Bearer anx_live_abc")).toBe("anx_live_abc");
    expect(extractBearerToken("bearer   token  ")).toBe("token");
    expect(extractBearerToken("Basic abc")).toBeNull();
    expect(extractBearerToken(null)).toBeNull();
  });
});
