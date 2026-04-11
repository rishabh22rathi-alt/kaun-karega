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
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const cookieHeader = request.headers.get("cookie") ?? "";

  // Guard /report-issue — any authenticated user is allowed
  if (pathname === "/report-issue") {
    const session = getAuthSession({ cookie: cookieHeader });
    if (!session?.phone) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", `/report-issue`);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  // Guard /admin/* — requires valid session + admin cookie
  if (!pathname.startsWith("/admin") || pathname === "/admin/login") {
    return NextResponse.next();
  }

  const session = getAuthSession({ cookie: cookieHeader });
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
