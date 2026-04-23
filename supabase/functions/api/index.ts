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
 *   POST /tts                  Google Cloud Text-to-Speech (Neural2)
 *   GET  /follow-ups           List follow-up reminders
 *   POST /follow-ups           Create/upsert a follow-up reminder
 *   PATCH /follow-ups/:id      Update a follow-up reminder
 *   DELETE /follow-ups/:id     Delete a follow-up reminder
 *   GET  /signatures          List all email signatures
 *   POST /signatures          Create a new email signature
 *   PATCH /signatures/:id     Update a signature
 *   DELETE /signatures/:id    Delete a signature
 */

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  fetchEmailsByHistoryId,
  fetchEmails,
  fetchSentEmails,
  fetchGoogleContacts,
  searchGoogleContacts,
  fetchAttachment,
  sendEmail,
  setupGmailWatch,
  type EmailData,
} from "../_shared/gmail.ts";
import {
  analyzeWritingStyle,
  chatWithAssistant,
  extractTodos,
  briefingSummaryNeedsRecovery,
  generateBriefingExecutiveSummary,
  updateBriefing,
  composeDraft,
  refineDraft,
  generateDraft,
  suggestTodosFromEmails,
  type ChatContext,
} from "../_shared/ai.ts";
import { analyzeEmailsForUser } from "../_shared/analyzeEmails.ts";
import { buildBriefingForUser } from "../_shared/buildBriefing.ts";
import {
  runAgentStep,
  runAgentStepParallel,
  startAgentSession,
  answerPendingQuestion,
} from "../_shared/agentLoop.ts";
import { executeAgentPlan } from "../_shared/agentExecute.ts";
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

// Simple RFC-5322-ish regex; good enough for our UI-entered addresses. Reused
// by /send-email and the chat assistant's send_email tool to keep validation
// rules consistent across entry points.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRecipients(list: unknown): {
  ok: boolean;
  error?: string;
  emails?: string[];
} {
  if (!Array.isArray(list) || list.length === 0) {
    return {
      ok: false,
      error: "to[] is required and must be a non-empty array",
    };
  }
  if (list.length > 100) {
    return { ok: false, error: "Too many recipients (max 100)" };
  }
  const emails: string[] = [];
  for (const raw of list) {
    if (typeof raw !== "string") {
      return { ok: false, error: "Recipient must be a string" };
    }
    const addr = raw.trim();
    if (!EMAIL_REGEX.test(addr) || addr.length > 254) {
      return { ok: false, error: `Invalid email address: ${raw}` };
    }
    emails.push(addr);
  }
  return { ok: true, emails };
}

// ── Allowlist + signed state for the "add Gmail account" OAuth flow ─────────

function getAllowedAddGmailOrigins(): string[] {
  const raw = getEnv("ALLOWED_FRONTEND_ORIGINS");
  if (!raw) return ["https://runemail.app", "http://localhost:3000"];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isAllowedAddGmailRedirect(redirectUri: string): boolean {
  try {
    const u = new URL(redirectUri);
    if (u.pathname !== "/auth/google-add-account") return false;
    const origin = `${u.protocol}//${u.host}`;
    return getAllowedAddGmailOrigins().includes(origin);
  } catch {
    return false;
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(): Promise<CryptoKey> {
  // Prefer dedicated secret; fall back to FERNET / TOKEN_ENCRYPTION_KEY so the
  // flow still works if deployers haven't set a new env var yet.
  const secret =
    getEnv("OAUTH_STATE_SECRET") ||
    getEnv("TOKEN_ENCRYPTION_KEY") ||
    getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const keyBytes = new TextEncoder().encode(secret);
  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signOauthState(payload: {
  userId: string;
  redirect_uri: string;
}): Promise<string> {
  const body = {
    u: payload.userId,
    r: payload.redirect_uri,
    // 15-minute expiry is plenty for an interactive OAuth flow.
    exp: Math.floor(Date.now() / 1000) + 15 * 60,
    n: crypto.randomUUID(),
  };
  const bodyBytes = new TextEncoder().encode(JSON.stringify(body));
  const key = await hmacKey();
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, bodyBytes));
  return `${toBase64Url(bodyBytes)}.${toBase64Url(sig)}`;
}

async function verifyOauthState(
  state: string,
  expected: { userId: string; redirect_uri: string },
): Promise<boolean> {
  try {
    const [b, s] = state.split(".");
    if (!b || !s) return false;
    const bodyBytes = fromBase64Url(b);
    const sig = fromBase64Url(s);
    const key = await hmacKey();
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      sig as unknown as ArrayBuffer,
      bodyBytes as unknown as ArrayBuffer,
    );
    if (!ok) return false;
    const parsed = JSON.parse(new TextDecoder().decode(bodyBytes)) as {
      u: string;
      r: string;
      exp: number;
    };
    if (parsed.exp < Math.floor(Date.now() / 1000)) return false;
    if (parsed.u !== expected.userId) return false;
    if (parsed.r !== expected.redirect_uri) return false;
    return true;
  } catch {
    return false;
  }
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

function isWithinWorkingHours(
  wh: {
    start?: string;
    end?: string;
    days?: number[];
    timezone?: string;
    dnd?: boolean;
  } | null,
): boolean {
  if (!wh || !wh.dnd) return true; // DND not enabled; always send
  const tz = wh.timezone;
  let dayOfWeek: number;
  let currentMinutes: number;
  if (tz) {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(new Date());
    const dayStr = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hour = parseInt(
      parts.find((p) => p.type === "hour")?.value ?? "0",
      10,
    );
    const minute = parseInt(
      parts.find((p) => p.type === "minute")?.value ?? "0",
      10,
    );
    const dayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
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
  return (
    currentMinutes >= startH * 60 + startM && currentMinutes < endH * 60 + endM
  );
}

async function sendPushNotification(
  userId: string,
  supabase: SupabaseClient,
  payload: {
    title: string;
    body: string;
    tag?: string;
    data?: Record<string, unknown>;
  },
): Promise<void> {
  if (!VAPID_PRIVATE_KEY || !VAPID_PUBLIC_KEY) return;

  // Respect Do Not Disturb: skip if outside working hours and DND is enabled
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("working_hours")
    .eq("id", userId)
    .single();
  const wh = profileRow?.working_hours as {
    start?: string;
    end?: string;
    days?: number[];
    timezone?: string;
    dnd?: boolean;
  } | null;
  if (!isWithinWorkingHours(wh)) return;

  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (!subs?.length) return;
  await Promise.allSettled(
    subs.map(
      async (sub: { endpoint: string; p256dh: string; auth: string }) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            JSON.stringify(payload),
          );
        } catch (err) {
          // Remove expired or invalid subscriptions (410 Gone, 404 Not Found)
          const code = (err as { statusCode?: number }).statusCode;
          if (code === 410 || code === 404) {
            await supabase
              .from("push_subscriptions")
              .delete()
              .eq("endpoint", sub.endpoint)
              .eq("user_id", userId);
          }
        }
      },
    ),
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
      tokens.expiry = new Date(
        Date.now() + (data.expires_in ?? 3600) * 1000,
      ).toISOString();
      // Save refreshed token back to DB so the next call doesn't need to refresh again
      try {
        const newEncrypted = await encryptTokens(tokens);
        await supabase
          .from("gmail_accounts")
          .update({ tokens_encrypted: newEncrypted })
          .eq("id", accounts[0].id);
      } catch (err) {
        console.error("[getCalendarAccessToken] save refreshed token:", err);
      }
    } else {
      // Refresh failed; return null so the caller can surface a proper error
      console.error(
        "[getCalendarAccessToken] token refresh failed:",
        await res.text(),
      );
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
  const path =
    rawPathname.replace(/^\/functions\/v1\/api/, "").replace(/^\/api/, "") ||
    "/";

  const supabase = createClient(
    getEnv("SUPABASE_URL"),
    getEnv("SUPABASE_SERVICE_ROLE_KEY"),
  );

  try {
    // ── GET /health — NO auth required ───────────────────────────────────
    // Keep the public response minimal. Avoid hinting at which env vars or
    // services are configured since this endpoint is reachable anonymously.
    if (path === "/health" && req.method === "GET") {
      let dbOk = false;
      try {
        const { error } = await supabase.from("profiles").select("id").limit(1);
        dbOk = !error;
      } catch {
        dbOk = false;
      }
      const aiOk =
        !!getEnv("CEREBRAS_API_KEY") || !!getEnv("OPENROUTER_API_KEY");
      const ok = dbOk && aiOk;
      return json(
        { status: ok ? "ok" : "degraded" },
        ok ? 200 : 503,
        corsHeaders,
      );
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
            // Skip known automated crawlers, security scanners, and link-checkers.
            // googleimageproxy is intentionally NOT blocked because it fires when
            // a Gmail user opens the email (real open event).
            const isBot =
              /adsbot|googlebot|bot\/|crawler|spider|preview|prefetch|barracuda|mimecast|proofpoint|messagelabs|cloudmark|defender|antivirus|antispam|scanner|mailscanner|linkcheck|safebrowsing|bingpreview|yandex|baidu|semrush|ahrefsbot/i.test(
                userAgent,
              );
            // Skip opens within 20 seconds of creation to catch sending-side
            // auto-loads and fast security scanners that fire on delivery.
            const createdAt = new Date(receipt.created_at as string).getTime();
            const isTooSoon = Date.now() - createdAt < 20_000;

            // Rate-limit per tracking_id: ignore opens within 10s of the
            // previous recorded open (same client reloading/prefetching).
            const lastOpenedAt = receipt.last_opened_at
              ? new Date(receipt.last_opened_at as string).getTime()
              : 0;
            const isTooFrequent =
              lastOpenedAt && Date.now() - lastOpenedAt < 10_000;

            if (!isBot && !isTooSoon && !isTooFrequent) {
              const now = new Date().toISOString();
              // Cap in-memory history to the 200 most recent opens so a bad
              // actor hitting the pixel in a loop cannot unboundedly grow the
              // row. A DB trigger enforces the same limit defense-in-depth.
              const MAX_OPENS = 200;
              const existing = (receipt.opens ?? []) as object[];
              const opens = existing.slice(-Math.max(0, MAX_OPENS - 1));
              opens.push({
                timestamp: now,
                ip:
                  req.headers.get("CF-Connecting-IP") ??
                  req.headers.get("X-Forwarded-For") ??
                  "unknown",
                user_agent: userAgent.slice(0, 256),
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
                console.error(
                  "[track/pixel] First update failed, retrying:",
                  updateErr.message,
                );
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
          const { emailAddress, historyId: notificationHistoryId } = JSON.parse(
            decoded,
          ) as {
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

          const storedHistoryId =
            (account.history_id as string | null) ?? notificationHistoryId;

          let {
            emails: newEmails,
            newHistoryId,
            tooOld,
          } = await fetchEmailsByHistoryId(
            account.tokens_encrypted as string,
            storedHistoryId,
            supabase,
            account.id as string,
          );

          if (tooOld) {
            console.warn(
              "[webhook] historyId stale for",
              emailAddress,
              "— falling back to latest 15",
            );
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

          // Batch check which gmail_ids already exist (1 query instead of N)
          const incomingGmailIds = newEmails.map((e) => e.gmail_id);
          const { data: existingRows } = await supabase
            .from("emails")
            .select("gmail_id")
            .eq("user_id", userId)
            .in("gmail_id", incomingGmailIds);
          const existingSet = new Set(
            (existingRows ?? []).map((r: { gmail_id: string }) => r.gmail_id),
          );
          const gmailAddress = (
            account.gmail_address as string | null
          )?.toLowerCase();
          const toInsert = newEmails.filter(
            (e) =>
              !existingSet.has(e.gmail_id) &&
              !e.label_ids.includes("SENT") &&
              e.label_ids.includes("INBOX") &&
              !(gmailAddress && e.sender_email?.toLowerCase() === gmailAddress),
          );

          // Batch insert all new emails (1 query instead of N)
          let insertOk = true;
          if (toInsert.length > 0) {
            const { error: insertError } = await supabase.from("emails").insert(
              toInsert.map((emailData) => ({
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
              })),
            );
            if (insertError) {
              console.error("[webhook] batch insert failed:", insertError.message);
              insertOk = false;
            }
          }

          // Only advance the history cursor once emails are safely persisted.
          // If the insert failed we leave the cursor where it was so the next
          // webhook delivery re-attempts the same range.
          if (insertOk && newHistoryId) {
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
            const notifLevel =
              (userProfile?.notification_level as string) || "important";
            const notifPreview =
              (userProfile?.notification_preview as boolean) !== false;

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
                  const title =
                    newEmails.length === 1
                      ? "New email"
                      : `${newEmails.length} new emails`;
                  const body = notifPreview
                    ? newEmails.length === 1 && emailRow
                      ? `${emailRow.sender}: ${emailRow.subject}`
                      : `Latest from ${first.sender}`
                    : "You have new email";
                  await sendPushNotification(userId, supabase, {
                    title,
                    body,
                    tag: "new-email",
                    data: { view: "inbox" },
                  });
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
                    const first = importantNew[0] as {
                      email_id: string;
                      category: string;
                    };
                    const emailRow = (newEmailRows ?? []).find(
                      (e: { id: string }) => e.id === first.email_id,
                    ) as { subject: string; sender: string } | undefined;
                    const body = notifPreview
                      ? emailRow
                        ? `${emailRow.sender}: ${emailRow.subject}`
                        : "New email"
                      : first.category === "action-required"
                        ? "You have an action-required email"
                        : "You have an important email";
                    await sendPushNotification(userId, supabase, {
                      title:
                        first.category === "action-required"
                          ? "Action required"
                          : "Important email",
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
                  ? newEmails.length === 1
                    ? `${first.sender}: ${first.subject}`
                    : `Latest from ${first.sender}`
                  : "You have new email";
                await sendPushNotification(userId, supabase, {
                  title:
                    newEmails.length === 1
                      ? "New email"
                      : `${newEmails.length} new emails`,
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

      // Fire-and-forget so Pub/Sub gets 200 immediately.
      // Errors are logged but do not affect the 200 ACK — Gmail stops retrying on non-2xx.
      const webhookPromise = processWebhook().catch((err) => {
        console.error("[webhook] unhandled top-level error:", err);
      });
      try {
        // deno-lint-ignore no-explicit-any
        (globalThis as any)[Symbol.for("EdgeRuntime")]?.waitUntil(
          webhookPromise,
        );
      } catch {
        await webhookPromise;
      }

      return new Response("OK", { status: 200 });
    }

    // ── All remaining routes require auth ──────────────────────────────────
    const userId = await getUserId(req);

    // ── POST /fetch-emails ─────────────────────────────────────────────────
    if (path === "/fetch-emails" && req.method === "POST") {
      let body: { initial?: boolean; ai_mode?: string } = {};
      try {
        body = await req.json();
      } catch {
        /* empty body is fine */
      }
      const isInitialFetch = body.initial === true;

      // Determine initial fetch limit by AI mode. Local/hybrid = 15 (browser
      // inference is slower), cloud = 50. If the client didn't supply ai_mode,
      // fall back to the profile.
      let initialAiMode = (body.ai_mode || "").toLowerCase();
      if (!initialAiMode) {
        const { data: profileRow } = await supabase
          .from("profiles")
          .select("ai_mode")
          .eq("id", userId)
          .single();
        initialAiMode = (
          (profileRow?.ai_mode as string) || "cloud"
        ).toLowerCase();
      }
      const initialLimit =
        initialAiMode === "local" || initialAiMode === "hybrid" ? 15 : 50;

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
              initialLimit,
              supabase,
              account.id as string,
              false,
            );
            rawEmails = result.emails;
            updatedEncryptedTokens = result.updatedEncryptedTokens;
          } else {
            const storedHistoryId = account.history_id as string | null;
            if (storedHistoryId) {
              const {
                emails: histEmails,
                newHistoryId,
                tooOld,
              } = await fetchEmailsByHistoryId(
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
          const existingGmailIds = new Set(
            (existingEmails || []).map((e) => e.gmail_id as string),
          );

          // Track senders for batch memory update (count per sender)
          const senderMap = new Map<
            string,
            { sender: string; subject: string; count: number }
          >();

          // Collect new email rows to bulk-insert in a single query
          const newEmailRows: Record<string, unknown>[] = [];
          const newEmailSenders: {
            email: string;
            sender: string;
            subject: string;
          }[] = [];

          for (const emailData of rawEmails) {
            if (existingGmailIds.has(emailData.gmail_id)) continue;
            // Skip sent mail: check both the SENT label and the sender address matching the account
            if (
              emailData.label_ids.includes("SENT") ||
              !emailData.label_ids.includes("INBOX") ||
              (account.gmail_address &&
                emailData.sender_email?.toLowerCase() ===
                  (account.gmail_address as string).toLowerCase())
            )
              continue;

            newEmailRows.push({
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

            if (emailData.sender_email) {
              newEmailSenders.push({
                email: emailData.sender_email,
                sender: emailData.sender,
                subject: emailData.subject,
              });
            }
          }

          if (newEmailRows.length > 0) {
            const { data: insertedEmails } = await supabase
              .from("emails")
              .insert(newEmailRows)
              .select("id");

            if (insertedEmails?.length) {
              allNew.push(
                ...(insertedEmails as { id: string }[]).map((e) => e.id),
              );
            }
          }

          for (const { email, sender, subject } of newEmailSenders) {
            const prev = senderMap.get(email);
            if (prev) {
              prev.count++;
              prev.subject = subject;
            } else {
              senderMap.set(email, { sender, subject, count: 1 });
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
                (existingMemory || []).map((m) => [
                  m.sender_email as string,
                  m.interaction_count as number,
                ]),
              );
              const now = new Date().toISOString();
              const upsertRows = [...senderMap.entries()].map(
                ([email, info]) => ({
                  user_id: userId,
                  sender_email: email,
                  sender_name: info.sender,
                  last_subject: info.subject,
                  last_interaction_at: now,
                  interaction_count: (memMap.get(email) ?? 0) + info.count,
                }),
              );
              await supabase
                .from("email_memory")
                .upsert(upsertRows, { onConflict: "user_id,sender_email" });
            } catch (err) {
              console.error("[analyze-inbox] email_memory upsert:", err);
            }
          }

          // Import Google Contacts into email_memory (runs every sync, upserts safely)
          try {
            const gContacts = await fetchGoogleContacts(
              account.tokens_encrypted as string,
            );
            if (gContacts.length > 0) {
              const contactRows = gContacts.map((c) => ({
                user_id: userId,
                sender_email: c.email,
                sender_name: c.name,
                interaction_count: 0,
                last_interaction_at: new Date().toISOString(),
              }));
              await supabase.from("email_memory").upsert(contactRows, {
                onConflict: "user_id,sender_email",
                ignoreDuplicates: true,
              });
              console.log(
                `[fetch-emails] upserted ${contactRows.length} Google contacts`,
              );
            }
          } catch (contactErr) {
            console.warn(
              "[fetch-emails] Google contacts import failed:",
              contactErr,
            );
          }

          // On initial fetch, import recent sent emails into DB for persistent storage
          if (isInitialFetch) {
            try {
              const sentEmails = await fetchSentEmails(
                account.tokens_encrypted as string,
                20,
              );
              const sentGmailIds = sentEmails.map((e) => e.id);
              if (sentGmailIds.length > 0) {
                const { data: existingSent } = await supabase
                  .from("emails")
                  .select("gmail_id")
                  .eq("user_id", userId)
                  .in("gmail_id", sentGmailIds);
                const existingSentIds = new Set(
                  (existingSent || []).map((e) => e.gmail_id as string),
                );
                const newSentRows = sentEmails
                  .filter((sent) => !existingSentIds.has(sent.id))
                  .map((sent) => {
                    const sentDate = new Date(sent.date);
                    return {
                      user_id: userId,
                      gmail_id: sent.id,
                      gmail_account_id: account.id,
                      subject: sent.subject,
                      recipients: sent.to,
                      body_html: sent.body_html,
                      body_text: sent.body,
                      snippet: sent.snippet,
                      received_at: isNaN(sentDate.getTime())
                        ? new Date().toISOString()
                        : sentDate.toISOString(),
                      is_read: true,
                      label_ids: ["SENT"],
                      has_attachments: sent.has_attachments ?? false,
                      attachments: sent.attachments ?? [],
                    };
                  });
                if (newSentRows.length > 0) {
                  await supabase.from("emails").insert(newSentRows);
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

      // On initial fetch, kick off analysis + briefing as a background task so
      // the frontend can return from this call immediately and start polling
      // email_processed via Realtime. This eliminates two serial HTTP round
      // trips (/analyze-inbox + /briefing) and lets the briefing LLM run
      // while the frontend is still re-fetching the inbox list for display.
      let backgroundPipeline = false;
      if (isInitialFetch && allNew.length > 0) {
        backgroundPipeline = true;
        const pipeline = (async () => {
          try {
            await analyzeEmailsForUser(userId, supabase);
          } catch (err) {
            console.error("[fetch-emails] background analysis:", err);
          }
          try {
            const normalized = await buildBriefingForUser(
              userId,
              supabase,
              "all_recent",
            );
            await supabase
              .from("profiles")
              .update({
                last_briefing: normalized,
                last_briefing_at: new Date().toISOString(),
              })
              .eq("id", userId);
          } catch (err) {
            console.error("[fetch-emails] background briefing:", err);
          }
        })();

        try {
          // deno-lint-ignore no-explicit-any
          (globalThis as any)[Symbol.for("EdgeRuntime")]?.waitUntil(pipeline);
        } catch {
          // If waitUntil isn't available in this runtime, fire and forget.
          void pipeline;
        }
      }

      return json(
        {
          fetched: allNew.length,
          email_ids: allNew,
          background_pipeline: backgroundPipeline,
        },
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
        .map(
          (e) =>
            `Subject: ${e.subject}\nTo: ${e.to}\n\n${(e.body || e.snippet || "").slice(0, 600)}`,
        )
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
      const toCheck = validateRecipients(body.to);
      if (!toCheck.ok) {
        return json({ error: toCheck.error }, 400, corsHeaders);
      }
      body.to = toCheck.emails;
      if (Array.isArray(body.cc)) {
        const ccCheck = validateRecipients(body.cc);
        if (!ccCheck.ok)
          return json({ error: ccCheck.error }, 400, corsHeaders);
        body.cc = ccCheck.emails;
      }
      if (Array.isArray(body.bcc)) {
        const bccCheck = validateRecipients(body.bcc);
        if (!bccCheck.ok)
          return json({ error: bccCheck.error }, 400, corsHeaders);
        body.bcc = bccCheck.emails;
      }
      if (!body.subject && !body.body_html) {
        return json(
          { error: "subject or body_html is required" },
          400,
          corsHeaders,
        );
      }
      if (
        body.body_html &&
        typeof body.body_html === "string" &&
        body.body_html.length > 25 * 1024 * 1024
      ) {
        return json(
          { error: "Email body exceeds 25 MB limit" },
          413,
          corsHeaders,
        );
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
        ? await supabase
            .from("gmail_accounts")
            .select("*")
            .eq("user_id", userId)
            .eq("is_active", true)
            .limit(1)
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
      const recipientEmail = emailMatch
        ? emailMatch[1].trim()
        : toRaw.split(/\s/)[0].trim();

      // Fetch style + knowledge context in parallel
      const [
        { data: styleData },
        { data: profileData },
        { data: kbData },
        { data: memData },
      ] = await Promise.all([
        supabase
          .from("style_profiles")
          .select("*")
          .eq("user_id", userId)
          .limit(1),
        supabase
          .from("profiles")
          .select("style_notes")
          .eq("id", userId)
          .single(),
        (async () => {
          // Prioritize entries relevant to the recipient, then fill with most-used entries
          const recipientDomain = recipientEmail?.split("@")[1] ?? "";
          const recipientFirstName = recipientName?.split(" ")[0] ?? "";
          const filters: string[] = [];
          if (recipientFirstName.length > 1)
            filters.push(
              `entity.ilike.%${recipientFirstName}%`,
              `info.ilike.%${recipientFirstName}%`,
            );
          if (recipientDomain.length > 3)
            filters.push(
              `entity.ilike.%${recipientDomain}%`,
              `info.ilike.%${recipientDomain}%`,
            );

          const [relevantRes, topRes] = await Promise.all([
            filters.length > 0
              ? supabase
                  .from("knowledge_base")
                  .select("entity, entity_type, info")
                  .eq("user_id", userId)
                  .or(filters.join(","))
                  .limit(10)
              : Promise.resolve({
                  data: [] as {
                    entity: string;
                    entity_type: string;
                    info: string;
                  }[],
                }),
            supabase
              .from("knowledge_base")
              .select("entity, entity_type, info")
              .eq("user_id", userId)
              .order("use_count", { ascending: false })
              .order("updated_at", { ascending: false })
              .limit(15),
          ]);

          const seen = new Set<string>();
          const merged: {
            entity: string;
            entity_type: string;
            info: string;
          }[] = [];
          for (const row of [
            ...(relevantRes.data ?? []),
            ...(topRes.data ?? []),
          ]) {
            if (!seen.has(row.entity)) {
              seen.add(row.entity);
              merged.push(row);
            }
            if (merged.length >= 20) break;
          }
          return { data: merged };
        })(),
        recipientEmail
          ? supabase
              .from("email_memory")
              .select("interaction_count, relationship_notes")
              .eq("user_id", userId)
              .eq("sender_email", recipientEmail)
              .maybeSingle()
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
        kbParts.push(
          kbData
            .map(
              (k: { entity: string; entity_type: string; info: string }) =>
                `${k.entity} (${k.entity_type}): ${k.info}`,
            )
            .join("\n"),
        );
      }
      if (memData) {
        kbParts.push(
          `Email history with ${recipientEmail}: ${memData.interaction_count} emails exchanged${memData.relationship_notes ? `. ${memData.relationship_notes}` : ""}`,
        );
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

    // ── POST /refine-draft ─────────────────────────────────────────────────
    // Refine an AI-generated draft based on user feedback. Also persists the
    // feedback as a knowledge-base entry so future drafts learn from it.
    if (path === "/refine-draft" && req.method === "POST") {
      const body = await req.json();
      const currentDraft: string = body.currentDraft ?? "";
      const feedback: string = body.feedback ?? "";
      const senderName: string = body.senderName ?? "";

      if (!currentDraft || !feedback) {
        return json(
          { error: "currentDraft and feedback are required" },
          400,
          corsHeaders,
        );
      }

      // Fetch style + top knowledge context in parallel
      const [{ data: styleData3 }, { data: profileData3 }, { data: kbData3 }] =
        await Promise.all([
          supabase
            .from("style_profiles")
            .select("*")
            .eq("user_id", userId)
            .limit(1),
          supabase
            .from("profiles")
            .select("style_notes")
            .eq("id", userId)
            .single(),
          supabase
            .from("knowledge_base")
            .select("entity, entity_type, info")
            .eq("user_id", userId)
            .order("use_count", { ascending: false })
            .order("updated_at", { ascending: false })
            .limit(10),
        ]);

      let styleContext3: string | undefined;
      if (styleData3?.[0]) {
        const s = styleData3[0];
        styleContext3 = `Greeting: ${s.greeting_style || "Hi"}. Closing: ${s.closing_style || "Best"}. Tone: ${s.tone || "professional"}.`;
      }
      if (profileData3?.style_notes) {
        styleContext3 = (styleContext3 || "") + " " + profileData3.style_notes;
      }

      const knowledgeContext3 = kbData3?.length
        ? kbData3
            .map(
              (k: { entity: string; entity_type: string; info: string }) =>
                `${k.entity} (${k.entity_type}): ${k.info}`,
            )
            .join("\n")
        : undefined;

      // Save feedback as a knowledge-base learning entry so future drafts improve
      supabase
        .from("knowledge_base")
        .insert({
          user_id: userId,
          entity: `draft_feedback_${Date.now()}`,
          entity_type: "style_preference",
          info: `Writing preference: ${feedback}`,
          source: "draft_refinement",
          importance: "normal",
          use_count: 1,
        })
        .then(({ error }) => {
          if (error)
            console.error(
              "[refine-draft] knowledge insert error:",
              error.message,
            );
        });

      const refined = await refineDraft({
        currentDraft,
        feedback,
        senderName,
        styleContext: styleContext3,
        knowledgeContext: knowledgeContext3,
      });

      return json({ draft: refined }, 200, corsHeaders);
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
      const senderName =
        e.sender?.split("<")[0]?.trim().split(" ")[0]?.toLowerCase() || "";
      const [
        { data: styleData2 },
        { data: profileData2 },
        { data: relevantKb2 },
        { data: recentKb2 },
      ] = await Promise.all([
        supabase
          .from("style_profiles")
          .select("*")
          .eq("user_id", userId)
          .limit(1),
        supabase
          .from("profiles")
          .select("style_notes")
          .eq("id", userId)
          .single(),
        senderName
          ? supabase
              .from("knowledge_base")
              .select("entity, entity_type, info")
              .eq("user_id", userId)
              .ilike("entity", `%${senderName}%`)
              .limit(10)
          : Promise.resolve({ data: [] }),
        supabase
          .from("knowledge_base")
          .select("entity, entity_type, info")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
          .limit(20),
      ]);
      const kbSeen2 = new Set(
        (relevantKb2 || []).map((k: { entity: string }) => k.entity),
      );
      const kbData2 = [
        ...(relevantKb2 || []),
        ...(recentKb2 || []).filter(
          (k: { entity: string }) => !kbSeen2.has(k.entity),
        ),
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
        knowledgeContext2 = kbData2
          .map(
            (k: { entity: string; entity_type: string; info: string }) =>
              `${k.entity} (${k.entity_type}): ${k.info}`,
          )
          .join("\n");
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
        const urlObj = new URL(req.url);
        const scopeParam = urlObj.searchParams.get("scope");
        const scopeArg =
          scopeParam &&
          ["today_new", "today_unread", "past_week", "all_recent"].includes(
            scopeParam,
          )
            ? (scopeParam as
                | "today_new"
                | "today_unread"
                | "past_week"
                | "all_recent")
            : undefined;

        const normalized = await buildBriefingForUser(
          userId,
          supabase,
          scopeArg,
        );
        return json(normalized, 200, corsHeaders);
      } catch (err) {
        console.error("Briefing error:", err);
        const errorMessage =
          (err as Error).message === "LLM_API_ERROR"
            ? "AI service temporarily unavailable. Please try again later."
            : "Could not generate briefing. Please try again later.";
        return json({ error: errorMessage }, 500, corsHeaders);
      }
    }

    // ── POST /briefing/update ── Incremental briefing update ──────────────
    if (path === "/briefing/update" && req.method === "POST") {
      try {
        const body = await req.json();
        const previousBriefing = body.previous_briefing;
        const since = body.since; // ISO timestamp: only consider emails newer than this

        if (!previousBriefing || !since) {
          return json(
            { error: "previous_briefing and since are required" },
            400,
            corsHeaders,
          );
        }

        // Fetch only NEW emails since the given timestamp, with their processed data
        const { data: newEmails } = await supabase
          .from("emails")
          .select(
            "id, subject, sender, snippet, email_processed(category, summary)",
          )
          .eq("user_id", userId)
          .gt("received_at", since)
          .order("received_at", { ascending: false })
          .limit(50);

        if (!newEmails?.length) {
          // No new emails at all, return previous briefing unchanged
          return json(
            { briefing: previousBriefing, updated: false },
            200,
            corsHeaders,
          );
        }

        // Filter to only briefing-worthy emails (skip newsletters, informational, promotional)
        const SKIP_CATEGORIES = new Set([
          "newsletter",
          "informational",
          "promotional",
        ]);
        const relevant = newEmails.filter((e: any) => {
          const p = Array.isArray(e.email_processed)
            ? e.email_processed[0]
            : e.email_processed;
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
            const p = Array.isArray(e.email_processed)
              ? e.email_processed[0]
              : e.email_processed;
            return `Subject: ${e.subject}\nFrom: ${e.sender}\nCategory: ${p?.category ?? "unknown"}\nSummary: ${p?.summary ?? e.snippet ?? ""}`;
          })
          .join("\n\n---\n\n");

        // Call the incremental update (cheaper than full rebuild)
        const updatedBriefing = await updateBriefing(
          JSON.stringify(previousBriefing),
          newEmailsText,
        );

        if (!updatedBriefing) {
          return json(
            { briefing: previousBriefing, updated: false },
            200,
            corsHeaders,
          );
        }

        const ub = updatedBriefing as Record<string, unknown>;
        let executiveSummary = String(ub.executiveSummary ?? "");
        if (briefingSummaryNeedsRecovery(executiveSummary)) {
          const lines: string[] = [];
          const cr = Array.isArray(ub.crucial)
            ? (ub.crucial as Record<string, unknown>[])
            : [];
          const rep = Array.isArray(ub.replyNeeded)
            ? (ub.replyNeeded as Record<string, unknown>[])
            : [];
          const dl = Array.isArray(ub.deadlines)
            ? (ub.deadlines as Record<string, unknown>[])
            : [];
          const ne = Array.isArray(ub.nonEssential)
            ? (ub.nonEssential as Record<string, unknown>[])
            : [];
          const tp = Array.isArray(ub.topPriority)
            ? (ub.topPriority as Record<string, unknown>[])
            : [];
          const wr = Array.isArray(ub.waitingForReply)
            ? (ub.waitingForReply as Record<string, unknown>[])
            : [];
          if (cr.length || rep.length || dl.length || ne.length) {
            lines.push(
              `Buckets: crucial=${cr.length}, replyNeeded=${rep.length}, deadlines=${dl.length}, nonEssential=${ne.length}.`,
            );
            const pick = (
              arr: Record<string, unknown>[],
              label: string,
              n: number,
            ) => {
              for (let i = 0; i < Math.min(n, arr.length); i++) {
                const c = arr[i];
                lines.push(
                  `[${label}] ${String(c.subject ?? "")} (from ${String(c.sender ?? "")})`,
                );
              }
            };
            pick(rep, "reply", 8);
            pick(dl, "deadline", 5);
            pick(cr, "crucial", 8);
          } else {
            lines.push(
              `Legacy shape: ${tp.length} top priority, ${wr.length} waiting for reply.`,
            );
            for (let i = 0; i < Math.min(8, tp.length); i++) {
              const c = tp[i];
              lines.push(
                `[priority] ${String(c.subject ?? "")} (from ${String(c.sender ?? "")})`,
              );
            }
            for (let i = 0; i < Math.min(5, wr.length); i++) {
              const c = wr[i];
              lines.push(
                `[waiting] ${String(c.subject ?? "")} (from ${String(c.sender ?? "")})`,
              );
            }
          }
          try {
            executiveSummary = await generateBriefingExecutiveSummary(
              lines.join("\n"),
            );
          } catch {
            executiveSummary =
              "Briefing updated; review sections for what changed.";
          }
        }

        // Normalize the structure (v1 fields + optional v2 arrays from the model)
        const normalized: Record<string, unknown> = {
          executiveSummary,
          topPriority: (updatedBriefing as any).topPriority || [],
          deadlines: (updatedBriefing as any).deadlines || [],
          waitingForReply: (updatedBriefing as any).waitingForReply || [],
          stats: (updatedBriefing as any).stats || previousBriefing.stats || {},
        };
        if (Array.isArray(ub.crucial)) normalized.crucial = ub.crucial;
        if (Array.isArray(ub.replyNeeded))
          normalized.replyNeeded = ub.replyNeeded;
        if (Array.isArray(ub.nonEssential)) {
          normalized.nonEssential = ub.nonEssential;
        }

        // Attach email_id to new cards; preserve existing email_id on carried-over cards
        const newSubjectToId = new Map<string, string>();
        for (const e of newEmails) {
          newSubjectToId.set(
            ((e as any).subject ?? "").toLowerCase(),
            (e as any).id,
          );
        }
        const attachIdsUpdate = (cards: any[]) =>
          cards.map((card) => {
            if (card.email_id) return card; // already set from previous briefing
            const key = (card.subject ?? "").toLowerCase();
            let id = newSubjectToId.get(key);
            if (!id) {
              for (const [s, eid] of newSubjectToId) {
                if (s.includes(key) || key.includes(s)) {
                  id = eid;
                  break;
                }
              }
            }
            return id ? { ...card, email_id: id } : card;
          });
        normalized.topPriority = attachIdsUpdate(
          normalized.topPriority as any[],
        );
        normalized.waitingForReply = attachIdsUpdate(
          normalized.waitingForReply as any[],
        );
        if (Array.isArray(normalized.crucial)) {
          normalized.crucial = attachIdsUpdate(normalized.crucial as any[]);
        }
        if (Array.isArray(normalized.replyNeeded)) {
          normalized.replyNeeded = attachIdsUpdate(
            normalized.replyNeeded as any[],
          );
        }
        if (Array.isArray(normalized.nonEssential)) {
          normalized.nonEssential = attachIdsUpdate(
            normalized.nonEssential as any[],
          );
        }

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
      const durationMin = parseInt(
        url.searchParams.get("duration") || "30",
        10,
      );
      const dateParam = url.searchParams.get("date"); // YYYY-MM-DD
      const timezone = url.searchParams.get("timezone") || "UTC";

      const now = new Date();

      // Helper: convert a local date+time in the user's timezone to a UTC Date.
      // Works by computing the offset Intl reports for a UTC guess, then correcting.
      function zonedToUtc(
        year: number,
        month: number,
        day: number,
        hour: number,
        minute: number,
        tz: string,
      ): Date {
        const guess = new Date(Date.UTC(year, month, day, hour, minute, 0, 0));
        const fmt = new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          year: "numeric",
          month: "numeric",
          day: "numeric",
          hour: "numeric",
          minute: "numeric",
          hour12: false,
        });
        const parts = Object.fromEntries(
          fmt.formatToParts(guess).map((p) => [p.type, p.value]),
        );
        const tzMs = Date.UTC(
          parseInt(parts.year),
          parseInt(parts.month) - 1,
          parseInt(parts.day),
          parseInt(parts.hour) % 24,
          parseInt(parts.minute),
        );
        return new Date(guess.getTime() + (guess.getTime() - tzMs));
      }

      // Parse the requested date components
      const today = new Date();
      const [y, mo, d] = dateParam
        ? dateParam.split("-").map(Number)
        : [today.getFullYear(), today.getMonth() + 1, today.getDate()];

      // Day of week for the requested date in the user's timezone
      // Use noon UTC of the date components so there is no day-boundary ambiguity
      const noonUtc = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
      const dowFmt = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        weekday: "short",
      });
      const dowStr = dowFmt.format(noonUtc);
      const dowMap: Record<string, number> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
      };
      const dayOfWeek = dowMap[dowStr] ?? noonUtc.getDay();

      // Query freeBusy for the full target day in the user's timezone
      const dayMin = zonedToUtc(y, mo - 1, d, 0, 0, timezone);
      const dayMax = zonedToUtc(y, mo - 1, d, 23, 59, timezone);
      dayMax.setSeconds(59, 999);

      const busyRes = await fetch(
        "https://www.googleapis.com/calendar/v3/freeBusy",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            timeMin: dayMin.toISOString(),
            timeMax: dayMax.toISOString(),
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

      // Return empty if not a working day (checked in user's timezone)
      if (!(wh.days || [1, 2, 3, 4, 5]).includes(dayOfWeek)) {
        return json({ slots: [] }, 200, corsHeaders);
      }

      // Working hours as UTC timestamps for the target date in user's timezone
      const [startH, startM] = (wh.start || "09:00").split(":").map(Number);
      const [endH, endM] = (wh.end || "17:00").split(":").map(Number);
      const slotMs = durationMin * 60000;
      const stepMs = 15 * 60000;

      const dayStart = zonedToUtc(y, mo - 1, d, startH, startM, timezone);
      const dayEnd = zonedToUtc(y, mo - 1, d, endH, endM, timezone);

      // Clamp to now for today
      if (dayStart < now) {
        dayStart.setTime(Math.max(dayStart.getTime(), now.getTime()));
      }

      // Round up to next 15-min mark (in UTC ms, which aligns with any tz)
      const rawMinutes = Math.floor(dayStart.getTime() / (15 * 60000));
      dayStart.setTime(
        (rawMinutes + (dayStart.getTime() % (15 * 60000) > 0 ? 1 : 0)) *
          15 *
          60000,
      );

      // Generate all free slots for the target date (no cap)
      const slots: { start: string; end: string }[] = [];

      for (
        let t = dayStart.getTime();
        t + slotMs <= dayEnd.getTime();
        t += stepMs
      ) {
        const slotStart = new Date(t);
        const slotEnd = new Date(t + slotMs);

        const isBusy = busyPeriods.some((b: { start: string; end: string }) => {
          const bs = new Date(b.start).getTime();
          const be = new Date(b.end).getTime();
          return slotStart.getTime() < be && slotEnd.getTime() > bs;
        });

        if (!isBusy) {
          slots.push({
            start: slotStart.toISOString(),
            end: slotEnd.toISOString(),
          });
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
      const sendUpdates =
        calProfile?.calendar_send_invites === false ? "none" : "all";

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
        try {
          console.error(
            `[calendar/create-event] google error status=${calRes.status} body=${await calRes.text()}`,
          );
        } catch {
          /* ignore */
        }
        return json({ error: "Calendar API error" }, 400, corsHeaders);
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
      const sendUpdatesVal =
        calUpdateProfile?.calendar_send_invites === false ? "none" : "all";

      const patch: Record<string, unknown> = {};
      if (body.title) patch.summary = body.title;
      if (body.description !== undefined) patch.description = body.description;
      if (body.start_time)
        patch.start = {
          dateTime: body.start_time,
          timeZone: body.timezone || "UTC",
        };
      if (body.end_time)
        patch.end = {
          dateTime: body.end_time,
          timeZone: body.timezone || "UTC",
        };
      if (body.location !== undefined) patch.location = body.location;
      if (body.attendees)
        patch.attendees = body.attendees.map((email: string) => ({ email }));

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
        try {
          console.error(
            `[calendar/update-event] google error status=${calRes.status} body=${await calRes.text()}`,
          );
        } catch {
          /* ignore */
        }
        return json({ error: "Calendar API error" }, 400, corsHeaders);
      }

      const calEvent = await calRes.json();
      return json(
        { event_id: calEvent.id, html_link: calEvent.htmlLink },
        200,
        corsHeaders,
      );
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
        try {
          console.error(
            `[zoom/create-meeting] zoom error status=${meetingRes.status} body=${await meetingRes.text()}`,
          );
        } catch {
          /* ignore */
        }
        return json({ error: "Zoom API error" }, 400, corsHeaders);
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
        const uiRes = await fetch(
          "https://www.googleapis.com/oauth2/v2/userinfo",
          {
            headers: { Authorization: `Bearer ${provider_token}` },
          },
        );
        if (uiRes.ok) {
          const ui = await uiRes.json();
          gmailAddress = ui.email ?? "";
        }
      } catch {
        /* fallback below */
      }

      if (!gmailAddress) {
        const { data: profileRow } = await supabase
          .from("profiles")
          .select("email")
          .eq("id", userId)
          .single();
        gmailAddress = (profileRow?.email as string) ?? "";
      }

      if (add_account) {
        // Upsert this account without removing existing ones
        await supabase.from("gmail_accounts").upsert(
          {
            user_id: userId,
            gmail_address: gmailAddress,
            tokens_encrypted: tokensJson,
            is_active: true,
          },
          { onConflict: "user_id,gmail_address" },
        );
      } else {
        // Re-connect: replace only this specific address (or all if first time)
        const { data: existing } = await supabase
          .from("gmail_accounts")
          .select("id")
          .eq("user_id", userId)
          .eq("gmail_address", gmailAddress);
        if (existing?.length) {
          const existingId = existing[0].id as string;
          // Clear stale emails so reconnect always starts fresh with current inbox
          await supabase
            .from("emails")
            .delete()
            .eq("gmail_account_id", existingId);
          await supabase
            .from("gmail_accounts")
            .update({
              tokens_encrypted: tokensJson,
              is_active: true,
              history_id: null,
            })
            .eq("id", existingId);
        } else {
          // First time connecting — remove any stale placeholder rows and insert
          await supabase
            .from("gmail_accounts")
            .delete()
            .eq("user_id", userId)
            .eq("gmail_address", "");
          await supabase.from("gmail_accounts").insert({
            user_id: userId,
            gmail_address: gmailAddress,
            tokens_encrypted: tokensJson,
            is_active: true,
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
        .select("subject, sender, body_text, snippet")
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

      if (!tasks.length) {
        return json({ todos: [], count: 0 }, 200, corsHeaders);
      }

      const { data: inserted, error: insertErr } = await supabase
        .from("todos")
        .insert(
          tasks.map((text: string) => ({
            user_id: userId,
            text,
            source: "email",
          })),
        )
        .select();

      if (insertErr) throw insertErr;

      return json(
        { todos: inserted ?? [], count: (inserted ?? []).length },
        200,
        corsHeaders,
      );
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

    // ── GET /contacts/search ───────────────────────────────────────────────
    // Live contact search via Google People API (directory + personal contacts).
    if (path === "/contacts/search" && req.method === "GET") {
      const query = url.searchParams.get("q") ?? "";
      const accountId = url.searchParams.get("account_id") ?? "";
      if (query.length < 2 || !accountId) {
        return json({ contacts: [] }, 200, corsHeaders);
      }
      const { data: account } = await supabase
        .from("gmail_accounts")
        .select("tokens_encrypted")
        .eq("id", accountId)
        .eq("user_id", userId)
        .single();
      if (!account?.tokens_encrypted) {
        return json({ contacts: [] }, 200, corsHeaders);
      }
      const contacts = await searchGoogleContacts(
        account.tokens_encrypted,
        query,
      );
      return json({ contacts }, 200, corsHeaders);
    }

    // ── GET /oauth/google-url ──────────────────────────────────────────────
    // Returns a direct Google OAuth URL so the frontend can add a Gmail account
    // WITHOUT creating a new Supabase session (which would log the user out).
    // Validates redirect_uri against the allowlist and mints a signed, single-
    // use state tying the flow to this userId.
    if (path === "/oauth/google-url" && req.method === "GET") {
      const redirectUri = url.searchParams.get("redirect_uri") || "";
      if (!isAllowedAddGmailRedirect(redirectUri)) {
        return json({ error: "redirect_uri not allowed" }, 400, corsHeaders);
      }
      const state = await signOauthState({ userId, redirect_uri: redirectUri });
      const params = new URLSearchParams({
        client_id: getEnv("GOOGLE_CLIENT_ID"),
        redirect_uri: redirectUri,
        response_type: "code",
        scope: [
          "email",
          "profile",
          "https://www.googleapis.com/auth/gmail.modify",
          "https://www.googleapis.com/auth/calendar",
          "https://www.googleapis.com/auth/contacts.readonly",
          "https://www.googleapis.com/auth/directory.readonly",
        ].join(" "),
        access_type: "offline",
        prompt: "consent select_account",
        state,
        include_granted_scopes: "true",
      });
      return json(
        {
          url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
          state,
        },
        200,
        corsHeaders,
      );
    }

    // ── POST /oauth/add-gmail ──────────────────────────────────────────────
    // Exchanges a Google auth code server-side and links the Gmail account to
    // the authenticated user — no Supabase session created for the new account.
    if (path === "/oauth/add-gmail" && req.method === "POST") {
      const body = await req.json();
      const { code, redirect_uri, state } = body as {
        code: string;
        redirect_uri: string;
        state?: string;
      };
      if (!code || !redirect_uri) {
        return json(
          { error: "Missing code or redirect_uri" },
          400,
          corsHeaders,
        );
      }
      if (!isAllowedAddGmailRedirect(redirect_uri)) {
        return json({ error: "redirect_uri not allowed" }, 400, corsHeaders);
      }
      // Verify signed state: binds the code exchange to the user who started
      // the flow and the exact redirect_uri they were issued.
      const stateOk = state
        ? await verifyOauthState(state, {
            userId,
            redirect_uri,
          })
        : false;
      if (!stateOk) {
        return json(
          { error: "Invalid or expired OAuth state" },
          400,
          corsHeaders,
        );
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
        try {
          console.error(
            `[oauth/add-gmail] token exchange failed status=${tokenRes.status} body=${await tokenRes.text()}`,
          );
        } catch {
          /* ignore */
        }
        return json({ error: "Token exchange failed" }, 400, corsHeaders);
      }
      const tokens = (await tokenRes.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      // Get Gmail address from Google
      let gmailAddress = "";
      try {
        const uiRes = await fetch(
          "https://www.googleapis.com/oauth2/v2/userinfo",
          {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
          },
        );
        if (uiRes.ok) {
          const ui = await uiRes.json();
          gmailAddress = ui.email ?? "";
        }
      } catch {
        /* ignore */
      }

      if (!gmailAddress) {
        return json(
          { error: "Could not retrieve Gmail address" },
          400,
          corsHeaders,
        );
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

      return json(
        { registered: true, gmail_address: gmailAddress },
        200,
        corsHeaders,
      );
    }

    // ── POST /remove-gmail-account ─────────────────────────────────────────
    if (path === "/remove-gmail-account" && req.method === "POST") {
      const body = await req.json();
      const accountId = body.account_id as string;
      if (!accountId)
        return json({ error: "Missing account_id" }, 400, corsHeaders);
      // Best-effort Google token revocation. Ignoring failures is intentional;
      // the user-visible effect is the row being deactivated regardless.
      try {
        const { data: acct } = await supabase
          .from("gmail_accounts")
          .select("tokens_encrypted")
          .eq("id", accountId)
          .eq("user_id", userId)
          .maybeSingle();
        if (acct?.tokens_encrypted) {
          const { revokeGoogleTokens } = await import("../_shared/gmail.ts");
          await revokeGoogleTokens(acct.tokens_encrypted as string);
        }
      } catch (err) {
        console.error("[remove-gmail-account] revoke error:", err);
      }
      // Soft-delete: mark inactive so data is preserved and can be restored on re-link
      await supabase
        .from("gmail_accounts")
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
      if (!accountId)
        return json({ error: "Missing account_id" }, 400, corsHeaders);

      // Verify the account belongs to this user
      const { data: account } = await supabase
        .from("gmail_accounts")
        .select("id, tokens_encrypted")
        .eq("id", accountId)
        .eq("user_id", userId)
        .single();
      if (!account)
        return json({ error: "Account not found" }, 404, corsHeaders);

      // Best-effort Google token revocation before we delete local data.
      try {
        if (account.tokens_encrypted) {
          const { revokeGoogleTokens } = await import("../_shared/gmail.ts");
          await revokeGoogleTokens(account.tokens_encrypted as string);
        }
      } catch (err) {
        console.error("[delete-account] revoke error:", err);
      }

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
      await supabase
        .from("scheduled_emails")
        .delete()
        .eq("gmail_account_id", accountId);

      // Delete emails (cascades email_processed)
      await supabase
        .from("emails")
        .delete()
        .eq("gmail_account_id", accountId)
        .eq("user_id", userId);

      // Hard-delete the gmail account itself
      const { error: accErr } = await supabase
        .from("gmail_accounts")
        .delete()
        .eq("id", accountId)
        .eq("user_id", userId);

      if (accErr) {
        return json(
          { error: "Failed to delete account: " + accErr.message },
          500,
          corsHeaders,
        );
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
        return json(
          { error: "Failed to delete data: " + deleteErr.message },
          500,
          corsHeaders,
        );
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
      const { message, history = [], timezone = "UTC" } = await req.json();

      if (!message?.trim()) {
        return json({ error: "Message required" }, 400, corsHeaders);
      }

      // Load only what's needed for the system prompt; everything else is fetched on demand by the AI via tools.
      const [styleResult, profileResult] = await Promise.all([
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
        userDisplayName:
          (profileResult.data as { display_name?: string } | null)
            ?.display_name || "User",
        timezone: timezone as string,
        styleProfile: styleResult.data as ChatContext["styleProfile"],
      };

      console.log(
        "[chat] calling chatWithAssistant, provider:",
        (Deno as any).env.get("AI_PROVIDER") || "openrouter",
        "key present:",
        !!(
          (Deno as any).env.get("OPENROUTER_API_KEY") ||
          (Deno as any).env.get("CEREBRAS_API_KEY")
        ),
      );
      const { reply, tool_calls } = await chatWithAssistant(
        context,
        message,
        history,
        supabase,
        userId,
      );
      console.log(
        "[chat] tool_calls returned:",
        JSON.stringify(
          tool_calls.map((t) => ({ name: t.name, args: t.arguments })),
        ),
      );

      // Execute tool calls (search_emails is handled in-memory by chatWithAssistant)
      const actions: { type: string; data: Record<string, unknown> }[] = [];

      // Convert a local-time ISO (no offset) + IANA timezone to a UTC ISO
      // string so stored timestamps match what Google Calendar records.
      const userTimezone = (timezone as string) || "UTC";
      const hasOffset = (s: string) => /Z$|[+-]\d{2}:?\d{2}$/.test(s.trim());
      const toUtcIso = (local: string, tz: string): string => {
        if (hasOffset(local)) return new Date(local).toISOString();
        try {
          const m = local.match(
            /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/,
          );
          if (!m) return new Date(local).toISOString();
          const [, y, mo, d, h, mi, s] = m;
          let utc = Date.UTC(
            Number(y),
            Number(mo) - 1,
            Number(d),
            Number(h),
            Number(mi),
            s ? Number(s) : 0,
          );
          const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: tz,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          }).formatToParts(new Date(utc));
          const pick = (t: string) =>
            Number(parts.find((p) => p.type === t)?.value);
          const zoned = Date.UTC(
            pick("year"),
            pick("month") - 1,
            pick("day"),
            pick("hour") % 24,
            pick("minute"),
            pick("second"),
          );
          utc += utc - zoned;
          return new Date(utc).toISOString();
        } catch {
          return new Date(local).toISOString();
        }
      };

      for (const tc of tool_calls) {
        if (tc.name === "create_todo") {
          const args = tc.arguments as { text: string };
          console.log("[chat/create_todo] inserting:", args.text);
          const { data: todo, error: todoErr } = await supabase
            .from("todos")
            .insert({ user_id: userId, text: args.text, source: "assistant" })
            .select("id")
            .single();
          if (todoErr) console.error("[chat/create_todo] error:", todoErr);
          if (todo)
            actions.push({
              type: "create_todo",
              data: { text: args.text, id: (todo as { id: string }).id },
            });
        } else if (tc.name === "save_draft") {
          const args = tc.arguments as {
            to: string;
            subject: string;
            body: string;
          };
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
          if (draft)
            actions.push({
              type: "save_draft",
              data: {
                subject: args.subject,
                to: args.to,
                id: (draft as { id: string }).id,
              },
            });
        } else if (tc.name === "add_knowledge") {
          const args = tc.arguments as {
            entity: string;
            entity_type: string;
            info: string;
          };
          await supabase.from("knowledge_base").upsert(
            {
              user_id: userId,
              entity: args.entity,
              entity_type: args.entity_type,
              info: args.info,
              source: "assistant",
              confidence: 1.0,
            },
            { onConflict: "user_id,entity,entity_type" },
          );
          actions.push({ type: "add_knowledge", data: args });
        } else if (tc.name === "create_tag") {
          const args = tc.arguments as {
            display_name: string;
            slug: string;
            color?: string;
          };
          const { data: tag, error: tagErr } = await supabase
            .from("categories")
            .insert({
              user_id: userId,
              slug: args.slug,
              display_name: args.display_name,
              color: args.color ?? "#6b7280",
            })
            .select("id")
            .single();
          if (tagErr) console.error("[chat/create_tag] error:", tagErr);
          if (tag)
            actions.push({
              type: "create_tag",
              data: {
                display_name: args.display_name,
                slug: args.slug,
                color: args.color ?? "#6b7280",
                id: (tag as { id: string }).id,
              },
            });
        } else if (tc.name === "send_email") {
          const args = tc.arguments as {
            to: string;
            subject: string;
            body: string;
          };
          console.log(
            "[chat/send_email] attempting to send to:",
            args.to,
            "subject:",
            args.subject,
          );
          const toCheck = validateRecipients(
            typeof args.to === "string" ? [args.to] : args.to,
          );
          if (!toCheck.ok) {
            actions.push({
              type: "send_email_failed",
              data: { error: toCheck.error ?? "Invalid recipient" },
            });
            continue;
          }
          if (!args.subject || typeof args.subject !== "string") {
            actions.push({
              type: "send_email_failed",
              data: { error: "Missing subject" },
            });
            continue;
          }
          try {
            // Get Gmail account for sending
            const { data: accounts, error: accountErr } = await supabase
              .from("gmail_accounts")
              .select("*")
              .eq("user_id", userId)
              .eq("is_active", true)
              .limit(1);
            if (accountErr)
              console.error(
                "[chat/send_email] account lookup error:",
                accountErr,
              );
            console.log(
              "[chat/send_email] accounts found:",
              accounts?.length ?? 0,
            );
            const account = accounts?.[0];
            if (account) {
              const result = await sendEmail(
                account.tokens_encrypted as string,
                toCheck.emails!,
                args.subject,
                (args.body ?? "").replace(/\n/g, "<br>"),
              );
              console.log("[chat/send_email] sent OK, message_id:", result.id);
              actions.push({
                type: "send_email",
                data: {
                  to: args.to,
                  subject: args.subject,
                  message_id: result.id,
                },
              });
            } else {
              console.error(
                "[chat/send_email] no active Gmail account found for userId:",
                userId,
              );
              actions.push({
                type: "send_email_failed",
                data: { error: "No Gmail account connected" },
              });
            }
          } catch (err) {
            console.error("[chat/send_email] error:", err);
            actions.push({
              type: "send_email_failed",
              data: { error: String(err) },
            });
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
              actions.push({
                type: "send_email_failed",
                data: { error: "No Gmail account connected" },
              });
            } else {
              // Fetch original email for threading headers
              const { data: original } = await supabase
                .from("emails")
                .select("subject, sender_email, gmail_id, thread_id")
                .eq("id", args.email_id)
                .eq("user_id", userId)
                .maybeSingle();
              if (!original) {
                actions.push({
                  type: "send_email_failed",
                  data: { error: "Original email not found" },
                });
              } else {
                const subject = (original as any).subject?.startsWith("Re:")
                  ? (original as any).subject
                  : `Re: ${(original as any).subject}`;
                const result = await sendEmail(
                  account.tokens_encrypted as string,
                  [(original as any).sender_email],
                  subject,
                  args.body.replace(/\n/g, "<br>"),
                  (original as any).gmail_id,
                  (original as any).thread_id,
                );
                actions.push({
                  type: "send_email",
                  data: {
                    to: (original as any).sender_email,
                    subject,
                    message_id: result.id,
                  },
                });
              }
            }
          } catch (err) {
            actions.push({
              type: "send_email_failed",
              data: { error: String(err) },
            });
          }
        } else if (tc.name === "update_todo") {
          const args = tc.arguments as {
            id: string;
            text?: string;
            is_completed?: boolean;
          };
          const updates: Record<string, unknown> = {};
          if (args.text !== undefined) updates.text = args.text;
          if (args.is_completed !== undefined)
            updates.is_completed = args.is_completed;
          await supabase
            .from("todos")
            .update(updates)
            .eq("id", args.id)
            .eq("user_id", userId);
          actions.push({ type: "update_todo", data: tc.arguments });
        } else if (tc.name === "delete_todo") {
          const args = tc.arguments as { id: string };
          await supabase
            .from("todos")
            .delete()
            .eq("id", args.id)
            .eq("user_id", userId);
          actions.push({ type: "delete_todo", data: tc.arguments });
        } else if (tc.name === "update_meeting") {
          const args = tc.arguments as {
            id: string;
            title?: string;
            start_time?: string;
            end_time?: string;
            attendees?: string[];
          };
          const updates: Record<string, unknown> = {};
          if (args.title) updates.title = args.title;
          if (args.start_time)
            updates.start_time = toUtcIso(args.start_time, userTimezone);
          if (args.end_time)
            updates.end_time = toUtcIso(args.end_time, userTimezone);
          if (args.attendees) updates.attendees = args.attendees;
          await supabase
            .from("meetings")
            .update(updates)
            .eq("id", args.id)
            .eq("user_id", userId);
          actions.push({ type: "update_meeting", data: tc.arguments });
        } else if (tc.name === "delete_meeting") {
          const args = tc.arguments as { id: string };
          await supabase
            .from("meetings")
            .delete()
            .eq("id", args.id)
            .eq("user_id", userId);
          actions.push({ type: "delete_meeting", data: tc.arguments });
        } else if (tc.name === "delete_draft") {
          const args = tc.arguments as { id: string };
          await supabase
            .from("draft_emails")
            .delete()
            .eq("id", args.id)
            .eq("user_id", userId);
          actions.push({ type: "delete_draft", data: tc.arguments });
        } else if (tc.name === "archive_email") {
          const args = tc.arguments as { email_id: string };
          await supabase
            .from("emails")
            .update({ is_archived: true })
            .eq("id", args.email_id)
            .eq("user_id", userId);
          actions.push({ type: "archive_email", data: tc.arguments });
        } else if (tc.name === "suggest_reply_options") {
          const args = tc.arguments as {
            options: { label: string; description: string }[];
            recommended: number;
            context?: string;
          };
          actions.push({
            type: "suggest_options",
            data: {
              options: args.options,
              recommended: args.recommended,
              context: args.context ?? "",
            },
          });
        } else if (tc.name === "create_meeting") {
          const args = tc.arguments as {
            title: string;
            start_time: string;
            end_time: string;
            attendees?: string[];
            description?: string;
            include_zoom?: boolean;
          };
          const userTz = (timezone as string) || "UTC";
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
                        Authorization:
                          "Basic " +
                          btoa(`${zoomClientId}:${zoomClientSecret}`),
                        "Content-Type": "application/x-www-form-urlencoded",
                      },
                    },
                  );
                  if (tokenRes.ok) {
                    const tokenData = await tokenRes.json();
                    // Calculate duration in minutes from start/end
                    const startMs = new Date(args.start_time).getTime();
                    const endMs = new Date(args.end_time).getTime();
                    const duration = Math.max(
                      15,
                      Math.round((endMs - startMs) / 60000),
                    );
                    const meetingRes = await fetch(
                      "https://api.zoom.us/v2/users/me/meetings",
                      {
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
                          settings: {
                            join_before_host: true,
                            waiting_room: false,
                          },
                        }),
                      },
                    );
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

            const startDt = args.start_time.includes("T")
              ? args.start_time
              : args.start_time + "T00:00:00";
            const endDt = args.end_time.includes("T")
              ? args.end_time
              : args.end_time + "T00:00:00";

            // AI returns local times (no offset); convert to UTC ISO for DB.
            const startIso = toUtcIso(startDt, userTz);
            const endIso = toUtcIso(endDt, userTz);

            const accessToken = await getCalendarAccessTokenSafe(
              supabase,
              userId,
            );
            if (accessToken) {
              const { data: calProfile } = await supabase
                .from("profiles")
                .select("calendar_send_invites")
                .eq("id", userId)
                .single();
              const sendUpdates =
                calProfile?.calendar_send_invites === false ? "none" : "all";

              const event: Record<string, unknown> = {
                summary: args.title,
                description:
                  (args.description || "") +
                  (zoomLink ? `\n\nZoom: ${zoomLink}` : ""),
                start: { dateTime: startDt, timeZone: userTz },
                end: { dateTime: endDt, timeZone: userTz },
                location: zoomLink || "",
              };
              if (args.attendees?.length) {
                event.attendees = args.attendees.map((email: string) => ({
                  email,
                }));
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
              if (calRes.ok) {
                const calEvent = await calRes.json();
                await supabase.from("meetings").insert({
                  user_id: userId,
                  title: args.title,
                  start_time: startIso,
                  end_time: endIso,
                  attendees: args.attendees ?? [],
                  description: args.description || "",
                  calendar_event_id: calEvent.id,
                  zoom_link: zoomLink,
                  status: "confirmed",
                });
                actions.push({
                  type: "create_meeting",
                  data: {
                    title: args.title,
                    start_time: startIso,
                    attendees: args.attendees,
                    zoom_link: zoomLink,
                  },
                });
              } else {
                try {
                  console.error(
                    `[chat/create-meeting] google error status=${calRes.status} body=${await calRes.text()}`,
                  );
                } catch {
                  /* ignore */
                }
                actions.push({
                  type: "create_meeting_failed",
                  data: { error: "Calendar API error" },
                });
              }
            } else {
              await supabase.from("meetings").insert({
                user_id: userId,
                title: args.title,
                start_time: startIso,
                end_time: endIso,
                attendees: args.attendees ?? [],
                description: args.description || "",
                zoom_link: zoomLink,
                status: "proposed",
              });
              actions.push({
                type: "create_meeting",
                data: {
                  title: args.title,
                  start_time: startIso,
                  attendees: args.attendees,
                  zoom_link: zoomLink,
                },
              });
            }
          } catch (err) {
            actions.push({
              type: "create_meeting_failed",
              data: { error: String(err) },
            });
          }
        }
      }

      // Note: knowledge use_count is incremented by the search_knowledge_base tool
      // inside chatWithAssistant when entries are explicitly searched and returned.

      return json({ reply, actions }, 200, corsHeaders);
    }

    // ── POST /push/subscribe — store a browser Web Push subscription ──────
    if (path === "/push/subscribe" && req.method === "POST") {
      const { endpoint, p256dh, auth } = await req.json();
      if (!endpoint || !p256dh || !auth) {
        return json({ error: "Missing required fields" }, 400, corsHeaders);
      }
      await supabase
        .from("push_subscriptions")
        .upsert(
          { user_id: userId, endpoint, p256dh, auth },
          { onConflict: "user_id,endpoint" },
        );
      return json({ ok: true }, 200, corsHeaders);
    }

    // ── DELETE /push/subscribe — remove a Web Push subscription ───────────
    if (path === "/push/subscribe" && req.method === "DELETE") {
      const { endpoint } = await req.json().catch(() => ({}));
      if (endpoint) {
        await supabase
          .from("push_subscriptions")
          .delete()
          .eq("user_id", userId)
          .eq("endpoint", endpoint);
      }
      return json({ ok: true }, 200, corsHeaders);
    }

    // ── GET /follow-ups — list follow-up reminders ────────────────────────
    if (path === "/follow-ups" && req.method === "GET") {
      const { data, error } = await supabase
        .from("follow_up_reminders")
        .select("*")
        .eq("user_id", userId)
        .order("remind_at", { ascending: true });
      if (error) return json({ error: error.message }, 500, corsHeaders);
      return json({ followUps: data ?? [] }, 200, corsHeaders);
    }

    // ── POST /follow-ups — create a follow-up reminder ────────────────────
    if (path === "/follow-ups" && req.method === "POST") {
      const {
        email_id,
        thread_id,
        recipient_email,
        recipient_name,
        subject,
        remind_at,
      } = await req.json();
      if (!thread_id || !recipient_email || !subject || !remind_at) {
        return json({ error: "Missing required fields" }, 400, corsHeaders);
      }
      const { data, error } = await supabase
        .from("follow_up_reminders")
        .upsert(
          {
            user_id: userId,
            email_id: email_id ?? null,
            thread_id,
            recipient_email,
            recipient_name: recipient_name ?? null,
            subject,
            remind_at,
            status: "waiting",
          },
          { onConflict: "user_id,thread_id" },
        )
        .select("*")
        .single();
      if (error) return json({ error: error.message }, 500, corsHeaders);
      return json({ followUp: data }, 200, corsHeaders);
    }

    // ── PATCH /follow-ups/:id — update a follow-up reminder ───────────────
    if (path.startsWith("/follow-ups/") && req.method === "PATCH") {
      const followUpId = path.replace("/follow-ups/", "");
      if (!UUID_RE.test(followUpId))
        return json({ error: "Invalid id" }, 400, corsHeaders);
      const patch = await req.json();
      const allowed: Record<string, unknown> = {};
      for (const k of ["status", "snooze_until", "remind_at"]) {
        if (k in patch) allowed[k] = patch[k];
      }
      const { data, error } = await supabase
        .from("follow_up_reminders")
        .update(allowed)
        .eq("id", followUpId)
        .eq("user_id", userId)
        .select("*")
        .single();
      if (error) return json({ error: error.message }, 500, corsHeaders);
      return json({ followUp: data }, 200, corsHeaders);
    }

    // ── DELETE /follow-ups/:id — delete a follow-up reminder ──────────────
    if (path.startsWith("/follow-ups/") && req.method === "DELETE") {
      const followUpId = path.replace("/follow-ups/", "");
      if (!UUID_RE.test(followUpId))
        return json({ error: "Invalid id" }, 400, corsHeaders);
      await supabase
        .from("follow_up_reminders")
        .delete()
        .eq("id", followUpId)
        .eq("user_id", userId);
      return json({ ok: true }, 200, corsHeaders);
    }

    // ── GET /signatures — list all signatures for user ────────────────────
    if (path === "/signatures" && req.method === "GET") {
      const { data, error } = await supabase
        .from("email_signatures")
        .select("id, name, html, is_default, gmail_account_id, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (error) return json({ error: error.message }, 500, corsHeaders);
      return json({ signatures: data ?? [] }, 200, corsHeaders);
    }

    // ── POST /signatures — create a new signature ─────────────────────────
    if (path === "/signatures" && req.method === "POST") {
      const { name, html, is_default, gmail_account_id } = await req.json();
      if (!name?.trim())
        return json({ error: "Name is required" }, 400, corsHeaders);
      // If setting as default, clear existing default for this account scope first
      if (is_default) {
        await supabase
          .from("email_signatures")
          .update({ is_default: false })
          .eq("user_id", userId)
          .eq("is_default", true)
          .eq("gmail_account_id", gmail_account_id ?? null);
      }
      const { data, error } = await supabase
        .from("email_signatures")
        .insert({
          user_id: userId,
          name: name.trim(),
          html: html ?? "",
          is_default: !!is_default,
          gmail_account_id: gmail_account_id ?? null,
        })
        .select("id, name, html, is_default, gmail_account_id, created_at")
        .single();
      if (error) return json({ error: error.message }, 500, corsHeaders);
      return json({ signature: data }, 200, corsHeaders);
    }

    // ── PATCH /signatures/:id — update a signature ────────────────────────
    if (path.startsWith("/signatures/") && req.method === "PATCH") {
      const sigId = path.replace("/signatures/", "");
      if (!UUID_RE.test(sigId))
        return json({ error: "Invalid id" }, 400, corsHeaders);
      const { name, html, is_default, gmail_account_id } = await req.json();
      // Fetch current row to get its account scope
      const { data: existing } = await supabase
        .from("email_signatures")
        .select("gmail_account_id")
        .eq("id", sigId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!existing) return json({ error: "Not found" }, 404, corsHeaders);
      if (is_default) {
        const accountScope =
          gmail_account_id ?? existing.gmail_account_id ?? null;
        await supabase
          .from("email_signatures")
          .update({ is_default: false })
          .eq("user_id", userId)
          .eq("is_default", true)
          .eq("gmail_account_id", accountScope)
          .neq("id", sigId);
      }
      const patch: Record<string, unknown> = {};
      if (name !== undefined) patch.name = name.trim();
      if (html !== undefined) patch.html = html;
      if (is_default !== undefined) patch.is_default = is_default;
      if (gmail_account_id !== undefined)
        patch.gmail_account_id = gmail_account_id;
      const { data, error } = await supabase
        .from("email_signatures")
        .update(patch)
        .eq("id", sigId)
        .eq("user_id", userId)
        .select("id, name, html, is_default, gmail_account_id, created_at")
        .single();
      if (error) return json({ error: error.message }, 500, corsHeaders);
      return json({ signature: data }, 200, corsHeaders);
    }

    // ── DELETE /signatures/:id — delete a signature ───────────────────────
    if (path.startsWith("/signatures/") && req.method === "DELETE") {
      const sigId = path.replace("/signatures/", "");
      if (!UUID_RE.test(sigId))
        return json({ error: "Invalid id" }, 400, corsHeaders);
      await supabase
        .from("email_signatures")
        .delete()
        .eq("id", sigId)
        .eq("user_id", userId);
      return json({ ok: true }, 200, corsHeaders);
    }

    // ── GET /attachment — fetch a Gmail attachment by ID ───────────────────
    if (path === "/attachment" && req.method === "GET") {
      const urlObj = new URL(req.url);
      const gmailId = urlObj.searchParams.get("gmail_id");
      const attachmentId = urlObj.searchParams.get("attachment_id");
      if (!gmailId || !attachmentId) {
        return json(
          { error: "Missing gmail_id or attachment_id" },
          400,
          corsHeaders,
        );
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

      const result = await fetchAttachment(
        account.tokens_encrypted as string,
        gmailId,
        attachmentId,
      );
      if (!result)
        return json({ error: "Failed to fetch attachment" }, 502, corsHeaders);

      return json({ data: result.data, size: result.size }, 200, corsHeaders);
    }

    // ── POST /tts — OpenRouter Text-to-Speech (OpenAI gpt-4o-mini-tts) ─────
    // Keeps the same response shape ({ audioContent: <base64 mp3> }) used by
    // the frontend. Google TTS is preserved below as an inactive fallback path
    // gated behind TTS_PROVIDER=google.
    if (path === "/tts" && req.method === "POST") {
      const { text, voice } = await req.json();
      if (!text) return json({ error: "Missing text" }, 400, corsHeaders);

      const ttsProvider = (
        getEnv("TTS_PROVIDER") || "openrouter"
      ).toLowerCase();

      if (ttsProvider === "google") {
        const apiKey = getEnv("GOOGLE_TTS_API_KEY");
        if (!apiKey)
          return json({ error: "TTS not configured" }, 503, corsHeaders);

        const voiceName = voice || "en-US-Neural2-C";
        const ttsRes = await fetch(
          `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              input: { text },
              voice: { languageCode: "en-US", name: voiceName },
              audioConfig: { audioEncoding: "MP3", speakingRate: 0.95 },
            }),
          },
        );
        if (!ttsRes.ok) {
          const err = await ttsRes.text();
          console.error("Google TTS error:", err);
          return json({ error: "TTS request failed" }, 502, corsHeaders);
        }
        const { audioContent } = await ttsRes.json();
        return json({ audioContent }, 200, corsHeaders);
      }

      // Default: OpenRouter. Returns raw audio bytes — base64 them so the
      // response shape matches the Google path the frontend already handles.
      const apiKey = getEnv("OPENROUTER_API_KEY");
      if (!apiKey)
        return json({ error: "TTS not configured" }, 503, corsHeaders);
      const model =
        getEnv("OPENROUTER_TTS_MODEL") || "openai/gpt-4o-mini-tts-2025-12-15";
      const voiceName =
        typeof voice === "string" && voice.length > 0 ? voice : "cedar";

      const ttsRes = await fetch("https://openrouter.ai/api/v1/audio/speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": "https://runemail.app",
          "X-Title": "RuneMail",
        },
        body: JSON.stringify({
          model,
          input: text,
          voice: voiceName,
          response_format: "mp3",
          speed: 1.0,
          // Require providers that don't log or train on this audio.
          provider: { data_collection: "deny", allow_fallbacks: true },
        }),
      });
      if (!ttsRes.ok) {
        const err = await ttsRes.text();
        console.error("OpenRouter TTS error:", err);
        return json({ error: "TTS request failed" }, 502, corsHeaders);
      }
      const buf = new Uint8Array(await ttsRes.arrayBuffer());
      // Chunked base64 to avoid call-stack overflow on long audio.
      let binary = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < buf.length; i += CHUNK) {
        binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
      }
      const audioContent = btoa(binary);
      return json({ audioContent }, 200, corsHeaders);
    }

    // ── Solve-Everything agent routes ────────────────────────────────────
    // Start a new agent session for the current briefing. Returns the session id.
    if (path === "/agent/start" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        timezone?: string;
      };
      const sessionId = await startAgentSession(supabase, userId);
      // Fire-and-forget: kick off the parallel bucket orchestrator.
      runAgentStepParallel(sessionId, supabase, body.timezone ?? "UTC").catch(
        (e) => console.error("[agent/start] initial parallel step failed:", e),
      );
      return json({ session_id: sessionId }, 200, corsHeaders);
    }

    // Run the next iteration of the planning loop. Frontend calls this on
    // status changes to "planning" (e.g. after an /agent/answer).
    if (path === "/agent/step" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        session_id?: string;
        timezone?: string;
      };
      if (!body.session_id) {
        return json({ error: "session_id required" }, 400, corsHeaders);
      }
      // Authorize: session must belong to this user.
      const { data: session } = await supabase
        .from("agent_sessions")
        .select("id")
        .eq("id", body.session_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (!session) {
        return json({ error: "Session not found" }, 404, corsHeaders);
      }
      const result = await runAgentStepParallel(
        body.session_id,
        supabase,
        body.timezone ?? "UTC",
      );
      return json(result, 200, corsHeaders);
    }

    // Submit the user's answer to a pending question and resume planning.
    if (path === "/agent/answer" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        session_id?: string;
        option_id?: string;
        custom_text?: string;
        skip?: boolean;
        not_sure?: boolean;
        question_id?: string;
        timezone?: string;
      };
      if (!body.session_id) {
        return json({ error: "session_id required" }, 400, corsHeaders);
      }
      const { data: session } = await supabase
        .from("agent_sessions")
        .select("id")
        .eq("id", body.session_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (!session) {
        return json({ error: "Session not found" }, 404, corsHeaders);
      }
      // Support batched answers: caller may POST { answers: [{...}, {...}] }
      // alongside or instead of a single answer. Each entry is applied in
      // order against the session's pending_questions array.
      const batch = (
        body as unknown as { answers?: Array<Record<string, unknown>> }
      ).answers;
      if (Array.isArray(batch) && batch.length) {
        for (const a of batch) {
          await answerPendingQuestion(supabase, body.session_id, {
            option_id: a.option_id as string | undefined,
            custom_text: a.custom_text as string | undefined,
            skip: a.skip as boolean | undefined,
            not_sure: a.not_sure as boolean | undefined,
            question_id: a.question_id as string | undefined,
          });
        }
      } else {
        await answerPendingQuestion(supabase, body.session_id, body);
      }
      // Continue the parallel orchestrator so the bucket that paused resumes
      // without blocking the others.
      const result = await runAgentStepParallel(
        body.session_id,
        supabase,
        body.timezone ?? "UTC",
      );
      return json(result, 200, corsHeaders);
    }

    // Execute an approved plan.
    if (path === "/agent/execute" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        session_id?: string;
        approved?: {
          id: string;
          type: "reply" | "todo" | "meeting" | "archive";
          payload: Record<string, unknown>;
          reasoning?: string;
          linked_email_id?: string;
        }[];
        timezone?: string;
      };
      if (!body.session_id) {
        return json({ error: "session_id required" }, 400, corsHeaders);
      }
      const { data: session } = await supabase
        .from("agent_sessions")
        .select("id")
        .eq("id", body.session_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (!session) {
        return json({ error: "Session not found" }, 404, corsHeaders);
      }
      const approved = body.approved ?? [];
      if (!approved.length) {
        return json({ error: "approved actions required" }, 400, corsHeaders);
      }
      const results = await executeAgentPlan(
        supabase,
        userId,
        body.session_id,
        approved,
        body.timezone ?? "UTC",
      );
      return json({ results }, 200, corsHeaders);
    }

    // Cancel an in-flight agent session.
    if (path === "/agent/cancel" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        session_id?: string;
      };
      if (!body.session_id) {
        return json({ error: "session_id required" }, 400, corsHeaders);
      }
      await supabase
        .from("agent_sessions")
        .update({ status: "cancelled", pending_question: null })
        .eq("id", body.session_id)
        .eq("user_id", userId);
      return json({ ok: true }, 200, corsHeaders);
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
