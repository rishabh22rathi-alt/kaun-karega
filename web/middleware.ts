import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";

/**
 * Server-side guard for /admin/* routes.
 *
 * Requires two cookies set by verify-otp after admin confirmation:
 *   kk_auth_session — valid user session with a phone number
 *   kk_admin        — presence confirms admin status (set only when GAS admin_verify passes)
 *
 * /admin/login is excluded so the login page is always reachable.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only guard /admin/* — and always allow /admin/login through
  if (!pathname.startsWith("/admin") || pathname === "/admin/login") {
    return NextResponse.next();
  }

  const cookieHeader = request.headers.get("cookie") ?? "";
  const session = getAuthSession({ cookie: cookieHeader });
  const adminCookie = request.cookies.get("kk_admin")?.value;

  if (!session?.phone || adminCookie !== "1") {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
