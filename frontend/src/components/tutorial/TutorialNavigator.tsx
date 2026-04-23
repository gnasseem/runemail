"use client";

import { useEffect, useState } from "react";

const CHAPTER_LABELS = [
  "",
  "AI Inbox",
  "Daily Briefing",
  "AI Assistant",
  "Todos",
  "Meetings",
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
    <>
      {/* Desktop: floating pill at bottom-center */}
      <div
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[410] hidden sm:block"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "translateX(-50%) translateY(0)" : "translateX(-50%) translateY(12px)",
          transition: "opacity 0.3s ease, transform 0.3s ease",
          pointerEvents: visible ? "all" : "none",
        }}
      >
        <div
          className="rounded-2xl border border-[var(--border)] shadow-xl px-3 py-2.5 flex flex-col gap-2"
          style={{
            background: "var(--background)",
            backdropFilter: "blur(12px)",
            width: "max-content",
            maxWidth: "calc(100vw - 2rem)",
          }}
        >
          {/* Step label + exit */}
          <div className="flex items-center justify-between gap-4">
            <span className="text-[11px] font-semibold text-[var(--accent)] uppercase tracking-widest truncate">
              {`Chapter ${chapter} of ${totalChapters - 1}`}
            </span>
            <button
              onClick={onExit}
              className="text-[10px] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors shrink-0 cursor-pointer"
            >
              Exit demo
            </button>
          </div>

          {/* Chapter name */}
          <p className="text-[13px] font-semibold text-[var(--foreground)] leading-tight">
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

          {/* Nav row */}
          <div className="flex items-center gap-2 pt-0.5">
            {canGoPrev && (
              <button
                onClick={onPrev}
                className="flex items-center gap-1 px-3 py-2.5 rounded-xl border border-[var(--border)] text-[13px] font-semibold text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-2)] transition-all cursor-pointer shrink-0"
              >
                <span className="material-symbols-outlined" style={{ fontSize: "15px" }}>arrow_back</span>
                Back
              </button>
            )}
            {canGoNext && (
              <button
                onClick={onNext}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--accent)] text-white dark:text-[#202124] text-[13px] font-semibold hover:opacity-90 active:scale-[0.97] transition-all cursor-pointer shadow-md"
              >
                {isLast ? "Finish tour" : "Next chapter"}
                <span className="material-symbols-outlined" style={{ fontSize: "15px" }}>arrow_forward</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Mobile: full-width bottom bar */}
      <div
        className="fixed bottom-0 left-0 right-0 z-[410] sm:hidden"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(100%)",
          transition: "opacity 0.3s ease, transform 0.3s ease",
          pointerEvents: visible ? "all" : "none",
        }}
      >
        <div
          className="border-t border-[var(--border)] px-4 pt-3 pb-safe-4"
          style={{ background: "var(--background)", paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        >
          {/* Top row: chapter label + exit */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-[var(--accent)] uppercase tracking-widest">
                {chapter}/{totalChapters - 1}
              </span>
              <span className="text-[13px] font-semibold text-[var(--foreground)]">
                {CHAPTER_LABELS[chapter] ?? "Demo"}
              </span>
            </div>
            <button
              onClick={onExit}
              className="text-[11px] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors cursor-pointer"
            >
              Exit
            </button>
          </div>

          {/* Progress dots */}
          <div className="flex items-center gap-1 mb-3">
            {Array.from({ length: totalChapters - 1 }).map((_, i) => {
              const idx = i + 1;
              return (
                <div
                  key={idx}
                  className="rounded-full flex-1 transition-all duration-300"
                  style={{
                    height: "3px",
                    background: idx <= chapter ? "var(--accent)" : "var(--border)",
                    opacity: idx < chapter ? 0.5 : 1,
                  }}
                />
              );
            })}
          </div>

          {/* Buttons */}
          <div className="flex items-center gap-2">
            {canGoPrev && (
              <button
                onClick={onPrev}
                className="flex items-center gap-1 px-4 py-2.5 rounded-xl border border-[var(--border)] text-[13px] font-semibold text-[var(--muted)] hover:bg-[var(--surface-2)] transition-all cursor-pointer shrink-0"
              >
                <span className="material-symbols-outlined" style={{ fontSize: "15px" }}>arrow_back</span>
                Back
              </button>
            )}
            {canGoNext && (
              <button
                onClick={onNext}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[var(--accent)] text-white dark:text-[#202124] text-[14px] font-semibold hover:opacity-90 active:scale-[0.98] transition-all cursor-pointer shadow-md"
              >
                {isLast ? "Finish tour" : "Next chapter"}
                <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>arrow_forward</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
