import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CalendarClock,
  ExternalLink,
  KeyRound,
  Radio,
  ShieldCheck,
  Timer,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import { JsonViewer } from "@/components/ui/json-viewer";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { VerificationBadge } from "@/components/ui/status-badge";
import { ApiConsole } from "@/components/dashboard/api-console";
import { ApiManageActions } from "@/components/dashboard/api-manage-actions";
import { getApiForViewer, requireUser } from "@/lib/dashboard/data";
import { buildAnvexCurl, buildExampleRequest, buildUpstreamCurl } from "@/lib/registry/examples";
import { formatDate, formatBytes } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return { title: slug };
}

export default async function ApiDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { admin, caller } = await requireUser();
  const api = await getApiForViewer(admin, caller, slug);
  if (!api) notFound();

  const canManage = api.owner_id === caller.userId || caller.isAdmin;
  const example = buildExampleRequest(api);
  const upstreamCurl = buildUpstreamCurl(api);
  const anxCurl = buildAnvexCurl(api);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Link href="/dashboard/explore" className="flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to catalog
        </Link>
        {api.category ? (
          <>
            <span>/</span>
            <Link href={`/dashboard/explore?category=${api.category.slug}`} className="hover:text-foreground">
              {api.category.name}
            </Link>
          </>
        ) : null}
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{api.method}</Badge>
            <h1 className="text-2xl font-semibold tracking-tight">{api.name}</h1>
            <VerificationBadge status={api.verification_status} />
            {!api.is_enabled ? <Badge variant="outline">Disabled</Badge> : null}
            {api.is_public ? <Badge variant="info">Public</Badge> : <Badge variant="secondary">Private</Badge>}
            {api.is_nsfw ? <Badge variant="warning">NSFW</Badge> : null}
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {api.description ?? "No description recorded for this endpoint."}
          </p>
          <p className="break-all font-mono text-xs text-muted-foreground">
            {api.base_url}
            <span className="text-foreground">{api.path}</span>
          </p>
        </div>
        {canManage ? (
          <ApiManageActions id={api.id} slug={api.slug} isEnabled={api.is_enabled} />
        ) : null}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Try it</CardTitle>
              <CardDescription>
                Sends a real request through the server-side executor. Credentials, SSRF checks, timeouts and
                telemetry all apply exactly as they do for gateway callers.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ApiConsole api={api} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Request contract</CardTitle>
              <CardDescription>
                Derived from the stored configuration. Missing examples are left blank instead of being invented.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {api.query_params.length ? (
                <div className="space-y-2">
                  <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Query parameters</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Required</TableHead>
                        <TableHead>Example</TableHead>
                        <TableHead>Description</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {api.query_params.map((param) => (
                        <TableRow key={param.name}>
                          <TableCell className="font-mono text-xs">{param.name}</TableCell>
                          <TableCell className="text-xs">{param.type ?? "string"}</TableCell>
                          <TableCell className="text-xs">{param.required ? "yes" : "no"}</TableCell>
                          <TableCell className="max-w-[14rem] truncate font-mono text-xs">
                            {param.example ?? param.default ?? "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {param.description ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No query parameters declared.</p>
              )}

              {api.path_params.length ? (
                <div className="space-y-2">
                  <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Path parameters</h3>
                  <div className="flex flex-wrap gap-2">
                    {api.path_params.map((param) => (
                      <Badge key={param.name} variant="outline" className="font-mono">
                        {param.name}: {param.type ?? "string"}
                        {param.required ? " *" : ""}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}

              {api.headers_schema.length ? (
                <div className="space-y-2">
                  <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Headers</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Required</TableHead>
                        <TableHead>Example</TableHead>
                        <TableHead>Secret</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {api.headers_schema.map((header) => (
                        <TableRow key={header.name}>
                          <TableCell className="font-mono text-xs">{header.name}</TableCell>
                          <TableCell className="text-xs">{header.required ? "yes" : "no"}</TableCell>
                          <TableCell className="max-w-[16rem] truncate font-mono text-xs">
                            {header.example ?? "—"}
                          </TableCell>
                          <TableCell className="text-xs">{header.secret ? "yes" : "no"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}

              {api.body_schema ? (
                <div className="space-y-2">
                  <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Body</h3>
                  <JsonViewer value={api.body_schema} maxHeight="16rem" />
                </div>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Direct upstream example</h3>
                  <CodeBlock language="curl · provider" code={upstreamCurl} maxHeight="16rem" />
                  <p className="text-[11px] text-muted-foreground">
                    Credentials are intentionally omitted. Anvex never prints stored secrets.
                  </p>
                </div>
                <div className="space-y-2">
                  <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Through Anvex</h3>
                  <CodeBlock language="curl · gateway" code={anxCurl} maxHeight="16rem" />
                  <p className="text-[11px] text-muted-foreground">
                    Replace <span className="font-mono">$APP_URL</span> and <span className="font-mono">$ANVEX_KEY</span>.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {api.response_example !== null && api.response_example !== undefined ? (
            <Card>
              <CardHeader>
                <CardTitle>Recorded response example</CardTitle>
                <CardDescription>
                  Captured from a real request or provider documentation at import time — not generated.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <JsonViewer value={api.response_example} />
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Verification</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                <VerificationBadge status={api.verification_status} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Last status code</span>
                <span className="font-mono">{api.last_status_code ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Last tested</span>
                <span className="text-right">{api.last_tested_at ? formatDate(api.last_tested_at) : "never"}</span>
              </div>
              {api.last_error ? (
                <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-destructive">
                  {api.last_error}
                </p>
              ) : null}
              <p className="text-muted-foreground">
                Verified only when a real upstream call returned 2xx/3xx without an error envelope.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <KeyRound className="h-3.5 w-3.5" /> Auth
                </span>
                <span className="font-mono">{api.auth_type}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5" /> Credential
                </span>
                <span>{api.credential_configured ? "stored (encrypted)" : "not configured"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Timer className="h-3.5 w-3.5" /> Timeout
                </span>
                <span className="font-mono">{api.timeout_ms} ms</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Radio className="h-3.5 w-3.5" /> Streaming
                </span>
                <span>{api.supports_streaming ? "advertised" : "not supported"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Content type</span>
                <span className="font-mono">{api.content_type}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Extra query</span>
                <span>{api.allow_extra_query ? "allowed" : "rejected"}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Provenance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Discovery</span>
                <Badge variant="outline">{api.discovery_source}</Badge>
              </div>
              {api.provider ? (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Provider</span>
                  <span>{api.provider.name}</span>
                </div>
              ) : null}
              <div className="flex items-start justify-between gap-2">
                <span className="flex items-center gap-1 text-muted-foreground">
                  <CalendarClock className="h-3.5 w-3.5" /> Created
                </span>
                <span className="text-right">{formatDate(api.created_at)}</span>
              </div>
              <div className="flex items-start justify-between gap-2">
                <span className="text-muted-foreground">Updated</span>
                <span className="text-right">{formatDate(api.updated_at)}</span>
              </div>
              <div className="flex flex-wrap gap-3 pt-1">
                {api.docs_url ? (
                  <a href={api.docs_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-primary hover:underline">
                    Docs <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
                {api.source_url ? (
                  <a href={api.source_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-primary hover:underline">
                    Source <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
              {Object.keys(api.discovery_metadata ?? {}).length ? (
                <details className="pt-1">
                  <summary className="cursor-pointer text-muted-foreground">Discovery metadata</summary>
                  <div className="mt-2">
                    <JsonViewer value={api.discovery_metadata} maxHeight="14rem" />
                  </div>
                </details>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Size limits</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs text-muted-foreground">
              <p>Response cap: 2 MiB (configurable by deployment).</p>
              <p>Request bodies: 256 KB.</p>
              <p>Response example recorded: {api.response_example ? formatBytes(JSON.stringify(api.response_example).length) : "—"}.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
