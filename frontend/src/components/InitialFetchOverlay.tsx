"use client";

import { useEffect, useState } from "react";

type Phase = { label: string; pct: number };

const INITIAL_PHASES: Phase[] = [
  { label: "Connecting to Gmail…", pct: 8 },
  { label: "Fetching your emails…", pct: 28 },
  { label: "Analysing emails, extracting actions & generating briefing…", pct: 85 },
  { label: "All done!", pct: 100 },
];

const REFRESH_PHASES: Phase[] = [
  { label: "Connecting to Gmail…", pct: 10 },
  { label: "Fetching new emails…", pct: 30 },
  { label: "Syncing & analysing emails…", pct: 85 },
  { label: "All done!", pct: 100 },
];

type Props = {
  phaseIndex: number;
  mode?: "initial" | "refresh";
  onStartTutorial?: () => void;
};

export default function InitialFetchOverlay({ phaseIndex, mode = "initial", onStartTutorial }: Props) {
  const PHASES = mode === "refresh" ? REFRESH_PHASES : INITIAL_PHASES;
  const [displayPct, setDisplayPct] = useState(0);
  const [showTutorialCta, setShowTutorialCta] = useState(false);
  const target = PHASES[Math.min(phaseIndex, PHASES.length - 1)].pct;
  const label = PHASES[Math.min(phaseIndex, PHASES.length - 1)].label;
  const isDone = phaseIndex >= PHASES.length - 1;

  // Show the tutorial CTA after phase 1 (after "Connecting to Gmail" passes)
  useEffect(() => {
    if (mode === "initial" && phaseIndex >= 1 && onStartTutorial) {
      const t = setTimeout(() => setShowTutorialCta(true), 800);
      return () => clearTimeout(t);
    }
  }, [phaseIndex, mode, onStartTutorial]);

  // Smoothly animate the bar toward target
  useEffect(() => {
    const id = setInterval(() => {
      setDisplayPct((prev) => {
        if (prev >= target) return prev;
        return Math.min(prev + 1, target);
      });
    }, 18);
    return () => clearInterval(id);
  }, [target]);

  return (
    <div className="fixed inset-0 z-[250] flex flex-col items-center justify-center bg-[var(--background)]">
      {/* Logo */}
      <div className="mb-10 flex flex-col items-center gap-4">
        <div className="relative">
          <img
            src="/Logo.png"
            alt="RuneMail"
            style={{ width: 56, height: 56, borderRadius: 14, objectFit: "contain" }}
          />
          {!isDone && (
            <span
              className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-[var(--background)] flex items-center justify-center"
            >
              <span
                className="block w-2.5 h-2.5 rounded-full bg-[var(--accent)]"
                style={{ animation: "pulse 1.5s ease-in-out infinite" }}
              />
            </span>
          )}
        </div>

        <div className="text-center">
          <h1
            className="text-[22px] font-bold text-[var(--foreground)] mb-1.5"
            style={{ fontFamily: '"Syne", sans-serif', letterSpacing: "-0.03em" }}
          >
            {mode === "refresh" ? "Syncing RuneMail" : "Setting up RuneMail"}
          </h1>
          <p className="text-sm text-[var(--muted)]">
            {mode === "refresh" ? "Fetching everything fresh…" : "This only happens once. Grab a coffee."}
          </p>
        </div>
      </div>

      {/* Progress area */}
      <div className="w-80 space-y-4">
        {/* Bar */}
        <div
          className="h-1 rounded-full overflow-hidden"
          style={{ background: "var(--border)" }}
        >
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-none"
            style={{ width: `${displayPct}%`, transition: "width 0.06s linear" }}
          />
        </div>

        {/* Status row */}
        <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
          {!isDone ? (
            <span
              className="material-symbols-outlined text-[var(--accent)] shrink-0"
              style={{ fontSize: "16px", animation: "spin 1s linear infinite" }}
            >
              progress_activity
            </span>
          ) : (
            <span
              className="material-symbols-outlined text-[var(--accent)] shrink-0"
              style={{ fontSize: "16px" }}
            >
              check_circle
            </span>
          )}
          <span className="flex-1 truncate">{label}</span>
          <span
            className="font-mono text-xs tabular-nums text-[var(--accent)]"
          >
            {displayPct}%
          </span>
        </div>

        {/* Step dots */}
        <div className="flex gap-1 justify-center pt-1">
          {PHASES.map((_, i) => (
            <div
              key={i}
              className="rounded-full transition-all duration-300"
              style={{
                height: "3px",
                width: i < phaseIndex ? "16px" : i === phaseIndex ? "24px" : "4px",
                background:
                  i <= phaseIndex
                    ? "var(--accent)"
                    : "var(--border)",
                opacity: i === phaseIndex ? 0.8 : 1,
              }}
            />
          ))}
        </div>
      </div>

      {/* Tutorial CTA */}
      {showTutorialCta && onStartTutorial && (
        <div
          className="mt-10 w-80 rounded-2xl border border-[var(--border)] p-5 text-center"
          style={{
            background: "var(--background)",
            opacity: showTutorialCta ? 1 : 0,
            transition: "opacity 0.4s ease",
          }}
        >
          <p className="text-[13px] font-semibold text-[var(--foreground)] mb-1">
            This takes a minute.
          </p>
          <p className="text-[12px] text-[var(--muted)] mb-4">
            Explore RuneMail with a sample workspace while you wait.
          </p>
          <button
            onClick={onStartTutorial}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--accent)] text-white dark:text-[#202124] text-[13px] font-bold hover:opacity-90 active:scale-[0.98] transition-all cursor-pointer shadow-md"
          >
            Explore RuneMail
            <span className="material-symbols-outlined" style={{ fontSize: "16px", fontVariationSettings: "'FILL' 1" }}>
              arrow_forward
            </span>
          </button>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
