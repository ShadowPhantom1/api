import { getApiContext } from "@/lib/api/context";
import { openAiErrorResponse } from "@/lib/ai/http";
import type { AiModelRecord } from "@/lib/db/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { admin, caller } = await getApiContext(request, { scopes: ["models"] });
    const { data, error } = await admin
      .from("ai_models")
      .select("*")
      .eq("is_enabled", true)
      .or(`owner_id.eq.${caller.userId},is_public.eq.true`)
      .order("slug", { ascending: true });
    if (error) throw new Error(error.message);

    const models = (data ?? []) as AiModelRecord[];
    return Response.json({
      object: "list",
      data: models.map((model) => ({
        id: model.slug,
        object: "model",
        created: Math.floor(new Date(model.created_at).getTime() / 1000),
        owned_by: model.is_public ? "anvex" : "user",
        capabilities: model.capabilities,
        context_window: model.context_window,
        anvex: {
          adapter: model.adapter,
          upstream_model: model.upstream_model,
          supports: model.capabilities,
        },
      })),
    });
  } catch (error) {
    return openAiErrorResponse(error);
  }
}
