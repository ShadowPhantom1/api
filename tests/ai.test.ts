import { describe, expect, it } from "vitest";
import { adapterSummary, normalizeCapabilities } from "@/lib/ai/models";

describe("AI capability honesty", () => {
  it("never advertises streaming/tools for the Rebix text adapter", () => {
    const caps = normalizeCapabilities("rebix_text", {
      chat: true,
      streaming: true,
      tools: true,
      usage: true,
    });
    expect(caps.chat).toBe(true);
    expect(caps.streaming).toBe(false);
    expect(caps.tools).toBe(false);
    expect(caps.usage).toBe(false);
  });

  it("only enables streaming when the adapter genuinely supports it", () => {
    expect(normalizeCapabilities("openai_compatible", { streaming: true }).streaming).toBe(true);
    expect(normalizeCapabilities("anthropic_messages", { streaming: true }).streaming).toBe(false);
    expect(normalizeCapabilities("gemini_generate", {}).tools).toBe(false);
  });

  it("documents adapter limitations", () => {
    expect(adapterSummary("rebix_text")).toMatch(/no streaming/i);
    expect(adapterSummary("openai_compatible")).toMatch(/streaming/i);
  });
});
