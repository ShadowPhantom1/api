"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  Loader2,
  Plus,
  Save,
  Trash2,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { JsonViewer } from "@/components/ui/json-viewer";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, errorMessage } from "@/lib/client/api";
import type { BodySchema, HeaderDef, ParamDef, ParamType, SafeApi } from "@/lib/db/types";
import { cn } from "@/lib/utils";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type AuthType = "none" | "bearer" | "api_key" | "basic";

interface ParamRow {
  name: string;
  type: ParamType;
  required: boolean;
  example: string;
  description: string;
}

interface HeaderRow {
  name: string;
  required: boolean;
  example: string;
  secret: boolean;
}

interface ProbeResult {
  ok: boolean;
  status: number;
  statusText: string;
  contentType: string;
  durationMs: number;
  size: number;
  truncated: boolean;
  headers: Record<string, string>;
  body: unknown;
  bodyText: string | null;
  finalUrl: string;
  suggestedConfig?: Record<string, unknown>;
}

export interface ApiFormInitial {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  base_url: string;
  path: string;
  method: Method;
  query_params: ParamDef[];
  path_params: ParamDef[];
  headers_schema: HeaderDef[];
  body_schema: BodySchema | null;
  auth_type: AuthType;
  auth_config_meta: Record<string, unknown>;
  content_type: string;
  docs_url: string | null;
  source_url: string | null;
  is_public: boolean;
  is_enabled: boolean;
  is_nsfw: boolean;
  allow_extra_query: boolean;
  supports_streaming: boolean;
  timeout_ms: number;
  response_example: unknown;
  credential_configured: boolean;
  category?: { slug: string; name: string } | null;
}

function toParamRows(params: ParamDef[] | undefined): ParamRow[] {
  return (params ?? []).map((param) => ({
    name: param.name,
    type: param.type ?? "string",
    required: Boolean(param.required),
    example: param.example ?? param.default ?? "",
    description: param.description ?? "",
  }));
}

function toHeaderRows(headers: HeaderDef[] | undefined): HeaderRow[] {
  return (headers ?? []).map((header) => ({
    name: header.name,
    required: Boolean(header.required),
    example: header.example ?? "",
    secret: Boolean(header.secret),
  }));
}

function paramPayload(rows: ParamRow[]): ParamDef[] {
  return rows
    .filter((row) => row.name.trim())
    .map((row) => ({
      name: row.name.trim(),
      type: row.type,
      required: row.required,
      ...(row.example ? { example: row.example } : {}),
      ...(row.description ? { description: row.description } : {}),
    }));
}

export function ApiForm({
  initial,
  categories,
  mode,
}: {
  initial?: ApiFormInitial;
  categories: Array<{ slug: string; name: string }>;
  mode: "create" | "edit";
}) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [baseUrl, setBaseUrl] = useState(initial?.base_url ?? "");
  const [path, setPath] = useState(initial?.path ?? "/");
  const [method, setMethod] = useState<Method>(initial?.method ?? "GET");
  const [fullUrl, setFullUrl] = useState("");
  const [queryParams, setQueryParams] = useState<ParamRow[]>(toParamRows(initial?.query_params));
  const [pathParams, setPathParams] = useState<ParamRow[]>(toParamRows(initial?.path_params));
  const [headers, setHeaders] = useState<HeaderRow[]>(toHeaderRows(initial?.headers_schema));
  const [bodyText, setBodyText] = useState(() => {
    if (initial?.body_schema?.example !== undefined) {
      return JSON.stringify(initial.body_schema.example, null, 2);
    }
    return "";
  });
  const [responseText, setResponseText] = useState(() => {
    if (initial?.response_example !== undefined && initial.response_example !== null) {
      return JSON.stringify(initial.response_example, null, 2);
    }
    return "";
  });
  const [authType, setAuthType] = useState<AuthType>(initial?.auth_type ?? "none");
  const [authToken, setAuthToken] = useState("");
  const [authApiKey, setAuthApiKey] = useState("");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [headerName, setHeaderName] = useState(
    typeof initial?.auth_config_meta?.header_name === "string"
      ? initial.auth_config_meta.header_name
      : "X-API-Key",
  );
  const [clearAuth, setClearAuth] = useState(false);
  const [categorySlug, setCategorySlug] = useState(initial?.category?.slug ?? "");
  const [categoryName, setCategoryName] = useState("");
  const [providerName, setProviderName] = useState("");
  const [contentType, setContentType] = useState(initial?.content_type ?? "application/json");
  const [docsUrl, setDocsUrl] = useState(initial?.docs_url ?? "");
  const [sourceUrl, setSourceUrl] = useState(initial?.source_url ?? "");
  const [isPublic, setIsPublic] = useState(initial?.is_public ?? false);
  const [isEnabled, setIsEnabled] = useState(initial?.is_enabled ?? true);
  const [isNsfw, setIsNsfw] = useState(initial?.is_nsfw ?? false);
  const [allowExtraQuery, setAllowExtraQuery] = useState(initial?.allow_extra_query ?? false);
  const [supportsStreaming, setSupportsStreaming] = useState(initial?.supports_streaming ?? false);
  const [timeoutMs, setTimeoutMs] = useState(initial?.timeout_ms ?? 15000);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedPreview = useMemo(() => {
    try {
      let resolvedPath = path;
      for (const param of pathParams.filter((row) => row.name.trim())) {
        resolvedPath = resolvedPath.replace(
          new RegExp(`\\{${param.name}\\}`, "g"),
          encodeURIComponent(param.example || `{${param.name}}`),
        );
      }
      const url = new URL(`${baseUrl.replace(/\/+$/, "")}${resolvedPath.startsWith("/") ? resolvedPath : `/${resolvedPath}`}`);
      for (const param of queryParams.filter((row) => row.name.trim())) {
        if (param.example) url.searchParams.set(param.name, param.example);
      }
      return url.toString();
    } catch {
      return "Enter a valid base URL and path.";
    }
  }, [baseUrl, path, pathParams, queryParams]);

  const parseFullUrl = () => {
    try {
      const url = new URL(fullUrl.trim());
      setBaseUrl(url.origin);
      setPath(`${url.pathname || "/"}`);
      const parsedParams: ParamRow[] = [];
      url.searchParams.forEach((value, key) => {
        parsedParams.push({
          name: key,
          type: "string",
          required: false,
          example: value,
          description: "Parsed from the pasted URL.",
        });
      });
      if (parsedParams.length) setQueryParams(parsedParams);
      toast.success("URL split into base, path and query parameters.");
    } catch {
      toast.error("That is not a valid absolute URL.");
    }
  };

  const buildProbePayload = () => {
    const headersObject: Record<string, string> = {};
    for (const header of headers) {
      if (header.name.trim() && header.example && !header.secret) {
        headersObject[header.name.trim()] = header.example;
      }
    }
    let body: unknown;
    if (method !== "GET" && bodyText.trim()) {
      try {
        body = JSON.parse(bodyText);
      } catch {
        throw new Error("Body example is not valid JSON.");
      }
    }
    let auth:
      | { type: AuthType; token?: string; apiKey?: string; username?: string; password?: string; headerName?: string }
      | undefined;
    if (authType === "bearer" && authToken) auth = { type: authType, token: authToken };
    if (authType === "api_key" && authApiKey) auth = { type: authType, apiKey: authApiKey, headerName };
    if (authType === "basic" && authUsername && authPassword) {
      auth = { type: authType, username: authUsername, password: authPassword };
    }
    return {
      url: parsedPreview,
      method,
      headers: headersObject,
      ...(body !== undefined ? { body } : {}),
      ...(auth ? { auth } : {}),
      timeoutMs: Math.min(Math.max(timeoutMs, 1000), 15000),
    };
  };

  const runProbe = async () => {
    setProbing(true);
    setError(null);
    try {
      const payload = buildProbePayload();
      const result = await apiFetch<ProbeResult>("/api/probe", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setProbe(result);
      if (result.contentType.includes("json") && !contentType.includes("json")) {
        setContentType("application/json");
      }
      if (result.ok && result.body !== null && result.body !== undefined) {
        setResponseText(JSON.stringify(result.body, null, 2).slice(0, 20000));
      }
      if (result.ok) toast.success(`Probe returned HTTP ${result.status} in ${result.durationMs} ms`);
      else toast.warning(`Probe returned HTTP ${result.status}`);
    } catch (probeError) {
      setError(errorMessage(probeError));
      toast.error(errorMessage(probeError));
    } finally {
      setProbing(false);
    }
  };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      let parsedBody: unknown;
      if (bodyText.trim()) {
        try {
          parsedBody = JSON.parse(bodyText);
        } catch {
          throw new Error("Body example must be valid JSON.");
        }
      }
      const bodySchema: BodySchema | null = parsedBody !== undefined ? { type: "object", example: parsedBody } : null;
      let parsedResponse: unknown;
      if (responseText.trim()) {
        try {
          parsedResponse = JSON.parse(responseText);
        } catch {
          throw new Error("Response example must be valid JSON.");
        }
      }

      const payload: Record<string, unknown> = {
        name: name.trim(),
        ...(slug.trim() ? { slug: slug.trim() } : {}),
        description: description.trim() || null,
        baseUrl: baseUrl.trim(),
        path: path.trim(),
        method,
        queryParams: paramPayload(queryParams),
        pathParams: paramPayload(pathParams),
        headersSchema: headers
          .filter((header) => header.name.trim())
          .map((header) => ({
            name: header.name.trim(),
            required: header.required,
            secret: header.secret,
            ...(header.example ? { example: header.example } : {}),
          })),
        bodySchema,
        authType,
        contentType,
        ...(parsedResponse !== undefined ? { responseExample: parsedResponse } : {}),
        docsUrl: docsUrl.trim() || null,
        sourceUrl: sourceUrl.trim() || null,
        isPublic,
        isEnabled,
        isNsfw,
        allowExtraQuery,
        supportsStreaming,
        timeoutMs,
        ...(categorySlug ? { categorySlug } : {}),
        ...(categoryName.trim() ? { categoryName: categoryName.trim() } : {}),
        ...(providerName.trim() ? { providerName: providerName.trim() } : {}),
      };

      if (authType !== "none") {
        const auth: Record<string, string> = { headerName };
        if (authType === "bearer" && authToken) auth.token = authToken;
        if (authType === "api_key" && authApiKey) auth.apiKey = authApiKey;
        if (authType === "basic") {
          if (authUsername) auth.username = authUsername;
          if (authPassword) auth.password = authPassword;
        }
        payload.auth = auth;
      } else {
        payload.auth = null;
      }
      if (clearAuth) payload.clearAuth = true;

      if (mode === "create") {
        const created = await apiFetch<{ api: SafeApi }>("/api/apis", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast.success("Endpoint saved to the registry.");
        const target = created.api;

        if (probe?.ok) {
          try {
            const query = Object.fromEntries(
              queryParams.filter((row) => row.name.trim() && row.example).map((row) => [row.name.trim(), row.example]),
            );
            const pathValues = Object.fromEntries(
              pathParams.filter((row) => row.name.trim()).map((row) => [row.name.trim(), row.example]),
            );
            const headersObject = Object.fromEntries(
              headers.filter((row) => row.name.trim() && row.example && !row.secret).map((row) => [row.name.trim(), row.example]),
            );
            let body: unknown;
            if (method !== "GET" && bodyText.trim()) body = JSON.parse(bodyText);
            const tested = await apiFetch<{ verification: { status: string; message: string | null } | null }>(
              `/api/apis/${target.id}/test`,
              {
                method: "POST",
                body: JSON.stringify({
                  query,
                  pathParams: pathValues,
                  headers: headersObject,
                  ...(body !== undefined ? { body } : {}),
                }),
              },
            );
            if (tested.verification?.status === "verified") {
              toast.success("Verification request succeeded and was recorded as verified.");
            } else if (tested.verification) {
              toast.warning(`Saved, but verification failed: ${tested.verification.message ?? "upstream error"}`);
            }
          } catch (verifyError) {
            toast.warning(`Saved. Verification request did not complete: ${errorMessage(verifyError)}`);
          }
        }

        router.push(`/dashboard/apis/${target.slug}`);
        router.refresh();
      } else if (initial) {
        await apiFetch(`/api/apis/${initial.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        toast.success("Endpoint updated.");
        router.push(`/dashboard/apis/${slug || initial.slug}`);
        router.refresh();
      }
    } catch (saveError) {
      setError(errorMessage(saveError));
      toast.error(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const toggles: Array<[string, boolean, (value: boolean) => void]> = [
    ["Public (visible to other accounts)", isPublic, setIsPublic],
    ["Enabled", isEnabled, setIsEnabled],
    ["NSFW-flagged", isNsfw, setIsNsfw],
    ["Allow undeclared query parameters", allowExtraQuery, setAllowExtraQuery],
    ["Advertise streaming", supportsStreaming, setSupportsStreaming],
  ];

  const addParam = (target: "query" | "path") => {
    const setter = target === "query" ? setQueryParams : setPathParams;
    setter((rows) => [
      ...rows,
      { name: "", type: "string", required: false, example: "", description: "" },
    ]);
  };

  return (
    <form onSubmit={save} className="space-y-6">
      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Paste a full URL</CardTitle>
          <CardDescription>
            Anvex splits origin, path and query parameters. You can edit everything before saving. No endpoint
            allowlist is involved — the arbitrary parameter names you see on Rebix are examples, not a schema.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={fullUrl}
              onChange={(event) => setFullUrl(event.target.value)}
              placeholder="https://api-rebix.zone.id/api/deepseek-v3?q=hello"
              className="font-mono text-xs"
            />
            <Button variant="secondary" onClick={parseFullUrl} disabled={!fullUrl.trim()}>
              <Wand2 /> Split URL
            </Button>
          </div>
          <p className="break-all font-mono text-[11px] text-muted-foreground">Preview: {parsedPreview}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Request</CardTitle>
          <CardDescription>Base URL + path is how the executor builds upstream requests.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-6">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="name">Name *</Label>
            <Input id="name" required value={name} onChange={(event) => setName(event.target.value)} placeholder="DeepSeek V3" />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="slug">Slug (optional)</Label>
            <Input
              id="slug"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              placeholder="auto-generated"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5 md:col-span-1">
            <Label htmlFor="method">Method</Label>
            <Select id="method" value={method} onChange={(event) => setMethod(event.target.value as Method)}>
              {["GET", "POST", "PUT", "PATCH", "DELETE"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5 md:col-span-1">
            <Label htmlFor="timeout">Timeout (ms)</Label>
            <Input
              id="timeout"
              type="number"
              min={1000}
              max={30000}
              value={timeoutMs}
              onChange={(event) => setTimeoutMs(Number.parseInt(event.target.value, 10) || 15000)}
            />
          </div>
          <div className="space-y-1.5 md:col-span-4">
            <Label htmlFor="baseUrl">Base URL *</Label>
            <Input
              id="baseUrl"
              required
              type="url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.example.com"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="path">Path *</Label>
            <Input
              id="path"
              required
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="/v1/chat"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5 md:col-span-6">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this endpoint does, according to the provider."
              className="font-sans text-sm"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between">
          <div>
            <CardTitle>Parameters</CardTitle>
            <CardDescription>Arbitrary names and types. Required values are enforced by the executor.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => addParam("query")}>
              <Plus /> Query
            </Button>
            <Button variant="outline" size="sm" onClick={() => addParam("path")}>
              <Plus /> Path
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {(
            [
              ["Query parameters", queryParams, setQueryParams, "query"],
              ["Path parameters", pathParams, setPathParams, "path"],
            ] as const
          ).map(([label, rows, setter, kind]) => (
            <div key={label} className="space-y-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
              {rows.length ? (
                <div className="space-y-2">
                  {rows.map((row, index) => (
                    <div key={index} className="grid gap-2 rounded-md border border-border/70 p-2 sm:grid-cols-12">
                      <Input
                        className="sm:col-span-3"
                        placeholder={kind === "query" ? "q" : "id"}
                        value={row.name}
                        onChange={(event) =>
                          setter((current) =>
                            current.map((item, position) =>
                              position === index ? { ...item, name: event.target.value } : item,
                            ),
                          )
                        }
                      />
                      <Select
                        className="sm:col-span-2"
                        value={row.type}
                        onChange={(event) =>
                          setter((current) =>
                            current.map((item, position) =>
                              position === index ? { ...item, type: event.target.value as ParamType } : item,
                            ),
                          )
                        }
                      >
                        {["string", "number", "integer", "boolean", "enum"].map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </Select>
                      <Input
                        className="sm:col-span-3"
                        placeholder="example value"
                        value={row.example}
                        onChange={(event) =>
                          setter((current) =>
                            current.map((item, position) =>
                              position === index ? { ...item, example: event.target.value } : item,
                            ),
                          )
                        }
                      />
                      <Input
                        className="sm:col-span-3"
                        placeholder="description (optional)"
                        value={row.description}
                        onChange={(event) =>
                          setter((current) =>
                            current.map((item, position) =>
                              position === index ? { ...item, description: event.target.value } : item,
                            ),
                          )
                        }
                      />
                      <div className="flex items-center justify-between gap-2 sm:col-span-12">
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={row.required}
                            onChange={(event) =>
                              setter((current) =>
                                current.map((item, position) =>
                                  position === index ? { ...item, required: event.target.checked } : item,
                                ),
                              )
                            }
                          />
                          required
                        </label>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setter((current) => current.filter((_, position) => position !== index))}
                        >
                          <Trash2 /> Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">None declared.</p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between">
          <div>
            <CardTitle>Headers & auth</CardTitle>
            <CardDescription>
              Declared headers are inputs. Upstream credentials go in the auth section and are encrypted at rest.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setHeaders((current) => [...current, { name: "", required: false, example: "", secret: false }])
            }
          >
            <Plus /> Header
          </Button>
        </CardHeader>
        <CardContent className="space-y-5">
          {headers.length ? (
            <div className="space-y-2">
              {headers.map((header, index) => (
                <div key={index} className="grid gap-2 rounded-md border border-border/70 p-2 sm:grid-cols-12">
                  <Input
                    className="sm:col-span-4"
                    placeholder="X-Custom-Header"
                    value={header.name}
                    onChange={(event) =>
                      setHeaders((current) =>
                        current.map((item, position) =>
                          position === index ? { ...item, name: event.target.value } : item,
                        ),
                      )
                    }
                  />
                  <Input
                    className="sm:col-span-5"
                    placeholder="example value"
                    value={header.example}
                    onChange={(event) =>
                      setHeaders((current) =>
                        current.map((item, position) =>
                          position === index ? { ...item, example: event.target.value } : item,
                        ),
                      )
                    }
                  />
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={header.secret}
                      onChange={(event) =>
                        setHeaders((current) =>
                          current.map((item, position) =>
                            position === index ? { ...item, secret: event.target.checked } : item,
                          ),
                        )
                      }
                    />
                    secret
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="sm:col-span-1"
                    onClick={() => setHeaders((current) => current.filter((_, position) => position !== index))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No headers declared.</p>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="authType">Upstream auth</Label>
              <Select
                id="authType"
                value={authType}
                onChange={(event) => setAuthType(event.target.value as AuthType)}
              >
                <option value="none">None</option>
                <option value="bearer">Bearer token</option>
                <option value="api_key">API key header</option>
                <option value="basic">HTTP basic</option>
              </Select>
              {initial?.credential_configured ? (
                <p className="text-[11px] text-muted-foreground">
                  A credential is already stored. Leave the fields blank to keep it, or tick “clear” to remove it.
                </p>
              ) : null}
              {initial?.credential_configured ? (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={clearAuth} onChange={(event) => setClearAuth(event.target.checked)} />
                  Clear stored credential
                </label>
              ) : null}
            </div>

            {authType === "bearer" ? (
              <div className="space-y-1.5">
                <Label htmlFor="authToken">Token</Label>
                <Input
                  id="authToken"
                  type="password"
                  autoComplete="off"
                  value={authToken}
                  onChange={(event) => setAuthToken(event.target.value)}
                  placeholder="stored encrypted (AES-256-GCM)"
                />
              </div>
            ) : null}

            {authType === "api_key" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="authApiKey">API key</Label>
                  <Input
                    id="authApiKey"
                    type="password"
                    autoComplete="off"
                    value={authApiKey}
                    onChange={(event) => setAuthApiKey(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="headerName">Header name</Label>
                  <Input
                    id="headerName"
                    value={headerName}
                    onChange={(event) => setHeaderName(event.target.value)}
                    placeholder="X-API-Key"
                  />
                </div>
              </div>
            ) : null}

            {authType === "basic" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="authUsername">Username</Label>
                  <Input
                    id="authUsername"
                    autoComplete="off"
                    value={authUsername}
                    onChange={(event) => setAuthUsername(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="authPassword">Password</Label>
                  <Input
                    id="authPassword"
                    type="password"
                    autoComplete="off"
                    value={authPassword}
                    onChange={(event) => setAuthPassword(event.target.value)}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Body & response</CardTitle>
          <CardDescription>
            JSON only for request bodies. Examples are stored for documentation; they are not sent unless you probe.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="bodyExample">Body example (JSON)</Label>
            <Textarea
              id="bodyExample"
              rows={8}
              value={bodyText}
              onChange={(event) => setBodyText(event.target.value)}
              placeholder={method === "GET" ? "GET requests usually have no body." : '{"prompt":"hello"}'}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="responseExample">Response example (JSON, optional)</Label>
            <Textarea
              id="responseExample"
              rows={8}
              value={responseText}
              onChange={(event) => setResponseText(event.target.value)}
              placeholder='{"status":true,"message":"hello"}'
            />
          </div>
          <div className="space-y-1.5 lg:col-span-2">
            <Label htmlFor="contentType">Content type</Label>
            <Select id="contentType" value={contentType} onChange={(event) => setContentType(event.target.value)}>
              <option value="application/json">application/json</option>
              <option value="application/x-www-form-urlencoded">application/x-www-form-urlencoded</option>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between">
          <div>
            <CardTitle>Probe before saving</CardTitle>
            <CardDescription>
              Sends one real request with the values above. On create, a successful probe also records verification.
            </CardDescription>
          </div>
          <Button variant="secondary" size="sm" onClick={runProbe} disabled={probing || !baseUrl || !path}>
            {probing ? <Loader2 className="animate-spin" /> : <FlaskConical />} Probe
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="break-all rounded-md border border-border bg-black/30 px-3 py-2 font-mono text-[11px] text-muted-foreground">
            {method} {parsedPreview}
          </p>
          {probe ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant={probe.ok ? "success" : "destructive"}>
                  HTTP {probe.status} {probe.statusText}
                </Badge>
                <Badge variant="secondary">{probe.durationMs} ms</Badge>
                <Badge variant="outline">{probe.contentType || "unknown"}</Badge>
                {probe.ok ? <CheckCircle2 className="h-4 w-4 text-success" /> : <AlertTriangle className="h-4 w-4 text-amber-300" />}
              </div>
              {probe.body !== null && probe.body !== undefined ? (
                <JsonViewer value={probe.body} maxHeight="16rem" />
              ) : probe.bodyText ? (
                <pre className="scrollbar-thin max-h-64 overflow-auto rounded-md border border-border bg-black/40 p-3 font-mono text-xs">
                  {probe.bodyText}
                </pre>
              ) : (
                <p className="text-sm text-muted-foreground">Empty body.</p>
              )}
              <details className="rounded-md border border-border bg-card/40 p-3 text-xs">
                <summary className="cursor-pointer text-muted-foreground">Detected headers</summary>
                <pre className="mt-2 max-h-48 overflow-auto font-mono">
                  {Object.entries(probe.headers).map(([key, value]) => `${key}: ${value}`).join("\n")}
                </pre>
              </details>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No probe yet. Probing is optional, but it is the only way to observe the real status, content type
              and body before saving.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Classification & visibility</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="category">Category</Label>
            <Select id="category" value={categorySlug} onChange={(event) => setCategorySlug(event.target.value)}>
              <option value="">Uncategorised (general)</option>
              {categories.map((category) => (
                <option key={category.slug} value={category.slug}>
                  {category.name}
                </option>
              ))}
            </Select>
            <Input
              value={categoryName}
              onChange={(event) => setCategoryName(event.target.value)}
              placeholder="…or create a new category by name"
              className="mt-2"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="provider">Provider name (optional)</Label>
            <Input
              id="provider"
              value={providerName}
              onChange={(event) => setProviderName(event.target.value)}
              placeholder="Derived from the base URL host if blank"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="docsUrl">Documentation URL</Label>
            <Input id="docsUrl" type="url" value={docsUrl} onChange={(event) => setDocsUrl(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sourceUrl">Source URL</Label>
            <Input id="sourceUrl" type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2 md:col-span-2">
            {toggles.map(([label, checked, setter]) => (
              <label key={label} className="flex items-center gap-2 rounded-md border border-border/70 px-3 py-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => setter(event.target.checked)}
                />
                {label}
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {mode === "edit"
            ? "Changes apply immediately to gateway executions."
            : "New endpoints are saved as unverified until a real request succeeds."}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => router.back()} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !name.trim() || !baseUrl.trim()}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            {mode === "create" ? "Save endpoint" : "Save changes"}
          </Button>
        </div>
      </div>
    </form>
  );
}
