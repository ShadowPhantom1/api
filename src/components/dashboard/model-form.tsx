"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, errorMessage } from "@/lib/client/api";
import { slugify } from "@/lib/utils";

type Adapter = "openai_compatible" | "anthropic_messages" | "gemini_generate" | "rebix_text";
type AuthType = "none" | "bearer" | "api_key" | "basic";

const adapterDescriptions: Record<Adapter, string> = {
  openai_compatible:
    "OpenAI-compatible /chat/completions. Supports SSE streaming when enabled. Tool calling is not implemented by this gateway.",
  anthropic_messages:
    "Anthropic Messages API (/v1/messages). Responses are translated to OpenAI shape. No streaming or tools.",
  gemini_generate: "Gemini generateContent. Responses are translated. No streaming or tools.",
  rebix_text:
    "Simple GET ?q= text API. Maps the last user message to a query parameter. No streaming, tools, or usage reporting.",
};

export function ModelForm({
  apis,
}: {
  apis: Array<{ slug: string; name: string; method: string; is_public: boolean }>;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [adapter, setAdapter] = useState<Adapter>("rebix_text");
  const [baseUrl, setBaseUrl] = useState("");
  const [chatPath, setChatPath] = useState("/chat/completions");
  const [upstreamModel, setUpstreamModel] = useState("");
  const [apiSlug, setApiSlug] = useState("");
  const [authType, setAuthType] = useState<AuthType>("none");
  const [authToken, setAuthToken] = useState("");
  const [authApiKey, setAuthApiKey] = useState("");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [headerName, setHeaderName] = useState("");
  const [contextWindow, setContextWindow] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [isEnabled, setIsEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linkedApis = apis.filter((api) => api.method === "GET");

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const effectiveSlug = slug.trim() || slugify(name);
      const auth: Record<string, string> = {};
      if (authType === "bearer" && authToken) auth.token = authToken;
      if (authType === "api_key" && authApiKey) auth.apiKey = authApiKey;
      if (authType === "basic") {
        if (authUsername) auth.username = authUsername;
        if (authPassword) auth.password = authPassword;
      }
      if (headerName) auth.headerName = headerName;

      await apiFetch("/api/models", {
        method: "POST",
        body: JSON.stringify({
          slug: effectiveSlug,
          name: name.trim(),
          description: description.trim() || null,
          adapter,
          ...(adapter === "rebix_text" ? { apiSlug } : { baseUrl: baseUrl.trim() }),
          chatPath,
          ...(upstreamModel.trim() ? { upstreamModel: upstreamModel.trim() } : {}),
          authType,
          ...(authType !== "none" ? { auth } : {}),
          capabilities: { chat: true, streaming: adapter === "openai_compatible" ? streaming : false, tools: false, usage: adapter !== "rebix_text" },
          ...(contextWindow.trim() ? { contextWindow: Number.parseInt(contextWindow, 10) || null } : {}),
          isPublic,
          isEnabled,
        }),
      });
      toast.success("Model registered.");
      setName("");
      setSlug("");
      setDescription("");
      setAuthToken("");
      setAuthApiKey("");
      setAuthPassword("");
      router.refresh();
    } catch (submitError) {
      setError(errorMessage(submitError));
      toast.error(errorMessage(submitError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="modelName">Name *</Label>
          <Input id="modelName" required value={name} onChange={(event) => setName(event.target.value)} placeholder="My GPT-4o" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="modelSlug">Slug</Label>
          <Input
            id="modelSlug"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            placeholder={name ? slugify(name) : "auto-generated"}
            className="font-mono text-xs"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="modelDescription">Description</Label>
        <Textarea id="modelDescription" rows={2} value={description} onChange={(event) => setDescription(event.target.value)} className="font-sans text-sm" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="adapter">Adapter</Label>
        <Select
          id="adapter"
          value={adapter}
          onChange={(event) => setAdapter(event.target.value as Adapter)}
        >
          {Object.keys(adapterDescriptions).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
        <p className="text-[11px] text-muted-foreground">{adapterDescriptions[adapter]}</p>
      </div>

      {adapter === "rebix_text" ? (
        <div className="space-y-1.5">
          <Label htmlFor="apiSlug">Linked GET endpoint *</Label>
          <Select id="apiSlug" required value={apiSlug} onChange={(event) => setApiSlug(event.target.value)}>
            <option value="">Select an accessible endpoint…</option>
            {linkedApis.map((api) => (
              <option key={api.slug} value={api.slug}>
                {api.name} ({api.slug}){api.is_public ? " · public" : ""}
              </option>
            ))}
          </Select>
          <p className="text-[11px] text-muted-foreground">
            The adapter maps the last user message to the endpoint&apos;s first query parameter (prefers &quot;q&quot;).
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="modelBaseUrl">Upstream base URL *</Label>
            <Input
              id="modelBaseUrl"
              required
              type="url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.openai.com/v1"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="chatPath">Chat path</Label>
            <Input
              id="chatPath"
              value={chatPath}
              onChange={(event) => setChatPath(event.target.value)}
              placeholder="/chat/completions"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="upstreamModel">Upstream model id</Label>
            <Input
              id="upstreamModel"
              value={upstreamModel}
              onChange={(event) => setUpstreamModel(event.target.value)}
              placeholder="gpt-4o-mini"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contextWindow">Context window</Label>
            <Input
              id="contextWindow"
              type="number"
              min={0}
              value={contextWindow}
              onChange={(event) => setContextWindow(event.target.value)}
              placeholder="128000"
            />
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="modelAuthType">Upstream auth</Label>
          <Select id="modelAuthType" value={authType} onChange={(event) => setAuthType(event.target.value as AuthType)}>
            <option value="none">None</option>
            <option value="bearer">Bearer token</option>
            <option value="api_key">API key header</option>
            <option value="basic">HTTP basic</option>
          </Select>
        </div>
        {authType === "bearer" ? (
          <div className="space-y-1.5">
            <Label htmlFor="modelToken">Token</Label>
            <Input id="modelToken" type="password" autoComplete="off" value={authToken} onChange={(event) => setAuthToken(event.target.value)} />
          </div>
        ) : null}
        {authType === "api_key" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="modelApiKey">API key</Label>
              <Input id="modelApiKey" type="password" autoComplete="off" value={authApiKey} onChange={(event) => setAuthApiKey(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="modelHeader">Header name</Label>
              <Input id="modelHeader" value={headerName} onChange={(event) => setHeaderName(event.target.value)} placeholder="default per adapter" />
            </div>
          </div>
        ) : null}
        {authType === "basic" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="modelUser">Username</Label>
              <Input id="modelUser" autoComplete="off" value={authUsername} onChange={(event) => setAuthUsername(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="modelPassword">Password</Label>
              <Input id="modelPassword" type="password" autoComplete="off" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} />
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex items-center gap-2 rounded-md border border-border/70 px-3 py-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            disabled={adapter !== "openai_compatible"}
            checked={adapter === "openai_compatible" && streaming}
            onChange={(event) => setStreaming(event.target.checked)}
          />
          Advertise SSE streaming (openai_compatible only)
        </label>
        <div className="flex items-center gap-4 rounded-md border border-border/70 px-3 py-2 text-xs text-muted-foreground">
          <span>tools: unsupported</span>
          <span>usage: {adapter === "rebix_text" ? "not reported" : "when upstream returns it"}</span>
        </div>
        <label className="flex items-center gap-2 rounded-md border border-border/70 px-3 py-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} /> Public
        </label>
        <label className="flex items-center gap-2 rounded-md border border-border/70 px-3 py-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={isEnabled} onChange={(event) => setIsEnabled(event.target.checked)} /> Enabled
        </label>
      </div>

      <Button type="submit" disabled={saving || !name.trim() || (adapter === "rebix_text" ? !apiSlug : !baseUrl.trim())}>
        {saving ? <Loader2 className="animate-spin" /> : <Plus />} Register model
      </Button>
    </form>
  );
}
