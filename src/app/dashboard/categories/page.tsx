import type { Metadata } from "next";
import Link from "next/link";
import { Boxes, Grid2x2, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getCategoriesWithCounts, getProvidersWithCounts, requireUser } from "@/lib/dashboard/data";

export const metadata: Metadata = { title: "Categories" };
export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const { admin } = await requireUser();
  const [categories, providers] = await Promise.all([
    getCategoriesWithCounts(admin),
    getProvidersWithCounts(admin),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Catalog"
        title="Categories & providers"
        description="Counts are computed from public, enabled endpoints. A category with zero routes is kept visible so gaps in the catalog are explicit."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {categories.map((category) => (
          <Link key={category.slug} href={`/dashboard/explore?category=${category.slug}`}>
            <Card className="h-full transition-colors hover:border-primary/50">
              <CardHeader className="flex-row items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-sm">{category.name}</CardTitle>
                  <CardDescription className="mt-1 line-clamp-2">
                    {category.description ?? "No description."}
                  </CardDescription>
                </div>
                <Grid2x2 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Boxes className="h-3.5 w-3.5" /> {category.api_count} endpoints
                </span>
                <span className="flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5 text-success" /> {category.verified_count} verified
                </span>
                {category.nsfw_count ? <Badge variant="warning">{category.nsfw_count} NSFW</Badge> : null}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Providers</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {providers.map((provider) => (
            <Card key={provider.id}>
              <CardHeader className="flex-row items-start justify-between">
                <div>
                  <CardTitle className="text-sm">{provider.name}</CardTitle>
                  <CardDescription className="mt-1 line-clamp-2">
                    {provider.description ?? "No description."}
                  </CardDescription>
                </div>
                <Badge variant="secondary">{provider.api_count} APIs</Badge>
              </CardHeader>
              <CardContent className="space-y-2 text-xs text-muted-foreground">
                <p className="font-mono">{provider.base_url ?? "—"}</p>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline">adapter: {provider.discovery_adapter}</Badge>
                  <Badge variant="success">{provider.verified_count} verified</Badge>
                </div>
                <div className="flex gap-3">
                  {provider.homepage_url ? (
                    <a href={provider.homepage_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      Homepage
                    </a>
                  ) : null}
                  {provider.docs_url ? (
                    <a href={provider.docs_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      Docs
                    </a>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
