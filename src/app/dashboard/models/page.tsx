import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import { PageHeader } from "@/components/ui/page-header";
import { ChatTester } from "@/components/dashboard/chat-tester";
import { CapabilityBadges, ModelActions } from "@/components/dashboard/models-manager";
import { ModelForm } from "@/components/dashboard/model-form";
import { getApiOptions, getModelsForViewer, requireUser } from "@/lib/dashboard/data";

export const metadata: Metadata = { title: "AI models" };
export const dynamic = "force-dynamic";

export default async function ModelsPage() {
  const { admin, caller, user, isAdmin } = await requireUser();
  const [models, apis] = await Promise.all([
    getModelsForViewer(admin, caller),
    getApiOptions(admin, caller),
  ]);
  const apiById = new Map(apis.map((api) => [api.id, api]));

  const curl = [
    `curl -s "$APP_URL/v1/chat/completions" \\`,
    `  -H "Authorization: Bearer $ANVEX_KEY" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"model":"rebix-claude-haiku","messages":[{"role":"user","content":"hello"}]}'`,
  ].join("\n");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Gateway"
        title="AI models"
        description="OpenAI-shaped aliases with documented adapters. Capabilities are normalized: streaming only for OpenAI-compatible upstreams, tools never claimed, usage only when the upstream reports it."
        actions={
          <Link href="/dashboard/keys" className="text-xs text-primary hover:underline">
            <KeyRound className="mr-1 inline h-3.5 w-3.5" /> Create a platform key
          </Link>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="space-y-4">
          {models.length ? (
            models.map((model) => {
              const linkedApi = model.api_id ? apiById.get(model.api_id) : null;
              const canManage = model.owner_id === user.id || isAdmin;
              return (
                <Card key={model.id}>
                  <CardHeader className="flex-row items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-sm">{model.name}</CardTitle>
                        <Badge variant="outline">{model.adapter}</Badge>
                        {model.is_enabled ? <Badge variant="success">enabled</Badge> : <Badge variant="secondary">disabled</Badge>}
                        {model.is_public ? <Badge variant="info">public</Badge> : <Badge variant="secondary">private</Badge>}
                      </div>
                      <p className="font-mono text-[11px] text-muted-foreground">{model.slug}</p>
                      <CardDescription>{model.description ?? "No description."}</CardDescription>
                    </div>
                    <ModelActions model={model} canManage={canManage} />
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <CapabilityBadges model={model} />
                    <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                      <p>
                        Linked endpoint:{" "}
                        {linkedApi ? (
                          <Link href={`/dashboard/apis/${linkedApi.slug}`} className="text-primary hover:underline">
                            {linkedApi.name}
                          </Link>
                        ) : (
                          <span className="font-mono">{model.base_url ?? "none"}</span>
                        )}
                      </p>
                      <p>
                        Upstream model: <span className="font-mono">{model.upstream_model ?? "—"}</span>
                      </p>
                      <p>
                        Auth: <span className="font-mono">{model.auth_type}</span>{" "}
                        {model.auth_config_encrypted ? "(encrypted)" : ""}
                      </p>
                      <p>Context: {model.context_window ? model.context_window.toLocaleString() : "—"}</p>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          ) : (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                No models registered yet. Use the form to link a GET endpoint with the simple text adapter, or an
                OpenAI-compatible base URL.
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Chat completion tester</CardTitle>
              <CardDescription>
                Calls this deployment&apos;s <span className="font-mono">/v1/chat/completions</span> with your session.
                Model aliases that are private to another account are not accessible.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChatTester models={models} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>OpenAI-compatible quickstart</CardTitle>
              <CardDescription>
                Use a platform key with the <span className="font-mono">chat</span> permission. Streaming works only
                for adapters that genuinely support SSE.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <CodeBlock language="curl" code={curl} />
              <p className="text-xs text-muted-foreground">
                Unsupported fields such as <span className="font-mono">tools</span> and{" "}
                <span className="font-mono">response_format</span> are rejected with a structured 400 instead of being silently ignored.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Register a model</CardTitle>
              <CardDescription>
                Models you create are private by default. Admin-created models can be public and read-only for others.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ModelForm apis={apis} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Honest capability matrix</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <p><span className="text-foreground">rebix_text</span> — chat via GET query, no streaming, no tools, no usage.</p>
              <p><span className="text-foreground">openai_compatible</span> — chat + optional SSE, no tools; usage if upstream returns it.</p>
              <p><span className="text-foreground">anthropic_messages</span> — chat, no SSE, no tools, usage from response.</p>
              <p><span className="text-foreground">gemini_generate</span> — chat, no SSE, no tools, usage from response.</p>
              <p className="pt-1 text-[11px]">
                DeepSeek rebix routes failed verification with upstream HTTP 422 and are registered disabled rather than
                advertised as working.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4 text-primary" /> Programmatic discovery
          </CardTitle>
          <CardDescription>
            <span className="font-mono">GET /v1/models</span> returns only enabled, accessible aliases. It requires a
            key with the <span className="font-mono">models</span> permission.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="font-mono text-xs text-muted-foreground">curl -s &quot;$APP_URL/v1/models&quot; -H &quot;Authorization: Bearer $ANVEX_KEY&quot;</p>
        </CardContent>
      </Card>
    </div>
  );
}
