import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertAdminBackend, env } from "@/lib/env";

/**
 * Service-role client. NEVER import this from a client component.
 * All privileged data access goes through this client on the server.
 */
let cached: SupabaseClient | null = null;

export function createAdminClient(): SupabaseClient {
  assertAdminBackend();
  if (cached) return cached;
  cached = createClient(env.supabaseUrl!, env.supabaseServiceRoleKey!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { "X-Client-Info": "anvex-server" },
    },
  });
  return cached;
}

export function getAdminClient(): SupabaseClient {
  return createAdminClient();
}
