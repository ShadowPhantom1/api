import { getApiContext } from "@/lib/api/context";
import { setupGuard } from "@/lib/api/http";
import { errorResponse, GatewayError } from "@/lib/executor/errors";
import { assertUserCaller } from "@/lib/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    setupGuard();
    const { admin, caller } = await getApiContext(request, { scopes: [] });
    assertUserCaller(caller);
    const { id } = await context.params;

    const { data, error } = await admin
      .from("platform_api_keys")
      .select("id, user_id, revoked_at")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new GatewayError("query_failed", error.message, 500);
    if (!data || (data.user_id !== caller.userId && !caller.isAdmin)) {
      throw new GatewayError("not_found", "API key not found.", 404);
    }
    if (data.revoked_at) {
      return Response.json({ ok: true, alreadyRevoked: true });
    }

    const { error: updateError } = await admin
      .from("platform_api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id);
    if (updateError) throw new GatewayError("update_failed", updateError.message, 500);

    return Response.json({ ok: true, revoked: true });
  } catch (error) {
    return errorResponse(error);
  }
}
