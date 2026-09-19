import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Authentication entry points must stay reachable even when a browser has
  // stale/oversized session cookies. They perform their own auth validation.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.well-known/workflow/|api(?:/|$)|login(?:/|$)|reset-password(?:/|$)|auth/callback(?:/|$)|supabase-test(?:/|$)|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
