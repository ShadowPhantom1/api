import type { output, ZodTypeAny } from "zod";
import { GatewayError } from "@/lib/executor/errors";
import { assertAdminBackend, isSupabaseConfigured } from "@/lib/env";

export async function parseJsonBody<S extends ZodTypeAny>(request: Request, schema: S): Promise<output<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new GatewayError("invalid_json", "Request body must be valid JSON.", 400);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    throw new GatewayError("validation_error", "Request validation failed.", 422, issues);
  }
  return result.data;
}

export function jsonResponse(data: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(data, { status, headers });
}

export function setupGuard(): void {
  if (!isSupabaseConfigured()) {
    throw new GatewayError(
      "setup_required",
      "Supabase is not configured for this deployment. See SETUP.md.",
      503,
    );
  }
  assertAdminBackend();
}

export function requestSearchParams(request: Request): URLSearchParams {
  return new URL(request.url).searchParams;
}

export function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = value == null ? Number.NaN : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}
