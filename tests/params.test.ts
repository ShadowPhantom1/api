import { describe, expect, it } from "vitest";
import {
  buildAuthHeaders,
  buildTargetUrl,
  isForbiddenHeader,
  resolvePath,
  validateBody,
  validateHeaders,
  validateQueryParams,
} from "@/lib/registry/params";
import type { ParamDef } from "@/lib/db/types";

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code ?? "none";
  }
  return "no-error";
}

describe("query parameter validation", () => {
  const defs: ParamDef[] = [
    { name: "q", type: "string", required: true, example: "hello" },
    { name: "limit", type: "integer", required: false },
    { name: "mode", type: "enum", enum: ["fast", "slow"] },
    { name: "flag", type: "boolean" },
  ];

  it("accepts declared scalar values and coerces types", () => {
    const out = validateQueryParams(defs, { q: "hi", limit: "3", mode: "fast", flag: "true" });
    expect(out).toEqual({ q: "hi", limit: "3", mode: "fast", flag: "true" });
  });

  it("rejects undeclared parameters by default (per-endpoint allowlist)", () => {
    expect(codeOf(() => validateQueryParams(defs, { q: "hi", prompt: "x" }))).toBe("unknown_parameter");
  });

  it("allows undeclared parameters when the endpoint opts in", () => {
    const out = validateQueryParams(defs, { q: "hi", prompt: "x" }, { allowExtra: true });
    expect(out.prompt).toBe("x");
  });

  it("rejects missing required parameters", () => {
    expect(codeOf(() => validateQueryParams(defs, {}))).toBe("missing_parameter");
  });

  it("validates numeric, integer, boolean and enum values", () => {
    expect(codeOf(() => validateQueryParams(defs, { q: "x", limit: "1.5" }))).toBe("invalid_parameter");
    expect(codeOf(() => validateQueryParams(defs, { q: "x", flag: "yes" }))).toBe("invalid_parameter");
    expect(codeOf(() => validateQueryParams(defs, { q: "x", mode: "other" }))).toBe("invalid_parameter");
  });

  it("rejects objects, empty values and oversized input", () => {
    expect(codeOf(() => validateQueryParams(defs, { q: { nested: true } }))).toBe("invalid_parameter");
    expect(codeOf(() => validateQueryParams(defs, { q: "" }))).toBe("invalid_parameter");
    expect(codeOf(() => validateQueryParams(defs, { q: "x".repeat(2049) }))).toBe("invalid_parameter");
  });

  it("caps the number of supplied parameters", () => {
    const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`p${i}`, "v"]));
    expect(codeOf(() => validateQueryParams([], many, { allowExtra: true }))).toBe("too_many_parameters");
  });

  it("applies declared defaults", () => {
    const out = validateQueryParams([{ name: "page", default: "1" }], {});
    expect(out.page).toBe("1");
  });
});

describe("path resolution", () => {
  it("encodes substitutions so they cannot escape the segment", () => {
    expect(resolvePath("/users/{id}", [{ name: "id", required: true }], { id: "a b/c" })).toBe(
      "/users/a%20b%2Fc",
    );
    expect(resolvePath("/files/{name}", [{ name: "name", required: true }], { name: "../etc/passwd" })).toBe(
      "/files/..%2Fetc%2Fpasswd",
    );
  });

  it("requires missing placeholders", () => {
    expect(codeOf(() => resolvePath("/users/{id}", [{ name: "id", required: true }], {}))).toBe(
      "missing_parameter",
    );
  });
});

describe("target URL construction", () => {
  it("joins base paths and rejects traversal/absolute URLs", () => {
    expect(buildTargetUrl("https://example.com/api/", "/v1/q").toString()).toBe("https://example.com/api/v1/q");
    expect(codeOf(() => buildTargetUrl("https://example.com", "//evil.com/x"))).toBe("invalid_configuration");
    expect(codeOf(() => buildTargetUrl("https://example.com", "/a/../b"))).toBe("invalid_configuration");
  });
});

describe("header validation", () => {
  const defs = [
    { name: "X-Trace", required: false },
    { name: "X-Required", required: true },
  ];

  it("accepts declared headers and enforces required ones", () => {
    expect(validateHeaders(defs, { "X-Trace": "1", "X-Required": "yes" })).toEqual({
      "X-Trace": "1",
      "X-Required": "yes",
    });
    expect(codeOf(() => validateHeaders(defs, { "X-Trace": "1" }))).toBe("missing_header");
  });

  it("rejects undeclared and dangerous headers", () => {
    expect(codeOf(() => validateHeaders(defs, { "X-Required": "1", "X-Other": "2" }))).toBe("unknown_header");
    expect(codeOf(() => validateHeaders(defs, { "X-Required": "1", Authorization: "x" }))).toBe(
      "forbidden_header",
    );
    expect(isForbiddenHeader("X-Forwarded-Host")).toBe(true);
    expect(isForbiddenHeader("x-supabase-auth")).toBe(true);
    expect(isForbiddenHeader("X-Trace")).toBe(false);
  });
});

describe("upstream auth injection", () => {
  it("injects bearer/api key/basic credentials server-side", () => {
    expect(buildAuthHeaders("none", {}, null)).toEqual({});
    expect(buildAuthHeaders("bearer", {}, { token: "t" })).toEqual({ Authorization: "Bearer t" });
    expect(buildAuthHeaders("api_key", { header_name: "X-Key" }, { apiKey: "k" })).toEqual({ "X-Key": "k" });
    expect(buildAuthHeaders("api_key", {}, { apiKey: "k" })).toEqual({ "X-API-Key": "k" });
    expect(
      buildAuthHeaders("basic", {}, { username: "u", password: "p" }).Authorization,
    ).toBe(`Basic ${Buffer.from("u:p").toString("base64")}`);
  });

  it("fails with 424 when credentials are missing (no anonymous upstream call)", () => {
    expect(codeOf(() => buildAuthHeaders("bearer", {}, null))).toBe("auth_not_configured");
    expect(codeOf(() => buildAuthHeaders("api_key", {}, {}))).toBe("auth_not_configured");
    expect(codeOf(() => buildAuthHeaders("basic", {}, { username: "u" }))).toBe("auth_not_configured");
  });
});

describe("body validation", () => {
  it("serializes JSON and form bodies and enforces required fields", () => {
    expect(validateBody("POST", null, { a: 1 }, "application/json")).toEqual({
      body: '{"a":1}',
      contentType: "application/json",
    });
    expect(
      validateBody("POST", null, { a: 1, b: "two" }, "application/x-www-form-urlencoded").body,
    ).toBe("a=1&b=two");
    expect(codeOf(() => validateBody("POST", { required: ["a"] }, {}, "application/json"))).toBe(
      "missing_body_field",
    );
  });

  it("rejects bodies on GET and non-object bodies", () => {
    expect(codeOf(() => validateBody("GET", null, { a: 1 }, "application/json"))).toBe("invalid_body");
    expect(codeOf(() => validateBody("POST", null, [1, 2], "application/json"))).toBe("invalid_body");
  });

  it("caps body size", () => {
    expect(codeOf(() => validateBody("POST", null, { blob: "x".repeat(300_000) }, "application/json"))).toBe(
      "body_too_large",
    );
  });
});
