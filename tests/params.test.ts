import { describe, expect, it } from "vitest";
import { GatewayError } from "@/lib/executor/errors";
import {
  buildAuthHeaders,
  buildTargetUrl,
  isForbiddenHeader,
  resolvePath,
  validateBody,
  validateHeaders,
  validateQueryParams,
} from "@/lib/registry/params";

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof GatewayError ? error.code : "not-gateway-error";
  }
  return "no-error";
}

describe("query parameter validation", () => {
  it("coerces declared scalar types", () => {
    const out = validateQueryParams(
      [
        { name: "q", type: "string" },
        { name: "limit", type: "integer" },
        { name: "temperature", type: "number" },
        { name: "stream", type: "boolean" },
      ],
      { q: "hello", limit: "5", temperature: 0.7, stream: "true" },
    );
    expect(out).toEqual({ q: "hello", limit: "5", temperature: "0.7", stream: "true" });
  });

  it("rejects undeclared params by default and accepts them only with allowExtra", () => {
    expect(codeOf(() => validateQueryParams([], { prompt: "x" }))).toBe("unknown_parameter");
    const out = validateQueryParams([], { prompt: "x" }, { allowExtra: true });
    expect(out.prompt).toBe("x");
  });

  it("requires declared params and applies defaults", () => {
    const defs = [
      { name: "q", type: "string" as const, required: true },
      { name: "lang", type: "string" as const, default: "en" },
    ];
    expect(codeOf(() => validateQueryParams(defs, {}))).toBe("missing_parameter");
    expect(validateQueryParams(defs, { q: "hi" })).toEqual({ q: "hi", lang: "en" });
  });

  it("enforces enum values", () => {
    const defs = [{ name: "mode", type: "enum" as const, enum: ["fast", "slow"] }];
    expect(validateQueryParams(defs, { mode: "fast" })).toEqual({ mode: "fast" });
    expect(codeOf(() => validateQueryParams(defs, { mode: "other" }))).toBe("invalid_parameter");
  });

  it("rejects invalid parameter names and oversized input", () => {
    expect(codeOf(() => validateQueryParams([], { "bad name": "x" }, { allowExtra: true }))).toBe("invalid_parameter");
    expect(codeOf(() => validateQueryParams([{ name: "q" }], { q: "x".repeat(5000) }))).toBe("invalid_parameter");
  });
});

describe("path and URL construction", () => {
  it("URL-encodes path params", () => {
    expect(resolvePath("/pet/{petId}", [{ name: "petId", required: true }], { petId: "a/b" })).toBe(
      "/pet/a%2Fb",
    );
  });

  it("rejects traversal and absolute paths", () => {
    expect(codeOf(() => buildTargetUrl("https://api.example.com", "../admin"))).toBe("invalid_configuration");
    expect(codeOf(() => buildTargetUrl("https://api.example.com", "https://evil.example.com/steal"))).toBe(
      "invalid_configuration",
    );
  });

  it("joins base path and endpoint path exactly once", () => {
    expect(buildTargetUrl("https://api.example.com/v1", "/pets").toString()).toBe(
      "https://api.example.com/v1/pets",
    );
  });
});

describe("headers and auth injection", () => {
  it("detects forbidden forwarding headers", () => {
    for (const name of ["Authorization", "cookie", "X-Forwarded-For", "x-supabase-auth"]) {
      expect(isForbiddenHeader(name), name).toBe(true);
    }
    expect(isForbiddenHeader("X-Request-Id")).toBe(false);
  });

  it("rejects undeclared and forbidden client headers", () => {
    expect(codeOf(() => validateHeaders([], { "X-Trace": "1" }))).toBe("unknown_header");
    expect(codeOf(() => validateHeaders([], { Authorization: "Bearer x" }))).toBe("forbidden_header");
  });

  it("injects bearer and api-key credentials server-side", () => {
    expect(buildAuthHeaders("none", {}, null)).toEqual({});
    expect(buildAuthHeaders("bearer", {}, { token: "t" })).toEqual({ Authorization: "Bearer t" });
    expect(buildAuthHeaders("api_key", { header_name: "X-Key" }, { apiKey: "k" })).toEqual({ "X-Key": "k" });
    expect(buildAuthHeaders("basic", {}, { username: "u", password: "p" })).toEqual({
      Authorization: `Basic ${Buffer.from("u:p").toString("base64")}`,
    });
  });

  it("fails closed when credentials are missing", () => {
    expect(codeOf(() => buildAuthHeaders("bearer", {}, null))).toBe("auth_not_configured");
    expect(codeOf(() => buildAuthHeaders("api_key", {}, {}))).toBe("auth_not_configured");
    expect(codeOf(() => buildAuthHeaders("basic", {}, { username: "u" }))).toBe("auth_not_configured");
  });
});

describe("body validation", () => {
  it("accepts JSON objects for non-GET methods only", () => {
    expect(validateBody("POST", null, { a: 1 }, "application/json")).toEqual({
      body: "{\"a\":1}",
      contentType: "application/json",
    });
    expect(codeOf(() => validateBody("GET", null, { a: 1 }, "application/json"))).toBe("invalid_body");
    expect(codeOf(() => validateBody("POST", null, [1, 2], "application/json"))).toBe("invalid_body");
  });

  it("enforces required body fields", () => {
    expect(codeOf(() => validateBody("POST", { required: ["name"] }, {}, "application/json"))).toBe(
      "missing_body_field",
    );
  });
});
