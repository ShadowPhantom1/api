export class ClientApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly details: unknown;

  constructor(message: string, status: number, code: string | null, details?: unknown) {
    super(message);
    this.name = "ClientApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function apiFetch<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const shape = payload as {
      error?: { message?: string; code?: string; details?: unknown };
    } | null;
    const details = shape?.error?.details;
    const issueText =
      Array.isArray(details) && details.length
        ? ` (${details
            .map((issue) =>
              typeof issue === "object" && issue && "path" in issue && "message" in issue
                ? `${String((issue as { path: unknown }).path)}: ${String((issue as { message: unknown }).message)}`
                : String(issue),
            )
            .join("; ")})`
        : "";
    throw new ClientApiError(
      `${shape?.error?.message ?? `Request failed with HTTP ${response.status}`}${issueText}`,
      response.status,
      shape?.error?.code ?? null,
      details,
    );
  }
  return payload as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
