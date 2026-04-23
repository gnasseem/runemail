"use client";

import { useEffect, useState } from "react";

type Props = {
  title: string;
  body: string;
  visible: boolean;
  onDismiss?: () => void;
  /** CTA button label - if provided shows a button instead of "Next" */
  ctaLabel?: string;
  onCta?: () => void;
};

export default function TutorialAnnotation({
  title,
  body,
  visible,
  onDismiss,
  ctaLabel,
  onCta,
}: Props) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!visible) {
      setShow(false);
      return;
    }
    const t = setTimeout(() => setShow(true), 60);
    return () => clearTimeout(t);
  }, [visible]);

  if (!visible) return null;

  return (
    <>
      {/* Blurred backdrop */}
      <div
        className="fixed inset-0 z-[428]"
        style={{
          background: "rgba(0,0,0,0.45)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          opacity: show ? 1 : 0,
          transition: "opacity 0.2s ease",
          pointerEvents: onDismiss ? "auto" : "none",
        }}
        onClick={onDismiss}
      />

      {/* Centered card */}
      <div
        className="fixed z-[429] pointer-events-none"
        style={{
          top: "50%",
          left: "50%",
          width: 320,
          transform: show
            ? "translate(-50%, -50%) scale(1)"
            : "translate(-50%, -48%) scale(0.95)",
          opacity: show ? 1 : 0,
          transition: "opacity 0.22s ease, transform 0.28s cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        <div
          className="relative rounded-2xl border border-[var(--border)] shadow-2xl p-5 pointer-events-auto overflow-hidden"
          style={{ background: "var(--background)" }}
        >
          {/* Accent bar */}
          <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl bg-[var(--accent)]" />

          {/* Header */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <span
                className="material-symbols-outlined text-[var(--accent)] shrink-0"
                style={{ fontSize: "15px", fontVariationSettings: "'FILL' 1" }}
              >
                auto_awesome
              </span>
              <p className="text-[13px] font-bold text-[var(--foreground)] leading-tight">{title}</p>
            </div>
            {onDismiss && !ctaLabel && (
              <button
                onClick={onDismiss}
                className="shrink-0 -mt-0.5 -mr-0.5 p-0.5 rounded text-[var(--muted)] hover:text-[var(--foreground)] transition-colors cursor-pointer"
                aria-label="Dismiss"
              >
                <span className="material-symbols-outlined" style={{ fontSize: "15px" }}>close</span>
              </button>
            )}
          </div>

          {/* Body */}
          <p className="text-[13px] text-[var(--muted)] leading-relaxed">{body}</p>

          {/* CTA button */}
          {ctaLabel && onCta && (
            <button
              onClick={onCta}
              className="mt-4 w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--accent)] text-white dark:text-[#202124] text-[12px] font-semibold hover:opacity-90 active:scale-[0.97] transition-all cursor-pointer"
            >
              {ctaLabel}
              <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>arrow_forward</span>
            </button>
          )}

          {/* Next */}
          {onDismiss && !ctaLabel && (
            <button
              onClick={onDismiss}
              className="mt-4 w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--accent)] text-white dark:text-[#202124] text-[12px] font-semibold hover:opacity-90 active:scale-[0.97] transition-all cursor-pointer"
            >
              Next
              <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>arrow_forward</span>
            </button>
          )}
        </div>
      </div>
    </>
  );
}
