import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Caller } from "@/lib/api/auth";
import type { ApiRecord } from "@/lib/db/types";
import { GatewayError } from "@/lib/executor/errors";

export async function loadLinkableApi(
  admin: SupabaseClient,
  slug: string,
  caller: Caller,
): Promise<ApiRecord> {
  const { data, error } = await admin.from("apis").select("*").eq("slug", slug).maybeSingle();
  if (error) throw new GatewayError("query_failed", error.message, 500);
  if (!data) throw new GatewayError("not_found", `API "${slug}" not found.`, 404);
  const api = data as ApiRecord;
  const accessible =
    (api.is_public && api.is_enabled) || api.owner_id === caller.userId || caller.isAdmin;
  if (!accessible) throw new GatewayError("not_found", `API "${slug}" not found.`, 404);
  if (api.method !== "GET") {
    throw new GatewayError(
      "unsupported_api",
      "The simple text adapter requires a GET endpoint with query parameters.",
      400,
    );
  }
  if (!api.query_params?.length) {
    throw new GatewayError(
      "unsupported_api",
      "This API declares no query parameters, so the text adapter cannot map chat messages to it.",
      400,
    );
  }
  return api;
}

export function rebixQueryParam(api: ApiRecord): string {
  const declared = api.query_params ?? [];
  const preferred = declared.find((param) => param.name === "q") ?? declared[0];
  return preferred?.name ?? "q";
}
