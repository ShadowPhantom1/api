"use client";

import { useEffect, useState } from "react";
import { BarChart3, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { StatCard } from "@/components/ui/stat-card";
import { apiFetch, errorMessage } from "@/lib/client/api";
import { formatBytes } from "@/lib/utils";

interface UsageResponse {
  range: { days: number; since: string; scope: string };
  sampled: { rows: number; truncated: boolean; maxRows: number };
  totals: {
    requests: number;
    ok: number;
    errors: number;
    errorRate: number | null;
    avgDurationMs: number | null;
    responseBytes: number;
  };
  daily: Array<{ date: string; requests: number; errors: number; avgDurationMs: number | null }>;
  byKind: Array<{ kind: string; requests: number; errors: number }>;
  byStatusClass: Array<{ statusClass: string; requests: number }>;
  topApis: Array<{
    apiId: string;
    name: string;
    slug: string | null;
    requests: number;
    errors: number;
    avgDurationMs: number | null;
  }>;
}

export function UsageDashboard({ isAdmin }: { isAdmin: boolean }) {
  const [days, setDays] = useState(30);
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<UsageResponse>(`/api/usage?days=${days}&scope=${scope}`, { signal: controller.signal })
      .then((payload) => {
        if (!controller.signal.aborted) setData(payload);
      })
      .catch((loadError) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(loadError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [days, scope, nonce]);

  const maxDaily = Math.max(1, ...(data?.daily.map((day) => day.requests) ?? [1]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="usageDays" className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Range
          </label>
          <Select id="usageDays" value={String(days)} onChange={(event) => setDays(Number.parseInt(event.target.value, 10))}>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
          </Select>
        </div>
        <div className="space-y-1">
          <label htmlFor="usageScope" className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Scope
          </label>
          <Select id="usageScope" value={scope} onChange={(event) => setScope(event.target.value as "mine" | "all")}>
            <option value="mine">My requests</option>
            {isAdmin ? <option value="all">Workspace (admin)</option> : null}
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={() => setNonce((value) => value + 1)} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} Refresh
        </Button>
        {data ? (
          <p className="ml-auto text-[11px] text-muted-foreground">
            Sample: {data.sampled.rows} rows{data.sampled.truncated ? ` (capped at ${data.sampled.maxRows})` : ""}
          </p>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-lg border border-border bg-card/60" />
          ))}
        </div>
      ) : null}

      {data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Requests" value={data.totals.requests} hint={`${data.range.days}-day sample`} icon={<BarChart3 className="h-4 w-4" />} />
            <StatCard
              label="Errors"
              value={data.totals.errors}
              hint={data.totals.errorRate === null ? "No sample" : `${data.totals.errorRate}% error rate`}
              icon={<TriangleAlert className="h-4 w-4" />}
            />
            <StatCard
              label="Avg latency"
              value={data.totals.avgDurationMs === null ? "—" : `${data.totals.avgDurationMs} ms`}
              hint="Rows with a recorded duration"
            />
            <StatCard label="Response bytes" value={formatBytes(data.totals.responseBytes)} hint="Sum of recorded sizes" />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Daily requests</CardTitle>
              <CardDescription>UTC days. Errors are shown as a darker segment.</CardDescription>
            </CardHeader>
            <CardContent>
              {data.totals.requests ? (
                <div className="flex h-56 items-end gap-1">
                  {data.daily.map((day) => {
                    const height = Math.max(day.requests ? 6 : 2, Math.round((day.requests / maxDaily) * 200));
                    const errorHeight = day.requests ? Math.round((day.errors / Math.max(day.requests, 1)) * height) : 0;
                    return (
                      <div key={day.date} className="group relative flex flex-1 flex-col items-center justify-end gap-1">
                        <div className="relative w-full max-w-6 overflow-hidden rounded-t bg-primary/60" style={{ height }}>
                          {errorHeight ? (
                            <div
                              className="absolute inset-x-0 top-0 bg-destructive/80"
                              style={{ height: errorHeight }}
                            />
                          ) : null}
                        </div>
                        <span className="hidden text-[9px] text-muted-foreground sm:block">{day.date.slice(5)}</span>
                        <div className="pointer-events-none absolute bottom-full z-10 mb-1 hidden whitespace-nowrap rounded border border-border bg-popover px-2 py-1 text-[10px] text-foreground group-hover:block">
                          {day.date}: {day.requests} req · {day.errors} err
                          {day.avgDurationMs === null ? "" : ` · ${day.avgDurationMs} ms`}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  title="No requests in this range"
                  description="Run an endpoint from the playground or call the gateway with a platform key."
                  className="border-0 bg-transparent py-8"
                />
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">By kind</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {data.byKind.length ? (
                  data.byKind.map((row) => (
                    <div key={row.kind} className="flex items-center justify-between">
                      <span className="font-mono">{row.kind}</span>
                      <span>
                        {row.requests} req {row.errors ? `· ${row.errors} err` : ""}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground">No rows.</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">By status class</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {data.byStatusClass.length ? (
                  data.byStatusClass.map((row) => (
                    <div key={row.statusClass} className="flex items-center justify-between">
                      <Badge variant={row.statusClass === "2xx" ? "success" : row.statusClass === "5xx" ? "destructive" : "secondary"}>
                        {row.statusClass}
                      </Badge>
                      <span>{row.requests} requests</span>
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground">No rows.</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Top endpoints</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {data.topApis.length ? (
                  data.topApis.map((row) => (
                    <div key={row.apiId} className="flex items-center justify-between gap-2">
                      <span className="truncate">{row.name}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {row.requests} req · {row.avgDurationMs ?? "—"} ms
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground">No endpoint-attributed requests.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Aggregates are computed from <span className="font-mono">api_requests</span> metadata. Request bodies,
            query values and headers are never stored. Capped sampling keeps dashboard queries bounded.
          </p>
        </>
      ) : null}
    </div>
  );
}
