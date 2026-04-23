import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Only allow relative in-app paths for the post-auth redirect target.
// Rejects absolute URLs, protocol-relative URLs, and backslash bypasses that
// browsers sometimes normalise into protocol-relative schemes.
function sanitizeNext(raw: string | null): string {
  const fallback = "/app";
  if (!raw) return fallback;
  try {
    const decoded = decodeURIComponent(raw);
    if (!decoded.startsWith("/")) return fallback;
    if (decoded.startsWith("//") || decoded.startsWith("/\\")) return fallback;
    if (/^\s*[a-z][a-z0-9+.-]*:/i.test(decoded)) return fallback;
    return decoded;
  } catch {
    return fallback;
  }
}

// Only honour x-forwarded-host if it matches the app's configured public host.
// Otherwise we fall back to the request's own origin. This prevents an
// attacker-controlled forwarded host from redirecting users off-site.
function pickBase(request: Request, origin: string): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  if (!forwardedHost) return origin;
  const publicUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (publicUrl) {
    try {
      const u = new URL(publicUrl);
      if (u.host === forwardedHost)
        return `${forwardedProto}://${forwardedHost}`;
    } catch {
      /* ignore */
    }
  }
  // Accept localhost in dev; otherwise require host match to trust proxy headers.
  if (
    forwardedHost.startsWith("localhost") ||
    forwardedHost.startsWith("127.0.0.1")
  ) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return origin;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = sanitizeNext(searchParams.get("next"));
  const addAccount = searchParams.get("add_account") === "1";
  const isSignUp = searchParams.get("is_signup") === "1";
  const pendingMode = searchParams.get("ai_mode");
  const pendingTheme = searchParams.get("theme");

  const base = pickBase(request, origin);

  if (!code) {
    return NextResponse.redirect(`${base}/?error=auth`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    console.error(
      "[auth/callback] exchangeCodeForSession failed:",
      error?.message,
    );
    return NextResponse.redirect(`${base}/?error=auth`);
  }

  const { session } = data;
  const userId = session.user.id;
  const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/api";

  if (session.provider_token) {
    // Always route through the edge function, which encrypts tokens with the
    // shared Fernet key. If registration fails we sign out and ask the user
    // to retry rather than writing plaintext tokens to the database.
    let registered = false;
    try {
      const regRes = await fetch(`${apiUrl}/register-gmail-token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          provider_token: session.provider_token,
          provider_refresh_token: session.provider_refresh_token ?? null,
          add_account: addAccount,
        }),
      });
      registered = regRes.ok;
      if (!registered) {
        console.error(
          "[auth/callback] register-gmail-token failed status=",
          regRes.status,
        );
      }
    } catch (e) {
      console.error("[auth/callback] register-gmail-token network error:", e);
    }

    if (!registered) {
      // Fail closed: don't store plaintext tokens. Ask the user to retry.
      try {
        await supabase.auth.signOut();
      } catch {
        /* ignore */
      }
      return NextResponse.redirect(`${base}/?error=gmail_register_failed`);
    }
  } else if (!addAccount) {
    // No provider_token — Supabase reused an existing session. If no Gmail
    // accounts are connected, sign out and force fresh OAuth.
    const { count } = await supabase
      .from("gmail_accounts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("is_active", true);
    if (!count) {
      await supabase.auth.signOut();
      return NextResponse.redirect(`${base}/?reconnect=1`);
    }
  }

  // Save pending preferences (AI mode + theme) passed as URL params
  if (!addAccount) {
    const updates: Record<string, string> = {};
    if (pendingMode && ["cloud", "local", "hybrid"].includes(pendingMode))
      updates.ai_mode = pendingMode;
    if (pendingTheme && ["dark", "light"].includes(pendingTheme))
      updates.theme = pendingTheme;
    if (Object.keys(updates).length > 0) {
      await supabase.from("profiles").update(updates).eq("id", userId);
    }
  }

  // Treat returning users with no emails as first-timers so auto-sync fires
  let initialFlag = isSignUp;
  if (!addAccount && !isSignUp && session.provider_token) {
    const { count } = await supabase
      .from("emails")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if ((count ?? 0) === 0) initialFlag = true;
  }

  const redirectTarget = addAccount
    ? next
    : initialFlag
      ? `${next}?initial=1`
      : next;
  return NextResponse.redirect(`${base}${redirectTarget}`);
}
