"use client";

import { useState } from "react";
import type { AgentAction } from "@/lib/agentTypes";

interface AgentActionCardProps {
  action: AgentAction;
  onToggle: (selected: boolean) => void;
  onEdit: (patch: Partial<AgentAction["payload"]>) => void;
  onRemove?: () => void;
  result?: { status: "success" | "error"; info?: string; error?: string };
  locked?: boolean;
}

const TYPE_META: Record<
  AgentAction["type"],
  { icon: string; label: string; accent: string; accentBg: string }
> = {
  reply: {
    icon: "send",
    label: "Reply",
    accent: "text-emerald-700 dark:text-emerald-300",
    accentBg: "bg-emerald-500/10",
  },
  todo: {
    icon: "task_alt",
    label: "Todo",
    accent: "text-teal-700 dark:text-teal-300",
    accentBg: "bg-teal-500/10",
  },
  meeting: {
    icon: "event",
    label: "Meeting",
    accent: "text-sky-700 dark:text-sky-300",
    accentBg: "bg-sky-500/10",
  },
  archive: {
    icon: "archive",
    label: "Archive",
    accent: "text-slate-600 dark:text-slate-300",
    accentBg: "bg-slate-500/10",
  },
};

function fmtIso(iso?: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return iso;
  }
}

/**
 * Three-state reply intent selector: Send | Draft | Resolve only.
 * resolve_only means "mark this handled, don't create a draft and don't send".
 */
function replyMode(a: AgentAction): "send" | "draft" | "resolve" {
  if (a.payload.resolve_only) return "resolve";
  if (a.payload.send_now === false) return "draft";
  return "send";
}

export default function AgentActionCard({
  action,
  onToggle,
  onEdit,
  onRemove,
  result,
  locked,
}: AgentActionCardProps) {
  const meta = TYPE_META[action.type];
  const [expanded, setExpanded] = useState(false);
  const included = action.selected;

  const subdued = !included && !result;

  return (
    <div
      className={`solve-fade-in rounded-xl border transition-colors ${
        result?.status === "success"
          ? "border-emerald-300/60 bg-emerald-50/40 dark:border-emerald-500/30 dark:bg-emerald-500/5"
          : result?.status === "error"
            ? "border-red-300/60 bg-red-50/40 dark:border-red-500/30 dark:bg-red-500/5"
            : included
              ? "border-[var(--border)] bg-[var(--surface)]"
              : "border-dashed border-[var(--border)] bg-transparent"
      } ${subdued ? "opacity-70" : ""}`}
    >
      <div className="px-4 pt-3.5 pb-3">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${meta.accentBg} ${meta.accent}`}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: "14px" }}
            >
              {meta.icon}
            </span>
          </span>
          <span
            className={`text-[10.5px] font-semibold uppercase tracking-[0.14em] ${meta.accent}`}
          >
            {meta.label}
          </span>
          {action.recommended && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: "10px" }}
              >
                auto_awesome
              </span>
              Recommended
            </span>
          )}
          {action.priority && action.priority !== "medium" && (
            <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[9.5px] uppercase tracking-wider text-[var(--muted)]">
              {action.priority}
            </span>
          )}
          {action.bucket && action.bucket !== "single" && (
            <span className="ml-auto rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 text-[9.5px] uppercase tracking-wider text-[var(--muted)]">
              {action.bucket}
            </span>
          )}
          {result && (
            <span
              className={`${action.bucket && action.bucket !== "single" ? "" : "ml-auto"} inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                result.status === "success"
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : "bg-red-500/15 text-red-600 dark:text-red-400"
              }`}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: "12px" }}
              >
                {result.status === "success" ? "check_circle" : "error"}
              </span>
              {result.status === "success" ? "Done" : "Failed"}
            </span>
          )}
        </div>

        <h4 className="mt-2 text-[13.5px] font-semibold leading-snug text-[var(--foreground)]">
          {action.type === "reply" && (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              {replyMode(action) === "send" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: "11px" }}
                  >
                    send
                  </span>
                  Send
                </span>
              )}
              {replyMode(action) === "draft" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/15 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: "11px" }}
                  >
                    drafts
                  </span>
                  Draft
                </span>
              )}
              {replyMode(action) === "resolve" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: "11px" }}
                  >
                    done_all
                  </span>
                  Resolve only
                </span>
              )}
              <span>
                {`${action.payload.to ?? ""} · ${action.payload.subject ?? ""}`}
              </span>
            </span>
          )}
          {action.type === "todo" && (action.payload.title ?? "Untitled todo")}
          {action.type === "meeting" &&
            `${action.payload.meeting_title ?? "Meeting"} — ${fmtIso(action.payload.start_iso)}`}
          {action.type === "archive" &&
            `Archive ${(action.payload.email_ids ?? []).length} email${
              (action.payload.email_ids ?? []).length === 1 ? "" : "s"
            }${action.payload.summary ? ` · ${action.payload.summary}` : ""}`}
        </h4>

        {action.reasoning && (
          <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] leading-snug italic text-[var(--muted)]">
            <span
              className="material-symbols-outlined mt-0.5 text-emerald-600/70 dark:text-emerald-400/70"
              style={{ fontSize: "13px" }}
            >
              psychology
            </span>
            <span className="flex-1">{action.reasoning}</span>
          </p>
        )}

        {(result?.info || result?.error) && (
          <p className="mt-1.5 text-[11px] text-[var(--muted)]">
            {result.info ?? result.error}
          </p>
        )}

        {/* Expanded editor */}
        {expanded && !locked && (
          <div className="mt-3 space-y-2.5 rounded-lg border border-dashed border-[var(--border)] bg-[var(--background)]/60 p-3">
            {action.type === "reply" && (
              <>
                <LabeledInput
                  label="To"
                  value={action.payload.to ?? ""}
                  onChange={(to) => onEdit({ to })}
                />
                <LabeledInput
                  label="Subject"
                  value={action.payload.subject ?? ""}
                  onChange={(subject) => onEdit({ subject })}
                />
                <LabeledTextarea
                  label="Body"
                  value={action.payload.body ?? ""}
                  onChange={(body) => onEdit({ body })}
                  rows={8}
                  disabled={replyMode(action) === "resolve"}
                />
                <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
                  <span className="text-[var(--muted)]">Intent:</span>
                  <div className="inline-flex rounded-full border border-[var(--border)] p-0.5 bg-[var(--surface-2)]">
                    <TriStatePill
                      active={replyMode(action) === "send"}
                      onClick={() =>
                        onEdit({ send_now: true, resolve_only: false })
                      }
                      icon="send"
                      label="Send"
                      activeClass="bg-emerald-600 text-white"
                    />
                    <TriStatePill
                      active={replyMode(action) === "draft"}
                      onClick={() =>
                        onEdit({ send_now: false, resolve_only: false })
                      }
                      icon="drafts"
                      label="Draft"
                      activeClass="bg-slate-600 text-white"
                    />
                    <TriStatePill
                      active={replyMode(action) === "resolve"}
                      onClick={() =>
                        onEdit({ send_now: false, resolve_only: true })
                      }
                      icon="done_all"
                      label="Resolve only"
                      activeClass="bg-amber-600 text-white"
                    />
                  </div>
                </div>
                {replyMode(action) === "resolve" && (
                  <p className="text-[11px] leading-snug text-amber-700 dark:text-amber-400">
                    This thread will be marked handled. No email will be sent or
                    saved as a draft.
                  </p>
                )}
              </>
            )}
            {action.type === "todo" && (
              <>
                <LabeledInput
                  label="Title"
                  value={action.payload.title ?? ""}
                  onChange={(title) => onEdit({ title })}
                />
                <LabeledInput
                  label="Due date (YYYY-MM-DD)"
                  value={action.payload.due ?? ""}
                  onChange={(due) => onEdit({ due })}
                />
              </>
            )}
            {action.type === "meeting" && (
              <>
                <LabeledInput
                  label="Title"
                  value={action.payload.meeting_title ?? ""}
                  onChange={(meeting_title) => onEdit({ meeting_title })}
                />
                <LabeledInput
                  label="Start (ISO)"
                  value={action.payload.start_iso ?? ""}
                  onChange={(start_iso) => onEdit({ start_iso })}
                />
                <LabeledInput
                  label="Duration (minutes)"
                  value={String(action.payload.duration_mins ?? 30)}
                  onChange={(v) => onEdit({ duration_mins: Number(v) || 30 })}
                />
                <LabeledInput
                  label="Attendees (comma-separated)"
                  value={(action.payload.attendees ?? []).join(", ")}
                  onChange={(v) =>
                    onEdit({
                      attendees: v
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </>
            )}
            {action.type === "archive" && (
              <LabeledInput
                label="Summary (what's being archived)"
                value={action.payload.summary ?? ""}
                onChange={(summary) => onEdit({ summary })}
              />
            )}
          </div>
        )}

        {/* Footer: edit + include + remove. No top-left checkbox. */}
        {!locked && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)]/60 pt-2.5">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setExpanded((v) => !v)}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: "13px" }}
                >
                  {expanded ? "expand_less" : "tune"}
                </span>
                {expanded ? "Hide details" : "Edit"}
              </button>
              <button
                onClick={() => onToggle(!included)}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  included
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : "border border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
                }`}
                aria-pressed={included}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: "13px" }}
                >
                  {included ? "check_box" : "check_box_outline_blank"}
                </span>
                {included ? "Included" : "Include"}
              </button>
            </div>
            {onRemove && (
              <button
                onClick={onRemove}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-[var(--muted)] transition-colors hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: "13px" }}
                >
                  delete
                </span>
                Remove
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TriStatePill({
  active,
  onClick,
  icon,
  label,
  activeClass,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
  activeClass: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
        active
          ? activeClass
          : "text-[var(--muted)] hover:text-[var(--foreground)]"
      }`}
    >
      <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>
        {icon}
      </span>
      {label}
    </button>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[12px] text-[var(--foreground)] focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400/40"
      />
    </label>
  );
}

function LabeledTextarea({
  label,
  value,
  onChange,
  rows = 4,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
        {label}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        disabled={disabled}
        className="w-full resize-y rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[12px] text-[var(--foreground)] focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400/40 disabled:opacity-50"
      />
    </label>
  );
}
