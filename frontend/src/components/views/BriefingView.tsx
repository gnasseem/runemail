"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useApp } from "../AppShell";
import { type BriefingResult, type BriefingEmail, type DeadlineItem } from "@/lib/emailGraph";
import EmailDetail from "../EmailDetail";
import SolveAgentButton from "../solve/SolveAgentButton";

type FilterType = "crucial" | "replyNeeded" | "deadlines" | "nonEssential" | null;

interface NormalizedBriefing {
  executiveSummary: string;
  crucial: BriefingEmail[];
  replyNeeded: BriefingEmail[];
  deadlines: BriefingEmail[];
  nonEssential: BriefingEmail[];
  stats: {
    total: number;
    crucial: number;
    replyNeeded: number;
    deadlines: number;
    nonEssential: number;
  };
}

type BriefingAccent = "crucial" | "reply" | "deadline" | "noise";

const ACCENT_BORDER: Record<BriefingAccent, string> = {
  crucial: "border-l-rose-500/75",
  reply: "border-l-sky-500/75",
  deadline: "border-l-violet-500/75",
  noise: "border-l-slate-400/40",
};

function executiveSummaryIsUsable(s: string | undefined | null): boolean {
  if (!s?.trim()) return false;
  return !s.toLowerCase().includes("unable to generate briefing");
}

/** Strip HTML from cloud summaries so text is readable and not theme-colored by inline styles. */
function briefingExecutiveSummaryDisplay(raw: string): string {
  let s = raw.replace(/\r\n/g, "\n").trim();
  if (!s) return s;
  if (/<[a-z][\s\S]*>/i.test(s)) {
    s = s
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<[^>]+>/g, "");
    s = s
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&amp;/gi, "&");
    s = s.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
  }
  return s;
}

function formatDeadlineDate(iso: string) {
  try {
    const parts = iso.split("T")[0].split("-").map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch { return iso; }
}

function daysUntil(iso: string): number {
  try {
    const parts = iso.split("T")[0].split("-").map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diff = Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    // AI sometimes uses the wrong year; try bumping by 1 year if far in the past
    if (diff <= -300) {
      const corrected = new Date(parts[0] + 1, parts[1] - 1, parts[2]);
      return Math.round((corrected.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    }
    return diff;
  } catch { return 999; }
}

/** Convert either new or old briefing shape into a unified NormalizedBriefing */
function normalizeBriefing(b: BriefingResult, followUps: FollowUp[]): NormalizedBriefing {
  // New shape: has crucial array
  if (Array.isArray((b as any).crucial)) {
    let crucial: BriefingEmail[] = (b as any).crucial ?? [];
    let replyNeededAI: BriefingEmail[] = (b as any).replyNeeded ?? [];
    let deadlines: BriefingEmail[] = Array.isArray((b as any).deadlines)
      ? ((b as any).deadlines as any[]).filter((d: any) => d.subject !== undefined)
      : [];
    let nonEssential: BriefingEmail[] = (b as any).nonEssential ?? [];

    // Rescue: if AI put everything in nonEssential, reclassify by sender/urgency
    if (crucial.length === 0 && replyNeededAI.length === 0 && deadlines.length === 0 && nonEssential.length > 0) {
      const rescued: BriefingEmail[] = [];
      const kept: BriefingEmail[] = [];
      for (const e of nonEssential) {
        const isAutoSender = /no.?reply|noreply|mailer-daemon|donotreply|@.*\.(marketing|promo|newsletter|bulk)/i.test(e.sender ?? "");
        if (!isAutoSender) {
          rescued.push(e);
        } else {
          kept.push(e);
        }
      }
      if (rescued.length > 0) {
        crucial = [...crucial, ...rescued];
        nonEssential = kept;
      }
    } else {
      // Move critical/high urgency items out of nonEssential even in partial results
      const misclassified = nonEssential.filter((e) => e.urgency === "critical" || e.urgency === "high");
      if (misclassified.length > 0) {
        crucial = [...crucial, ...misclassified];
        nonEssential = nonEssential.filter((e) => e.urgency !== "critical" && e.urgency !== "high");
      }
    }

    // Promote crucial emails that actually need a reply → replyNeeded
    const promoteToReply = crucial.filter((e) => e.waitingForReply);
    if (promoteToReply.length > 0) {
      replyNeededAI = [...replyNeededAI, ...promoteToReply];
      crucial = crucial.filter((e) => !e.waitingForReply);
    }

    // Promote crucial emails with a deadline → deadlines
    const promoteToDeadline = crucial.filter((e) => e.deadline);
    if (promoteToDeadline.length > 0) {
      deadlines = [...deadlines, ...promoteToDeadline];
      crucial = crucial.filter((e) => !e.deadline);
    }

    // Merge follow-ups into replyNeeded as synthetic BriefingEmail cards
    const followUpCards: BriefingEmail[] = followUps.map((f) => ({
      subject: f.subject,
      senderName: f.sender,
      sender: f.sender_email ?? f.sender,
      summary: `Sent ${Math.floor((Date.now() - new Date(f.received_at).getTime()) / 86400000)} days ago with no reply received.`,
      urgency: "medium" as const,
      deadline: null,
      waitingForReply: true,
      tags: ["NO_REPLY"],
      email_id: f.id,
    }));
    const replyNeeded = [...replyNeededAI, ...followUpCards];

    // Stats are always derived from array lengths so counts are internally consistent.
    return {
      executiveSummary: b.executiveSummary,
      crucial,
      replyNeeded,
      deadlines,
      nonEssential,
      stats: {
        total: crucial.length + replyNeeded.length + deadlines.length + nonEssential.length,
        crucial: crucial.length,
        replyNeeded: replyNeeded.length,
        deadlines: deadlines.length,
        nonEssential: nonEssential.length,
      },
    };
  }

  // Old shape (v1): has topPriority
  const topPriority: BriefingEmail[] = (b as any).topPriority ?? [];
  const oldWaiting: BriefingEmail[] = (b as any).waitingForReply ?? [];
  const oldDeadlineItems: DeadlineItem[] = Array.isArray((b as any).deadlines)
    ? ((b as any).deadlines as any[]).filter((d: any) => d.task !== undefined)
    : [];

  const replyNeededFromTop = topPriority.filter((e) => e.waitingForReply);
  const deadlinesFromTop = topPriority.filter((e) => !e.waitingForReply && e.deadline);
  const crucial = topPriority.filter((e) => !e.waitingForReply && !e.deadline);

  const topIds = new Set(topPriority.map((e) => e.email_id).filter(Boolean));
  const extraWaiting = oldWaiting.filter((e) => !e.email_id || !topIds.has(e.email_id));

  // Convert DeadlineItem rows that aren't already represented in deadlinesFromTop
  const deadlineEmailsFromItems: BriefingEmail[] = oldDeadlineItems
    .filter((d) => !deadlinesFromTop.find((e) => e.deadline === d.date))
    .map((d) => ({
      subject: d.task,
      senderName: d.source,
      sender: d.source,
      summary: `Due ${d.date}`,
      urgency: "medium" as const,
      deadline: d.date,
      waitingForReply: false,
      tags: ["DEADLINE"],
    }));

  const followUpCards: BriefingEmail[] = followUps.map((f) => ({
    subject: f.subject,
    senderName: f.sender,
    sender: f.sender_email ?? f.sender,
    summary: `Sent ${Math.floor((Date.now() - new Date(f.received_at).getTime()) / 86400000)} days ago with no reply received.`,
    urgency: "medium" as const,
    deadline: null,
    waitingForReply: true,
    tags: ["NO_REPLY"],
    email_id: f.id,
  }));

  const replyNeeded = [...replyNeededFromTop, ...extraWaiting, ...followUpCards];
  const deadlines = [...deadlinesFromTop, ...deadlineEmailsFromItems];

  return {
    executiveSummary: b.executiveSummary,
    crucial,
    replyNeeded,
    deadlines,
    nonEssential: [],
    stats: {
      total: crucial.length + replyNeeded.length + deadlines.length,
      crucial: crucial.length,
      replyNeeded: replyNeeded.length,
      deadlines: deadlines.length,
      nonEssential: 0,
    },
  };
}

interface FollowUp {
  id: string;
  subject: string;
  sender: string;
  sender_email?: string;
  received_at: string;
  thread_id?: string;
}

const URGENCY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2 };

// ── Topic grouping helpers ─────────────────────────────────────────────────

function normalizeSubject(s: string): string {
  return s.replace(/^(re|fwd?|fw)(\[\d+\])?:\s*/gi, "").trim().toLowerCase();
}

function fuzzyMatchBriefing(a: string, b: string): boolean {
  const stop = new Set(["the", "a", "an", "to", "and", "or", "of", "in", "on", "for", "is", "it", "this", "that"]);
  const words = (s: string) =>
    new Set(s.toLowerCase().match(/[a-z0-9]+/g)?.filter((w) => !stop.has(w)) ?? []);
  const wa = words(a);
  const wb = words(b);
  if (!wa.size || !wb.size) return false;
  const overlap = Array.from(wa).filter((w) => wb.has(w)).length;
  return overlap / Math.min(wa.size, wb.size) >= 0.75;
}

function groupByTopic(cards: BriefingEmail[]): BriefingEmail[][] {
  const groups: BriefingEmail[][] = [];
  for (const card of cards) {
    const normSub = normalizeSubject(card.subject ?? "");
    const existing = groups.find((g) => {
      const gs = normalizeSubject(g[0].subject ?? "");
      return gs === normSub || (normSub.length > 4 && gs.length > 4 && fuzzyMatchBriefing(gs, normSub));
    });
    if (existing) existing.push(card);
    else groups.push([card]);
  }
  return groups;
}

function EmailCard({
  email,
  onClick,
  onDismiss,
  hideUrgency,
  accent = "crucial",
}: {
  email: BriefingEmail;
  onClick?: () => void;
  onDismiss?: () => void;
  hideUrgency?: boolean;
  accent?: BriefingAccent;
}) {
  const hasNoReply = email.tags?.includes("NO_REPLY");
  const borderAccent = ACCENT_BORDER[hideUrgency ? "noise" : accent];
  const urgencyLabel =
    email.urgency === "critical" ? "Critical" : email.urgency === "high" ? "High" : "Med";

  const senderLabel = (email.senderName && email.senderName !== "null")
    ? email.senderName
    : ((email.sender && email.sender !== "null") ? email.sender : "");

  const rowBase =
    `rounded-lg border border-[var(--border)] bg-[var(--surface)] border-l-2 ${borderAccent} transition-colors duration-200 ` +
    (onClick ? "cursor-pointer hover:bg-[var(--surface-2)]/80 " : "");

  if (hideUrgency) {
    return (
      <div
        className={`${rowBase} flex items-center gap-2 px-2.5 py-1.5`}
        onClick={onClick}
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
      >
        <div className="flex-1 min-w-0">
          <span className="text-[12px] font-medium text-[var(--foreground)] truncate block leading-snug font-['DM_Sans',ui-sans-serif,sans-serif]">
            {email.subject}
          </span>
          {senderLabel && (
            <span className="text-[10px] text-[var(--muted)] truncate block leading-snug">{senderLabel}</span>
          )}
        </div>
        {onDismiss && (
          <button
            onClick={(e) => { e.stopPropagation(); onDismiss(); }}
            className="shrink-0 p-1 rounded-md hover:bg-black/[0.06] dark:hover:bg-white/[0.06] text-[var(--muted)] hover:text-red-400 transition-colors cursor-pointer"
            title="Dismiss"
            aria-label="Dismiss"
          >
            <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>close</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className={`${rowBase} px-3 py-2.5`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1 min-w-0">
          {!hasNoReply && (
            <span className="text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)] tabular-nums">
              {urgencyLabel}
            </span>
          )}
          {email.waitingForReply && !hasNoReply && (
            <span className="text-[9px] font-semibold uppercase tracking-wide text-sky-600 dark:text-sky-400/90">
              Reply
            </span>
          )}
          {hasNoReply && (
            <span className="text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400/90">
              No reply yet
            </span>
          )}
          {email.deadline && (
            <span className="text-[9px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400/90">
              Due {formatDeadlineDate(email.deadline)}
            </span>
          )}
          {email.tags?.filter((t) => !["REPLY_NEEDED", "DEADLINE", "NO_REPLY"].includes(t)).map((tag) => (
            <span key={tag} className="text-[9px] text-[var(--muted)]">
              {tag}
            </span>
          ))}
        </div>
        {onDismiss && (
          <button
            onClick={(e) => { e.stopPropagation(); onDismiss(); }}
            className="shrink-0 p-1 rounded-md hover:bg-black/[0.06] dark:hover:bg-white/[0.06] text-[var(--muted)] hover:text-red-400 transition-colors cursor-pointer"
            title="Dismiss"
            aria-label="Dismiss"
          >
            <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>close</span>
          </button>
        )}
      </div>
      <p className="text-[13px] font-semibold text-[var(--foreground)] mt-1 leading-snug line-clamp-2 font-['DM_Sans',ui-sans-serif,sans-serif]">
        {email.subject}
      </p>
      <p className="text-[11px] text-[var(--muted)] mt-0.5 line-clamp-1">
        {senderLabel}
        {email.senderName && email.senderName !== "null" && email.sender && email.sender !== "null" && email.senderName !== email.sender && (
          <span className="opacity-60"> · {email.sender}</span>
        )}
      </p>
      {email.signal?.trim() && (
        <p className="text-[11px] text-sky-700/90 dark:text-sky-400/80 mt-1 line-clamp-1 italic">
          {email.signal}
        </p>
      )}
      <p className="text-[12px] text-slate-700 dark:text-slate-200 mt-1 leading-snug line-clamp-2 font-['DM_Sans',ui-sans-serif,sans-serif]">
        {email.summary}
      </p>
    </div>
  );
}

function GroupedEmailCard({
  group,
  onClickEmail,
  onDismiss,
  accent = "crucial",
}: {
  group: BriefingEmail[];
  onClickEmail?: (email: BriefingEmail) => void;
  onDismiss?: (email: BriefingEmail) => void;
  accent?: BriefingAccent;
}) {
  const [expanded, setExpanded] = useState(false);
  const sorted = [...group].sort((a, b) => (URGENCY_ORDER[a.urgency] ?? 3) - (URGENCY_ORDER[b.urgency] ?? 3));
  const primary = sorted[0];
  const rest = sorted.slice(1);

  return (
    <div className="space-y-1.5">
      <EmailCard
        email={primary}
        accent={accent}
        onClick={primary.email_id && onClickEmail ? () => onClickEmail(primary) : undefined}
        onDismiss={primary.email_id && onDismiss ? () => onDismiss(primary) : undefined}
      />
      {rest.length > 0 && (
        <div className="ml-2 pl-2 border-l border-[var(--border)]">
          {!expanded && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="text-[10px] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors flex items-center gap-0.5 py-0.5 cursor-pointer"
            >
              <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>expand_more</span>
              {rest.length} more on thread
            </button>
          )}
          {expanded && (
            <div className="space-y-1.5 mt-1">
              {rest.map((email, i) => (
                <EmailCard
                  key={email.email_id ?? i}
                  email={email}
                  accent={accent}
                  onClick={email.email_id && onClickEmail ? () => onClickEmail(email) : undefined}
                  onDismiss={email.email_id && onDismiss ? () => onDismiss(email) : undefined}
                />
              ))}
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="text-[10px] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors flex items-center gap-0.5 py-0.5 cursor-pointer"
              >
                <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>expand_less</span>
                Collapse
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SectionHeader({ icon, label, color }: { icon: string; label: string; color: string }) {
  return (
    <div className="flex items-center gap-2 mb-3 mt-1">
      <span className={`material-symbols-outlined ${color}`} style={{ fontSize: "16px" }}>{icon}</span>
      <h2 className="text-xs font-bold tracking-widest text-[var(--muted)] uppercase">{label}</h2>
    </div>
  );
}

export default function BriefingView() {
  const {
    user,
    profile,
    getViewCache,
    setViewCache,
    invalidateViewCache,
    briefingVersion,
    ttsJobs,
    startTts,
    stopTts,
    briefingRegenerating,
    requestBriefingRegeneration,
    prefetchBriefingExecutiveTts,
    briefingAudioAutoplay,
  } = useApp();
  const supabase = createClient();
  const [briefing, setBriefing] = useState<BriefingResult | null>(null);
  const [briefingAt, setBriefingAt] = useState<string | null>(null);
  const [meetings, setMeetings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEmail, setSelectedEmail] = useState<any | null>(null);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [activeFilter, setActiveFilter] = useState<FilterType>(null);
  const briefingTtsKey = String(briefingVersion ?? "current");
  const briefingTts = ttsJobs[`briefing:${briefingTtsKey}`];
  const speaking = briefingTts?.status === "playing";
  const audioLoading = briefingTts?.status === "loading";
  const audioBuffered = briefingTts?.status === "buffered";
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const setSpeaking = (_: boolean) => { void _; };
  const setAudioLoading = (_: boolean) => { void _; };
  const [nonEssentialExpanded, setNonEssentialExpanded] = useState(false);
  const [importantExpanded, setImportantExpanded] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(`runemail_dismissed_briefing_${user.id}`);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch { return new Set(); }
  });
  const generateBriefingOnDemandRef = useRef<(() => void) | null>(null);

  const isFromToday = (ts: number | null | undefined): boolean => {
    if (!ts) return false;
    const d = new Date(ts);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  };

  const loadCachedBriefing = useCallback(async () => {
    const memCached = getViewCache("briefing");
    if (memCached) {
      setBriefing(memCached.data);
      setBriefingAt(memCached.at);
      setLoading(false);
      const cachedTs = memCached.at ? new Date(memCached.at).getTime() : null;
      if (!isFromToday(cachedTs)) generateBriefingOnDemandRef.current?.();
      return;
    }

    try {
      const cached = localStorage.getItem(`runemail_briefing_cache_${user.id}`);
      if (cached) {
        const { data, ts } = JSON.parse(cached);
        if (data?.executiveSummary !== undefined) {
          const at = ts ? new Date(ts).toISOString() : null;
          setBriefing(data);
          if (at) setBriefingAt(at);
          setViewCache("briefing", { data, at });
          setLoading(false);
          if (!isFromToday(ts)) generateBriefingOnDemandRef.current?.();
          return;
        }
      }
    } catch { /* ignore */ }

    try {
      const { data: row } = await supabase
        .from("profiles")
        .select("last_briefing, last_briefing_at")
        .eq("id", user.id)
        .single();
      if (row?.last_briefing) {
        setBriefing(row.last_briefing as unknown as BriefingResult);
        setBriefingAt(row.last_briefing_at ?? null);
        setViewCache("briefing", { data: row.last_briefing, at: row.last_briefing_at ?? null });
        const dbTs = row.last_briefing_at ? new Date(row.last_briefing_at).getTime() : null;
        localStorage.setItem(
          `runemail_briefing_cache_${user.id}`,
          JSON.stringify({ data: row.last_briefing, ts: dbTs ?? Date.now() }),
        );
        if (!isFromToday(dbTs)) generateBriefingOnDemandRef.current?.();
      }
    } catch { /* ignore */ }

    setLoading(false);
  }, [user.id, supabase, getViewCache, setViewCache]);

  const loadMeetings = useCallback(async () => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    const { data } = await supabase
      .from("meetings")
      .select("*")
      .eq("user_id", user.id)
      .gte("start_time", startOfDay.toISOString())
      .lte("start_time", endOfDay.toISOString())
      .order("start_time", { ascending: true });
    setMeetings((data || []) as any[]);
  }, [user.id, supabase]);

  generateBriefingOnDemandRef.current = requestBriefingRegeneration;

  useEffect(() => {
    let mounted = true;
    loadCachedBriefing();
    loadMeetings();

    // Load follow-up reminders: sent emails 3-14 days ago with no reply in thread
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString();
    supabase
      .from("emails")
      .select("id, subject, sender, sender_email, received_at, thread_id")
      .eq("user_id", user.id)
      .contains("label_ids", ["SENT"])
      .lt("received_at", threeDaysAgo)
      .gt("received_at", twoWeeksAgo)
      .order("received_at", { ascending: false })
      .limit(50)
      .then(async ({ data: sentEmails }) => {
        if (!sentEmails?.length || !mounted) return;
        const threadIds = [...new Set(sentEmails.map((e: any) => e.thread_id).filter(Boolean))];
        const { data: replies } = await supabase
          .from("emails")
          .select("thread_id, received_at")
          .eq("user_id", user.id)
          .in("thread_id", threadIds)
          .not("label_ids", "cs", '["SENT"]');
        const repliedThreads = new Set((replies ?? []).map((r: any) => r.thread_id));
        const noReply = sentEmails.filter((e: any) => e.thread_id && !repliedThreads.has(e.thread_id));
        if (mounted) setFollowUps(noReply.slice(0, 5) as FollowUp[]);
      });
    return () => { mounted = false; };
  }, [loadCachedBriefing, loadMeetings, user.id]);

  useEffect(() => {
    const s = briefing?.executiveSummary?.trim();
    if (!s || !briefingAudioAutoplay || !executiveSummaryIsUsable(s)) return;
    void prefetchBriefingExecutiveTts(s);
  }, [briefing?.executiveSummary, briefingAudioAutoplay, prefetchBriefingExecutiveTts]);

  const prevBriefingVersion = useRef(briefingVersion);
  useEffect(() => {
    if (briefingVersion !== prevBriefingVersion.current) {
      prevBriefingVersion.current = briefingVersion;
      invalidateViewCache("briefing");
      loadCachedBriefing();
    }
  }, [briefingVersion, invalidateViewCache, loadCachedBriefing]);

  const dismissCard = useCallback((id: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev).add(id);
      localStorage.setItem(`runemail_dismissed_briefing_${user.id}`, JSON.stringify([...next]));
      return next;
    });
  }, [user.id]);

  const openEmailById = useCallback(async (emailId: string) => {
    const { data } = await supabase
      .from("emails")
      .select("*, email_processed(*)")
      .eq("id", emailId)
      .single();
    if (data) setSelectedEmail(data);
  }, [supabase]);

  const toggleAudio = useCallback(async () => {
    const text = briefing?.executiveSummary;
    if (!text || !executiveSummaryIsUsable(text)) return;
    if (briefingTts?.status === "playing" || briefingTts?.status === "paused") {
      stopTts("briefing", briefingTtsKey);
      return;
    }
    await startTts("briefing", briefingTtsKey, text);
  }, [briefing?.executiveSummary, briefingTts, briefingTtsKey, startTts, stopTts]);

  const formatTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });

  const normalized = briefing ? normalizeBriefing(briefing, followUps) : null;

  // Apply dismissals
  const filterDismissed = (cards: BriefingEmail[]) =>
    cards.filter((e) => !e.email_id || !dismissedIds.has(e.email_id));

  const displayCrucial = normalized
    ? [...filterDismissed(normalized.crucial)].sort(
        (a, b) => (URGENCY_ORDER[a.urgency] ?? 3) - (URGENCY_ORDER[b.urgency] ?? 3),
      )
    : [];
  const displayReplyNeeded = normalized ? filterDismissed(normalized.replyNeeded) : [];
  const displayDeadlines = normalized ? filterDismissed(normalized.deadlines).filter((e) => {
    if (!e.deadline) return true;
    const days = daysUntil(e.deadline);
    return days !== 999 && days <= 365;
  }) : [];
  const displayNonEssential = normalized ? filterDismissed(normalized.nonEssential) : [];

  // Split crucial by urgency tier
  const crucialsHigh = displayCrucial.filter((e) => e.urgency === "critical" || e.urgency === "high");
  const crucialsImportant = displayCrucial.filter((e) => e.urgency === "medium");

  // Split reply needed: incoming (needs reply) vs outbound follow-ups (no reply yet)
  const displayReplyNeededIncoming = displayReplyNeeded.filter((e) => !e.tags?.includes("NO_REPLY"));
  const displayNoReplyYet = displayReplyNeeded.filter((e) => e.tags?.includes("NO_REPLY"));

  const displayStats = normalized ? {
    total: normalized.stats.total,
    crucial: displayCrucial.length,
    replyNeeded: displayReplyNeeded.length,
    deadlines: displayDeadlines.length,
    nonEssential: normalized.stats.nonEssential,
  } : null;

  const hasContent = Boolean(
    briefing &&
      (executiveSummaryIsUsable(briefing.executiveSummary) ||
        (normalized?.crucial?.length ?? 0) > 0 ||
        (normalized?.replyNeeded?.length ?? 0) > 0 ||
        (normalized?.deadlines?.length ?? 0) > 0 ||
        (normalized?.nonEssential?.length ?? 0) > 0),
  );
  const summaryFailedButHasCards = Boolean(
    briefing &&
      !executiveSummaryIsUsable(briefing.executiveSummary) &&
      ((normalized?.crucial?.length ?? 0) > 0 ||
        (normalized?.replyNeeded?.length ?? 0) > 0 ||
        (normalized?.deadlines?.length ?? 0) > 0 ||
        (normalized?.nonEssential?.length ?? 0) > 0),
  );

  // Which email list to show based on active filter
  const filteredEmails: BriefingEmail[] = (() => {
    if (activeFilter === "crucial") return displayCrucial;
    if (activeFilter === "replyNeeded") return displayReplyNeeded;
    if (activeFilter === "deadlines") return displayDeadlines;
    if (activeFilter === "nonEssential") return displayNonEssential;
    return [];
  })();

  const FILTER_CONFIG = {
    crucial: {
      label: "Crucial",
      icon: "priority_high",
      color: "text-rose-500 dark:text-rose-400",
      border: "border-rose-500/30",
      activeBg: "bg-rose-500/10",
      count: displayStats?.crucial ?? 0,
    },
    replyNeeded: {
      label: "Reply Needed",
      icon: "reply",
      color: "text-sky-500 dark:text-sky-400",
      border: "border-sky-500/30",
      activeBg: "bg-sky-500/10",
      count: displayStats?.replyNeeded ?? 0,
    },
    deadlines: {
      label: "Deadlines",
      icon: "event_upcoming",
      color: "text-violet-500 dark:text-violet-400",
      border: "border-violet-500/30",
      activeBg: "bg-violet-500/10",
      count: displayStats?.deadlines ?? 0,
    },
    nonEssential: {
      label: "Non-essential",
      icon: "filter_alt",
      color: "text-slate-500 dark:text-slate-400",
      border: "border-slate-500/20",
      activeBg: "bg-slate-500/10",
      count: displayStats?.nonEssential ?? 0,
    },
  };

  return (
    <div className="h-full flex overflow-hidden">
      {/* Left panel: Today's timeline */}
      <div className="w-72 lg:w-80 border-r border-[var(--border)] flex flex-col flex-shrink-0 overflow-auto">
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <span className="material-symbols-outlined text-[var(--accent)]" style={{ fontSize: "18px" }}>today</span>
            Today&apos;s Schedule
          </h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            {new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
          </p>
        </div>
        <div className="flex-1 p-4">
          {meetings.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-[var(--muted)] text-center">
              <span className="material-symbols-outlined mb-2" style={{ fontSize: "40px" }}>event_available</span>
              <p className="text-sm">No meetings today</p>
              <p className="text-xs mt-1 opacity-70">Your calendar is clear</p>
            </div>
          ) : (
            <div className="space-y-3">
              {meetings.map((m: any) => (
                <div key={m.id} className="flex gap-3">
                  <div className="text-right shrink-0 w-14">
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-300">{formatTime(m.start_time)}</p>
                    <p className="text-[10px] text-[var(--muted)]">{formatTime(m.end_time)}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`p-2 rounded-lg border-l-2 ${m.status === "confirmed" ? "border-l-emerald-500 bg-emerald-50 dark:bg-emerald-900/20" : "border-l-blue-500 bg-blue-50 dark:bg-blue-900/20"}`}>
                      <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{m.title}</p>
                      {m.attendees?.length > 0 && (
                        <p className="text-[11px] text-[var(--muted)] truncate mt-0.5">
                          {m.attendees.slice(0, 2).join(", ")}{m.attendees.length > 2 ? ` +${m.attendees.length - 2}` : ""}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right panel: Executive briefing or email detail */}
      <div className="flex-1 overflow-auto">
        {selectedEmail ? (
          <EmailDetail
            key={selectedEmail.id}
            email={selectedEmail}
            onBack={() => setSelectedEmail(null)}
            onArchive={() => setSelectedEmail(null)}
            onReply={() => setSelectedEmail(null)}
            onMarkUnread={() => setSelectedEmail(null)}
            onSnooze={() => setSelectedEmail(null)}
            onRethink={(updated: any) => setSelectedEmail((prev: any) => prev ? { ...prev, email_processed: updated } : prev)}
          />
        ) : (
          <div className="max-w-3xl mx-auto px-6 py-5">
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <div>
                <h1 className="text-[1.35rem] font-bold text-[var(--foreground)] flex items-center gap-2 font-['Syne',system-ui,sans-serif] tracking-tight">
                  <span className="material-symbols-outlined text-[var(--accent)]" style={{ fontSize: "22px" }}>summarize</span>
                  Morning Briefing
                </h1>
                <p className="text-[11px] text-[var(--muted)] mt-0.5 font-['DM_Sans',ui-sans-serif,sans-serif]">
                  {briefingAt
                    ? `Generated ${new Date(briefingAt).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" })} at ${new Date(briefingAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })}`
                    : new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void requestBriefingRegeneration()}
                  disabled={briefingRegenerating}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-50"
                  title={briefingRegenerating ? "Regenerating briefing..." : "Regenerate briefing"}
                  aria-label="Regenerate briefing"
                >
                  <span
                    className={`material-symbols-outlined ${briefingRegenerating ? "animate-spin" : ""}`}
                    style={{ fontSize: "16px" }}
                  >
                    {briefingRegenerating ? "progress_activity" : "refresh"}
                  </span>
                </button>
                <SolveAgentButton disabled={!hasContent || briefingRegenerating} />
              </div>
            </div>

            {loading ? (
              <div className="space-y-4">
                <div className="h-16 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
                <div className="flex gap-3">
                  {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-14 flex-1 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />)}
                </div>
                {[1, 2, 3].map((i) => <div key={i} className="h-24 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />)}
              </div>
            ) : !hasContent ? (
              <div className="text-center py-16 text-[var(--muted)]">
                <span className="material-symbols-outlined mb-3" style={{ fontSize: "48px" }}>mark_email_read</span>
                <p className="text-sm font-medium">No briefing available</p>
                <p className="text-xs mt-1 opacity-70 mb-4">Generate a briefing from your current inbox.</p>
                <button
                  onClick={() => void requestBriefingRegeneration()}
                  disabled={briefingRegenerating}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  <span className={`material-symbols-outlined ${briefingRegenerating ? "animate-spin" : ""}`} style={{ fontSize: "16px" }}>
                    {briefingRegenerating ? "progress_activity" : "auto_awesome"}
                  </span>
                  {briefingRegenerating ? "Generating..." : "Generate Briefing"}
                </button>
              </div>
            ) : (
              <div className="space-y-5">
                {/* Compact inline meta chips — muted, calm, dashboard aesthetic */}
                {displayStats && (
                  <div className="flex flex-wrap items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)]/60 px-2 py-1.5">
                    <button
                      onClick={() => setActiveFilter(null)}
                      title="Show all"
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                        activeFilter === null
                          ? "bg-[var(--foreground)] text-[var(--background)]"
                          : "text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: "13px" }}>inbox</span>
                      <span>All</span>
                      <span className="tabular-nums opacity-70">{displayStats.total}</span>
                    </button>
                    <span className="h-4 w-px bg-[var(--border)]" aria-hidden />
                    {([
                      { key: "crucial", label: "Crucial", dot: "bg-rose-400", icon: "priority_high", count: displayStats.crucial },
                      { key: "replyNeeded", label: "Reply", dot: "bg-sky-400", icon: "reply", count: displayStats.replyNeeded },
                      { key: "deadlines", label: "Deadlines", dot: "bg-violet-400", icon: "event_upcoming", count: displayStats.deadlines },
                      { key: "nonEssential", label: "Noise", dot: "bg-slate-400", icon: "filter_alt", count: displayStats.nonEssential },
                    ] as const).map((chip) => {
                      const isActive = activeFilter === chip.key;
                      return (
                        <button
                          key={chip.key}
                          onClick={() => setActiveFilter(isActive ? null : chip.key)}
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                            isActive
                              ? "bg-[var(--foreground)] text-[var(--background)]"
                              : "text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
                          }`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${chip.dot}`} aria-hidden />
                          <span>{chip.label}</span>
                          <span className="tabular-nums opacity-70">{chip.count}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {/* Executive summary + audio */}
                {briefing && executiveSummaryIsUsable(briefing.executiveSummary) && (
                  <div className="px-4 py-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface)]/90">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <span className="text-[10px] font-semibold tracking-[0.12em] text-[var(--muted)] uppercase font-['Syne',system-ui,sans-serif]">Executive summary</span>
                      <button
                        type="button"
                        onClick={toggleAudio}
                        disabled={audioLoading}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all duration-150 cursor-pointer ${
                          speaking
                            ? "bg-red-500 text-white border border-red-600 hover:bg-red-600"
                            : audioLoading
                            ? "border border-[var(--border)] text-[var(--muted)] bg-[var(--surface-2)] opacity-70 cursor-wait"
                            : "border border-[var(--border)] text-[var(--foreground)] bg-[var(--surface-2)] hover:border-[var(--accent)]/50"
                        }`}
                        title={
                          speaking
                            ? "Stop reading"
                            : audioLoading
                              ? "Loading audio..."
                              : audioBuffered
                                ? "Play briefing audio"
                                : "Read aloud"
                        }
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
                          {speaking
                            ? "stop_circle"
                            : audioLoading
                              ? "hourglass_empty"
                              : audioBuffered
                                ? "play_circle"
                                : "volume_up"}
                        </span>
                        {speaking ? "Stop" : audioLoading ? "Loading..." : audioBuffered ? "Play" : "Listen"}
                      </button>
                    </div>
                    <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-slate-800 dark:text-slate-100 font-['DM_Sans',ui-sans-serif,sans-serif]">
                      {briefingExecutiveSummaryDisplay(briefing.executiveSummary)}
                    </p>
                  </div>
                )}
                {summaryFailedButHasCards && (
                  <div
                    className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] dark:bg-amber-500/10 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between"
                    role="status"
                  >
                    <p className="text-[13px] text-[var(--foreground)] leading-snug font-['DM_Sans',ui-sans-serif,sans-serif]">
                      Overview text did not generate for this inbox load, but the sections below are filled from your mail. Regenerate to try the overview again.
                    </p>
                    <button
                      type="button"
                      onClick={() => void requestBriefingRegeneration()}
                      disabled={briefingRegenerating}
                      className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[12px] font-medium hover:border-[var(--accent)]/50 disabled:opacity-50 cursor-pointer transition-colors"
                    >
                      <span className={`material-symbols-outlined ${briefingRegenerating ? "animate-spin" : ""}`} style={{ fontSize: "15px" }}>
                        {briefingRegenerating ? "progress_activity" : "refresh"}
                      </span>
                      {briefingRegenerating ? "Working…" : "Regenerate"}
                    </button>
                  </div>
                )}

                {/* Email list: filtered or grouped */}
                {activeFilter ? (
                  <div>
                    {/* replyNeeded filter: show as two subsections */}
                    {activeFilter === "replyNeeded" ? (
                      <div className="space-y-6">
                        {displayReplyNeededIncoming.length > 0 && (
                          <div>
                            <SectionHeader icon="reply" label="Reply Needed" color="text-sky-500 dark:text-sky-400" />
                            <div className="space-y-2.5">
                              {groupByTopic(displayReplyNeededIncoming).map((group, i) => (
                                <GroupedEmailCard
                                  key={group[0].email_id ?? i}
                                  group={group}
                                  accent="reply"
                                  onClickEmail={(e) => e.email_id && openEmailById(e.email_id)}
                                  onDismiss={(e) => e.email_id && dismissCard(e.email_id)}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                        {displayNoReplyYet.length > 0 && (
                          <div>
                            <SectionHeader icon="mark_email_unread" label="No Reply Yet" color="text-amber-500 dark:text-amber-400" />
                            <div className="space-y-2.5">
                              {displayNoReplyYet.map((email, i) => (
                                <EmailCard
                                  key={email.email_id ?? i}
                                  email={email}
                                  accent="reply"
                                  onClick={email.email_id ? () => openEmailById(email.email_id!) : undefined}
                                  onDismiss={email.email_id ? () => dismissCard(email.email_id!) : undefined}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                        {displayReplyNeededIncoming.length === 0 && displayNoReplyYet.length === 0 && (
                          <p className="text-sm text-center py-8 text-[var(--muted)]">No emails in this category.</p>
                        )}
                      </div>
                    ) : (
                      <>
                        <SectionHeader
                          icon={FILTER_CONFIG[activeFilter].icon}
                          label={FILTER_CONFIG[activeFilter].label}
                          color={FILTER_CONFIG[activeFilter].color}
                        />
                        {filteredEmails.length === 0 ? (
                          <div className="text-center py-8 text-[var(--muted)]">
                            {activeFilter === "nonEssential" && (displayStats?.nonEssential ?? 0) > 0 ? (
                              <>
                                <span className="material-symbols-outlined mb-2" style={{ fontSize: "32px" }}>filter_alt</span>
                                <p className="text-sm font-medium">{displayStats!.nonEssential} emails filtered</p>
                                <p className="text-xs mt-1 opacity-70">Regenerate your briefing to see individual non-essential emails.</p>
                                <button
                                  onClick={() => void requestBriefingRegeneration()}
                                  disabled={briefingRegenerating}
                                  className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--border)] text-xs hover:border-[var(--accent)] transition-colors disabled:opacity-50"
                                >
                                  <span className={`material-symbols-outlined ${briefingRegenerating ? "animate-spin" : ""}`} style={{ fontSize: "13px" }}>{briefingRegenerating ? "progress_activity" : "refresh"}</span>
                                  {briefingRegenerating ? "Generating..." : "Regenerate"}
                                </button>
                              </>
                            ) : (
                              <p className="text-sm">No emails in this category.</p>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            {filteredEmails.map((email, i) => (
                              <EmailCard
                                key={email.email_id ?? i}
                                email={email}
                                hideUrgency={activeFilter === "nonEssential"}
                                accent={
                                  activeFilter === "deadlines"
                                    ? "deadline"
                                    : activeFilter === "nonEssential"
                                      ? "noise"
                                      : "crucial"
                                }
                                onClick={email.email_id ? () => openEmailById(email.email_id!) : undefined}
                                onDismiss={email.email_id ? () => dismissCard(email.email_id!) : undefined}
                              />
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  // No filter: show all groups (reply-first, then crucial)
                  <div className="space-y-6">
                    {/* Reply Needed: incoming emails that need a response */}
                    {displayReplyNeededIncoming.length > 0 && (
                      <div>
                        <SectionHeader icon="reply" label="Reply Needed" color="text-sky-500 dark:text-sky-400" />
                        <div className="space-y-2.5">
                          {groupByTopic(displayReplyNeededIncoming).map((group, i) => (
                            <GroupedEmailCard
                              key={group[0].email_id ?? i}
                              group={group}
                              accent="reply"
                              onClickEmail={(e) => e.email_id && openEmailById(e.email_id)}
                              onDismiss={(e) => e.email_id && dismissCard(e.email_id)}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* No Reply Yet: sent emails awaiting response */}
                    {displayNoReplyYet.length > 0 && (
                      <div>
                        <SectionHeader icon="mark_email_unread" label="No Reply Yet" color="text-amber-500 dark:text-amber-400" />
                        <div className="space-y-2.5">
                          {displayNoReplyYet.map((email, i) => (
                            <EmailCard
                              key={email.email_id ?? i}
                              email={email}
                              accent="reply"
                              onClick={email.email_id ? () => openEmailById(email.email_id!) : undefined}
                              onDismiss={email.email_id ? () => dismissCard(email.email_id!) : undefined}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Crucial: critical/high shown first, medium collapsed under "Also important" */}
                    {displayCrucial.length > 0 && (
                      <div>
                        <SectionHeader icon="priority_high" label="Crucial" color="text-rose-500 dark:text-rose-400" />
                        {crucialsHigh.length > 0 && (
                          <div className="space-y-2.5">
                            {groupByTopic(crucialsHigh).map((group, i) => (
                              <GroupedEmailCard
                                key={group[0].email_id ?? i}
                                group={group}
                                accent="crucial"
                                onClickEmail={(e) => e.email_id && openEmailById(e.email_id)}
                                onDismiss={(e) => e.email_id && dismissCard(e.email_id)}
                              />
                            ))}
                          </div>
                        )}
                        {crucialsImportant.length > 0 && (
                          <div className={crucialsHigh.length > 0 ? "mt-3" : ""}>
                            <button
                              type="button"
                              onClick={() => setImportantExpanded((v) => !v)}
                              className="flex items-center gap-1.5 mb-2 text-[11px] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors group cursor-pointer"
                            >
                              <span className="material-symbols-outlined text-slate-400 group-hover:text-[var(--foreground)] transition-colors" style={{ fontSize: "13px" }}>
                                {importantExpanded ? "expand_less" : "expand_more"}
                              </span>
                              Also important ({crucialsImportant.length})
                            </button>
                            {importantExpanded && (
                              <div className="space-y-2.5">
                                {groupByTopic(crucialsImportant).map((group, i) => (
                                  <GroupedEmailCard
                                    key={group[0].email_id ?? i}
                                    group={group}
                                    accent="crucial"
                                    onClickEmail={(e) => e.email_id && openEmailById(e.email_id)}
                                    onDismiss={(e) => e.email_id && dismissCard(e.email_id)}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {displayDeadlines.length > 0 && (
                      <div>
                        <SectionHeader icon="event_upcoming" label="Deadlines" color="text-violet-500 dark:text-violet-400" />
                        <div className="space-y-2.5">
                          {groupByTopic(displayDeadlines).map((group, i) => (
                            <GroupedEmailCard
                              key={group[0].email_id ?? i}
                              group={group}
                              accent="deadline"
                              onClickEmail={(e) => e.email_id && openEmailById(e.email_id)}
                              onDismiss={(e) => e.email_id && dismissCard(e.email_id)}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {(displayStats?.nonEssential ?? 0) > 0 && displayNonEssential.length === 0 && activeFilter !== "nonEssential" && (
                      <button
                        onClick={() => setActiveFilter("nonEssential")}
                        className="w-full text-[11px] text-[var(--muted)] text-center py-2 hover:text-[var(--foreground)] transition-colors"
                      >
                        <span className="material-symbols-outlined align-middle mr-1" style={{ fontSize: "12px" }}>filter_alt</span>
                        {displayStats!.nonEssential} non-essential emails filtered out -- click to view
                      </button>
                    )}

                    {displayNonEssential.length > 0 && (
                      <div>
                        <button
                          onClick={() => setNonEssentialExpanded((v) => !v)}
                          className="flex items-center gap-2 mb-3 mt-1 w-full group"
                        >
                          <span className="material-symbols-outlined text-slate-400" style={{ fontSize: "16px" }}>filter_alt</span>
                          <h2 className="text-xs font-bold tracking-widest text-[var(--muted)] uppercase flex-1 text-left">Non-essential</h2>
                          <span className="material-symbols-outlined text-slate-400 group-hover:text-[var(--foreground)] transition-colors" style={{ fontSize: "16px" }}>
                            {nonEssentialExpanded ? "expand_less" : "expand_more"}
                          </span>
                        </button>
                        {nonEssentialExpanded && (
                          <div className="space-y-1">
                            {displayNonEssential.map((email, i) => (
                              <EmailCard
                                key={email.email_id ?? i}
                                email={email}
                                hideUrgency
                                onClick={email.email_id ? () => openEmailById(email.email_id!) : undefined}
                                onDismiss={email.email_id ? () => dismissCard(email.email_id!) : undefined}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* AI mode */}
                <p className="text-[11px] text-[var(--muted)] flex items-center gap-1 pb-2">
                  <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>
                    {profile?.ai_mode === "local" ? "computer" : "cloud"}
                  </span>
                  Generated by {profile?.ai_mode === "local" ? "local AI (Qwen 2.5 3B)" : "cloud AI"}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
