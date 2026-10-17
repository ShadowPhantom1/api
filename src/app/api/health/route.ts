import { isAdminBackendConfigured, isEncryptionConfigured, isSupabaseConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    status: "ok",
    app: "anvex",
    time: new Date().toISOString(),
    checks: {
      supabasePublic: isSupabaseConfigured(),
      supabaseAdmin: isAdminBackendConfigured(),
      credentialEncryption: isEncryptionConfigured(),
    },
  });
}
