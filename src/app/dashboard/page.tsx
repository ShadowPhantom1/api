import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock,
  KeyRound,
  PlusCircle,
  Server,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCategoryOptions, getOverviewData, requireUser } from "@/lib/dashboard/data";
import { cn, formatDate, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { admin, caller, user, isAdmin } = await requireUser();
  const [overview, categories] = await Promise.all([
    getOverviewData(admin, caller),
    getCategoryOptions(admin),
  ]);
  const { stats } = overview;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Workspace"
        title={`Hello, ${user.email?.split("@")[0] ?? "developer"}`}
        description="Real registry counts and your own gateway telemetry. Nothing here is pre-seeded demo data."
        actions={
          <>
            <Link href="/dashboard/add" className={cn(buttonVariants({ size: "sm" }))}>
              <PlusCircle /> Add API
            </Link>
            <Link href="/dashboard/explore" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              Explore catalog
            </Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Public endpoints"
          value={stats.publicEndpoints}
          hint={`${stats.verifiedEndpoints} verified by a real request`}
          icon={<Server className="h-4 w-4" />}
        />
        <StatCard
          label="My endpoints"
          value={stats.myEndpoints}
          hint="Private unless you mark them public"
          icon={<PlusCircle className="h-4 w-4" />}
        />
        <StatCard
          label="Requests · 24h"
          value={stats.requests24h}
          hint={`${stats.requests7d} sampled in 7 days`}
          icon={<BarChart3 className="h-4 w-4" />}
        />
        <StatCard
          label="Avg latency · 7d"
          value={stats.avgDuration7dMs === null ? "—" : `${stats.avgDuration7dMs} ms`}
          hint={stats.requests7d ? `${stats.errors7d} errors in sample` : "No requests yet"}
          icon={<Clock className="h-4 w-4" />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Recent requests</CardTitle>
              <CardDescription>Your last gateway calls, metadata only.</CardDescription>
            </div>
            <Link href="/dashboard/history" className="text-xs text-primary hover:underline">
              Full history
            </Link>
          </CardHeader>
          <CardContent>
            {overview.recentRequests.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Endpoint</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Latency</TableHead>
                    <TableHead className="text-right">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview.recentRequests.map((request) => (
                    <TableRow key={request.id}>
                      <TableCell>
                        <p className="font-medium">
                          {request.api?.name ?? request.model?.name ?? "Deleted endpoint"}
                        </p>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {request.method ?? "—"} · {request.kind}
                        </p>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{request.kind}</TableCell>
                      <TableCell>
                        <Badge variant={request.ok ? "success" : "destructive"}>
                          {request.status_code ?? request.error_code ?? "error"}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {request.duration_ms === null ? "—" : `${request.duration_ms} ms`}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {relativeTime(request.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                title="No requests yet"
                description="Try an endpoint from the playground. Every call is logged with duration and status — never with query values or bodies."
                icon={<BarChart3 className="h-6 w-6" />}
                action={
                  <Link href="/dashboard/playground" className={cn(buttonVariants({ size: "sm" }))}>
                    Open playground <ArrowRight />
                  </Link>
                }
              />
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Gateway access</CardTitle>
              <CardDescription>Platform keys for scripts and the OpenAI-compatible API.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between rounded-md border border-border/70 bg-background/40 px-3 py-2">
                <div className="flex items-center gap-2 text-sm">
                  <KeyRound className="h-4 w-4 text-primary" /> Active keys
                </div>
                <span className="font-mono text-sm">{stats.activeKeys}</span>
              </div>
              <div className="flex items-center justify-between rounded-md border border-border/70 bg-background/40 px-3 py-2">
                <div className="flex items-center gap-2 text-sm">
                  <Sparkles className="h-4 w-4 text-primary" /> Categories
                </div>
                <span className="font-mono text-sm">{categories.length}</span>
              </div>
              <Link href="/dashboard/keys" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full")}>
                Manage keys
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quality signals</CardTitle>
              <CardDescription>Derived from live registry state.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-success" /> Verified share
                </span>
                <span className="font-mono">
                  {stats.publicEndpoints
                    ? `${Math.round((stats.verifiedEndpoints / stats.publicEndpoints) * 100)}%`
                    : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <TriangleAlert className="h-4 w-4 text-amber-300" /> 7d error rate
                </span>
                <span className="font-mono">
                  {stats.requests7d
                    ? `${Math.round((stats.errors7d / stats.requests7d) * 1000) / 10}%`
                    : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <ShieldCheck className="h-4 w-4 text-accent" /> Registry mode
                </span>
                <Badge variant="outline" className="text-[10px]">database</Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {isAdmin ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Recent discovery runs</CardTitle>
              <CardDescription>Every attempt and its source URL is recorded.</CardDescription>
            </div>
            <Link href="/dashboard/import" className="text-xs text-primary hover:underline">
              Run discovery
            </Link>
          </CardHeader>
          <CardContent>
            {overview.recentDiscoveries.length ? (
              <div className="space-y-2">
                {overview.recentDiscoveries.map((run) => (
                  <div
                    key={run.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 bg-background/40 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs">{run.source_url}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {run.adapter} · {formatDate(run.started_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={run.status === "success" ? "success" : run.status === "failed" ? "destructive" : "warning"}>
                        {run.status}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">
                        +{run.created_count} / ~{run.updated_count}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No discovery runs recorded yet.</p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
