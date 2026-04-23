"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Storage key for the signed state issued by /oauth/google-url when the
// "add another Gmail" flow began. The backend verifies it's a fresh,
// single-use value bound to this user + redirect URI.
const STATE_KEY = "runemail_add_account_state";

export default function GoogleAddAccountCallback() {
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading",
  );
  const [message, setMessage] = useState("Linking account...");

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        const returnedState = params.get("state");
        if (!code) throw new Error("No authorization code received");

        const expectedState = sessionStorage.getItem(STATE_KEY);
        sessionStorage.removeItem(STATE_KEY);
        if (
          !expectedState ||
          !returnedState ||
          expectedState !== returnedState
        ) {
          throw new Error("State mismatch. Please retry linking.");
        }

        // Use the existing Supabase session from cookies rather than passing a
        // JWT through localStorage. Cookies travel with the OAuth round-trip.
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) {
          throw new Error("Session expired. Please sign in again.");
        }

        const apiUrl =
          process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/api";
        const res = await fetch(`${apiUrl}/oauth/add-gmail`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            code,
            redirect_uri: `${window.location.origin}/auth/google-add-account`,
            state: returnedState,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(
            (err as { error?: string }).error ?? `Error ${res.status}`,
          );
        }

        const data = await res.json();
        localStorage.setItem("runemail_account_linked", data.gmail_address);
        setStatus("success");
        setMessage(`Linked: ${data.gmail_address}`);

        setTimeout(() => {
          window.location.href = "/app";
        }, 1000);
      } catch (e: any) {
        sessionStorage.removeItem(STATE_KEY);
        setStatus("error");
        setMessage(e?.message ?? "Something went wrong");
      }
    })();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-slate-900">
      <div className="text-center space-y-3">
        {status === "loading" && (
          <span
            className="material-symbols-outlined animate-spin text-indigo-500 block mx-auto"
            style={{ fontSize: 40 }}
          >
            progress_activity
          </span>
        )}
        {status === "success" && (
          <span
            className="material-symbols-outlined text-green-500 block mx-auto"
            style={{ fontSize: 40 }}
          >
            check_circle
          </span>
        )}
        {status === "error" && (
          <span
            className="material-symbols-outlined text-red-400 block mx-auto"
            style={{ fontSize: 40 }}
          >
            error
          </span>
        )}
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
          {message}
        </p>
        {status === "error" && (
          <a
            href="/app"
            className="text-xs text-indigo-500 hover:underline block"
          >
            Return to app
          </a>
        )}
      </div>
    </div>
  );
}
