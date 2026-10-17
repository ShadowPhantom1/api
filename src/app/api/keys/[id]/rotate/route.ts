import { getApiContext } from "@/lib/api/context";
import { setupGuard } from "@/lib/api/http";
import { errorResponse, GatewayError } from "@/lib/executor/errors";
import { assertUserCaller } from "@/lib/api/auth";
import { generatePlatformKey } from "@/lib/security/keys";
import { serializePlatformKey } from "@/lib/api/serialize";
import type { PlatformKeyRecord } from "@/lib/db/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    setupGuard();
    const { admin, caller } = await getApiContext(request, { scopes: [] });
    assertUserCaller(caller);
    const { id } = await context.params;

    const { data: existing, error } = await admin
      .from("platform_api_keys")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new GatewayError("query_failed", error.message, 500);
    if (!existing || (existing.user_id !== caller.userId && !caller.isAdmin)) {
      throw new GatewayError("not_found", "API key not found.", 404);
    }
    if (existing.revoked_at) {
      throw new GatewayError("key_revoked", "Cannot rotate a revoked key.", 409);
    }

    const generated = generatePlatformKey();
    const { data: created, error: insertError } = await admin
      .from("platform_api_keys")
      .insert({
        user_id: existing.user_id,
        name: existing.name,
        prefix: generated.prefix,
        key_hash: generated.hash,
        last_four: generated.lastFour,
        permissions: existing.permissions,
        rate_limit_per_minute: existing.rate_limit_per_minute,
        expires_at: existing.expires_at,
        rotated_from: existing.id,
      })
      .select("*")
      .single();
    if (insertError) throw new GatewayError("insert_failed", insertError.message, 500);

    await admin
      .from("platform_api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", existing.id);

    return Response.json(
      {
        secret: generated.secret,
        warning: "Copy the new key now. The previous key has been revoked.",
        key: serializePlatformKey(created as PlatformKeyRecord),
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
