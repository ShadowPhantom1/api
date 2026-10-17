"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  FileJson,
  Loader2,
  Radar,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, errorMessage } from "@/lib/client/api";
import type { DiscoveryAttempt } from "@/lib/db/types";

interface ImportSummary {
  imported?: number;
  discovered?: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  errors?: Array<{ endpoint?: string; message: string }>;
}

interface OpenApiResult {
  dryRun?: boolean;
  spec?: { title: string; version: string; baseUrl: string };
  title?: string;
  version?: string;
  baseUrl?: string;
  warnings?: string[];
  provider?: { slug: string; name: string };
  summary?: ImportSummary;
  preview?: Array<{
    name: string;
    method: string;
    path: string;
    category: string;
    queryParams: string[];
    pathParams: string[];
    authType: string;
  }>;
  note?: string;
}

interface DiscoveryResult {
  provider: { slug: string; name: string; base_url: string | null };
  attempts: DiscoveryAttempt[];
  notes: string;
  manifestUrl: string | null;
  openapiUrl: string | null;
  summary: ImportSummary;
  endpoints: Array<{
    name: string;
    path: string;
    method: string;
    description: string;
    category: string;
    queryParams: string[];
    isNsfw: boolean;
  }>;
}

export function ImportForm({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<"openapi" | "discovery">("openapi");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [document, setDocument] = useState("");
  const [url, setUrl] = useState("");
  const [providerName, setProviderName] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [openapiResult, setOpenapiResult] = useState<OpenApiResult | null>(null);

  const [sourceUrl, setSourceUrl] = useState("https://api-rebix.zone.id/");
  const [adapter, setAdapter] = useState("auto");
  const [providerSlug, setProviderSlug] = useState("");
  const [manifestPath, setManifestPath] = useState("");
  const [discoveryResult, setDiscoveryResult] = useState<DiscoveryResult | null>(null);

  const submitOpenApi = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setOpenapiResult(null);
    try {
      const payload = {
        ...(document.trim() ? { document } : {}),
        ...(url.trim() ? { url: url.trim() } : {}),
        ...(providerName.trim() ? { providerName: providerName.trim() } : {}),
        isPublic,
        dryRun,
      };
      if (!payload.document && !payload.url) throw new Error("Paste a document or provide a URL.");
      const result = await apiFetch<OpenApiResult>("/api/import/openapi", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setOpenapiResult(result);
      toast.success(result.dryRun ? "Preview generated." : `Import complete: ${result.summary?.created ?? 0} created.`);
      if (!result.dryRun) router.refresh();
    } catch (importError) {
      setError(errorMessage(importError));
      toast.error(errorMessage(importError));
    } finally {
      setLoading(false);
    }
  };

  const submitDiscovery = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setDiscoveryResult(null);
    try {
      const result = await apiFetch<DiscoveryResult>("/api/discover", {
        method: "POST",
        body: JSON.stringify({
          sourceUrl: sourceUrl.trim(),
          adapter,
          ...(providerSlug.trim() ? { providerSlug: providerSlug.trim() } : {}),
          ...(manifestPath.trim() ? { manifestPath: manifestPath.trim() } : {}),
        }),
      });
      setDiscoveryResult(result);
      toast.success(`Discovery finished: ${result.summary.created} created, ${result.summary.updated} updated.`);
      router.refresh();
    } catch (discoveryError) {
      setError(errorMessage(discoveryError));
      toast.error(errorMessage(discoveryError));
    } finally {
      setLoading(false);
    }
  };

  const readFile = async (file: File | null) => {
    if (!file) return;
    if (file.size > 2_000_000) {
      toast.error("File is larger than 2 MB.");
      return;
    }
    const text = await file.text();
    setDocument(text);
    toast.success(`Loaded ${file.name} (${(file.size / 1024).toFixed(1)} KB).`);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg border border-border bg-card/60 p-1">
        <button
          type="button"
          onClick={() => setTab("openapi")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm ${
            tab === "openapi" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <FileJson className="h-4 w-4" /> OpenAPI / Swagger
        </button>
        <button
          type="button"
          onClick={() => setTab("discovery")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm ${
            tab === "discovery" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Radar className="h-4 w-4" /> Provider discovery
          {!isAdmin ? <Badge variant="secondary" className="text-[9px]">admin</Badge> : null}
        </button>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {tab === "openapi" ? (
        <Card>
          <CardHeader>
            <CardTitle>Import an OpenAPI 3 or Swagger 2 document</CardTitle>
            <CardDescription>
              Paste JSON/YAML, upload a file, or fetch a URL. Imports are idempotent per provider + method + path.
              Nothing is marked verified by the import itself.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitOpenApi} className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="specUrl">Document URL (optional)</Label>
                  <Input
                    id="specUrl"
                    type="url"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://petstore3.swagger.io/api/v3/openapi.json"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="specFile">Upload file</Label>
                  <input
                    id="specFile"
                    type="file"
                    accept=".json,.yaml,.yml,application/json,text/yaml"
                    onChange={(event) => void readFile(event.target.files?.[0] ?? null)}
                    className="block w-full rounded-md border border-input bg-background/60 px-3 py-1.5 text-xs file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs file:text-foreground"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="specDocument">Document content (JSON or YAML)</Label>
                <Textarea
                  id="specDocument"
                  rows={8}
                  value={document}
                  onChange={(event) => setDocument(event.target.value)}
                  placeholder='{"openapi":"3.0.0","info":{...},"paths":{...}}'
                />
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="providerName">Provider name (optional)</Label>
                  <Input
                    id="providerName"
                    value={providerName}
                    onChange={(event) => setProviderName(event.target.value)}
                    placeholder="From info.title if blank"
                  />
                </div>
                <label className="flex items-center gap-2 self-end rounded-md border border-border/70 px-3 py-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} />
                  Make imported endpoints public
                </label>
                <label className="flex items-center gap-2 self-end rounded-md border border-border/70 px-3 py-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} />
                  Dry run (preview only)
                </label>
              </div>
              <Button type="submit" disabled={loading}>
                {loading ? <Loader2 className="animate-spin" /> : <Upload />}
                {dryRun ? "Preview import" : "Import endpoints"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Discover a provider</CardTitle>
            <CardDescription>
              Probes homepage, common manifest routes and OpenAPI locations with safe server-side requests. Every
              attempt (including 404s and errors) is recorded in discovery runs. Requires administrator access.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!isAdmin ? (
              <p className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground">
                Provider discovery is administrator-only because it creates managed, public catalog entries.
              </p>
            ) : (
              <form onSubmit={submitDiscovery} className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="sourceUrl">Source URL *</Label>
                    <Input
                      id="sourceUrl"
                      required
                      type="url"
                      value={sourceUrl}
                      onChange={(event) => setSourceUrl(event.target.value)}
                      placeholder="https://api-rebix.zone.id/"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="adapter">Adapter</Label>
                    <Select id="adapter" value={adapter} onChange={(event) => setAdapter(event.target.value)}>
                      <option value="auto">auto</option>
                      <option value="rebix_manifest">rebix_manifest</option>
                      <option value="json_manifest">json_manifest</option>
                      <option value="openapi">openapi</option>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="providerSlug">Provider slug (optional)</Label>
                    <Input
                      id="providerSlug"
                      value={providerSlug}
                      onChange={(event) => setProviderSlug(event.target.value)}
                      placeholder="derived from host"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="manifestPath">Manifest path (optional)</Label>
                    <Input
                      id="manifestPath"
                      value={manifestPath}
                      onChange={(event) => setManifestPath(event.target.value)}
                      placeholder="/allEnds"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  The target host must pass SSRF validation. Discovery does not bypass authentication, robots
                  restrictions or rate limits.
                </p>
                <Button type="submit" disabled={loading}>
                  {loading ? <Loader2 className="animate-spin" /> : <Radar />} Run discovery
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      {openapiResult ? (
        <Card>
          <CardHeader>
            <CardTitle>{openapiResult.dryRun ? "Preview" : "Import result"}</CardTitle>
            <CardDescription>
              {openapiResult.spec
                ? `${openapiResult.spec.title} ${openapiResult.spec.version} · ${openapiResult.spec.baseUrl}`
                : `${openapiResult.title} ${openapiResult.version} · ${openapiResult.baseUrl}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {openapiResult.summary ? (
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="success">{openapiResult.summary.created} created</Badge>
                <Badge variant="info">{openapiResult.summary.updated} updated</Badge>
                <Badge variant="secondary">{openapiResult.summary.unchanged} unchanged</Badge>
                {openapiResult.summary.failed ? <Badge variant="destructive">{openapiResult.summary.failed} failed</Badge> : null}
              </div>
            ) : null}
            {openapiResult.warnings?.length ? (
              <ul className="space-y-1 rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-200">
                {openapiResult.warnings.map((warning) => (
                  <li key={warning} className="flex gap-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {warning}
                  </li>
                ))}
              </ul>
            ) : null}
            {openapiResult.summary?.errors?.length ? (
              <ul className="space-y-1 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                {openapiResult.summary.errors.map((item, index) => (
                  <li key={index}>{item.endpoint ? `${item.endpoint}: ` : ""}{item.message}</li>
                ))}
              </ul>
            ) : null}
            {openapiResult.preview?.length ? (
              <div className="max-h-80 space-y-1 overflow-auto">
                {openapiResult.preview.map((endpoint) => (
                  <div key={`${endpoint.method}:${endpoint.path}`} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/60 px-3 py-1.5 text-xs">
                    <span className="font-mono">
                      <Badge variant="secondary" className="mr-2">{endpoint.method}</Badge>
                      {endpoint.path}
                    </span>
                    <span className="text-muted-foreground">
                      {endpoint.queryParams.length} query · {endpoint.authType}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            {openapiResult.note ? <p className="text-xs text-muted-foreground">{openapiResult.note}</p> : null}
          </CardContent>
        </Card>
      ) : null}

      {discoveryResult ? (
        <Card>
          <CardHeader>
            <CardTitle>Discovery result</CardTitle>
            <CardDescription>
              {discoveryResult.provider.name} · {discoveryResult.provider.base_url}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="success">{discoveryResult.summary.discovered} discovered</Badge>
              <Badge variant="info">{discoveryResult.summary.created} created</Badge>
              <Badge variant="secondary">{discoveryResult.summary.unchanged} unchanged</Badge>
              {discoveryResult.summary.failed ? <Badge variant="destructive">{discoveryResult.summary.failed} failed</Badge> : null}
            </div>
            <p className="text-xs text-muted-foreground">{discoveryResult.notes}</p>
            <div className="space-y-1">
              {discoveryResult.attempts.map((attempt, index) => (
                <div key={index} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/60 px-3 py-1.5 text-xs">
                  <span className="font-mono text-[11px]">{attempt.method} · {attempt.target}</span>
                  <span className="flex items-center gap-2">
                    {attempt.status ? <Badge variant="outline">{attempt.status}</Badge> : null}
                    <Badge
                      variant={
                        attempt.outcome === "success" ? "success" : attempt.outcome === "error" ? "destructive" : "secondary"
                      }
                    >
                      {attempt.outcome}
                    </Badge>
                    {attempt.endpoints ? <span className="text-muted-foreground">{attempt.endpoints} endpoints</span> : null}
                  </span>
                </div>
              ))}
            </div>
            {discoveryResult.endpoints.length ? (
              <div className="max-h-80 space-y-1 overflow-auto">
                {discoveryResult.endpoints.map((endpoint) => (
                  <div key={`${endpoint.method}:${endpoint.path}`} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/60 px-3 py-1.5 text-xs">
                    <span className="font-mono">
                      <Badge variant="secondary" className="mr-2">{endpoint.method}</Badge>
                      {endpoint.path}
                    </span>
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <span>{endpoint.category}</span>
                      {endpoint.isNsfw ? <Badge variant="warning">NSFW</Badge> : null}
                      {endpoint.queryParams.length ? <span>{endpoint.queryParams.join(", ")}</span> : null}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              Imported endpoints start unverified. Use the endpoint page to run a real test.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
