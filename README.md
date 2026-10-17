# Anvex — a database-driven API aggregator

Anvex turns discovered, imported or manually registered HTTP APIs into a
single, typed gateway. The registry lives in Supabase; the executor reads it at
request time, so **adding an API is a form or a spec import, never a code
change**.

- **Discovery** — a rerunnable engine inspects a provider's public homepage, JS
  bundle, route manifest and OpenAPI probes, records the source URL and
  timestamp for every endpoint, and reconciles the catalog without clobbering
  manual edits or verification results.
- **Registry** — providers, categories, endpoints (path, method, query/path
  params, headers, body schema, auth, content type, examples, docs, visibility,
  timeouts), AI model aliases, platform keys, discovery runs and a request
  ledger, all in Postgres with RLS.
- **REST gateway** — `POST /api/gateway/execute` authenticates, loads config
  from the database, validates per-endpoint input, injects decrypted
  credentials server-side, enforces SSRF/DNS/port/redirect/size/time limits, and
  returns the real upstream status, headers, body and duration.
- **OpenAI-compatible façade** — `GET /v1/models` and
  `POST /v1/chat/completions` over adapters that only advertise capabilities
  they actually implement.
- **Dashboard** — overview, explore, categories, API detail/docs, add, import,
  my APIs, playground, models, keys, usage, history and settings, all querying
  live data.

## Quick start

```bash
npm install
cp .env.example .env.local        # fill in Supabase + crypto values
# apply supabase/migrations/*.sql in order, then:
npm run seed                      # or: npm run seed:sql → paste into SQL editor
npm run dev
```

First signup becomes the administrator. Full instructions, including Vercel
deployment, are in **[SETUP.md](./SETUP.md)**. Actual test results and the
operator checklist are in **[ACCEPTANCE.md](./ACCEPTANCE.md)**.

## Layout

```
src/app/api/            route handlers (gateway, registry, keys, discovery, telemetry, import)
src/app/v1/             OpenAI-compatible endpoints
src/app/dashboard/      dashboard pages
src/components/         UI primitives + dashboard features
src/lib/http/           SSRF-safe fetch (validation, DNS re-check, redirects, limits)
src/lib/executor/       registry executor, error mapping, upstream request
src/lib/registry/       params/auth/body validation, persistence, examples, schemas
src/lib/security/       AES-GCM crypto, key digests, redaction, rate limits
src/lib/discovery/      manifest/OpenAPI parsers, importer, orchestration
supabase/migrations/    schema, RLS/grants, rate limits, usage ledger
supabase/seed/          generated SQL seed for the reference catalog
scripts/                seeding, SQL export, live acceptance runner
tests/                  vitest suites
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | unit + integration tests (vitest) |
| `npm run seed` | idempotent DB seed via the service-role key |
| `npm run seed:sql` | generate `supabase/seed/rebix_seed.sql` |
| `npm run acceptance` | live end-to-end acceptance suite (needs internet) |

## Security highlights

- Strict SSRF defence: scheme/port/allowlist checks, private+reserved IP
  rejection (IPv4 and IPv6), connect-time DNS revalidation, manual redirects
  with re-validation, response size and time ceilings.
- Upstream credentials encrypted with AES-256-GCM; the ciphertext column is
  granted to `service_role` only.
- Platform keys are CSPRNG secrets stored as HMAC-SHA256 digests, shown once,
  scoped per key, rate limited in Postgres, revocable/rotatable.
- Platform keys cannot manage the workspace; only gateway routes accept them.
- Telemetry records method, status, duration and size — never payloads.
