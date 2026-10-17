"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Pencil, Power, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiFetch, errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/utils";

export function ApiManageActions({
  id,
  slug,
  isEnabled,
}: {
  id: string;
  slug: string;
  isEnabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"toggle" | "delete" | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const toggle = async () => {
    setBusy("toggle");
    try {
      await apiFetch(`/api/apis/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isEnabled: !isEnabled }),
      });
      toast.success(isEnabled ? "Endpoint disabled." : "Endpoint enabled.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("delete");
    try {
      await apiFetch(`/api/apis/${id}`, { method: "DELETE" });
      toast.success("Endpoint deleted.");
      setConfirmOpen(false);
      router.push("/dashboard/my-apis");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={`/dashboard/apis/${slug}/edit`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
        <Pencil /> Edit
      </Link>
      <Button variant="outline" size="sm" onClick={toggle} disabled={busy !== null}>
        {busy === "toggle" ? <Loader2 className="animate-spin" /> : <Power />}
        {isEnabled ? "Disable" : "Enable"}
      </Button>
      <Button variant="destructive" size="sm" onClick={() => setConfirmOpen(true)}>
        <Trash2 /> Delete
      </Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this endpoint?</DialogTitle>
            <DialogDescription>
              This removes the registry record and its configuration. Request history keeps metadata but the
              endpoint will no longer be executable. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={remove} disabled={busy === "delete"}>
              {busy === "delete" ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
