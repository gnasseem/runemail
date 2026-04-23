/**
 * RuneMail — Supabase Edge Function: process-emails
 *
 * Background cron (every 30 min) that renews expiring Gmail Pub/Sub watches
 * so new-email webhooks keep firing. Email analysis is handled in real time
 * by the /gmail/webhook handler in the api function — this cron does not
 * duplicate that work.
 *
 * Deployed with --no-verify-jwt so pg_cron can invoke it without a JWT.
 * The function itself uses the service-role key internally.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { setupGmailWatch } from "../_shared/gmail.ts";

function getEnv(key: string): string {
  return (
    (
      Deno as unknown as { env: { get(k: string): string | undefined } }
    ).env.get(key) ?? ""
  );
}

Deno.serve(async (_req) => {
  const supabase = createClient(
    getEnv("SUPABASE_URL"),
    getEnv("SUPABASE_SERVICE_ROLE_KEY"),
  );

  // ── Phase 1: Renew expiring Gmail watches ──────────────────────────────
  // Gmail push watches expire after 7 days. Renew any expiring within 48 h so
  // webhooks keep firing even if the user never opens the app.
  const renewalCutoff = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const { data: expiringAccounts } = await supabase
    .from("gmail_accounts")
    .select("id, tokens_encrypted, watch_expiry")
    .eq("is_active", true)
    .or(`watch_expiry.is.null,watch_expiry.lt.${renewalCutoff}`);

  let watchesRenewed = 0;
  for (const account of expiringAccounts ?? []) {
    try {
      await setupGmailWatch(
        account.tokens_encrypted as string,
        supabase,
        account.id as string,
      );
      watchesRenewed++;
      console.log(`[process-emails] renewed watch for account ${account.id}`);
    } catch (err) {
      console.error(`[process-emails] watch renewal failed for account ${account.id}:`, (err as Error).message);
    }
  }

  return new Response(
    JSON.stringify({ watchesRenewed }),
    { headers: { "Content-Type": "application/json" } },
  );
});
