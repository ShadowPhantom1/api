import type { Metadata } from "next";
import Link from "next/link";
import { Boxes, ExternalLink, PlusCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { VerificationBadge } from "@/components/ui/status-badge";
import { listApis, requireUser } from "@/lib/dashboard/data";
import { cn, formatDate, truncate } from "@/lib/utils";

export const metadata: Metadata = { title: "My APIs" };
export const dynamic = "force-dynamic";

export default async function MyApisPage() {
  const { admin, caller } = await requireUser();
  const result = await listApis(admin, caller, { scope: "mine", perPage: 100 });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title="My APIs"
        description="Endpoints you created or imported. Private by default; changing visibility takes effect immediately."
        actions={
          <Link href="/dashboard/add" className={cn(buttonVariants({ size: "sm" }))}>
            <PlusCircle /> Add API
          </Link>
        }
      />

      {result.items.length ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-sm">{result.total} endpoint{result.total === 1 ? "" : "s"}</CardTitle>
            <Link href="/dashboard/explore" className="text-xs text-primary hover:underline">
              Browse public catalog
            </Link>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Visibility</TableHead>
                  <TableHead>Verification</TableHead>
                  <TableHead>Params</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((api) => (
                  <TableRow key={api.id}>
                    <TableCell>
                      <Link href={`/dashboard/apis/${api.slug}`} className="group block">
                        <p className="font-medium group-hover:text-primary">{api.name}</p>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {api.method} {truncate(api.path, 60)}
                        </p>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant={api.is_public ? "info" : "secondary"}>{api.is_public ? "public" : "private"}</Badge>
                        {api.is_enabled ? null : <Badge variant="outline">disabled</Badge>}
                        {api.is_nsfw ? <Badge variant="warning">NSFW</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <VerificationBadge status={api.verification_status} />
                        <span className="text-[10px] text-muted-foreground">
                          {api.last_tested_at ? formatDate(api.last_tested_at) : "never tested"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{api.query_params.length}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(api.updated_at)}</TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/dashboard/apis/${api.slug}/edit`}
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        Edit <ExternalLink className="h-3 w-3" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          title="You have not added an endpoint yet"
          description="Add one manually with a URL and parameter list, or import an OpenAPI document. The registry is dynamic — no deploy required."
          icon={<Boxes className="h-6 w-6" />}
          action={
            <div className="flex gap-2">
              <Link href="/dashboard/add" className={cn(buttonVariants({ size: "sm" }))}>
                Add API
              </Link>
              <Link href="/dashboard/import" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                Import
              </Link>
            </div>
          }
        />
      )}
    </div>
  );
}
