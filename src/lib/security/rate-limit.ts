import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  windowSeconds: number;
}

/**
 * Atomic, database-backed sliding-window limiter.
 * The SQL function takes a transaction-scoped advisory lock per subject.
 */
export async function consumeRateLimit(
  admin: SupabaseClient,
  subject: string,
  limit: number,
  windowSeconds = 60,
): Promise<RateLimitResult> {
  const safeLimit = Math.max(1, Math.min(limit, 10_000));
  const { data, error } = await admin.rpc("consume_rate_limit", {
    p_subject: subject,
    p_limit: safeLimit,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    // Fail closed for authenticated gateway traffic. Ops can see the error in logs.
    console.error("[rate-limit] rpc failed", error.message);
    return { allowed: false, remaining: 0, limit: safeLimit, windowSeconds };
  }

  const allowed = data === true;
  return {
    allowed,
    remaining: allowed ? Math.max(0, safeLimit - 1) : 0,
    limit: safeLimit,
    windowSeconds,
  };
}

export function rateLimitResponse(result: RateLimitResult): Response {
  return Response.json(
    {
      error: {
        code: "rate_limited",
        message: `Rate limit exceeded (${result.limit} requests / ${result.windowSeconds}s). Retry soon.`,
      },
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.windowSeconds),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": "0",
      },
    },
  );
}
