import "server-only";
import type { AiAdapter, AiCapabilities } from "@/lib/db/types";

/**
 * Capabilities describe what THIS gateway genuinely implements for an adapter.
 * We never advertise streaming, tool calling or usage reporting that the
 * adapter cannot deliver.
 */
export function normalizeCapabilities(
  adapter: AiAdapter,
  requested: Partial<AiCapabilities> | undefined,
): AiCapabilities {
  return {
    chat: true,
    streaming: adapter === "openai_compatible" ? requested?.streaming === true : false,
    tools: false,
    usage: adapter !== "rebix_text",
  };
}

export function defaultAuthHeaderName(adapter: AiAdapter, provided?: string): string {
  if (adapter === "anthropic_messages") return provided || "x-api-key";
  if (adapter === "gemini_generate") return provided || "x-goog-api-key";
  return provided || "X-API-Key";
}

export function adapterSummary(adapter: AiAdapter): string {
  switch (adapter) {
    case "openai_compatible":
      return "Calls an OpenAI-compatible /chat/completions endpoint. Supports SSE streaming when enabled.";
    case "anthropic_messages":
      return "Calls Anthropic's Messages API and translates responses. Streaming and tool calling are not supported by this adapter.";
    case "gemini_generate":
      return "Calls Gemini generateContent and translates responses. Streaming and tool calling are not supported by this adapter.";
    case "rebix_text":
      return "Maps the last user message to a simple GET ?q= API on this platform. No streaming, tools, or token usage reporting.";
    default:
      return "Unknown adapter.";
  }
}

export const SUPPORTED_ADAPTERS: AiAdapter[] = [
  "openai_compatible",
  "anthropic_messages",
  "gemini_generate",
  "rebix_text",
];
