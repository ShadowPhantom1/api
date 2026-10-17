"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, History, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch, errorMessage } from "@/lib/client/api";
import { formatBytes, formatDate } from "@/lib/utils";

interface HistoryItem {
  id: number;
  kind: string;
  method: string | null;
  status_code: number | null;
  duration_ms: number | null;
  response_bytes: number | null;
  ok: boolean;
  error_code: string | null;
  created_at: string;
  api: { name: string; slug: string } | null;
  model: { name: string; slug: string } | null;
}

interface HistoryResponse {
  items: HistoryItem[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

export function HistoryTable({ isAdmin }: { isAdmin: boolean }) {
  const [days, setDays] = useState(30);
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ days: String(days), page: String(page), perPage: "25", scope });
    if (kind) params.set("kind", kind);
    if (status) params.set("status", status);
    apiFetch<HistoryResponse>(`/api/requests?${params.toString()}`, { signal: controller.signal })
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
  }, [days, kind, status, scope, page, nonce]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Range</label>
          <Select value={String(days)} onChange={(event) => { setDays(Number.parseInt(event.target.value, 10)); setPage(1); }}>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Kind</label>
          <Select value={kind} onChange={(event) => { setKind(event.target.value); setPage(1); }}>
            <option value="">All</option>
            <option value="rest">rest</option>
            <option value="ai_chat">ai_chat</option>
            <option value="discovery_test">discovery_test</option>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Status</label>
          <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
            <option value="">All</option>
            <option value="ok">Successful</option>
            <option value="error">Failed</option>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Scope</label>
          <Select value={scope} onChange={(event) => { setScope(event.target.value as "mine" | "all"); setPage(1); }}>
            <option value="mine">My requests</option>
            {isAdmin ? <option value="all">Workspace</option> : null}
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={() => setNonce((value) => value + 1)} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} Refresh
        </Button>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Requests</CardTitle>
          <CardDescription>
            Metadata only. No query values, request headers or bodies are stored, so this view cannot leak inputs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {data?.items.length ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Endpoint</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Latency</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Key</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(item.created_at)}</TableCell>
                      <TableCell>
                        <p className="text-sm font-medium">{item.api?.name ?? item.model?.name ?? "—"}</p>
                        <p className="font-mono text-[11px] text-muted-foreground">{item.api?.slug ?? item.model?.slug ?? ""}</p>
                      </TableCell>
                      <TableCell className="text-xs">{item.kind}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge variant={item.ok ? "success" : "destructive"}>
                            {item.status_code ?? item.error_code ?? "error"}
                          </Badge>
                          {item.error_code ? <span className="font-mono text-[10px] text-muted-foreground">{item.error_code}</span> : null}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{item.duration_ms === null ? "—" : `${item.duration_ms} ms`}</TableCell>
                      <TableCell className="font-mono text-xs">{formatBytes(item.response_bytes)}</TableCell>
                      <TableCell className="text-[11px] text-muted-foreground">{item.method ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <p>
                  {data.total} records · page {data.page} of {data.totalPages || 1}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                    <ChevronLeft /> Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={data.totalPages === 0 || page >= data.totalPages}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    Next <ChevronRight />
                  </Button>
                </div>
              </div>
            </>
          ) : loading ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading request history…
            </p>
          ) : (
            <EmptyState
              title="No requests recorded"
              description="Gateway and playground calls appear here after they happen. Adjust the filters if you expect older rows."
              icon={<History className="h-6 w-6" />}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
