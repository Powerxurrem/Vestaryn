import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { updateSession } from "./src/lib/supabase/middleware";
import { isEarlyAccessAllowed } from "@/lib/early-access";

const PUBLIC_PATHS = ["/", "/login", "/early_access"];
const PUBLIC_PREFIXES = ["/auth", "/api/auth", "/api/waitlist"];

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  const isPublic =
    PUBLIC_PATHS.includes(pathname) ||
    PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  const response = await updateSession(request);

  if (isPublic) {
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: () => {},
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const email = user.email?.trim().toLowerCase() ?? null;
  const allowed = await isEarlyAccessAllowed(email);

  if (!allowed) {
    return NextResponse.redirect(new URL("/early_access", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};