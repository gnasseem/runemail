"use client";

type Props = {
  onConsent: () => void;
  onCancel: () => void;
};

export default function WebLLMConsentModal({ onConsent, onCancel }: Props) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md mx-4 bg-[var(--background)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-5 pb-0">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <span
                className="material-symbols-outlined text-amber-600 dark:text-amber-400"
                style={{ fontSize: "24px" }}
              >
                download
              </span>
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              Enable Local AI?
            </h2>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 pb-5 space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Local AI mode runs a language model{" "}
            <strong>entirely inside your browser</strong> for maximum privacy.
            No email data leaves your device.
          </p>

          <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <div className="flex items-start gap-2">
              <span
                className="material-symbols-outlined text-amber-600 dark:text-amber-400 mt-0.5"
                style={{ fontSize: "18px" }}
              >
                warning
              </span>
              <div className="text-sm text-amber-800 dark:text-amber-300">
                <p className="font-semibold mb-1">
                  Important: Large Download Required
                </p>
                <ul className="list-disc pl-4 space-y-1 text-xs">
                  <li>
                    The initial model download is approximately{" "}
                    <strong>4–6 GB</strong>
                  </li>
                  <li>
                    This will take several minutes depending on your connection
                    speed
                  </li>
                  <li>The model is cached locally after the first download</li>
                  <li>
                    Requires a modern browser with WebGPU support (Chrome 113+)
                  </li>
                  <li>
                    Your device needs at least <strong>4 GB of free RAM</strong>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <p className="text-xs text-[var(--muted)]">
            You can switch back to Cloud mode anytime in Settings without losing
            the downloaded model.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 px-5 py-4 border-t border-[var(--border)] bg-[var(--sidebar-bg)]">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border)] text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConsent}
            className="flex-1 px-4 py-2.5 rounded-xl bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Download & Enable
          </button>
        </div>
      </div>
    </div>
  );
}
