"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import DOMPurify from "dompurify";
import {
  SCRIPTED_PROMPTS,
  getScriptedResponse,
  type ScriptedPrompt,
} from "./tutorialScripts";

type Message = {
  role: "user" | "assistant";
  content: string;
  actions?: ScriptedPrompt["actions"];
  streaming?: boolean;
};

const GREETING =
  "Hi Alex! I have full context of your inbox, todos, meetings, and contacts. I can search emails, draft replies, create meetings, manage tasks, and answer any questions. What can I help with today?";

type Props = {
  open: boolean;
  onClose: () => void;
  onAction?: (type: "todo" | "meeting" | "draft", label: string) => void;
};

export default function TutorialAssistantPanel({
  open,
  onClose,
  onAction,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: GREETING },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streamTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Reset when reopened
  useEffect(() => {
    if (open) {
      setMessages([{ role: "assistant", content: GREETING }]);
      setInput("");
      setShowSuggestions(true);
    }
  }, [open]);

  const streamResponse = useCallback(
    (scripted: ScriptedPrompt) => {
      const fullText = scripted.response;
      let index = 0;
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "",
          streaming: true,
          actions: scripted.actions,
        },
      ]);

      const tick = () => {
        index += Math.floor(Math.random() * 4) + 3; // 3-6 chars per tick
        if (index >= fullText.length) {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last.streaming) {
              updated[updated.length - 1] = {
                ...last,
                content: fullText,
                streaming: false,
              };
            }
            return updated;
          });
          setLoading(false);
          // Trigger actions
          if (scripted.actions) {
            for (const action of scripted.actions) {
              setTimeout(() => onAction?.(action.type, action.label), 600);
            }
          }
        } else {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last.streaming) {
              updated[updated.length - 1] = {
                ...last,
                content: fullText.slice(0, index),
              };
            }
            return updated;
          });
          streamTimerRef.current = setTimeout(tick, 12);
        }
      };

      // Typing indicator delay
      streamTimerRef.current = setTimeout(tick, 900);
    },
    [onAction],
  );

  const sendMessage = useCallback(
    (text: string) => {
      if (!text.trim() || loading) return;
      setInput("");
      setShowSuggestions(false);
      if (textareaRef.current) textareaRef.current.style.height = "auto";

      setMessages((prev) => [...prev, { role: "user", content: text }]);
      setLoading(true);

      const scripted = getScriptedResponse(text);
      if (scripted) {
        setTimeout(() => streamResponse(scripted), 400);
      } else {
        setLoading(false);
      }
    },
    [loading, streamResponse],
  );

  const handlePromptClick = (prompt: ScriptedPrompt) => {
    sendMessage(prompt.fullPrompt);
  };

  // Resize textarea
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  function renderMarkdown(text: string) {
    // Very basic markdown: bold, newlines, horizontal rule
    return text
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(
        /^---$/gm,
        '<hr style="border-color:var(--border);margin:8px 0">',
      )
      .replace(/\n/g, "<br>");
  }

  return (
    <div
      className={`fixed top-0 right-0 bottom-0 z-[405] flex flex-col border-l border-[var(--border)] shadow-2xl`}
      style={{
        width: "min(380px, 100vw)",
        background: "var(--background)",
        transform: open ? "translateX(0)" : "translateX(100%)",
        transition: "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[var(--accent)] flex items-center justify-center">
            <span
              className="material-symbols-outlined text-white dark:text-[#202124]"
              style={{ fontSize: "15px", fontVariationSettings: "'FILL' 1" }}
            >
              assistant
            </span>
          </div>
          <span className="text-[14px] font-bold text-[var(--foreground)]">
            AI Assistant
          </span>
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--accent-light)] text-[var(--accent)]">
            DEMO
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
          aria-label="Close assistant"
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: "18px" }}
          >
            close
          </span>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.role === "assistant" && (
              <div className="w-6 h-6 rounded-full bg-[var(--accent)] flex items-center justify-center shrink-0 mt-0.5 mr-2">
                <span
                  className="material-symbols-outlined text-white dark:text-[#202124]"
                  style={{
                    fontSize: "12px",
                    fontVariationSettings: "'FILL' 1",
                  }}
                >
                  assistant
                </span>
              </div>
            )}
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-[13px] leading-relaxed ${
                msg.role === "user"
                  ? "bg-[var(--accent)] text-white dark:text-[#202124] rounded-tr-sm"
                  : "bg-[var(--surface-2)] text-[var(--foreground)] rounded-tl-sm"
              }`}
            >
              {msg.role === "assistant" ? (
                <div
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(renderMarkdown(msg.content), {
                      USE_PROFILES: { html: true },
                    }),
                  }}
                />
              ) : (
                msg.content
              )}
              {msg.streaming && (
                <span className="inline-flex gap-0.5 ml-1 align-middle">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="w-1 h-1 rounded-full bg-[var(--muted)] inline-block"
                      style={{
                        animation: "pulse 1s ease-in-out infinite",
                        animationDelay: `${i * 0.15}s`,
                      }}
                    />
                  ))}
                </span>
              )}

              {/* Action chips */}
              {!msg.streaming && msg.actions && msg.actions.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-black/10 dark:border-white/10">
                  {msg.actions.map((action, j) => (
                    <span
                      key={j}
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold ${
                        action.type === "meeting"
                          ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"
                          : action.type === "todo"
                            ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
                            : "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400"
                      }`}
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{
                          fontSize: "11px",
                          fontVariationSettings: "'FILL' 1",
                        }}
                      >
                        {action.type === "meeting"
                          ? "event_available"
                          : action.type === "todo"
                            ? "check_circle"
                            : "edit"}
                      </span>
                      {action.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {loading && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-[var(--accent)] flex items-center justify-center shrink-0">
              <span
                className="material-symbols-outlined text-white dark:text-[#202124]"
                style={{ fontSize: "12px", fontVariationSettings: "'FILL' 1" }}
              >
                assistant
              </span>
            </div>
            <div className="bg-[var(--surface-2)] rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1 items-center">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-[var(--muted)] inline-block"
                  style={{
                    animation: "pulse 1s ease-in-out infinite",
                    animationDelay: `${i * 0.2}s`,
                  }}
                />
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Suggested prompts */}
      {showSuggestions && messages.length <= 1 && (
        <div className="px-4 pb-2 flex flex-col gap-2 shrink-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)] mb-1">
            Try a complex request:
          </p>
          {SCRIPTED_PROMPTS.map((prompt, i) => (
            <button
              key={i}
              onClick={() => handlePromptClick(prompt)}
              className="w-full text-left px-3 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--background)] hover:border-[var(--accent)] hover:bg-[var(--accent-light)] text-[11px] text-[var(--foreground)] leading-snug transition-all duration-150 cursor-pointer group"
            >
              <span
                className="material-symbols-outlined text-[var(--accent)] mr-1 align-middle group-hover:opacity-100 opacity-70"
                style={{ fontSize: "12px" }}
              >
                auto_awesome
              </span>
              {prompt.label}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="px-4 py-3 border-t border-[var(--border)] shrink-0">
        <div className="flex items-end gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 focus-within:border-[var(--accent)] transition-colors">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything about your inbox..."
            rows={1}
            className="flex-1 bg-transparent resize-none text-[13px] text-[var(--foreground)] placeholder:text-[var(--muted)] outline-none leading-relaxed"
            style={{ maxHeight: "120px" }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading}
            className="shrink-0 w-7 h-7 rounded-lg bg-[var(--accent)] text-white dark:text-[#202124] flex items-center justify-center hover:opacity-90 disabled:opacity-40 transition-all cursor-pointer disabled:cursor-not-allowed"
            aria-label="Send"
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: "15px", fontVariationSettings: "'FILL' 1" }}
            >
              send
            </span>
          </button>
        </div>
        <p className="text-[10px] text-[var(--muted)] text-center mt-1.5">
          Demo mode - responses are pre-scripted
        </p>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.75); }
        }
      `}</style>
    </div>
  );
}
