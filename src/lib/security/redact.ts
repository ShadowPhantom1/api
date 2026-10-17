const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "x-api-key",
  "api-key",
  "x-goog-api-key",
  "x-auth-token",
  "x-csrf-token",
  "x-supabase-auth",
]);

const SENSITIVE_KEY_PATTERN =
  /(pass(word)?|secret|token|api[-_]?key|authorization|credential|private[-_]?key|session|cookie)/i;

const REDACTED = "[REDACTED]";

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? REDACTED : value;
  }
  return out;
}

export function redactValue(key: string, value: unknown): unknown {
  if (typeof value === "string" && (SENSITIVE_KEY_PATTERN.test(key) || value.startsWith("anx_live_"))) {
    return REDACTED;
  }
  return value;
}

export function redactObject<T>(input: T, depth = 0): T {
  if (depth > 6 || input == null) return input;
  if (Array.isArray(input)) {
    return input.map((item) => redactObject(item, depth + 1)) as unknown as T;
  }
  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = REDACTED;
      } else if (typeof value === "string" && value.startsWith("anx_live_")) {
        // Defence in depth: platform secrets are redacted even under an
        // innocuous key name (e.g. a log message field).
        out[key] = REDACTED;
      } else {
        out[key] = redactObject(value, depth + 1);
      }
    }
    return out as T;
  }
  return input;
}

export function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_KEY_PATTERN.test(key)) url.searchParams.set(key, REDACTED);
    }
    if (url.username) url.username = REDACTED;
    if (url.password) url.password = REDACTED;
    return url.toString();
  } catch {
    return "[invalid-url]";
  }
}

/** Safe string form of an unknown thrown value for logs/responses. */
export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unexpected error";
}

export const REDACTION_MARKER = REDACTED;
