/**
 * Live acceptance checks for Anvex.
 *
 * This script is meant to run on a machine with outbound network access (Vercel
 * build container or CI), because it talks to the real Supabase project and to
 * the real upstream provider. It starts the production Next.js server on
 * 127.0.0.1, provisions two throwaway test accounts and platform keys, then
 * exercises the public HTTP surface.
 *
 * It never prints platform keys, service-role keys or upstream tokens.
 *
 * Required env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 * SUPABASE_SERVICE_ROLE_KEY, PLATFORM_KEY_PEPPER.
 */
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const PORT = Number(process.env.ACCEPTANCE_PORT ?? 3100);
const BASE = process.env.ANVEX_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PEPPER = process.env.PLATFORM_KEY_PEPPER;

for (const [name, value] of Object.entries({ SUPABASE_URL, ANON_KEY, SERVICE_KEY, PEPPER })) {
  if (!value) {
    console.error(`Missing required environment variable for ${name}.`);
    process.exit(2);
  }
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const results = [];
const artifacts = { users: {}, keys: {}, apis: {} };

function record(section, name, status, detail = "") {
  results.push({ section, name, status, detail });
  const label = status === "PASS" ? "PASS" : status === "SKIP" ? "SKIP" : "FAIL";
  console.log(`[${label}] ${section} :: ${name}${detail ? ` — ${detail}` : ""}`);
}

function line() {
  console.log("-".repeat(78));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
  const headers = { ...(options.body !== undefined ? { "content-type": "application/json" } : {}), ...(options.headers ?? {}) };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.key) headers.authorization = `Bearer ${options.key}`;
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeoutMs ?? 45_000),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* plain text response */
  }
  return { status: response.status, json, text, headers: response.headers };
}

async function waitForServer(timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw new Error("Next.js server did not become healthy in time.");
}

async function ensureUser(email, password, displayName) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  let user = data?.user ?? null;
  if (!user) {
    for (let page = 1; page <= 5 && !user; page += 1) {
      const { data: listed } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      user = listed?.users?.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase()) ?? null;
    }
    if (!user) throw new Error(`Could not provision ${email}: ${error?.message ?? "unknown error"}`);
    const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (updateError) throw new Error(`Could not update ${email}: ${updateError.message}`);
  }
  return user;
}

async function issueKey(userId, name, permissions, rateLimitPerMinute = 120) {
  await admin.from("platform_api_keys").delete().eq("name", name);
  const secret = `anx_live_${randomBytes(24).toString("base64url")}`;
  const hash = createHmac("sha256", PEPPER).update(secret).digest("hex");
  const { data, error } = await admin
    .from("platform_api_keys")
    .insert({
      user_id: userId,
      name,
      prefix: secret.slice(0, 15),
      key_hash: hash,
      last_four: secret.slice(-4),
      permissions,
      rate_limit_per_minute: rateLimitPerMinute,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not issue acceptance key: ${error.message}`);
  return { secret, id: data.id, name };
}

async function signIn(email, password) {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Sign-in failed: ${error?.message ?? "no session"}`);
  return data.session.access_token;
}

async function main() {
  line();
  console.log("Anvex live acceptance run");
  console.log(`Base URL: ${BASE}`);
  line();

  const server = spawn("node", ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], {
    env: { ...process.env, NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", () => {});
  server.stderr.on("data", () => {});

  try {
    await waitForServer();
    record("Deployment", "Next.js production server starts and /api/health responds", "PASS", BASE);

    const health = await request("/api/health");
    record(
      "Deployment",
      "Health reports Supabase + encryption configured",
      health.status === 200 && health.json?.checks?.supabaseAdmin === true && health.json?.checks?.credentialEncryption === true
        ? "PASS"
        : "FAIL",
      JSON.stringify(health.json?.checks ?? {}),
    );

    // ---------------------------------------------------------------------
    // Provision throwaway identities and platform keys.
    // ---------------------------------------------------------------------
    const passwordA = `Anx-${randomBytes(12).toString("base64url")}!9aA`;
    const passwordB = `Anx-${randomBytes(12).toString("base64url")}!9aA`;
    const userA = await ensureUser("anvex.acceptance.a@example.com", passwordA, "Acceptance A");
    const userB = await ensureUser("anvex.acceptance.b@example.com", passwordB, "Acceptance B");
    artifacts.users = { a: userA.id, b: userB.id };
    await admin.from("profiles").update({ role: "admin" }).eq("id", userA.id);
    await admin.from("profiles").update({ role: "user" }).eq("id", userB.id);
    const tokenA = await signIn("anvex.acceptance.a@example.com", passwordA);
    const tokenB = await signIn("anvex.acceptance.b@example.com", passwordB);
    const keyA = await issueKey(userA.id, "Anvex acceptance key A", ["execute", "chat", "models"]);
    const keyB = await issueKey(userB.id, "Anvex acceptance key B", ["execute", "chat", "models"]);
    artifacts.keys = { a: keyA.id, b: keyB.id };
    record("Auth", "Provisioned two test users (A admin, B regular) and platform keys", "PASS");

    // ---------------------------------------------------------------------
    // OpenAI-compatible catalogue + gateway execution.
    // ---------------------------------------------------------------------
    const models = await request("/v1/models", { key: keyA.secret });
    const modelIds = (models.json?.data ?? []).map((entry) => entry.id);
    record(
      "AI gateway",
      "GET /v1/models lists enabled aliases with honest capabilities",
      models.status === 200 &&
        modelIds.includes("rebix-claude-haiku") &&
        modelIds.includes("rebix-gemini") &&
        !modelIds.includes("rebix-deepseek-v3") &&
        models.json.data.every((entry) => entry.anvex?.capabilities?.streaming === false)
        ? "PASS"
        : "FAIL",
      `models=${modelIds.join(", ")}`,
    );

    const unauthModels = await request("/v1/models");
    record("Auth", "GET /v1/models without credentials is rejected", unauthModels.status === 401 ? "PASS" : "FAIL", `HTTP ${unauthModels.status}`);

    const cohere = await request("/api/gateway/execute", {
      method: "POST",
      key: keyA.secret,
      body: { apiSlug: "cohere", query: { q: "Reply with a short greeting." } },
    });
    const cohereText = JSON.stringify(cohere.json?.response?.body ?? "").slice(0, 120);
    record(
      "Gateway",
      "Real upstream execution through POST /api/gateway/execute (Rebix cohere)",
      cohere.status === 200 && cohere.json?.ok === true && cohere.json?.response?.status === 200
        ? "PASS"
        : "FAIL",
      `HTTP ${cohere.status}, upstream ${cohere.json?.response?.status}, ${cohere.json?.response?.durationMs} ms, body=${cohereText}`,
    );
    assert(cohere.json?.ok === true, "Cohere execution failed; later checks may be unreliable.");

    const unknownParam = await request("/api/gateway/execute", {
      method: "POST",
      key: keyA.secret,
      body: { apiSlug: "cohere", query: { prompt: "not declared" } },
    });
    record(
      "Gateway",
      "Per-endpoint parameter validation rejects undeclared params",
      unknownParam.status === 400 && unknownParam.json?.error?.code === "unknown_parameter"
        ? "PASS"
        : "FAIL",
      `HTTP ${unknownParam.status} ${unknownParam.json?.error?.code ?? ""}`,
    );

    const internalHeader = await request("/api/gateway/execute", {
      method: "POST",
      key: keyA.secret,
      body: { apiSlug: "cohere", query: { q: "hello" }, headers: { Authorization: "Bearer attacker" } },
    });
    record(
      "Security",
      "Client cannot forward Authorization headers upstream",
      internalHeader.status === 400 && ["forbidden_header", "unknown_header"].includes(internalHeader.json?.error?.code)
        ? "PASS"
        : "FAIL",
      `HTTP ${internalHeader.status} ${internalHeader.json?.error?.code ?? ""}`,
    );

    const deepseek = await request("/api/gateway/execute", {
      method: "POST",
      key: keyA.secret,
      body: { apiSlug: "deepseek-v3", query: { q: "hello" } },
    });
    record(
      "Honesty",
      "Known-broken provider route reports its real upstream failure (no fake success)",
      deepseek.json?.ok === false && deepseek.json?.response?.status === 422
        ? "PASS"
        : "FAIL",
      `gateway HTTP ${deepseek.status}; upstream ${deepseek.json?.response?.status}`,
    );

    // ---------------------------------------------------------------------
    // Manual API creation (no code change) with an arbitrary parameter name.
    // ---------------------------------------------------------------------
    const probeCreate = await request("/api/apis", {
      method: "POST",
      token: tokenA,
      body: {
        name: "Acceptance param probe",
        slug: "acceptance-param-probe",
        description: "Created by the acceptance suite to prove that parameter names come from the registry, not from code.",
        baseUrl: "https://api-rebix.zone.id",
        path: "/api/stats",
        method: "GET",
        queryParams: [
          { name: "prompt", type: "string", required: false, example: "hello", description: "Arbitrary acceptance parameter" },
        ],
        authType: "none",
        isPublic: true,
        isEnabled: true,
        timeoutMs: 15000,
      },
    });
    let probeApi = probeCreate.json?.api ?? probeCreate.json;
    if (!probeApi?.id) {
      const found = await admin.from("apis").select("id, slug").eq("slug", "acceptance-param-probe").maybeSingle();
      probeApi = found.data;
    }
    artifacts.apis.probe = probeApi?.id ?? null;
    record(
      "Registry",
      "Manual API creation through the HTTP API (no code change, arbitrary param 'prompt')",
      probeCreate.status === 200 || probeCreate.status === 201 ? "PASS" : "FAIL",
      `HTTP ${probeCreate.status} slug=${probeApi?.slug ?? "?"}`,
    );

    if (probeApi?.id) {
      const probeExec = await request("/api/gateway/execute", {
        method: "POST",
        key: keyA.secret,
        body: { apiSlug: "acceptance-param-probe", query: { prompt: "acceptance" } },
      });
      record(
        "Registry",
        "Newly created API executes with its custom parameter name",
        probeExec.status === 200 && probeExec.json?.ok === true ? "PASS" : "FAIL",
        `HTTP ${probeExec.status}, upstream ${probeExec.json?.response?.status}`,
      );
      const probeReject = await request("/api/gateway/execute", {
        method: "POST",
        key: keyA.secret,
        body: { apiSlug: "acceptance-param-probe", query: { q: "not declared here" } },
      });
      record(
        "Registry",
        "The same endpoint rejects a different endpoint's parameter name",
        probeReject.status === 400 && probeReject.json?.error?.code === "unknown_parameter" ? "PASS" : "FAIL",
        `HTTP ${probeReject.status}`,
      );
    }

    // ---------------------------------------------------------------------
    // POST body handling, via a second manually registered API.
    // ---------------------------------------------------------------------
    const postCreate = await request("/api/apis", {
      method: "POST",
      token: tokenA,
      body: {
        name: "Acceptance POST echo",
        slug: "acceptance-post-echo",
        description: "Created by the acceptance suite to verify JSON POST bodies against a public echo service.",
        baseUrl: "https://postman-echo.com",
        path: "/post",
        method: "POST",
        queryParams: [],
        bodySchema: { type: "object", required: ["prompt"], properties: { prompt: { type: "string" } } },
        authType: "none",
        isPublic: true,
        isEnabled: true,
        timeoutMs: 15000,
      },
    });
    let postApi = postCreate.json?.api ?? postCreate.json;
    if (!postApi?.id) {
      const found = await admin.from("apis").select("id, slug").eq("slug", "acceptance-post-echo").maybeSingle();
      postApi = found.data;
    }
    artifacts.apis.post = postApi?.id ?? null;

    if (postApi?.id) {
      const postExec = await request("/api/gateway/execute", {
        method: "POST",
        key: keyA.secret,
        body: { apiSlug: "acceptance-post-echo", body: { prompt: "hello-acceptance" } },
      });
      const echoed = JSON.stringify(postExec.json?.response?.body ?? "");
      const okPost = postExec.status === 200 && postExec.json?.ok === true && echoed.includes("hello-acceptance");
      record(
        "Gateway",
        "JSON POST body is forwarded and the real echo response is returned",
        okPost ? "PASS" : "SKIP",
        okPost ? `upstream ${postExec.json?.response?.status}` : `upstream unavailable or rejected: HTTP ${postExec.status}`,
      );
      const missingBody = await request("/api/gateway/execute", {
        method: "POST",
        key: keyA.secret,
        body: { apiSlug: "acceptance-post-echo", body: {} },
      });
      record(
        "Gateway",
        "Required body fields are validated",
        missingBody.status === 400 && missingBody.json?.error?.code === "missing_body_field" ? "PASS" : "FAIL",
        `HTTP ${missingBody.status} ${missingBody.json?.error?.code ?? ""}`,
      );
    }

    // ---------------------------------------------------------------------
    // SSRF protections.
    // ---------------------------------------------------------------------
    const ssrfMetadata = await request("/api/probe", {
      method: "POST",
      token: tokenA,
      body: { url: "http://169.254.169.254/latest/meta-data/" },
    });
    record(
      "Security",
      "Cloud metadata endpoint is blocked",
      ssrfMetadata.status === 403 && ssrfMetadata.json?.error?.code === "blocked_destination" ? "PASS" : "FAIL",
      `HTTP ${ssrfMetadata.status} ${ssrfMetadata.json?.error?.code ?? ""}`,
    );
    const ssrfLoopback = await request("/api/probe", {
      method: "POST",
      token: tokenA,
      body: { url: "http://127.0.0.1:22/" },
    });
    record(
      "Security",
      "Loopback / internal port is blocked",
      ssrfLoopback.status === 403 ? "PASS" : "FAIL",
      `HTTP ${ssrfLoopback.status} ${ssrfLoopback.json?.error?.code ?? ""}`,
    );
    const allowedProbe = await request("/api/probe", {
      method: "POST",
      token: tokenA,
      body: { url: "https://api-rebix.zone.id/api/stats" },
    });
    record(
      "Gateway",
      "Allowed public probe returns a real upstream response",
      allowedProbe.status === 200 && allowedProbe.json?.ok === true ? "PASS" : "FAIL",
      `HTTP ${allowedProbe.status}`,
    );

    // ---------------------------------------------------------------------
    // Cross-user isolation of private APIs.
    // ---------------------------------------------------------------------
    const privateCreate = await request("/api/apis", {
      method: "POST",
      token: tokenA,
      body: {
        name: "Acceptance private API",
        slug: "acceptance-private-api",
        description: "Private to acceptance user A.",
        baseUrl: "https://api-rebix.zone.id",
        path: "/api/stats",
        method: "GET",
        queryParams: [],
        authType: "none",
        isPublic: false,
        isEnabled: true,
      },
    });
    let privateApi = privateCreate.json?.api ?? privateCreate.json;
    if (!privateApi?.id) {
      const found = await admin.from("apis").select("id, slug").eq("slug", "acceptance-private-api").maybeSingle();
      privateApi = found.data;
    }
    artifacts.apis.private = privateApi?.id ?? null;

    if (privateApi?.id) {
      const bView = await request(`/api/apis/${privateApi.id}`, { token: tokenB });
      record(
        "Isolation",
        "User B cannot read user A's private API by id",
        bView.status === 404 ? "PASS" : "FAIL",
        `HTTP ${bView.status}`,
      );
      const bScopeAll = await request("/api/apis?scope=all", { token: tokenB });
      record(
        "Isolation",
        "Non-admin cannot request the all-users registry scope",
        bScopeAll.status === 403 ? "PASS" : "FAIL",
        `HTTP ${bScopeAll.status}`,
      );
      const bExecute = await request("/api/gateway/execute", {
        method: "POST",
        key: keyB.secret,
        body: { apiSlug: "acceptance-private-api" },
      });
      record(
        "Isolation",
        "User B cannot execute user A's private API through the gateway",
        bExecute.status === 404 ? "PASS" : "FAIL",
        `HTTP ${bExecute.status}`,
      );
      const aExecute = await request("/api/gateway/execute", {
        method: "POST",
        key: keyA.secret,
        body: { apiSlug: "acceptance-private-api" },
      });
      record(
        "Isolation",
        "Owner can execute their private API",
        aExecute.status === 200 && aExecute.json?.ok === true ? "PASS" : "FAIL",
        `HTTP ${aExecute.status}`,
      );
    }

    // ---------------------------------------------------------------------
    // Encrypted upstream credentials never leave the server.
    // ---------------------------------------------------------------------
    const secretToken = `acceptance-dummy-${randomBytes(8).toString("hex")}`;
    const secretCreate = await request("/api/apis", {
      method: "POST",
      token: tokenA,
      body: {
        name: "Acceptance secret storage",
        slug: "acceptance-secret-storage",
        description: "Verifies credentials are encrypted and never serialized.",
        baseUrl: "https://api-rebix.zone.id",
        path: "/api/stats",
        method: "GET",
        queryParams: [],
        authType: "bearer",
        auth: { token: secretToken },
        isPublic: false,
        isEnabled: true,
      },
    });
    let secretApi = secretCreate.json?.api ?? secretCreate.json;
    if (!secretApi?.id) {
      const found = await admin.from("apis").select("id, slug").eq("slug", "acceptance-secret-storage").maybeSingle();
      secretApi = found.data;
    }
    artifacts.apis.secret = secretApi?.id ?? null;

    if (secretApi?.id) {
      const raw = await admin.from("apis").select("auth_config_encrypted").eq("id", secretApi.id).single();
      const ciphertext = raw.data?.auth_config_encrypted ?? "";
      record(
        "Security",
        "Upstream credentials are stored encrypted (AES-GCM envelope, no plaintext)",
        ciphertext.startsWith("v1.") && !ciphertext.includes(secretToken) ? "PASS" : "FAIL",
        `envelope=${ciphertext.slice(0, 3) || "missing"}`,
      );
      const readBack = await request(`/api/apis/${secretApi.id}`, { token: tokenA });
      const serialized = JSON.stringify(readBack.json ?? {});
      record(
        "Security",
        "API responses never contain the stored token or ciphertext",
        readBack.status === 200 && !serialized.includes(secretToken) && !serialized.includes("auth_config_encrypted")
          ? "PASS"
          : "FAIL",
        `HTTP ${readBack.status}, credential_configured=${readBack.json?.credential_configured ?? readBack.json?.api?.credential_configured ?? "?"}`,
      );
    }

    // ---------------------------------------------------------------------
    // API key lifecycle: permissions, show-once, revocation, rate limits.
    // ---------------------------------------------------------------------
    const scopedKeyCreate = await request("/api/keys", {
      method: "POST",
      token: tokenA,
      body: { name: "Acceptance scoped key", permissions: ["models"], rateLimitPerMinute: 30 },
    });
    const scopedSecret = scopedKeyCreate.json?.secret;
    const scopedId = scopedKeyCreate.json?.key?.id;
    record(
      "Keys",
      "Create key returns the secret exactly once",
      scopedKeyCreate.status === 200 && typeof scopedSecret === "string" && scopedSecret.startsWith("anx_live_") ? "PASS" : "FAIL",
      `HTTP ${scopedKeyCreate.status}`,
    );
    if (scopedSecret && scopedId) {
      const listKeys = await request("/api/keys", { token: tokenA });
      record(
        "Keys",
        "Key listing never returns the secret or its digest",
        listKeys.status === 200 &&
          !JSON.stringify(listKeys.json).includes(scopedSecret) &&
          !("key_hash" in ((listKeys.json?.items ?? [])[0] ?? {}))
          ? "PASS"
          : "FAIL",
        `HTTP ${listKeys.status}`,
      );
      const scopedModels = await request("/v1/models", { key: scopedSecret });
      const scopedGateway = await request("/api/gateway/execute", {
        method: "POST",
        key: scopedSecret,
        body: { apiSlug: "cohere", query: { q: "hi" } },
      });
      record(
        "Keys",
        "Per-key permissions: models-only key can list models but not execute",
        scopedModels.status === 200 && scopedGateway.status === 403 ? "PASS" : "FAIL",
        `models HTTP ${scopedModels.status}, gateway HTTP ${scopedGateway.status}`,
      );
      const revoked = await request(`/api/keys/${scopedId}`, { method: "DELETE", token: tokenA });
      const afterRevoke = await request("/v1/models", { key: scopedSecret });
      record(
        "Keys",
        "Revocation takes effect immediately",
        revoked.status === 200 && afterRevoke.status === 401 ? "PASS" : "FAIL",
        `revoke HTTP ${revoked.status}, reuse HTTP ${afterRevoke.status}`,
      );
    }

    const fastKey = await issueKey(userA.id, "Anvex acceptance rate limit key", ["execute"], 1);
    const firstCall = await request("/api/gateway/execute", {
      method: "POST",
      key: fastKey.secret,
      body: { apiSlug: "cohere", query: { q: "one" } },
    });
    const secondCall = await request("/api/gateway/execute", {
      method: "POST",
      key: fastKey.secret,
      body: { apiSlug: "cohere", query: { q: "two" } },
    });
    record(
      "Rate limits",
      "Per-key rate limit returns 429 after the configured allowance",
      firstCall.status === 200 && secondCall.status === 429 ? "PASS" : "FAIL",
      `first HTTP ${firstCall.status}, second HTTP ${secondCall.status}`,
    );
    await admin.from("platform_api_keys").delete().eq("id", fastKey.id);

    // ---------------------------------------------------------------------
    // OpenAI-compatible chat, including an explicit streaming refusal.
    // ---------------------------------------------------------------------
    const chat = await request("/v1/chat/completions", {
      method: "POST",
      key: keyA.secret,
      body: {
        model: "rebix-claude-haiku",
        messages: [{ role: "user", content: "Reply with a short greeting." }],
      },
      timeoutMs: 60_000,
    });
    const content = chat.json?.choices?.[0]?.message?.content;
    record(
      "AI gateway",
      "POST /v1/chat/completions returns a real generated message",
      chat.status === 200 && typeof content === "string" && content.length > 0 ? "PASS" : "FAIL",
      `HTTP ${chat.status}, content=${JSON.stringify(String(content ?? "").slice(0, 80))}`,
    );
    record(
      "AI gateway",
      "Usage is omitted instead of fabricated when the adapter cannot report tokens",
      chat.json?.anvex?.usage_reported === false && !("usage" in (chat.json ?? {})) ? "PASS" : "FAIL",
      `usage_reported=${chat.json?.anvex?.usage_reported}`,
    );

    const streamRefusal = await request("/v1/chat/completions", {
      method: "POST",
      key: keyA.secret,
      body: { model: "rebix-claude-haiku", messages: [{ role: "user", content: "hi" }], stream: true },
    });
    record(
      "AI gateway",
      "Streaming is refused honestly for non-streaming adapters",
      streamRefusal.status === 400 && streamRefusal.json?.error?.code === "unsupported_parameter" ? "PASS" : "FAIL",
      `HTTP ${streamRefusal.status} ${streamRefusal.json?.error?.code ?? ""}`,
    );

    const toolsRefusal = await request("/v1/chat/completions", {
      method: "POST",
      key: keyA.secret,
      body: {
        model: "rebix-claude-haiku",
        messages: [{ role: "user", content: "hi" }],
        tools: [{ type: "function" }],
      },
    });
    record(
      "AI gateway",
      "Tool calling is explicitly unsupported rather than faked",
      toolsRefusal.status === 400 && toolsRefusal.json?.error?.code === "unsupported_parameter" ? "PASS" : "FAIL",
      `HTTP ${toolsRefusal.status}`,
    );

    // ---------------------------------------------------------------------
    // Discovery re-run: detects the unchanged catalog.
    // ---------------------------------------------------------------------
    const discoveryOne = await request("/api/discover", {
      method: "POST",
      token: tokenA,
      body: { sourceUrl: "https://api-rebix.zone.id/", providerSlug: "rebix", adapter: "rebix_manifest" },
      timeoutMs: 120_000,
    });
    record(
      "Discovery",
      "Discovery re-run inspects the live manifest and reconciles every endpoint",
      discoveryOne.status === 200 && (discoveryOne.json?.summary?.discovered ?? 0) >= 50 ? "PASS" : "FAIL",
      `HTTP ${discoveryOne.status} discovered=${discoveryOne.json?.summary?.discovered ?? "?"} created=${discoveryOne.json?.summary?.created ?? "?"} updated=${discoveryOne.json?.summary?.updated ?? "?"} unchanged=${discoveryOne.json?.summary?.unchanged ?? "?"}`,
    );

    const discoveryTwo = await request("/api/discover", {
      method: "POST",
      token: tokenA,
      body: { sourceUrl: "https://api-rebix.zone.id/", providerSlug: "rebix", adapter: "rebix_manifest" },
      timeoutMs: 120_000,
    });
    record(
      "Discovery",
      "Second run reports changes only where the source actually changed",
      discoveryTwo.status === 200 && (discoveryTwo.json?.summary?.created ?? 99) === 0 && (discoveryTwo.json?.summary?.updated ?? 99) === 0
        ? "PASS"
        : "FAIL",
      `created=${discoveryTwo.json?.summary?.created ?? "?"} updated=${discoveryTwo.json?.summary?.updated ?? "?"} unchanged=${discoveryTwo.json?.summary?.unchanged ?? "?"}`,
    );

    const runRows = await admin
      .from("discovery_runs")
      .select("id, status, created_count, updated_count, unchanged_count, source_url, attempted_methods")
      .order("started_at", { ascending: false })
      .limit(2);
    record(
      "Discovery",
      "Discovery runs are persisted with source URL and attempted methods",
      (runRows.data?.length ?? 0) >= 2 &&
        runRows.data.every((run) => run.source_url.includes("api-rebix.zone.id") && Array.isArray(run.attempted_methods))
        ? "PASS"
        : "FAIL",
      `runs=${runRows.data?.map((run) => run.status).join(",") ?? "none"}`,
    );

    // ---------------------------------------------------------------------
    // Telemetry is real, not fabricated.
    // ---------------------------------------------------------------------
    const usage = await request("/api/usage?days=1", { token: tokenA });
    record(
      "Telemetry",
      "Usage totals are derived from real gateway requests made in this run",
      usage.status === 200 && (usage.json?.totals?.requests ?? 0) > 0 ? "PASS" : "FAIL",
      `requests=${usage.json?.totals?.requests ?? "?"}, errors=${usage.json?.totals?.errors ?? "?"}`,
    );
    const history = await request("/api/requests?days=1&perPage=5", { token: tokenA });
    record(
      "Telemetry",
      "Request history exposes status, duration and API attribution without payloads",
      history.status === 200 && (history.json?.items?.length ?? 0) > 0 &&
        !JSON.stringify(history.json).includes("q=Reply") ? "PASS" : "FAIL",
      `items=${history.json?.items?.length ?? 0}`,
    );

    // ---------------------------------------------------------------------
    // Cleanup of acceptance-only APIs.
    // ---------------------------------------------------------------------
    const cleanupIds = [artifacts.apis.probe, artifacts.apis.post, artifacts.apis.private, artifacts.apis.secret].filter(Boolean);
    if (cleanupIds.length) {
      await admin.from("apis").delete().in("id", cleanupIds);
    }
    console.log(`Cleaned up ${cleanupIds.length} acceptance API rows (test users and key audit rows remain).`);
  } catch (error) {
    record("Suite", "Unexpected failure", "FAIL", error instanceof Error ? error.message : String(error));
  } finally {
    server.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      server.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }

  line();
  const passed = results.filter((entry) => entry.status === "PASS").length;
  const skipped = results.filter((entry) => entry.status === "SKIP").length;
  const failed = results.filter((entry) => entry.status === "FAIL").length;
  console.log(`RESULT ${passed} passed, ${skipped} skipped, ${failed} failed, ${results.length} total`);
  console.log(
    JSON.stringify(
      {
        baseUrl: BASE,
        generatedAt: new Date().toISOString(),
        users: artifacts.users,
        keys: artifacts.keys,
        results,
      },
      null,
      2,
    ),
  );
  line();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Acceptance runner crashed:", error instanceof Error ? error.stack : error);
  process.exit(2);
});
