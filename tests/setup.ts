process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.PLATFORM_KEY_PEPPER = "test-pepper-do-not-use-in-production";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.GATEWAY_ALLOWED_HOSTS = "api-rebix.zone.id";
process.env.GATEWAY_ALLOWED_PORTS = "80,443";
process.env.GATEWAY_ENFORCE_HOST_ALLOWLIST = "true";
