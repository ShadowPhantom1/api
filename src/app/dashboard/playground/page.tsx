import type { Metadata } from "next";
import { SquareTerminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { VerificationBadge } from "@/components/ui/status-badge";
import { ApiConsole } from "@/components/dashboard/api-console";
import { listApis, requireUser } from "@/lib/dashboard/data";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Playground" };
export const dynamic = "force-dynamic";

export default async function PlaygroundPage({
  searchParams,
}: {
  searchParams: Promise<{ api?: string }>;
}) {
  const params = await searchParams;
  const { admin, caller } = await requireUser();
  const [publicApis, mine] = await Promise.all([
    listApis(admin, caller, { scope: "public", perPage: 100 }),
    listApis(admin, caller, { scope: "mine", perPage: 100 }),
  ]);
  const seen = new Set<string>();
  const apis = [...mine.items, ...publicApis.items].filter((api) => {
    if (seen.has(api.id)) return false;
    seen.add(api.id);
    return true;
  });
  const selected = apis.find((api) => api.slug === params.api) ?? apis[0];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title="Test playground"
        description="Send real requests through the same executor used by the gateway. Stored credentials are injected server-side; SSRF checks, timeouts and telemetry always apply."
      />

      {apis.length ? (
        <>
          <Card>
            <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-end">
              <form action="/dashboard/playground" className="flex flex-1 flex-col gap-1.5 md:max-w-xl">
                <label htmlFor="api" className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Endpoint
                </label>
                <div className="flex gap-2">
                  <Select id="api" name="api" defaultValue={selected?.slug}>
                    {apis.map((api) => (
                      <option key={api.id} value={api.slug}>
                        {api.method} · {api.name}
                      </option>
                    ))}
                  </Select>
                  <button type="submit" className={cn(buttonVariants({ variant: "secondary" }))}>
                    Load
                  </button>
                </div>
              </form>
              {selected ? (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <VerificationBadge status={selected.verification_status} />
                  <Badge variant="outline">{selected.method}</Badge>
                  {selected.category ? <Badge variant="secondary">{selected.category.name}</Badge> : null}
                  {selected.is_public ? <Badge variant="info">public</Badge> : <Badge variant="secondary">private</Badge>}
                  <span>{selected.query_params.length} params</span>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {selected ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{selected.name}</CardTitle>
                <CardDescription>{selected.description ?? "No description recorded."}</CardDescription>
              </CardHeader>
              <CardContent>
                <ApiConsole api={selected} />
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : (
        <EmptyState
          title="Nothing to test yet"
          description="Add an endpoint or import a provider first, then return here."
          icon={<SquareTerminal className="h-6 w-6" />}
        />
      )}
    </div>
  );
}
