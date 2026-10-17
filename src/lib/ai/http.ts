import { toGatewayError } from "@/lib/executor/errors";

function openAiErrorType(code: string): string {
  switch (code) {
    case "unauthorized":
    case "invalid_api_key":
    case "invalid_token":
    case "key_revoked":
    case "key_expired":
      return "authentication_error";
    case "insufficient_scope":
    case "forbidden":
      return "permission_error";
    case "rate_limited":
      return "rate_limit_error";
    case "not_found":
    case "model_not_found":
      return "not_found_error";
    case "validation_error":
    case "invalid_request":
    case "unsupported_parameter":
      return "invalid_request_error";
    default:
      return "server_error";
  }
}

/** OpenAI-compatible error envelope for /v1 routes. */
export function openAiErrorResponse(error: unknown): Response {
  const gatewayError = toGatewayError(error);
  return Response.json(
    {
      error: {
        message: gatewayError.message,
        type: openAiErrorType(gatewayError.code),
        code: gatewayError.code,
        param: null,
      },
    },
    { status: gatewayError.status },
  );
}
