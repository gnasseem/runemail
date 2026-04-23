"use client";

import AssistantChat from "./AssistantChat";

export default function AssistantPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <>
      {/* Slide-out panel */}
      <div
        className={`fixed top-[52px] right-0 h-[calc(100%-52px)] w-[380px] bg-[var(--background)] border-l border-[var(--border)] shadow-2xl z-50 flex flex-col transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] shrink-0">
          <span
            className="material-symbols-outlined text-[var(--accent)]"
            style={{ fontSize: "20px" }}
          >
            assistant
          </span>
          <span className="font-medium text-sm text-slate-900 dark:text-white flex-1">
            Assistant
          </span>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-[var(--muted)] transition-colors"
          >
            <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
              close
            </span>
          </button>
        </div>

        <AssistantChat className="flex-1 min-h-0" visible={open} />
      </div>
    </>
  );
}
