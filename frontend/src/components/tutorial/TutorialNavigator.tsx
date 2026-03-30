"use client";

import { useEffect, useState } from "react";

const CHAPTER_LABELS = [
  "",
  "AI Inbox",
  "Daily Briefing",
  "AI Assistant",
  "Tasks and Calendar",
  "Send and Track",
  "Labels and Tags",
];

type Props = {
  chapter: number;
  totalChapters: number;
  onNext: () => void;
  onPrev: () => void;
  onExit: () => void;
  canGoNext: boolean;
  canGoPrev: boolean;
};

export default function TutorialNavigator({
  chapter,
  totalChapters,
  onNext,
  onPrev,
  onExit,
  canGoNext,
  canGoPrev,
}: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 400);
    return () => clearTimeout(t);
  }, []);

  const isLast = chapter >= totalChapters - 1;

  return (
    <div
      className="fixed bottom-6 left-6 z-[410]"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(12px)",
        transition: "opacity 0.3s ease, transform 0.3s ease",
        pointerEvents: visible ? "all" : "none",
      }}
    >
      <div
        className="rounded-2xl border border-[var(--border)] shadow-xl px-3 py-2.5 flex flex-col gap-2"
        style={{
          background: "var(--background)",
          backdropFilter: "blur(12px)",
          minWidth: "210px",
        }}
      >
        {/* Step label */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-[var(--accent)] uppercase tracking-widest truncate">
            {`Chapter ${chapter} of ${totalChapters - 1}`}
          </span>
          <button
            onClick={onExit}
            className="text-[10px] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors shrink-0 cursor-pointer"
          >
            Exit
          </button>
        </div>

        {/* Chapter name */}
        <p className="text-[13px] font-semibold text-[var(--foreground)] leading-tight truncate">
          {CHAPTER_LABELS[chapter] ?? "Demo"}
        </p>

        {/* Progress dots */}
        <div className="flex items-center gap-1 pt-0.5">
          {Array.from({ length: totalChapters - 1 }).map((_, i) => {
            const idx = i + 1;
            return (
              <div
                key={idx}
                className="rounded-full transition-all duration-300"
                style={{
                  height: "4px",
                  width: idx === chapter ? "20px" : idx < chapter ? "12px" : "6px",
                  background: idx <= chapter ? "var(--accent)" : "var(--border)",
                  opacity: idx < chapter ? 0.45 : 1,
                }}
              />
            );
          })}
        </div>

        {/* Nav buttons */}
        <div className="flex items-center gap-1.5 pt-0.5">
          {canGoPrev && (
            <button
              onClick={onPrev}
              className="flex items-center gap-0.5 px-2.5 py-1.5 rounded-lg border border-[var(--border)] text-[11px] text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-2)] transition-all cursor-pointer"
            >
              <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>chevron_left</span>
              Back
            </button>
          )}
          {canGoNext && (
            <button
              onClick={onNext}
              className="flex-1 flex items-center justify-center gap-0.5 px-2.5 py-1.5 rounded-lg border border-[var(--border)] text-[11px] text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-2)] transition-all cursor-pointer"
            >
              {isLast ? "Done" : "Skip"}
              <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>chevron_right</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
