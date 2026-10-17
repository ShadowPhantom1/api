import { getApiContext } from "@/lib/api/context";
import { setupGuard } from "@/lib/api/http";
import { errorResponse, GatewayError } from "@/lib/executor/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
}

export async function GET(request: Request) {
  try {
    setupGuard();
    const { admin } = await getApiContext(request, { scopes: [] });

    const [{ data: categories, error: categoryError }, { data: apis, error: apiError }] = await Promise.all([
      admin.from("categories").select("id, slug, name, description, icon, sort_order").order("sort_order"),
      admin
        .from("apis")
        .select("category_id, verification_status")
        .eq("is_public", true)
        .eq("is_enabled", true),
    ]);

    if (categoryError) throw new GatewayError("query_failed", categoryError.message, 500);
    if (apiError) throw new GatewayError("query_failed", apiError.message, 500);

    const counts = new Map<string, { endpoints: number; verified: number }>();
    for (const api of apis ?? []) {
      if (!api.category_id) continue;
      const entry = counts.get(api.category_id) ?? { endpoints: 0, verified: 0 };
      entry.endpoints += 1;
      if (api.verification_status === "verified") entry.verified += 1;
      counts.set(api.category_id, entry);
    }

    const items = ((categories ?? []) as CategoryRow[]).map((category) => ({
      ...category,
      endpoint_count: counts.get(category.id)?.endpoints ?? 0,
      verified_count: counts.get(category.id)?.verified ?? 0,
    }));

    return Response.json({ items, total: items.length });
  } catch (error) {
    return errorResponse(error);
  }
}
