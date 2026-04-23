"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useApp } from "../AppShell";
import EmailDetail from "../EmailDetail";

type Todo = {
  id: string;
  text: string;
  is_completed: boolean;
  source: string;
  created_at: string;
  email_id?: string | null;
};

type EmailSuggestion = {
  emailId: string;
  task: string;
  emailSubject: string;
  emailSender: string;
  emailReceivedAt: string;
  category: string;
};

const CATEGORY_PRIORITY: Record<string, number> = {
  "action-required": 4,
  important: 3,
  informational: 2,
  newsletter: 1,
};

const CATEGORY_COLORS: Record<string, string> = {
  "action-required": "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  important: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  informational: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  newsletter: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
};

export default function TodosView() {
  const { user, addToast, search, getViewCache, setViewCache, liveChanges } = useApp();
  const supabase = createClient();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [newTodo, setNewTodo] = useState("");
  const [loading, setLoading] = useState(true);
  const [emailSuggestions, setEmailSuggestions] = useState<EmailSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(true);
  const [addedSuggestions, setAddedSuggestions] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"active" | "all" | "completed">("active");
  const [selectedEmail, setSelectedEmail] = useState<any | null>(null);

  const loadTodos = useCallback(async () => {
    const cached = getViewCache("todos");
    if (cached) {
      setTodos(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    const { data } = await supabase
      .from("todos")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(500);
    const result = (data || []) as Todo[];
    setTodos(result);
    setViewCache("todos", result);
    setLoading(false);
  }, [user.id, supabase]);

  const loadEmailSuggestions = useCallback(async () => {
    setLoadingSuggestions(true);
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

    // Join email_processed with emails to get date/sender, filter to last 3 days
    const { data } = await supabase
      .from("email_processed")
      .select("email_id, category, quick_actions, emails!inner(subject, sender, received_at)")
      .eq("user_id", user.id)
      .filter("emails.received_at", "gte", threeDaysAgo)
      .limit(100);

    if (!data) { setLoadingSuggestions(false); return; }

    const suggestions: EmailSuggestion[] = [];
    for (const row of data) {
      const email = (row as any).emails;
      if (!email) continue;
      const actions: any[] = Array.isArray(row.quick_actions) ? row.quick_actions : [];
      for (const qa of actions) {
        if (qa.action === "add_todo" && qa.label) {
          const task = qa.label.replace(/^Todo:\s*/i, "").trim();
          if (task) {
            suggestions.push({
              emailId: row.email_id,
              task,
              emailSubject: email.subject || "(no subject)",
              emailSender: (email.sender || "").replace(/<.*>/, "").trim(),
              emailReceivedAt: email.received_at,
              category: row.category || "informational",
            });
          }
        }
      }
    }

    // Sort: category priority DESC, then email date DESC
    suggestions.sort((a, b) => {
      const pa = CATEGORY_PRIORITY[a.category] ?? 0;
      const pb = CATEGORY_PRIORITY[b.category] ?? 0;
      if (pb !== pa) return pb - pa;
      return new Date(b.emailReceivedAt).getTime() - new Date(a.emailReceivedAt).getTime();
    });

    setEmailSuggestions(suggestions);
    setLoadingSuggestions(false);
  }, [user.id, supabase]);

  useEffect(() => {
    loadTodos();
    loadEmailSuggestions();
  }, [loadTodos, loadEmailSuggestions]);

  // Live updates: re-fetch todos when todos table changes
  const prevTodosChange = useRef(liveChanges.todos);
  useEffect(() => {
    if (liveChanges.todos !== prevTodosChange.current) {
      prevTodosChange.current = liveChanges.todos;
      loadTodos();
    }
  }, [liveChanges.todos, loadTodos]);

  // Live updates: re-fetch suggestions when new emails are processed
  const prevProcessedChange = useRef(liveChanges.email_processed);
  useEffect(() => {
    if (liveChanges.email_processed !== prevProcessedChange.current) {
      prevProcessedChange.current = liveChanges.email_processed;
      loadEmailSuggestions();
    }
  }, [liveChanges.email_processed, loadEmailSuggestions]);

  // Suggestions not yet added as todos (match by text)
  const pendingSuggestions = useMemo(() => {
    const todoTexts = new Set(todos.map((t) => t.text.toLowerCase()));
    return emailSuggestions.filter(
      (s) => !todoTexts.has(s.task.toLowerCase()) && !addedSuggestions.has(`${s.emailId}:${s.task}`)
    );
  }, [emailSuggestions, todos, addedSuggestions]);

  const addTodo = async (text: string, source = "manual", emailId?: string) => {
    if (!text.trim()) return;
    const { data } = await supabase
      .from("todos")
      .insert({ user_id: user.id, text: text.trim(), source, ...(emailId ? { email_id: emailId } : {}) })
      .select()
      .single();
    if (data) {
      setTodos((prev) => [data as Todo, ...prev]);
      addToast("success", "Task added");
    }
    setNewTodo("");
  };

  const addSuggestion = async (s: EmailSuggestion) => {
    await addTodo(s.task, "email", s.emailId);
    setAddedSuggestions((prev) => new Set([...prev, `${s.emailId}:${s.task}`]));
  };

  const openEmailById = useCallback(async (emailId: string) => {
    const { data } = await supabase
      .from("emails")
      .select("*, email_processed(*)")
      .eq("id", emailId)
      .single();
    if (data) setSelectedEmail(data);
  }, [supabase]);

  const dismissSuggestion = (s: EmailSuggestion) => {
    setAddedSuggestions((prev) => new Set([...prev, `${s.emailId}:${s.task}`]));
  };

  const toggleTodo = async (id: string, completed: boolean) => {
    await supabase.from("todos").update({ is_completed: !completed }).eq("id", id);
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, is_completed: !completed } : t)));
  };

  const deleteTodo = async (id: string) => {
    await supabase.from("todos").delete().eq("id", id);
    setTodos((prev) => prev.filter((t) => t.id !== id));
    addToast("info", "Task deleted");
  };

  const filtered = todos.filter((t) => {
    if (filter === "active" && t.is_completed) return false;
    if (filter === "completed" && !t.is_completed) return false;
    if (search.trim()) return t.text.toLowerCase().includes(search.toLowerCase());
    return true;
  });

  const activeCount = todos.filter((t) => !t.is_completed).length;
  const doneCount = todos.filter((t) => t.is_completed).length;

  const formatRelativeTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const h = Math.floor(diff / 3600000);
    if (h < 1) return "just now";
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };

  if (selectedEmail) {
    return (
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
    );
  }

  return (
    <div className="h-full flex overflow-hidden">

      {/* ── Left panel: Email suggestions ── */}
      <div className="w-80 xl:w-96 border-r border-[var(--border)] flex flex-col flex-shrink-0">
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <span className="material-symbols-outlined text-[var(--accent)]" style={{ fontSize: "16px" }}>auto_awesome</span>
            Suggested from Emails
          </h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">Last 3 days · {pendingSuggestions.length} pending</p>
        </div>

        <div className="flex-1 overflow-auto px-3 py-3 space-y-2">
          {loadingSuggestions ? (
            <div className="flex items-center justify-center h-24">
              <div className="animate-pulse text-[var(--muted)] text-xs">Loading…</div>
            </div>
          ) : pendingSuggestions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-[var(--muted)] px-4 text-center">
              <span className="material-symbols-outlined mb-2" style={{ fontSize: "32px" }}>task_alt</span>
              <p className="text-xs">No pending suggestions from recent emails</p>
            </div>
          ) : (
            pendingSuggestions.map((s, i) => (
              <div key={`${s.emailId}-${i}`} className="rounded-lg border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--surface-2)] px-2.5 py-2 group transition-colors">
                {/* Header row: category badge + time */}
                <div className="flex items-center justify-between mb-1">
                  <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full font-medium tracking-wide ${CATEGORY_COLORS[s.category] || "bg-slate-100 text-slate-500"}`}>
                    {s.category}
                  </span>
                  <span className="text-[10px] text-[var(--muted)]">{formatRelativeTime(s.emailReceivedAt)}</span>
                </div>

                {/* Full task text */}
                <p className="text-[12px] font-medium text-slate-900 dark:text-white leading-snug mb-1.5">
                  {s.task}
                </p>

                {/* Email context card */}
                <div
                  className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 mb-1.5 cursor-pointer hover:border-[var(--accent)]/50 transition-colors"
                  onClick={() => openEmailById(s.emailId)}
                  title="Open source email"
                >
                  <p className="text-[11px] font-medium text-slate-700 dark:text-slate-300 leading-snug truncate">
                    {s.emailSubject}
                  </p>
                  {s.emailSender && (
                    <p className="text-[10px] text-[var(--muted)] flex items-center gap-1">
                      <span className="material-symbols-outlined" style={{ fontSize: "11px" }}>person</span>
                      <span className="truncate">{s.emailSender}</span>
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => addSuggestion(s)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-[var(--accent)] text-white hover:opacity-90"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>add</span>
                    Add to tasks
                  </button>
                  <button
                    onClick={() => dismissSuggestion(s)}
                    className="flex items-center gap-0.5 px-2 py-1 rounded-lg text-xs text-[var(--muted)] hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Dismiss"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>close</span>
                    Dismiss
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Right panel: Todo list ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header + add input */}
        <div className="px-4 py-3 border-b border-[var(--border)] flex-shrink-0">
          <div className="flex items-center gap-3 mb-2.5">
            <h1 className="text-base font-bold text-slate-900 dark:text-white">My Tasks</h1>
            <span className="px-2 py-0.5 rounded-full bg-[var(--accent)] text-white text-xs font-medium">{activeCount} active</span>
            <span className="text-xs text-[var(--muted)]">{doneCount} done</span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={newTodo}
              onChange={(e) => setNewTodo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTodo(newTodo)}
              placeholder="Add a task…"
              className="flex-1 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
            />
            <button
              onClick={() => addTodo(newTodo)}
              disabled={!newTodo.trim()}
              className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex border-b border-[var(--border)] flex-shrink-0 px-4">
          {(["active", "all", "completed"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`py-2 px-3 text-xs font-medium border-b-2 transition-colors capitalize ${filter === f ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-[var(--muted)]"}`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Todo list */}
        <div className="flex-1 overflow-auto px-4 py-3 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-pulse text-[var(--muted)] text-sm">Loading…</div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-[var(--muted)] px-4">
              <span className="material-symbols-outlined mb-2" style={{ fontSize: "40px" }}>
                {filter === "completed" ? "check_circle" : "checklist"}
              </span>
              <p className="text-sm text-center">
                {filter === "completed" ? "No completed tasks" : "No active tasks. Add one or pick from email suggestions!"}
              </p>
            </div>
          ) : (
            filtered.map((t) => (
              <div
                key={t.id}
                className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5 transition-all group ${
                  t.is_completed
                    ? "border-[var(--border)] opacity-60"
                    : "border-[var(--border)] bg-[var(--background)] hover:bg-[var(--surface-2)]"
                }`}
              >
                <button
                  onClick={() => toggleTodo(t.id, t.is_completed)}
                  className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors cursor-pointer ${
                    t.is_completed
                      ? "bg-[var(--accent)] border-[var(--accent)]"
                      : "border-[var(--border)] hover:border-[var(--accent)]"
                  }`}
                  aria-label="Toggle todo"
                >
                  {t.is_completed && (
                    <span className="material-symbols-outlined text-white dark:text-[#202124]" style={{ fontSize: "10px", fontVariationSettings: "'FILL' 1" }}>check</span>
                  )}
                </button>
                <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                  <p className={`text-[12px] font-medium leading-snug ${t.is_completed ? "line-through text-[var(--muted)]" : "text-slate-900 dark:text-white"}`}>
                    {t.text}
                  </p>
                  {t.source !== "manual" && (
                    <span className="text-[10px] text-[var(--muted)] flex items-center gap-0.5">
                      <span className="material-symbols-outlined" style={{ fontSize: "10px" }}>mail</span>
                      from email
                    </span>
                  )}
                  {t.email_id && (
                    <button
                      onClick={() => openEmailById(t.email_id!)}
                      className="text-[10px] text-[var(--accent)] hover:underline flex items-center gap-0.5"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: "10px" }}>open_in_new</span>
                      view email
                    </button>
                  )}
                </div>
                <button
                  onClick={() => deleteTodo(t.id)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 text-red-400 transition-opacity shrink-0"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>delete</span>
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
