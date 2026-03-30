"use client";

import { useState } from "react";
import { MOCK_EMAILS, type MockEmail } from "./mockData";

const CATEGORY_COLORS: Record<string, string> = {
  important: "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-900/50",
  "action-required": "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 ring-1 ring-amber-200 dark:ring-amber-900/50",
  newsletter: "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400 ring-1 ring-violet-200 dark:ring-violet-900/50",
  informational: "bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400 ring-1 ring-sky-200 dark:ring-sky-900/50",
};

const CATEGORY_LABELS: Record<string, string> = {
  important: "Important",
  "action-required": "Action Required",
  newsletter: "Newsletter",
  informational: "Informational",
};

const TAG_COLORS: Record<string, string> = {
  "series-b": "#8b5cf6",
  clients: "#3b82f6",
  legal: "#ef4444",
  ops: "#10b981",
};

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffH = (now.getTime() - d.getTime()) / 3600000;
  if (diffH < 1) return `${Math.round(diffH * 60)}m ago`;
  if (diffH < 24) return `${Math.round(diffH)}h ago`;
  if (diffH < 48) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

const ACTION_ICONS: Record<string, string> = {
  reply: "reply",
  add_todo: "checklist",
  schedule_meeting: "event",
  archive: "archive",
};

type Props = {
  onAddTodo: (text: string, emailId: string) => void;
  onAnnotationTrigger?: (key: string) => void;
  highlightEmailId?: string | null;
};

export default function TutorialInboxView({ onAddTodo, onAnnotationTrigger, highlightEmailId }: Props) {
  const [selectedEmail, setSelectedEmail] = useState<MockEmail | null>(null);
  const [addedActions, setAddedActions] = useState<Set<string>>(new Set());

  const handleEmailClick = (email: MockEmail) => {
    setSelectedEmail(email);
    onAnnotationTrigger?.("email-open");
  };

  const handleAction = (email: MockEmail, action: { label: string; action: string }) => {
    const key = `${email.id}-${action.action}`;
    if (addedActions.has(key)) return;
    setAddedActions((prev) => new Set(prev).add(key));

    if (action.action === "add_todo") {
      onAddTodo(action.label.replace(/^(Add todo:\s*)/i, ""), email.id);
      onAnnotationTrigger?.("quick-action-todo");
    } else if (action.action === "schedule_meeting") {
      onAnnotationTrigger?.("quick-action-meeting");
    } else if (action.action === "reply") {
      onAnnotationTrigger?.("quick-action-reply");
    }
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Email list */}
      <div
        data-tour="email-list"
        className={`flex flex-col border-r border-[var(--border)] overflow-y-auto ${selectedEmail ? "w-80 shrink-0" : "flex-1"}`}
        style={{ transition: "width 0.2s ease" }}
      >
        {/* Header */}
        <div className="sticky top-0 bg-[var(--background)] border-b border-[var(--border)] px-4 py-3 flex items-center justify-between z-10">
          <h2 className="text-[15px] font-bold text-[var(--foreground)]">Inbox</h2>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--accent)] text-white dark:text-[#202124]">
              {MOCK_EMAILS.filter((e) => !e.is_read).length}
            </span>
            <span className="text-[11px] text-[var(--muted)]">unread</span>
          </div>
        </div>

        {MOCK_EMAILS.map((email) => {
          const isSelected = selectedEmail?.id === email.id;
          const isHighlighted = highlightEmailId === email.id;
          const cat = email.email_processed?.category ?? "informational";
          const tags = email.email_processed?.extra_labels ?? [];

          return (
            <button
              key={email.id}
              onClick={() => handleEmailClick(email)}
              className={`w-full text-left px-4 py-3 border-b border-[var(--border)] transition-all duration-150 cursor-pointer ${
                isSelected
                  ? "bg-[var(--accent-light)]"
                  : "hover:bg-[var(--surface-2)]"
              } ${isHighlighted ? "ring-2 ring-[var(--accent)] ring-inset" : ""}`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <span
                  className={`text-[13px] leading-tight truncate ${
                    !email.is_read ? "font-bold text-[var(--foreground)]" : "font-medium text-[var(--muted)]"
                  }`}
                >
                  {email.sender}
                </span>
                <span className="text-[11px] text-[var(--muted)] shrink-0">
                  {formatTime(email.received_at)}
                </span>
              </div>

              <div className="flex items-center gap-1.5 mb-1">
                {!email.is_read && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shrink-0" />
                )}
                <span
                  className={`text-[12px] truncate leading-tight ${
                    !email.is_read ? "font-semibold text-[var(--foreground)]" : "text-[var(--muted)]"
                  }`}
                >
                  {email.subject}
                </span>
              </div>

              {/* Category + tags */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span
                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${CATEGORY_COLORS[cat]}`}
                >
                  {CATEGORY_LABELS[cat]}
                </span>
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md"
                    style={{
                      backgroundColor: `${TAG_COLORS[tag] ?? "#6b7280"}20`,
                      color: TAG_COLORS[tag] ?? "#6b7280",
                    }}
                  >
                    {tag.replace("-", " ")}
                  </span>
                ))}
              </div>

              {/* Snippet */}
              {!selectedEmail && (
                <p className="text-[11px] text-[var(--muted)] mt-1 line-clamp-1">
                  {email.snippet}
                </p>
              )}
            </button>
          );
        })}
      </div>

      {/* Email detail */}
      {selectedEmail && (
        <div className="flex-1 overflow-y-auto flex flex-col">
          {/* Detail header */}
          <div className="sticky top-0 bg-[var(--background)] border-b border-[var(--border)] px-6 py-4 z-10">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="flex-1 min-w-0">
                <h1 className="text-[17px] font-bold text-[var(--foreground)] leading-tight mb-1.5">
                  {selectedEmail.subject}
                </h1>
                <div className="flex items-center gap-2 text-[12px] text-[var(--muted)]">
                  <span className="font-semibold text-[var(--foreground)]">{selectedEmail.sender}</span>
                  <span>·</span>
                  <span>{selectedEmail.sender_email}</span>
                  <span>·</span>
                  <span>{formatTime(selectedEmail.received_at)}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedEmail(null)}
                className="shrink-0 p-1.5 rounded-lg hover:bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors cursor-pointer"
                aria-label="Close email"
              >
                <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>close</span>
              </button>
            </div>

            {/* AI Summary */}
            {selectedEmail.email_processed?.summary && (
              <div className="rounded-xl px-4 py-3 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/50 mb-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <span
                    className="material-symbols-outlined text-indigo-500"
                    style={{ fontSize: "13px", fontVariationSettings: "'FILL' 1" }}
                  >
                    auto_awesome
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">
                    AI Summary
                  </span>
                </div>
                <p className="text-[13px] text-slate-700 dark:text-slate-200 leading-relaxed">
                  {selectedEmail.email_processed.summary}
                </p>
              </div>
            )}

            {/* Quick actions */}
            {selectedEmail.email_processed?.quick_actions?.length ? (
              <div data-tour="email-detail-quick-actions" className="flex flex-wrap gap-2">
                {selectedEmail.email_processed.quick_actions.map((qa, i) => {
                  const key = `${selectedEmail.id}-${qa.action}`;
                  const done = addedActions.has(key);
                  return (
                    <button
                      key={i}
                      onClick={() => handleAction(selectedEmail, qa)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-150 cursor-pointer ${
                        done
                          ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-200 dark:ring-emerald-900/50"
                          : "bg-[var(--surface-2)] text-[var(--foreground)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] active:scale-[0.97]"
                      }`}
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: "14px", fontVariationSettings: done ? "'FILL' 1" : "'FILL' 0" }}
                      >
                        {done ? "check_circle" : ACTION_ICONS[qa.action] ?? "bolt"}
                      </span>
                      {done ? "Done" : qa.label}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          {/* Email body */}
          <div className="tutorial-email-body flex-1 px-6 py-5 text-[13px] leading-relaxed">
            <div dangerouslySetInnerHTML={{ __html: selectedEmail.body_html }} />
            <style>{`
              .tutorial-email-body { color: var(--foreground); }
              .tutorial-email-body * { color: inherit !important; }
              .tutorial-email-body a { color: var(--accent) !important; }
              .tutorial-email-body strong, .tutorial-email-body b { color: var(--foreground) !important; }
            `}</style>
          </div>
        </div>
      )}

      {/* Empty state when no email selected */}
      {!selectedEmail && (
        <div className="hidden" />
      )}
    </div>
  );
}
