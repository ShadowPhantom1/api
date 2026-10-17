import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RequestKind } from "@/lib/db/types";

export interface UsageLogEntry {
  userId?: string | null;
  apiId?: string | null;
  aiModelId?: string | null;
  platformKeyId?: string | null;
  kind: RequestKind;
  method?: string | null;
  statusCode?: number | null;
  durationMs?: number | null;
  responseBytes?: number | null;
  ok: boolean;
  errorCode?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
}

/**
 * Telemetry contains only metadata: never request bodies, query values,
 * headers, upstream URLs or credentials.
 */
export async function logRequest(admin: SupabaseClient, entry: UsageLogEntry): Promise<void> {
  try {
    const { error } = await admin.from("api_requests").insert({
      user_id: entry.userId ?? null,
      api_id: entry.apiId ?? null,
      ai_model_id: entry.aiModelId ?? null,
      platform_key_id: entry.platformKeyId ?? null,
      kind: entry.kind,
      method: entry.method ?? null,
      status_code: entry.statusCode ?? null,
      duration_ms: entry.durationMs ?? null,
      response_bytes: entry.responseBytes ?? null,
      ok: entry.ok,
      error_code: entry.errorCode ?? null,
      prompt_tokens: entry.promptTokens ?? null,
      completion_tokens: entry.completionTokens ?? null,
    });
    if (error) console.error("[usage] insert failed:", error.message);
  } catch (error) {
    console.error("[usage] insert threw:", error instanceof Error ? error.message : "unknown");
  }
}
