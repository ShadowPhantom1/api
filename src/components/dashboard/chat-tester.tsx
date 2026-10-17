"use client";

import { useState } from "react";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { JsonViewer } from "@/components/ui/json-viewer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, errorMessage } from "@/lib/client/api";
import type { AiModelRecord } from "@/lib/db/types";

export function ChatTester({ models }: { models: AiModelRecord[] }) {
  const enabled = models.filter((model) => model.is_enabled);
  const [modelSlug, setModelSlug] = useState(enabled[0]?.slug ?? "");
  const [prompt, setPrompt] = useState("Say hello in one short sentence.");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<unknown>(null);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selected = enabled.find((model) => model.slug === modelSlug);

  const send = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResponse(null);
    setContent(null);
    try {
      const payload = await apiFetch<{
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      }>("/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model: modelSlug,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      setResponse(payload);
      const text = payload.choices?.[0]?.message?.content ?? null;
      setContent(text);
      if (!text) setError("The gateway returned a response without a message content field.");
      else toast.success("Chat completion received.");
    } catch (sendError) {
      setError(errorMessage(sendError));
      toast.error(errorMessage(sendError));
    } finally {
      setLoading(false);
    }
  };

  if (!enabled.length) {
    return (
      <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        No enabled model is available. Register one first.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <form onSubmit={send} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="chatModel">Model</Label>
            <Select id="chatModel" value={modelSlug} onChange={(event) => setModelSlug(event.target.value)}>
              {enabled.map((model) => (
                <option key={model.id} value={model.slug}>
                  {model.name} ({model.slug})
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Endpoint</Label>
            <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background/60 px-3 font-mono text-xs text-muted-foreground">
              <MessageSquare className="h-3.5 w-3.5" /> POST /v1/chat/completions
            </div>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="chatPrompt">User message</Label>
          <Textarea
            id="chatPrompt"
            rows={3}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className="font-sans text-sm"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={loading || !modelSlug || !prompt.trim()}>
            {loading ? <Loader2 className="animate-spin" /> : <Send />} Send
          </Button>
          {selected ? (
            <span className="text-[11px] text-muted-foreground">
              adapter: {selected.adapter} · streaming: {selected.capabilities.streaming ? "yes" : "no"} · tools: no
            </span>
          ) : null}
        </div>
      </form>

      {error ? <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p> : null}

      {content ? (
        <div className="space-y-2">
          <Badge variant="success">assistant</Badge>
          <div className="whitespace-pre-wrap rounded-md border border-border bg-card/60 p-4 text-sm">
            {content}
          </div>
        </div>
      ) : null}

      {response ? (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">Raw OpenAI-shaped response</summary>
          <div className="mt-2">
            <JsonViewer value={response} maxHeight="20rem" />
          </div>
        </details>
      ) : null}
    </div>
  );
}
