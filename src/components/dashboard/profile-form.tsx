"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, errorMessage } from "@/lib/client/api";

export function ProfileForm({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initialName);
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    try {
      await apiFetch("/api/settings/profile", {
        method: "PATCH",
        body: JSON.stringify({ displayName: displayName.trim() }),
      });
      toast.success("Profile updated.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="displayName">Display name</Label>
        <Input
          id="displayName"
          required
          maxLength={80}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Ada Lovelace"
        />
      </div>
      <Button type="submit" size="sm" disabled={saving || !displayName.trim()}>
        {saving ? <Loader2 className="animate-spin" /> : <Save />} Save profile
      </Button>
    </form>
  );
}
