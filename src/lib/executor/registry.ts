import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { GatewayError } from "@/lib/executor/errors";
import {
  performUpstreamRequest,
  type PerformInput,
  type PerformOptions,
  type PerformResult,
} from "@/lib/executor/perform";
import { decryptJson } from "@/lib/security/crypto";
import { logRequest } from "@/lib/usage/log";
import type { ApiRecord } from "@/lib/db/types";
import type { UpstreamAuthConfig } from "@/lib/registry/params";

export interface RegistryCaller {
  userId: string;
  isAdmin: boolean;
  platformKeyId?: string | null;
}

export interface ExecuteRegistryArgs {
  admin: SupabaseClient;
  api: ApiRecord;
  caller: RegistryCaller;
  input: PerformInput;
  recordVerification?: boolean;
  performOptions?: PerformOptions;
}

export interface ExecuteRegistryResult {
  result: PerformResult;
  verification?: {
    status: "verified" | "failed";
    message: string | null;
  };
}

export function assertApiAccess(api: ApiRecord, caller: RegistryCaller): void {
  const isOwner = api.owner_id === caller.userId;
  const permitted =
    isOwner ||
    caller.isAdmin ||
    (api.is_public && api.is_enabled);
  if (!permitted) {
    throw new GatewayError("not_found", "API not found or not available to this account.", 404);
  }
}

function payloadFailure(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const statusFlag = record.status ?? record.success;
  if (statusFlag === false) {
    const message =
      (typeof record.message === "string" && record.message) ||
      (typeof record.msg === "string" && record.msg) ||
      (typeof record.error === "string" && record.error) ||
      "Upstream reported an unsuccessful status.";
    return String(message).slice(0, 500);
  }
  return null;
}

export function evaluateVerification(result: PerformResult): {
  status: "verified" | "failed";
  message: string | null;
} {
  if (!result.ok) {
    return {
      status: "failed",
      message: `Upstream responded with HTTP ${result.status}.`,
    };
  }
  const failure = payloadFailure(result.body);
  if (failure) return { status: "failed", message: failure };
  return { status: "verified", message: null };
}

async function allowedHostsFor(admin: SupabaseClient, api: ApiRecord): Promise<string[]> {
  const hosts = new Set<string>(env.allowedHosts);
  try {
    hosts.add(new URL(api.base_url).hostname.toLowerCase());
  } catch {
    /* handled later by URL validation */
  }
  if (api.provider_id) {
    const { data } = await admin
      .from("providers")
      .select("allowed_hosts")
      .eq("id", api.provider_id)
      .maybeSingle();
    for (const host of (data?.allowed_hosts as string[] | null) ?? []) hosts.add(host);
  }
  return Array.from(hosts);
}

export async function executeRegistryApi(args: ExecuteRegistryArgs): Promise<ExecuteRegistryResult> {
  const { admin, api, caller, input, recordVerification = false } = args;
  assertApiAccess(api, caller);

  let authConfig: UpstreamAuthConfig | null = null;
  if (api.auth_config_encrypted) {
    try {
      authConfig = decryptJson<UpstreamAuthConfig>(api.auth_config_encrypted);
    } catch {
      throw new GatewayError(
        "credential_unavailable",
        "Stored upstream credentials could not be decrypted. Re-save the API credentials.",
        500,
      );
    }
  }

  const allowedHosts = await allowedHostsFor(admin, api);
  const started = Date.now();

  try {
    const result = await performUpstreamRequest(api, authConfig, input, {
      allowedHosts,
      enforceAllowlist: env.enforceHostAllowlist,
      ...args.performOptions,
    });

    if (recordVerification) {
      const verification = evaluateVerification(result);
      const { error } = await admin
        .from("apis")
        .update({
          verification_status: verification.status,
          last_status_code: result.status,
          last_tested_at: new Date().toISOString(),
          last_error: verification.message,
        })
        .eq("id", api.id);
      if (error) console.error("[executor] verification update failed:", error.message);

      await logRequest(admin, {
        userId: caller.userId,
        apiId: api.id,
        platformKeyId: caller.platformKeyId,
        kind: "discovery_test",
        method: api.method,
        statusCode: result.status,
        durationMs: result.durationMs,
        responseBytes: result.size,
        ok: verification.status === "verified",
        errorCode: verification.status === "failed" ? "verification_failed" : null,
      });

      return { result, verification };
    }

    await logRequest(admin, {
      userId: caller.userId,
      apiId: api.id,
      platformKeyId: caller.platformKeyId,
      kind: "rest",
      method: api.method,
      statusCode: result.status,
      durationMs: result.durationMs,
      responseBytes: result.size,
      ok: result.ok,
    });

    return { result };
  } catch (error) {
    await logRequest(admin, {
      userId: caller.userId,
      apiId: api.id,
      platformKeyId: caller.platformKeyId,
      kind: recordVerification ? "discovery_test" : "rest",
      method: api.method,
      statusCode: error instanceof GatewayError ? error.status : null,
      durationMs: Date.now() - started,
      ok: false,
      errorCode: error instanceof GatewayError ? error.code : "unknown_error",
    });

    if (recordVerification) {
      await admin
        .from("apis")
        .update({
          verification_status: "failed",
          last_tested_at: new Date().toISOString(),
          last_error:
            error instanceof Error ? error.message.slice(0, 500) : "Unknown verification error",
        })
        .eq("id", api.id);
    }
    throw error;
  }
}

export type { PerformInput, PerformResult };
