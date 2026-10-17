import { z } from "zod";
import { getApiContext } from "@/lib/api/context";
import { parseJsonBody, setupGuard } from "@/lib/api/http";
import { errorResponse, GatewayError } from "@/lib/executor/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const profileSchema = z.object({
  displayName: z.string().min(1).max(80),
});

export async function PATCH(request: Request) {
  try {
    setupGuard();
    const { admin, caller } = await getApiContext(request, { scopes: [] });
    const body = await parseJsonBody(request, profileSchema);
    const { error } = await admin
      .from("profiles")
      .update({ display_name: body.displayName })
      .eq("id", caller.userId);
    if (error) throw new GatewayError("update_failed", error.message, 500);
    return Response.json({ ok: true, displayName: body.displayName });
  } catch (error) {
    return errorResponse(error);
  }
}
