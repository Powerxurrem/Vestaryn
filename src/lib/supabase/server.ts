import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * @file lib/supabase/server.ts
 * @purpose Create correctly-scoped Supabase server clients for:
 *          - Server Components (read-only cookies)
 *          - Route Handlers / Server Actions (read + write cookies)
 *
 * @exports
 * - supabaseServerComponent()
 * - supabaseRouteHandler()
 *
 * @sections
 * - Environment resolution
 * - Server Component client (read-only cookies)
 * - Route Handler client (read + write cookies)
 *
 * @invariants
 * - Server Components MUST NOT write cookies (Next.js restriction).
 * - Route Handlers MAY write cookies (auth refresh flow).
 * - Both clients rely on NEXT_PUBLIC_SUPABASE_URL + ANON_KEY.
 * - RLS enforcement happens at DB level; this file only provides auth context.
 *
 * @touchpoints
 * - next/headers cookies()
 * - @supabase/ssr createServerClient()
 *
 * @risk
 * - If cookie write logic is broken in route handler, auth refresh silently fails.
 */

// ─────────────────────────────────────────────────────────────
// Environment
// ─────────────────────────────────────────────────────────────
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// ─────────────────────────────────────────────────────────────
// Server Component client (READ-ONLY cookies)
// Use inside pages/layouts (Server Components)
// Prevents "Cookies can only be modified..." runtime errors.
// ─────────────────────────────────────────────────────────────
export async function supabaseServerComponent() {
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: () => {
        // Intentionally no-op.
        // Server Components cannot modify cookies.
      },
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Route Handler client (READ + WRITE cookies)
// Use inside API routes / server actions.
// Required for auth token refresh.
// ─────────────────────────────────────────────────────────────
export async function supabaseRouteHandler() {
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
        });
      },
    },
  });
}