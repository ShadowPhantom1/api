# Acceptance report

Run date: 2026-10-17 (Asia/Kolkata)
Project: `ShadowPhantom1/api` → Anvex
Supabase: `urboeegcbdjzbuhognjt` (ap-south-1)
Vercel: team `shadowphantom1's projects`, project `anvex`

## How to read this report

Two things were true of the environment this was built in:

1. **The build sandbox has no outbound network egress.** `curl`/`fetch` to
   Supabase, Vercel or the provider all fail with `SSL_ERROR_SYSCALL`
   (`exit 35`). Only the agent's page-fetch tool could reach the public
   internet during discovery. Therefore the production server could not be
   started here against the live database, and no live HTTP test was executed
   inside this sandbox.
2. **Vercel Deployment Protection is enabled** on the project
   (`ssoProtection.deploymentType = all_except_custom_domains`), so even the
   production alias redirects anonymous users to a Vercel login page.

Everything below is split accordingly: what *was* executed and observed, what
is covered by automated tests, and what must be run once on a machine with
normal internet access.

---

## 1. Executed here — results

| Check | Result | Evidence |
| --- | --- | --- |
| TypeScript strict compile | **PASS** | `npx tsc --noEmit` — 0 errors |
| Unit/integration test suite | **PASS** | `npm test` — **51 tests in 6 files**, all green |
| Production build | **PASS** | `npm run build` — 22 API routes, 13 dashboard pages, `/login`, `/signup`, `/v1/models`, `/v1/chat/completions`; first-load shared JS 103 kB |
| Vercel build & deploy | **PASS** | Deployment `dpl_DRQwCmDkymMciGPU4AACNUeeNxgc` reached `READY` (state promoted to production) |
| Schema migrations applied | **PASS** | 4 migrations recorded: `anvex_core_schema`, `anvex_rls_security`, `anvex_rate_limits`, `anvex_usage_tokens` |
| Registry is database-driven | **PASS** | Live rows: **55 APIs, 12 categories, 1 provider, 3 AI models, 1 discovery run** |
| Verification is honest | **PASS** | 7 `verified`, 2 `failed`, 46 `unverified` — statuses reflect real requests, not assumptions |
| Discovery provenance stored | **PASS** | Every seeded endpoint carries `source_url = …/allEnds#<path>`, `source_key`, `manifest_timestamp = 2026-10-17T16:39:11.102Z`, `discovered_at`, `manifest_category`, `example_params` |
| Credential ciphertext not readable by clients | **PASS** | 0 column grants on `auth_config_encrypted` for `anon`/`authenticated` |
| RLS enabled on user data | **PASS** | 7 tables with `relrowsecurity = true`; 10 policies present |
| Platform key table locked down | **PASS** | 0 table grants for `anon`/`authenticated` on `platform_api_keys` |
| Rate-limit function not client-callable | **PASS** | `consume_rate_limit` execute privilege restricted to `service_role` |
| `catalog_stats` usable by anon | **PASS** | `set role anon; select … from catalog_stats` returned 1 row (security_invoker view) |

### What the 51 tests cover

| File | Focus |
| --- | --- |
| `tests/security.test.ts` (11) | SSRF IP classification (IPv4 private/reserved, IPv6 loopback/ULA/link-local/mapped), protocol and URL-credential rejection, allowlist and port enforcement, wildcard matching, AES-256-GCM round-trip + tamper detection, platform-key generation/digest, header/object/URL redaction |
| `tests/params.test.ts` (14) | Param coercion, undeclared-param rejection, `allowExtra` opt-in, required/default/enum enforcement, oversized values, path traversal rejection, header allowlisting, forbidden `Authorization`/`Cookie`/`X-Forwarded-*`, auth injection, `424 auth_not_configured`, body validation and size cap |
| `tests/auth.test.ts` (7) | Unknown/revoked/expired platform keys, scope enforcement, rate-limited 429, last-used recording, session fallback, anonymous 401, platform keys barred from workspace management |
| `tests/discovery.test.ts` (9) | 55-endpoint manifest import, dedupe by `sourceKey`, manifest-declared params only (`q`, `text`/`to`, `url`/`device`), NSFW flags, category normalisation, OpenAPI 3 + Swagger 2 parsing (servers, security, refs, bodies), YAML input, unsupported-spec rejection, endpoint hash change detection |
| `tests/ai.test.ts` (3) | Capability honesty per adapter (Rebix never claims streaming/tools/usage), adapter limitation copy |
| `tests/ai-examples.test.ts` (7) | Example builder never invents param values, reports missing required inputs, curl snippets contain no secrets |

### Provider behaviour observed during discovery (real internet)

These requests were issued against `api-rebix.zone.id` while building the
catalog; they are the basis for the stored verification statuses.

| Endpoint | Observed | Stored status |
| --- | --- | --- |
| `/api/cohere?q=` | HTTP 200, JSON `{status, creator, message}` | verified |
| `/api/gemini?q=` | HTTP 200, JSON text field | verified |
| `/api/claude-haiku?q=` | HTTP 200, JSON text field | verified |
| `/api/tinyurl?url=` | HTTP 200, `result` | verified |
| `/api/randomquotes` | HTTP 200 | verified |
| `/api/facts` | HTTP 200, `fact` | verified |
| `/api/stats` | HTTP 200, system stats | verified |
| `/api/deepseek-v3?q=` | HTTP 422 `The selected messages.0.role is invalid` | failed |
| `/api/deepseek-r1?q=` | HTTP 422 same error | failed |
| image endpoints (`/api/waifu`, …) | HTTP 500 at test time | unverified (not marked failed: transient) |

Consequences that are visible in the product:

- DeepSeek aliases exist but the two broken ones are **disabled**; the
  `rebix-deepseek-v3` model record documents the 422 in its description.
- All Rebix aliases use the `rebix_text` adapter and advertise
  `{chat: true, streaming: false, tools: false, usage: false}`. No token usage
  is reported because the provider reports none.
- `/allEnds` lists only `GET` routes, so no other method is claimed for Rebix.

---

## 2. Must be run with network access

The following checks are implemented end-to-end in `scripts/acceptance.mjs`
(`npm run acceptance`). They were **not executed in this sandbox** because it
cannot reach Supabase or the provider. The script provisions throwaway users
and keys, exercises the real HTTP surface, prints a pass/fail table and a JSON
artifact, and cleans up the APIs it created.

```bash
# on a machine with internet access:
cp .env.example .env.local        # fill values
npm install
npm run build
npm run acceptance                # starts next start on :3100 and runs the suite
```

| Criterion | How it is checked |
| --- | --- |
| Discovery works against the live site | `POST /api/discover` on `https://api-rebix.zone.id/`; expects ≥ 50 discovered endpoints |
| Endpoints saved dynamically | Same run; counts `created` and persists `discovery_runs` |
| Re-running detects change | Second identical run must report `created = 0`, `updated = 0`; a manifest diff would surface as `updated` (hash comparison covered by `tests/discovery.test.ts`) |
| Manual add without code change | `POST /api/apis` with an arbitrary parameter named `prompt`, then execution through the gateway |
| DeepSeek `q` param configurable | Registry stores `q` from the manifest; execution example `/api/deepseek-v3?q=` returns the provider's real 422 |
| Arbitrary params via UI/API | The `prompt` endpoint accepts `prompt` and rejects `q` with `unknown_parameter` |
| Real upstream response | `POST /api/gateway/execute` for `cohere` must be `ok: true` with upstream 200 |
| Honest errors | DeepSeek route reports upstream 422, no fake success |
| Cross-user private isolation | User B gets 404 reading user A's private API and 404 executing it; user A succeeds |
| No secret leakage | Stored token must be `v1.` ciphertext in DB, absent from API JSON |
| Key show-once / scope / revoke | Secret returned once; `models`-only key can list models but gets 403 on execute; revoked key gets 401 |
| Rate limits | Key limited to 1 req/min returns 200 then 429 |
| SSRF | `/api/probe` to `169.254.169.254` and `127.0.0.1:22` must return 403 `blocked_destination` / `blocked_port` |
| AI gateway compatibility | `/v1/chat/completions` returns a real message; streaming and tools requests return `400 unsupported_parameter`; `usage` absent when unreported |
| Telemetry is real | `/api/usage` totals equal requests made in the run; history excludes payloads |

Expected final output:

```
RESULT <n> passed, <n> skipped, <n> failed, <n> total
```

`SKIP` is only used for the optional `postman-echo.com` POST-body check when
that third-party service is unavailable.

---

## 3. Known limitations (deliberate)

1. **Rebix is not OpenAI-compatible.** It is a set of GET endpoints that take a
   prompt in a query string and return `{message|response|result|...}`. The
   gateway therefore exposes it through a text adapter: no streaming, no tool
   calling, no embeddings, no token accounting. Requests asking for those
   features are rejected with structured errors instead of being simulated.
2. **Only `GET` is documented upstream.** The executor supports
   GET/POST/PUT/PATCH/DELETE and JSON or form bodies, verified by unit tests and
   by the acceptance suite's `postman-echo` POST case; the Rebix catalog itself
   contains no non-GET route.
3. **Some provider routes are unstable.** `deepseek-v3`/`deepseek-r1` return
   422 upstream, and several image endpoints returned 500 at discovery time.
   They remain `failed`/`unverified` and are not advertised as working.
4. **`/allEnds` is undocumented but public.** No authentication, rate-limit
   circumvention or scraping of private areas was used; discovery only reads the
   homepage, the public JS bundle, the public manifest and probes for an OpenAPI
   document (404).
5. **Vercel Deployment Protection** must be disabled (or a custom domain
   attached) before the hosted app is publicly reachable.
6. **Credential rotation** of `APP_ENCRYPTION_KEY` requires re-saving upstream
   credentials; rotating `PLATFORM_KEY_PEPPER` invalidates issued platform keys.

---

## 4. Deployment verification checklist for the operator

1. `GET /api/health` → `{ status: "ok", checks: { supabasePublic: true,
   supabaseAdmin: true, credentialEncryption: true } }`
2. `GET /api/catalog` (or `/dashboard/explore`) shows 55 endpoints; 7 carry a
   green *Verified* badge, 2 *Failed*, the rest *Unverified*.
3. Sign in → **Keys** → create a key → copy the `anx_live_…` secret (shown once).
4. `curl -H "Authorization: Bearer <key>" https://<app>/v1/models` returns
   `rebix-claude-haiku` and `rebix-gemini` (not the disabled DeepSeek alias).
5. `POST /v1/chat/completions` with `rebix-claude-haiku` returns a real message.
6. **Usage** and **History** populate with the requests you just made.
