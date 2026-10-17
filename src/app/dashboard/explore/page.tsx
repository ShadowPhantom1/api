import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Compass, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { VerificationBadge } from "@/components/ui/status-badge";
import { getCategoriesWithCounts, listApis, requireUser } from "@/lib/dashboard/data";
import { cn, formatDate, truncate } from "@/lib/utils";

export const metadata: Metadata = { title: "Explore" };
export const dynamic = "force-dynamic";

interface ExploreSearchParams {
  q?: string;
  category?: string;
  page?: string;
  nsfw?: string;
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<ExploreSearchParams>;
}) {
  const params = await searchParams;
  const { admin, caller } = await requireUser();
  const includeNsfw = params.nsfw === "1";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const categories = await getCategoriesWithCounts(admin, { includeNsfw });
  const result = await listApis(admin, caller, {
    scope: "public",
    q: params.q,
    category: params.category,
    page,
    perPage: 24,
    includeNsfw,
  });

  const filterParams = {
    q: params.q,
    category: params.category,
    nsfw: includeNsfw ? "1" : undefined,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Catalog"
        title="Explore public APIs"
        description="Only endpoints registered as public and enabled. Verified means a real upstream request succeeded and the payload was not an error envelope."
        actions={
          <Link href="/dashboard/add" className={cn(buttonVariants({ size: "sm" }))}>
            Add your own <ArrowRight />
          </Link>
        }
      />

      <Card>
        <CardContent className="p-4">
          <form className="grid gap-3 md:grid-cols-[1fr_14rem_auto]" action="/dashboard/explore">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                name="q"
                defaultValue={params.q ?? ""}
                placeholder="Search name, path or description…"
                className="pl-9"
              />
            </div>
            <Select name="category" defaultValue={params.category ?? ""}>
              <option value="">All categories</option>
              {categories.map((category) => (
                <option key={category.slug} value={category.slug}>
                  {category.name} ({category.api_count})
                </option>
              ))}
            </Select>
            <input type="hidden" name="nsfw" value={includeNsfw ? "1" : "0"} />
            <button type="submit" className={cn(buttonVariants({ variant: "secondary" }))}>
              Filter
            </button>
          </form>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <Link
              href="/dashboard/explore"
              className={cn(
                "rounded-full border border-border px-3 py-1",
                !params.category ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              All ({categories.reduce((sum, category) => sum + category.api_count, 0)})
            </Link>
            {categories
              .filter((category) => category.api_count > 0)
              .map((category) => (
                <Link
                  key={category.slug}
                  href={`/dashboard/explore?category=${category.slug}${includeNsfw ? "&nsfw=1" : ""}`}
                  className={cn(
                    "rounded-full border border-border px-3 py-1",
                    params.category === category.slug
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {category.name} ({category.api_count})
                </Link>
              ))}
            <Link
              href={`/dashboard/explore?${new URLSearchParams({
                ...(params.q ? { q: params.q } : {}),
                ...(params.category ? { category: params.category } : {}),
                ...(includeNsfw ? {} : { nsfw: "1" }),
              }).toString()}`}
              className="ml-auto rounded-full border border-dashed border-border px-3 py-1 text-muted-foreground hover:text-foreground"
            >
              {includeNsfw ? "Hide NSFW-flagged" : "Show NSFW-flagged (18+)"}
            </Link>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <p>
          {result.total} endpoint{result.total === 1 ? "" : "s"}
          {params.q ? ` matching “${params.q}”` : ""}
        </p>
        <p>Page {result.page} of {result.totalPages || 1}</p>
      </div>

      {result.items.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {result.items.map((api) => (
            <Link key={api.id} href={`/dashboard/apis/${api.slug}`} className="group">
              <Card className="h-full transition-colors hover:border-primary/50">
                <CardHeader className="gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm group-hover:text-primary">{api.name}</CardTitle>
                    <VerificationBadge status={api.verification_status} />
                  </div>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    <span className="mr-1 rounded bg-secondary px-1 py-0.5 text-foreground">{api.method}</span>
                    {truncate(api.path, 46)}
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {api.description ?? "No description recorded."}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {api.category ? <Badge variant="secondary">{api.category.name}</Badge> : null}
                    {api.provider ? <Badge variant="outline">{api.provider.name}</Badge> : null}
                    {api.is_nsfw ? <Badge variant="warning">NSFW</Badge> : null}
                    {api.supports_streaming ? <Badge variant="info">streaming</Badge> : null}
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{api.query_params.length} params</span>
                    <span>{api.last_tested_at ? `tested ${formatDate(api.last_tested_at)}` : "never tested"}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No endpoints match"
          description="Adjust the filters, or import a new provider from the Import page."
          icon={<Compass className="h-6 w-6" />}
          action={
            <Link href="/dashboard/explore" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              Clear filters
            </Link>
          }
        />
      )}

      <Pagination
        page={result.page}
        totalPages={result.totalPages}
        basePath="/dashboard/explore"
        searchParams={filterParams}
      />
    </div>
  );
}
