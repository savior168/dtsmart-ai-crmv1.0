import { NextResponse, type NextRequest } from "next/server";

function hasSupabaseAuthCookie(request: NextRequest) {
  return request.cookies.getAll().some(({ name, value }) =>
    Boolean(value) && /^sb-[^-]+-auth-token(?:\.\d+)?$/.test(name),
  );
}

export function updateSession(request: NextRequest) {
  // Do not pass the full request back through NextResponse.next({ request }).
  // Next.js serializes overridden request headers into x-middleware-* headers;
  // repeatedly doing that with auth cookies can grow the response beyond
  // Vercel's 32 KB middleware header limit.
  const response = NextResponse.next();
  const publicPaths = [
    "/login",
    "/reset-password",
    "/auth/callback",
    "/supabase-test",
    "/api/auth/password-login",
    "/api/auth/register",
    "/api/auth/reset-password",
    "/api/auth/captcha",
  ];
  const isPublic = publicPaths.some((path) => request.nextUrl.pathname.startsWith(path));

  // Public routes do not need an authenticated session check. Besides being
  // faster, this keeps a malformed/stale browser cookie from taking down the
  // login and password recovery pages.
  if (isPublic) return response;

  // Routing middleware must return immediately and must never depend on a
  // remote Supabase Auth request. When Auth is slow or temporarily
  // unavailable, awaiting getUser() here blocks every page and API route until
  // Vercel terminates the middleware with MIDDLEWARE_INVOCATION_TIMEOUT.
  //
  // This check is only a fast navigation guard. Every protected API and server
  // mutation still validates the user with requireUser(), while database
  // access remains protected by Supabase RLS. A stale or forged cookie can
  // therefore never grant access to protected data.
  if (!hasSupabaseAuthCookie(request)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
