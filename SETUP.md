# Anvex — setup and operations

Anvex is a database-driven API aggregator. The catalog (endpoints, parameters,
auth, provider metadata, AI model aliases) lives in Supabase; the gateway
reads it at request time, so **adding an API never requires a code change**.

Two gateways share the same registry:

| Surface | Purpose |
| --- | --- |
| `POST /api/gateway/execute` | Generic REST executor for any registered endpoint |
| `GET /v1/models`, `POST /v1/chat/completions` | OpenAI-compatible façade over adapters that genuinely support it |

---

## 1. Requirements

- Node.js 20.9+
- A Supabase project (Postgres 15+)
- A Vercel account (for deployment)
- A 32-byte encryption key and a random pepper (generated below)

---

## 2. Environment variables

Copy `.env.example` to `.env.local` and fill it in.

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | `https://<ref>.supabase.co`. The server also accepts `SUPABASE_URL`. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Publishable/anon key. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` also accepted. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **Server only.** Never expose to the browser. `SUPABASE_SECRET_KEY` accepted as a server-side alias. |
| `APP_ENCRYPTION_KEY` | yes | `openssl rand -base64 32` — must decode to exactly 32 bytes. Encrypts upstream credentials at rest. |
| `PLATFORM_KEY_PEPPER` | yes | `openssl rand -hex 32`. Peppers the HMAC-SHA256 digest of `anx_live_…` platform keys. |
| `NEXT_PUBLIC_APP_URL` | recommended | Public origin, used in copyable examples. |
| `NEXT_PUBLIC_SITE_NAME` | optional | Defaults to `Anvex`. |
| `GATEWAY_ALLOWED_HOSTS` | recommended | Extra upstream hosts beyond the hosts of registered APIs/providers. |
| `GATEWAY_ALLOWED_PORTS` | optional | Default `80,443`. |
| `GATEWAY_MAX_RESPONSE_BYTES` | optional | Default 2 MiB, clamped to 10 MiB. |
| `GATEWAY_REQUEST_TIMEOUT_MS` | optional | Default 20 s, clamped to 60 s. |
| `GATEWAY_ENFORCE_HOST_ALLOWLIST` | optional | Default `true`. Keep it true in production. |
| `GATEWAY_TEST_ALLOW_PRIVATE` | **never in prod** | Local integration testing only; ignored in production builds. |

Rotating `APP_ENCRYPTION_KEY` makes existing encrypted credentials
unreadable — re-save provider credentials after rotating. Rotating
`PLATFORM_KEY_PEPPER` invalidates every existing platform API key.

---

## 3. Database setup

Apply the migrations in `supabase/migrations/` **in filename order**. Each file
is idempotent and safe to re-run:

1. `20261017164259_anvex_core_schema.sql` — extensions, enums, tables,
   constraints, indexes, views (`api_directory`, `catalog_stats`), triggers.
2. `20261017164308_anvex_rls_security.sql` — RLS policies and column grants.
   `auth_config_encrypted` is granted to nobody except `service_role`.
3. `20261017164408_anvex_rate_limits.sql` — `rate_limit_events` and the
   `consume_rate_limit(subject, limit, window_seconds)` security-definer function.
4. `20261017164522_anvex_usage_tokens.sql` — `api_requests` ledger with
   token columns that are only written when a provider reports usage.

Using the Supabase CLI:

```bash
supabase link --project-ref <ref>
supabase db push
```

Or paste each file into the SQL editor in order.

### Seed the reference catalog

Two equivalent options:

```bash
# Direct DB access (uses the service-role key)
npm run seed

# Offline: generate SQL and paste it into the SQL editor
npm run seed:sql   # writes supabase/seed/rebix_seed.sql
```

Both are idempotent: providers/categories upsert by slug, endpoints insert with
`on conflict (source_key) do nothing`, and model aliases insert with
`on conflict (slug) do nothing`. Re-running never overwrites manual edits or
verification results.

The seed reflects the **live** discovery capture of
`https://api-rebix.zone.id/allEnds` (manifest timestamp `2026-10-17T16:39:11.102Z`,
55 routes) and the verification results obtained by issuing real requests.

---

## 4. Local development

```bash
npm install
cp .env.example .env.local   # fill in values
npm run dev                  # http://localhost:3000
```

First signup becomes the platform administrator (`handle_new_user` trigger).
Open `/dashboard` and use:

- **Explore / Categories** — public catalog with real counts and verification badges.
- **Add API** — manual form (base URL + path, arbitrary query/path params,
  headers, JSON body schema, bearer/api_key/basic/none auth, timeout,
  streaming flag). Use the built-in probe to send a safe test request and
  capture the real status, headers and body before saving.
- **Import** — OpenAPI 3.x / Swagger 2.0 from file, pasted text, or URL; plus a
  manifest/collection JSON import.
- **Discover** — re-runs the discovery engine for a provider (admin only) and
  persists an auditable `discovery_runs` row.
- **Playground** — execute any visible endpoint through the real gateway.
- **Keys** — issue `anx_live_…` keys (shown once), scope permissions, rotate,
  revoke.
- **Models** — register AI model aliases and link them to registry endpoints.
- **Usage / History** — telemetry derived only from real gateway traffic.

---

## 5. Vercel deployment

1. Import the repository into Vercel (Framework preset: **Next.js**).
2. Add the environment variables from section 2 for Production (and Preview).
   `NEXT_PUBLIC_*` values are inlined at build time, so **set them before the
   first build** or redeploy afterwards.
3. Deploy. The project builds with the standard `next build` command; every
   route is dynamic and no local filesystem or in-memory state is used for
   production data.
4. If the deployment is behind **Vercel Authentication** (Hobby accounts
   default to "Standard Protection"), anonymous requests receive a login page.
   Disable it under *Project → Settings → Deployment Protection* if the app must
   be publicly reachable, or attach a custom domain.

Recommended production checklist:

- `GATEWAY_ENFORCE_HOST_ALLOWLIST=true`
- `GATEWAY_TEST_ALLOW_PRIVATE` unset
- Service-role key present only in server env (never `NEXT_PUBLIC_*`)
- Separate Supabase projects for staging and production
- Rotate `PLATFORM_KEY_PEPPER` and `APP_ENCRYPTION_KEY` if they were ever
  shared outside the deployment

---

## 6. Using the gateways

### REST

```bash
curl -s https://<app>/api/gateway/execute \
  -H "Authorization: Bearer $ANVEX_KEY" \
  -H "Content-Type: application/json" \
  -d '{"apiSlug":"cohere","query":{"q":"hello"}}'
```

The response contains the real upstream status, content type, headers,
duration, size and body. Add `?raw=1` (or `X-Anvex-Raw: 1`) to stream the
upstream body through unchanged.

Validation is driven entirely by the registry: undeclared query parameters are
rejected unless the endpoint sets `allowExtraQuery`, path placeholders are
URL-encoded, declared headers only, request bodies capped at 256 KB, and
`Authorization`/`Cookie`/`X-Forwarded-*`/proxy headers can never be supplied by
a client. Credentials are injected server-side from the encrypted config.

### OpenAI-compatible

```bash
curl https://<app>/v1/models -H "Authorization: Bearer $ANVEX_KEY"

curl https://<app>/v1/chat/completions \
  -H "Authorization: Bearer $ANVEX_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"rebix-claude-haiku","messages":[{"role":"user","content":"hello"}]}'
```

Only capabilities an adapter truly implements are advertised:

| Adapter | Chat | Streaming | Tools | Usage |
| --- | --- | --- | --- | --- |
| `openai_compatible` | yes | yes | no | yes (when upstream returns it) |
| `anthropic_messages` | yes | no | no | yes |
| `gemini_generate` | yes | no | no | yes |
| `rebix_text` | yes | no | no | **no** — usage is omitted, never estimated |

Requests with `tools`, `tool_choice` or `response_format` receive a structured
`unsupported_parameter` error; streaming on a non-streaming adapter is refused
with `400` rather than silently downgraded.

---

## 7. Security model

- **SSRF:** every outbound URL is parsed, scheme-restricted to http/https,
  credentials-in-URL rejected, port-restricted, optionally host-allowlisted,
  every resolved address checked against private/reserved ranges (IPv4 + IPv6,
  including mapped addresses), and DNS is re-validated at connect time to
  defeat rebinding. Redirects are followed manually with a hard cap, each hop
  re-validated, and only safe headers are propagated.
- **Response size/time:** `GATEWAY_MAX_RESPONSE_BYTES` and
  `GATEWAY_REQUEST_TIMEOUT_MS` bound every call; bodies are truncated with an
  explicit `X-Anvex-Truncated`/`truncated` flag.
- **Credentials:** upstream tokens are AES-256-GCM encrypted (`v1.<iv>.<tag>.<ct>`)
  before storage, decrypted only inside the executor, never serialized to the
  client and never logged.
- **Platform keys:** CSPRNG (`anx_live_` + 192 bits), only an HMAC-SHA256 digest
  and display prefix are stored, the secret is returned exactly once, and
  revocation/rotation take effect immediately.
- **Authorization:** public APIs require `is_public && is_enabled`; private APIs
  are visible only to their owner and admins. Platform keys are limited to
  gateway routes and cannot mint keys or edit the registry.
- **RLS:** enabled on all user data. Column grants exclude
  `auth_config_encrypted`, so even a direct PostgREST query cannot read
  ciphertext. The service-role key is used only inside server route handlers.
- **Telemetry:** `api_requests` stores method, status, duration, size and
  error codes — never query values, headers or bodies.

---

## 8. Tests

```bash
npm run typecheck      # tsc --noEmit
npm test               # vitest: unit + route-adjacent suites
npm run build          # production build
npm run acceptance     # live end-to-end checks (see below)
```

`npm run acceptance` starts the production server on `127.0.0.1:3100`, creates
two throwaway users (A = admin, B = regular), issues platform keys, and
exercises the real HTTP surface: discovery re-runs, real upstream execution,
parameter validation, SSRF blocking, cross-user isolation, key scopes,
revocation, rate limits, the OpenAI façade, and telemetry. It prints a
pass/fail table and a JSON artifact. It requires network access to Supabase and
to the upstream provider, plus the service-role key in the environment.

---

## 9. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `/api/health` shows `supabaseAdmin: false` | `SUPABASE_SERVICE_ROLE_KEY` missing on the deployment. |
| `credentialEncryption: false` | `APP_ENCRYPTION_KEY` missing or not 32 base64 bytes. |
| `host_not_allowed` | Endpoint host not registered and not in `GATEWAY_ALLOWED_HOSTS`. |
| `auth_not_configured` (424) | API is configured for auth but no credentials were saved. |
| `unknown_parameter` | Send only parameters declared for that endpoint, or enable `allowExtraQuery`. |
| OpenAPI import says no server URL | The document lacks `servers`/`host`; pass a source URL or set the base URL afterwards. |
| Vercel URL shows a login page | Deployment Protection is on; disable it or use a custom domain. |
