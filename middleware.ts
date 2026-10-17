import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Refresh auth cookies for dashboard and auth routes only. API routes use
     * explicit authentication and should not pay the middleware cost.
     */
    "/dashboard/:path*",
    "/login",
    "/signup",
  ],
};
