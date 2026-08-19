import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  // Do not pass the full request back through NextResponse.next({ request }).
  // Next.js serializes overridden request headers into x-middleware-* headers;
  // repeatedly doing that with auth cookies can grow the response beyond
  // Vercel's 32 KB middleware header limit.
  const response = NextResponse.next();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) return response;

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

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies: Array<{ name: string; value: string; options: CookieOptions }>) => {
        cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
