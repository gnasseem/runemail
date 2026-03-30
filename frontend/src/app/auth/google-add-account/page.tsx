"use client";

import { useEffect, useState } from "react";

export default function GoogleAddAccountCallback() {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Linking account...");

  useEffect(() => {
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        if (!code) throw new Error("No authorization code received");

        const originalJwt = localStorage.getItem("runemail_add_account_original_jwt");
        if (!originalJwt) throw new Error("Original session lost — please try again");

        const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/api";
        const res = await fetch(`${apiUrl}/oauth/add-gmail`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${originalJwt}`,
          },
          body: JSON.stringify({
            code,
            redirect_uri: `${window.location.origin}/auth/google-add-account`,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error ?? `Error ${res.status}`);
        }

        const data = await res.json();
        localStorage.removeItem("runemail_add_account_original_jwt");
        localStorage.setItem("runemail_account_linked", data.gmail_address);
        setStatus("success");
        setMessage(`Linked: ${data.gmail_address}`);

        // Redirect back to the app — original Supabase session is still intact
        setTimeout(() => {
          window.location.href = "/app";
        }, 1000);
      } catch (e: any) {
        localStorage.removeItem("runemail_add_account_original_jwt");
        setStatus("error");
        setMessage(e?.message ?? "Something went wrong");
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
          <a href="/app" className="text-xs text-indigo-500 hover:underline block">
            Return to app
          </a>
        )}
      </div>
    </div>
  );
}
