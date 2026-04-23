/**
 * RuneMail — Supabase Edge Function: scheduled-emails
 *
 * Processes pending scheduled emails whose send_at has passed.
 * Configure a cron trigger in the Supabase dashboard:
 *   Edge Functions → scheduled-emails → Add cron schedule
 *   Suggested: every minute → "* * * * *"
 *
 * This function is protected by Supabase's JWT gateway (service role only).
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail } from "../_shared/gmail.ts";

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

  const now = new Date().toISOString();

  const { data: pending, error } = await supabase
    .from("scheduled_emails")
    .select("*, gmail_accounts(tokens_encrypted)")
    .eq("status", "pending")
    .lte("send_at", now);

  if (error) {
    console.error("Failed to fetch scheduled emails:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let sent = 0;
  let failed = 0;

  for (const scheduled of pending ?? []) {
    try {
      const tokens = (
        scheduled.gmail_accounts as { tokens_encrypted?: string } | null
      )?.tokens_encrypted;

      if (!tokens) {
        await supabase
          .from("scheduled_emails")
          .update({
            status: "failed",
            error_message: "No Gmail account tokens available",
          })
          .eq("id", scheduled.id);
        failed++;
        continue;
      }

      let trackingUrl: string | undefined;
      if (scheduled.tracking_id) {
        trackingUrl = `${getEnv("SUPABASE_URL")}/functions/v1/api/track/pixel/${scheduled.tracking_id}.gif`;
      }

      await sendEmail(
        tokens,
        scheduled.to_addresses as string[],
        scheduled.subject as string,
        scheduled.body_html as string,
        scheduled.in_reply_to as string | undefined,
        scheduled.thread_id as string | undefined,
        trackingUrl,
      );

      await supabase
        .from("scheduled_emails")
        .update({ status: "sent" })
        .eq("id", scheduled.id);

      console.log(`Sent scheduled email ${scheduled.id}`);
      sent++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Failed to send scheduled email ${scheduled.id}:`, msg);
      await supabase
        .from("scheduled_emails")
        .update({
          status: "failed",
          error_message: msg.slice(0, 500),
        })
        .eq("id", scheduled.id);
      failed++;
    }
  }

  return new Response(
    JSON.stringify({ processed: sent + failed, sent, failed }),
    { headers: { "Content-Type": "application/json" } },
  );
});
