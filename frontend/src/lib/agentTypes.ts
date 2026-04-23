/**
 * Shared types for the Solve-Everything (a.k.a. Auto-Resolve) agent.
 */

export type AgentStatus =
  | "idle"
  | "planning"
  | "asking"
  | "ready"
  | "executing"
  | "done"
  | "error"
  | "cancelled";

export type ActionType = "reply" | "todo" | "meeting" | "archive";

export type AgentBucket = "replies" | "meetings" | "todos" | "noise" | "single";

export interface AgentAction {
  id: string;
  type: ActionType;
  reasoning?: string;
  priority?: "high" | "medium" | "low";
  linked_email_id?: string;
  /** True when the chosen option in the originating question was the recommended one. */
  recommended?: boolean;
  /** Which bucket sub-agent produced this action, when running in parallel mode. */
  bucket?: AgentBucket;
  payload: {
    to?: string;
    subject?: string;
    body?: string;
    send_now?: boolean;
    /** For replies: skip draft/send entirely and just mark the source email resolved. */
    resolve_only?: boolean;
    title?: string;
    due?: string | null;
    meeting_title?: string;
    start_iso?: string;
    duration_mins?: number;
    attendees?: string[];
    include_zoom?: boolean;
    email_ids?: string[];
    summary?: string;
  };
  selected: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface QuestionOption {
  id: string;
  label: string;
  rationale?: string;
  preview?: string;
  /** When true, the agent is suggesting this as the best default choice. */
  recommended?: boolean;
  /**
   * When true, picking this option should NOT produce a reply — the thread is
   * just marked resolved (receipt confirmed). Populated by the server for
   * yes/no reply questions.
   */
  no_reply?: boolean;
}

export interface AgentQuestion {
  id: string;
  tool_call_id?: string;
  eyebrow: string;
  question: string;
  brief: string;
  options: QuestionOption[];
  allow_custom: boolean;
  related_email_id?: string | null;
  /** Optional bucket tag for grouping questions in the UI (from parallel sub-agents). */
  bucket?: AgentBucket;
}

export interface AgentSessionState {
  id: string;
  status: AgentStatus;
  draft_actions: AgentAction[];
  /** Legacy single-question field. Still populated for back-compat. */
  pending_question: AgentQuestion | null;
  /** Batched questions — when non-empty, render as a grid. */
  pending_questions?: AgentQuestion[];
  plan: {
    actions: AgentAction[];
    summary: string;
    finalized_at: string;
  } | null;
  results?: Record<
    string,
    { status: "success" | "error"; info?: string; error?: string }
  >;
  summary?: string | null;
  error?: string | null;
  updated_at?: string;
  briefing_at?: string | null;
  parent_id?: string | null;
  bucket?: AgentBucket | null;
}

export interface AgentTurnRow {
  id: string;
  session_id: string;
  idx: number;
  role: "system" | "user" | "assistant" | "tool" | "status";
  content: {
    content?: string | null;
    tool_calls?: {
      id: string;
      function: { name: string; arguments: string };
    }[];
    output?: string;
    text?: string;
  };
  tool_name: string | null;
  tool_call_id: string | null;
  /** MiniMax / OpenRouter reasoning trace for assistant turns, when available. */
  reasoning?: string | null;
  created_at: string;
}

export interface AgentAnswer {
  option_id?: string;
  custom_text?: string;
  skip?: boolean;
  not_sure?: boolean;
  /** Question id this answer is for when a batch of questions is open. */
  question_id?: string;
}

export interface AgentBatchAnswer {
  answers: AgentAnswer[];
}

/** TTS job state — stored in AppShell so audio keeps loading across navigation. */
export interface TtsJob {
  id: string;
  /** What we're reading — "briefing" | "email:<id>" etc. */
  kind: string;
  key: string;
  status:
    | "loading"
    | "buffered"
    | "playing"
    | "paused"
    | "error"
    | "done";
  audioBase64?: string;
  error?: string;
  startedAt: number;
}
