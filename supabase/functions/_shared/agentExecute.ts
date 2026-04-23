/**
 * Execute an approved Solve-Everything plan.
 *
 * Takes a session id + a selection of approved action ids (with optional
 * edits the user made in the review UI) and runs each action against the
 * appropriate backend:
 *   - reply     -> /send-email flow (Gmail) OR draft_emails row
 *   - todo      -> todos row
 *   - meeting   -> meetings row + Google Calendar event
 *   - archive   -> emails.is_archived update (per id)
 *
 * Results are written back to agent_sessions.results keyed by action id:
 *   { status: 'success' | 'error', info?: string, error?: string }
 */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { sendEmail } from "./gmail.ts";
import { fernetDecrypt } from "./fernet.ts";

function getEnv(key: string): string {
  return (
    (
      Deno as unknown as { env: { get(k: string): string | undefined } }
    ).env.get(key) ?? ""
  );
}

interface ApprovedAction {
  id: string;
  type: "reply" | "todo" | "meeting" | "archive";
  payload: Record<string, unknown> & { resolve_only?: boolean };
  reasoning?: string;
  linked_email_id?: string;
}

async function getCalendarAccessToken(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data: accounts } = await supabase
    .from("gmail_accounts")
    .select("id, tokens_encrypted")
    .eq("user_id", userId)
    .eq("is_active", true)
    .limit(1);
  if (!accounts?.length) return null;
  const key = getEnv("TOKEN_ENCRYPTION_KEY");
  let tokens: { token: string; refresh_token?: string; expiry?: string };
  if (key) {
    const decrypted = await fernetDecrypt(key, accounts[0].tokens_encrypted);
    tokens = JSON.parse(decrypted);
  } else {
    tokens = JSON.parse(accounts[0].tokens_encrypted);
  }
  if (
    tokens.expiry &&
    new Date(tokens.expiry) < new Date(Date.now() + 60_000) &&
    tokens.refresh_token
  ) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: getEnv("GOOGLE_CLIENT_ID"),
        client_secret: getEnv("GOOGLE_CLIENT_SECRET"),
        refresh_token: tokens.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    if (res.ok) {
      const data = await res.json();
      tokens.token = data.access_token;
    }
  }
  return tokens.token;
}

function plainToHtml(body: string): string {
  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split(/\n/)
    .map((line) => `<p>${line || "&nbsp;"}</p>`)
    .join("");
}

export async function executeAgentPlan(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  approved: ApprovedAction[],
  userTimezone = "UTC",
): Promise<
  Record<string, { status: "success" | "error"; info?: string; error?: string }>
> {
  const results: Record<
    string,
    { status: "success" | "error"; info?: string; error?: string }
  > = {};

  await supabase
    .from("agent_sessions")
    .update({ status: "executing" })
    .eq("id", sessionId);

  for (const action of approved) {
    try {
      if (action.type === "reply") {
        const to = String(action.payload.to ?? "").trim();
        const subject = String(action.payload.subject ?? "").trim();
        const body = String(action.payload.body ?? "").trim();
        const resolveOnly = action.payload.resolve_only === true;
        // Resolve-only: mark the source email handled without sending or
        // drafting anything. Lets the user answer a reply-confirm question
        // with "yes, no email needed".
        if (resolveOnly) {
          if (action.linked_email_id) {
            await supabase
              .from("emails")
              .update({ is_read: true })
              .eq("id", action.linked_email_id)
              .eq("user_id", userId);
          }
          results[action.id] = {
            status: "success",
            info: `Marked resolved without replying${to ? ` (would have gone to ${to})` : ""}`,
          };
          continue;
        }
        // Default to sending when send_now is undefined/null/true; only fall
        // back to draft when explicitly false.
        const sendNow = action.payload.send_now !== false;
        if (!to || !subject || !body) {
          throw new Error("Reply missing to/subject/body");
        }
        if (sendNow) {
          // Look up the Gmail account and send.
          const { data: accounts } = await supabase
            .from("gmail_accounts")
            .select("id, tokens_encrypted")
            .eq("user_id", userId)
            .eq("is_active", true)
            .limit(1);
          const account = accounts?.[0];
          if (!account) throw new Error("No Gmail account connected");
          const result = await sendEmail(
            account.tokens_encrypted as string,
            [to],
            subject,
            plainToHtml(body),
          );
          await supabase.from("emails").insert({
            user_id: userId,
            gmail_id: result.id,
            gmail_account_id: account.id,
            subject,
            recipients: to,
            body_html: plainToHtml(body),
            received_at: new Date().toISOString(),
            is_read: true,
            label_ids: ["SENT"],
          });
          results[action.id] = {
            status: "success",
            info: `Sent reply to ${to}`,
          };
        } else {
          // Save as draft (schema uses to_addresses array)
          await supabase.from("draft_emails").insert({
            user_id: userId,
            to_addresses: [to],
            subject,
            body_html: plainToHtml(body),
          });
          results[action.id] = {
            status: "success",
            info: `Draft saved for ${to}`,
          };
        }
      } else if (action.type === "todo") {
        const title = String(action.payload.title ?? "").trim();
        if (!title) throw new Error("Todo missing title");
        // todos schema: { user_id, email_id?, text, is_completed, source }
        const row: Record<string, unknown> = {
          user_id: userId,
          text: action.payload.due
            ? `${title} (due ${action.payload.due})`
            : title,
          is_completed: false,
          source: "solver",
        };
        if (action.linked_email_id) {
          row.email_id = action.linked_email_id;
        }
        await supabase.from("todos").insert(row);
        results[action.id] = {
          status: "success",
          info: `Added todo "${title}"`,
        };
      } else if (action.type === "meeting") {
        const title = String(action.payload.meeting_title ?? "").trim();
        const startIso = String(action.payload.start_iso ?? "").trim();
        const durationMins = Number(action.payload.duration_mins ?? 30);
        const attendees = (action.payload.attendees as string[]) ?? [];
        if (!title || !startIso) {
          throw new Error("Meeting missing title or start_iso");
        }
        const startMs = new Date(startIso).getTime();
        if (Number.isNaN(startMs)) throw new Error("Invalid start time");
        const endIso = new Date(startMs + durationMins * 60_000).toISOString();

        // Insert local row so it appears immediately.
        const { data: meetingRow } = await supabase
          .from("meetings")
          .insert({
            user_id: userId,
            title,
            start_time: new Date(startMs).toISOString(),
            end_time: endIso,
            attendees,
            status: "confirmed",
          })
          .select("id")
          .single();

        // Create Google Calendar event (best effort).
        try {
          const accessToken = await getCalendarAccessToken(supabase, userId);
          if (accessToken) {
            const { data: calProfile } = await supabase
              .from("profiles")
              .select("calendar_send_invites")
              .eq("id", userId)
              .single();
            const sendUpdates =
              calProfile?.calendar_send_invites === false ? "none" : "all";
            await fetch(
              `https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=${sendUpdates}`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  summary: title,
                  description: (action.reasoning as string) ?? "",
                  start: { dateTime: startIso, timeZone: userTimezone },
                  end: {
                    dateTime: new Date(startMs + durationMins * 60_000)
                      .toISOString()
                      .replace("Z", ""),
                    timeZone: userTimezone,
                  },
                  attendees: attendees.map((email) => ({ email })),
                }),
              },
            );
          }
        } catch (calErr) {
          console.warn("[agentExecute] calendar create failed:", calErr);
        }

        results[action.id] = {
          status: "success",
          info: `Scheduled "${title}" at ${startIso}${meetingRow ? "" : " (local only)"}`,
        };
      } else if (action.type === "archive") {
        const ids = ((action.payload.email_ids as string[]) ?? []).filter(
          Boolean,
        );
        if (!ids.length) throw new Error("Archive action has no email_ids");
        await supabase
          .from("emails")
          .update({ is_archived: true })
          .in("id", ids)
          .eq("user_id", userId);
        results[action.id] = {
          status: "success",
          info: `Archived ${ids.length} email${ids.length === 1 ? "" : "s"}`,
        };
      } else {
        throw new Error(`Unknown action type: ${action.type}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results[action.id] = { status: "error", error: msg };
    }
  }

  await supabase
    .from("agent_sessions")
    .update({ status: "done", results })
    .eq("id", sessionId);

  return results;
}
