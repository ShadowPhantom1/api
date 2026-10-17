import { describe, expect, it } from "vitest";
import { hostMatches, isPrivateIp, validateTargetUrl, SafeFetchError } from "@/lib/http/safe-fetch";
import { decryptJson, decryptSecret, encryptJson, encryptSecret } from "@/lib/security/crypto";
import { generatePlatformKey, hashPlatformKey, keyPrefixOf } from "@/lib/security/keys";
import { redactHeaders, redactObject, redactUrl } from "@/lib/security/redact";

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(SafeFetchError);
  await promise.catch((error) => expect((error as SafeFetchError).code).toBe(code));
}

describe("SSRF destination validation", () => {
  it("classifies private and reserved IPv4 addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.9",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("1.1.1.1")).toBe(false);
    expect(isPrivateIp("not-an-ip")).toBe(true);
  });

  it("blocks IPv6 private, loopback and mapped addresses", () => {
    for (const ip of ["::1", "fd12::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    expect(isPrivateIp("2606:4700:4700::1111")).toBe(false);
  });

  it("rejects non-http protocols and URL credentials", async () => {
    await expectError(validateTargetUrl("file:///etc/passwd", { skipDns: true }), "unsupported_protocol");
    await expectError(validateTargetUrl("http://user:pass@api.example.com", { skipDns: true }), "blocked_destination");
  });

  it("blocks loopback literals and internal hostnames", async () => {
    await expectError(validateTargetUrl("http://127.0.0.1:8080/", { skipDns: true }), "blocked_port");
    await expectError(validateTargetUrl("http://127.0.0.1/", { skipDns: true }), "blocked_destination");
    await expectError(validateTargetUrl("http://localhost/", { skipDns: true }), "blocked_destination");
    await expectError(validateTargetUrl("http://metadata.google.internal/", { skipDns: true }), "blocked_destination");
  });

  it("enforces host allowlists and ports", async () => {
    await expectError(
      validateTargetUrl("https://api.example.com/", { skipDns: true, enforceAllowlist: true, allowedHosts: ["api-rebix.zone.id"] }),
      "host_not_allowed",
    );
    await expectError(
      validateTargetUrl("http://api-rebix.zone.id:8080/", { skipDns: true, allowedPorts: [80, 443] }),
      "blocked_port",
    );
    const allowed = await validateTargetUrl("https://api-rebix.zone.id/allEnds", {
      skipDns: true,
      enforceAllowlist: true,
      allowedHosts: ["api-rebix.zone.id"],
    });
    expect(allowed.hostname).toBe("api-rebix.zone.id");
  });

  it("matches wildcard hosts strictly", () => {
    expect(hostMatches("*.example.com", "api.example.com")).toBe(true);
    expect(hostMatches("*.example.com", "example.com")).toBe(true);
    expect(hostMatches("*.example.com", "evil-example.com")).toBe(false);
    expect(hostMatches("api.example.com", "API.Example.com")).toBe(true);
  });
});

describe("cryptography", () => {
  it("round-trips AES-256-GCM payloads and detects tampering", () => {
    const payload = encryptSecret("super-secret-upstream-token");
    expect(payload.startsWith("v1.")).toBe(true);
    expect(payload).not.toContain("super-secret");
    expect(decryptSecret(payload)).toBe("super-secret-upstream-token");

    const json = { token: "abc", password: "hunter2" };
    expect(decryptJson<typeof json>(encryptJson(json))).toEqual(json);

    const parts = payload.split(".");
    const tampered = [parts[0], parts[1], parts[2], `${parts[3].slice(0, -2)}AA`].join(".");
    expect(() => decryptSecret(tampered)).toThrow(/tampered|decrypt/i);
  });

  it("produces unique platform keys with stable digests", () => {
    const a = generatePlatformKey();
    const b = generatePlatformKey();
    expect(a.secret.startsWith("anx_live_")).toBe(true);
    expect(a.secret).not.toBe(b.secret);
    expect(a.prefix).toBe(keyPrefixOf(a.secret));
    expect(a.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(a.hash).toBe(hashPlatformKey(a.secret));
    expect(a.hash).not.toBe(hashPlatformKey(b.secret));
  });
});

describe("redaction", () => {
  it("redacts credential headers while preserving ordinary ones", () => {
    const redacted = redactHeaders({
      Authorization: "Bearer abc",
      "X-Api-Key": "k",
      Cookie: "session=1",
      "Content-Type": "application/json",
      "X-Anvex-Duration-Ms": "42",
    });
    expect(redacted.Authorization).toBe("[REDACTED]");
    expect(redacted["X-Api-Key"]).toBe("[REDACTED]");
    expect(redacted.Cookie).toBe("[REDACTED]");
    expect(redacted["Content-Type"]).toBe("application/json");
    expect(redacted["X-Anvex-Duration-Ms"]).toBe("42");
  });

  it("redacts nested secrets and platform keys", () => {
    const out = redactObject({
      name: "ok",
      password: "p",
      nested: { apiKey: "k", note: "anx_live_abc" },
      items: [{ token: "t" }],
    });
    expect(out.name).toBe("ok");
    expect(out.password).toBe("[REDACTED]");
    expect(out.nested.apiKey).toBe("[REDACTED]");
    expect(out.nested.note).toBe("[REDACTED]");
    expect(out.items[0].token).toBe("[REDACTED]");
  });

  it("redacts secret query parameters in URLs", () => {
    const redacted = redactUrl("https://api.example.com/x?q=hello&api_key=abc&token=xyz");
    expect(redacted).toContain("q=hello");
    expect(redacted).not.toContain("abc");
    expect(redacted).not.toContain("xyz");
  });
});
