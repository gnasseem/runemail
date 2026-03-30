"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useApp } from "../AppShell";
import EmailDetail from "../EmailDetail";
import InitialFetchOverlay from "../InitialFetchOverlay";
import { initWebLLM, isWebLLMReady } from "@/lib/webllm";
import { emailGraph, type BriefingResult } from "@/lib/emailGraph";

type Email = {
  id: string;
  gmail_id: string;
  subject: string;
  sender: string;
  sender_email: string;
  snippet: string;
  body_text: string;
  body_html: string;
  received_at: string;
  is_read: boolean;
  is_starred: boolean;
  is_archived: boolean;
  has_attachments: boolean;
  thread_id?: string;
  email_processed: {
    category: string;
    summary: string;
    quick_actions: any[];
    extra_labels: string[] | null;
  } | null;
};

const categoryColors: Record<string, string> = {
  important: "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-900/50",
  "action-required": "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 ring-1 ring-amber-200 dark:ring-amber-900/50",
  newsletter: "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400 ring-1 ring-violet-200 dark:ring-violet-900/50",
  informational: "bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400 ring-1 ring-sky-200 dark:ring-sky-900/50",
};

const PAGE_SIZE = 20;

export default function InboxView() {
  const { user, profile, openCompose, addToast, search, setSyncing, registerSyncFn, registerAnalyzeLocallyFn, inboxFilters, inboxSort, setInboxCustomCategories, setInboxCustomTags, getViewCache, setViewCache, liveChanges, processingCount, startTutorial } = useApp();
  const supabase = createClient();
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [syncing, setSyncingLocal] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [localProcessingCount, setLocalProcessingCount] = useState(0);
  const [initialPhase, setInitialPhase] = useState(-1);
  const [syncMode, setSyncMode] = useState<"initial" | "refresh">("initial");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [noAccountsConnected, setNoAccountsConnected] = useState(false);
  const autoSyncAttempted = useRef(false);
  const [customTagColors, setCustomTagColors] = useState<Record<string, { displayName: string; color: string }>>({});
  // Tracks whether this user has ever synced emails (DB count, not React state)
  const [isFirstEver, setIsFirstEver] = useState<boolean | null>(null);

  // Check if the user has any active Gmail accounts; if not, show reconnect UI
  useEffect(() => {
    supabase
      .from("gmail_accounts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("is_active", true)
      .then(({ count }) => setNoAccountsConnected((count ?? 0) === 0));
  }, [user.id]);

  // One-time DB check: is this the very first time this user has emails?
  useEffect(() => {
    supabase
      .from("emails")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .then(({ count }) => setIsFirstEver((count ?? 0) === 0));
  }, [user.id]);

  // Fetch custom tag metadata for display in cards and filter menu
  useEffect(() => {
    supabase
      .from("categories")
      .select("slug, display_name, color")
      .eq("user_id", user.id)
      .then(({ data }) => {
        if (data) {
          const map: Record<string, { displayName: string; color: string }> = {};
          for (const t of data) map[t.slug] = { displayName: t.display_name, color: t.color };
          setCustomTagColors(map);
        }
      });
  }, [user.id]);

  const isSnoozed = (emailId: string) => {
    const until = localStorage.getItem(`snooze:${emailId}`);
    return until ? new Date(until) > new Date() : false;
  };

  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const fetchEmails = useCallback(async (pageNum = 0) => {
    // Serve cache immediately and skip the DB query on page 0 with no search.
    // Cache is invalidated by live updates and manual sync, so this is always fresh.
    if (pageNum === 0 && !search) {
      const cached = getViewCache("inbox");
      if (cached) {
        setEmails(cached.emails);
        setHasMore(cached.hasMore);
        setLoading(false);
        return;
      }
    }

    setLoading(true);

    const from = pageNum * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from("emails")
      .select("*, email_processed(*)")
      .eq("user_id", user.id)
      .eq("is_archived", false)
      .not("label_ids", "cs", '{"SENT"}') // exclude imported sent emails from inbox
      .or("is_snoozed.eq.false,snooze_until.lt." + new Date().toISOString())
      .order("received_at", { ascending: false })
      .range(from, to + 1);

    if (search) {
      query = query.textSearch("search_vector", search, { type: "websearch", config: "english" });
    }

    const { data } = await query;
    let rows = (data || []) as Email[];

    const hasMoreEmails = rows.length > PAGE_SIZE;
    if (hasMoreEmails) rows = rows.slice(0, PAGE_SIZE);

    rows = rows.map((e) => ({
      ...e,
      email_processed: Array.isArray(e.email_processed) ? e.email_processed[0] : e.email_processed,
    }));

    if (!mountedRef.current) return;
    setHasMore(hasMoreEmails);
    setEmails(rows);
    setLoading(false);

    // Cache page 0 results (no search)
    if (pageNum === 0 && !search) {
      setViewCache("inbox", { emails: rows, hasMore: hasMoreEmails });
    }
  }, [user.id, search, inboxSort]);

  useEffect(() => {
    setPage(0);
    fetchEmails(0);
  }, [fetchEmails]);

  // Derive custom categories + tags from emails in state — no extra DB query needed
  useEffect(() => {
    const STANDARD = new Set(["important", "action-required", "newsletter", "informational"]);
    const custom = [...new Set(
      emails
        .map((e) => (e.email_processed as any)?.category as string | undefined)
        .filter((c): c is string => !!c && !STANDARD.has(c)),
    )];
    setInboxCustomCategories(custom);

    const tagSlugs = new Set<string>();
    emails.forEach((e) => {
      const labels = (e.email_processed as any)?.extra_labels;
      if (Array.isArray(labels)) labels.forEach((l: string) => tagSlugs.add(l));
    });
    const tags = [...tagSlugs].map((slug) => ({
      slug,
      displayName: customTagColors[slug]?.displayName || slug,
      color: customTagColors[slug]?.color || "#6b7280",
    }));
    setInboxCustomTags(tags);
  }, [emails, customTagColors, setInboxCustomCategories, setInboxCustomTags]);

  /**
   * Analyze unprocessed emails locally using the emailGraph.
   * Runs categorize → summarize → extract_actions for each email
   * and saves results to the email_processed table.
   */
  const analyzeInboxLocally = useCallback(async () => {
    const ready = await initWebLLM();
    if (!ready || !isWebLLMReady()) return;

    // Fetch user-defined tags for auto-assignment
    const { data: tagRows } = await supabase
      .from("categories")
      .select("slug, description")
      .eq("user_id", user.id);
    const userTags = (tagRows || []).map((t: any) => ({ slug: t.slug as string, description: (t.description as string) || "" }));

    // Find emails without processed records
    const { data: unprocessed } = await supabase
      .from("emails")
      .select("id, subject, sender, snippet, body_text")
      .eq("user_id", user.id)
      .eq("is_archived", false)
      .order("received_at", { ascending: false })
      .limit(20);

    if (!unprocessed?.length) return;

    // Check which ones already have email_processed records
    const emailIds = unprocessed.map((e: any) => e.id);
    const { data: existing } = await supabase
      .from("email_processed")
      .select("email_id")
      .in("email_id", emailIds);

    const existingIds = new Set((existing || []).map((e: any) => e.email_id));
    const toProcess = unprocessed.filter((e: any) => !existingIds.has(e.id));

    if (!toProcess.length) return;

    // Process each email through the graph (up to 5 to avoid blocking)
    const batch = toProcess.slice(0, 5);
    const processedSummaries: { subject: string; sender: string; summary: string }[] = [];
    setLocalProcessingCount(batch.length);
    for (const email of batch) {
      try {
        const result = await emailGraph.invoke({
          task: "process_email",
          currentEmail: {
            id: email.id,
            subject: email.subject || "",
            sender: email.sender || "",
            snippet: email.snippet || "",
            body_text: email.body_text || "",
          },
          userTags: userTags.length > 0 ? userTags : undefined,
        });

        const extraLabels = result.assignedTags && result.assignedTags.length > 0 ? result.assignedTags : null;
        await supabase.from("email_processed").upsert(
          {
            user_id: user.id,
            email_id: email.id,
            category: result.category || "informational",
            summary: result.summary || null,
            quick_actions: result.quickActions || [],
            extra_labels: extraLabels,
          },
          { onConflict: "email_id" },
        );

        // Save extracted knowledge entities to knowledge_base
        if (result.knowledgeEntities?.length) {
          const rows = result.knowledgeEntities.map((e) => ({
            user_id: user.id,
            entity: e.entity,
            entity_type: e.entity_type,
            info: e.info,
            source: email.subject || "email",
            confidence: e.confidence,
            importance: e.confidence >= 0.8 ? "high" : "normal",
          }));
          await supabase.from("knowledge_base").upsert(rows, { onConflict: "user_id,entity,entity_type" });
        }

        if (result.summary) {
          processedSummaries.push({
            subject: email.subject || "",
            sender: email.sender || "",
            summary: result.summary,
          });
        }

        // Roll this email into the list immediately and decrement banner count
        await fetchEmails(0);
        setLocalProcessingCount((prev) => Math.max(0, prev - 1));
      } catch {
        // Non-critical: skip individual email failures
        setLocalProcessingCount((prev) => Math.max(0, prev - 1));
      }
    }
    setLocalProcessingCount(0);

    // Generate and cache briefing from all recently processed emails
    try {
      const { data: allProcessed } = await supabase
        .from("email_processed")
        .select("summary, emails!inner(subject, sender)")
        .eq("user_id", user.id)
        .not("summary", "is", null)
        .order("processed_at", { ascending: false })
        .limit(25);

      const emailsForBriefing = (allProcessed || []).map((row: any) => ({
        subject: row.emails?.subject || "",
        sender: row.emails?.sender || "",
        snippet: row.summary || "",
      }));

      if (emailsForBriefing.length > 0) {
        const briefingResult = await emailGraph.invoke({
          task: "brief",
          emails: emailsForBriefing,
        });
        if (briefingResult.briefing) {
          const ts = Date.now();
          localStorage.setItem(
            `runemail_briefing_cache_${user.id}`,
            JSON.stringify({ data: briefingResult.briefing as BriefingResult, ts }),
          );
          await supabase.from("profiles").update({
            last_briefing: briefingResult.briefing,
            last_briefing_at: new Date(ts).toISOString(),
          }).eq("id", user.id);
        }
      }
    } catch {
      // Non-critical: briefing can be generated on demand
    }
  }, [user.id, supabase, fetchEmails]);

  /**
   * Learn writing style from cached sent emails using local AI (emailGraph analyze_style node).
   * Only runs on first fetch for local/hybrid mode.
   */
  const analyzeWritingStyleLocally = useCallback(async () => {
    const { data: sentEmails } = await supabase
      .from("emails")
      .select("subject, snippet, body_text")
      .eq("user_id", user.id)
      .contains("label_ids", ["SENT"])
      .order("received_at", { ascending: false })
      .limit(20);
    if (!sentEmails || sentEmails.length < 3) return;

    const result = await emailGraph.invoke({
      task: "analyze_style",
      emails: sentEmails.map((e: any) => ({
        subject: e.subject || "",
        sender: "me",
        snippet: (e.body_text || e.snippet || "").slice(0, 500),
      })),
    });

    if (result.styleProfile) {
      await supabase.from("style_profiles").upsert(
        {
          user_id: user.id,
          greeting_style: result.styleProfile.greeting_style,
          closing_style: result.styleProfile.closing_style,
          tone: result.styleProfile.tone,
          avg_length: result.styleProfile.avg_length,
          sample_count: result.styleProfile.sample_count,
          last_learned_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    }
  }, [user.id, supabase]);

  const syncInbox = useCallback(async () => {
    if (syncing) return;
    setSyncingLocal(true);
    setSyncing(true);
    setSyncError(null);
    const isFirstFetch = isFirstEver === true;
    const aiMode = profile?.ai_mode || "cloud";
    const useLocalAI = aiMode === "local" || aiMode === "hybrid";
    setSyncMode(isFirstFetch ? "initial" : "refresh");

    try {
      const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/api";
      let { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        session = refreshed.session;
      }
      if (!session?.access_token) {
        setSyncError("Session expired. Please reload the page and sign in again.");
        return;
      }
      let headers = { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` };

      const handleAuthRefresh = async (): Promise<boolean> => {
        const { data: refreshed } = await supabase.auth.refreshSession();
        if (!refreshed.session?.access_token) return false;
        session = refreshed.session;
        headers = { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` };
        return true;
      };

      const handleFetchError = async (res: Response, isRetry = false): Promise<boolean> => {
        if (res.status === 401) {
          if (isRetry) {
            setSyncError("Authentication failed. Please sign out and sign in again.");
            return true;
          }
          const refreshed = await handleAuthRefresh();
          if (!refreshed) {
            setSyncError("Session expired. Please reload the page and sign in again.");
            return true;
          }
          return false;
        }
        const err = await res.json().catch(() => ({}));
        const msg = (err as { error?: string }).error ?? `Error ${res.status}`;
        if (msg === "No Gmail account connected") {
          setNoAccountsConnected(true);
        } else {
          setSyncError(msg);
        }
        return true;
      };

      // Phase 1: Fetch new emails from Gmail
      // Only show the blocking overlay for the very first sync
      if (isFirstFetch) {
        setInitialPhase(0);
        setInitialPhase(1);
      }
      let fetchRes = await fetch(`${apiUrl}/fetch-emails`, {
        method: "POST",
        headers,
        body: JSON.stringify({ initial: isFirstFetch }),
      });
      if (!fetchRes.ok) {
        const shouldRetry = !(await handleFetchError(fetchRes));
        if (shouldRetry) {
          fetchRes = await fetch(`${apiUrl}/fetch-emails`, {
            method: "POST",
            headers,
            body: JSON.stringify({ initial: isFirstFetch }),
          });
        }
        if (!fetchRes.ok) {
          await handleFetchError(fetchRes, true);
          setInitialPhase(-1);
          return;
        }
      }
      const fetchData = await fetchRes.json();
      const newEmailCount: number = fetchData.fetched ?? 0;

      // Fast path: no new emails, not first fetch, and not local mode.
      // Local mode skips this because the webhook may have already inserted
      // unprocessed emails that need to be analyzed in the browser.
      if (newEmailCount === 0 && !isFirstFetch && !useLocalAI) {
        await fetchEmails(0);
        setInitialPhase(-1);
        return;
      }

      const shouldAnalyze = newEmailCount > 0 || isFirstFetch;

      // For initial fetch, learn writing style in parallel (fire and forget)
      if (isFirstFetch && !useLocalAI) {
        fetch(`${apiUrl}/learn-style`, { method: "POST", headers }).catch(() => {});
      }

      const analyzeAndBriefing = shouldAnalyze
        ? (useLocalAI
            ? analyzeInboxLocally()
            : fetch(`${apiUrl}/analyze-inbox`, { method: "POST", headers })
                .then(async (r) => {
                  if (!r.ok) return;
                  // After processing emails, generate a fresh briefing
                  try {
                    const briefingRes = await fetch(`${apiUrl}/briefing?scope=all_recent`, { headers });
                    if (briefingRes.ok) {
                      const briefingJson = await briefingRes.json();
                      const briefingData = briefingJson.briefing ?? briefingJson;
                      if (briefingData?.executiveSummary !== undefined) {
                        const ts = Date.now();
                        localStorage.setItem(
                          `runemail_briefing_cache_${user.id}`,
                          JSON.stringify({ data: briefingData, ts }),
                        );
                        await supabase.from("profiles").update({
                          last_briefing: briefingData,
                          last_briefing_at: new Date(ts).toISOString(),
                        }).eq("id", user.id);
                      }
                    }
                  } catch { /* non-blocking */ }
                }).catch(() => {}))
        : Promise.resolve();

      const localStylePromise = (isFirstFetch && useLocalAI)
        ? analyzeWritingStyleLocally()
        : Promise.resolve();

      if (isFirstFetch) {
        // Keep overlay at phase 2 until all processing + briefing is done.
        // Safety timeout: dismiss after 2 minutes regardless.
        setInitialPhase(2);
        const safetyTimer = setTimeout(() => {
          if (!mountedRef.current) return;
          setInitialPhase(-1);
          fetchEmails(0);
        }, 120_000);
        await Promise.allSettled([analyzeAndBriefing, localStylePromise]);
        clearTimeout(safetyTimer);
        if (!mountedRef.current) return;
        setInitialPhase(3);
        await fetchEmails(0);
        setInitialPhase(-1);
      } else {
        // Non-initial sync: run in background, no blocking overlay
        await Promise.allSettled([analyzeAndBriefing, localStylePromise]);
        await fetchEmails(0);
      }
    } catch {
      setSyncError("Network error - check your connection.");
      setInitialPhase(-1);
    } finally {
      setSyncingLocal(false);
      setSyncing(false);
    }
  }, [isFirstEver, syncing, fetchEmails, addToast, setSyncing, profile?.ai_mode, analyzeInboxLocally, analyzeWritingStyleLocally]);

  // Register sync function in global context so TopBar can trigger it
  useEffect(() => {
    registerSyncFn(syncInbox);
  }, [registerSyncFn, syncInbox]);

  // Register local analysis function for background sync (used by useLiveUpdates in local/hybrid mode)
  useEffect(() => {
    registerAnalyzeLocallyFn(analyzeInboxLocally);
  }, [registerAnalyzeLocallyFn, analyzeInboxLocally]);

  // Live updates: re-fetch when emails or email_processed change (via centralized realtime)
  const prevEmailsChange = useRef(liveChanges.emails);
  const prevProcessedChange = useRef(liveChanges.email_processed);
  useEffect(() => {
    if (
      liveChanges.emails !== prevEmailsChange.current ||
      liveChanges.email_processed !== prevProcessedChange.current
    ) {
      prevEmailsChange.current = liveChanges.emails;
      prevProcessedChange.current = liveChanges.email_processed;
      fetchEmails(0);
    }
  }, [liveChanges.emails, liveChanges.email_processed, fetchEmails]);

  // Auto-sync on every login for all modes.
  // Sets up the Gmail watch so push notifications work, catches emails
  // missed since last session, and for local mode processes any
  // unprocessed emails that arrived while the app was closed.
  useEffect(() => {
    if (isFirstEver === null) return; // wait for DB count check
    if (!profile) return; // wait for profile
    if (autoSyncAttempted.current) return;

    autoSyncAttempted.current = true;

    // Clean up URL param if present
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (url.searchParams.has("initial")) {
        url.searchParams.delete("initial");
        window.history.replaceState({}, "", url.toString());
      }
    }

    syncInbox();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFirstEver, profile?.ai_mode]);

  const markRead = useCallback(async (email: Email) => {
    if (!email.is_read) {
      await supabase.from("emails").update({ is_read: true }).eq("id", email.id);
      setEmails((prev) => prev.map((e) => e.id === email.id ? { ...e, is_read: true } : e));
    }
    setSelectedEmail({ ...email, is_read: true });
  }, []);

  const toggleStar = async (email: Email, e: React.MouseEvent) => {
    e.stopPropagation();
    const newVal = !email.is_starred;
    await supabase.from("emails").update({ is_starred: newVal }).eq("id", email.id);
    setEmails((prev) => prev.map((em) => em.id === email.id ? { ...em, is_starred: newVal } : em));
    if (selectedEmail?.id === email.id) setSelectedEmail((prev) => prev ? { ...prev, is_starred: newVal } : prev);
  };

  const archiveEmail = useCallback(async (email: Email) => {
    await supabase.from("emails").update({ is_archived: true }).eq("id", email.id);
    setEmails((prev) => prev.filter((e) => e.id !== email.id));
    if (selectedEmail?.id === email.id) setSelectedEmail(null);
    addToast("success", "Archived");
  }, [selectedEmail, addToast]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (target.isContentEditable) return;
      if (document.querySelector("[data-compose-modal]")) return;

      if (e.key === "n" || e.key === "N") { e.preventDefault(); openCompose(); }
      if (e.key === "Escape") { setSelectedEmail(null); }
      if (e.key === "e" || e.key === "E") {
        if (selectedEmail) { e.preventDefault(); archiveEmail(selectedEmail); }
      }
      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        setSelectedEmail((prev) => {
          const idx = prev ? emails.findIndex((em) => em.id === prev.id) : -1;
          const next = emails[idx + 1];
          if (next) { markRead(next); return next; }
          return prev;
        });
      }
      if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        setSelectedEmail((prev) => {
          const idx = prev ? emails.findIndex((em) => em.id === prev.id) : emails.length;
          const prev2 = emails[idx - 1];
          if (prev2) { markRead(prev2); return prev2; }
          return prev;
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [emails, selectedEmail, openCompose, archiveEmail, markRead]);

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    const isToday = new Date().toDateString() === d.toDateString();
    if (isToday) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    fetchEmails(newPage);
  };

  const displayedEmails = useMemo(() => {
    let rows = [...emails];

    // OR filter: email must match ANY active filter
    if (inboxFilters.size > 0) {
      rows = rows.filter((e) => {
        const proc = e.email_processed as any;
        for (const f of inboxFilters) {
          if (f === "unread" && !e.is_read) return true;
          if (f === "starred" && e.is_starred) return true;
          if (proc?.category === f) return true;
          if (Array.isArray(proc?.extra_labels) && proc.extra_labels.includes(f)) return true;
        }
        return false;
      });
    }

    // Smart sort (newest/oldest handled at DB level)
    if (inboxSort === "smart") {
      rows = [...rows].sort((a, b) => {
        const score = (e: Email) => {
          const p = e.email_processed as any;
          let s = 0;

          // Read status
          if (!e.is_read) s += 15;

          // Category priority
          const cat = p?.category;
          if (cat === "action-required") s += 20;
          else if (cat === "important") s += 15;
          else if (cat === "informational") s += 8;
          else if (cat === "newsletter") s += 2;
          else if (cat === "promotional") s += 1;

          // Recency: logarithmic decay (smooth, no cliff edges)
          const ageHours = (Date.now() - new Date(e.received_at).getTime()) / 3600000;
          s += Math.max(0, 20 - Math.log2(ageHours + 1) * 3);

          // Compound bonus: unread + recent
          if (!e.is_read && ageHours < 6) s += 10;

          return s;
        };
        // Tiebreaker: newer first for same score
        return score(b) - score(a) || new Date(b.received_at).getTime() - new Date(a.received_at).getTime();
      });
    }

    return rows;
  }, [emails, inboxFilters, inboxSort]);

  return (
    <>
    {initialPhase >= 0 && (
        <InitialFetchOverlay
          phaseIndex={initialPhase}
          mode={syncMode}
          onStartTutorial={syncMode === "initial" ? startTutorial : undefined}
        />
      )}
    <div className="h-full flex overflow-hidden">
      {/* ── Left pane: email list ── */}
      <div className={`flex flex-col border-r border-[var(--border)] bg-[var(--background)] flex-shrink-0 w-80 lg:w-96 ${selectedEmail ? "hidden md:flex" : "flex"}`}>
        {syncError && (
          <div className="mx-2 mt-1 px-2 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-xs flex items-center gap-1.5">
            <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>error</span>
            {syncError}
          </div>
        )}

        {/* No accounts reconnect banner */}
        {noAccountsConnected && (
          <div className="mx-3 mt-3 p-4 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 flex items-start gap-3">
            <span className="material-symbols-outlined text-amber-500 shrink-0 mt-0.5" style={{ fontSize: "20px" }}>link_off</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">No Gmail account connected</p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">Connect your Gmail account to get started.</p>
              <button
                onClick={async () => {
                  await supabase.auth.signInWithOAuth({
                    provider: "google",
                    options: {
                      redirectTo: `${window.location.origin}/auth/callback?next=/app`,
                      scopes:
                        "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events",
                      queryParams: { access_type: "offline", prompt: "consent" },
                    },
                  });
                }}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium transition-colors"
              >
                <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>add_link</span>
                Connect Gmail
              </button>
            </div>
          </div>
        )}

        {/* Processing banner */}
        {(processingCount > 0 || localProcessingCount > 0) && (
          <div className="px-4 py-2 bg-[var(--accent)]/10 border-b border-[var(--border)] flex items-center gap-2 text-sm text-[var(--accent)]">
            <span className="material-symbols-outlined animate-spin" style={{ fontSize: "16px" }}>progress_activity</span>
            Processing {processingCount || localProcessingCount} new email{(processingCount || localProcessingCount) !== 1 ? "s" : ""}...
          </div>
        )}

        {/* Email list */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="space-y-0">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="px-4 py-3 border-b border-[var(--border)] animate-pulse">
                  <div className="flex gap-3">
                    <div className="w-2 h-2 rounded-full bg-[var(--surface-2)] mt-1.5 shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="flex justify-between">
                        <div className="h-3.5 w-32 rounded bg-[var(--surface-2)]" />
                        <div className="h-3 w-12 rounded bg-[var(--surface-2)]" />
                      </div>
                      <div className="h-3 w-48 rounded bg-[var(--surface-2)]" />
                      <div className="h-2.5 w-16 rounded bg-[var(--surface-2)]" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : displayedEmails.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-[var(--muted)] px-4">
              <span className="material-symbols-outlined mb-2" style={{ fontSize: "40px" }}>inbox</span>
              <p className="text-sm text-center">No emails yet. Click sync to fetch your inbox.</p>
            </div>
          ) : (
            displayedEmails.map((email) => {
              const proc = email.email_processed as any;
              const isSelected = selectedEmail?.id === email.id;

              return (
                <div
                  key={email.id}
                  onClick={() => markRead(email)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && markRead(email)}
                  className={`relative w-full text-left px-4 py-3 border-b border-[var(--border)] flex items-start gap-3 transition-all duration-100 cursor-pointer group
                    ${isSelected
                      ? "bg-[var(--accent-light)]"
                      : "hover:bg-[var(--surface-2)]"
                    }`}
                >
                  {/* Left accent bar for selected */}
                  {isSelected && (
                    <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-[var(--accent)] rounded-r" />
                  )}

                  {/* Unread indicator */}
                  <div className="mt-1 shrink-0 w-3 flex justify-center">
                    {!email.is_read ? (
                      <span className="w-2 h-2 rounded-full bg-[var(--accent)] shrink-0" title="Unread" />
                    ) : null}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5 mb-0.5">
                      <span className={`text-[13px] flex-1 truncate leading-snug ${!email.is_read ? "font-semibold text-[var(--foreground)]" : "font-medium text-[var(--foreground)] opacity-75"}`}>
                        {(email.sender ?? "").replace(/<.*>/, "").trim() || email.sender_email || "Unknown"}
                      </span>
                      <span className="text-[11px] text-[var(--muted)] shrink-0 tabular-nums">{formatTime(email.received_at)}</span>
                    </div>

                    <p className={`text-[12px] truncate leading-snug ${!email.is_read ? "text-[var(--foreground)] opacity-90" : "text-[var(--muted)]"}`}>
                      {email.subject || "(no subject)"}
                    </p>

                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {!proc ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md font-medium bg-[var(--surface-2)] text-[var(--muted)] flex items-center gap-0.5">
                          <span className="material-symbols-outlined animate-spin" style={{ fontSize: "9px" }}>progress_activity</span>
                          analyzing
                        </span>
                      ) : proc.category && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${categoryColors[proc.category] || "bg-[var(--surface-2)] text-[var(--muted)]"}`}>
                          {proc.category}
                        </span>
                      )}
                      {Array.isArray(proc?.extra_labels) && proc.extra_labels.map((label: string) => {
                        const tagMeta = customTagColors[label];
                        const hex = tagMeta?.color || "#6b7280";
                        return (
                          <span
                            key={label}
                            className="text-[10px] px-1.5 py-0.5 rounded-md font-medium"
                            style={{
                              backgroundColor: `${hex}18`,
                              color: hex,
                              boxShadow: `inset 0 0 0 1px ${hex}40`,
                            }}
                          >
                            {tagMeta?.displayName || label}
                          </span>
                        );
                      })}
                      {email.has_attachments && (
                        <span className="material-symbols-outlined text-[var(--muted)] opacity-60" style={{ fontSize: "12px" }}>attachment</span>
                      )}
                      <button
                        onClick={(e) => toggleStar(email, e)}
                        className={`ml-auto transition-opacity ${email.is_starred ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                      >
                        <span
                          className={`material-symbols-outlined ${email.is_starred ? "text-amber-400" : "text-[var(--muted)]"} hover:text-amber-400`}
                          style={{ fontSize: "14px", fontVariationSettings: email.is_starred ? "'FILL' 1" : "'FILL' 0" }}
                        >
                          star
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Pagination */}
        {(page > 0 || hasMore) && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-[var(--border)] flex-shrink-0">
            <button
              onClick={() => handlePageChange(page - 1)}
              disabled={page === 0}
              className="text-xs text-[var(--muted)] hover:text-slate-900 dark:hover:text-white disabled:opacity-30"
            >
              ← Prev
            </button>
            <span className="text-xs text-[var(--muted)]">Page {page + 1}</span>
            <button
              onClick={() => handlePageChange(page + 1)}
              disabled={!hasMore}
              className="text-xs text-[var(--muted)] hover:text-slate-900 dark:hover:text-white disabled:opacity-30"
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* ── Right pane: email detail or empty state ── */}
      <div className={`flex-1 overflow-hidden ${selectedEmail ? "flex" : "hidden md:flex"} flex-col`}>
        {selectedEmail ? (
          <EmailDetail
            key={selectedEmail.id}
            email={selectedEmail}
            onBack={() => setSelectedEmail(null)}
            onArchive={() => archiveEmail(selectedEmail)}
            onReply={() => openCompose(selectedEmail)}
            onMarkUnread={() => {
              setEmails((prev) => prev.map((e) => e.id === selectedEmail.id ? { ...e, is_read: false } : e));
              setSelectedEmail(null);
            }}
            onSnooze={() => {
              setEmails((prev) => prev.filter((e) => e.id !== selectedEmail.id));
              setSelectedEmail(null);
            }}
            onRethink={(updated) => {
              setEmails((prev) => prev.map((e) => e.id === selectedEmail.id ? { ...e, email_processed: updated } : e));
              setSelectedEmail((prev) => prev ? { ...prev, email_processed: updated } : prev);
            }}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-[var(--muted)] gap-3">
            <div className="w-14 h-14 rounded-2xl bg-[var(--surface-2)] flex items-center justify-center">
              <span className="material-symbols-outlined text-[var(--muted)]" style={{ fontSize: "28px", fontVariationSettings: "'FILL' 1, 'wght' 200" }}>mark_email_read</span>
            </div>
            <div className="text-center">
              <p className="text-[13px] font-medium text-[var(--foreground)] opacity-50">Select an email to read</p>
              <p className="text-[11px] opacity-40 mt-0.5">J/K to navigate · E to archive · N to compose</p>
            </div>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
