import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";

/**
 * Server-side route guards.
 *
 * /admin/* — requires a valid user session AND the kk_admin=1 cookie.
 *   /admin/login is excluded so the login page is always reachable.
 *
 * /report-issue — requires any valid logged-in session (user or provider).
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const cookieHeader = request.headers.get("cookie") ?? "";

  // Guard /report-issue — any authenticated user is allowed.
  // validateVersion: true rejects cookies whose `sver` no longer matches
  // profiles.session_version (i.e. a newer device has logged in for the
  // same phone). Legacy cookies without `sver` are still accepted — see
  // lib/sessionVersion.ts for the rollout compatibility note.
  if (pathname === "/report-issue") {
    const session = await getAuthSession({
      cookie: cookieHeader,
      validateVersion: true,
    });
    if (!session?.phone) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", `/report-issue`);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  // Guard /admin/* — requires a verified signed session AND the kk_admin=1
  // UI cookie. The signed session is the actual security gate; kk_admin is
  // a UI hint and is also re-verified by API routes via requireAdminSession.
  if (!pathname.startsWith("/admin") || pathname === "/admin/login") {
    return NextResponse.next();
  }

  const session = await getAuthSession({
    cookie: cookieHeader,
    validateVersion: true,
  });
  const adminCookie = request.cookies.get("kk_admin")?.value;

  if (!session?.phone || adminCookie !== "1") {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/report-issue", "/admin", "/admin/:path*"],
};
