import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Delegate to the Supabase SSR helper so cookies stay refreshed and `/app`
// routes are gated defense-in-depth (client checks still happen).
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Skip Next.js internals, static assets, and image files. Everything else
  // flows through updateSession so auth cookies are refreshed on navigation.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|mp4|mp3)$).*)",
  ],
};
