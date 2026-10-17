"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, KeyRound, Loader2, Plus, RefreshCw, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { apiFetch, errorMessage } from "@/lib/client/api";
import { formatDate, relativeTime } from "@/lib/utils";

export interface KeyItem {
  id: string;
  name: string;
  prefix: string;
  lastFour: string;
  permissions: string[];
  rateLimitPerMinute: number;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export function KeysManager({ keys }: { keys: KeyItem[] }) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [secret, setSecret] = useState<{ value: string; title: string; warning: string } | null>(null);
  const [name, setName] = useState("");
  const [rateLimit, setRateLimit] = useState(60);
  const [expiry, setExpiry] = useState("0");
  const [permissions, setPermissions] = useState<string[]>(["execute", "chat", "models"]);
  const [busy, setBusy] = useState<string | null>(null);

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy("create");
    try {
      const payload = await apiFetch<{ secret: string; warning: string; key: KeyItem }>("/api/keys", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          rateLimitPerMinute: rateLimit,
          permissions,
          expiresInDays: expiry === "0" ? null : Number.parseInt(expiry, 10),
        }),
      });
      setCreateOpen(false);
      setName("");
      setSecret({ value: payload.secret, title: "API key created", warning: payload.warning });
      router.refresh();
      toast.success("Key created. Copy it now.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const rotate = async (key: KeyItem) => {
    if (!window.confirm(`Rotate "${key.name}"? The current key is revoked immediately.`)) return;
    setBusy(`rotate:${key.id}`);
    try {
      const payload = await apiFetch<{ secret: string; warning: string }>(`/api/keys/${key.id}/rotate`, {
        method: "POST",
      });
      setSecret({ value: payload.secret, title: "Key rotated", warning: payload.warning });
      router.refresh();
      toast.success("Key rotated. The old key was revoked.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (key: KeyItem) => {
    if (!window.confirm(`Revoke "${key.name}"? Clients using it will receive 401 immediately.`)) return;
    setBusy(`revoke:${key.id}`);
    try {
      await apiFetch(`/api/keys/${key.id}`, { method: "DELETE" });
      toast.success("Key revoked.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const copySecret = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.value);
      toast.success("Key copied to clipboard.");
    } catch {
      toast.error("Clipboard unavailable. Select and copy manually.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {keys.filter((key) => !key.revokedAt).length} active · {keys.length} total. Only a digest is stored.
        </p>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus /> Create key
        </Button>
      </div>

      {keys.length ? (
        <div className="space-y-3">
          {keys.map((key) => {
            const revoked = Boolean(key.revokedAt);
            const expired = key.expiresAt ? new Date(key.expiresAt).getTime() < Date.now() : false;
            return (
              <div key={key.id} className="rounded-lg border border-border bg-card/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <KeyRound className="h-4 w-4 text-primary" />
                      <p className="font-medium">{key.name}</p>
                      {revoked ? <Badge variant="destructive">revoked</Badge> : expired ? <Badge variant="warning">expired</Badge> : <Badge variant="success">active</Badge>}
                    </div>
                    <p className="font-mono text-xs text-muted-foreground">
                      {key.prefix}…{key.lastFour}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-muted-foreground">
                      {key.permissions.map((permission) => (
                        <Badge key={permission} variant="outline" className="text-[10px]">
                          {permission}
                        </Badge>
                      ))}
                      <span>{key.rateLimitPerMinute} req/min</span>
                      <span>created {formatDate(key.createdAt)}</span>
                      <span>last used {key.lastUsedAt ? relativeTime(key.lastUsedAt) : "never"}</span>
                      {key.expiresAt ? <span>expires {formatDate(key.expiresAt)}</span> : <span>no expiry</span>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={revoked || busy !== null}
                      onClick={() => rotate(key)}
                    >
                      {busy === `rotate:${key.id}` ? <Loader2 className="animate-spin" /> : <RefreshCw />} Rotate
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={revoked || busy !== null}
                      onClick={() => revoke(key)}
                    >
                      {busy === `revoke:${key.id}` ? <Loader2 className="animate-spin" /> : <ShieldOff />} Revoke
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="No platform keys yet"
          description="Create a scoped key for scripts, the REST gateway, or the OpenAI-compatible endpoint. The secret is shown once."
          icon={<KeyRound className="h-6 w-6" />}
        />
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <CodeBlock
          language="curl · REST gateway"
          code={`curl -s -X POST "$APP_URL/api/gateway/execute" \\
  -H "Authorization: Bearer anx_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"apiSlug":"claude-haiku","query":{"q":"hello"}}'`}
        />
        <CodeBlock
          language="curl · OpenAI-compatible"
          code={`curl -s "$APP_URL/v1/chat/completions" \\
  -H "Authorization: Bearer anx_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"model":"rebix-claude-haiku","messages":[{"role":"user","content":"hello"}]}'`}
        />
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a platform key</DialogTitle>
            <DialogDescription>
              Scopes limit what the key can do. Rate limits are enforced per key per minute on the server.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={create} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="keyName">Name</Label>
              <Input id="keyName" required value={name} onChange={(event) => setName(event.target.value)} placeholder="Production script" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="keyRate">Rate limit / minute</Label>
                <Input
                  id="keyRate"
                  type="number"
                  min={1}
                  max={1000}
                  value={rateLimit}
                  onChange={(event) => setRateLimit(Number.parseInt(event.target.value, 10) || 60)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="keyExpiry">Expiry</Label>
                <Select id="keyExpiry" value={expiry} onChange={(event) => setExpiry(event.target.value)}>
                  <option value="0">Never</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="365">1 year</option>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Permissions</Label>
              <div className="grid gap-2 sm:grid-cols-3">
                {["execute", "chat", "models"].map((permission) => (
                  <label key={permission} className="flex items-center gap-2 rounded-md border border-border/70 px-3 py-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={permissions.includes(permission)}
                      onChange={(event) =>
                        setPermissions((current) =>
                          event.target.checked
                            ? [...current, permission]
                            : current.filter((value) => value !== permission),
                        )
                      }
                    />
                    {permission}
                  </label>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy === "create" || !name.trim() || !permissions.length}>
                {busy === "create" ? <Loader2 className="animate-spin" /> : <KeyRound />} Create key
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(secret)} onOpenChange={(open) => !open && setSecret(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{secret?.title ?? "API key"}</DialogTitle>
            <DialogDescription>{secret?.warning}</DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-amber-400/30 bg-amber-400/10 p-3">
            <p className="break-all font-mono text-xs text-amber-100">{secret?.value}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={copySecret}>
              <Copy /> Copy key
            </Button>
            <Button onClick={() => setSecret(null)}>I saved it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
