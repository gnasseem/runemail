import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Dev-only helper for dropping a Supabase session into cookies. Hardened so
// that even if it ever ships in a non-dev build the route fails closed unless:
//   1. NODE_ENV === "development"
//   2. DEV_AUTH_SECRET is configured AND matches a secret query param
//   3. The request is coming from localhost (or an explicitly allowed host)
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { error: "Not available in production" },
      { status: 403 },
    );
  }

  const host = (request.headers.get("host") ?? "").toLowerCase();
  const isLocalHost =
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.startsWith("[::1]");
  if (!isLocalHost) {
    return NextResponse.json(
      { error: "Not available on this host" },
      { status: 403 },
    );
  }

  const expectedSecret = process.env.DEV_AUTH_SECRET;
  if (!expectedSecret) {
    return NextResponse.json(
      { error: "DEV_AUTH_SECRET not configured" },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const providedSecret = searchParams.get("secret");
  if (providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const access_token = searchParams.get("access_token");
  const refresh_token = searchParams.get("refresh_token");

  if (!access_token || !refresh_token) {
    return NextResponse.json({ error: "Missing tokens" }, { status: 400 });
  }

  const response = NextResponse.redirect(new URL("/app", request.url));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options?: Record<string, unknown>;
          }[],
        ) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options as any),
          );
        },
      },
    },
  );

  await supabase.auth.setSession({ access_token, refresh_token });

  return response;
}
