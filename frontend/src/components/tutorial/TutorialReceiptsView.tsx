"use client";

import { MOCK_RECEIPTS, type MockReceipt } from "./mockData";

function formatDate(iso: string | null) {
  if (!iso) return "Never";
  const d = new Date(iso);
  const now = new Date();
  const diffH = (now.getTime() - d.getTime()) / 3600000;
  if (diffH < 1) return `${Math.round(diffH * 60)}m ago`;
  if (diffH < 24) return `${Math.round(diffH)}h ago`;
  if (diffH < 48) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

type Props = {
  extraReceipts: MockReceipt[];
};

export default function TutorialReceiptsView({ extraReceipts }: Props) {
  const allReceipts = [...extraReceipts, ...MOCK_RECEIPTS];

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 max-w-2xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-xl bg-[var(--accent)] flex items-center justify-center">
          <span className="material-symbols-outlined text-white dark:text-[#202124]" style={{ fontSize: "18px", fontVariationSettings: "'FILL' 1" }}>mark_email_read</span>
        </div>
        <div>
          <h1 className="text-[18px] font-bold text-[var(--foreground)]">Read Receipts</h1>
          <p className="text-[12px] text-[var(--muted)]">Track when your emails are opened</p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {allReceipts.map((receipt) => {
          const opened = receipt.open_count > 0;
          return (
            <div
              key={receipt.id}
              className={`rounded-xl border p-4 ${
                opened
                  ? "border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/20"
                  : "border-[var(--border)] bg-[var(--background)]"
              }`}
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-[var(--foreground)] truncate">{receipt.subject}</p>
                  <p className="text-[11px] text-[var(--muted)] flex items-center gap-1 mt-0.5">
                    <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>person</span>
                    {receipt.recipient_email}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <div
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                      opened
                        ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
                        : "bg-[var(--surface-2)] text-[var(--muted)]"
                    }`}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: "13px", fontVariationSettings: "'FILL' 1" }}
                    >
                      {opened ? "visibility" : "visibility_off"}
                    </span>
                    {receipt.open_count} {receipt.open_count === 1 ? "open" : "opens"}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4 text-[11px] text-[var(--muted)]">
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>schedule</span>
                  First opened: <strong className={`ml-0.5 ${opened ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{formatDate(receipt.first_opened_at)}</strong>
                </span>
                {receipt.open_count > 1 && (
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>update</span>
                    Last: <strong className="ml-0.5">{formatDate(receipt.last_opened_at)}</strong>
                  </span>
                )}
                <span className="flex items-center gap-1 ml-auto">
                  Sent: {formatDate(receipt.created_at)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
