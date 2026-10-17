import Link from "next/link";
import {
  ArrowRight,
  Braces,
  CheckCircle2,
  Compass,
  Database,
  Layers,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import { VerificationBadge } from "@/components/ui/status-badge";
import { getSessionUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminBackendConfigured } from "@/lib/env";
import { cn, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface LandingStats {
  publicEndpoints: number;
  verifiedEndpoints: number;
  categories: number;
  models: number;
  providerCount: number;
  verifiedSample: Array<{
    slug: string;
    name: string;
    method: string;
    path: string;
    verification_status: string;
    last_tested_at: string | null;
    provider: { name: string } | null;
    category: { name: string } | null;
  }>;
}

async function loadLanding(): Promise<{ stats: LandingStats | null; user: boolean }> {
  const user = await getSessionUser();
  if (!isAdminBackendConfigured()) {
    return { stats: null, user: Boolean(user) };
  }
  const admin = createAdminClient();
  const [stats, models, providers, sample] = await Promise.all([
    admin.from("catalog_stats").select("*").maybeSingle(),
    admin.from("ai_models").select("id", { count: "exact", head: true }).eq("is_public", true),
    admin.from("providers").select("id", { count: "exact", head: true }),
    admin
      .from("apis")
      .select(
        "slug, name, method, path, verification_status, last_tested_at, provider:providers(name), category:categories(name)",
      )
      .eq("is_public", true)
      .eq("is_enabled", true)
      .eq("is_nsfw", false)
      .eq("verification_status", "verified")
      .order("last_tested_at", { ascending: false, nullsFirst: false })
      .limit(6),
  ]);

  return {
    user: Boolean(user),
    stats: {
      publicEndpoints: Number(stats.data?.public_endpoints ?? 0),
      verifiedEndpoints: Number(stats.data?.verified_endpoints ?? 0),
      categories: Number(stats.data?.categories ?? 0),
      models: models.count ?? 0,
      providerCount: providers.count ?? 0,
      verifiedSample: (sample.data ?? []) as unknown as LandingStats["verifiedSample"],
    },
  };
}

export default async function LandingPage() {
  const { stats, user } = await loadLanding();
  const example = `curl -s -X POST "$APP_URL/api/gateway/execute" \\
  -H "Authorization: Bearer $ANVEX_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"apiSlug":"claude-haiku","query":{"q":"hello"}}'`;

  const chat = `curl -s -X POST "$APP_URL/v1/chat/completions" \\
  -H "Authorization: Bearer $ANVEX_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"rebix-claude-haiku","messages":[{"role":"user","content":"hello"}]}'`;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
              A
            </span>
            <span className="text-lg font-semibold tracking-tight">Anvex</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#how" className="hover:text-foreground">How it works</a>
            <a href="#catalog" className="hover:text-foreground">Catalog</a>
            <a href="#gateway" className="hover:text-foreground">Gateways</a>
          </nav>
          <div className="flex items-center gap-2">
            {user ? (
              <Link href="/dashboard" className={cn(buttonVariants({ size: "sm" }))}>
                Open dashboard <ArrowRight />
              </Link>
            ) : (
              <>
                <Link href="/login" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
                  Sign in
                </Link>
                <Link href="/signup" className={cn(buttonVariants({ size: "sm" }))}>
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-border/70">
        <div className="pointer-events-none absolute inset-0 grid-lines opacity-40" />
        <div className="container relative grid gap-12 py-20 lg:grid-cols-[1.1fr_0.9fr] lg:py-28">
          <div className="space-y-7">
            <Badge variant="outline" className="gap-2 border-primary/40 bg-primary/10 text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              Live discovery · database-driven registry
            </Badge>
            <h1 className="max-w-2xl text-balance text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
              One registry for every API.
              <span className="block bg-gradient-to-r from-primary via-fuchsia-400 to-accent bg-clip-text text-transparent">
                Real requests, honest status.
              </span>
            </h1>
            <p className="max-w-xl text-lg text-muted-foreground">
              Anvex imports endpoints from public catalogs and OpenAPI documents, tests them for real,
              stores the configuration in Postgres, and executes it through an SSRF-hardened gateway.
              Adding an API is a form — not a deploy.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href={user ? "/dashboard" : "/signup"} className={cn(buttonVariants({ size: "lg" }))}>
                {user ? "Open dashboard" : "Create workspace"} <ArrowRight />
              </Link>
              <Link href="/dashboard/explore" className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
                Browse the catalog
              </Link>
            </div>
            <dl className="grid max-w-lg grid-cols-2 gap-4 pt-4 sm:grid-cols-4">
              {[
                ["Public endpoints", stats?.publicEndpoints],
                ["Verified live", stats?.verifiedEndpoints],
                ["Categories", stats?.categories],
                ["AI shims", stats?.models],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-lg border border-border/70 bg-card/50 p-3">
                  <dd className="text-xl font-semibold">{value ?? "—"}</dd>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
                </div>
              ))}
            </dl>
          </div>

          <Card className="self-start border-border/80 bg-card/70">
            <CardHeader className="gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="h-2 w-2 rounded-full bg-success" /> Registry snapshot
                </div>
                <Badge variant="secondary">{stats ? `${stats.providerCount} providers` : "setup pending"}</Badge>
              </div>
              <CardDescription>
                Every number on this page comes from the Supabase registry. No demo counters.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {stats?.verifiedSample.length ? (
                stats.verifiedSample.map((api) => (
                  <div key={api.slug} className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background/40 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{api.name}</p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {api.method} {api.path}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <VerificationBadge status={api.verification_status} />
                      <span className="text-[10px] text-muted-foreground">
                        {api.last_tested_at ? formatDate(api.last_tested_at) : "not tested"}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="rounded-md border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
                  {stats
                    ? "No verified public endpoint yet. Verification requires a real successful request."
                    : "Connect Supabase to load the live catalog."}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      <section id="how" className="border-b border-border/70 py-16">
        <div className="container grid gap-6 md:grid-cols-3">
          {[
            {
              icon: Compass,
              title: "Discover",
              body: "Crawl manifests, homepage tables and OpenAPI documents. Every attempt, source URL and timestamp is recorded; nothing is invented.",
            },
            {
              icon: Database,
              title: "Register",
              body: "Endpoints live in Postgres with typed parameters, auth config, schemas and verification state. RLS keeps private APIs private.",
            },
            {
              icon: ShieldCheck,
              title: "Execute",
              body: "Server-side credentials, DNS/redirect validation, size and timeout limits, rate limits and metadata-only telemetry.",
            },
          ].map(({ icon: Icon, title, body }) => (
            <Card key={title}>
              <CardHeader>
                <div className="mb-2 grid h-9 w-9 place-items-center rounded-md bg-primary/15 text-primary">
                  <Icon className="h-4.5 w-4.5" />
                </div>
                <CardTitle>{title}</CardTitle>
                <CardDescription>{body}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <section id="gateway" className="border-b border-border/70 py-16">
        <div className="container grid gap-10 lg:grid-cols-2">
          <div className="space-y-4">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Two gateways</p>
            <h2 className="text-3xl font-semibold tracking-tight">Generic REST today. OpenAI-compatible where the protocol truly matches.</h2>
            <p className="text-sm text-muted-foreground">
              The REST executor works with any registered endpoint. The <code className="font-mono text-foreground">/v1</code> gateway only
              advertises streaming, tools and usage when the linked endpoint genuinely supports them. Rebix routes are wrapped with a
              documented text adapter — never presented as an OpenAI upstream.
            </p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {[
                "Platform keys: anx_live_…, shown once, digest stored, scoped + rate limited",
                "AES-256-GCM encryption for upstream credentials",
                "Cross-user private APIs return 404, not metadata",
                "SSRF: allowlisted hosts, private-IP blocking, redirect revalidation",
              ].map((item) => (
                <li key={item} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /> {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-4">
            <CodeBlock language="curl · REST" code={example} />
            <CodeBlock language="curl · OpenAI-compatible" code={chat} maxHeight="16rem" />
          </div>
        </div>
      </section>

      <section id="catalog" className="py-16">
        <div className="container">
          <h2 className="text-2xl font-semibold tracking-tight">Honest by construction</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {[
              { icon: Braces, title: "No invented schemas", body: "Parameters come from provider manifests or OpenAPI. AI suggestions are labelled and cannot set the verified flag." },
              { icon: Layers, title: "No dead catalogs", body: "Disable an endpoint, rotate a credential or point at a new base URL without shipping code." },
              { icon: ShieldCheck, title: "No secret leakage", body: "Service-role keys never reach the browser; upstream credentials are encrypted and never logged." },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-lg border border-border/70 bg-card/50 p-5">
                <Icon className="mb-3 h-5 w-5 text-primary" />
                <h3 className="text-sm font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border/70 py-8">
        <div className="container flex flex-col items-center justify-between gap-3 text-xs text-muted-foreground sm:flex-row">
          <p>Anvex · Next.js + Supabase + Vercel</p>
          <div className="flex gap-4">
            <Link href="/dashboard" className="hover:text-foreground">Dashboard</Link>
            <Link href="/login" className="hover:text-foreground">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
