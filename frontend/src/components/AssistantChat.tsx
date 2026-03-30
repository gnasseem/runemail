"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useApp } from "./AppShell";

type Action = { type: string; data: Record<string, unknown> };

type Message = {
  role: "user" | "assistant";
  content: string;
  actions?: Action[];
};

const MAX_MESSAGES = 16; // 8 exchanges max before suggesting reset
const GREETING = "Hi! I'm your email assistant. I can search emails, send messages, create meetings, manage todos, and answer questions about your inbox. What can I help with?";

export default function AssistantChat({ className, visible }: { className?: string; visible?: boolean }) {
  const { addToast, setView, notifySent } = useApp();
  const supabase = createClient();
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: GREETING },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevVisible = useRef(visible);

  // Reset conversation when panel is closed and reopened
  useEffect(() => {
    if (visible && !prevVisible.current) {
      setMessages([{ role: "assistant", content: GREETING }]);
      setInput("");
    }
    prevVisible.current = visible;
  }, [visible]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const resetConversation = useCallback(() => {
    setMessages([{ role: "assistant", content: "Starting fresh. What can I help with?" }]);
  }, []);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setLoading(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/api";

      // Build history (skip greeting, limit to recent messages for context window)
      const recentMessages = messages.slice(-12);
      const history = recentMessages.map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch(`${apiUrl}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ message: userMessage, history, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });

      if (!res.ok) throw new Error("Request failed");

      const data = await res.json();
      // Notify sent view for any emails sent by the assistant
      if (Array.isArray(data.actions)) {
        for (const action of data.actions) {
          if (action.type === "send_email") {
            notifySent({ to: action.data.to as string, subject: action.data.subject as string, body_html: "" });
          }
        }
      }
      setMessages((prev) => {
        const updated = [
          ...prev,
          { role: "assistant" as const, content: data.reply, actions: data.actions },
        ];
        // If conversation is getting long, add a hint
        if (updated.length >= MAX_MESSAGES) {
          return [
            ...updated,
            { role: "assistant" as const, content: "This conversation is getting long. You can start fresh anytime with the button below." },
          ];
        }
        return updated;
      });
    } catch {
      addToast("error", "Assistant failed to respond. Please try again.");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, I ran into an error. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`flex flex-col ${className ?? ""}`}>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg, i) => (
          <div
            key={`${msg.role}-${i}-${msg.content.slice(0, 16)}`}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div className="max-w-[85%] space-y-1.5">
              <div
                className={`px-3 py-2 rounded-xl text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-[var(--accent)] text-white rounded-br-sm"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white rounded-bl-sm"
                }`}
              >
                {msg.content}
              </div>
              {msg.actions?.map((action, j) => (
                <ActionChip
                  key={`action-${i}-${j}`}
                  action={action}
                  onViewDrafts={() => setView("drafts")}
                  onViewMeetings={() => setView("meetings")}
                  onViewSent={() => setView("sent")}
                  onViewTodos={() => setView("todos")}
                />
              ))}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm text-[var(--muted)] rounded-bl-sm flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
              Working on it...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* New conversation button (shown when conversation has messages) */}
      {messages.length > 2 && (
        <div className="px-3 pt-1">
          <button
            onClick={resetConversation}
            className="w-full text-xs py-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--accent)] hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors flex items-center justify-center gap-1"
          >
            <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
              refresh
            </span>
            New conversation
          </button>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-[var(--border)] p-3 flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder="Ask anything or tell me what to do..."
          rows={1}
          className="flex-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent text-sm focus:outline-none focus:border-[var(--accent)] resize-none overflow-y-auto leading-relaxed"
          style={{ minHeight: "38px", maxHeight: "160px" }}
          disabled={loading}
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          className="px-3 py-2 rounded-lg bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity shrink-0"
        >
          <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
            send
          </span>
        </button>
      </div>
    </div>
  );
}

function ActionChip({
  action,
  onViewDrafts,
  onViewMeetings,
  onViewSent,
  onViewTodos,
}: {
  action: Action;
  onViewDrafts: () => void;
  onViewMeetings: () => void;
  onViewSent: () => void;
  onViewTodos: () => void;
}) {
  if (action.type === "create_todo") {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-xs">
        <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
          check_circle
        </span>
        Todo created: {action.data.text as string}
      </div>
    );
  }
  if (action.type === "save_draft") {
    return (
      <button
        onClick={onViewDrafts}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 text-xs hover:opacity-80 transition-opacity"
      >
        <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
          draft
        </span>
        Draft saved. View in Drafts
      </button>
    );
  }
  if (action.type === "send_email") {
    return (
      <button
        onClick={onViewSent}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-xs hover:opacity-80 transition-opacity"
      >
        <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
          send
        </span>
        Email sent to {action.data.to as string}. View in Sent
      </button>
    );
  }
  if (action.type === "send_email_failed") {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-xs">
        <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
          error
        </span>
        Failed to send email
      </div>
    );
  }
  if (action.type === "create_meeting") {
    return (
      <button
        onClick={onViewMeetings}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 text-xs hover:opacity-80 transition-opacity"
      >
        <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
          event
        </span>
        Meeting created: {action.data.title as string}. View in Meetings
      </button>
    );
  }
  if (action.type === "create_meeting_failed") {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-xs">
        <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
          error
        </span>
        Failed to create meeting
      </div>
    );
  }
  if (action.type === "update_todo") {
    const isCompleted = action.data.is_completed === true;
    return (
      <button
        onClick={() => onViewTodos()}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-xs hover:opacity-80 transition-opacity"
      >
        <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
          {isCompleted ? "check_circle" : "edit"}
        </span>
        {isCompleted ? "Todo marked complete. View in Todos" : "Todo updated. View in Todos"}
      </button>
    );
  }
  if (action.type === "delete_todo") {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs">
        <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
          delete
        </span>
        Todo deleted
      </div>
    );
  }
  if (action.type === "update_meeting") {
    return (
      <button
        onClick={() => onViewMeetings()}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 text-xs hover:opacity-80 transition-opacity"
      >
        <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
          edit_calendar
        </span>
        Meeting updated. View in Meetings
      </button>
    );
  }
  if (action.type === "delete_meeting") {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs">
        <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
          event_busy
        </span>
        Meeting deleted
      </div>
    );
  }
  if (action.type === "delete_draft") {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs">
        <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
          delete
        </span>
        Draft deleted
      </div>
    );
  }
  if (action.type === "archive_email") {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs">
        <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
          archive
        </span>
        Email archived
      </div>
    );
  }
  if (action.type === "add_knowledge") {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 text-xs">
        <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
          psychology
        </span>
        Saved to knowledge base: {action.data.entity as string}
      </div>
    );
  }
  return null;
}
