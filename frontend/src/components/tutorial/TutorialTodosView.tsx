"use client";

import { useEffect, useState } from "react";
import { MOCK_TODOS, type MockTodo } from "./mockData";

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffH = (now.getTime() - d.getTime()) / 3600000;
  if (diffH < 1) return `${Math.round(diffH * 60)}m ago`;
  if (diffH < 24) return `${Math.round(diffH)}h ago`;
  if (diffH < 48) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

type Props = {
  extraTodos: { id: string; text: string; source: string; email_id: string | null }[];
};

export default function TutorialTodosView({ extraTodos }: Props) {
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [newlyAdded, setNewlyAdded] = useState<Set<string>>(new Set());

  // Highlight newly added todos briefly
  useEffect(() => {
    if (extraTodos.length > 0) {
      const ids = new Set(extraTodos.map((t) => t.id));
      setNewlyAdded(ids);
      const t = setTimeout(() => setNewlyAdded(new Set()), 2500);
      return () => clearTimeout(t);
    }
  }, [extraTodos.length]);

  const allTodos: MockTodo[] = [
    ...extraTodos.map((t) => ({
      id: t.id,
      text: t.text,
      is_completed: false,
      source: t.source,
      created_at: new Date().toISOString(),
      email_id: t.email_id,
    })),
    ...MOCK_TODOS,
  ];

  const activeTodos = allTodos.filter((t) => !completed.has(t.id));
  const completedTodos = allTodos.filter((t) => completed.has(t.id));

  const toggle = (id: string) => {
    setCompleted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 max-w-2xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-xl bg-[var(--accent)] flex items-center justify-center">
          <span
            className="material-symbols-outlined text-white dark:text-[#202124]"
            style={{ fontSize: "18px", fontVariationSettings: "'FILL' 1" }}
          >
            checklist
          </span>
        </div>
        <div>
          <h1 className="text-[18px] font-bold text-[var(--foreground)]">Todos</h1>
          <p className="text-[12px] text-[var(--muted)]">{activeTodos.length} active tasks</p>
        </div>
      </div>

      {/* Active todos */}
      <div className="flex flex-col gap-2 mb-6">
        {activeTodos.map((todo) => {
          const isNew = newlyAdded.has(todo.id);
          return (
            <div
              key={todo.id}
              className={`flex items-start gap-3 rounded-xl border p-4 transition-all duration-300 ${
                isNew
                  ? "border-[var(--accent)] bg-[var(--accent-light)] shadow-md"
                  : "border-[var(--border)] bg-[var(--background)] hover:bg-[var(--surface-2)]"
              }`}
            >
              {isNew && (
                <div className="absolute -top-1 -left-1 w-2.5 h-2.5 rounded-full bg-[var(--accent)]" />
              )}
              <button
                onClick={() => toggle(todo.id)}
                className="mt-0.5 w-5 h-5 rounded-full border-2 border-[var(--border)] hover:border-[var(--accent)] transition-colors flex-shrink-0 cursor-pointer"
                aria-label="Complete todo"
              />
              <div className="flex-1 min-w-0">
                <p className={`text-[13px] font-medium leading-snug ${isNew ? "text-[var(--accent)]" : "text-[var(--foreground)]"}`}>
                  {todo.text}
                </p>
                {todo.source !== "manual" && (
                  <p className="text-[11px] text-[var(--muted)] mt-0.5 flex items-center gap-1">
                    <span className="material-symbols-outlined" style={{ fontSize: "11px" }}>mail</span>
                    {todo.source}
                  </p>
                )}
                {isNew && (
                  <p className="text-[11px] text-[var(--accent)] mt-0.5 font-medium">
                    Just added
                  </p>
                )}
              </div>
              <span className="text-[11px] text-[var(--muted)] shrink-0">
                {formatDate(todo.created_at)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Completed */}
      {completedTodos.length > 0 && (
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--muted)] mb-3">
            Completed ({completedTodos.length})
          </h3>
          <div className="flex flex-col gap-2 opacity-50">
            {completedTodos.map((todo) => (
              <div key={todo.id} className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3">
                <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-white" style={{ fontSize: "12px", fontVariationSettings: "'FILL' 1" }}>check</span>
                </div>
                <p className="text-[13px] text-[var(--muted)] line-through">{todo.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
