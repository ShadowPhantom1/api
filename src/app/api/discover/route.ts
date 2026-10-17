import { getApiContext } from "@/lib/api/context";
import { parseJsonBody, setupGuard } from "@/lib/api/http";
import { assertAdmin } from "@/lib/api/auth";
import { errorResponse, GatewayError } from "@/lib/executor/errors";
import { assertUserCaller } from "@/lib/api/auth";
import { discoverSchema } from "@/lib/registry/schemas";
import { runProviderDiscovery } from "@/lib/discovery/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    setupGuard();
    const { admin, caller } = await getApiContext(request, { scopes: [] });
    assertUserCaller(caller);
    assertAdmin(caller);
    const body = await parseJsonBody(request, discoverSchema);

    const result = await runProviderDiscovery({
      admin,
      userId: caller.userId,
      sourceUrl: body.sourceUrl,
      providerId: body.providerId,
      providerSlug: body.providerSlug,
      adapter: body.adapter,
      manifestPath: body.manifestPath,
    });

    if (result.inspection.endpoints.length === 0) {
      throw new GatewayError(
        "no_endpoints_found",
        `Discovery completed but found no endpoints. ${result.inspection.notes}`,
        422,
      );
    }

    return Response.json({
      run: result.run,
      provider: {
        slug: result.provider.slug,
        name: result.provider.name,
        base_url: result.provider.base_url,
      },
      attempts: result.inspection.attempts,
      notes: result.inspection.notes,
      manifestUrl: result.inspection.manifestUrl,
      openapiUrl: result.inspection.openapiUrl,
      summary: {
        discovered: result.inspection.endpoints.length,
        created: result.summary.created,
        updated: result.summary.updated,
        unchanged: result.summary.unchanged,
        failed: result.summary.failed,
        errors: result.summary.errors.slice(0, 20),
      },
      endpoints: result.inspection.endpoints.slice(0, 200).map((endpoint) => ({
        name: endpoint.name,
        path: endpoint.path,
        method: endpoint.method,
        description: endpoint.description,
        category: endpoint.categoryName,
        queryParams: endpoint.queryParams.map((param) => param.name),
        isNsfw: endpoint.isNsfw,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
