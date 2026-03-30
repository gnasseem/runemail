"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { emailGraph } from "@/lib/emailGraph";

/**
 * Centralized live-update hook.
 *
 * - Single Supabase Realtime channel watching all key tables
 * - Background Gmail sync every 60s (only when tab is visible)
 * - Smart incremental briefing: only updates when meaningful emails arrive,
 *   reuses the old briefing so the LLM merges rather than rebuilds
 * - Visibility-based refresh when user returns to tab
 * - Auto-reconnect on channel errors
 */

type TableName = "emails" | "email_processed" | "todos" | "meetings" | "draft_emails" | "scheduled_emails" | "read_receipts";

const WATCHED_TABLES: TableName[] = [
  "emails",
  "email_processed",
  "todos",
  "meetings",
  "draft_emails",
  "scheduled_emails",
  "read_receipts",
];

// Background sync interval (ms) — Gmail push notifications are the primary delivery
// mechanism; this is just a safety fallback for missed Pub/Sub deliveries.
const SYNC_INTERVAL = 5 * 60 * 1000;
// Minimum time between briefing updates (ms)
const BRIEFING_COOLDOWN_MS = 30 * 60 * 1000;
// Categories that don't warrant a briefing update
const SKIP_BRIEFING_CATS = new Set(["newsletter", "informational", "promotional"]);

export type LiveChangeCounters = Record<TableName, number>;

type WorkingHours = { start?: string; end?: string; days?: number[] } | null;

function isWithinWorkingHours(wh: WorkingHours): boolean {
  if (!wh) return true;
  const now = new Date();
  const days = wh.days || [1, 2, 3, 4, 5];
  if (!days.includes(now.getDay())) return false;
  const [startH, startM] = (wh.start || "09:00").split(":").map(Number);
  const [endH, endM] = (wh.end || "17:00").split(":").map(Number);
  const mins = now.getHours() * 60 + now.getMinutes();
  return mins >= startH * 60 + startM && mins < endH * 60 + endM;
}

export function useLiveUpdates(
  userId: string,
  aiMode: "cloud" | "local" | "hybrid",
  lastBriefingAt: string | null,
  workingHours: WorkingHours,
  callbacks?: {
    addToast: (type: "success" | "error" | "info", msg: string) => void;
    analyzeLocally: () => Promise<void>;
    onBriefingUpdated?: () => void;
  },
) {
  const supabase = createClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const autoSyncTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastVisibilityRefresh = useRef<number>(0);
  const syncingRef = useRef(false);

  // Keep callbacks in a ref so backgroundSync doesn't need them as a dependency.
  // This prevents the inline callbacks object in AppShell from invalidating
  // backgroundSync on every render, which was clearing the interval before it fired.
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const workingHoursRef = useRef(workingHours);
  workingHoursRef.current = workingHours;

  // Track how many emails are being processed (for "Processing X emails..." banner)
  const [processingCount, setProcessingCount] = useState(0);

  // Count of emails inserted via Realtime (not yet analysis-complete) this session
  const pendingEmailsRef = useRef(0);
  // Debounce timer for Realtime-triggered analysis
  const analysisDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stable ref to aiMode so the Realtime closure doesn't need it as a dep
  const aiModeRef = useRef(aiMode);
  aiModeRef.current = aiMode;

  // Per-table change counters; views useEffect on these to re-fetch
  const [changeCounters, setChangeCounters] = useState<LiveChangeCounters>({
    emails: 0,
    email_processed: 0,
    todos: 0,
    meetings: 0,
    draft_emails: 0,
    scheduled_emails: 0,
    read_receipts: 0,
  });

  const bumpTable = useCallback((table: TableName) => {
    setChangeCounters((prev) => ({ ...prev, [table]: prev[table] + 1 }));
  }, []);

  // ── Supabase Realtime subscriptions ──
  useEffect(() => {
    const subscribe = () => {
      const channel = supabase.channel(`live-updates-${userId}`);

      // All tables except emails/email_processed: generic handler
      for (const table of WATCHED_TABLES) {
        if (table === "emails" || table === "email_processed") continue;
        channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table, filter: `user_id=eq.${userId}` },
          () => { bumpTable(table); },
        );
      }

      // emails INSERT: increment pending count and schedule immediate analysis
      channel.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "emails", filter: `user_id=eq.${userId}` },
        () => {
          pendingEmailsRef.current += 1;
          setProcessingCount(pendingEmailsRef.current);
          bumpTable("emails");

          // Debounce analysis so multiple concurrent inserts are batched
          if (analysisDebounceRef.current) clearTimeout(analysisDebounceRef.current);
          analysisDebounceRef.current = setTimeout(async () => {
            analysisDebounceRef.current = null;
            if (syncingRef.current) return;
            syncingRef.current = true;
            try {
              const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/api";
              let { data: { session } } = await supabase.auth.getSession();
              if (!session?.access_token) {
                const { data: refreshed } = await supabase.auth.refreshSession();
                session = refreshed.session;
              }
              if (!session?.access_token) return;
              if (aiModeRef.current === "local" || aiModeRef.current === "hybrid") {
                await callbacksRef.current?.analyzeLocally?.();
              } else {
                await fetch(`${apiUrl}/analyze-inbox`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${session.access_token}`,
                  },
                });
              }
            } catch (err) {
              console.error("[useLiveUpdates] realtime analysis:", err);
            } finally {
              syncingRef.current = false;
              pendingEmailsRef.current = 0;
              setProcessingCount(0);
            }
          }, 500);
        },
      );
      channel.on("postgres_changes", { event: "UPDATE", schema: "public", table: "emails", filter: `user_id=eq.${userId}` }, () => bumpTable("emails"));
      channel.on("postgres_changes", { event: "DELETE", schema: "public", table: "emails", filter: `user_id=eq.${userId}` }, () => bumpTable("emails"));

      // email_processed INSERT: decrement pending count as each email finishes
      channel.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "email_processed", filter: `user_id=eq.${userId}` },
        () => {
          pendingEmailsRef.current = Math.max(0, pendingEmailsRef.current - 1);
          setProcessingCount(pendingEmailsRef.current);
          bumpTable("email_processed");
        },
      );
      channel.on("postgres_changes", { event: "UPDATE", schema: "public", table: "email_processed", filter: `user_id=eq.${userId}` }, () => bumpTable("email_processed"));
      channel.on("postgres_changes", { event: "DELETE", schema: "public", table: "email_processed", filter: `user_id=eq.${userId}` }, () => bumpTable("email_processed"));

      channel.subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setTimeout(() => {
            if (channelRef.current) {
              supabase.removeChannel(channelRef.current);
            }
            channelRef.current = null;
            subscribe();
          }, 3000);
        }
      });

      channelRef.current = channel;
    };

    subscribe();

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [userId, supabase, bumpTable]);

  // ── Silent background sync ──
  const backgroundSync = useCallback(async () => {
    if (syncingRef.current) return;
    if (document.visibilityState !== "visible") return;

    syncingRef.current = true;
    try {
      const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/api";
      let { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        session = refreshed.session;
      }
      if (!session?.access_token) return;

      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      };

      // Phase 1: Fetch new emails from Gmail (lightweight if nothing new)
      const fetchRes = await fetch(`${apiUrl}/fetch-emails`, {
        method: "POST",
        headers,
        body: JSON.stringify({ initial: false }),
      });

      if (!fetchRes.ok) return;

      const { fetched: newEmailCount = 0 } = await fetchRes.json();

      // Always run analysis even when fetch found nothing new: the Pub/Sub webhook
      // may have already inserted emails that fetch-emails skipped as duplicates.
      const hadNewEmails = newEmailCount > 0;
      if (hadNewEmails) setProcessingCount(newEmailCount);

      // Phase 2: Analyze new emails — cloud or local depending on aiMode
      let analyzeData: Record<string, unknown> | null = null;
      try {
        if (aiMode === "local" || aiMode === "hybrid") {
          // Use locally registered analyzeInboxLocally from InboxView
          if (callbacksRef.current?.analyzeLocally) {
            await callbacksRef.current.analyzeLocally();
          }
        } else {
          const analyzeRes = await fetch(`${apiUrl}/analyze-inbox`, {
            method: "POST",
            headers,
          });
          if (analyzeRes.ok) {
            analyzeData = await analyzeRes.json();
          }
        }
      } catch {
        // Will retry next interval
      }

      // Clear processing banner and notify user (only when emails were actually fetched)
      if (hadNewEmails) {
        setProcessingCount(0);
        callbacksRef.current?.addToast("info", `${newEmailCount} new email${newEmailCount !== 1 ? "s" : ""} ready`);
      }

      // Phase 3: Smart incremental briefing update (with cooldown).
      const briefingCooldownKey = `runemail_briefing_ts_${userId}`;
      const lastBriefingUpdate = parseInt(localStorage.getItem(briefingCooldownKey) || "0");
      const cooldownElapsed = Date.now() - lastBriefingUpdate >= BRIEFING_COOLDOWN_MS;

      // Skip briefing updates outside working hours
      const briefingReady = cooldownElapsed && isWithinWorkingHours(workingHoursRef.current);

      if (briefingReady) {
        if (aiMode === "local" || aiMode === "hybrid") {
          // Local briefing update via emailGraph
          try {
            const { data: newEmails } = await supabase
              .from("emails")
              .select("subject, sender, snippet, email_processed(category, summary)")
              .eq("user_id", userId)
              .gt("received_at", lastBriefingAt ?? new Date(0).toISOString())
              .order("received_at", { ascending: false })
              .limit(20);

            if (newEmails?.length) {
              const relevant = newEmails.filter((e: any) => {
                const p = Array.isArray(e.email_processed) ? e.email_processed[0] : e.email_processed;
                return !p || !SKIP_BRIEFING_CATS.has(p.category);
              });

              if (relevant.length > 0) {
                const result = await emailGraph.invoke({
                  task: "brief",
                  emails: newEmails.map((e: any) => ({
                    subject: e.subject,
                    sender: e.sender,
                    snippet: e.snippet,
                  })),
                });

                if (result.briefing) {
                  const ts = Date.now();
                  localStorage.setItem(`runemail_briefing_cache_${userId}`, JSON.stringify({ data: result.briefing, ts }));
                  localStorage.setItem(briefingCooldownKey, String(ts));
                  await supabase.from("profiles").update({
                    last_briefing: result.briefing,
                    last_briefing_at: new Date(ts).toISOString(),
                  }).eq("id", userId);
                  callbacksRef.current?.onBriefingUpdated?.();
                }
              }
            }
          } catch (err) {
            console.error("[useLiveUpdates] local briefing update:", err);
          }
        } else {
          // Cloud incremental briefing update
          try {
            let previousBriefing = null;
            let briefingTimestamp = lastBriefingAt;

            const cached = localStorage.getItem(`runemail_briefing_cache_${userId}`);
            if (cached) {
              const parsed = JSON.parse(cached);
              if (parsed?.data) {
                previousBriefing = parsed.data;
                if (parsed.ts) briefingTimestamp = new Date(parsed.ts).toISOString();
              }
            }

            if (!previousBriefing) {
              const { data: row } = await supabase
                .from("profiles")
                .select("last_briefing, last_briefing_at")
                .eq("id", userId)
                .single();
              if (row?.last_briefing) {
                previousBriefing = row.last_briefing;
                briefingTimestamp = row.last_briefing_at ?? null;
              }
            }

            if (previousBriefing && briefingTimestamp) {
              const updateRes = await fetch(`${apiUrl}/briefing/update`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                  previous_briefing: previousBriefing,
                  since: briefingTimestamp,
                }),
              });

              if (updateRes.ok) {
                const { briefing, updated } = await updateRes.json();
                if (briefing) {
                  const ts = Date.now();
                  localStorage.setItem(`runemail_briefing_cache_${userId}`, JSON.stringify({ data: briefing, ts }));
                  localStorage.setItem(briefingCooldownKey, String(ts));
                  if (updated) {
                    await supabase.from("profiles").update({
                      last_briefing: briefing,
                      last_briefing_at: new Date(ts).toISOString(),
                    }).eq("id", userId);
                  }
                  callbacksRef.current?.onBriefingUpdated?.();
                }
              }
            } else if (analyzeData?.briefing) {
              // No previous briefing; save the one from analyze-inbox
              const ts = Date.now();
              localStorage.setItem(`runemail_briefing_cache_${userId}`, JSON.stringify({ data: analyzeData.briefing, ts }));
              localStorage.setItem(briefingCooldownKey, String(ts));
              await supabase.from("profiles").update({
                last_briefing: analyzeData.briefing,
                last_briefing_at: new Date(ts).toISOString(),
              }).eq("id", userId);
              callbacksRef.current?.onBriefingUpdated?.();
            }
          } catch (err) {
            console.error("[useLiveUpdates] cloud briefing update:", err);
          }
        }
      }
    } catch (err) {
      console.error("[useLiveUpdates] background sync:", err);
    } finally {
      syncingRef.current = false;
    }
  }, [userId, supabase, aiMode, lastBriefingAt]);

  // ── Background sync timer (every 30s, only when visible) ──
  useEffect(() => {
    // Fire once immediately so new emails appear without waiting for the first interval
    backgroundSync();
    autoSyncTimer.current = setInterval(backgroundSync, SYNC_INTERVAL);
    return () => {
      if (autoSyncTimer.current) clearInterval(autoSyncTimer.current);
    };
  }, [backgroundSync]);

  // ── Visibility-based refresh: trigger sync when user returns (sync triggers Realtime events) ──
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastVisibilityRefresh.current < 30_000) return;
      lastVisibilityRefresh.current = now;

      // Only trigger sync; Realtime events from the sync will bump counters naturally
      backgroundSync();
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [backgroundSync]);

  return { changeCounters, processingCount };
}
