/**
 * Client helpers for the Solve-Everything agent.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AgentSessionState,
  AgentAnswer,
  AgentAction,
  AgentTurnRow,
  AgentBatchAnswer,
} from "./agentTypes";

function apiUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/api";
}

async function authHeaders(
  supabase: SupabaseClient,
): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.access_token}`,
  };
}

function userTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Realtime and some API paths can surface `agent_sessions.error` as a plain
 * object. React would render that as "[object Object]".
 */
export function normalizeAgentSessionError(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message || "Error";
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.message === "string" && o.message.trim()) return o.message;
    if (typeof o.error === "string" && o.error.trim()) return o.error;
    try {
      return JSON.stringify(value);
    } catch {
      return "Unexpected error payload";
    }
  }
  return String(value);
}

function withNormalizedAgentSession(row: AgentSessionState): AgentSessionState {
  return {
    ...row,
    error: normalizeAgentSessionError((row as { error?: unknown }).error) as
      | string
      | null
      | undefined,
  } as AgentSessionState;
}

export async function startAgent(
  supabase: SupabaseClient,
): Promise<{ session_id: string }> {
  const headers = await authHeaders(supabase);
  const res = await fetch(`${apiUrl()}/agent/start`, {
    method: "POST",
    headers,
    body: JSON.stringify({ timezone: userTimezone() }),
  });
  if (!res.ok) throw new Error(`Agent start failed: ${res.status}`);
  return res.json();
}

export async function stepAgent(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<Partial<AgentSessionState> & { status: string }> {
  const headers = await authHeaders(supabase);
  const res = await fetch(`${apiUrl()}/agent/step`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      session_id: sessionId,
      timezone: userTimezone(),
    }),
  });
  if (!res.ok) throw new Error(`Agent step failed: ${res.status}`);
  return res.json();
}

export async function answerAgent(
  supabase: SupabaseClient,
  sessionId: string,
  answer: AgentAnswer,
): Promise<Partial<AgentSessionState> & { status: string }> {
  const headers = await authHeaders(supabase);
  const res = await fetch(`${apiUrl()}/agent/answer`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      session_id: sessionId,
      timezone: userTimezone(),
      ...answer,
    }),
  });
  if (!res.ok) throw new Error(`Agent answer failed: ${res.status}`);
  return res.json();
}

/**
 * Submit multiple batched question answers in a single request. The parent
 * session resumes once all affected buckets have been fed.
 */
export async function answerAgentBatch(
  supabase: SupabaseClient,
  sessionId: string,
  batch: AgentBatchAnswer,
): Promise<Partial<AgentSessionState> & { status: string }> {
  const headers = await authHeaders(supabase);
  const res = await fetch(`${apiUrl()}/agent/answer`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      session_id: sessionId,
      timezone: userTimezone(),
      answers: batch.answers,
    }),
  });
  if (!res.ok) throw new Error(`Agent answer batch failed: ${res.status}`);
  return res.json();
}

export async function executeAgent(
  supabase: SupabaseClient,
  sessionId: string,
  approved: AgentAction[],
): Promise<{
  results: Record<
    string,
    { status: "success" | "error"; info?: string; error?: string }
  >;
}> {
  const headers = await authHeaders(supabase);
  const res = await fetch(`${apiUrl()}/agent/execute`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      session_id: sessionId,
      timezone: userTimezone(),
      approved: approved.map((a) => ({
        id: a.id,
        type: a.type,
        payload: a.payload,
        reasoning: a.reasoning,
        linked_email_id: a.linked_email_id,
      })),
    }),
  });
  if (!res.ok) throw new Error(`Agent execute failed: ${res.status}`);
  return res.json();
}

export async function cancelAgent(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<void> {
  const headers = await authHeaders(supabase);
  await fetch(`${apiUrl()}/agent/cancel`, {
    method: "POST",
    headers,
    body: JSON.stringify({ session_id: sessionId }),
  });
}

export async function fetchSession(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<AgentSessionState | null> {
  const { data } = await supabase
    .from("agent_sessions")
    .select(
      "id, status, draft_actions, pending_question, pending_questions, plan, results, summary, error, updated_at, briefing_at, parent_id, bucket",
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (!data) return null;
  return withNormalizedAgentSession(data as AgentSessionState);
}

export async function fetchTurns(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<AgentTurnRow[]> {
  const { data } = await supabase
    .from("agent_turns")
    .select("*")
    .eq("session_id", sessionId)
    .order("idx", { ascending: true });
  return (data ?? []) as AgentTurnRow[];
}

/** Subscribe to session + turn updates via Supabase Realtime. */
export function subscribeAgent(
  supabase: SupabaseClient,
  sessionId: string,
  handlers: {
    onSession?: (session: AgentSessionState) => void;
    onTurn?: (turn: AgentTurnRow) => void;
  },
): () => void {
  const channel = supabase
    .channel(`agent_session_${sessionId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "agent_sessions",
        filter: `id=eq.${sessionId}`,
      },
      (payload) => {
        handlers.onSession?.(
          withNormalizedAgentSession(payload.new as AgentSessionState),
        );
      },
    )
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "agent_turns",
        filter: `session_id=eq.${sessionId}`,
      },
      (payload) => {
        handlers.onTurn?.(payload.new as AgentTurnRow);
      },
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
