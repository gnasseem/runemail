"use client";

import { useEffect, useState, useCallback } from "react";

type Props = {
  chapter: number;
  title: string;
  subtitle: string;
  visible: boolean;
  onContinue: () => void;
};

const CHAPTER_CONFIGS: Record<number, { icon: string; accent: string }> = {
  1: { icon: "inbox", accent: "from-indigo-600/20 to-violet-600/20" },
  2: { icon: "summarize", accent: "from-amber-600/20 to-orange-600/20" },
  3: { icon: "assistant", accent: "from-violet-600/20 to-purple-600/20" },
  4: { icon: "checklist", accent: "from-emerald-600/20 to-teal-600/20" },
  5: { icon: "edit", accent: "from-sky-600/20 to-blue-600/20" },
  6: { icon: "label", accent: "from-rose-600/20 to-pink-600/20" },
};

export default function TutorialChapterCard({ chapter, title, subtitle, visible, onContinue }: Props) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => setMounted(true));
    } else {
      setMounted(false);
    }
  }, [visible]);

  // Keyboard shortcut
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight") {
        e.preventDefault();
        onContinue();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visible, onContinue]);

  if (!visible) return null;

  const config = CHAPTER_CONFIGS[chapter] ?? { icon: "star", accent: "from-indigo-600/20 to-violet-600/20" };
  const chapterNum = String(chapter).padStart(2, "0");

  return (
    <div
      className="fixed inset-0 z-[420] flex items-center justify-center"
      style={{
        background: "rgba(0,0,0,0.72)",
        backdropFilter: "blur(4px)",
        opacity: mounted ? 1 : 0,
        transition: "opacity 0.25s ease",
      }}
      onClick={onContinue}
    >
      <div
        className="relative flex flex-col items-start max-w-lg w-full mx-4"
        style={{
          transform: mounted ? "translateY(0)" : "translateY(24px)",
          transition: "transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Gradient bg card */}
        <div className={`w-full rounded-3xl p-8 bg-gradient-to-br ${config.accent} border border-white/10`}
          style={{ background: `linear-gradient(135deg, var(--background) 0%, var(--background) 60%, rgba(99,102,241,0.08) 100%)`, borderColor: "var(--border)" }}>

          {/* Chapter number */}
          <div
            className="font-bold text-[var(--muted)] mb-2 select-none"
            style={{ fontSize: "80px", lineHeight: 1, letterSpacing: "-0.04em", opacity: 0.12 }}
          >
            {chapterNum}
          </div>

          {/* Icon + title */}
          <div className="flex items-center gap-3 mb-3 -mt-8">
            <div className="w-10 h-10 rounded-xl bg-[var(--accent)] flex items-center justify-center shadow-lg">
              <span className="material-symbols-outlined text-white dark:text-[#202124]" style={{ fontSize: "20px", fontVariationSettings: "'FILL' 1" }}>
                {config.icon}
              </span>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--accent)]">
                Chapter {chapter}
              </p>
            </div>
          </div>

          <h2
            className="font-bold text-[var(--foreground)] mb-3"
            style={{ fontSize: "28px", lineHeight: 1.15, letterSpacing: "-0.02em" }}
          >
            {title}
          </h2>

          <p className="text-[var(--muted)] text-[15px] leading-relaxed mb-6">
            {subtitle}
          </p>

          <button
            onClick={onContinue}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--accent)] text-white dark:text-[#202124] text-[13px] font-semibold hover:opacity-90 active:scale-[0.97] transition-all cursor-pointer shadow-lg"
          >
            Let me see it
            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
              arrow_forward
            </span>
          </button>

          <p className="mt-4 text-[11px] text-[var(--muted)] opacity-60">
            Click anywhere or press Enter to continue
          </p>
        </div>
      </div>
    </div>
  );
}
