"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentAction, AgentQuestion } from "@/lib/agentTypes";
import QuestionCard from "../solve/QuestionCard";
import AgentActionCard from "../solve/AgentActionCard";

type StepStatus = "done" | "running" | "queued";
interface Step {
  key: string;
  label: string;
  detail?: string;
  icon: string;
  status: StepStatus;
}
type Phase = "planning" | "asking" | "ready" | "executing" | "done";

const INITIAL_STEPS: Step[] = [
  {
    key: "s1",
    label: "Reading the briefing",
    icon: "inbox_customize",
    status: "queued",
  },
  {
    key: "s2",
    label: "Learning your voice",
    icon: "edit_note",
    status: "queued",
  },
  {
    key: "s3",
    label: "Reading thread",
    detail: "with Rachel Kim",
    icon: "mail",
    status: "queued",
  },
  {
    key: "s4",
    label: "Reading thread",
    detail: "with Marcus Webb",
    icon: "mail",
    status: "queued",
  },
  {
    key: "s5",
    label: "Checking your calendar",
    icon: "event_available",
    status: "queued",
  },
];

const QUESTION: AgentQuestion = {
  id: "q1",
  eyebrow: "MEETING WITH MARCUS",
  question: "When should we schedule the Vertex renewal call?",
  brief:
    "Marcus wants a 30 min call to discuss your counter-proposal. Your calendar has three open slots this week in your working hours.",
  options: [
    {
      id: "thu-2pm",
      label: "Thursday 2:00pm - 2:30pm",
      rationale:
        "Right before your IP signature deadline, keeps the close tight.",
      recommended: true,
    },
    {
      id: "fri-10am",
      label: "Friday 10:00am - 10:30am",
      rationale: "Early, but conflicts with the investor prep block.",
    },
    {
      id: "mon-3pm",
      label: "Monday 3:00pm - 3:30pm",
      rationale: "Later but keeps this week focused on Series B close.",
    },
  ],
  allow_custom: true,
};

const PROPOSED_ACTIONS: AgentAction[] = [
  {
    id: "a1",
    type: "reply",
    reasoning:
      "Answers Marcus' pricing question and confirms the call time you picked.",
    priority: "high",
    linked_email_id: "demo-email-3",
    payload: {
      to: "marcus.webb@vertex.com",
      subject: "Re: Contract renewal - 3-year proposal attached",
      body: "Hi Marcus,\n\nThanks for sending over the 3-year proposal. I'm ready to send our counter on term length and volume discount. Let's lock this in on Thursday at 2pm so we can move into paper quickly.\n\nI'll send the deck 30 minutes before. Looking forward to it.\n\nThanks,\nGeorge",
      send_now: true,
    },
    selected: true,
  },
  {
    id: "a2",
    type: "meeting",
    reasoning: "30-min slot you confirmed with Marcus for the renewal call.",
    priority: "high",
    payload: {
      meeting_title: "Vertex Labs renewal call - Marcus Webb",
      start_iso: "2026-04-23T14:00:00",
      duration_mins: 30,
      attendees: ["marcus.webb@vertex.com"],
      include_zoom: true,
    },
    selected: true,
  },
  {
    id: "a3",
    type: "todo",
    reasoning: "Legal deadline Thursday - this blocks the Series B close.",
    priority: "high",
    linked_email_id: "demo-email-4",
    payload: {
      title: "Sign IP Assignment Agreement",
      due: "2026-04-23",
    },
    selected: true,
  },
  {
    id: "a4",
    type: "archive",
    reasoning: "Newsletters and receipts with no action required.",
    priority: "low",
    payload: {
      email_ids: ["n1", "n2", "n3", "n4", "n5", "n6", "n7"],
      summary: "7 newsletters and receipts from this week",
    },
    selected: true,
  },
];

export default function TutorialSolveWorkspace({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("planning");
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [question, setQuestion] = useState<AgentQuestion | null>(null);
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [userAnswer, setUserAnswer] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const streamRef = useRef<HTMLDivElement>(null);

  const reset = () => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
    setPhase("planning");
    setSteps(INITIAL_STEPS);
    setQuestion(null);
    setActions([]);
    setUserAnswer(null);
  };

  // Run the initial "thinking" animation when opened.
  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    const schedule = (delay: number, fn: () => void) => {
      const id = setTimeout(fn, delay);
      timers.current.push(id);
    };

    setSteps((prev) =>
      prev.map((s, i) => (i === 0 ? { ...s, status: "running" } : s)),
    );

    // Sequentially complete steps 0..4
    const delays = [1100, 1400, 1500, 1600, 1400];
    let t = 0;
    for (let i = 0; i < 5; i++) {
      t += delays[i];
      const idx = i;
      schedule(t, () => {
        setSteps((prev) =>
          prev.map((s, j) =>
            j === idx
              ? { ...s, status: "done" }
              : j === idx + 1
                ? { ...s, status: "running" }
                : s,
          ),
        );
      });
    }

    // Surface the question
    schedule(t + 500, () => {
      setQuestion(QUESTION);
      setPhase("asking");
    });

    return () => {
      timers.current.forEach((id) => clearTimeout(id));
      timers.current = [];
    };
  }, [open]);

  const doneCount = steps.filter((s) => s.status === "done").length;

  // Autoscroll.
  useEffect(() => {
    const el = streamRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distance < 260) {
      requestAnimationFrame(() =>
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }),
      );
    }
  }, [phase, doneCount, actions.length, question]);

  const handleAnswer = (answer: {
    option_id?: string;
    custom_text?: string;
    not_sure?: boolean;
    skip?: boolean;
  }) => {
    // Record what the user picked in a friendly label
    let pick = "OK, using my suggestion";
    if (answer.option_id) {
      const opt = QUESTION.options.find((o) => o.id === answer.option_id);
      if (opt) pick = opt.label;
    } else if (answer.custom_text) {
      pick = answer.custom_text;
    } else if (answer.skip) {
      pick = "Skipped";
    }
    setUserAnswer(pick);
    setQuestion(null);
    setPhase("planning");

    // More progress + propose actions
    const followUp: Step[] = [
      {
        key: "s6",
        label: "Drafting reply",
        detail: "to Marcus Webb",
        icon: "send",
        status: "running",
      },
      {
        key: "s7",
        label: "Scheduling meeting",
        detail: "Thu 2:00pm",
        icon: "event",
        status: "queued",
      },
      {
        key: "s8",
        label: "Creating todo",
        detail: "IP agreement",
        icon: "task_alt",
        status: "queued",
      },
      {
        key: "s9",
        label: "Grouping newsletters",
        icon: "archive",
        status: "queued",
      },
    ];
    setSteps((prev) => [
      ...prev.map((s) => ({ ...s, status: "done" as const })),
      ...followUp,
    ]);

    const schedule = (delay: number, fn: () => void) => {
      const id = setTimeout(fn, delay);
      timers.current.push(id);
    };
    const stepDelays = [1100, 900, 800, 800];
    let t = 0;
    for (let i = 0; i < 4; i++) {
      t += stepDelays[i];
      const n = i;
      schedule(t, () =>
        setSteps((prev) =>
          prev.map((s, idx) =>
            idx === INITIAL_STEPS.length + n
              ? { ...s, status: "done" }
              : idx === INITIAL_STEPS.length + n + 1
                ? { ...s, status: "running" }
                : s,
          ),
        ),
      );
    }
    schedule(t + 400, () => {
      setActions(PROPOSED_ACTIONS);
      setPhase("ready");
    });
  };

  const toggleAction = (id: string, selected: boolean) => {
    setActions((prev) =>
      prev.map((a) => (a.id === id ? { ...a, selected } : a)),
    );
  };
  const editAction = (id: string, patch: Partial<AgentAction["payload"]>) => {
    setActions((prev) =>
      prev.map((a) =>
        a.id === id ? { ...a, payload: { ...a.payload, ...patch } } : a,
      ),
    );
  };
  const execute = () => {
    setPhase("executing");
    setTimeout(() => setPhase("done"), 1300);
  };

  const statusLabel = useMemo(() => {
    if (phase === "planning") return "Working in the background";
    if (phase === "asking") return "Needs your decision";
    if (phase === "ready") return "Plan ready for review";
    if (phase === "executing") return "Executing";
    return "All actions complete";
  }, [phase]);

  const statusTone =
    phase === "asking"
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-300/50 dark:border-amber-500/30"
      : phase === "ready" || phase === "done"
        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-300/50 dark:border-emerald-500/30"
        : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-300/40 dark:border-emerald-500/25";

  if (!open) return null;
  const canCancel =
    phase === "planning" || phase === "asking" || phase === "ready";

  return (
    <div
      className="fixed inset-0 z-[80] flex justify-end bg-slate-950/35 backdrop-blur-[3px] solve-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="solve-grain solve-panel-bg relative flex h-full w-full max-w-[min(880px,100%)] flex-col border-l border-[var(--border)] shadow-[0_20px_80px_-20px_rgba(0,0,0,0.45)]"
        role="dialog"
        aria-label="Auto-Resolve agent demo"
      >
        <div className="relative flex items-center justify-between border-b border-[var(--border)]/70 px-6 py-4">
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
              <h2 className="text-[18px] font-semibold leading-tight tracking-tight text-[var(--foreground)]">
                Auto-Resolve
                <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">
                  Demo
                </span>
              </h2>
              <div className="mt-1 flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] ${statusTone}`}
                >
                  {phase === "planning" && (
                    <span className="inline-flex solve-dot-wave">
                      <span />
                      <span />
                      <span />
                    </span>
                  )}
                  {phase !== "planning" && (
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: "12px" }}
                    >
                      {phase === "asking"
                        ? "help"
                        : phase === "ready"
                          ? "check_circle"
                          : phase === "done"
                            ? "done_all"
                            : "bolt"}
                    </span>
                  )}
                  {statusLabel}
                </span>
                <span className="text-[10.5px] text-[var(--muted)]">
                  {doneCount}/{steps.length} steps
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {canCancel && (
              <button
                onClick={onClose}
                className="cursor-pointer rounded-full border border-[var(--border)] px-3.5 py-1.5 text-[11.5px] font-medium text-[var(--muted)] transition-colors hover:border-red-400 hover:text-red-500"
              >
                Cancel plan
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

        <div className="relative h-[3px] w-full overflow-hidden bg-[var(--surface-2)]">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-500 transition-all duration-500"
            style={{
              width: `${Math.max(4, Math.round((doneCount / Math.max(steps.length, 1)) * 100))}%`,
            }}
          />
        </div>

        <div
          ref={streamRef}
          className="flex-1 overflow-auto px-6 py-5 scroll-smooth"
        >
          <div className="mb-5">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                Progress
              </span>
            </div>
            <ol className="space-y-1.5">
              {steps.slice(-6).map((step) => {
                const isDone = step.status === "done";
                const isRunning = step.status === "running";
                return (
                  <li
                    key={step.key}
                    className="solve-fade-in flex items-center gap-3 text-[12.5px]"
                  >
                    <div
                      className={`relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                        isDone
                          ? "bg-emerald-500/90 text-white"
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
                        className={
                          isDone
                            ? "text-[var(--foreground)]/85"
                            : isRunning
                              ? "text-[var(--foreground)]"
                              : "text-[var(--muted)]"
                        }
                      >
                        {step.label}
                      </span>
                      {step.detail && (
                        <span className="ml-1.5 text-[var(--muted)]">
                          · {step.detail}
                        </span>
                      )}
                    </div>
                    {isRunning && (
                      <span className="text-[10.5px] font-medium text-emerald-600 dark:text-emerald-400">
                        Working
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
            {userAnswer && (
              <p className="mt-3 pl-8 text-[12px] italic leading-snug text-[var(--muted)]">
                &ldquo;Got it — using {userAnswer.toLowerCase()}.&rdquo;
              </p>
            )}
          </div>

          {phase === "asking" && question && (
            <div className="my-5">
              <QuestionCard question={question} onAnswer={handleAnswer} />
            </div>
          )}

          {(phase === "ready" || phase === "executing" || phase === "done") && (
            <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur-sm p-5 solve-fade-in shadow-[0_8px_30px_-12px_rgba(0,0,0,0.12)]">
              <div className="mb-3 flex items-center gap-2">
                <span
                  className="material-symbols-outlined text-emerald-600 dark:text-emerald-400"
                  style={{ fontSize: "20px" }}
                >
                  verified
                </span>
                <h3 className="text-[15px] font-semibold tracking-tight text-[var(--foreground)]">
                  {phase === "done"
                    ? "Execution complete"
                    : "Review and execute"}
                </h3>
              </div>
              <p className="mb-4 text-[12.5px] leading-relaxed text-[var(--muted)]">
                Here&apos;s everything I&apos;ve staged. Uncheck anything you
                don&apos;t want, or tap Edit to tweak the details before
                executing.
              </p>
              <div className="space-y-2.5">
                {actions.map((a) => (
                  <AgentActionCard
                    key={a.id}
                    action={a}
                    onToggle={(s) => toggleAction(a.id, s)}
                    onEdit={(patch) => editAction(a.id, patch)}
                    result={
                      phase === "done"
                        ? { status: "success", info: "Completed" }
                        : undefined
                    }
                    locked={phase === "executing" || phase === "done"}
                  />
                ))}
              </div>
              {phase === "ready" && (
                <div className="mt-5 flex items-center justify-between gap-2">
                  <div className="text-[11.5px] text-[var(--muted)]">
                    {actions.filter((a) => a.selected).length} of{" "}
                    {actions.length} selected
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        setActions((prev) =>
                          prev.map((a) => ({ ...a, selected: true })),
                        )
                      }
                      className="cursor-pointer rounded-full border border-[var(--border)] px-3.5 py-1.5 text-[11.5px] font-medium text-[var(--muted)] transition-colors hover:border-[var(--foreground)] hover:text-[var(--foreground)]"
                    >
                      Select all
                    </button>
                    <button
                      onClick={execute}
                      disabled={!actions.some((a) => a.selected)}
                      className="cursor-pointer relative inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-1.5 text-[12px] font-semibold text-white shadow-[0_2px_8px_-2px_rgba(5,150,105,0.45)] transition-colors hover:bg-emerald-700 disabled:opacity-40 disabled:hover:bg-emerald-600"
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: "14px" }}
                      >
                        bolt
                      </span>
                      Execute plan
                    </button>
                  </div>
                </div>
              )}
              {phase === "done" && (
                <div className="mt-5 flex items-center justify-end">
                  <button
                    onClick={onClose}
                    className="cursor-pointer rounded-full bg-emerald-600 px-4 py-1.5 text-[12px] font-semibold text-white shadow-sm hover:bg-emerald-700 transition-colors"
                  >
                    Back to briefing
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
