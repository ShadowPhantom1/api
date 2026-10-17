"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Boxes,
  Compass,
  Grid2x2,
  History,
  KeyRound,
  LayoutDashboard,
  PlusCircle,
  Settings,
  Sparkles,
  SquareTerminal,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";

const groups = [
  {
    label: "Discover",
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
      { href: "/dashboard/explore", label: "Explore", icon: Compass },
      { href: "/dashboard/categories", label: "Categories", icon: Grid2x2 },
      { href: "/dashboard/add", label: "Add API", icon: PlusCircle },
      { href: "/dashboard/import", label: "Import APIs", icon: Upload },
    ],
  },
  {
    label: "Workspace",
    items: [
      { href: "/dashboard/my-apis", label: "My APIs", icon: Boxes },
      { href: "/dashboard/playground", label: "Test playground", icon: SquareTerminal },
    ],
  },
  {
    label: "Gateway",
    items: [
      { href: "/dashboard/models", label: "AI models", icon: Sparkles },
      { href: "/dashboard/keys", label: "API keys", icon: KeyRound },
      { href: "/dashboard/usage", label: "Usage analytics", icon: BarChart3 },
      { href: "/dashboard/history", label: "Request history", icon: History },
    ],
  },
  {
    label: "Account",
    items: [{ href: "/dashboard/settings", label: "Settings", icon: Settings }],
  },
];

export function DashboardNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  return (
    <nav className="space-y-6">
      {groups.map((group) => (
        <div key={group.label} className="space-y-1">
          <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
            {group.label}
          </p>
          {group.items.map(({ href, label, icon: Icon }) => {
            const active = href === "/dashboard" ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-primary/15 font-medium text-primary"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
                {label === "Import APIs" && isAdmin ? (
                  <span className="ml-auto rounded bg-secondary px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                    admin
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const items = groups.flatMap((group) => group.items);
  return (
    <div className="scrollbar-thin flex gap-1 overflow-x-auto border-b border-border/70 px-3 py-2 lg:hidden">
      {items.map(({ href, label, icon: Icon }) => {
        const active = href === "/dashboard" ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs",
              active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-secondary/60",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Link>
        );
      })}
    </div>
  );
}
