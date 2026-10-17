import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeCapabilities, adapterSummary } from "@/lib/ai/models";
import { rebixQueryParam } from "@/lib/ai/link";
import { chatCompletionSchema } from "@/lib/registry/schemas";
import { buildAnvexCurl, buildExampleRequest, buildUpstreamCurl } from "@/lib/registry/examples";
import type { ApiRecord } from "@/lib/db/types";

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), "tests/fixtures/rebix-normalized.json"), "utf8"),
) as Array<Record<string, unknown>>;
const cohere = fixture.find((item) => item.path === "/api/cohere") as Record<string, unknown>;

function apiShape(overrides: Partial<ApiRecord> = {}): ApiRecord {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    owner_id: null,
    provider_id: null,
    category_id: null,
    slug: "cohere",
    name: "Cohere",
    description: null,
    base_url: "https://api-rebix.zone.id",
    path: "/api/cohere",
    method: "GET",
    query_params: (cohere.query_params as ApiRecord["query_params"]) ?? [],
    path_params: [],
    headers_schema: [],
    body_schema: null,
    auth_type: "none",
    auth_config_encrypted: null,
    auth_config_meta: {},
    content_type: "application/json",
    request_example: null,
    response_example: null,
    response_schema: null,
    docs_url: null,
    source_url: null,
    discovery_source: "rebix_manifest",
    discovery_metadata: (cohere.discovery_metadata as Record<string, unknown>) ?? {
      example_params: { q: "hii" },
    },
    verification_status: "verified",
    last_status_code: 200,
    last_tested_at: "2026-10-17T00:00:00.000Z",
    last_error: null,
    is_public: true,
    is_enabled: true,
    is_nsfw: false,
    is_managed: true,
    allow_extra_query: false,
    supports_streaming: false,
    timeout_ms: 15000,
    source_key: "rebix:GET:/api/cohere",
    created_by: null,
    created_at: "2026-10-17T00:00:00.000Z",
    updated_at: "2026-10-17T00:00:00.000Z",
    ...overrides,
  };
}

describe("AI capability honesty", () => {
  it("never advertises unsupported capabilities", () => {
    const rebix = normalizeCapabilities("rebix_text", { streaming: true, tools: true, usage: true });
    expect(rebix).toEqual({ chat: true, streaming: false, tools: false, usage: false });

    const openai = normalizeCapabilities("openai_compatible", { streaming: true, tools: true });
    expect(openai.streaming).toBe(true);
    expect(openai.tools).toBe(false);
    expect(openai.usage).toBe(true);

    const anthropic = normalizeCapabilities("anthropic_messages", { streaming: true });
    expect(anthropic.streaming).toBe(false);
    expect(anthropic.usage).toBe(true);
  });

  it("documents unsupported capabilities in adapter summaries", () => {
    expect(adapterSummary("rebix_text")).toMatch(/no streaming/i);
    expect(adapterSummary("anthropic_messages")).toMatch(/streaming and tool calling are not supported/i);
  });

  it("prefers the q parameter but supports arbitrary first params", () => {
    expect(rebixQueryParam(apiShape())).toBe("q");
    expect(
      rebixQueryParam(
        apiShape({ query_params: [{ name: "prompt", type: "string" }] }),
      ),
    ).toBe("prompt");
  });

  it("defaults stream to false and never executes tools", () => {
    const parsed = chatCompletionSchema.parse({
      model: "rebix-claude-haiku",
      messages: [{ role: "user", content: "hello" }],
    });
    expect(parsed.stream).toBe(false);
  });
});

describe("example request builder", () => {
  it("uses stored examples and never invents values", () => {
    const example = buildExampleRequest(apiShape());
    expect(example.url).toBe("https://api-rebix.zone.id/api/cohere?q=hii");
    expect(example.missingRequired).toEqual([]);
  });

  it("reports missing required inputs instead of filling placeholders", () => {
    const api = apiShape({
      path: "/api/thing/{id}",
      path_params: [{ name: "id", type: "string", required: true }],
      query_params: [{ name: "q", required: true }],
      discovery_metadata: {},
      request_example: null,
    });
    const example = buildExampleRequest(api);
    expect(example.missingRequired.sort()).toEqual(["path.id", "query.q"]);
    expect(example.url).toBe("https://api-rebix.zone.id/api/thing/%7Bid%7D");
    expect(example.url).not.toContain("undefined");
  });

  it("builds direct and gateway curl snippets without secrets", () => {
    const upstream = buildUpstreamCurl(apiShape());
    expect(upstream).toContain("curl");
    expect(upstream).toContain("q=hii");
    const gateway = buildAnvexCurl(apiShape());
    expect(gateway).toContain("/api/gateway/execute");
    expect(gateway).toContain('"apiSlug":"cohere"');
    expect(gateway.toLowerCase()).not.toContain("authorization: bearer ey");
  });
});
