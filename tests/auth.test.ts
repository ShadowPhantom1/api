import { beforeEach, describe, expect, it, vi } from "vitest";
import { GatewayError } from "@/lib/executor/errors";
import { generatePlatformKey } from "@/lib/security/keys";

const state = {
  key: null as Record<string, unknown> | null,
  keyError: null as { message: string } | null,
  updateError: null as { message: string } | null,
  user: null as { id: string } | null,
  rateLimited: false,
  lastSubject: "",
  updates: [] as Array<Record<string, unknown>>,
  profile: null as { role: string } | null,
};

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () =>
        state.user
          ? { data: { user: state.user }, error: null }
          : { data: { user: null }, error: { message: "no session" } },
    },
  }),
}));

vi.mock("@/lib/security/rate-limit", () => ({
  consumeRateLimit: async (_admin: unknown, subject: string, limit: number) => {
    state.lastSubject = subject;
    return { allowed: !state.rateLimited, remaining: 0, limit, windowSeconds: 60 };
  },
}));

function adminStub() {
  return {
    from(table: string) {
      if (table === "profiles") {
        const profiles: Record<string, unknown> = {
          select: () => profiles,
          eq: () => profiles,
          maybeSingle: async () => ({ data: state.profile, error: null }),
        };
        return profiles;
      }
      if (table !== "platform_api_keys") throw new Error(`unexpected table ${table}`);
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: state.key, error: state.keyError }),
        update: (payload: Record<string, unknown>) => {
          state.updates.push(payload);
          return { eq: async () => ({ error: state.updateError }) };
        },
      };
      return builder;
    },
  };
}

const { authenticateRequest, assertUserCaller } = await import("@/lib/api/auth");

function requestWith(token?: string) {
  return new Request("https://app.example.com/api/gateway/execute", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "no-error";
  } catch (error) {
    return error instanceof GatewayError ? error.code : "not-gateway";
  }
}

describe("platform key authentication", () => {
  beforeEach(() => {
    state.key = null;
    state.keyError = null;
    state.updateError = null;
    state.user = null;
    state.rateLimited = false;
    state.lastSubject = "";
    state.updates = [];
    state.profile = { role: "user" };
  });

  it("rejects unknown platform keys", async () => {
    const key = generatePlatformKey();
    expect(await codeOf(authenticateRequest(requestWith(key.secret), adminStub() as never))).toBe("invalid_api_key");
  });

  it("rejects revoked and expired keys", async () => {
    const key = generatePlatformKey();
    state.key = {
      id: "key-1",
      user_id: "user-1",
      permissions: ["execute"],
      rate_limit_per_minute: 60,
      revoked_at: new Date().toISOString(),
      expires_at: null,
    };
    expect(await codeOf(authenticateRequest(requestWith(key.secret), adminStub() as never))).toBe("key_revoked");

    state.key = {
      ...state.key,
      revoked_at: null,
      expires_at: new Date(Date.now() - 1000).toISOString(),
    };
    expect(await codeOf(authenticateRequest(requestWith(key.secret), adminStub() as never))).toBe("key_expired");
  });

  it("enforces per-key permissions", async () => {
    const key = generatePlatformKey();
    state.key = {
      id: "key-1",
      user_id: "user-1",
      permissions: ["models"],
      rate_limit_per_minute: 60,
      revoked_at: null,
      expires_at: null,
    };
    expect(
      await codeOf(authenticateRequest(requestWith(key.secret), adminStub() as never, { scopes: ["execute"] })),
    ).toBe("insufficient_scope");
  });

  it("accepts a scoped key and records last use", async () => {
    const key = generatePlatformKey();
    state.key = {
      id: "key-1",
      user_id: "user-1",
      permissions: ["execute"],
      rate_limit_per_minute: 45,
      revoked_at: null,
      expires_at: null,
    };
    const caller = await authenticateRequest(requestWith(key.secret), adminStub() as never, { scopes: ["execute"] });
    expect(caller).toMatchObject({
      userId: "user-1",
      platformKeyId: "key-1",
      authMethod: "platform_key",
      rateLimitPerMinute: 45,
    });
    expect(state.lastSubject).toBe("key:key-1");
    expect(state.updates.at(-1)).toHaveProperty("last_used_at");
  });

  it("maps exhausted quotas to a 429", async () => {
    const key = generatePlatformKey();
    state.key = {
      id: "key-1",
      user_id: "user-1",
      permissions: ["execute"],
      rate_limit_per_minute: 1,
      revoked_at: null,
      expires_at: null,
    };
    state.rateLimited = true;
    try {
      await authenticateRequest(requestWith(key.secret), adminStub() as never);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(GatewayError);
      expect((error as GatewayError).status).toBe(429);
      expect((error as GatewayError).code).toBe("rate_limited");
    }
  });

  it("falls back to the browser session and rejects anonymous requests", async () => {
    expect(await codeOf(authenticateRequest(requestWith(), adminStub() as never))).toBe("unauthorized");
    state.user = { id: "user-2" };
    const caller = await authenticateRequest(requestWith(), adminStub() as never);
    expect(caller).toMatchObject({ userId: "user-2", authMethod: "session", platformKeyId: null });
  });

  it("does not let platform keys manage the workspace", () => {
    expect(() =>
      assertUserCaller({
        userId: "u",
        isAdmin: false,
        authMethod: "platform_key",
        platformKeyId: "k",
        rateLimitPerMinute: 60,
      }),
    ).toThrow(/limited to gateway/i);
    expect(() =>
      assertUserCaller({
        userId: "u",
        isAdmin: false,
        authMethod: "session",
        platformKeyId: null,
        rateLimitPerMinute: 60,
      }),
    ).not.toThrow();
  });
});
