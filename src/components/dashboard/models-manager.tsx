"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Power, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch, errorMessage } from "@/lib/client/api";
import type { AiModelRecord } from "@/lib/db/types";

export function ModelActions({
  model,
  canManage,
}: {
  model: AiModelRecord;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!canManage) return null;

  const toggle = async () => {
    setBusy(true);
    try {
      await apiFetch(`/api/models/${model.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isEnabled: !model.is_enabled }),
      });
      toast.success(model.is_enabled ? "Model disabled." : "Model enabled.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete model "${model.name}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await apiFetch(`/api/models/${model.id}`, { method: "DELETE" });
      toast.success("Model deleted.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex gap-1">
      <Button variant="ghost" size="sm" onClick={toggle} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <Power />}
        {model.is_enabled ? "Disable" : "Enable"}
      </Button>
      <Button variant="ghost" size="sm" onClick={remove} disabled={busy} className="text-destructive">
        <Trash2 />
      </Button>
    </div>
  );
}

export function CapabilityBadges({ model }: { model: AiModelRecord }) {
  return (
    <div className="flex flex-wrap gap-1">
      <Badge variant={model.capabilities.chat ? "success" : "secondary"}>chat</Badge>
      <Badge variant={model.capabilities.streaming ? "info" : "outline"}>
        {model.capabilities.streaming ? "streaming" : "no streaming"}
      </Badge>
      <Badge variant="outline">{model.capabilities.tools ? "tools" : "no tools"}</Badge>
      <Badge variant={model.capabilities.usage ? "secondary" : "outline"}>
        {model.capabilities.usage ? "usage" : "no usage"}
      </Badge>
    </div>
  );
}
