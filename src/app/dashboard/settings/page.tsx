import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/code-block";
import { PageHeader } from "@/components/ui/page-header";
import { ProfileForm } from "@/components/dashboard/profile-form";
import { getProfile, requireUser } from "@/lib/dashboard/data";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { admin, user, isAdmin } = await requireUser();
  const profile = await getProfile(admin, user.id);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Account"
        title="Settings"
        description="Profile and deployment policy. Secret material is never rendered here."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
              <CardDescription>Your display name is shown in the sidebar and admin views.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ProfileForm initialName={profile?.display_name ?? ""} />
              <dl className="grid gap-3 text-xs sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Email</dt>
                  <dd className="font-mono">{profile?.email ?? user.email}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Role</dt>
                  <dd>{isAdmin ? "Administrator" : "Member"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Member since</dt>
                  <dd>{formatDate(profile?.created_at ?? user.created_at)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">User id</dt>
                  <dd className="flex items-center gap-2 font-mono">
                    <span className="break-all">{user.id}</span>
                    <CopyButton value={user.id} label="Copy" />
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Gateway policy</CardTitle>
              <CardDescription>
                Deployment-level limits enforced by the executor. These come from environment variables, not the
                database.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <Row label="Allowed upstream hosts">
                {env.allowedHosts.length ? env.allowedHosts.join(", ") : "unrestricted (not recommended)"}
              </Row>
              <Row label="Allowed ports">{env.allowedPorts.join(", ")}</Row>
              <Row label="Host allowlist enforcement">{env.enforceHostAllowlist ? "enabled" : "disabled"}</Row>
              <Row label="Max response size">{env.maxResponseBytes.toLocaleString()} bytes</Row>
              <Row label="Default request timeout">{env.requestTimeoutMs.toLocaleString()} ms</Row>
              <Row label="Telemetry">metadata only (no bodies, query values or headers)</Row>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Discovery</CardTitle>
              <CardDescription>
                Imports record the source URL, timestamp, adapter and every attempted probe.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 text-xs">
              <Link href="/dashboard/import" className="rounded-md border border-border px-3 py-2 hover:bg-secondary/60">
                Import / discover APIs
              </Link>
              <Link href="/dashboard/keys" className="rounded-md border border-border px-3 py-2 hover:bg-secondary/60">
                Manage platform keys
              </Link>
              <Link href="/dashboard/usage" className="rounded-md border border-border px-3 py-2 hover:bg-secondary/60">
                Usage analytics
              </Link>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <ShieldCheck className="h-4 w-4 text-success" /> Security posture
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <p>· Service-role credentials are server-only; the browser bundle never receives them.</p>
              <p>· Platform key digests use HMAC-SHA256 with a deployment pepper.</p>
              <p>· Upstream credentials use AES-256-GCM with a random IV per record.</p>
              <p>· SSRF checks resolve DNS, reject private ranges, revalidate redirects and cap body size.</p>
              <p>· Internal platform auth headers are never forwarded upstream.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <KeyRound className="h-4 w-4 text-primary" /> Roles
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <p>
                <Badge variant="default" className="mr-1">Administrator</Badge>
                Can run discovery, view all APIs and manage any endpoint.
              </p>
              <p>
                <Badge variant="secondary" className="mr-1">Member</Badge>
                Can create private APIs, keys, and their own AI model aliases. Public catalog entries remain
                read-only.
              </p>
              <p className="pt-1">
                The first account created on a fresh deployment becomes the administrator via a database trigger.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Project</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs text-muted-foreground">
              <p>Anvex — database-driven API aggregator</p>
              <p>Next.js App Router · Supabase Postgres/Auth · Vercel</p>
              <p>Deployment URL: <span className="font-mono">{env.appUrl}</span></p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{children}</span>
    </div>
  );
}
