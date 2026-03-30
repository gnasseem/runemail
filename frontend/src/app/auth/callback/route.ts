import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/app";
  const addAccount = searchParams.get("add_account") === "1";
  const isSignUp = searchParams.get("is_signup") === "1";
  const pendingMode = searchParams.get("ai_mode");
  const pendingTheme = searchParams.get("theme");

  const forwardedHost = request.headers.get("x-forwarded-host");
  const base = forwardedHost ? `https://${forwardedHost}` : origin;

  if (!code) {
    return NextResponse.redirect(`${base}/?error=auth`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    console.error("[auth/callback] exchangeCodeForSession failed:", error?.message);
    return NextResponse.redirect(`${base}/?error=auth`);
  }

  const { session } = data;
  const userId = session.user.id;
  const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/api";

  if (session.provider_token) {
    // Try edge function first (encrypts tokens with Fernet key)
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
        console.error("[auth/callback] register-gmail-token failed:", await regRes.text());
      }
    } catch (e) {
      console.error("[auth/callback] register-gmail-token network error:", e);
    }

    if (!registered) {
      // Fallback: insert directly via authenticated server client.
      // Tokens stored as plaintext JSON; decryptTokens handles both formats.
      let gmailAddress = session.user.email ?? "";
      try {
        const uiRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { Authorization: `Bearer ${session.provider_token}` },
        });
        if (uiRes.ok) {
          const ui = await uiRes.json();
          gmailAddress = (ui as { email?: string }).email ?? gmailAddress;
        }
      } catch { /* use session email */ }

      const tokensJson = JSON.stringify({
        token: session.provider_token,
        refresh_token: session.provider_refresh_token ?? null,
        expiry: new Date(Date.now() + 3600 * 1000).toISOString(),
      });

      if (addAccount) {
        await supabase.from("gmail_accounts").upsert(
          { user_id: userId, gmail_address: gmailAddress, tokens_encrypted: tokensJson, is_active: true },
          { onConflict: "user_id,gmail_address" },
        );
      } else {
        const { data: existing } = await supabase
          .from("gmail_accounts").select("id").eq("user_id", userId).eq("gmail_address", gmailAddress);
        if (existing?.length) {
          await supabase.from("gmail_accounts")
            .update({ tokens_encrypted: tokensJson, is_active: true })
            .eq("user_id", userId).eq("gmail_address", gmailAddress);
        } else {
          await supabase.from("gmail_accounts").delete().eq("user_id", userId).eq("gmail_address", "");
          await supabase.from("gmail_accounts").insert({
            user_id: userId, gmail_address: gmailAddress, tokens_encrypted: tokensJson, is_active: true,
          });
        }
      }
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
    if (pendingMode && ["cloud", "local", "hybrid"].includes(pendingMode)) updates.ai_mode = pendingMode;
    if (pendingTheme && ["dark", "light"].includes(pendingTheme)) updates.theme = pendingTheme;
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

  const redirectTarget = addAccount ? next : initialFlag ? `${next}?initial=1` : next;
  return NextResponse.redirect(`${base}${redirectTarget}`);
}
