"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../AppShell";
import { normalizeAgentSessionError } from "@/lib/agentClient";
import type {
  AgentAction,
  AgentAnswer,
  AgentBucket,
  AgentQuestion,
  AgentTurnRow,
} from "@/lib/agentTypes";
import QuestionCard from "./QuestionCard";
import AgentActionCard from "./AgentActionCard";

type StepStatus = "done" | "running" | "queued";

interface ProgressStep {
  key: string;
  tool: string;
  label: string;
  detail?: string;
  status: StepStatus;
  icon: string;
  /** For read tools — a short string gleaned from arguments (e.g. sender name). */
  suffix?: string;
  bucket?: AgentBucket;
  /** Attached to assistant turns: MiniMax reasoning for the planning round. */
  reasoning?: string;
}

const TOOL_META: Record<string, { icon: string; label: string }> = {
  get_briefing_context: {
    icon: "inbox_customize",
    label: "Reading the briefing",
  },
  get_thread: { icon: "mail", label: "Reading thread" },
  search_emails: { icon: "search", label: "Searching inbox" },
  past_replies_by_me: { icon: "history", label: "Checking past replies" },
  calendar_freebusy: {
    icon: "event_available",
    label: "Checking your calendar",
  },
  user_style_profile: { icon: "edit_note", label: "Learning your voice" },
  ask_user: { icon: "help", label: "Asking you to decide" },
  propose_action: { icon: "add_task", label: "Drafting action" },
  revise_action: { icon: "edit", label: "Revising action" },
  discard_action: { icon: "delete_sweep", label: "Dropping action" },
  finalize: { icon: "check_circle", label: "Plan ready" },
};

const BUCKET_META: Record<
  AgentBucket,
  { label: string; icon: string; color: string }
> = {
  replies: {
    label: "Replies",
    icon: "send",
    color: "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10",
  },
  meetings: {
    label: "Meetings",
    icon: "event",
    color: "text-sky-700 dark:text-sky-300 bg-sky-500/10",
  },
  todos: {
    label: "Todos",
    icon: "task_alt",
    color: "text-violet-700 dark:text-violet-300 bg-violet-500/10",
  },
  noise: {
    label: "Noise",
    icon: "archive",
    color: "text-slate-600 dark:text-slate-300 bg-slate-500/10",
  },
  single: {
    label: "Agent",
    icon: "auto_awesome",
    color: "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10",
  },
};

function parseArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function shortAddress(s?: string): string {
  if (!s) return "";
  const match = s.match(/<([^>]+)>/);
  const email = match?.[1] ?? s;
  const name = email
    .split("@")[0]
    .replace(/[^a-zA-Z]/g, " ")
    .trim();
  const pretty = name
    .split(/\s+/)
    .map((w) => (w[0]?.toUpperCase() ?? "") + w.slice(1))
    .join(" ");
  return pretty || email;
}

function shortSubject(s?: string, n = 32): string {
  const t = (s ?? "").trim();
  if (!t) return "";
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

interface BriefingLabel {
  label: string;
  bucket: AgentBucket;
}

interface AgentWorkspaceProps {
  open: boolean;
  onClose: () => void;
}

export default function AgentWorkspace({ open, onClose }: AgentWorkspaceProps) {
  const {
    agentSession,
    agentTurns,
    answerSolveAgent,
    answerSolveAgentBatch,
    executeSolveAgent,
    cancelSolveAgent,
    solveAgentCancelInFlight,
    resetSolveAgent,
    addToast,
    profile,
  } = useApp();

  const [localActions, setLocalActions] = useState<AgentAction[]>([]);
  const [executing, setExecuting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);

  // Build a map from email_id to a human label + bucket from the cached
  // briefing on the profile. Falls back to "this thread" when unknown.
  const briefingIndex = useMemo(() => {
    const map = new Map<string, BriefingLabel>();
    const b = (profile?.last_briefing ?? {}) as Record<string, unknown>;
    const addList = (arr: unknown, bucket: AgentBucket) => {
      if (!Array.isArray(arr)) return;
      for (const it of arr) {
        const x = it as Record<string, unknown>;
        const id = typeof x.email_id === "string" ? x.email_id : "";
        if (!id) continue;
        const sender =
          typeof x.senderName === "string" && x.senderName.trim()
            ? x.senderName.trim()
            : typeof x.sender === "string"
              ? shortAddress(x.sender as string)
              : "";
        const subj =
          typeof x.subject === "string" ? shortSubject(x.subject, 28) : "";
        const label =
          sender && subj
            ? `${sender} · ${subj}`
            : sender || subj || "this thread";
        map.set(id, { label, bucket });
      }
    };
    addList(b.crucial, "replies");
    addList(b.replyNeeded, "replies");
    addList(b.deadlines, "todos");
    addList(b.nonEssential, "noise");
    return map;
  }, [profile?.last_briefing]);

  // Mirror agent session actions locally so user edits feel instant.
  useEffect(() => {
    if (!agentSession) {
      setLocalActions([]);
      return;
    }
    const src = agentSession.plan?.actions ?? agentSession.draft_actions ?? [];
    setLocalActions(src);
  }, [
    agentSession?.id,
    agentSession?.status,
    agentSession?.draft_actions,
    agentSession?.plan?.actions,
    agentSession,
  ]);

  // Derive a progress checklist from assistant tool calls + matching tool
  // results. Each step carries its bucket tag so we can render per-bucket lanes.
  const { steps, assistantStatusLine } = useMemo(() => {
    const items: ProgressStep[] = [];
    const resolved = new Set<string>();
    const sessionDone =
      agentSession?.status === "ready" || agentSession?.status === "done";

    (agentTurns ?? []).forEach((t) => {
      if (t.role === "tool" && t.tool_call_id) resolved.add(t.tool_call_id);
    });

    let lastStatus = "";

    (agentTurns ?? []).forEach((t) => {
      if (t.role !== "assistant") return;
      const tools = t.content.tool_calls ?? [];
      const text = (t.content.content ?? "").trim();
      if (text && !tools.length) lastStatus = text;
      const bucket = (t as AgentTurnRow & { bucket?: AgentBucket | null })
        .bucket as AgentBucket | undefined;
      tools.forEach((tc) => {
        const meta = TOOL_META[tc.function.name] ?? {
          icon: "bolt",
          label: tc.function.name,
        };
        const args = parseArgs(tc.function.arguments || "{}");
        let suffix = "";
        let detail = "";
        if (tc.function.name === "get_thread") {
          const id = String(args.email_id ?? "");
          suffix = briefingIndex.get(id)?.label ?? "this thread";
        } else if (tc.function.name === "past_replies_by_me") {
          suffix = shortAddress(String(args.to ?? ""));
        } else if (tc.function.name === "search_emails") {
          suffix = String(args.query ?? "").slice(0, 28);
        } else if (tc.function.name === "propose_action") {
          const type = String(args.type ?? "");
          if (type === "reply")
            detail = `Reply to ${shortAddress(String(args.to ?? ""))}`;
          else if (type === "meeting")
            detail = `Meeting: ${shortSubject(String(args.meeting_title ?? ""))}`;
          else if (type === "todo")
            detail = shortSubject(String(args.title ?? "Todo"));
          else if (type === "archive")
            detail = shortSubject(String(args.summary ?? "Archive batch"));
          suffix = type;
        } else if (tc.function.name === "ask_user") {
          const qs = Array.isArray(args.questions)
            ? (args.questions as Array<{ eyebrow?: string }>)
            : null;
          if (qs && qs.length) {
            suffix =
              qs.length === 1
                ? (qs[0]?.eyebrow ?? "")
                : `${qs.length} questions`;
          } else {
            suffix = String(args.eyebrow ?? "");
          }
        } else if (tc.function.name === "finalize") {
          suffix = "done";
        }
        items.push({
          key: tc.id,
          tool: tc.function.name,
          label: meta.label,
          detail,
          icon: meta.icon,
          suffix,
          status: resolved.has(tc.id) ? "done" : "running",
          bucket,
          reasoning: t.reasoning ?? undefined,
        });
      });
    });

    if (sessionDone) {
      for (const it of items) {
        if (it.status === "running") it.status = "done";
      }
    } else {
      // Only the latest "running" step per bucket should pulse; earlier ones
      // within the same bucket are demoted to done because the backend has
      // moved on for that lane.
      const lastRunningByBucket: Record<string, number> = {};
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].status !== "running") continue;
        const key = items[i].bucket ?? "_";
        if (lastRunningByBucket[key] === undefined) {
          lastRunningByBucket[key] = i;
        } else {
          items[i].status = "done";
        }
      }
    }

    return { steps: items, assistantStatusLine: lastStatus };
  }, [agentTurns, briefingIndex, agentSession?.status]);

  const doneCount = steps.filter((s) => s.status === "done").length;

  // Group steps by bucket for the lane view.
  const stepsByBucket = useMemo(() => {
    const buckets: Record<string, ProgressStep[]> = {};
    for (const s of steps) {
      const b = s.bucket ?? "single";
      if (!buckets[b]) buckets[b] = [];
      buckets[b].push(s);
    }
    return buckets;
  }, [steps]);

  const bucketKeys = Object.keys(stepsByBucket);
  const hasMultipleBuckets = bucketKeys.length > 1;

  // Autoscroll on new steps / turn count.
  useLayoutEffect(() => {
    if (!open) return;
    const el = streamRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 240) {
      requestAnimationFrame(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      });
    }
  }, [steps.length, agentTurns.length, open, agentSession?.status]);

  // Pending questions: prefer the batched array when available.
  const pendingQuestions: AgentQuestion[] = useMemo(() => {
    const arr = agentSession?.pending_questions;
    if (Array.isArray(arr) && arr.length) return arr;
    if (agentSession?.pending_question) return [agentSession.pending_question];
    return [];
  }, [agentSession?.pending_questions, agentSession?.pending_question]);

  // Local batch answers keyed by question id.
  const [batchAnswers, setBatchAnswers] = useState<Record<string, AgentAnswer>>(
    {},
  );
  // Clear when the pending set changes (new round of questions).
  useEffect(() => {
    setBatchAnswers({});
  }, [pendingQuestions.map((q) => q.id).join("|")]);

  if (!open || !agentSession) return null;

  const status = agentSession.status;

  const statusLabel =
    solveAgentCancelInFlight
      ? "Cancelling plan"
      : status === "planning"
      ? "Resolving in the background"
      : status === "asking"
        ? "Needs your input"
        : status === "ready" && localActions.length === 0
          ? "No actions to run"
          : status === "ready"
            ? "Plan ready for review"
            : status === "executing"
              ? "Executing"
              : status === "done"
                ? "All actions complete"
                : status === "cancelled"
                  ? "Cancelled"
                  : status === "error"
                    ? "Error"
                    : "";

  const statusTone =
    solveAgentCancelInFlight
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-300/50 dark:border-amber-500/30"
      : status === "asking"
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-300/50 dark:border-amber-500/30"
      : status === "ready" && localActions.length === 0
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-300/50 dark:border-amber-500/30"
        : status === "ready"
          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-300/50 dark:border-emerald-500/30"
          : status === "error"
            ? "bg-red-500/15 text-red-700 dark:text-red-300 border-red-300/50 dark:border-red-500/30"
            : status === "done"
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-300/50 dark:border-emerald-500/30"
              : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-300/40 dark:border-emerald-500/25";

  const toggleAction = (id: string, selected: boolean) => {
    setLocalActions((prev) =>
      prev.map((a) => (a.id === id ? { ...a, selected } : a)),
    );
  };
  const editAction = (id: string, patch: Partial<AgentAction["payload"]>) => {
    setLocalActions((prev) =>
      prev.map((a) =>
        a.id === id ? { ...a, payload: { ...a.payload, ...patch } } : a,
      ),
    );
  };

  const onExecute = async () => {
    const approved = localActions.filter((a) => a.selected);
    if (!approved.length) {
      addToast("info", "Select at least one action to execute.");
      return;
    }
    setExecuting(true);
    try {
      await executeSolveAgent(approved);
    } finally {
      setExecuting(false);
    }
  };

  const onClearSession = () => {
    resetSolveAgent();
    onClose();
  };

  const canCancel =
    status === "planning" ||
    status === "asking" ||
    status === "ready" ||
    status === "executing";
  const showCancelControl = canCancel || solveAgentCancelInFlight;

  const visibleSteps = steps.filter(
    (s) => showAdvanced || s.tool !== "ask_user",
  );

  const answeredCount = Object.keys(batchAnswers).length;
  const totalQuestions = pendingQuestions.length;
  const submitBatch = async () => {
    if (!totalQuestions) return;
    if (totalQuestions === 1) {
      const qid = pendingQuestions[0].id;
      const a = batchAnswers[qid];
      if (!a) return;
      await answerSolveAgent({ ...a, question_id: qid });
      return;
    }
    const answers = pendingQuestions.map((q) => {
      const a = batchAnswers[q.id];
      if (a) return { ...a, question_id: q.id };
      return { question_id: q.id, skip: true } as AgentAnswer;
    });
    await answerSolveAgentBatch({ answers });
  };

  const anyReasoning = steps.some((s) => s.reasoning);

  // Pick a final rationale from the last assistant turn (if it has reasoning).
  const finalReasoning = (() => {
    for (let i = agentTurns.length - 1; i >= 0; i--) {
      const t = agentTurns[i];
      if (t.role === "assistant" && t.reasoning) return t.reasoning;
    }
    return null;
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/35 backdrop-blur-[3px] solve-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="solve-grain solve-panel-bg relative flex h-full w-full max-w-[min(880px,100%)] flex-col border-l border-[var(--border)] shadow-[0_20px_80px_-20px_rgba(0,0,0,0.45)]"
        role="dialog"
        aria-label="Auto-Resolve agent"
      >
        {/* Header */}
        <div className="relative flex items-center justify-between border-b border-[var(--border)]/70 px-6 py-4 backdrop-blur-sm">
          <div className="flex items-center gap-3.5">
            <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-[0_4px_14px_-4px_rgba(5,150,105,0.55)]">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: "22px" }}
              >
                auto_awesome
              </span>
            </div>
            <div>
              <h2 className="font-semibold leading-tight text-[var(--foreground)] tracking-tight text-[18px]">
                Auto-Resolve
              </h2>
              <div className="mt-1 flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] ${statusTone}`}
                >
                  {status === "planning" && (
                    <span className="inline-flex solve-dot-wave">
                      <span />
                      <span />
                      <span />
                    </span>
                  )}
                  {status !== "planning" && (
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: "12px" }}
                    >
                      {status === "asking"
                        ? "help"
                        : status === "ready"
                          ? "check_circle"
                          : status === "error"
                            ? "error"
                            : status === "executing"
                              ? "bolt"
                              : status === "done"
                                ? "done_all"
                                : "auto_awesome"}
                    </span>
                  )}
                  {statusLabel}
                </span>
                {steps.length > 0 && (
                  <span className="text-[10.5px] text-[var(--muted)]">
                    {doneCount}/{steps.length} steps
                  </span>
                )}
                {anyReasoning && (
                  <button
                    onClick={() => setShowReasoning((v) => !v)}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--muted)] hover:border-[var(--foreground)] hover:text-[var(--foreground)] transition-colors"
                    title="Toggle reasoning"
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: "12px" }}
                    >
                      psychology
                    </span>
                    {showReasoning ? "Hide thinking" : "Show thinking"}
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {showCancelControl && (
              <button
                type="button"
                onClick={() => void cancelSolveAgent()}
                disabled={solveAgentCancelInFlight}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3.5 py-1.5 text-[11.5px] font-medium text-[var(--muted)] transition-colors hover:border-red-400 hover:text-red-500 disabled:cursor-wait disabled:opacity-70 disabled:hover:border-[var(--border)] disabled:hover:text-[var(--muted)]"
                title={
                  solveAgentCancelInFlight
                    ? "Cancelling"
                    : "Cancel current plan"
                }
              >
                {solveAgentCancelInFlight && (
                  <span
                    className="material-symbols-outlined animate-spin"
                    style={{ fontSize: "14px" }}
                    aria-hidden
                  >
                    progress_activity
                  </span>
                )}
                {solveAgentCancelInFlight ? "Cancelling…" : "Cancel plan"}
              </button>
            )}
            {(status === "done" ||
              status === "cancelled" ||
              status === "error") && (
              <button
                onClick={onClearSession}
                className="cursor-pointer rounded-full border border-[var(--border)] px-3.5 py-1.5 text-[11.5px] font-medium text-[var(--muted)] transition-colors hover:border-[var(--foreground)] hover:text-[var(--foreground)]"
              >
                Clear
              </button>
            )}
            <button
              onClick={onClose}
              className="ml-1 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
              aria-label="Close"
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: "20px" }}
              >
                close
              </span>
            </button>
          </div>
        </div>

        {/* Stream body */}
        <div
          ref={streamRef}
          className="flex-1 overflow-auto px-6 py-5 scroll-smooth"
        >
          {/* Hero explanation */}
          {steps.length === 0 && status === "planning" && (
            <div className="mx-auto mt-6 max-w-md text-center">
              <div className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15">
                <span
                  className="material-symbols-outlined text-emerald-600 dark:text-emerald-400"
                  style={{ fontSize: "28px" }}
                >
                  hourglass_top
                </span>
              </div>
              <h3 className="text-[15px] font-semibold text-[var(--foreground)]">
                Starting Auto-Resolve
              </h3>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--muted)]">
                Feel free to keep working. The agent splits your inbox into
                parallel lanes and runs in the background. You&apos;ll be
                notified the moment it needs your input.
              </p>
            </div>
          )}

          {/* Progress (bucketed lanes when multiple) */}
          {steps.length > 0 && (
            <div className="mb-5">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                  Progress
                </span>
                {steps.length > 4 && (
                  <button
                    onClick={() => setShowAdvanced((v) => !v)}
                    className="cursor-pointer text-[10.5px] font-medium text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                  >
                    {showAdvanced ? "Hide all" : "Show all"}
                  </button>
                )}
              </div>

              {hasMultipleBuckets ? (
                <div className="space-y-3">
                  {bucketKeys.map((bk) => {
                    const meta =
                      BUCKET_META[bk as AgentBucket] ?? BUCKET_META.single;
                    const list = stepsByBucket[bk] ?? [];
                    const shown = showAdvanced
                      ? list.filter(
                          (s) => showAdvanced || s.tool !== "ask_user",
                        )
                      : list.filter((s) => s.tool !== "ask_user").slice(-4);
                    const laneDone = list.filter(
                      (s) => s.status === "done",
                    ).length;
                    return (
                      <div
                        key={bk}
                        className="rounded-xl border border-[var(--border)]/60 bg-[var(--surface)]/50 p-3"
                      >
                        <div className="mb-2 flex items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${meta.color}`}
                          >
                            <span
                              className="material-symbols-outlined"
                              style={{ fontSize: "12px" }}
                            >
                              {meta.icon}
                            </span>
                            {meta.label}
                          </span>
                          <span className="text-[10.5px] text-[var(--muted)]">
                            {laneDone}/{list.length}
                          </span>
                        </div>
                        <ol className="space-y-1.5">
                          {shown.map((step) => (
                            <StepRow
                              key={step.key}
                              step={step}
                              showReasoning={showReasoning}
                            />
                          ))}
                        </ol>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <ol className="relative space-y-1.5">
                  {(showAdvanced ? visibleSteps : visibleSteps.slice(-6)).map(
                    (step) => (
                      <StepRow
                        key={step.key}
                        step={step}
                        showReasoning={showReasoning}
                      />
                    ),
                  )}
                </ol>
              )}

              {assistantStatusLine && (
                <p className="mt-3 pl-8 text-[12px] italic leading-snug text-[var(--muted)]">
                  &ldquo;{assistantStatusLine}&rdquo;
                </p>
              )}
            </div>
          )}

          {/* Question area — batched grid when multiple */}
          {status === "asking" && pendingQuestions.length > 0 && (
            <div className="my-5">
              {pendingQuestions.length === 1 ? (
                <QuestionCard
                  question={pendingQuestions[0]}
                  initialAnswer={batchAnswers[pendingQuestions[0].id]}
                  onChange={(a) =>
                    setBatchAnswers((prev) => {
                      const next = { ...prev };
                      if (a) next[pendingQuestions[0].id] = a;
                      else delete next[pendingQuestions[0].id];
                      return next;
                    })
                  }
                  onAnswer={async (a) => {
                    await answerSolveAgent({
                      ...a,
                      question_id: pendingQuestions[0].id,
                    });
                  }}
                />
              ) : (
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <span
                      className="material-symbols-outlined text-amber-600 dark:text-amber-400"
                      style={{ fontSize: "18px" }}
                    >
                      help
                    </span>
                    <h3 className="text-[14px] font-semibold text-[var(--foreground)]">
                      {pendingQuestions.length} quick decisions
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {pendingQuestions.map((q) => (
                      <QuestionCard
                        key={q.id}
                        question={q}
                        compact
                        initialAnswer={batchAnswers[q.id]}
                        hideContinue
                        onChange={(a) =>
                          setBatchAnswers((prev) => {
                            const next = { ...prev };
                            if (a) next[q.id] = a;
                            else delete next[q.id];
                            return next;
                          })
                        }
                      />
                    ))}
                  </div>
                  <div className="sticky bottom-0 mt-4 -mx-6 border-t border-[var(--border)] bg-[var(--surface)]/95 px-6 py-3 backdrop-blur-sm flex items-center justify-between">
                    <div className="text-[11.5px] text-[var(--muted)]">
                      {answeredCount} of {totalQuestions} answered
                      {answeredCount < totalQuestions
                        ? " (unanswered will be skipped)"
                        : ""}
                    </div>
                    <button
                      onClick={() => void submitBatch()}
                      disabled={answeredCount === 0}
                      className="cursor-pointer rounded-full bg-emerald-600 px-4 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-40 disabled:hover:bg-emerald-600"
                    >
                      Continue
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {status === "error" && (
            <div className="my-4 rounded-xl border border-red-300/60 bg-red-50 p-3.5 text-[12.5px] text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              {normalizeAgentSessionError(agentSession.error) ??
                "Unknown error"}
            </div>
          )}

          {/* In-progress draft summary */}
          {localActions.length > 0 &&
            status !== "ready" &&
            status !== "done" && (
              <div className="mt-2 rounded-2xl border border-emerald-200/60 bg-emerald-50/40 dark:border-emerald-500/20 dark:bg-emerald-500/5 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className="material-symbols-outlined text-emerald-600 dark:text-emerald-400"
                    style={{ fontSize: "16px" }}
                  >
                    list_alt
                  </span>
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">
                    Drafted so far · {localActions.length} action
                    {localActions.length === 1 ? "" : "s"}
                  </span>
                </div>
                <ul className="space-y-1">
                  {localActions.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center gap-2 text-[12px] text-[var(--foreground)]"
                    >
                      <span
                        className="material-symbols-outlined text-[var(--muted)]"
                        style={{ fontSize: "14px" }}
                      >
                        {a.type === "reply"
                          ? "send"
                          : a.type === "todo"
                            ? "task_alt"
                            : a.type === "meeting"
                              ? "event"
                              : "archive"}
                      </span>
                      <span className="truncate">
                        {a.type === "reply"
                          ? `Reply to ${a.payload.to}`
                          : a.type === "todo"
                            ? (a.payload.title ?? "Todo")
                            : a.type === "meeting"
                              ? (a.payload.meeting_title ?? "Meeting")
                              : `Archive ${(a.payload.email_ids ?? []).length} email${
                                  (a.payload.email_ids ?? []).length === 1
                                    ? ""
                                    : "s"
                                }`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

          {/* Final review */}
          {(status === "ready" ||
            status === "executing" ||
            status === "done") && (
            <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur-sm p-5 solve-fade-in shadow-[0_8px_30px_-12px_rgba(0,0,0,0.12)]">
              <div className="mb-3 flex items-center gap-2">
                <span
                  className="material-symbols-outlined text-emerald-600 dark:text-emerald-400"
                  style={{ fontSize: "20px" }}
                >
                  verified
                </span>
                <h3 className="text-[15px] font-semibold text-[var(--foreground)] tracking-tight">
                  {status === "done"
                    ? "Execution complete"
                    : "Review and execute"}
                </h3>
              </div>
              {agentSession.summary && (
                <p className="mb-3 text-[12.5px] leading-relaxed text-slate-700 dark:text-slate-200">
                  {agentSession.summary}
                </p>
              )}
              {finalReasoning && status === "ready" && (
                <details className="mb-4 rounded-lg border border-[var(--border)]/50 bg-[var(--surface-2)]/40 px-3 py-2">
                  <summary className="cursor-pointer text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100">
                    <span
                      className="material-symbols-outlined align-middle mr-1"
                      style={{ fontSize: "13px" }}
                    >
                      psychology
                    </span>
                    Plan rationale
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap text-[11.5px] italic leading-relaxed text-slate-600 dark:text-slate-300">
                    {finalReasoning}
                  </p>
                </details>
              )}
              {localActions.length === 0 ? (
                <p className="py-6 text-center text-[12px] text-slate-600 dark:text-slate-300">
                  No actions proposed.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {localActions.map((a) => (
                    <AgentActionCard
                      key={a.id}
                      action={a}
                      onToggle={(s) => toggleAction(a.id, s)}
                      onEdit={(patch) => editAction(a.id, patch)}
                      result={agentSession.results?.[a.id]}
                      locked={status === "executing" || status === "done"}
                    />
                  ))}
                </div>
              )}

              {status === "ready" && (
                <div className="mt-5 flex items-center justify-between gap-2">
                  <div className="text-[11.5px] text-slate-600 dark:text-slate-400">
                    {localActions.filter((a) => a.selected).length} of{" "}
                    {localActions.length} selected
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setLocalActions((prev) =>
                          prev.map((a) => ({ ...a, selected: true })),
                        );
                      }}
                      className="cursor-pointer rounded-full border border-[var(--border)] px-3.5 py-1.5 text-[11.5px] font-medium text-slate-700 dark:text-slate-200 transition-colors hover:border-[var(--foreground)] hover:text-[var(--foreground)]"
                    >
                      Select all
                    </button>
                    <button
                      onClick={onExecute}
                      disabled={
                        executing ||
                        !localActions.some((a) => a.selected) ||
                        status !== "ready"
                      }
                      className="group cursor-pointer relative inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-1.5 text-[12px] font-semibold text-white shadow-[0_2px_8px_-2px_rgba(5,150,105,0.45)] transition-colors hover:bg-emerald-700 disabled:bg-emerald-900/55 disabled:text-white/90 disabled:shadow-none disabled:hover:bg-emerald-900/55"
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: "14px" }}
                      >
                        {executing ? "progress_activity" : "bolt"}
                      </span>
                      {executing ? "Executing..." : "Execute plan"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StepRow({
  step,
  showReasoning,
}: {
  step: ProgressStep;
  showReasoning?: boolean;
}) {
  const isDone = step.status === "done";
  const isRunning = step.status === "running";
  return (
    <li className="solve-fade-in">
      <div className="flex items-center gap-3 text-[12.5px]">
        <div
          className={`relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors ${
            isDone
              ? "bg-emerald-600 text-white"
              : isRunning
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                : "bg-[var(--surface-2)] text-[var(--muted)]"
          }`}
        >
          {isRunning && (
            <span
              className="absolute inset-0 rounded-full"
              style={{
                animation: "solvePulseRing 1.8s ease-out infinite",
                boxShadow: "0 0 0 0 rgba(5,150,105,0.35)",
              }}
            />
          )}
          <span
            className="material-symbols-outlined"
            style={{ fontSize: "13px" }}
          >
            {isDone ? "check" : step.icon}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <span
            className={`${
              isDone
                ? "text-slate-800/90 dark:text-slate-100/90"
                : isRunning
                  ? "text-slate-900 dark:text-slate-50"
                  : "text-slate-600 dark:text-slate-300"
            }`}
          >
            {step.label}
          </span>
          {step.detail && (
            <span className="ml-1.5 text-[var(--muted)]">· {step.detail}</span>
          )}
          {step.suffix && !step.detail && (
            <span className="ml-1.5 rounded-md bg-[var(--surface-2)] px-1.5 py-0.5 text-[10.5px] text-[var(--muted)]">
              {step.suffix}
            </span>
          )}
        </div>
        {isRunning && (
          <span className="text-[10.5px] font-medium text-emerald-600 dark:text-emerald-400">
            Working
          </span>
        )}
      </div>
      {showReasoning && step.reasoning && (
        <div className="ml-9 mt-1 rounded-md border border-[var(--border)]/40 bg-[var(--surface-2)]/40 px-2.5 py-1.5">
          <p className="whitespace-pre-wrap text-[11px] italic leading-snug text-[var(--muted)]">
            {step.reasoning}
          </p>
        </div>
      )}
    </li>
  );
}

// Kept in case we ever want to render raw turns — unused by default.
export function _TurnRowDebug({ turn }: { turn: AgentTurnRow }) {
  return <div>{turn.role}</div>;
}
