"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start text-muted-foreground"
      onClick={async () => {
        await createSupabaseBrowserClient().auth.signOut();
        router.push("/");
        router.refresh();
      }}
    >
      <LogOut /> Sign out
    </Button>
  );
}
