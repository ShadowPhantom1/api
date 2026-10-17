"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, Play, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { JsonViewer } from "@/components/ui/json-viewer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, errorMessage } from "@/lib/client/api";
import type { BodySchema, HeaderDef, ParamDef } from "@/lib/db/types";
import { cn } from "@/lib/utils";

export interface ConsoleApi {
  id: string;
  slug: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  base_url: string;
  path: string;
  query_params: ParamDef[];
  path_params: ParamDef[];
  headers_schema: HeaderDef[];
  body_schema: BodySchema | null;
  content_type: string;
  allow_extra_query: boolean;
  supports_streaming: boolean;
  credential_configured: boolean;
  request_example: Record<string, unknown> | null;
}

interface ExecuteResponse {
  verification: { status: "verified" | "failed"; message: string | null } | null;
  result: {
    ok: boolean;
    status: number;
    statusText: string;
    contentType: string;
    headers: Record<string, string>;
    durationMs: number;
    size: number;
    truncated: boolean;
    body: unknown;
    bodyText: string | null;
    request: { method: string; url: string; queryNames: string[]; headerNames: string[] };
  };
}

function initialValue(param: ParamDef, sample: Record<string, unknown> | null): string {
  const fromSample = sample && typeof sample[param.name] === "string" ? String(sample[param.name]) : "";
  return param.example ?? fromSample ?? param.default ?? (param.enum?.[0] ?? "");
}

export function ApiConsole({ api }: { api: ConsoleApi }) {
  const sample =
    api.request_example && typeof api.request_example.query === "object" && api.request_example.query
      ? (api.request_example.query as Record<string, unknown>)
      : null;

  const [tab, setTab] = useState<"params" | "headers" | "body">("params");
  const [queryValues, setQueryValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(api.query_params.map((param) => [param.name, initialValue(param, sample)])),
  );
  const [pathValues, setPathValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      api.path_params.map((param) => [
        param.name,
        param.example ?? sample?.[param.name]?.toString() ?? "",
      ]),
    ),
  );
  const [headerValues, setHeaderValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(api.headers_schema.filter((h) => !h.secret).map((h) => [h.name, h.example ?? ""])),
  );
  const [extraParams, setExtraParams] = useState<Array<{ name: string; value: string }>>([]);
  const [bodyText, setBodyText] = useState(() =>
    api.body_schema?.example !== undefined
      ? JSON.stringify(api.body_schema.example, null, 2)
      : "",
  );
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ExecuteResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const previewUrl = useMemo(() => {
    try {
      let path = api.path;
      for (const param of api.path_params) {
        const value = pathValues[param.name] ?? "";
        path = path.replace(
          new RegExp(`\\{${param.name}\\}`, "g"),
          encodeURIComponent(value || `{${param.name}}`),
        );
      }
      const url = new URL(`${api.base_url.replace(/\/+$/, "")}${path}`);
      for (const param of api.query_params) {
        const value = queryValues[param.name];
        if (value) url.searchParams.set(param.name, value);
      }
      for (const extra of extraParams) {
        if (extra.name.trim()) url.searchParams.set(extra.name.trim(), extra.value);
      }
      return url.toString();
    } catch {
      return `${api.base_url}${api.path}`;
    }
  }, [api, pathValues, queryValues, extraParams]);

  const missingRequired = [
    ...api.query_params
      .filter((param) => param.required && !queryValues[param.name])
      .map((param) => `query.${param.name}`),
    ...api.path_params
      .filter((param) => param.required && !pathValues[param.name])
      .map((param) => `path.${param.name}`),
  ];

  const run = async () => {
    setLoading(true);
    setFailure(null);
    setResponse(null);
    try {
      let body: unknown;
      if (api.method !== "GET" && bodyText.trim()) {
        try {
          body = JSON.parse(bodyText);
        } catch {
          throw new Error("The request body is not valid JSON.");
        }
      }
      const query: Record<string, string> = {};
      for (const param of api.query_params) {
        const value = queryValues[param.name];
        if (value !== undefined && value !== "") query[param.name] = value;
      }
      for (const extra of extraParams) {
        if (extra.name.trim()) query[extra.name.trim()] = extra.value;
      }
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(headerValues)) {
        if (value) headers[name] = value;
      }
      const payload = await apiFetch<ExecuteResponse>(`/api/apis/${api.id}/test`, {
        method: "POST",
        body: JSON.stringify({
          query,
          pathParams: pathValues,
          headers,
          ...(body !== undefined ? { body } : {}),
        }),
      });
      setResponse(payload);
      if (payload.result.ok) {
        toast.success(`HTTP ${payload.result.status} in ${payload.result.durationMs} ms`);
      } else {
        toast.warning(`Upstream returned HTTP ${payload.result.status}`);
      }
    } catch (error) {
      const message = errorMessage(error);
      setFailure(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const curl = useMemo(() => {
    const query = Object.fromEntries(
      Object.entries(queryValues).filter(([, value]) => value !== ""),
    );
    const payload = {
      apiSlug: api.slug,
      ...(Object.keys(query).length ? { query } : {}),
      ...(Object.keys(pathValues).length ? { pathParams: pathValues } : {}),
      ...(Object.keys(headerValues).filter((key) => headerValues[key]).length
        ? { headers: Object.fromEntries(Object.entries(headerValues).filter(([, v]) => v)) }
        : {}),
    };
    return [
      `curl -s -X POST "$APP_URL/api/gateway/execute" \\`,
      `  -H "Authorization: Bearer $ANVEX_KEY" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '${JSON.stringify(payload)}'`,
    ].join("\n");
  }, [api.slug, queryValues, pathValues, headerValues]);

  const responseBody =
    response?.result.body !== null && response?.result.body !== undefined
      ? response.result.body
      : response?.result.bodyText ?? null;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card/60">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-2.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">{api.method}</Badge>
            <span className="break-all font-mono">{previewUrl}</span>
          </div>
          <Button size="sm" onClick={run} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <Play />} Send request
          </Button>
        </div>

        <div className="flex gap-1 border-b border-border/70 px-3 pt-2">
          {(
            [
              ["params", `Parameters (${api.query_params.length + api.path_params.length})`],
              ["headers", `Headers (${api.headers_schema.length})`],
              ["body", "Body"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "rounded-t-md px-3 py-2 text-xs",
                tab === key
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="space-y-4 p-4">
          {tab === "params" ? (
            <div className="space-y-4">
              {api.path_params.length ? (
                <div className="space-y-2">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Path parameters</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {api.path_params.map((param) => (
                      <div key={param.name} className="space-y-1">
                        <Label htmlFor={`path-${param.name}`}>
                          {param.name} {param.required ? <span className="text-destructive">*</span> : null}
                        </Label>
                        <Input
                          id={`path-${param.name}`}
                          value={pathValues[param.name] ?? ""}
                          placeholder={param.description ?? "value"}
                          onChange={(event) =>
                            setPathValues((current) => ({ ...current, [param.name]: event.target.value }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {api.query_params.length ? (
                <div className="space-y-2">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Query parameters</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {api.query_params.map((param) => (
                      <div key={param.name} className="space-y-1">
                        <Label htmlFor={`query-${param.name}`}>
                          {param.name}
                          {param.required ? <span className="text-destructive"> *</span> : null}
                          <span className="ml-1 normal-case tracking-normal text-muted-foreground/70">
                            {param.type ?? "string"}
                          </span>
                        </Label>
                        {param.enum?.length ? (
                          <Select
                            id={`query-${param.name}`}
                            value={queryValues[param.name] ?? ""}
                            onChange={(event) =>
                              setQueryValues((current) => ({
                                ...current,
                                [param.name]: event.target.value,
                              }))
                            }
                          >
                            <option value="">—</option>
                            {param.enum.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <Input
                            id={`query-${param.name}`}
                            value={queryValues[param.name] ?? ""}
                            placeholder={param.example ?? param.description ?? "value"}
                            onChange={(event) =>
                              setQueryValues((current) => ({
                                ...current,
                                [param.name]: event.target.value,
                              }))
                            }
                          />
                        )}
                        {param.description ? (
                          <p className="text-[11px] text-muted-foreground">{param.description}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {!api.query_params.length && !api.path_params.length ? (
                <p className="text-sm text-muted-foreground">This endpoint declares no inputs.</p>
              ) : null}

              {api.allow_extra_query ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Extra query parameters</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setExtraParams((current) => [...current, { name: "", value: "" }])}
                    >
                      <Plus /> Add
                    </Button>
                  </div>
                  {extraParams.map((entry, index) => (
                    <div key={index} className="flex gap-2">
                      <Input
                        value={entry.name}
                        placeholder="name"
                        onChange={(event) =>
                          setExtraParams((current) =>
                            current.map((item, position) =>
                              position === index ? { ...item, name: event.target.value } : item,
                            ),
                          )
                        }
                      />
                      <Input
                        value={entry.value}
                        placeholder="value"
                        onChange={(event) =>
                          setExtraParams((current) =>
                            current.map((item, position) =>
                              position === index ? { ...item, value: event.target.value } : item,
                            ),
                          )
                        }
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          setExtraParams((current) => current.filter((_, position) => position !== index))
                        }
                        aria-label="Remove parameter"
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}

              {missingRequired.length ? (
                <p className="flex items-center gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
                  <AlertTriangle className="h-4 w-4" />
                  Required values missing: {missingRequired.join(", ")}. The gateway will reject the request.
                </p>
              ) : null}
            </div>
          ) : null}

          {tab === "headers" ? (
            <div className="space-y-3">
              {api.headers_schema.length ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {api.headers_schema.map((header) =>
                    header.secret ? (
                      <div key={header.name} className="rounded-md border border-border/70 bg-secondary/30 p-3 text-xs text-muted-foreground">
                        <p className="font-mono text-foreground">{header.name}</p>
                        <p className="mt-1">Secret header — value is injected server-side from encrypted storage.</p>
                      </div>
                    ) : (
                      <div key={header.name} className="space-y-1">
                        <Label htmlFor={`header-${header.name}`}>{header.name}</Label>
                        <Input
                          id={`header-${header.name}`}
                          value={headerValues[header.name] ?? ""}
                          placeholder={header.example ?? "value"}
                          onChange={(event) =>
                            setHeaderValues((current) => ({
                              ...current,
                              [header.name]: event.target.value,
                            }))
                          }
                        />
                      </div>
                    ),
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">This endpoint declares no custom headers.</p>
              )}
              {api.credential_configured ? (
                <p className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
                  Upstream credentials are configured. Anvex injects them on the server; they are never sent from this page.
                </p>
              ) : null}
            </div>
          ) : null}

          {tab === "body" ? (
            <div className="space-y-2">
              {api.method === "GET" ? (
                <p className="text-sm text-muted-foreground">GET endpoints do not send a request body.</p>
              ) : (
                <>
                  <Label htmlFor="console-body">JSON body</Label>
                  <Textarea
                    id="console-body"
                    rows={10}
                    value={bodyText}
                    onChange={(event) => setBodyText(event.target.value)}
                    placeholder='{"messages":[{"role":"user","content":"hello"}]}'
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Content type: <span className="font-mono">{api.content_type}</span>. Bodies are capped at 256 KB.
                  </p>
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {failure ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {failure}
        </div>
      ) : null}

      {response ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant={response.result.ok ? "success" : "destructive"}>
              HTTP {response.result.status} {response.result.statusText}
            </Badge>
            <Badge variant="secondary">{response.result.durationMs} ms</Badge>
            <Badge variant="outline">{response.result.contentType || "unknown content type"}</Badge>
            {response.result.truncated ? <Badge variant="warning">truncated</Badge> : null}
            {response.verification ? (
              <Badge variant={response.verification.status === "verified" ? "success" : "destructive"}>
                saved as {response.verification.status}
              </Badge>
            ) : null}
          </div>
          <p className="break-all rounded-md border border-border bg-black/30 px-3 py-2 font-mono text-[11px] text-muted-foreground">
            {response.result.request.method} {response.result.request.url}
          </p>
          {responseBody !== null ? (
            typeof responseBody === "string" ? (
              <div className="rounded-md border border-border bg-black/40 p-3">
                <pre className="scrollbar-thin max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-slate-200">
                  {responseBody}
                </pre>
              </div>
            ) : (
              <JsonViewer value={responseBody} />
            )
          ) : (
            <p className="text-sm text-muted-foreground">Empty response body.</p>
          )}
          <details className="rounded-md border border-border bg-card/40 p-3 text-xs">
            <summary className="cursor-pointer text-muted-foreground">Response headers ({Object.keys(response.result.headers).length})</summary>
            <pre className="scrollbar-thin mt-2 max-h-60 overflow-auto font-mono">
              {Object.entries(response.result.headers)
                .map(([name, value]) => `${name}: ${value}`)
                .join("\n")}
            </pre>
          </details>
        </div>
      ) : null}

      <details className="rounded-md border border-border bg-card/40 p-3">
        <summary className="cursor-pointer text-xs text-muted-foreground">Use this endpoint from your code</summary>
        <div className="mt-3">
          <CodeBlock language="curl · gateway" code={curl} />
        </div>
      </details>
    </div>
  );
}
