"use client";

import { useState, useRef, useEffect } from "react";
import { MOCK_DRAFT } from "./mockData";

const AI_DRAFT_BODY = `<p>Hi Marcus,</p>
<p>Thank you for sending over the renewal proposal. I've reviewed the terms and I'm genuinely excited about continuing our partnership - the growth you've driven with Horizon Labs has been impressive.</p>
<p>I'm aligned on the 3-year structure and the YoY pricing. On the dedicated CSM request: given your 340% usage growth, I think that's absolutely justified. I'd propose we structure it as a shared CSM covering your account with guaranteed SLA response times, with an option to move to dedicated at the 18-month mark based on usage benchmarks.</p>
<p>Happy to hop on a 30-minute call this week to finalize. I'll have my assistant send over some times.</p>
<p>Looking forward to continuing to build together.</p>
<p>Best,<br>Alex<br><em>Product Director, Horizon Labs</em></p>`;

type Props = {
  onClose: () => void;
  onSend: (subject: string, to: string, trackingEnabled: boolean) => void;
  initialTo?: string;
  initialSubject?: string;
};

export default function TutorialComposeModal({ onClose, onSend, initialTo, initialSubject }: Props) {
  const [to, setTo] = useState(initialTo ?? MOCK_DRAFT.to);
  const [subject, setSubject] = useState(initialSubject ?? MOCK_DRAFT.subject);
  const [body, setBody] = useState(MOCK_DRAFT.body_html);
  const [trackingEnabled, setTrackingEnabled] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Set body div content
  useEffect(() => {
    if (bodyRef.current && !bodyRef.current.innerHTML) {
      bodyRef.current.innerHTML = body;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAiDraft = () => {
    if (aiGenerating) return;
    setAiGenerating(true);
    let i = 0;
    const chars = AI_DRAFT_BODY;
    if (bodyRef.current) bodyRef.current.innerHTML = "";
    setBody("");

    const tick = () => {
      i += 8;
      if (i >= chars.length) {
        if (bodyRef.current) bodyRef.current.innerHTML = chars;
        setBody(chars);
        setAiGenerating(false);
      } else {
        if (bodyRef.current) bodyRef.current.innerHTML = chars.slice(0, i);
        setTimeout(tick, 18);
      }
    };
    setTimeout(tick, 200);
  };

  const handleSend = () => {
    setSending(true);
    setTimeout(() => {
      onSend(subject, to, trackingEnabled);
    }, 800);
  };

  return (
    <div className="fixed inset-0 z-[415] flex items-end justify-end sm:items-end sm:justify-end" style={{ pointerEvents: "none" }}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20" style={{ pointerEvents: "all" }} onClick={onClose} />

      {/* Modal - full-width bottom sheet on mobile, corner panel on desktop */}
      <div
        className="relative w-full sm:max-w-lg mb-0 mr-0 sm:rounded-t-2xl rounded-t-2xl border border-[var(--border)] shadow-2xl flex flex-col overflow-hidden"
        style={{
          height: "min(560px, 85vh)",
          background: "var(--background)",
          pointerEvents: "all",
        }}
      >
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
          <h3 className="text-[14px] font-bold text-[var(--foreground)]">New Message</h3>
          <div className="flex items-center gap-1">
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
              aria-label="Close"
            >
              <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>close</span>
            </button>
          </div>
        </div>

        {/* To */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] shrink-0">
          <span className="text-[12px] font-semibold text-[var(--muted)] w-8">To</span>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="flex-1 bg-transparent text-[13px] text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]"
            placeholder="recipient@email.com"
          />
        </div>

        {/* Subject */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] shrink-0">
          <span className="text-[12px] font-semibold text-[var(--muted)] w-8">Sub</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="flex-1 bg-transparent text-[13px] text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]"
            placeholder="Subject"
          />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div
            ref={bodyRef}
            contentEditable
            suppressContentEditableWarning
            className="min-h-full text-[13px] text-[var(--foreground)] leading-relaxed outline-none"
            onInput={(e) => setBody((e.target as HTMLDivElement).innerHTML)}
          />
        </div>

        {/* Bottom toolbar */}
        <div data-tour="compose-tracking" className="shrink-0 px-4 py-3 border-t border-[var(--border)] flex items-center gap-2 flex-wrap">
          {/* AI draft */}
          <button
            onClick={handleAiDraft}
            disabled={aiGenerating}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] text-[12px] font-medium text-[var(--foreground)] hover:bg-[var(--surface-2)] disabled:opacity-50 transition-all cursor-pointer"
          >
            <span
              className="material-symbols-outlined text-[var(--accent)]"
              style={{ fontSize: "14px", fontVariationSettings: "'FILL' 1", animation: aiGenerating ? "spin 1s linear infinite" : "none" }}
            >
              {aiGenerating ? "progress_activity" : "auto_awesome"}
            </span>
            {aiGenerating ? "Generating..." : "AI Draft"}
          </button>

          {/* Schedule */}
          <button
            onClick={() => setShowSchedule(!showSchedule)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] text-[12px] font-medium text-[var(--foreground)] hover:bg-[var(--surface-2)] transition-all cursor-pointer"
          >
            <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>schedule_send</span>
            Schedule
          </button>

          {/* Tracking toggle */}
          <button
            onClick={() => setTrackingEnabled(!trackingEnabled)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-all cursor-pointer ${
              trackingEnabled
                ? "border-[var(--accent)] bg-[var(--accent-light)] text-[var(--accent)]"
                : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-2)]"
            }`}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: "14px", fontVariationSettings: trackingEnabled ? "'FILL' 1" : "'FILL' 0" }}
            >
              {trackingEnabled ? "visibility" : "visibility_off"}
            </span>
            {trackingEnabled ? "Tracking on" : "Track opens"}
          </button>

          {/* Send */}
          <button
            onClick={handleSend}
            disabled={sending || !to.trim()}
            className="ml-auto flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[var(--accent)] text-white dark:text-[#202124] text-[12px] font-semibold hover:opacity-90 disabled:opacity-50 active:scale-[0.97] transition-all cursor-pointer"
          >
            {sending ? (
              <>
                <span className="material-symbols-outlined" style={{ fontSize: "14px", animation: "spin 1s linear infinite" }}>progress_activity</span>
                Sending...
              </>
            ) : (
              <>
                <span className="material-symbols-outlined" style={{ fontSize: "14px", fontVariationSettings: "'FILL' 1" }}>send</span>
                Send
              </>
            )}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
