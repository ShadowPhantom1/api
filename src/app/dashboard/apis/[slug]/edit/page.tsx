import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ApiForm } from "@/components/dashboard/api-form";
import { PageHeader } from "@/components/ui/page-header";
import { getApiForViewer, getCategoryOptions, requireUser } from "@/lib/dashboard/data";

export const metadata: Metadata = { title: "Edit API" };
export const dynamic = "force-dynamic";

export default async function EditApiPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { admin, caller } = await requireUser();
  const api = await getApiForViewer(admin, caller, slug);
  if (!api) notFound();
  if (api.owner_id !== caller.userId && !caller.isAdmin) notFound();

  const categories = await getCategoryOptions(admin);

  return (
    <div className="space-y-6">
      <Link
        href={`/dashboard/apis/${api.slug}`}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to endpoint
      </Link>
      <PageHeader
        eyebrow="Registry"
        title={`Edit ${api.name}`}
        description="Stored credentials are never sent to the browser. Leave credential fields blank to keep the existing encrypted value."
      />
      <ApiForm
        categories={categories}
        mode="edit"
        initial={{
          id: api.id,
          slug: api.slug,
          name: api.name,
          description: api.description,
          base_url: api.base_url,
          path: api.path,
          method: api.method,
          query_params: api.query_params,
          path_params: api.path_params,
          headers_schema: api.headers_schema,
          body_schema: api.body_schema,
          auth_type: api.auth_type,
          auth_config_meta: api.auth_config_meta,
          content_type: api.content_type,
          docs_url: api.docs_url,
          source_url: api.source_url,
          is_public: api.is_public,
          is_enabled: api.is_enabled,
          is_nsfw: api.is_nsfw,
          allow_extra_query: api.allow_extra_query,
          supports_streaming: api.supports_streaming,
          timeout_ms: api.timeout_ms,
          response_example: api.response_example,
          credential_configured: api.credential_configured,
          category: api.category ?? null,
        }}
      />
    </div>
  );
}
