import { getApiContext } from "@/lib/api/context";
import { setupGuard } from "@/lib/api/http";
import { errorResponse, GatewayError } from "@/lib/executor/errors";
import { assertUserCaller } from "@/lib/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    setupGuard();
    const { admin, caller } = await getApiContext(request, { scopes: [] });
    assertUserCaller(caller);

    const [{ data: providers, error: providerError }, { data: apis, error: apiError }] = await Promise.all([
      admin
        .from("providers")
        .select("id, slug, name, description, homepage_url, base_url, docs_url, terms_url, discovery_adapter, allowed_hosts")
        .order("name"),
      admin.from("apis").select("provider_id, verification_status").eq("is_public", true).eq("is_enabled", true),
    ]);
    if (providerError) throw new GatewayError("query_failed", providerError.message, 500);
    if (apiError) throw new GatewayError("query_failed", apiError.message, 500);

    const counts = new Map<string, { endpoints: number; verified: number }>();
    for (const api of apis ?? []) {
      if (!api.provider_id) continue;
      const entry = counts.get(api.provider_id) ?? { endpoints: 0, verified: 0 };
      entry.endpoints += 1;
      if (api.verification_status === "verified") entry.verified += 1;
      counts.set(api.provider_id, entry);
    }

    const items = (providers ?? []).map((provider) => ({
      ...provider,
      endpoint_count: counts.get(provider.id)?.endpoints ?? 0,
      verified_count: counts.get(provider.id)?.verified ?? 0,
    }));

    return Response.json({ items, total: items.length });
  } catch (error) {
    return errorResponse(error);
  }
}
