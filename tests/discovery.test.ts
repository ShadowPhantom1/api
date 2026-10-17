import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseManifestDocument } from "@/lib/discovery/rebix";
import { parseOpenApiDocument, resolveRef } from "@/lib/discovery/openapi";
import { categorySlugFor, inferParamType, normalizeMethod } from "@/lib/discovery/normalize";

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), "scripts/fixtures/rebix-allEnds.json"), "utf8"),
) as { timestamp: string; data: Record<string, unknown[]> };

describe("Rebix manifest discovery", () => {
  const parsed = parseManifestDocument(fixture, {
    providerSlug: "rebix",
    baseUrl: "https://api-rebix.zone.id",
    manifestUrl: "https://api-rebix.zone.id/allEnds",
  });

  it("imports every documented endpoint exactly once", () => {
    expect(parsed.endpoints).toHaveLength(55);
    expect(new Set(parsed.endpoints.map((endpoint) => endpoint.sourceKey)).size).toBe(55);
    expect(parsed.manifestTimestamp).toBe("2026-10-17T16:39:11.102Z");
  });

  it("uses the manifest's own methods, paths and parameter names", () => {
    const deepseek = parsed.endpoints.find((endpoint) => endpoint.path === "/api/deepseek-v3");
    expect(deepseek).toBeDefined();
    expect(deepseek?.method).toBe("GET");
    expect(deepseek?.queryParams.map((param) => param.name)).toEqual(["q"]);
    expect(deepseek?.queryParams[0].example).toBe("hii");
    expect(deepseek?.sourceUrl).toContain("/allEnds#/api/deepseek-v3");
    expect(deepseek?.metadata.discovery).toBe("rebix_manifest");

    const ssweb = parsed.endpoints.find((endpoint) => endpoint.path === "/api/ssweb");
    expect(ssweb?.queryParams.map((param) => param.name).sort()).toEqual(["device", "url"]);
  });

  it("preserves nsfw flags and category keys", () => {
    expect(parsed.endpoints.filter((endpoint) => endpoint.isNsfw)).toHaveLength(5);
    expect(parsed.endpoints.find((endpoint) => endpoint.path === "/api/nsfw/yuri")?.categorySlug).toBe("nsfw");
  });

  it("normalizes arbitrary categories and methods defensively", () => {
    expect(categorySlugFor("Tools & Extra")).toBe("tools-extra");
    expect(normalizeMethod("get")).toBe("GET");
    expect(normalizeMethod("TRACE")).toBeNull();
    expect(inferParamType(3)).toBe("integer");
    expect(inferParamType(true)).toBe("boolean");
  });
});

describe("OpenAPI import", () => {
  const spec = {
    openapi: "3.0.3",
    info: { title: "Pet API", version: "1.2.0" },
    servers: [{ url: "https://api.example.com/v1" }],
    tags: [{ name: "Pets" }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
      schemas: { Pet: { type: "object", properties: { name: { type: "string" } } } },
    },
    security: [{ bearer: [] }],
    paths: {
      "/pets/{petId}": {
        parameters: [{ name: "petId", in: "path", required: true, schema: { type: "string" } }],
        get: {
          summary: "Get a pet",
          tags: ["Pets"],
          parameters: [
            { name: "include", in: "query", schema: { type: "string" }, example: "owner" },
            { name: "X-Trace", in: "header", schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "ok",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Pet" },
                  example: { name: "Ada" },
                },
              },
            },
          },
        },
      },
      "/pets": {
        post: {
          summary: "Create a pet",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
              },
            },
          },
          responses: { "201": { description: "created" } },
        },
      },
    },
  };

  const parsed = parseOpenApiDocument(spec, { sourceUrl: "https://api.example.com/openapi.json" });

  it("reads servers, auth, params and methods", () => {
    expect(parsed.baseUrl).toBe("https://api.example.com/v1");
    expect(parsed.title).toBe("Pet API");
    expect(parsed.endpoints).toHaveLength(2);
    const get = parsed.endpoints.find((endpoint) => endpoint.method === "GET")!;
    expect(get.path).toBe("/pets/{petId}");
    expect(get.authType).toBe("bearer");
    expect(get.categorySlug).toBe("pets");
    expect(get.queryParams.map((param) => param.name)).toEqual(["include"]);
    expect(get.pathParams.map((param) => param.name)).toEqual(["petId"]);
    expect(get.headersSchema.map((param) => param.name)).toEqual(["X-Trace"]);
  });

  it("derives body schema and required fields", () => {
    const post = parsed.endpoints.find((endpoint) => endpoint.method === "POST")!;
    expect(post.bodySchema?.required).toEqual(["name"]);
    expect(post.bodySchema?.properties?.name?.type).toBe("string");
  });

  it("resolves local JSON pointers and rejects unsupported specs", () => {
    expect(resolveRef(spec, "#/components/schemas/Pet")).toEqual(spec.components.schemas.Pet);
    expect(() => parseOpenApiDocument({ swagger: "1.2" })).toThrow(/unsupported/i);
  });

  it("accepts YAML input", () => {
    const yaml = [
      "openapi: 3.0.0",
      "info: { title: Y, version: '1' }",
      "servers: [{ url: https://y.example.com }]",
      "paths:",
      "  /ping:",
      "    get:",
      "      responses: { '200': { description: ok } }",
    ].join("\n");
    const result = parseOpenApiDocument(yaml);
    expect(result.endpoints[0].path).toBe("/ping");
  });
});

describe("change detection", () => {
  it("hashes stable endpoint shapes identically and detects real changes", async () => {
    const { endpointHash } = await import("@/lib/discovery/normalize");
    const base = {
      name: "DeepSeek",
      description: "DeepSeek chat",
      path: "/api/deepseek-v3",
      method: "GET" as const,
      queryParams: [{ name: "q", type: "string" as const }],
      categorySlug: "ai",
      isNsfw: false,
      pathParams: [],
      headersSchema: [],
      bodySchema: null,
      contentType: "application/json",
      authType: "none" as const,
      authMeta: {},
    };
    expect(endpointHash(base)).toBe(endpointHash({ ...base }));
    expect(endpointHash({ ...base, name: "DeepSeek V3" })).not.toBe(endpointHash(base));
    expect(
      endpointHash({
        ...base,
        queryParams: [
          { name: "q", type: "string" as const },
          { name: "model", type: "string" as const },
        ],
      }),
    ).not.toBe(endpointHash(base));
    expect(endpointHash({ ...base, method: "POST" })).not.toBe(endpointHash(base));
  });
});
