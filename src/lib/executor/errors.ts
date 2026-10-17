import { SafeFetchError } from "@/lib/http/safe-fetch";

export class GatewayError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
    this.status = status;
    this.details = details;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

export function toGatewayError(error: unknown): GatewayError {
  if (error instanceof GatewayError) return error;
  if (error instanceof SafeFetchError) {
    return new GatewayError(error.code, error.message, error.status);
  }
  return new GatewayError(
    "internal_error",
    error instanceof Error ? error.message : "Unexpected gateway error.",
    500,
  );
}

export function errorResponse(error: unknown): Response {
  const gatewayError = toGatewayError(error);
  return Response.json(gatewayError.toJSON(), { status: gatewayError.status });
}
