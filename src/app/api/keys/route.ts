import { getApiContext } from "@/lib/api/context";
import { parseJsonBody, setupGuard } from "@/lib/api/http";
import { errorResponse, GatewayError } from "@/lib/executor/errors";
import { assertUserCaller } from "@/lib/api/auth";
import { createKeySchema } from "@/lib/registry/schemas";
import { generatePlatformKey } from "@/lib/security/keys";
import { serializePlatformKey } from "@/lib/api/serialize";
import type { PlatformKeyRecord } from "@/lib/db/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    setupGuard();
    const { admin, caller } = await getApiContext(request, { scopes: [] });
    assertUserCaller(caller);
    const { data, error } = await admin
      .from("platform_api_keys")
      .select("*")
      .eq("user_id", caller.userId)
      .order("created_at", { ascending: false });
    if (error) throw new GatewayError("query_failed", error.message, 500);
    return Response.json({
      items: ((data ?? []) as PlatformKeyRecord[]).map(serializePlatformKey),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    setupGuard();
    const { admin, caller } = await getApiContext(request, { scopes: [] });
    assertUserCaller(caller);
    const body = await parseJsonBody(request, createKeySchema);
    const generated = generatePlatformKey();
    const expiresAt = body.expiresInDays
      ? new Date(Date.now() + body.expiresInDays * 86_400_000).toISOString()
      : null;

    const { data, error } = await admin
      .from("platform_api_keys")
      .insert({
        user_id: caller.userId,
        name: body.name,
        prefix: generated.prefix,
        key_hash: generated.hash,
        last_four: generated.lastFour,
        permissions: body.permissions,
        rate_limit_per_minute: body.rateLimitPerMinute,
        expires_at: expiresAt,
      })
      .select("*")
      .single();
    if (error) throw new GatewayError("insert_failed", error.message, 500);

    return Response.json(
      {
        secret: generated.secret,
        warning: "Copy this key now. Only its digest is stored and it cannot be shown again.",
        key: serializePlatformKey(data as PlatformKeyRecord),
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
