"use client";

import { useState } from "react";
import { MOCK_BRIEFING } from "./mockData";
import TutorialSolveWorkspace from "./TutorialSolveWorkspace";

function formatDeadlineDate(iso: string) {
  try {
    const parts = iso.split("T")[0].split("-").map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    return d.toLocaleDateString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
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
  const [solveOpen, setSolveOpen] = useState(false);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 max-w-3xl mx-auto w-full">
      {/* Header row: title + Auto-Resolve */}
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[var(--accent)] flex items-center justify-center">
            <span
              className="material-symbols-outlined text-white dark:text-[#202124]"
              style={{ fontSize: "18px", fontVariationSettings: "'FILL' 1" }}
            >
              summarize
            </span>
          </div>
          <div>
            <h1 className="text-[18px] font-bold text-[var(--foreground)] font-['Syne',system-ui,sans-serif] tracking-tight">
              Daily Briefing
            </h1>
            <p className="text-[12px] text-[var(--muted)]">
              {new Date().toLocaleDateString([], {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>
        </div>
        <button
          data-tour="briefing-solve"
          onClick={() => setSolveOpen(true)}
          className="group relative inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-[12.5px] font-semibold text-white shadow-[0_2px_8px_-2px_rgba(5,150,105,0.45)] transition-colors hover:bg-emerald-700 cursor-pointer"
          title="Let the agent resolve your whole briefing"
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: "16px" }}
          >
            auto_awesome
          </span>
          <span className="tracking-tight">Auto-Resolve</span>
        </button>
      </div>

      {/* Compact meta strip */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] text-[var(--muted)]">
          <span
            className="material-symbols-outlined"
            style={{ fontSize: "13px" }}
          >
            mail
          </span>
          {b.stats.total} emails
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-red-300/50 bg-red-500/10 px-2.5 py-1 text-[11px] text-red-600 dark:text-red-300">
          <span
            className="material-symbols-outlined"
            style={{ fontSize: "13px" }}
          >
            priority_high
          </span>
          {b.stats.critical} critical
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/50 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-600 dark:text-amber-300">
          <span
            className="material-symbols-outlined"
            style={{ fontSize: "13px" }}
          >
            schedule
          </span>
          {b.stats.deadlines} deadlines
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-300/50 bg-blue-500/10 px-2.5 py-1 text-[11px] text-blue-600 dark:text-blue-300">
          <span
            className="material-symbols-outlined"
            style={{ fontSize: "13px" }}
          >
            pending
          </span>
          {b.stats.waitingOnYou} waiting on you
        </span>
      </div>

      <TutorialSolveWorkspace
        open={solveOpen}
        onClose={() => setSolveOpen(false)}
      />

      {/* Executive Summary */}
      <div
        data-tour="briefing-summary"
        className="rounded-2xl border border-[var(--border)] p-5 mb-6 bg-gradient-to-br"
        style={{
          background:
            "linear-gradient(135deg, var(--background) 0%, rgba(99,102,241,0.04) 100%)",
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
        <p className="text-[14px] text-[var(--foreground)] leading-relaxed">
          {b.executiveSummary}
        </p>
      </div>

      {/* Top Priority */}
      <section className="mb-6">
        <h2 className="text-[13px] font-bold uppercase tracking-widest text-[var(--muted)] mb-3 flex items-center gap-2">
          <span
            className="material-symbols-outlined text-red-400"
            style={{ fontSize: "14px", fontVariationSettings: "'FILL' 1" }}
          >
            priority_high
          </span>
          Top Priority
        </h2>
        <div className="flex flex-col gap-1.5">
          {b.topPriority.map((email) => {
            const urgencyLabel =
              email.urgency === "critical" ? "Critical" : email.urgency === "high" ? "High" : "Med";
            return (
              <div
                key={email.email_id}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] border-l-2 border-l-rose-500/75 px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  <span>{urgencyLabel}</span>
                  {email.waitingForReply && (
                    <span className="text-sky-600 dark:text-sky-400/90">Reply</span>
                  )}
                  {email.deadline && (
                    <span className="text-violet-600 dark:text-violet-400/90">
                      Due {formatDeadlineDate(email.deadline)}
                    </span>
                  )}
                  {email.tags
                    .filter((t) => !["DEADLINE", "REPLY NEEDED"].includes(t))
                    .map((tag) => (
                      <span key={tag} className="text-[var(--muted)] normal-case font-medium">
                        {tag}
                      </span>
                    ))}
                </div>
                <p className="text-[13px] font-semibold text-[var(--foreground)] mt-1 leading-snug line-clamp-2 font-['DM_Sans',ui-sans-serif,sans-serif]">
                  {email.subject}
                </p>
                <p className="text-[11px] text-[var(--muted)] mt-0.5 line-clamp-1">
                  {email.senderName}
                </p>
                <p className="text-[12px] text-[var(--foreground)]/85 mt-1 leading-snug line-clamp-2 font-['DM_Sans',ui-sans-serif,sans-serif]">
                  {email.summary}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Deadlines */}
      <section data-tour="briefing-deadlines" className="mb-6">
        <h2 className="text-[13px] font-bold uppercase tracking-widest text-[var(--muted)] mb-3 flex items-center gap-2">
          <span
            className="material-symbols-outlined text-amber-400"
            style={{ fontSize: "14px", fontVariationSettings: "'FILL' 1" }}
          >
            schedule
          </span>
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
                    urgent
                      ? "bg-red-100 dark:bg-red-900/30"
                      : "bg-[var(--surface-2)]"
                  }`}
                >
                  <span
                    className={`text-[14px] font-bold leading-none ${urgent ? "text-red-500" : "text-[var(--foreground)]"}`}
                  >
                    {new Date(dl.date).getDate()}
                  </span>
                  <span
                    className={`text-[9px] font-semibold uppercase ${urgent ? "text-red-400" : "text-[var(--muted)]"}`}
                  >
                    {new Date(dl.date).toLocaleString("default", {
                      month: "short",
                    })}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-[13px] font-semibold truncate ${urgent ? "text-red-600 dark:text-red-400" : "text-[var(--foreground)]"}`}
                  >
                    {dl.task}
                  </p>
                  <p className="text-[11px] text-[var(--muted)] truncate">
                    {dl.source}
                  </p>
                </div>
                <span
                  className={`text-[11px] font-bold shrink-0 ${
                    days === 0
                      ? "text-red-500"
                      : days === 1
                        ? "text-orange-400"
                        : days <= 3
                          ? "text-amber-400"
                          : "text-[var(--muted)]"
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
          <span
            className="material-symbols-outlined text-blue-400"
            style={{ fontSize: "14px", fontVariationSettings: "'FILL' 1" }}
          >
            pending
          </span>
          Waiting for Your Reply
        </h2>
        <div className="flex flex-col gap-1.5">
          {b.waitingForReply.map((email) => {
            const urgencyLabel =
              email.urgency === "critical" ? "Critical" : email.urgency === "high" ? "High" : "Med";
            return (
              <div
                key={email.email_id}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] border-l-2 border-l-sky-500/75 px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wide">
                  <span className="text-[var(--muted)]">{urgencyLabel}</span>
                  <span className="text-sky-600 dark:text-sky-400/90">Reply</span>
                </div>
                <p className="text-[13px] font-semibold text-[var(--foreground)] mt-1 leading-snug line-clamp-2 font-['DM_Sans',ui-sans-serif,sans-serif]">
                  {email.subject}
                </p>
                <p className="text-[11px] text-[var(--muted)] mt-0.5 line-clamp-1">
                  {email.senderName}
                </p>
                <p className="text-[12px] text-[var(--foreground)]/85 mt-1 leading-snug line-clamp-2 font-['DM_Sans',ui-sans-serif,sans-serif]">
                  {email.summary}
                </p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
