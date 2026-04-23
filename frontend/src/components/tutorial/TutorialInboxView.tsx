"use client";

import { useState, useEffect } from "react";
import DOMPurify from "dompurify";
import { MOCK_EMAILS, type MockEmail } from "./mockData";

const CATEGORY_COLORS: Record<string, string> = {
  important:
    "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-900/50",
  "action-required":
    "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 ring-1 ring-amber-200 dark:ring-amber-900/50",
  newsletter:
    "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400 ring-1 ring-violet-200 dark:ring-violet-900/50",
  informational:
    "bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400 ring-1 ring-sky-200 dark:ring-sky-900/50",
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

// ─── MEETING PICKER MODAL ────────────────────────────────────────────────────

type Slot = { label: string; time: string };

const MOCK_SLOTS: Slot[] = [
  {
    label: "Thursday, Apr 3 at 11:00 AM",
    time: new Date(Date.now() + 3 * 86400000).toISOString(),
  },
  {
    label: "Thursday, Apr 3 at 2:00 PM",
    time: new Date(Date.now() + 3 * 86400000 + 3 * 3600000).toISOString(),
  },
  {
    label: "Friday, Apr 4 at 10:00 AM",
    time: new Date(Date.now() + 4 * 86400000).toISOString(),
  },
];

type MeetingPickerProps = {
  title: string;
  attendee: string;
  onConfirm: (slot: Slot) => void;
  onCancel: () => void;
};

function MeetingPickerModal({
  title,
  attendee,
  onConfirm,
  onCancel,
}: MeetingPickerProps) {
  const [selected, setSelected] = useState<Slot>(MOCK_SLOTS[0]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 30);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className="fixed inset-0 z-[430] flex items-center justify-center px-4"
      style={{
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)",
        opacity: mounted ? 1 : 0,
        transition: "opacity 0.2s ease",
      }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-[var(--border)] shadow-2xl overflow-hidden"
        style={{
          background: "var(--background)",
          transform: mounted
            ? "scale(1) translateY(0)"
            : "scale(0.95) translateY(16px)",
          transition: "transform 0.25s cubic-bezier(0.16,1,0.3,1)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[var(--accent)] flex items-center justify-center shrink-0">
              <span
                className="material-symbols-outlined text-white dark:text-[#202124]"
                style={{ fontSize: "16px", fontVariationSettings: "'FILL' 1" }}
              >
                event
              </span>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--accent)]">
                Schedule Meeting
              </p>
              <h3 className="text-[14px] font-bold text-[var(--foreground)] leading-tight">
                {title}
              </h3>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors cursor-pointer"
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: "18px" }}
            >
              close
            </span>
          </button>
        </div>

        {/* Attendee */}
        <div className="px-5 pt-4 pb-2">
          <div className="flex items-center gap-2 text-[12px] text-[var(--muted)]">
            <span
              className="material-symbols-outlined"
              style={{ fontSize: "14px" }}
            >
              person
            </span>
            <span>{attendee}</span>
          </div>
        </div>

        {/* Time slots */}
        <div className="px-5 pb-4 flex flex-col gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--muted)] mb-1">
            Select a time
          </p>
          {MOCK_SLOTS.map((slot) => (
            <button
              key={slot.time}
              onClick={() => setSelected(slot)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all cursor-pointer ${
                selected.time === slot.time
                  ? "border-[var(--accent)] bg-[var(--accent-light)] text-[var(--accent)]"
                  : "border-[var(--border)] hover:bg-[var(--surface-2)] text-[var(--foreground)]"
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                  selected.time === slot.time
                    ? "border-[var(--accent)]"
                    : "border-[var(--muted)]"
                }`}
              >
                {selected.time === slot.time && (
                  <div className="w-2 h-2 rounded-full bg-[var(--accent)]" />
                )}
              </div>
              <span className="text-[13px] font-medium">{slot.label}</span>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[var(--border)] flex items-center gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border)] text-[13px] font-semibold text-[var(--muted)] hover:bg-[var(--surface-2)] transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(selected)}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--accent)] text-white dark:text-[#202124] text-[13px] font-semibold hover:opacity-90 active:scale-[0.97] transition-all cursor-pointer shadow-md"
          >
            Confirm
            <span
              className="material-symbols-outlined"
              style={{ fontSize: "15px" }}
            >
              check
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── TODO ADDED CALLOUT ───────────────────────────────────────────────────────

type TodoCalloutProps = {
  text: string;
  onNavigate: () => void;
};

function TodoAddedCallout({ text, onNavigate }: TodoCalloutProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setVisible(true), 30);
    const t2 = setTimeout(() => setVisible(false), 3000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  return (
    <div
      className="mt-2 rounded-xl border border-emerald-200 dark:border-emerald-900/50 overflow-hidden"
      style={{
        background: "var(--background)",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(-6px)",
        transition: "opacity 0.25s ease, transform 0.25s ease",
        maxHeight: visible ? "120px" : "0",
      }}
    >
      <div className="px-3 py-2.5 bg-emerald-50 dark:bg-emerald-950/30">
        <div className="flex items-start gap-2.5">
          <div className="w-6 h-6 rounded-lg bg-emerald-500 flex items-center justify-center shrink-0 mt-0.5">
            <span
              className="material-symbols-outlined text-white"
              style={{ fontSize: "13px", fontVariationSettings: "'FILL' 1" }}
            >
              check
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-widest mb-0.5">
              Todo added
            </p>
            <p className="text-[12px] text-emerald-800 dark:text-emerald-300 font-medium leading-snug truncate">
              {text}
            </p>
          </div>
          <button
            onClick={onNavigate}
            className="shrink-0 flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors cursor-pointer"
          >
            View
            <span
              className="material-symbols-outlined"
              style={{ fontSize: "12px" }}
            >
              arrow_forward
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

type Props = {
  onAddTodo: (text: string, emailId: string) => void;
  onAnnotationTrigger?: (key: string) => void;
  highlightEmailId?: string | null;
  onReply?: (email: MockEmail) => void;
  onScheduleMeeting?: (
    emailId: string,
    title: string,
    attendees: string[],
  ) => void;
  onNavigateTodos?: () => void;
};

export default function TutorialInboxView({
  onAddTodo,
  onAnnotationTrigger,
  highlightEmailId,
  onReply,
  onScheduleMeeting,
  onNavigateTodos,
}: Props) {
  const [selectedEmail, setSelectedEmail] = useState<MockEmail | null>(null);
  const [addedActions, setAddedActions] = useState<Set<string>>(new Set());
  const [meetingPickerEmail, setMeetingPickerEmail] = useState<{
    email: MockEmail;
    title: string;
  } | null>(null);
  const [lastAddedTodo, setLastAddedTodo] = useState<{
    text: string;
    calloutKey: number;
  } | null>(null);

  const handleEmailClick = (email: MockEmail) => {
    setSelectedEmail(email);
    onAnnotationTrigger?.("email-open");
  };

  const handleBack = () => {
    setSelectedEmail(null);
  };

  const markActionDone = (email: MockEmail, action: string) => {
    setAddedActions((prev) => new Set(prev).add(`${email.id}-${action}`));
  };

  const handleAction = (
    email: MockEmail,
    action: { label: string; action: string },
  ) => {
    const key = `${email.id}-${action.action}`;
    if (addedActions.has(key)) return;

    if (action.action === "add_todo") {
      const todoText = action.label.replace(/^(Add todo:\s*)/i, "");
      markActionDone(email, action.action);
      onAddTodo(todoText, email.id);
      setLastAddedTodo({ text: todoText, calloutKey: Date.now() });
      onAnnotationTrigger?.("quick-action-todo");
    } else if (action.action === "schedule_meeting") {
      const meetingTitle = action.label.replace(/^(Schedule\s*)/i, "");
      setMeetingPickerEmail({ email, title: meetingTitle });
      onAnnotationTrigger?.("quick-action-meeting");
    } else if (action.action === "reply") {
      onReply?.(email);
      onAnnotationTrigger?.("quick-action-reply");
      // Mark done after modal closes is handled by Shell via onActionDone
      // For now, mark it done immediately so button stays in "Replied" state
      markActionDone(email, action.action);
    }
  };

  const handleMeetingConfirm = (slot: Slot) => {
    if (!meetingPickerEmail) return;
    const { email, title } = meetingPickerEmail;
    markActionDone(email, "schedule_meeting");
    onScheduleMeeting?.(email.id, title, [email.sender_email]);
    setMeetingPickerEmail(null);
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Email list - hidden on mobile when detail open */}
      <div
        data-tour="email-list"
        className={`flex flex-col border-r border-[var(--border)] overflow-y-auto
          ${selectedEmail ? "hidden md:flex md:w-80 md:shrink-0" : "flex flex-1 md:w-auto"}`}
      >
        {/* Header */}
        <div className="sticky top-0 bg-[var(--background)] border-b border-[var(--border)] px-4 py-3 flex items-center justify-between z-10">
          <h2 className="text-[15px] font-bold text-[var(--foreground)]">
            Inbox
          </h2>
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
                    !email.is_read
                      ? "font-bold text-[var(--foreground)]"
                      : "font-medium text-[var(--muted)]"
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
                    !email.is_read
                      ? "font-semibold text-[var(--foreground)]"
                      : "text-[var(--muted)]"
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

      {/* Email detail - full-width on mobile, flex-1 on desktop */}
      {selectedEmail && (
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto flex flex-col">
            {/* Detail header */}
            <div className="sticky top-0 bg-[var(--background)] border-b border-[var(--border)] px-4 md:px-6 py-4 z-10">
              {/* Mobile back button */}
              <button
                onClick={handleBack}
                className="md:hidden flex items-center gap-1.5 text-[12px] font-semibold text-[var(--accent)] mb-3 cursor-pointer hover:opacity-80 transition-opacity"
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: "16px" }}
                >
                  arrow_back
                </span>
                Inbox
              </button>

              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex-1 min-w-0">
                  <h1 className="text-[17px] font-bold text-[var(--foreground)] leading-tight mb-1.5">
                    {selectedEmail.subject}
                  </h1>
                  <div className="flex items-center gap-2 text-[12px] text-[var(--muted)] flex-wrap">
                    <span className="font-semibold text-[var(--foreground)]">
                      {selectedEmail.sender}
                    </span>
                    <span>·</span>
                    <span>{selectedEmail.sender_email}</span>
                    <span>·</span>
                    <span>{formatTime(selectedEmail.received_at)}</span>
                  </div>
                </div>
                <button
                  onClick={handleBack}
                  className="hidden md:flex shrink-0 p-1.5 rounded-lg hover:bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors cursor-pointer"
                  aria-label="Close email"
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: "18px" }}
                  >
                    close
                  </span>
                </button>
              </div>

              {/* AI Summary */}
              {selectedEmail.email_processed?.summary && (
                <div className="rounded-xl px-4 py-3 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/50 mb-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span
                      className="material-symbols-outlined text-indigo-500"
                      style={{
                        fontSize: "13px",
                        fontVariationSettings: "'FILL' 1",
                      }}
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
                <div data-tour="email-detail-quick-actions">
                  <div className="flex flex-wrap gap-2">
                    {selectedEmail.email_processed.quick_actions.map(
                      (qa, i) => {
                        const key = `${selectedEmail.id}-${qa.action}`;
                        const done = addedActions.has(key);
                        const isReply = qa.action === "reply";
                        return (
                          <button
                            key={i}
                            onClick={() => handleAction(selectedEmail, qa)}
                            disabled={done && !isReply}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-150 cursor-pointer ${
                              done
                                ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-200 dark:ring-emerald-900/50"
                                : "bg-[var(--surface-2)] text-[var(--foreground)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] active:scale-[0.97]"
                            }`}
                          >
                            <span
                              className="material-symbols-outlined"
                              style={{
                                fontSize: "14px",
                                fontVariationSettings: done
                                  ? "'FILL' 1"
                                  : "'FILL' 0",
                              }}
                            >
                              {done
                                ? "check_circle"
                                : (ACTION_ICONS[qa.action] ?? "bolt")}
                            </span>
                            {done ? (isReply ? "Replied" : "Done") : qa.label}
                          </button>
                        );
                      },
                    )}
                  </div>

                  {/* Todo added callout */}
                  {lastAddedTodo && (
                    <TodoAddedCallout
                      key={lastAddedTodo.calloutKey}
                      text={lastAddedTodo.text}
                      onNavigate={() => {
                        setLastAddedTodo(null);
                        onNavigateTodos?.();
                      }}
                    />
                  )}
                </div>
              ) : null}
            </div>

            {/* Email body */}
            <div className="tutorial-email-body flex-1 px-4 md:px-6 py-5 text-[13px] leading-relaxed">
              <div
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(selectedEmail.body_html ?? "", {
                    USE_PROFILES: { html: true },
                  }),
                }}
              />
              <style>{`
                .tutorial-email-body { color: var(--foreground); }
                .tutorial-email-body * { color: inherit !important; }
                .tutorial-email-body a { color: var(--accent) !important; }
                .tutorial-email-body strong, .tutorial-email-body b { color: var(--foreground) !important; }
              `}</style>
            </div>
          </div>
        </div>
      )}

      {/* Meeting picker modal */}
      {meetingPickerEmail && (
        <MeetingPickerModal
          title={meetingPickerEmail.title}
          attendee={meetingPickerEmail.email.sender_email}
          onConfirm={handleMeetingConfirm}
          onCancel={() => setMeetingPickerEmail(null)}
        />
      )}
    </div>
  );
}
