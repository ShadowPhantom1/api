import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { DashboardNav, MobileNav } from "@/components/dashboard/nav";
import { SignOutButton } from "@/components/dashboard/sign-out-button";
import { Badge } from "@/components/ui/badge";
import { getProfile, requireUser } from "@/lib/dashboard/data";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  let context: Awaited<ReturnType<typeof requireUser>>;
  try {
    context = await requireUser();
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect("/login");
  }
  const { admin, user, isAdmin } = context;
  const profile = await getProfile(admin, user.id);
  const name = profile?.display_name || user.email?.split("@")[0] || "Account";

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="hidden border-r border-border/70 bg-card/40 lg:flex lg:flex-col">
        <div className="flex h-16 items-center gap-2 border-b border-border/70 px-5">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
              A
            </span>
            <span className="text-lg font-semibold tracking-tight">Anvex</span>
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <DashboardNav isAdmin={isAdmin} />
        </div>
        <div className="space-y-2 border-t border-border/70 p-3">
          <div className="rounded-md bg-secondary/40 px-3 py-2">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="truncate text-[11px] text-muted-foreground">{user.email}</p>
            <div className="mt-1.5 flex items-center gap-1.5">
              <Badge variant={isAdmin ? "default" : "secondary"} className="text-[10px]">
                {isAdmin ? "Administrator" : "Member"}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                <ShieldCheck className="h-3 w-3" /> session
              </Badge>
            </div>
          </div>
          <SignOutButton />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex h-16 items-center justify-between gap-3 border-b border-border/70 bg-background/70 px-4 backdrop-blur lg:px-8">
          <div className="flex items-center gap-2 lg:hidden">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
              A
            </span>
            <span className="font-semibold">Anvex</span>
          </div>
          <div className="hidden items-center gap-2 text-xs text-muted-foreground lg:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            Registry connected · database is the source of truth
          </div>
          <div className="flex items-center gap-2">
            <Link href="/dashboard/keys" className="text-xs text-muted-foreground hover:text-foreground">
              API keys
            </Link>
            <Link href="/dashboard/add" className="text-xs text-primary hover:underline">
              + Add API
            </Link>
          </div>
        </header>
        <MobileNav />
        <main className="min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
