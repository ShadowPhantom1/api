import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ImportForm } from "@/components/dashboard/import-form";
import { requireUser } from "@/lib/dashboard/data";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Import APIs" };
export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const { admin, isAdmin } = await requireUser();
  const { data: runs } = isAdmin
    ? await admin
        .from("discovery_runs")
        .select("id, status, adapter, source_url, created_count, updated_count, failed_count, started_at, notes")
        .order("started_at", { ascending: false })
        .limit(8)
    : { data: [] };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Discovery"
        title="Import APIs"
        description="Bring in a whole provider from an OpenAPI document or by probing its public catalog. Imports are recorded with source URL and discovery timestamp; verification stays separate."
      />
      <ImportForm isAdmin={isAdmin} />

      <Card>
        <CardHeader>
          <CardTitle>Recent discovery runs</CardTitle>
          <CardDescription>Administrator-only log of discovery attempts.</CardDescription>
        </CardHeader>
        <CardContent>
          {isAdmin ? (
            runs && runs.length ? (
              <div className="space-y-2">
                {runs.map((run) => (
                  <div key={run.id} className="rounded-md border border-border/70 bg-background/40 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="break-all font-mono text-xs">{run.source_url}</p>
                      <div className="flex items-center gap-2">
                        <Badge variant={run.status === "success" ? "success" : run.status === "failed" ? "destructive" : "warning"}>
                          {run.status}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground">{run.adapter}</span>
                      </div>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                      <span>{formatDate(run.started_at)}</span>
                      <span>+{run.created_count} created</span>
                      <span>~{run.updated_count} updated</span>
                      {run.failed_count ? <span className="text-destructive">{run.failed_count} failed</span> : null}
                    </div>
                    {run.notes ? <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{run.notes}</p> : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No discovery runs yet.</p>
            )
          ) : (
            <p className="text-sm text-muted-foreground">
              Discovery runs are visible to administrators. You can still import an OpenAPI document above.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
