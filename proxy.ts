import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_COOKIE_NAME, ADMIN_PASSWORD } from "@/lib/admin-auth";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/admin/login")) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (cookie === ADMIN_PASSWORD) {
    return NextResponse.next();
  }

  // Admin agent API: answer with 401 instead of redirecting to the login page.
  if (pathname.startsWith("/api/admin")) {
    return NextResponse.json(
      { error: "Admin sign-in required." },
      { status: 401 },
    );
  }

  const url = request.nextUrl.clone();
  url.pathname = "/admin/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Workflow's internal /.well-known/workflow/* routes are intentionally not
  // matched, so the proxy never intercepts durable run execution.
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
