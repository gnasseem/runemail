"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useApp } from "../AppShell";
import { type BriefingResult, type BriefingEmail, type DeadlineItem } from "@/lib/emailGraph";
import EmailDetail from "../EmailDetail";

const URGENCY_CONFIG = {
  critical: { label: "CRITICAL", bg: "bg-red-500/10 border-red-500/30", text: "text-red-400", dot: "bg-red-500" },
  high:     { label: "HIGH",     bg: "bg-orange-500/10 border-orange-500/30", text: "text-orange-400", dot: "bg-orange-400" },
  medium:   { label: "MEDIUM",   bg: "bg-yellow-500/10 border-yellow-500/30", text: "text-yellow-400", dot: "bg-yellow-400" },
};

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
    let d = new Date(parts[0], parts[1] - 1, parts[2]);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diff = Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    // If the date appears to be exactly ~1 year in the past, the AI likely used
    // the wrong year. Try bumping by 1 year to get the intended date.
    if (diff <= -300) {
      const corrected = new Date(parts[0] + 1, parts[1] - 1, parts[2]);
      return Math.round((corrected.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    }
    return diff;
  } catch { return 999; }
}

function PriorityEmailCard({ email, onClick, onDismiss }: { email: BriefingEmail; onClick?: () => void; onDismiss?: () => void }) {
  const u = URGENCY_CONFIG[email.urgency] ?? URGENCY_CONFIG.medium;
  return (
    <div
      className={`rounded-xl border p-4 ${u.bg} transition-all ${onClick ? "cursor-pointer hover:brightness-95 dark:hover:brightness-110" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-bold tracking-widest px-2 py-0.5 rounded-full border ${u.bg} ${u.text} border-current`}>
            {u.label}
          </span>
          {email.waitingForReply && (
            <span className="text-[10px] font-semibold tracking-wide px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400">
              REPLY NEEDED
            </span>
          )}
          {email.deadline && (
            <span className="text-[10px] font-semibold tracking-wide px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-400">
              DEADLINE {formatDeadlineDate(email.deadline)}
            </span>
          )}
          {email.tags?.filter(t => !["REPLY_NEEDED", "DEADLINE"].includes(t)).map(tag => (
            <span key={tag} className="text-[10px] font-semibold tracking-wide px-2 py-0.5 rounded-full bg-slate-500/10 border border-slate-500/30 text-[var(--muted)]">
              {tag}
            </span>
          ))}
        </div>
        {onDismiss && (
          <button
            onClick={(e) => { e.stopPropagation(); onDismiss(); }}
            className="shrink-0 p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-[var(--muted)] hover:text-red-400 transition-colors"
            title="Dismiss"
            aria-label="Dismiss card"
          >
            <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>close</span>
          </button>
        )}
      </div>
      <p className="text-sm font-semibold text-slate-900 dark:text-white mb-0.5 leading-tight">
        {email.subject}
      </p>
      <p className="text-xs text-[var(--muted)] mb-2">
        {(email.senderName && email.senderName !== "null") ? email.senderName : ((email.sender && email.sender !== "null") ? email.sender : "")}
        {email.senderName && email.senderName !== "null" && email.sender && email.sender !== "null" && email.senderName !== email.sender && (
          <span className="opacity-60"> · {email.sender}</span>
        )}
      </p>
      <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        {email.summary}
      </p>
    </div>
  );
}

function DeadlineTimeline({ deadlines }: { deadlines: DeadlineItem[] }) {
  if (!deadlines.length) return null;
  const sorted = [...deadlines].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return (
    <div className="space-y-2">
      {sorted.map((d, i) => {
        const days = daysUntil(d.date);
        const isOverdue = days < 0;
        const isUrgent = days >= 0 && days <= 2;
        const colorClass = isOverdue ? "text-red-400" : isUrgent ? "text-orange-400" : "text-[var(--muted)]";
        return (
          <div key={i} className="flex items-center gap-3 py-1.5">
            <div className="w-16 shrink-0 text-right">
              <span className={`text-xs font-semibold ${colorClass}`}>
                {formatDeadlineDate(d.date)}
              </span>
            </div>
            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOverdue ? "bg-red-400" : isUrgent ? "bg-orange-400" : "bg-[var(--border)]"}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-700 dark:text-slate-300 truncate">{d.task}</p>
              <p className="text-[11px] text-[var(--muted)]">{d.source}</p>
            </div>
            <span className={`text-[11px] font-medium shrink-0 ${isOverdue ? "text-red-400" : isUrgent ? "text-orange-400" : "text-[var(--muted)]"}`}>
              {isOverdue ? `${Math.abs(days)}d overdue` : days === 0 ? "today" : `in ${days}d`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function BriefingView() {
  const { user, profile, getViewCache, setViewCache, invalidateViewCache, briefingVersion } = useApp();
  const supabase = createClient();
  const [briefing, setBriefing] = useState<BriefingResult | null>(null);
  const [briefingAt, setBriefingAt] = useState<string | null>(null);
  const [meetings, setMeetings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<any | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(`runemail_dismissed_briefing_${user.id}`);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch { return new Set(); }
  });
  // Tracks dismissed deadline keys as "source|date" to hide related deadline rows
  const [dismissedDeadlineKeys, setDismissedDeadlineKeys] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(`runemail_dismissed_deadlines_${user.id}`);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch { return new Set(); }
  });
  // briefing is read-only from cache; generation happens in the sync pipeline

  const loadCachedBriefing = useCallback(async () => {
    // 0. Try in-memory cache first (instant)
    const memCached = getViewCache("briefing");
    if (memCached) {
      setBriefing(memCached.data);
      setBriefingAt(memCached.at);
      setLoading(false);
      return;
    }

    // 1. Try localStorage first (fastest)
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
          return;
        }
      }
    } catch { /* ignore */ }

    // 2. Fall back to DB (survives localStorage clear)
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
        // Re-populate localStorage
        localStorage.setItem(
          `runemail_briefing_cache_${user.id}`,
          JSON.stringify({ data: row.last_briefing, ts: row.last_briefing_at ? new Date(row.last_briefing_at).getTime() : Date.now() }),
        );
      }
    } catch { /* ignore */ }

    setLoading(false);
  }, [user.id, supabase]);

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

  const generateBriefingOnDemand = useCallback(async () => {
    setGenerating(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/api";
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const res = await fetch(`${apiUrl}/briefing`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.briefing || data.executiveSummary) {
          const briefingData = data.briefing ?? data;
          const ts = Date.now();
          setBriefing(briefingData);
          setBriefingAt(new Date(ts).toISOString());
          setViewCache("briefing", { data: briefingData, at: new Date(ts).toISOString() });
          localStorage.setItem(
            `runemail_briefing_cache_${user.id}`,
            JSON.stringify({ data: briefingData, ts }),
          );
        }
      }
    } catch (err) {
      console.error("[BriefingView] on-demand generation:", err);
    } finally {
      setGenerating(false);
    }
  }, [user.id, supabase, setViewCache]);

  useEffect(() => {
    let mounted = true;
    loadCachedBriefing();
    loadMeetings();
    return () => { mounted = false; };
  }, [loadCachedBriefing, loadMeetings]);

  // Auto-refresh when background sync writes a new briefing
  const prevBriefingVersion = useRef(briefingVersion);
  useEffect(() => {
    if (briefingVersion !== prevBriefingVersion.current) {
      prevBriefingVersion.current = briefingVersion;
      invalidateViewCache("briefing");
      loadCachedBriefing();
    }
  }, [briefingVersion, invalidateViewCache, loadCachedBriefing]);

  const dismissCard = useCallback((id: string, email?: BriefingEmail) => {
    setDismissedIds((prev) => {
      const next = new Set(prev).add(id);
      localStorage.setItem(`runemail_dismissed_briefing_${user.id}`, JSON.stringify([...next]));
      return next;
    });
    if (email?.deadline && email?.senderName) {
      const key = `${email.senderName}|${email.deadline}`;
      setDismissedDeadlineKeys((prev) => {
        const next = new Set(prev).add(key);
        localStorage.setItem(`runemail_dismissed_deadlines_${user.id}`, JSON.stringify([...next]));
        return next;
      });
    }
  }, [user.id]);

  const openEmailById = useCallback(async (emailId: string) => {
    const { data } = await supabase
      .from("emails")
      .select("*, email_processed(*)")
      .eq("id", emailId)
      .single();
    if (data) setSelectedEmail(data);
  }, [supabase]);

  const formatTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const visibleTopPriority = (briefing?.topPriority ?? []).filter((e) => !e.email_id || !dismissedIds.has(e.email_id));
  const topPriorityEmailIds = new Set(visibleTopPriority.map((e) => e.email_id).filter(Boolean));
  const visibleWaiting = (briefing?.waitingForReply ?? []).filter((e) =>
    (!e.email_id || !dismissedIds.has(e.email_id)) &&
    (!e.email_id || !topPriorityEmailIds.has(e.email_id))
  );
  const visibleDeadlines = (briefing?.deadlines ?? []).filter((d) => {
    const key = `${d.source}|${d.date}`;
    return !dismissedDeadlineKeys.has(key);
  });
  const displayStats = briefing?.stats ? {
    ...briefing.stats,
    critical: visibleTopPriority.filter((e) => e.urgency === "critical").length,
    waitingOnYou: visibleWaiting.length,
    deadlines: visibleDeadlines.length,
  } : undefined;
  const stats = displayStats;
  const hasContent = briefing && (
    briefing.executiveSummary ||
    (briefing.topPriority?.length ?? 0) > 0 ||
    (briefing.deadlines?.length ?? 0) > 0
  );

  return (
    <div className="h-full flex overflow-hidden">
      {/* Left panel: Today's timeline */}
      <div className="w-72 lg:w-80 border-r border-[var(--border)] flex flex-col flex-shrink-0 overflow-auto">
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <span className="material-symbols-outlined text-[var(--accent)]" style={{ fontSize: "18px" }}>today</span>
            Today's Schedule
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
              <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-[var(--accent)]" style={{ fontSize: "22px" }}>summarize</span>
                Morning Briefing
              </h1>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                {briefingAt
                  ? `Generated ${new Date(briefingAt).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" })} at ${new Date(briefingAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                  : new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
              </p>
            </div>
          </div>

          {loading ? (
            <div className="space-y-4">
              <div className="h-16 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
              <div className="flex gap-3">
                {[1,2,3,4].map(i => <div key={i} className="h-10 flex-1 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />)}
              </div>
              {[1,2,3].map(i => <div key={i} className="h-24 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />)}
            </div>
          ) : !hasContent ? (
            <div className="text-center py-16 text-[var(--muted)]">
              <span className="material-symbols-outlined mb-3" style={{ fontSize: "48px" }}>mark_email_read</span>
              <p className="text-sm font-medium">No briefing available</p>
              <p className="text-xs mt-1 opacity-70 mb-4">Generate a briefing from your current inbox.</p>
              <button
                onClick={generateBriefingOnDemand}
                disabled={generating}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                <span className={`material-symbols-outlined ${generating ? "animate-spin" : ""}`} style={{ fontSize: "16px" }}>
                  {generating ? "progress_activity" : "auto_awesome"}
                </span>
                {generating ? "Generating..." : "Generate Briefing"}
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Executive summary */}
              {briefing.executiveSummary && (
                <div className="px-4 py-3.5 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/5">
                  <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">{briefing.executiveSummary}</p>
                </div>
              )}

              {/* Stat bar */}
              {stats && (
                <div className="grid grid-cols-4 gap-2">
                  <div className="flex flex-col items-center py-3 px-2 rounded-xl border border-red-500/20 bg-red-500/5">
                    <span className="text-xl font-bold text-red-400">{stats.critical || 0}</span>
                    <span className="text-[11px] text-[var(--muted)] mt-0.5 text-center leading-tight">Critical</span>
                  </div>
                  <div className="flex flex-col items-center py-3 px-2 rounded-xl border border-purple-500/20 bg-purple-500/5">
                    <span className="text-xl font-bold text-purple-400">{stats.deadlines || 0}</span>
                    <span className="text-[11px] text-[var(--muted)] mt-0.5 text-center leading-tight">Deadlines</span>
                  </div>
                  <div className="flex flex-col items-center py-3 px-2 rounded-xl border border-blue-500/20 bg-blue-500/5">
                    <span className="text-xl font-bold text-blue-400">{stats.waitingOnYou || 0}</span>
                    <span className="text-[11px] text-[var(--muted)] mt-0.5 text-center leading-tight">Waiting on you</span>
                  </div>
                  <div className="flex flex-col items-center py-3 px-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)]">
                    <span className="text-xl font-bold text-slate-700 dark:text-slate-300">{stats.total || 0}</span>
                    <span className="text-[11px] text-[var(--muted)] mt-0.5 text-center leading-tight">Total emails</span>
                  </div>
                </div>
              )}

              {/* Priority queue */}
              {visibleTopPriority.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="material-symbols-outlined text-red-400" style={{ fontSize: "16px" }}>priority_high</span>
                    <h2 className="text-xs font-bold tracking-widest text-[var(--muted)] uppercase">Requires Your Attention</h2>
                  </div>
                  <div className="space-y-2.5">
                    {visibleTopPriority.map((email, i) => (
                      <PriorityEmailCard
                        key={email.email_id ?? i}
                        email={email}
                        onClick={email.email_id ? () => openEmailById(email.email_id!) : undefined}
                        onDismiss={email.email_id ? () => dismissCard(email.email_id!, email) : undefined}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* People waiting on you (if distinct from topPriority) */}
              {visibleWaiting.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="material-symbols-outlined text-blue-400" style={{ fontSize: "16px" }}>reply</span>
                    <h2 className="text-xs font-bold tracking-widest text-[var(--muted)] uppercase">Waiting for Your Reply</h2>
                  </div>
                  <div className="space-y-2.5">
                    {visibleWaiting.map((email, i) => (
                      <PriorityEmailCard
                        key={email.email_id ?? i}
                        email={email}
                        onClick={email.email_id ? () => openEmailById(email.email_id!) : undefined}
                        onDismiss={email.email_id ? () => dismissCard(email.email_id!, email) : undefined}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Deadlines */}
              {visibleDeadlines.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="material-symbols-outlined text-purple-400" style={{ fontSize: "16px" }}>event_upcoming</span>
                    <h2 className="text-xs font-bold tracking-widest text-[var(--muted)] uppercase">Upcoming Deadlines</h2>
                  </div>
                  <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border)]">
                    <div className="px-4 py-1">
                      <DeadlineTimeline deadlines={visibleDeadlines} />
                    </div>
                  </div>
                </div>
              )}

              {/* Filtered noise */}
              {(stats?.filtered ?? 0) > 0 && (
                <p className="text-[11px] text-[var(--muted)] text-center py-1">
                  <span className="material-symbols-outlined align-middle mr-1" style={{ fontSize: "12px" }}>filter_alt</span>
                  {stats!.filtered} newsletters and automated emails not shown
                </p>
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
