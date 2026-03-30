"use client";

import { useEffect } from "react";

export type ToastItem = {
  id: string;
  type: "success" | "error" | "info";
  message: string;
};

function SingleToast({
  toast,
  onRemove,
}: {
  toast: ToastItem;
  onRemove: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onRemove, 3500);
    return () => clearTimeout(t);
  }, [onRemove]);

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
