import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseManifestDocument } from "@/lib/discovery/rebix";
import { parseOpenApiDocument } from "@/lib/discovery/openapi";

const manifest = JSON.parse(
  readFileSync(join(process.cwd(), "scripts/fixtures/rebix-allEnds.json"), "utf8"),
) as { timestamp: string; data: Record<string, unknown[]> };

describe("Rebix manifest normalization", () => {
  const parsed = parseManifestDocument(manifest, {
    providerSlug: "rebix",
    baseUrl: "https://api-rebix.zone.id",
    manifestUrl: "https://api-rebix.zone.id/allEnds",
  });

  it("imports every documented route without duplicates", () => {
    expect(parsed.errors).toEqual([]);
    expect(parsed.endpoints).toHaveLength(55);
    const keys = parsed.endpoints.map((endpoint) => `${endpoint.method}:${endpoint.path}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(parsed.manifestTimestamp).toBe("2026-10-17T16:39:11.102Z");
  });

  it("keeps only manifest-declared methods and parameters", () => {
    const deepseek = parsed.endpoints.find((endpoint) => endpoint.path === "/api/deepseek-v3");
    expect(deepseek).toBeDefined();
    expect(deepseek?.method).toBe("GET");
    expect(deepseek?.queryParams.map((param) => param.name)).toEqual(["q"]);
    expect(deepseek?.queryParams[0].example).toBe("hii");
    expect(deepseek?.metadata.discovery).toBe("rebix_manifest");
    expect(deepseek?.sourceUrl).toContain("/allEnds#/api/deepseek-v3");
  });

  it("keeps arbitrary params rather than a fixed allowlist", () => {
    const translate = parsed.endpoints.find((endpoint) => endpoint.path === "/api/translate");
    expect(translate?.queryParams.map((param) => param.name).sort()).toEqual(["text", "to"]);
    const ssweb = parsed.endpoints.find((endpoint) => endpoint.path === "/api/ssweb");
    expect(ssweb?.queryParams.map((param) => param.name).sort()).toEqual(["device", "url"]);
  });

  it("flags NSFW entries and preserves category information", () => {
    expect(parsed.endpoints.filter((endpoint) => endpoint.isNsfw)).toHaveLength(5);
    expect(parsed.endpoints.find((endpoint) => endpoint.path === "/api/nsfw/yuri")?.categorySlug).toBe("nsfw");
    expect(parsed.endpoints.find((endpoint) => endpoint.path === "/api/wallpaper")?.categorySlug).toBe("images");
  });
});

describe("OpenAPI parsing", () => {
  const spec = {
    openapi: "3.0.3",
    info: { title: "Sample", version: "1.0.0" },
    servers: [{ url: "https://api.example.com/v1" }],
    security: [{ bearerAuth: [] }],
    tags: [{ name: "Greeting" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
      schemas: {
        Greeting: {
          type: "object",
          properties: { message: { type: "string" } },
        },
      },
    },
    paths: {
      "/hello/{name}": {
        get: {
          operationId: "sayHello",
          summary: "Say hello",
          tags: ["Greeting"],
          parameters: [
            { name: "name", in: "path", required: true, schema: { type: "string" }, example: "ada" },
            { name: "lang", in: "query", schema: { type: "string", example: "en" } },
          ],
          responses: {
            "200": {
              description: "ok",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Greeting" },
                  example: { message: "hello" },
                },
              },
            },
          },
        },
      },
      "/noop": {
        post: {
          summary: "No auth override",
          responses: { "204": { description: "no content" } },
        },
      },
    },
  };

  it("parses OAS3 servers, params, tags, auth and refs", () => {
    const parsed = parseOpenApiDocument(spec, { sourceUrl: "https://api.example.com/openapi.json" });
    expect(parsed.title).toBe("Sample");
    expect(parsed.baseUrl).toBe("https://api.example.com/v1");
    expect(parsed.endpoints).toHaveLength(2);
    const hello = parsed.endpoints.find((endpoint) => endpoint.path === "/hello/{name}");
    expect(hello?.method).toBe("GET");
    expect(hello?.authType).toBe("bearer");
    expect(hello?.categorySlug).toBe("greeting");
    expect(hello?.pathParams[0].name).toBe("name");
    expect(hello?.queryParams[0].name).toBe("lang");
    expect(hello?.responseExample).toEqual({ message: "hello" });
  });

  it("parses Swagger 2 host/basePath and api_key security", () => {
    const swagger = {
      swagger: "2.0",
      info: { title: "Legacy", version: "2.0" },
      host: "legacy.example.com",
      basePath: "/api",
      schemes: ["https"],
      securityDefinitions: { key: { type: "apiKey", in: "header", name: "X-Key" } },
      security: [{ key: [] }],
      paths: {
        "/status": {
          get: { responses: { "200": { description: "ok" } } },
        },
      },
    };
    const parsed = parseOpenApiDocument(swagger);
    expect(parsed.baseUrl).toBe("https://legacy.example.com/api");
    expect(parsed.endpoints[0].authType).toBe("api_key");
    expect(parsed.endpoints[0].authMeta.header_name).toBe("X-Key");
  });

  it("rejects documents without operations", () => {
    expect(() =>
      parseOpenApiDocument({
        openapi: "3.0.0",
        info: { title: "x" },
        servers: [{ url: "https://example.com" }],
        paths: {},
      }),
    ).toThrow(/operation/i);
  });
});
