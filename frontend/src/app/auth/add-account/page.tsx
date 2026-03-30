"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function AddAccountCallback() {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Linking account...");

  useEffect(() => {
    (async () => {
      try {
        const supabase = createClient();

        // Exchange the OAuth code for a session (gives us the provider_token)
        const { data, error } = await supabase.auth.exchangeCodeForSession(
          window.location.href
        );
        if (error || !data.session?.provider_token) {
          throw new Error(error?.message ?? "No provider token received");
        }

        // Get the original user's JWT that was stored before the popup opened
        const originalJwt = localStorage.getItem("runemail_add_account_original_jwt");
        if (!originalJwt) throw new Error("Original session lost");

        // Register the new Gmail token under the ORIGINAL user's account
        const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/api";
        const res = await fetch(`${apiUrl}/register-gmail-token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${originalJwt}`,
          },
          body: JSON.stringify({
            provider_token: data.session.provider_token,
            provider_refresh_token: data.session.provider_refresh_token ?? null,
            add_account: true,
          }),
        });
        if (!res.ok) throw new Error("Failed to register account");

        localStorage.removeItem("runemail_add_account_original_jwt");
        setStatus("success");
        setMessage("Account linked!");

        // Notify parent window and close popup
        if (window.opener) {
          window.opener.postMessage({ type: "runemail_add_account_success" }, window.location.origin);
          setTimeout(() => window.close(), 800);
        }
      } catch (e: any) {
        setStatus("error");
        setMessage(e?.message ?? "Something went wrong");
        if (window.opener) {
          window.opener.postMessage(
            { type: "runemail_add_account_error", message: e?.message },
            window.location.origin
          );
        }
      }
    })();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-slate-900">
      <div className="text-center space-y-3">
        {status === "loading" && (
          <span className="material-symbols-outlined animate-spin text-indigo-500 block mx-auto" style={{ fontSize: 40 }}>
            progress_activity
          </span>
        )}
        {status === "success" && (
          <span className="material-symbols-outlined text-green-500 block mx-auto" style={{ fontSize: 40 }}>
            check_circle
          </span>
        )}
        {status === "error" && (
          <span className="material-symbols-outlined text-red-400 block mx-auto" style={{ fontSize: 40 }}>
            error
          </span>
        )}
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{message}</p>
        {status === "error" && (
          <button onClick={() => window.close()} className="text-xs text-slate-400 hover:underline">
            Close this window
          </button>
        )}
      </div>
    </div>
  );
}
