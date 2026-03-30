"use client";

import { MOCK_BRIEFING } from "./mockData";

const URGENCY_CONFIG = {
  critical: {
    label: "CRITICAL",
    bg: "bg-red-500/10 border-red-500/30",
    text: "text-red-400",
    dot: "bg-red-500",
  },
  high: {
    label: "HIGH",
    bg: "bg-orange-500/10 border-orange-500/30",
    text: "text-orange-400",
    dot: "bg-orange-400",
  },
  medium: {
    label: "MEDIUM",
    bg: "bg-yellow-500/10 border-yellow-500/30",
    text: "text-yellow-400",
    dot: "bg-yellow-400",
  },
};

function formatDeadlineDate(iso: string) {
  try {
    const parts = iso.split("T")[0].split("-").map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

function daysUntil(iso: string) {
  const parts = iso.split("T")[0].split("-").map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

export default function TutorialBriefingView() {
  const b = MOCK_BRIEFING;

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 max-w-3xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-xl bg-[var(--accent)] flex items-center justify-center">
          <span
            className="material-symbols-outlined text-white dark:text-[#202124]"
            style={{ fontSize: "18px", fontVariationSettings: "'FILL' 1" }}
          >
            summarize
          </span>
        </div>
        <div>
          <h1 className="text-[18px] font-bold text-[var(--foreground)]">Daily Briefing</h1>
          <p className="text-[12px] text-[var(--muted)]">
            {new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
          </p>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: "Total Emails", value: b.stats.total, icon: "mail" },
          { label: "Critical", value: b.stats.critical, icon: "priority_high", color: "text-red-400" },
          { label: "Deadlines", value: b.stats.deadlines, icon: "schedule", color: "text-amber-400" },
          { label: "Waiting on You", value: b.stats.waitingOnYou, icon: "pending", color: "text-blue-400" },
        ].map(({ label, value, icon, color }) => (
          <div
            key={label}
            className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-3 flex flex-col items-center gap-1"
          >
            <span
              className={`material-symbols-outlined ${color ?? "text-[var(--muted)]"}`}
              style={{ fontSize: "20px", fontVariationSettings: "'FILL' 1" }}
            >
              {icon}
            </span>
            <span className={`text-[22px] font-bold leading-none ${color ?? "text-[var(--foreground)]"}`}>
              {value}
            </span>
            <span className="text-[10px] text-[var(--muted)] text-center">{label}</span>
          </div>
        ))}
      </div>

      {/* Executive Summary */}
      <div
        data-tour="briefing-summary"
        className="rounded-2xl border border-[var(--border)] p-5 mb-6 bg-gradient-to-br"
        style={{
          background: "linear-gradient(135deg, var(--background) 0%, rgba(99,102,241,0.04) 100%)",
          borderColor: "var(--border)",
        }}
      >
        <div className="flex items-center gap-2 mb-3">
          <span
            className="material-symbols-outlined text-[var(--accent)]"
            style={{ fontSize: "16px", fontVariationSettings: "'FILL' 1" }}
          >
            auto_awesome
          </span>
          <span className="text-[11px] font-bold uppercase tracking-widest text-[var(--accent)]">
            Executive Summary
          </span>
        </div>
        <p className="text-[14px] text-[var(--foreground)] leading-relaxed">{b.executiveSummary}</p>
      </div>

      {/* Top Priority */}
      <section className="mb-6">
        <h2 className="text-[13px] font-bold uppercase tracking-widest text-[var(--muted)] mb-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-red-400" style={{ fontSize: "14px", fontVariationSettings: "'FILL' 1" }}>priority_high</span>
          Top Priority
        </h2>
        <div className="flex flex-col gap-3">
          {b.topPriority.map((email) => {
            const u = URGENCY_CONFIG[email.urgency] ?? URGENCY_CONFIG.medium;
            return (
              <div key={email.email_id} className={`rounded-xl border p-4 ${u.bg}`}>
                <div className="flex items-center gap-2 flex-wrap mb-2">
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
                  {email.tags.filter(t => !["DEADLINE", "REPLY NEEDED"].includes(t)).map(tag => (
                    <span key={tag} className="text-[10px] font-semibold tracking-wide px-2 py-0.5 rounded-full bg-slate-500/10 border border-slate-500/30 text-[var(--muted)]">
                      {tag}
                    </span>
                  ))}
                </div>
                <p className="text-[13px] font-semibold text-slate-900 dark:text-white mb-0.5">{email.subject}</p>
                <p className="text-[11px] text-[var(--muted)] mb-2">{email.senderName}</p>
                <p className="text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed">{email.summary}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Deadlines */}
      <section data-tour="briefing-deadlines" className="mb-6">
        <h2 className="text-[13px] font-bold uppercase tracking-widest text-[var(--muted)] mb-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-amber-400" style={{ fontSize: "14px", fontVariationSettings: "'FILL' 1" }}>schedule</span>
          Upcoming Deadlines
        </h2>
        <div className="flex flex-col gap-2">
          {b.deadlines.map((dl, i) => {
            const days = daysUntil(dl.date);
            const urgent = days <= 2;
            return (
              <div
                key={i}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
                  urgent
                    ? "border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20"
                    : "border-[var(--border)] bg-[var(--background)]"
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-lg flex flex-col items-center justify-center shrink-0 text-center ${
                    urgent ? "bg-red-100 dark:bg-red-900/30" : "bg-[var(--surface-2)]"
                  }`}
                >
                  <span className={`text-[14px] font-bold leading-none ${urgent ? "text-red-500" : "text-[var(--foreground)]"}`}>
                    {new Date(dl.date).getDate()}
                  </span>
                  <span className={`text-[9px] font-semibold uppercase ${urgent ? "text-red-400" : "text-[var(--muted)]"}`}>
                    {new Date(dl.date).toLocaleString("default", { month: "short" })}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-[13px] font-semibold truncate ${urgent ? "text-red-600 dark:text-red-400" : "text-[var(--foreground)]"}`}>
                    {dl.task}
                  </p>
                  <p className="text-[11px] text-[var(--muted)] truncate">{dl.source}</p>
                </div>
                <span
                  className={`text-[11px] font-bold shrink-0 ${
                    days === 0 ? "text-red-500" : days === 1 ? "text-orange-400" : days <= 3 ? "text-amber-400" : "text-[var(--muted)]"
                  }`}
                >
                  {days === 0 ? "Today" : days === 1 ? "Tomorrow" : `${days}d`}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Waiting for reply */}
      <section>
        <h2 className="text-[13px] font-bold uppercase tracking-widest text-[var(--muted)] mb-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-blue-400" style={{ fontSize: "14px", fontVariationSettings: "'FILL' 1" }}>pending</span>
          Waiting for Your Reply
        </h2>
        <div className="flex flex-col gap-3">
          {b.waitingForReply.map((email) => {
            const u = URGENCY_CONFIG[email.urgency] ?? URGENCY_CONFIG.medium;
            return (
              <div key={email.email_id} className="rounded-xl border border-blue-200 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-950/20 p-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`text-[10px] font-bold tracking-widest px-2 py-0.5 rounded-full border ${u.bg} ${u.text} border-current`}>
                    {u.label}
                  </span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400">
                    REPLY NEEDED
                  </span>
                </div>
                <p className="text-[13px] font-semibold text-slate-900 dark:text-white mb-0.5">{email.subject}</p>
                <p className="text-[11px] text-[var(--muted)] mb-1.5">{email.senderName}</p>
                <p className="text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed">{email.summary}</p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
