/**
 * RuneMail — Supabase Edge Function: api
 *
 * Single function that handles all worker routes. Deployed with --no-verify-jwt
 * so the tracking pixel works without auth; all other routes enforce auth manually.
 *
 * Routes (all under /functions/v1/api):
 *   POST /fetch-emails        Fetch & AI-process new Gmail messages
 *   POST /send-email          Send an email immediately
 *   POST /draft-email         AI-generate a compose/reply draft (from ComposeModal)
 *   POST /generate-draft      AI-generate a reply draft (legacy, requires email_id)
 *   POST /analyze-inbox       Re-analyze unprocessed or all emails
 *   POST /learn-style         Analyze sent emails to learn writing style
 *   GET  /briefing            Morning AI briefing
 *   GET  /calendar/free-slots Get free calendar slots
 *   POST /calendar/create-event Create a Google Calendar event
 *   POST /zoom/create-meeting Create a Zoom meeting
 *   GET  /track/pixel/:id.gif Read-receipt tracking pixel (no auth)
 *   POST /chat                Personal assistant chat with tool calling
 *   POST /push/subscribe      Register a Web Push subscription
 *   DELETE /push/subscribe    Remove a Web Push subscription
 *   POST /gmail/webhook       Gmail Pub/Sub push endpoint (no auth)
 */

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  fetchEmailsByHistoryId,
  fetchEmails,
  fetchSentEmails,
  fetchAttachment,
  sendEmail,
  setupGmailWatch,
  type EmailData,
} from "../_shared/gmail.ts";
import {
  analyzeWritingStyle,
  chatWithAssistant,
  extractEntities,
  extractTodos,
  generateBriefing,
  updateBriefing,
  composeDraft,
  generateDraft,
  processFullEmail,
  suggestTodosFromEmails,
  type ChatContext,
} from "../_shared/ai.ts";
// @ts-ignore - npm package, no Deno types needed
import webpush from "npm:web-push";

// 1x1 transparent GIF
const PIXEL_GIF = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
  0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00,
  0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02,
  0x44, 0x01, 0x00, 0x3b,
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getEnv(key: string): string {
  return (
    (
      Deno as unknown as { env: { get(k: string): string | undefined } }
    ).env.get(key) ?? ""
  );
}

// ── Web Push (VAPID) setup ─────────────────────────────────────────────────
const VAPID_PRIVATE_KEY = getEnv("VAPID_PRIVATE_KEY");
const VAPID_PUBLIC_KEY = getEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
if (VAPID_PRIVATE_KEY && VAPID_PUBLIC_KEY) {
  webpush.setVapidDetails(
    "mailto:support@runemail.app",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  );
}

function isWithinWorkingHours(wh: { start?: string; end?: string; days?: number[]; timezone?: string; dnd?: boolean } | null): boolean {
  if (!wh || !wh.dnd) return true; // DND not enabled; always send
  const tz = wh.timezone;
  let dayOfWeek: number;
  let currentMinutes: number;
  if (tz) {
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
    const parts = fmt.formatToParts(new Date());
    const dayStr = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
    const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    dayOfWeek = dayMap[dayStr] ?? new Date().getDay();
    currentMinutes = hour * 60 + minute;
  } else {
    const now = new Date();
    dayOfWeek = now.getDay();
    currentMinutes = now.getHours() * 60 + now.getMinutes();
  }
  const days = wh.days || [1, 2, 3, 4, 5];
  if (!days.includes(dayOfWeek)) return false;
  const [startH, startM] = (wh.start || "09:00").split(":").map(Number);
  const [endH, endM] = (wh.end || "17:00").split(":").map(Number);
  return currentMinutes >= startH * 60 + startM && currentMinutes < endH * 60 + endM;
}

async function sendPushNotification(
  userId: string,
  supabase: SupabaseClient,
  payload: { title: string; body: string; tag?: string; data?: Record<string, unknown> },
): Promise<void> {
  if (!VAPID_PRIVATE_KEY || !VAPID_PUBLIC_KEY) return;

  // Respect Do Not Disturb: skip if outside working hours and DND is enabled
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("working_hours")
    .eq("id", userId)
    .single();
  const wh = profileRow?.working_hours as { start?: string; end?: string; days?: number[]; timezone?: string; dnd?: boolean } | null;
  if (!isWithinWorkingHours(wh)) return;

  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (!subs?.length) return;
  await Promise.allSettled(
    subs.map(async (sub: { endpoint: string; p256dh: string; auth: string }) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        );
      } catch (err) {
        // Remove expired or invalid subscriptions (410 Gone, 404 Not Found)
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 410 || code === 404) {
          await supabase.from("push_subscriptions").delete()
            .eq("endpoint", sub.endpoint).eq("user_id", userId);
        }
      }
    }),
  );
}

function json(
  data: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}

async function getUserId(req: Request): Promise<string> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    throw Object.assign(new Error("Missing authorization token"), {
      status: 401,
    });
  }
  // Use the Supabase-recommended pattern for edge functions: create a client
  // with the user's auth token in global headers and call getUser() without args.
  // This is more reliable than getUser(jwt) on a service-role client.
  const authClient = createClient(
    getEnv("SUPABASE_URL"),
    getEnv("SUPABASE_ANON_KEY"),
    {
      global: { headers: { Authorization: auth } },
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser();
  if (error || !user) {
    console.error("[auth] getUser failed:", error?.message ?? "(no error)");
    throw Object.assign(new Error("Invalid or expired token"), { status: 401 });
  }
  return user.id;
}

// Token refresh lock to prevent parallel refreshes for the same user
const tokenRefreshLocks = new Map<string, Promise<string | null>>();

// Google Calendar helpers
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

  const { fernetDecrypt } = await import("../_shared/fernet.ts");
  const { encryptTokens } = await import("../_shared/gmail.ts");
  const key = getEnv("TOKEN_ENCRYPTION_KEY");
  let tokens: { token: string; refresh_token?: string; expiry?: string };
  if (key) {
    const decrypted = await fernetDecrypt(key, accounts[0].tokens_encrypted);
    tokens = JSON.parse(decrypted);
  } else {
    tokens = JSON.parse(accounts[0].tokens_encrypted);
  }

  // Check expiry and refresh if needed
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
      tokens.expiry = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString();
      // Save refreshed token back to DB so the next call doesn't need to refresh again
      try {
        const newEncrypted = await encryptTokens(tokens);
        await supabase
          .from("gmail_accounts")
          .update({ tokens_encrypted: newEncrypted })
          .eq("id", accounts[0].id);
      } catch (err) { console.error("[getCalendarAccessToken] save refreshed token:", err); }
    } else {
      // Refresh failed; return null so the caller can surface a proper error
      console.error("[getCalendarAccessToken] token refresh failed:", await res.text());
      return null;
    }
  }

  return tokens.token;
}

// Lock-guarded wrapper to prevent parallel token refreshes for the same user
async function getCalendarAccessTokenSafe(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const lockKey = `cal_token_${userId}`;
  const existing = tokenRefreshLocks.get(lockKey);
  if (existing) return existing;

  const promise = getCalendarAccessToken(supabase, userId);
  tokenRefreshLocks.set(lockKey, promise);
  try {
    return await promise;
  } finally {
    tokenRefreshLocks.delete(lockKey);
  }
}

// ─── Shared analysis helper ──────────────────────────────────────────────────

/**
 * Analyze all unprocessed emails for a given user.
 * Called from both /analyze-inbox (HTTP) and the Pub/Sub webhook so that
 * webhook-inserted emails are processed immediately without waiting for the
 * next background sync cycle.
 */
async function analyzeEmailsForUser(
  userId: string,
  supabase: SupabaseClient,
): Promise<{ analyzed: number; briefing: unknown }> {
  const { data: alreadyProcessed } = await supabase
    .from("email_processed")
    .select("email_id, quick_actions, category")
    .eq("user_id", userId);

  // Consider an email fully processed only if it has actions OR is a category that legitimately has none.
  // Emails with empty quick_actions on action-required/important categories were likely victims of
  // the token-truncation bug (Qwen3 thinking consuming the 512-token budget) and should be retried.
  const processedIds = (alreadyProcessed || [])
    .filter((p) => {
      const hasActions = Array.isArray(p.quick_actions) && (p.quick_actions as unknown[]).length > 0;
      const noActionsExpected = ["newsletter", "informational"].includes((p.category as string) || "");
      return hasActions || noActionsExpected;
    })
    .map((p) => p.email_id as string);

  let unprocessedQuery = supabase
    .from("emails")
    .select("id, subject, sender, sender_email, recipients, body_text, snippet, label_ids, has_attachments, has_list_unsubscribe, is_reply, reply_to_email, cc_recipients, precedence_header")
    .eq("user_id", userId)
    .not("label_ids", "cs", '{"SENT"}') // skip sent emails — they have no sender and need no AI analysis
    .order("received_at", { ascending: false })
    .limit(100);

  if (processedIds.length > 0) {
    unprocessedQuery = unprocessedQuery.not("id", "in", `(${processedIds.join(",")})`);
  }

  const { data: unprocessed } = await unprocessedQuery;
  const emailsToProcess = unprocessed || [];

  if (emailsToProcess.length === 0) {
    return { analyzed: 0, briefing: null };
  }

  const { data: delegationRules } = await supabase
    .from("delegation_rules")
    .select("pattern, target_email")
    .eq("user_id", userId)
    .eq("is_enabled", true);

  const { data: categoryRules } = await supabase
    .from("category_rules")
    .select("match_type, match_value, category_slug")
    .eq("user_id", userId);

  const { data: userTagRows } = await supabase
    .from("categories")
    .select("slug, description")
    .eq("user_id", userId);
  const userTags: { slug: string; description: string }[] = (userTagRows || []).map((t) => ({
    slug: t.slug as string,
    description: (t.description as string) || "",
  }));

  const MAIN_CATEGORIES = new Set(["important", "action-required", "newsletter", "informational"]);

  const senderEmails = [
    ...new Set(emailsToProcess.map((e) => e.sender_email as string).filter(Boolean)),
  ];
  const senderInteractionMap = new Map<string, number>();
  if (senderEmails.length > 0) {
    const { data: memRows } = await supabase
      .from("email_memory")
      .select("sender_email, interaction_count")
      .eq("user_id", userId)
      .in("sender_email", senderEmails);
    for (const row of memRows ?? []) {
      senderInteractionMap.set(row.sender_email as string, row.interaction_count as number);
    }
  }

  const SAVE_BATCH_SIZE = 5;
  let processedBatch: object[] = [];
  let processed = 0;

  const flushBatch = async () => {
    if (processedBatch.length === 0) return;
    await supabase.from("email_processed").upsert(processedBatch, { onConflict: "email_id" });
    processedBatch = [];
  };

  for (const email of emailsToProcess) {
    try {
      const gmailLabels = (email.label_ids as string[]) ?? [];
      const ccStr = (email.cc_recipients as string) ?? "";
      const signals = {
        gmailLabels,
        hasAttachments: email.has_attachments as boolean,
        isReply: email.is_reply as boolean,
        hasListUnsubscribe: email.has_list_unsubscribe as boolean,
        replyToEmail: email.reply_to_email as string | undefined,
        ccRecipients: ccStr || undefined,
        precedenceHeader: email.precedence_header as string | undefined,
        senderInteractionCount: senderInteractionMap.get(email.sender_email as string),
      };

      const result = await processFullEmail(
        email.subject || "",
        email.sender || "",
        email.body_text || email.snippet || "",
        signals,
        userTags.length > 0 ? userTags : undefined,
      );

      const delegationActions: { label: string; action: string; target: string }[] = [];
      if (delegationRules?.length) {
        const searchText =
          `${email.subject || ""} ${email.body_text || email.snippet || ""}`.toLowerCase();
        for (const rule of delegationRules) {
          if (searchText.includes((rule.pattern as string).toLowerCase())) {
            delegationActions.push({
              label: `Delegate to ${rule.target_email}`,
              action: "delegate",
              target: rule.target_email as string,
            });
          }
        }
      }

      let finalCategory = result.category;
      // Start with AI-assigned tags, then merge in rule-based tags
      const extraLabels: string[] = [...(result.tags || [])];
      if (categoryRules?.length) {
        const subjectLc = (email.subject || "").toLowerCase();
        const senderLc = (email.sender || "").toLowerCase();
        const bodyLc = (email.body_text || email.snippet || "").toLowerCase();
        for (const rule of categoryRules) {
          const val = (rule.match_value as string).toLowerCase();
          let matched = false;
          if (rule.match_type === "subject") matched = subjectLc.includes(val);
          else if (rule.match_type === "sender") matched = senderLc.includes(val);
          else if (rule.match_type === "keyword") matched = bodyLc.includes(val);
          if (matched) {
            const slug = rule.category_slug as string;
            if (MAIN_CATEGORIES.has(slug)) {
              finalCategory = slug;
            } else if (!extraLabels.includes(slug)) {
              extraLabels.push(slug);
            }
          }
        }
      }

      processedBatch.push({
        user_id: userId,
        email_id: email.id,
        category: finalCategory,
        summary: result.summary,
        quick_actions: [...(result.quick_actions as object[]), ...delegationActions],
        extra_labels: extraLabels.length > 0 ? extraLabels : null,
      });
      processed++;

      if (processedBatch.length >= SAVE_BATCH_SIZE) {
        await flushBatch();
      }

      if (result.category !== "newsletter") {
        try {
          const entities = await extractEntities(
            email.subject || "",
            email.sender || "",
            email.body_text || email.snippet || "",
          );
          if (entities.length > 0) {
            await supabase.from("knowledge_base").upsert(
              entities.map((entity) => ({
                user_id: userId,
                entity: entity.entity,
                entity_type: entity.entity_type,
                info: entity.info,
                source: "email",
                confidence: 0.8,
              })),
              { onConflict: "user_id,entity,entity_type" },
            );
          }
        } catch (err) {
          console.error("[analyzeEmailsForUser] entity extraction:", err);
        }
      }
    } catch (e) {
      console.error("[analyzeEmailsForUser] failed for email:", (e as Error).message);
      await flushBatch().catch(() => {});
    }
  }

  await flushBatch();

  return { analyzed: processed, briefing: null };
}

// ─── Main handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  const corsHeaders = getCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const rawPathname = url.pathname;
  // Supabase gateway may strip /functions/v1 prefix; handle both forms
  const path = rawPathname
    .replace(/^\/functions\/v1\/api/, "")
    .replace(/^\/api/, "") || "/";

  const supabase = createClient(
    getEnv("SUPABASE_URL"),
    getEnv("SUPABASE_SERVICE_ROLE_KEY"),
  );

  try {
    // ── GET /health — NO auth required ───────────────────────────────────
    if (path === "/health" && req.method === "GET") {
      const checks: Record<string, string> = { status: "ok" };
      try {
        const { error } = await supabase.from("profiles").select("id").limit(1);
        checks.database = error ? "error" : "ok";
      } catch {
        checks.database = "error";
      }
      checks.gemini_key = getEnv("GEMINI_API_KEY") ? "set" : "missing";
      checks.cerebras_key = getEnv("CEREBRAS_API_KEY") ? "set" : "missing";
      const allOk = checks.database === "ok" && checks.gemini_key === "set";
      return json(checks, allOk ? 200 : 503, corsHeaders);
    }

    // ── Tracking pixel — NO auth required ──────────────────────────────────
    if (req.method === "GET" && path.startsWith("/track/pixel/")) {
      const trackingId = path.replace("/track/pixel/", "").replace(".gif", "");

      if (UUID_RE.test(trackingId)) {
        try {
          const { data: receipt } = await supabase
            .from("read_receipts")
            .select("*")
            .eq("tracking_id", trackingId)
            .single();

          if (receipt) {
            const userAgent = req.headers.get("User-Agent") ?? "";
            // Skip known automated crawlers and scanners. Note: googleimageproxy is
            // intentionally NOT blocked here because it fires when a Gmail user opens
            // the email, which is a real open event.
            const isBot = /adsbot|googlebot|bot\/|crawler|spider|preview|prefetch/i.test(userAgent);
            // Skip opens within 5 seconds of creation to catch sending-side auto-loads.
            const createdAt = new Date(receipt.created_at as string).getTime();
            const isTooSoon = Date.now() - createdAt < 5_000;

            if (!isBot && !isTooSoon) {
              const now = new Date().toISOString();
              const opens = (receipt.opens ?? []) as object[];
              opens.push({
                timestamp: now,
                ip:
                  req.headers.get("CF-Connecting-IP") ??
                  req.headers.get("X-Forwarded-For") ??
                  "unknown",
                user_agent: userAgent,
              });
              const update: Record<string, unknown> = {
                open_count: (receipt.open_count as number) + 1,
                last_opened_at: now,
                opens,
              };
              if (!receipt.first_opened_at) update.first_opened_at = now;
              const { error: updateErr } = await supabase
                .from("read_receipts")
                .update(update)
                .eq("id", receipt.id);
              // Retry once on failure
              if (updateErr) {
                console.error("[track/pixel] First update failed, retrying:", updateErr.message);
                await new Promise((r) => setTimeout(r, 100));
                await supabase
                  .from("read_receipts")
                  .update(update)
                  .eq("id", receipt.id);
              }
            }
          }
        } catch (err) {
          console.error("[track/pixel] Error:", err);
        }
      }

      return new Response(PIXEL_GIF, {
        headers: {
          "Content-Type": "image/gif",
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          ...corsHeaders,
        },
      });
    }

    // ── POST /gmail/webhook — Pub/Sub push endpoint (no auth) ──────────────
    if (path === "/gmail/webhook" && req.method === "POST") {
      const token = url.searchParams.get("token");
      const expectedToken = getEnv("PUBSUB_VERIFICATION_TOKEN");
      if (!expectedToken || token !== expectedToken) {
        return new Response("Forbidden", { status: 403 });
      }

      let body: { message?: { data?: string } };
      try {
        body = await req.json();
      } catch {
        return new Response("OK", { status: 200 }); // malformed — ACK to stop retries
      }

      const rawData = body?.message?.data;
      if (!rawData) return new Response("OK", { status: 200 });

      const processWebhook = async () => {
        try {
          const decoded = atob(rawData);
          const { emailAddress, historyId: notificationHistoryId } = JSON.parse(decoded) as {
            emailAddress: string;
            historyId: string;
          };

          const { data: account } = await supabase
            .from("gmail_accounts")
            .select("id, user_id, tokens_encrypted, history_id")
            .eq("gmail_address", emailAddress)
            .eq("is_active", true)
            .maybeSingle();

          if (!account) {
            console.warn("[webhook] No account found for", emailAddress);
            return;
          }

          const storedHistoryId = (account.history_id as string | null) ?? notificationHistoryId;

          let { emails: newEmails, newHistoryId, tooOld } = await fetchEmailsByHistoryId(
            account.tokens_encrypted as string,
            storedHistoryId,
            supabase,
            account.id as string,
          );

          if (tooOld) {
            console.warn("[webhook] historyId stale for", emailAddress, "— falling back to latest 15");
            await supabase
              .from("gmail_accounts")
              .update({ history_id: notificationHistoryId })
              .eq("id", account.id);
            // Fall back to recent fetch instead of dropping the emails
            const fallback = await fetchEmails(
              account.tokens_encrypted as string,
              15,
              supabase,
              account.id as string,
              false,
            );
            newEmails = fallback.emails;
            newHistoryId = notificationHistoryId;
          }

          const userId = account.user_id as string;
          for (const emailData of newEmails) {
            const { data: existing } = await supabase
              .from("emails")
              .select("id")
              .eq("user_id", userId)
              .eq("gmail_id", emailData.gmail_id)
              .maybeSingle();
            if (existing) continue;

            await supabase.from("emails").insert({
              user_id: userId,
              gmail_id: emailData.gmail_id,
              thread_id: emailData.thread_id,
              gmail_account_id: account.id,
              subject: emailData.subject,
              sender: emailData.sender,
              sender_email: emailData.sender_email,
              recipients: emailData.recipients,
              snippet: emailData.snippet,
              body_text: emailData.body_text,
              body_html: emailData.body_html,
              received_at: emailData.received_at,
              is_read: emailData.is_read,
              label_ids: emailData.label_ids,
              has_attachments: emailData.has_attachments,
              attachments: emailData.attachments ?? [],
              has_list_unsubscribe: emailData.has_list_unsubscribe,
              is_reply: emailData.is_reply,
              reply_to_email: emailData.reply_to_email,
              cc_recipients: emailData.cc_recipients,
              precedence_header: emailData.precedence_header,
            });
          }

          if (newHistoryId) {
            await supabase
              .from("gmail_accounts")
              .update({ history_id: newHistoryId })
              .eq("id", account.id);
          }

          if (newEmails.length > 0) {
            // Check user's AI mode and notification preferences
            const { data: userProfile } = await supabase
              .from("profiles")
              .select("ai_mode, notification_level, notification_preview")
              .eq("id", userId)
              .maybeSingle();
            const aiMode = (userProfile?.ai_mode as string) || "cloud";
            const notifLevel = (userProfile?.notification_level as string) || "important";
            const notifPreview = (userProfile?.notification_preview as boolean) !== false;

            if (aiMode !== "local") {
              // cloud or hybrid: run AI analysis on the server immediately
              await analyzeEmailsForUser(userId, supabase);

              if (notifLevel !== "none") {
              // Determine which emails warrant a notification based on user preference
              const gmailIds = newEmails.map((e) => e.gmail_id);
              const { data: newEmailRows } = await supabase
                .from("emails")
                .select("id, subject, sender")
                .eq("user_id", userId)
                .in("gmail_id", gmailIds);
              const newEmailIdSet = new Set(
                (newEmailRows ?? []).map((e: { id: string }) => e.id),
              );

              if (notifLevel === "all") {
                // Notify for every new email
                const first = newEmails[0];
                const emailRow = (newEmailRows ?? []).find(
                  (e: { gmail_id: string }) => e.gmail_id === first.gmail_id,
                ) as { subject: string; sender: string } | undefined;
                const title = newEmails.length === 1 ? "New email" : `${newEmails.length} new emails`;
                const body = notifPreview
                  ? (newEmails.length === 1 && emailRow ? `${emailRow.sender}: ${emailRow.subject}` : `Latest from ${first.sender}`)
                  : "You have new email";
                await sendPushNotification(userId, supabase, { title, body, tag: "new-email", data: { view: "inbox" } });
              } else {
              // important: only send for important/action-required
              const { data: processed } = await supabase
                .from("email_processed")
                .select("email_id, category")
                .eq("user_id", userId)
                .in("category", ["important", "action-required"]);
              const importantNew = (processed ?? []).filter(
                (p: { email_id: string }) => newEmailIdSet.has(p.email_id),
              );
              if (importantNew.length > 0) {
                const first = importantNew[0] as { email_id: string; category: string };
                const emailRow = (newEmailRows ?? []).find(
                  (e: { id: string }) => e.id === first.email_id,
                ) as { subject: string; sender: string } | undefined;
                const body = notifPreview
                  ? (emailRow ? `${emailRow.sender}: ${emailRow.subject}` : "New email")
                  : (first.category === "action-required" ? "You have an action-required email" : "You have an important email");
                await sendPushNotification(userId, supabase, {
                  title: first.category === "action-required" ? "Action required" : "Important email",
                  body,
                  tag: "new-email",
                  data: { view: "inbox" },
                });
              }
              } // closes else (important path)
              } // closes if (notifLevel !== "none")
            } else {
              // local mode: no server-side AI, so importance cannot be determined here.
              // Treat "important" as "all" — the user processes locally when they open the app.
              if (notifLevel !== "none") {
              const first = newEmails[0];
              const body = notifPreview
                ? (newEmails.length === 1 ? `${first.sender}: ${first.subject}` : `Latest from ${first.sender}`)
                : "You have new email";
              await sendPushNotification(userId, supabase, {
                title: newEmails.length === 1 ? "New email" : `${newEmails.length} new emails`,
                body,
                tag: "new-email",
                data: { view: "inbox" },
              });
              } // closes if (notifLevel !== "none")
            }
          }
        } catch (err) {
          console.error("[webhook] processing error:", err);
        }
      };

      // Fire-and-forget so Pub/Sub gets 200 immediately
      try {
        // deno-lint-ignore no-explicit-any
        (globalThis as any)[Symbol.for("EdgeRuntime")]?.waitUntil(processWebhook());
      } catch {
        await processWebhook();
      }

      return new Response("OK", { status: 200 });
    }

    // ── All remaining routes require auth ──────────────────────────────────
    const userId = await getUserId(req);

    // ── POST /fetch-emails ─────────────────────────────────────────────────
    if (path === "/fetch-emails" && req.method === "POST") {
      let body: { initial?: boolean } = {};
      try { body = await req.json(); } catch { /* empty body is fine */ }
      const isInitialFetch = body.initial === true;

      const { data: accounts } = await supabase
        .from("gmail_accounts")
        .select("*")
        .eq("user_id", userId)
        .eq("is_active", true);

      if (!accounts?.length) {
        return json({ error: "No Gmail account connected" }, 400, corsHeaders);
      }

      const allNew: string[] = [];

      for (const account of accounts) {
        try {
          // Renew Gmail push watch if expiring within 24 hours or never set
          const watchExpiry = account.watch_expiry
            ? new Date(account.watch_expiry as string)
            : null;
          const needsRenewal =
            !watchExpiry ||
            watchExpiry < new Date(Date.now() + 24 * 60 * 60 * 1000);
          if (needsRenewal) {
            try {
              await setupGmailWatch(
                account.tokens_encrypted as string,
                supabase,
                account.id as string,
              );
            } catch (watchErr) {
              console.warn("[fetch-emails] watch renewal failed:", watchErr);
            }
          }

          // Initial fetch: grab the 15 most recent inbox emails.
          // Non-initial refresh: use Gmail history API to fetch only NEW emails
          // since the last sync (stored history_id). Falls back to latest 15 if
          // no history_id is stored yet or the history has expired.
          let rawEmails: EmailData[] = [];
          let updatedEncryptedTokens: string | undefined;

          if (isInitialFetch) {
            const result = await fetchEmails(
              account.tokens_encrypted as string,
              15,
              supabase,
              account.id as string,
              false,
            );
            rawEmails = result.emails;
            updatedEncryptedTokens = result.updatedEncryptedTokens;
          } else {
            const storedHistoryId = account.history_id as string | null;
            if (storedHistoryId) {
              const { emails: histEmails, newHistoryId, tooOld } =
                await fetchEmailsByHistoryId(
                  account.tokens_encrypted as string,
                  storedHistoryId,
                  supabase,
                  account.id as string,
                );
              if (tooOld) {
                // History expired; fall back to recent 15
                const result = await fetchEmails(
                  account.tokens_encrypted as string,
                  15,
                  supabase,
                  account.id as string,
                  false,
                );
                rawEmails = result.emails;
                updatedEncryptedTokens = result.updatedEncryptedTokens;
              } else {
                rawEmails = histEmails;
                if (newHistoryId) {
                  await supabase
                    .from("gmail_accounts")
                    .update({ history_id: newHistoryId })
                    .eq("id", account.id);
                }
              }
            } else {
              // No history_id yet; fetch latest 15
              const result = await fetchEmails(
                account.tokens_encrypted as string,
                15,
                supabase,
                account.id as string,
                false,
              );
              rawEmails = result.emails;
              updatedEncryptedTokens = result.updatedEncryptedTokens;
            }
          }

          if (updatedEncryptedTokens) {
            await supabase
              .from("gmail_accounts")
              .update({ tokens_encrypted: updatedEncryptedTokens })
              .eq("id", account.id);
          }

          // Batch-check which gmail_ids already exist (1 query instead of N)
          const incomingGmailIds = rawEmails.map((e) => e.gmail_id);
          const { data: existingEmails } = await supabase
            .from("emails")
            .select("gmail_id")
            .eq("user_id", userId)
            .in("gmail_id", incomingGmailIds);
          const existingGmailIds = new Set((existingEmails || []).map((e) => e.gmail_id as string));

          // Track senders for batch memory update (count per sender)
          const senderMap = new Map<string, { sender: string; subject: string; count: number }>();

          for (const emailData of rawEmails) {
            if (existingGmailIds.has(emailData.gmail_id)) continue;

            const { data: inserted } = await supabase
              .from("emails")
              .insert({
                user_id: userId,
                gmail_id: emailData.gmail_id,
                thread_id: emailData.thread_id,
                gmail_account_id: account.id,
                subject: emailData.subject,
                sender: emailData.sender,
                sender_email: emailData.sender_email,
                recipients: emailData.recipients,
                snippet: emailData.snippet,
                body_text: emailData.body_text,
                body_html: emailData.body_html,
                received_at: emailData.received_at,
                is_read: emailData.is_read,
                label_ids: emailData.label_ids,
                has_attachments: emailData.has_attachments,
                attachments: emailData.attachments ?? [],
                has_list_unsubscribe: emailData.has_list_unsubscribe,
                is_reply: emailData.is_reply,
                reply_to_email: emailData.reply_to_email,
                cc_recipients: emailData.cc_recipients,
                precedence_header: emailData.precedence_header,
              })
              .select("id");

            if (!inserted?.length) continue;
            allNew.push(inserted[0].id as string);

            if (emailData.sender_email) {
              const prev = senderMap.get(emailData.sender_email);
              if (prev) {
                prev.count++;
                prev.subject = emailData.subject;
              } else {
                senderMap.set(emailData.sender_email, {
                  sender: emailData.sender,
                  subject: emailData.subject,
                  count: 1,
                });
              }
            }
          }

          // Batch-update sender memory (2 queries instead of 2N)
          if (senderMap.size > 0) {
            try {
              const senderEmails = [...senderMap.keys()];
              const { data: existingMemory } = await supabase
                .from("email_memory")
                .select("sender_email, interaction_count")
                .eq("user_id", userId)
                .in("sender_email", senderEmails);
              const memMap = new Map(
                (existingMemory || []).map((m) => [m.sender_email as string, m.interaction_count as number]),
              );
              const now = new Date().toISOString();
              const upsertRows = [...senderMap.entries()].map(([email, info]) => ({
                user_id: userId,
                sender_email: email,
                sender_name: info.sender,
                last_subject: info.subject,
                last_interaction_at: now,
                interaction_count: (memMap.get(email) ?? 0) + info.count,
              }));
              await supabase.from("email_memory").upsert(upsertRows, { onConflict: "user_id,sender_email" });
            } catch (err) {
              console.error("[analyze-inbox] email_memory upsert:", err);
            }
          }

          // On initial fetch, import recent sent emails into DB for persistent storage
          if (isInitialFetch) {
            try {
              const sentEmails = await fetchSentEmails(account.tokens_encrypted as string, 20);
              const sentGmailIds = sentEmails.map((e) => e.id);
              if (sentGmailIds.length > 0) {
                const { data: existingSent } = await supabase
                  .from("emails")
                  .select("gmail_id")
                  .eq("user_id", userId)
                  .in("gmail_id", sentGmailIds);
                const existingSentIds = new Set((existingSent || []).map((e) => e.gmail_id as string));
                for (const sent of sentEmails) {
                  if (existingSentIds.has(sent.id)) continue;
                  const sentDate = new Date(sent.date);
                  await supabase.from("emails").insert({
                    user_id: userId,
                    gmail_id: sent.id,
                    gmail_account_id: account.id,
                    subject: sent.subject,
                    recipients: sent.to,
                    body_html: sent.body_html,
                    body_text: sent.body,
                    snippet: sent.snippet,
                    received_at: isNaN(sentDate.getTime()) ? new Date().toISOString() : sentDate.toISOString(),
                    is_read: true,
                    label_ids: ["SENT"],
                    has_attachments: sent.has_attachments ?? false,
                    attachments: sent.attachments ?? [],
                  });
                }
              }
            } catch (e) {
              console.warn("[fetch-emails] sent email import failed:", e);
            }
          }
        } catch (e) {
          console.error(`Fetch failed for account ${account.id}:`, e);
        }
      }

      return json(
        { fetched: allNew.length, email_ids: allNew },
        200,
        corsHeaders,
      );
    }

    // ── POST /analyze-inbox ─────────────────────────────────────────────────
    if (path === "/analyze-inbox" && req.method === "POST") {
      const result = await analyzeEmailsForUser(userId, supabase);
      return json(result, 200, corsHeaders);
    }

    // ── POST /learn-style ───────────────────────────────────────────────────
    if (path === "/learn-style" && req.method === "POST") {
      const { data: accounts } = await supabase
        .from("gmail_accounts")
        .select("*")
        .eq("user_id", userId)
        .eq("is_active", true)
        .limit(1);

      if (!accounts?.length) {
        return json({ error: "No Gmail account connected" }, 400, corsHeaders);
      }

      const sent = await fetchSentEmails(
        accounts[0].tokens_encrypted as string,
        15,
      );

      if (sent.length < 3) {
        return json(
          { error: "Need at least 3 sent emails to analyze" },
          400,
          corsHeaders,
        );
      }

      const emailsText = sent
        .map((e) => `Subject: ${e.subject}\nTo: ${e.to}\n\n${(e.body || e.snippet || "").slice(0, 600)}`)
        .join("\n---\n");

      const style = await analyzeWritingStyle(emailsText);

      await supabase.from("style_profiles").upsert(
        {
          user_id: userId,
          greeting_style: style.greeting_style,
          closing_style: style.closing_style,
          tone: style.tone,
          avg_length: style.avg_length,
          sample_count: sent.length,
          last_learned_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );

      return json(
        { learned: true, sample_count: sent.length, style },
        200,
        corsHeaders,
      );
    }

    // ── POST /send-email ───────────────────────────────────────────────────
    if (path === "/send-email" && req.method === "POST") {
      const body = await req.json();

      // Input validation
      if (!body.to || !Array.isArray(body.to) || body.to.length === 0) {
        return json({ error: "to[] is required and must be a non-empty array" }, 400, corsHeaders);
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      for (const addr of body.to) {
        if (typeof addr !== "string" || !emailRegex.test(addr)) {
          return json({ error: `Invalid email address: ${addr}` }, 400, corsHeaders);
        }
      }
      if (!body.subject && !body.body_html) {
        return json({ error: "subject or body_html is required" }, 400, corsHeaders);
      }
      if (body.body_html && typeof body.body_html === "string" && body.body_html.length > 25 * 1024 * 1024) {
        return json({ error: "Email body exceeds 25 MB limit" }, 413, corsHeaders);
      }

      // Pick the right Gmail account: prefer explicit account_id, then
      // match by gmail_address (for replies), then fall back to first account.
      let accountQuery = supabase
        .from("gmail_accounts")
        .select("*")
        .eq("user_id", userId)
        .eq("is_active", true);

      if (body.gmail_account_id) {
        accountQuery = accountQuery.eq("id", body.gmail_account_id);
      } else if (body.from_address) {
        accountQuery = accountQuery.eq("gmail_address", body.from_address);
      }

      const { data: accounts } = await accountQuery.limit(1);

      // If specific account not found, fall back to any active account
      const { data: fallbackAccounts } = !accounts?.length
        ? await supabase.from("gmail_accounts").select("*").eq("user_id", userId).eq("is_active", true).limit(1)
        : { data: accounts };

      const account = (accounts?.length ? accounts : fallbackAccounts)?.[0];
      if (!account) {
        return json({ error: "No Gmail account connected" }, 400, corsHeaders);
      }

      let trackingId: string | null = null;
      let trackingUrl: string | null = null;

      if (body.track) {
        trackingId = crypto.randomUUID();
        trackingUrl = `${getEnv("SUPABASE_URL")}/functions/v1/api/track/pixel/${trackingId}.gif`;
        await supabase.from("read_receipts").insert({
          user_id: userId,
          tracking_id: trackingId,
          recipient_email: (body.to as string[])?.[0] ?? "",
          subject: body.subject ?? "",
        });
      }

      const result = await sendEmail(
        account.tokens_encrypted as string,
        body.to ?? [],
        body.subject ?? "",
        body.body_html ?? "",
        body.in_reply_to,
        body.thread_id,
        trackingUrl ?? undefined,
        body.attachments ?? undefined,
      );

      // Persist sent email to DB so SentView reads from local storage
      try {
        await supabase.from("emails").insert({
          user_id: userId,
          gmail_id: result.id,
          gmail_account_id: account.id,
          subject: body.subject ?? "",
          recipients: (body.to as string[]).join(", "),
          body_html: body.body_html ?? "",
          received_at: new Date().toISOString(),
          is_read: true,
          label_ids: ["SENT"],
        });
      } catch (e) {
        console.warn("[send-email] failed to save to emails table:", e);
      }

      return json(
        { sent: true, message_id: result.id, tracking_id: trackingId },
        200,
        corsHeaders,
      );
    }

    // ── POST /draft-email ──────────────────────────────────────────────────
    // Compose-from-scratch or reply draft. Used by ComposeModal.
    if (path === "/draft-email" && req.method === "POST") {
      const body = await req.json();

      // Fetch sender's display name
      let senderName: string = body.senderName || "";
      if (!senderName) {
        const { data: profileRow } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("id", userId)
          .single();
        senderName = profileRow?.display_name || "";
      }

      // Parse recipient name from "Name <email>" or bare email
      const toRaw: string = body.to || "";
      const angleMatch = toRaw.match(/^(.*?)<[^>]+>\s*$/);
      const recipientName = angleMatch
        ? angleMatch[1].trim().replace(/^"|"$/g, "").trim()
        : "";

      // Extract recipient email
      const emailMatch = toRaw.match(/<([^>]+)>/);
      const recipientEmail = emailMatch ? emailMatch[1].trim() : toRaw.split(/\s/)[0].trim();

      // Fetch style + knowledge context in parallel
      const [
        { data: styleData },
        { data: profileData },
        { data: kbData },
        { data: memData },
      ] = await Promise.all([
        supabase.from("style_profiles").select("*").eq("user_id", userId).limit(1),
        supabase.from("profiles").select("style_notes").eq("id", userId).single(),
        (async () => {
          // Prioritize entries relevant to the recipient, then fill with most-used entries
          const recipientDomain = recipientEmail?.split("@")[1] ?? "";
          const recipientFirstName = recipientName?.split(" ")[0] ?? "";
          const filters: string[] = [];
          if (recipientFirstName.length > 1) filters.push(`entity.ilike.%${recipientFirstName}%`, `info.ilike.%${recipientFirstName}%`);
          if (recipientDomain.length > 3) filters.push(`entity.ilike.%${recipientDomain}%`, `info.ilike.%${recipientDomain}%`);

          const [relevantRes, topRes] = await Promise.all([
            filters.length > 0
              ? supabase.from("knowledge_base").select("entity, entity_type, info").eq("user_id", userId).or(filters.join(",")).limit(10)
              : Promise.resolve({ data: [] as { entity: string; entity_type: string; info: string }[] }),
            supabase.from("knowledge_base").select("entity, entity_type, info").eq("user_id", userId).order("use_count", { ascending: false }).order("updated_at", { ascending: false }).limit(15),
          ]);

          const seen = new Set<string>();
          const merged: { entity: string; entity_type: string; info: string }[] = [];
          for (const row of [...(relevantRes.data ?? []), ...(topRes.data ?? [])]) {
            if (!seen.has(row.entity)) {
              seen.add(row.entity);
              merged.push(row);
            }
            if (merged.length >= 20) break;
          }
          return { data: merged };
        })(),
        recipientEmail
          ? supabase.from("email_memory").select("interaction_count, relationship_notes").eq("user_id", userId).eq("sender_email", recipientEmail).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      let styleContext: string | undefined;
      if (styleData?.[0]) {
        const s = styleData[0];
        styleContext = `Greeting: ${s.greeting_style || "Hi"}. Closing: ${s.closing_style || "Best"}. Tone: ${s.tone || "professional"}.`;
      }
      if (profileData?.style_notes) {
        styleContext = (styleContext || "") + " " + profileData.style_notes;
      }

      let knowledgeContext: string | undefined;
      const kbParts: string[] = [];
      if (kbData?.length) {
        kbParts.push(kbData.map((k: { entity: string; entity_type: string; info: string }) => `${k.entity} (${k.entity_type}): ${k.info}`).join("\n"));
      }
      if (memData) {
        kbParts.push(`Email history with ${recipientEmail}: ${memData.interaction_count} emails exchanged${memData.relationship_notes ? `. ${memData.relationship_notes}` : ""}`);
      }
      if (kbParts.length) knowledgeContext = kbParts.join("\n");

      const draft = await composeDraft({
        intent: body.intent ?? "",
        subject: body.subject ?? "",
        recipientName,
        senderName,
        replyTo: body.replyTo,
        styleContext,
        knowledgeContext,
      });

      return json({ draft }, 200, corsHeaders);
    }

    // ── POST /generate-draft ───────────────────────────────────────────────
    if (path === "/generate-draft" && req.method === "POST") {
      const body = await req.json();

      const { data: emails } = await supabase
        .from("emails")
        .select("*")
        .eq("id", body.email_id ?? "")
        .eq("user_id", userId);

      if (!emails?.length) {
        return json({ error: "Email not found" }, 404, corsHeaders);
      }

      const e = emails[0];
      const emailText = `Subject: ${e.subject}\nFrom: ${e.sender}\n\n${
        e.body_text || e.snippet
      }`;

      // Fetch style + knowledge context in parallel
      const senderName = e.sender?.split("<")[0]?.trim().split(" ")[0]?.toLowerCase() || "";
      const [
        { data: styleData2 },
        { data: profileData2 },
        { data: relevantKb2 },
        { data: recentKb2 },
      ] = await Promise.all([
        supabase.from("style_profiles").select("*").eq("user_id", userId).limit(1),
        supabase.from("profiles").select("style_notes").eq("id", userId).single(),
        senderName
          ? supabase.from("knowledge_base").select("entity, entity_type, info").eq("user_id", userId).ilike("entity", `%${senderName}%`).limit(10)
          : Promise.resolve({ data: [] }),
        supabase.from("knowledge_base").select("entity, entity_type, info").eq("user_id", userId).order("updated_at", { ascending: false }).limit(20),
      ]);
      const kbSeen2 = new Set((relevantKb2 || []).map((k: { entity: string }) => k.entity));
      const kbData2 = [
        ...(relevantKb2 || []),
        ...(recentKb2 || []).filter((k: { entity: string }) => !kbSeen2.has(k.entity)),
      ].slice(0, 20);

      let styleContext: string | undefined;
      if (styleData2?.[0]) {
        const s = styleData2[0];
        styleContext = `Greeting: ${s.greeting_style || "Hi"}. Closing: ${s.closing_style || "Best"}. Tone: ${s.tone || "professional"}.`;
      }
      if (profileData2?.style_notes) {
        styleContext = (styleContext || "") + " " + profileData2.style_notes;
      }

      let knowledgeContext2: string | undefined;
      if (kbData2?.length) {
        knowledgeContext2 = kbData2.map((k: { entity: string; entity_type: string; info: string }) => `${k.entity} (${k.entity_type}): ${k.info}`).join("\n");
      }

      const emailTextWithKnowledge = knowledgeContext2
        ? `${emailText}\n\nBackground context:\n${knowledgeContext2}`
        : emailText;

      const draft = await generateDraft(
        emailTextWithKnowledge,
        body.instructions ?? "",
        styleContext,
      );

      return json({ draft }, 200, corsHeaders);
    }

    // ── GET /briefing ──────────────────────────────────────────────────────
    if (path === "/briefing" && req.method === "GET") {
      try {
        // Query param overrides DB scope preference (used during initial sync)
        const urlObj = new URL(req.url);
        const scopeParam = urlObj.searchParams.get("scope");
        let scope = scopeParam ?? "today_new";
        if (!["today_new", "today_unread", "past_week", "all_recent"].includes(scope)) {
          scope = "today_new";
        }
        if (!scopeParam) {
          const { data: userProfile } = await supabase
            .from("profiles")
            .select("briefing_scope")
            .eq("id", userId)
            .single();
          if (userProfile?.briefing_scope) scope = userProfile.briefing_scope as string;
        }

        let emailsQuery = supabase
          .from("emails")
          .select("id, subject, sender, snippet, received_at, is_read, email_processed(category, summary)")
          .eq("user_id", userId)
          .not("label_ids", "cs", '{"SENT"}') // exclude sent emails — they have null sender and distort briefing
          .order("received_at", { ascending: false });

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

        if (scope === "today_new") {
          emailsQuery = emailsQuery.gte("received_at", todayStart).limit(100);
        } else if (scope === "today_unread") {
          emailsQuery = emailsQuery.gte("received_at", todayStart).eq("is_read", false).limit(100);
        } else if (scope === "past_week") {
          emailsQuery = emailsQuery.gte("received_at", weekAgo).limit(100);
        } else {
          // all_recent: original behavior
          emailsQuery = emailsQuery.limit(40);
        }

        const [
          { data: recent },
          { data: briefingKb },
          { data: briefingMem },
        ] = await Promise.all([
          emailsQuery,
          supabase
            .from("knowledge_base")
            .select("entity, entity_type, info, importance")
            .eq("user_id", userId)
            .in("importance", ["critical", "high"])
            .order("use_count", { ascending: false })
            .order("updated_at", { ascending: false })
            .limit(30),
          supabase
            .from("email_memory")
            .select("sender_email, interaction_count, relationship_notes")
            .eq("user_id", userId)
            .order("interaction_count", { ascending: false })
            .limit(10),
        ]);

        if (!recent?.length) {
          return json(
            {
              executiveSummary: "No recent emails to brief on.",
              topPriority: [],
              deadlines: [],
              waitingForReply: [],
              stats: { total: 0, critical: 0, deadlines: 0, waitingOnYou: 0, filtered: 0 },
            },
            200,
            corsHeaders,
          );
        }

        const emailsText = recent
          .map((e) => {
            const processed = Array.isArray(e.email_processed)
              ? e.email_processed[0]
              : e.email_processed;
            const p = processed as { category?: string; summary?: string } | null;
            return `Subject: ${e.subject}\nFrom: ${e.sender}\nCategory: ${p?.category ?? "unknown"}\nSummary: ${p?.summary ?? e.snippet ?? ""}`;
          })
          .join("\n\n---\n\n");

        const briefingKbParts: string[] = [];
        if (briefingKb?.length) {
          briefingKbParts.push("Known entities:\n" + briefingKb.map((k: { entity: string; entity_type: string; info: string }) => `${k.entity} (${k.entity_type}): ${k.info}`).join("\n"));
        }
        if (briefingMem?.length) {
          briefingKbParts.push("Top contacts:\n" + briefingMem.map((m: { sender_email: string; interaction_count: number; relationship_notes: string | null }) => `${m.sender_email} (${m.interaction_count} emails)${m.relationship_notes ? ` — ${m.relationship_notes}` : ""}`).join("\n"));
        }
        const briefingKnowledgeContext = briefingKbParts.length ? briefingKbParts.join("\n\n") : undefined;

        const briefing = await generateBriefing(emailsText, briefingKnowledgeContext);
        // Ensure new structure is returned; fallback for older AI responses
        const normalized = {
          executiveSummary: (briefing as any).executiveSummary || (briefing as any).summary || "",
          topPriority: (briefing as any).topPriority || [],
          deadlines: (briefing as any).deadlines || [],
          waitingForReply: (briefing as any).waitingForReply || [],
          stats: (briefing as any).stats || { total: recent.length, critical: 0, deadlines: 0, waitingOnYou: 0, filtered: 0 },
        };

        // Attach email_id to each card by matching subject against source emails
        const subjectToId = new Map<string, string>();
        for (const e of recent) {
          subjectToId.set(((e as any).subject ?? "").toLowerCase(), (e as any).id);
        }
        const attachIds = (cards: any[]) => cards.map((card) => {
          const key = (card.subject ?? "").toLowerCase();
          let id = subjectToId.get(key);
          if (!id) {
            for (const [s, eid] of subjectToId) {
              if (s.includes(key) || key.includes(s)) { id = eid; break; }
            }
          }
          return id ? { ...card, email_id: id } : card;
        });
        normalized.topPriority = attachIds(normalized.topPriority);
        normalized.waitingForReply = attachIds(normalized.waitingForReply);

        return json(normalized, 200, corsHeaders);
      } catch (err: any) {
        console.error("Briefing error:", err);
        // Return user-friendly error message
        const errorMessage = err.message === "LLM_API_ERROR"
          ? "AI service temporarily unavailable. Please try again later."
          : "Could not generate briefing. Please try again later.";
        return json(
          { error: errorMessage },
          500,
          corsHeaders,
        );
      }
    }

    // ── POST /briefing/update ── Incremental briefing update ──────────────
    if (path === "/briefing/update" && req.method === "POST") {
      try {
        const body = await req.json();
        const previousBriefing = body.previous_briefing;
        const since = body.since; // ISO timestamp: only consider emails newer than this

        if (!previousBriefing || !since) {
          return json({ error: "previous_briefing and since are required" }, 400, corsHeaders);
        }

        // Fetch only NEW emails since the given timestamp, with their processed data
        const { data: newEmails } = await supabase
          .from("emails")
          .select("id, subject, sender, snippet, email_processed(category, summary)")
          .eq("user_id", userId)
          .gt("received_at", since)
          .order("received_at", { ascending: false })
          .limit(50);

        if (!newEmails?.length) {
          // No new emails at all, return previous briefing unchanged
          return json({ briefing: previousBriefing, updated: false }, 200, corsHeaders);
        }

        // Filter to only briefing-worthy emails (skip newsletters, informational, promotional)
        const SKIP_CATEGORIES = new Set(["newsletter", "informational", "promotional"]);
        const relevant = newEmails.filter((e: any) => {
          const p = Array.isArray(e.email_processed) ? e.email_processed[0] : e.email_processed;
          if (!p) return true; // unprocessed = might be important
          return !SKIP_CATEGORIES.has(p.category);
        });

        if (relevant.length === 0) {
          // Only newsletters/spam arrived. Update stats.total but don't regenerate.
          const updated = { ...previousBriefing };
          if (updated.stats && typeof updated.stats === "object") {
            const stats = updated.stats as Record<string, number>;
            stats.total = (stats.total || 0) + newEmails.length;
            stats.filtered = (stats.filtered || 0) + newEmails.length;
          }
          return json({ briefing: updated, updated: false }, 200, corsHeaders);
        }

        // Build text for only the relevant new emails
        const newEmailsText = relevant
          .map((e: any) => {
            const p = Array.isArray(e.email_processed) ? e.email_processed[0] : e.email_processed;
            return `Subject: ${e.subject}\nFrom: ${e.sender}\nCategory: ${p?.category ?? "unknown"}\nSummary: ${p?.summary ?? e.snippet ?? ""}`;
          })
          .join("\n\n---\n\n");

        // Call the incremental update (cheaper than full rebuild)
        const updatedBriefing = await updateBriefing(
          JSON.stringify(previousBriefing),
          newEmailsText,
        );

        if (!updatedBriefing) {
          return json({ briefing: previousBriefing, updated: false }, 200, corsHeaders);
        }

        // Normalize the structure
        const normalized = {
          executiveSummary: (updatedBriefing as any).executiveSummary || "",
          topPriority: (updatedBriefing as any).topPriority || [],
          deadlines: (updatedBriefing as any).deadlines || [],
          waitingForReply: (updatedBriefing as any).waitingForReply || [],
          stats: (updatedBriefing as any).stats || previousBriefing.stats || {},
        };

        // Attach email_id to new cards; preserve existing email_id on carried-over cards
        const newSubjectToId = new Map<string, string>();
        for (const e of newEmails) {
          newSubjectToId.set(((e as any).subject ?? "").toLowerCase(), (e as any).id);
        }
        const attachIdsUpdate = (cards: any[]) => cards.map((card) => {
          if (card.email_id) return card; // already set from previous briefing
          const key = (card.subject ?? "").toLowerCase();
          let id = newSubjectToId.get(key);
          if (!id) {
            for (const [s, eid] of newSubjectToId) {
              if (s.includes(key) || key.includes(s)) { id = eid; break; }
            }
          }
          return id ? { ...card, email_id: id } : card;
        });
        normalized.topPriority = attachIdsUpdate(normalized.topPriority);
        normalized.waitingForReply = attachIdsUpdate(normalized.waitingForReply);

        return json({ briefing: normalized, updated: true }, 200, corsHeaders);
      } catch (err: any) {
        console.error("Briefing update error:", err);
        return json({ error: "Could not update briefing" }, 500, corsHeaders);
      }
    }

    // ── GET /calendar/free-slots ───────────────────────────────────────────
    if (path === "/calendar/free-slots" && req.method === "GET") {
      const accessToken = await getCalendarAccessTokenSafe(supabase, userId);
      if (!accessToken) {
        return json({ error: "No calendar access" }, 400, corsHeaders);
      }

      const url = new URL(req.url);
      const durationMin = parseInt(url.searchParams.get("duration") || "30", 10);

      const now = new Date();
      const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      // Get busy times from Google Calendar
      const busyRes = await fetch(
        "https://www.googleapis.com/calendar/v3/freeBusy",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            timeMin: now.toISOString(),
            timeMax: weekLater.toISOString(),
            items: [{ id: "primary" }],
          }),
        },
      );

      if (!busyRes.ok) {
        return json(
          { error: "Calendar API failed", slots: [] },
          200,
          corsHeaders,
        );
      }

      const busyData = await busyRes.json();
      const busyPeriods = busyData.calendars?.primary?.busy || [];

      // Get working hours from profile
      const { data: profileData } = await supabase
        .from("profiles")
        .select("working_hours")
        .eq("id", userId)
        .single();

      const wh = (profileData?.working_hours as {
        start?: string;
        end?: string;
        days?: number[];
      } | null) || {
        start: "09:00",
        end: "17:00",
        days: [1, 2, 3, 4, 5],
      };

      // Generate free slots (30-min slots within working hours, excluding busy)
      const slots: { start: string; end: string }[] = [];
      const [startH, startM] = (wh.start || "09:00").split(":").map(Number);
      const [endH, endM] = (wh.end || "17:00").split(":").map(Number);
      const slotMs = durationMin * 60000;
      // Step size: 30 min for durations ≤ 60 min, otherwise match duration
      const stepMs = durationMin <= 60 ? 30 * 60000 : slotMs;

      for (let d = 0; d < 14 && slots.length < 20; d++) {
        const day = new Date(now.getTime() + d * 24 * 60 * 60 * 1000);
        if (!(wh.days || [1, 2, 3, 4, 5]).includes(day.getDay())) continue;

        const dayStart = new Date(day);
        dayStart.setHours(startH, startM, 0, 0);
        const dayEnd = new Date(day);
        dayEnd.setHours(endH, endM, 0, 0);

        if (dayStart < now)
          dayStart.setTime(Math.max(dayStart.getTime(), now.getTime()));
        // Round up to next 30-min mark
        const mins = dayStart.getMinutes();
        if (mins % 30 !== 0) {
          dayStart.setMinutes(Math.ceil(mins / 30) * 30, 0, 0);
        }

        for (
          let t = dayStart.getTime();
          t + slotMs <= dayEnd.getTime() && slots.length < 20;
          t += stepMs
        ) {
          const slotStart = new Date(t);
          const slotEnd = new Date(t + slotMs);

          const isBusy = busyPeriods.some(
            (b: { start: string; end: string }) => {
              const bs = new Date(b.start).getTime();
              const be = new Date(b.end).getTime();
              return slotStart.getTime() < be && slotEnd.getTime() > bs;
            },
          );

          if (!isBusy) {
            slots.push({
              start: slotStart.toISOString(),
              end: slotEnd.toISOString(),
            });
          }
        }
      }

      return json({ slots }, 200, corsHeaders);
    }

    // ── POST /calendar/create-event ────────────────────────────────────────
    if (path === "/calendar/create-event" && req.method === "POST") {
      const body = await req.json();
      const accessToken = await getCalendarAccessTokenSafe(supabase, userId);
      if (!accessToken) {
        return json({ error: "No calendar access" }, 400, corsHeaders);
      }

      // Check user preference for sending invites
      const { data: calProfile } = await supabase
        .from("profiles")
        .select("calendar_send_invites")
        .eq("id", userId)
        .single();
      const sendUpdates = calProfile?.calendar_send_invites === false ? "none" : "all";

      const event: Record<string, unknown> = {
        summary: body.title,
        description: body.description || "",
        start: { dateTime: body.start_time, timeZone: body.timezone || "UTC" },
        end: { dateTime: body.end_time, timeZone: body.timezone || "UTC" },
      };

      if (body.location) {
        event.location = body.location;
      }

      if (body.attendees?.length) {
        event.attendees = body.attendees.map((email: string) => ({ email }));
      }

      const calRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=${sendUpdates}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(event),
        },
      );

      if (!calRes.ok) {
        const errText = await calRes.text();
        return json(
          { error: `Calendar API error: ${errText}` },
          400,
          corsHeaders,
        );
      }

      const calEvent = await calRes.json();
      return json(
        { event_id: calEvent.id, html_link: calEvent.htmlLink },
        200,
        corsHeaders,
      );
    }

    // ── POST /calendar/update-event ────────────────────────────────────────
    if (path === "/calendar/update-event" && req.method === "POST") {
      const body = await req.json();
      if (!body.event_id) {
        return json({ error: "event_id required" }, 400, corsHeaders);
      }
      const accessToken = await getCalendarAccessTokenSafe(supabase, userId);
      if (!accessToken) {
        return json({ error: "No calendar access" }, 400, corsHeaders);
      }

      // Check user preference for sending invites
      const { data: calUpdateProfile } = await supabase
        .from("profiles")
        .select("calendar_send_invites")
        .eq("id", userId)
        .single();
      const sendUpdatesVal = calUpdateProfile?.calendar_send_invites === false ? "none" : "all";

      const patch: Record<string, unknown> = {};
      if (body.title) patch.summary = body.title;
      if (body.description !== undefined) patch.description = body.description;
      if (body.start_time) patch.start = { dateTime: body.start_time, timeZone: body.timezone || "UTC" };
      if (body.end_time) patch.end = { dateTime: body.end_time, timeZone: body.timezone || "UTC" };
      if (body.location !== undefined) patch.location = body.location;
      if (body.attendees) patch.attendees = body.attendees.map((email: string) => ({ email }));

      const calRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${body.event_id}?sendUpdates=${sendUpdatesVal}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(patch),
        },
      );

      if (!calRes.ok) {
        const errText = await calRes.text();
        return json({ error: `Calendar API error: ${errText}` }, 400, corsHeaders);
      }

      const calEvent = await calRes.json();
      return json({ event_id: calEvent.id, html_link: calEvent.htmlLink }, 200, corsHeaders);
    }

    // ── POST /zoom/create-meeting ──────────────────────────────────────────
    if (path === "/zoom/create-meeting" && req.method === "POST") {
      const body = await req.json();

      const zoomAccountId = getEnv("ZOOM_ACCOUNT_ID");
      const zoomClientId = getEnv("ZOOM_CLIENT_ID");
      const zoomClientSecret = getEnv("ZOOM_CLIENT_SECRET");

      if (!zoomAccountId || !zoomClientId || !zoomClientSecret) {
        return json(
          { error: "Zoom integration not configured" },
          400,
          corsHeaders,
        );
      }

      // Get Zoom access token via Server-to-Server OAuth
      const tokenRes = await fetch(
        `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${zoomAccountId}`,
        {
          method: "POST",
          headers: {
            Authorization:
              "Basic " + btoa(`${zoomClientId}:${zoomClientSecret}`),
            "Content-Type": "application/x-www-form-urlencoded",
          },
        },
      );

      if (!tokenRes.ok) {
        return json({ error: "Zoom auth failed" }, 400, corsHeaders);
      }

      const tokenData = await tokenRes.json();

      // Create meeting
      const meetingRes = await fetch(
        "https://api.zoom.us/v2/users/me/meetings",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            topic: body.topic || "Meeting",
            type: 2,
            start_time: body.start_time,
            duration: body.duration || 30,
            settings: {
              join_before_host: true,
              waiting_room: false,
            },
          }),
        },
      );

      if (!meetingRes.ok) {
        const errText = await meetingRes.text();
        return json({ error: `Zoom API error: ${errText}` }, 400, corsHeaders);
      }

      const meeting = await meetingRes.json();
      return json(
        {
          meeting_id: meeting.id,
          join_url: meeting.join_url,
          start_url: meeting.start_url,
          password: meeting.password,
        },
        200,
        corsHeaders,
      );
    }

    // ── POST /register-gmail-token ─────────────────────────────────────────
    // Called from auth callback with Google provider tokens; encrypts and saves
    if (path === "/register-gmail-token" && req.method === "POST") {
      const body = await req.json();
      const { provider_token, provider_refresh_token, add_account } = body as {
        provider_token: string;
        provider_refresh_token?: string;
        add_account?: boolean;
      };

      if (!provider_token) {
        return json({ error: "Missing provider_token" }, 400, corsHeaders);
      }

      const { encryptTokens } = await import("../_shared/gmail.ts");
      const tokensJson = await encryptTokens({
        token: provider_token,
        refresh_token: provider_refresh_token,
        expiry: new Date(Date.now() + 3600 * 1000).toISOString(),
      });

      // Get the actual Gmail address from Google userinfo API
      let gmailAddress = "";
      try {
        const uiRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { Authorization: `Bearer ${provider_token}` },
        });
        if (uiRes.ok) {
          const ui = await uiRes.json();
          gmailAddress = ui.email ?? "";
        }
      } catch { /* fallback below */ }

      if (!gmailAddress) {
        const { data: profileRow } = await supabase
          .from("profiles").select("email").eq("id", userId).single();
        gmailAddress = (profileRow?.email as string) ?? "";
      }

      if (add_account) {
        // Upsert this account without removing existing ones
        await supabase.from("gmail_accounts").upsert(
          { user_id: userId, gmail_address: gmailAddress, tokens_encrypted: tokensJson, is_active: true },
          { onConflict: "user_id,gmail_address" },
        );
      } else {
        // Re-connect: replace only this specific address (or all if first time)
        const { data: existing } = await supabase
          .from("gmail_accounts").select("id").eq("user_id", userId).eq("gmail_address", gmailAddress);
        if (existing?.length) {
          await supabase.from("gmail_accounts")
            .update({ tokens_encrypted: tokensJson, is_active: true })
            .eq("user_id", userId).eq("gmail_address", gmailAddress);
        } else {
          // First time connecting — remove any stale placeholder rows and insert
          await supabase.from("gmail_accounts").delete().eq("user_id", userId).eq("gmail_address", "");
          await supabase.from("gmail_accounts").insert({
            user_id: userId, gmail_address: gmailAddress, tokens_encrypted: tokensJson, is_active: true,
          });
        }
      }

      // Set up Gmail push watch (non-fatal if it fails)
      try {
        const { data: newAccount } = await supabase
          .from("gmail_accounts")
          .select("id, tokens_encrypted")
          .eq("user_id", userId)
          .eq("gmail_address", gmailAddress)
          .single();
        if (newAccount) {
          await setupGmailWatch(
            newAccount.tokens_encrypted as string,
            supabase,
            newAccount.id as string,
          );
        }
      } catch (watchErr) {
        console.warn("[register-gmail-token] watch setup failed:", watchErr);
      }

      return json({ registered: true }, 200, corsHeaders);
    }

    // ── POST /rethink-email ────────────────────────────────────────────────
    if (path === "/rethink-email" && req.method === "POST") {
      const body = await req.json();
      const emailId = body.email_id as string;

      const { data: emails } = await supabase
        .from("emails")
        .select("id, subject, sender, body_text, snippet")
        .eq("id", emailId)
        .eq("user_id", userId);

      if (!emails?.length) {
        return json({ error: "Email not found" }, 404, corsHeaders);
      }

      const email = emails[0];
      const result = await processFullEmail(
        (email.subject as string) || "",
        (email.sender as string) || "",
        (email.body_text as string) || (email.snippet as string) || "",
      );

      await supabase.from("email_processed").upsert(
        {
          user_id: userId,
          email_id: emailId,
          category: result.category,
          summary: result.summary,
          quick_actions: result.quick_actions,
        },
        { onConflict: "email_id" },
      );

      return json({ ...result, email_id: emailId }, 200, corsHeaders);
    }

    // ── POST /extract-todos ────────────────────────────────────────────────
    if (path === "/extract-todos" && req.method === "POST") {
      const body = await req.json();
      const emailId = body.email_id as string;

      const { data: emails } = await supabase
        .from("emails")
        .select("*")
        .eq("id", emailId)
        .eq("user_id", userId);

      if (!emails?.length) {
        return json({ error: "Email not found" }, 404, corsHeaders);
      }

      const email = emails[0];
      const tasks = await extractTodos(
        (email.subject as string) || "",
        (email.sender as string) || "",
        (email.body_text as string) || (email.snippet as string) || "",
      );

      const inserted = [];
      for (const task of tasks) {
        const { data } = await supabase
          .from("todos")
          .insert({
            user_id: userId,
            text: task,
            source: "email",
          })
          .select()
          .single();
        if (data) inserted.push(data);
      }

      return json({ todos: inserted, count: inserted.length }, 200, corsHeaders);
    }

    // ── GET /suggest-todos ─────────────────────────────────────────────────
    if (path === "/suggest-todos" && req.method === "GET") {
      const { data: recent } = await supabase
        .from("emails")
        .select("subject, sender, snippet, email_processed(category, summary)")
        .eq("user_id", userId)
        .order("received_at", { ascending: false })
        .limit(15);

      if (!recent?.length) {
        return json({ suggestions: [] }, 200, corsHeaders);
      }

      const emailsText = recent
        .map((e) => {
          const proc = Array.isArray(e.email_processed)
            ? e.email_processed[0]
            : e.email_processed;
          return `Subject: ${e.subject}\nFrom: ${e.sender}\nSummary: ${(proc as { summary?: string } | null)?.summary ?? e.snippet}`;
        })
        .join("\n\n");

      const suggestions = await suggestTodosFromEmails(emailsText);
      return json({ suggestions }, 200, corsHeaders);
    }

    // ── GET /oauth/google-url ──────────────────────────────────────────────
    // Returns a direct Google OAuth URL so the frontend can add a Gmail account
    // WITHOUT creating a new Supabase session (which would log the user out).
    if (path === "/oauth/google-url" && req.method === "GET") {
      const redirectUri = url.searchParams.get("redirect_uri") || "";
      const params = new URLSearchParams({
        client_id: getEnv("GOOGLE_CLIENT_ID"),
        redirect_uri: redirectUri,
        response_type: "code",
        scope: [
          "email",
          "profile",
          "https://www.googleapis.com/auth/gmail.modify",
          "https://www.googleapis.com/auth/calendar",
        ].join(" "),
        access_type: "offline",
        prompt: "consent select_account",
      });
      return json(
        { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` },
        200,
        corsHeaders,
      );
    }

    // ── POST /oauth/add-gmail ──────────────────────────────────────────────
    // Exchanges a Google auth code server-side and links the Gmail account to
    // the authenticated user — no Supabase session created for the new account.
    if (path === "/oauth/add-gmail" && req.method === "POST") {
      const body = await req.json();
      const { code, redirect_uri } = body as {
        code: string;
        redirect_uri: string;
      };
      if (!code || !redirect_uri) {
        return json({ error: "Missing code or redirect_uri" }, 400, corsHeaders);
      }

      // Exchange auth code with Google
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: getEnv("GOOGLE_CLIENT_ID"),
          client_secret: getEnv("GOOGLE_CLIENT_SECRET"),
          redirect_uri,
          grant_type: "authorization_code",
        }),
      });
      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        return json({ error: `Token exchange failed: ${errText}` }, 400, corsHeaders);
      }
      const tokens = await tokenRes.json() as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      // Get Gmail address from Google
      let gmailAddress = "";
      try {
        const uiRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (uiRes.ok) {
          const ui = await uiRes.json();
          gmailAddress = ui.email ?? "";
        }
      } catch { /* ignore */ }

      if (!gmailAddress) {
        return json({ error: "Could not retrieve Gmail address" }, 400, corsHeaders);
      }

      // Encrypt and store
      const { encryptTokens } = await import("../_shared/gmail.ts");
      const tokensJson = await encryptTokens({
        token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry: new Date(
          Date.now() + (tokens.expires_in ?? 3600) * 1000,
        ).toISOString(),
      });

      await supabase.from("gmail_accounts").upsert(
        {
          user_id: userId,
          gmail_address: gmailAddress,
          tokens_encrypted: tokensJson,
          is_active: true,
        },
        { onConflict: "user_id,gmail_address" },
      );

      // Set up Gmail push watch (non-fatal if it fails)
      try {
        const { data: newAccount } = await supabase
          .from("gmail_accounts")
          .select("id, tokens_encrypted")
          .eq("user_id", userId)
          .eq("gmail_address", gmailAddress)
          .single();
        if (newAccount) {
          await setupGmailWatch(
            newAccount.tokens_encrypted as string,
            supabase,
            newAccount.id as string,
          );
        }
      } catch (watchErr) {
        console.warn("[oauth/add-gmail] watch setup failed:", watchErr);
      }

      return json({ registered: true, gmail_address: gmailAddress }, 200, corsHeaders);
    }

    // ── POST /remove-gmail-account ─────────────────────────────────────────
    if (path === "/remove-gmail-account" && req.method === "POST") {
      const body = await req.json();
      const accountId = body.account_id as string;
      if (!accountId) return json({ error: "Missing account_id" }, 400, corsHeaders);
      // Soft-delete: mark inactive so data is preserved and can be restored on re-link
      await supabase.from("gmail_accounts")
        .update({ is_active: false })
        .eq("id", accountId)
        .eq("user_id", userId);
      return json({ removed: true }, 200, corsHeaders);
    }

    // ── DELETE /delete-account ─────────────────────────────────────────────
    // Hard-deletes one Gmail account and all data associated with it.
    if (path === "/delete-account" && req.method === "DELETE") {
      const body = await req.json().catch(() => ({}));
      const accountId = body.account_id as string;
      if (!accountId) return json({ error: "Missing account_id" }, 400, corsHeaders);

      // Verify the account belongs to this user
      const { data: account } = await supabase
        .from("gmail_accounts")
        .select("id")
        .eq("id", accountId)
        .eq("user_id", userId)
        .single();
      if (!account) return json({ error: "Account not found" }, 404, corsHeaders);

      // Collect all email IDs for this account
      const { data: accountEmails } = await supabase
        .from("emails")
        .select("id")
        .eq("gmail_account_id", accountId)
        .eq("user_id", userId);
      const emailIds = (accountEmails ?? []).map((e: { id: string }) => e.id);

      // Delete linked data for these emails (email_id → set null on cascade,
      // so we explicitly delete them so they don't linger as orphans)
      if (emailIds.length > 0) {
        await supabase.from("todos").delete().in("email_id", emailIds);
        await supabase.from("meetings").delete().in("email_id", emailIds);
        await supabase.from("read_receipts").delete().in("email_id", emailIds);
      }

      // Delete scheduled emails tied to this account
      await supabase.from("scheduled_emails").delete().eq("gmail_account_id", accountId);

      // Delete emails (cascades email_processed)
      await supabase.from("emails").delete()
        .eq("gmail_account_id", accountId)
        .eq("user_id", userId);

      // Hard-delete the gmail account itself
      const { error: accErr } = await supabase.from("gmail_accounts")
        .delete()
        .eq("id", accountId)
        .eq("user_id", userId);

      if (accErr) {
        return json({ error: "Failed to delete account: " + accErr.message }, 500, corsHeaders);
      }

      // If this was the last Gmail account, wipe ALL user data so re-signing in
      // starts completely fresh. We cascade-delete the profile (which cascades to
      // every user-owned table: todos, meetings, read_receipts, knowledge_base,
      // email_memory, categories, delegation_rules, etc.) then re-insert a clean
      // profile keeping only the user's AI mode and theme preferences.
      const { count: remainingAccounts } = await supabase
        .from("gmail_accounts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);

      if ((remainingAccounts ?? 0) === 0) {
        // Save preferences before wiping
        const { data: profile } = await supabase
          .from("profiles")
          .select("email, display_name, avatar_url, ai_mode, theme")
          .eq("id", userId)
          .single();

        // draft_emails references auth.users (not profiles), so delete explicitly first
        await supabase.from("draft_emails").delete().eq("user_id", userId);

        // Cascade-delete profile (wipes todos, meetings, read_receipts, knowledge_base,
        // email_memory, categories, delegation_rules, scheduled_emails, etc.)
        await supabase.from("profiles").delete().eq("id", userId);

        // Re-insert a clean profile so the user can sign back in without issues
        await supabase.from("profiles").insert({
          id: userId,
          email: profile?.email ?? "",
          display_name: profile?.display_name ?? null,
          avatar_url: profile?.avatar_url ?? null,
          ai_mode: profile?.ai_mode ?? "cloud",
          theme: profile?.theme ?? "light",
        });
      }

      return json({ deleted: true }, 200, corsHeaders);
    }

    // ── DELETE /delete-all-data ────────────────────────────────────────────
    if (path === "/delete-all-data" && req.method === "DELETE") {
      // Get current profile so we can recreate it after cascade-delete
      const { data: profile } = await supabase
        .from("profiles")
        .select("email, display_name, avatar_url, ai_mode, theme")
        .eq("id", userId)
        .single();

      // draft_emails references auth.users (not profiles), so it won't cascade
      await supabase.from("draft_emails").delete().eq("user_id", userId);

      // Deleting the profile cascades to ALL other child tables (emails, gmail_accounts,
      // todos, meetings, read_receipts, email_processed, knowledge_base, etc.)
      const { error: deleteErr } = await supabase
        .from("profiles")
        .delete()
        .eq("id", userId);

      if (deleteErr) {
        console.error("Profile delete error:", deleteErr);
        return json({ error: "Failed to delete data: " + deleteErr.message }, 500, corsHeaders);
      }

      // Re-insert a clean profile so the user stays logged in
      await supabase.from("profiles").insert({
        id: userId,
        email: profile?.email ?? "",
        display_name: profile?.display_name ?? null,
        avatar_url: profile?.avatar_url ?? null,
        ai_mode: profile?.ai_mode ?? "cloud",
        theme: profile?.theme ?? "light",
      });

      return json({ deleted: true }, 200, corsHeaders);
    }

    // ── POST /chat ───────────────────────────────────────────────────────────
    if (path === "/chat" && req.method === "POST") {
      const userId = await getUserId(req);
      const { message, history = [], timezone = "UTC" } = await req.json();

      if (!message?.trim()) {
        return json({ error: "Message required" }, 400, corsHeaders);
      }

      // Load lightweight structured context upfront; contacts/KB are search-only
      const [
        todosResult,
        meetingsResult,
        receiptsResult,
        styleResult,
        profileResult,
      ] = await Promise.all([
        supabase
          .from("todos")
          .select("text")
          .eq("user_id", userId)
          .eq("is_completed", false)
          .order("created_at", { ascending: false }),
        supabase
          .from("meetings")
          .select("title, start_time, attendees")
          .eq("user_id", userId)
          .gte("start_time", new Date().toISOString())
          .order("start_time", { ascending: true }),
        supabase
          .from("read_receipts")
          .select("subject, recipient_email, created_at")
          .eq("user_id", userId)
          .eq("open_count", 0)
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("style_profiles")
          .select("greeting_style, closing_style, tone, avg_length")
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("profiles")
          .select("display_name")
          .eq("id", userId)
          .single(),
      ]);

      const context: ChatContext = {
        userDisplayName: (profileResult.data as { display_name?: string } | null)?.display_name || "User",
        timezone: timezone as string,
        styleProfile: styleResult.data as ChatContext["styleProfile"],
        openTodos: (todosResult.data ?? []) as { text: string }[],
        upcomingMeetings: ((meetingsResult.data ?? []) as { title: string; start_time: string; attendees: string[] | null }[]).map((m) => ({
          title: m.title,
          start_time: m.start_time,
          attendees: Array.isArray(m.attendees) ? m.attendees : [],
        })),
        pendingReplies: (receiptsResult.data ?? []) as { subject: string; recipient_email: string; created_at: string }[],
      };

      const { reply, tool_calls } = await chatWithAssistant(context, message, history, supabase, userId);

      // Execute tool calls (search_emails is handled in-memory by chatWithAssistant)
      const actions: { type: string; data: Record<string, unknown> }[] = [];

      for (const tc of tool_calls) {
        if (tc.name === "create_todo") {
          const args = tc.arguments as { text: string };
          const { data: todo } = await supabase
            .from("todos")
            .insert({ user_id: userId, text: args.text, source: "assistant" })
            .select("id")
            .single();
          if (todo) actions.push({ type: "create_todo", data: { text: args.text, id: (todo as { id: string }).id } });
        } else if (tc.name === "save_draft") {
          const args = tc.arguments as { to: string; subject: string; body: string };
          const { data: draft } = await supabase
            .from("draft_emails")
            .insert({
              user_id: userId,
              to_addresses: [args.to],
              subject: args.subject,
              body_html: args.body.replace(/\n/g, "<br>"),
            })
            .select("id")
            .single();
          if (draft) actions.push({ type: "save_draft", data: { subject: args.subject, to: args.to, id: (draft as { id: string }).id } });
        } else if (tc.name === "add_knowledge") {
          const args = tc.arguments as { entity: string; entity_type: string; info: string };
          await supabase
            .from("knowledge_base")
            .upsert({
              user_id: userId,
              entity: args.entity,
              entity_type: args.entity_type,
              info: args.info,
              source: "assistant",
              confidence: 1.0,
            }, { onConflict: "user_id,entity,entity_type" });
          actions.push({ type: "add_knowledge", data: args });
        } else if (tc.name === "send_email") {
          const args = tc.arguments as { to: string; subject: string; body: string };
          try {
            // Get Gmail account for sending
            const { data: accounts } = await supabase
              .from("gmail_accounts")
              .select("*")
              .eq("user_id", userId)
              .eq("is_active", true)
              .limit(1);
            const account = accounts?.[0];
            if (account) {
              const result = await sendEmail(
                account.tokens_encrypted as string,
                [args.to],
                args.subject,
                args.body.replace(/\n/g, "<br>"),
              );
              actions.push({ type: "send_email", data: { to: args.to, subject: args.subject, message_id: result.id } });
            } else {
              actions.push({ type: "send_email_failed", data: { error: "No Gmail account connected" } });
            }
          } catch (err) {
            actions.push({ type: "send_email_failed", data: { error: String(err) } });
          }
        } else if (tc.name === "reply_to_email") {
          const args = tc.arguments as { email_id: string; body: string };
          try {
            const { data: accounts } = await supabase
              .from("gmail_accounts")
              .select("*")
              .eq("user_id", userId)
              .eq("is_active", true)
              .limit(1);
            const account = accounts?.[0];
            if (!account) {
              actions.push({ type: "send_email_failed", data: { error: "No Gmail account connected" } });
            } else {
              // Fetch original email for threading headers
              const { data: original } = await supabase
                .from("emails")
                .select("subject, sender_email, gmail_id, thread_id")
                .eq("id", args.email_id)
                .eq("user_id", userId)
                .maybeSingle();
              if (!original) {
                actions.push({ type: "send_email_failed", data: { error: "Original email not found" } });
              } else {
                const subject = (original as any).subject?.startsWith("Re:") ? (original as any).subject : `Re: ${(original as any).subject}`;
                const result = await sendEmail(
                  account.tokens_encrypted as string,
                  [(original as any).sender_email],
                  subject,
                  args.body.replace(/\n/g, "<br>"),
                  (original as any).gmail_id,
                  (original as any).thread_id,
                );
                actions.push({ type: "send_email", data: { to: (original as any).sender_email, subject, message_id: result.id } });
              }
            }
          } catch (err) {
            actions.push({ type: "send_email_failed", data: { error: String(err) } });
          }
        } else if (tc.name === "update_todo") {
          actions.push({ type: "update_todo", data: tc.arguments });
        } else if (tc.name === "delete_todo") {
          actions.push({ type: "delete_todo", data: tc.arguments });
        } else if (tc.name === "update_meeting") {
          actions.push({ type: "update_meeting", data: tc.arguments });
        } else if (tc.name === "delete_meeting") {
          actions.push({ type: "delete_meeting", data: tc.arguments });
        } else if (tc.name === "delete_draft") {
          actions.push({ type: "delete_draft", data: tc.arguments });
        } else if (tc.name === "archive_email") {
          actions.push({ type: "archive_email", data: tc.arguments });
        } else if (tc.name === "create_meeting") {
          const args = tc.arguments as { title: string; start_time: string; end_time: string; attendees?: string[]; description?: string; include_zoom?: boolean };
          const userTz = timezone as string || "UTC";
          try {
            // Optionally create Zoom link (default true)
            let zoomLink: string | null = null;
            if (args.include_zoom === true) {
              try {
                const zoomAccountId = getEnv("ZOOM_ACCOUNT_ID");
                const zoomClientId = getEnv("ZOOM_CLIENT_ID");
                const zoomClientSecret = getEnv("ZOOM_CLIENT_SECRET");
                if (zoomAccountId && zoomClientId && zoomClientSecret) {
                  const tokenRes = await fetch(
                    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${zoomAccountId}`,
                    {
                      method: "POST",
                      headers: {
                        Authorization: "Basic " + btoa(`${zoomClientId}:${zoomClientSecret}`),
                        "Content-Type": "application/x-www-form-urlencoded",
                      },
                    },
                  );
                  if (tokenRes.ok) {
                    const tokenData = await tokenRes.json();
                    // Calculate duration in minutes from start/end
                    const startMs = new Date(args.start_time).getTime();
                    const endMs = new Date(args.end_time).getTime();
                    const duration = Math.max(15, Math.round((endMs - startMs) / 60000));
                    const meetingRes = await fetch("https://api.zoom.us/v2/users/me/meetings", {
                      method: "POST",
                      headers: {
                        Authorization: `Bearer ${tokenData.access_token}`,
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({
                        topic: args.title,
                        type: 2,
                        start_time: args.start_time,
                        duration,
                        settings: { join_before_host: true, waiting_room: false },
                      }),
                    });
                    if (meetingRes.ok) {
                      const zoom = await meetingRes.json();
                      zoomLink = zoom.join_url;
                    }
                  }
                }
              } catch (err) {
                console.error("[chat] Zoom creation failed:", err);
              }
            }

            const startDt = args.start_time.includes("T") ? args.start_time : args.start_time + "T00:00:00";
            const endDt = args.end_time.includes("T") ? args.end_time : args.end_time + "T00:00:00";

            const accessToken = await getCalendarAccessTokenSafe(supabase, userId);
            if (accessToken) {
              const { data: calProfile } = await supabase
                .from("profiles")
                .select("calendar_send_invites")
                .eq("id", userId)
                .single();
              const sendUpdates = calProfile?.calendar_send_invites === false ? "none" : "all";

              const event: Record<string, unknown> = {
                summary: args.title,
                description: (args.description || "") + (zoomLink ? `\n\nZoom: ${zoomLink}` : ""),
                start: { dateTime: startDt, timeZone: userTz },
                end: { dateTime: endDt, timeZone: userTz },
                location: zoomLink || "",
              };
              if (args.attendees?.length) {
                event.attendees = args.attendees.map((email: string) => ({ email }));
              }
              const calRes = await fetch(
                `https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=${sendUpdates}`,
                {
                  method: "POST",
                  headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
                  body: JSON.stringify(event),
                },
              );
              if (calRes.ok) {
                const calEvent = await calRes.json();
                await supabase.from("meetings").insert({
                  user_id: userId,
                  title: args.title,
                  start_time: startDt,
                  end_time: endDt,
                  attendees: args.attendees ?? [],
                  description: args.description || "",
                  calendar_event_id: calEvent.id,
                  zoom_link: zoomLink,
                  status: "confirmed",
                });
                actions.push({ type: "create_meeting", data: { title: args.title, start_time: startDt, attendees: args.attendees, zoom_link: zoomLink } });
              } else {
                actions.push({ type: "create_meeting_failed", data: { error: await calRes.text() } });
              }
            } else {
              await supabase.from("meetings").insert({
                user_id: userId,
                title: args.title,
                start_time: startDt,
                end_time: endDt,
                attendees: args.attendees ?? [],
                description: args.description || "",
                zoom_link: zoomLink,
                status: "proposed",
              });
              actions.push({ type: "create_meeting", data: { title: args.title, start_time: startDt, attendees: args.attendees, zoom_link: zoomLink } });
            }
          } catch (err) {
            actions.push({ type: "create_meeting_failed", data: { error: String(err) } });
          }
        }
      }

      // Increment use_count for knowledge entries that were in context
      try {
        const kbIds = (knowledgeResult.data ?? [])
          .map((k: { id?: string }) => k.id)
          .filter(Boolean);
        if (kbIds.length > 0) {
          const now = new Date().toISOString();
          // Batch update: increment use_count and set last_used_at
          for (const id of kbIds) {
            await supabase.rpc("increment_knowledge_use_count", { row_id: id, used_at: now }).catch(() => {
              // Fallback if RPC doesn't exist: direct update
              supabase.from("knowledge_base")
                .update({ last_used_at: now })
                .eq("id", id);
            });
          }
        }
      } catch (err) {
        console.error("[chat] knowledge use count:", err);
      }

      return json({ reply, actions }, 200, corsHeaders);
    }

    // ── POST /push/subscribe — store a browser Web Push subscription ──────
    if (path === "/push/subscribe" && req.method === "POST") {
      const { endpoint, p256dh, auth } = await req.json();
      if (!endpoint || !p256dh || !auth) {
        return json({ error: "Missing required fields" }, 400, corsHeaders);
      }
      await supabase.from("push_subscriptions").upsert(
        { user_id: userId, endpoint, p256dh, auth },
        { onConflict: "user_id,endpoint" },
      );
      return json({ ok: true }, 200, corsHeaders);
    }

    // ── DELETE /push/subscribe — remove a Web Push subscription ───────────
    if (path === "/push/subscribe" && req.method === "DELETE") {
      const { endpoint } = await req.json().catch(() => ({}));
      if (endpoint) {
        await supabase.from("push_subscriptions").delete()
          .eq("user_id", userId).eq("endpoint", endpoint);
      }
      return json({ ok: true }, 200, corsHeaders);
    }

    // ── GET /attachment — fetch a Gmail attachment by ID ───────────────────
    if (path === "/attachment" && req.method === "GET") {
      const urlObj = new URL(req.url);
      const gmailId = urlObj.searchParams.get("gmail_id");
      const attachmentId = urlObj.searchParams.get("attachment_id");
      if (!gmailId || !attachmentId) {
        return json({ error: "Missing gmail_id or attachment_id" }, 400, corsHeaders);
      }

      const { data: emailRow } = await supabase
        .from("emails")
        .select("gmail_account_id")
        .eq("user_id", userId)
        .eq("gmail_id", gmailId)
        .maybeSingle();
      if (!emailRow?.gmail_account_id) {
        return json({ error: "Email not found" }, 404, corsHeaders);
      }

      const { data: account } = await supabase
        .from("gmail_accounts")
        .select("tokens_encrypted")
        .eq("id", emailRow.gmail_account_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (!account) {
        return json({ error: "Gmail account not found" }, 404, corsHeaders);
      }

      const result = await fetchAttachment(account.tokens_encrypted as string, gmailId, attachmentId);
      if (!result) return json({ error: "Failed to fetch attachment" }, 502, corsHeaders);

      return json({ data: result.data, size: result.size }, 200, corsHeaders);
    }

    return json({ error: "Not found" }, 404, corsHeaders);
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    const message =
      (err as { message?: string }).message ?? "Internal server error";
    console.error(`[${status}] ${message}`);
    return json({ error: message }, status, corsHeaders);
  }
});
