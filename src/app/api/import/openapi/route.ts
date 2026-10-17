import { getApiContext } from "@/lib/api/context";
import { parseJsonBody, setupGuard } from "@/lib/api/http";
import { errorResponse, GatewayError } from "@/lib/executor/errors";
import { importOpenApiSchema } from "@/lib/registry/schemas";
import { parseOpenApiDocument } from "@/lib/discovery/openapi";
import { resolveProvider } from "@/lib/registry/persist";
import { importDiscoveredEndpoints } from "@/lib/discovery/importer";
import { isJsonContentType, safeFetch } from "@/lib/http/safe-fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    setupGuard();
    const { admin, caller } = await getApiContext(request, { scopes: [] });
    const body = await parseJsonBody(request, importOpenApiSchema);

    let document: string | Record<string, unknown>;
    let sourceUrl: string | undefined;
    let fallbackOrigin: string | undefined;

    if (body.document !== undefined) {
      document = body.document;
      if (typeof body.document === "string") {
        if (Buffer.byteLength(body.document, "utf8") > 2_000_000) {
          throw new GatewayError("document_too_large", "Documents are limited to 2 MB.", 413);
        }
      }
    } else if (body.url) {
      sourceUrl = body.url;
      fallbackOrigin = new URL(body.url).origin;
      const response = await safeFetch(body.url, {
        timeoutMs: 20_000,
        maxBytes: 2_000_000,
        onExceed: "throw",
        maxRedirects: 2,
      });
      if (response.status < 200 || response.status >= 300) {
        throw new GatewayError(
          "document_fetch_failed",
          `The specification URL returned HTTP ${response.status}.`,
          502,
        );
      }
      if (!isJsonContentType(response.contentType) && !/yaml|yml|text/i.test(response.contentType)) {
        throw new GatewayError(
          "unsupported_document",
          `Unexpected specification content type: ${response.contentType}.`,
          415,
        );
      }
      document = response.body.toString("utf8");
      if (!isJsonContentType(response.contentType) && !/^\s*[{[]/.test(document)) {
        // YAML: parsed later by the OpenAPI parser.
      }
    } else {
      throw new GatewayError("validation_error", "Provide a document or a URL.", 422);
    }

    let provisional;
    try {
      provisional = parseOpenApiDocument(document, {
        sourceUrl: sourceUrl ?? fallbackOrigin,
        providerSlug: "pending",
      });
    } catch (parseError) {
      throw new GatewayError(
        "invalid_specification",
        parseError instanceof Error ? parseError.message : "Could not parse the specification.",
        422,
      );
    }

    const providerBase = provisional.baseUrl || (sourceUrl ? new URL(sourceUrl).origin : undefined);
    if (!providerBase) {
      throw new GatewayError(
        "invalid_specification",
        "The specification does not define a server URL, and no document URL was provided.",
        422,
      );
    }
    const provider = await resolveProvider(admin, {
      name: body.providerName ?? provisional.title,
      baseUrl: providerBase,
    });
    const parsed = {
      ...provisional,
      endpoints: provisional.endpoints.map((endpoint) => ({
        ...endpoint,
        sourceKey: `${provider.slug}:${endpoint.method}:${endpoint.path}`,
      })),
    };

    if (body.dryRun) {
      return Response.json({
        dryRun: true,
        title: parsed.title,
        version: parsed.version,
        baseUrl: parsed.baseUrl,
        warnings: parsed.warnings,
        preview: parsed.endpoints.slice(0, 100).map((endpoint) => ({
          name: endpoint.name,
          method: endpoint.method,
          path: endpoint.path,
          category: endpoint.categoryName,
          queryParams: endpoint.queryParams.map((param) => param.name),
          pathParams: endpoint.pathParams.map((param) => param.name),
          authType: endpoint.authType,
        })),
      });
    }

    const summary = await importDiscoveredEndpoints({
      admin,
      provider,
      endpoints: parsed.endpoints,
      ownerId: caller.userId,
      createdBy: caller.userId,
      isPublic: body.isPublic,
      isManaged: false,
      discoverySource: "openapi",
      defaultBaseUrl: parsed.baseUrl,
    });

    return Response.json({
      spec: { title: parsed.title, version: parsed.version, baseUrl: parsed.baseUrl },
      warnings: parsed.warnings,
      provider: { slug: provider.slug, name: provider.name },
      summary: {
        imported: parsed.endpoints.length,
        created: summary.created,
        updated: summary.updated,
        unchanged: summary.unchanged,
        failed: summary.failed,
        errors: summary.errors.slice(0, 20),
      },
      note: "Imported APIs are unverified until you run Test on them.",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
