"use client";

import { useEffect, useState } from "react";

export type ToastItem = {
  id: string;
  type: "success" | "error" | "info";
  message: string;
  action?: { label: string; onClick: () => void };
  duration?: number;
};

function SingleToast({
  toast,
  onRemove,
}: {
  toast: ToastItem;
  onRemove: () => void;
}) {
  const duration = toast.duration ?? 3500;
  const [timeLeft, setTimeLeft] = useState(duration);

  useEffect(() => {
    const t = setTimeout(onRemove, duration);
    return () => clearTimeout(t);
  }, [onRemove, duration]);

  useEffect(() => {
    if (!toast.action) return;
    const interval = setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 100));
    }, 100);
    return () => clearInterval(interval);
  }, [toast.action]);

  const icons = { success: "check_circle", error: "error", info: "info" };
  const colors = {
    success:
      "bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-700 text-green-800 dark:text-green-300",
    error:
      "bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-700 text-red-800 dark:text-red-300",
    info: "bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-700 text-blue-800 dark:text-blue-300",
  };

  return (
    <div
      className={`pointer-events-auto flex items-center gap-2 px-4 py-2.5 rounded-lg border shadow-lg text-sm font-medium ${colors[toast.type]}`}
    >
      <span
        className="material-symbols-outlined shrink-0"
        style={{ fontSize: "18px" }}
      >
        {icons[toast.type]}
      </span>
      <span className="flex-1">{toast.message}</span>
      {toast.action && (
        <button
          onClick={() => { toast.action!.onClick(); onRemove(); }}
          className="shrink-0 text-xs font-semibold underline underline-offset-2 hover:opacity-80 ml-1"
        >
          {toast.action.label}
          {timeLeft > 0 && (
            <span className="ml-1 opacity-60 font-normal">({Math.ceil(timeLeft / 1000)}s)</span>
          )}
        </button>
      )}
      <button onClick={onRemove} className="opacity-60 hover:opacity-100 ml-1">
        <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
          close
        </span>
      </button>
    </div>
  );
}

export function ToastContainer({
  toasts,
  removeToast,
}: {
  toasts: ToastItem[];
  removeToast: (id: string) => void;
}) {
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 pointer-events-none max-w-sm">
      {toasts.map((t) => (
        <SingleToast key={t.id} toast={t} onRemove={() => removeToast(t.id)} />
      ))}
    </div>
  );
}
