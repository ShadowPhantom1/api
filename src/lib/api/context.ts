import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { authenticateRequest, type Caller, type Scope } from "@/lib/api/auth";
import { setupGuard } from "@/lib/api/http";

export interface ApiContext {
  admin: SupabaseClient;
  caller: Caller;
}

export async function getApiContext(
  request: Request,
  options: { scopes?: Scope[]; sessionRateLimit?: number } = {},
): Promise<ApiContext> {
  setupGuard();
  const admin = createAdminClient();
  const caller = await authenticateRequest(request, admin, options);
  return { admin, caller };
}
