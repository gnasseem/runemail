"use client";
// v3
import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useApp } from "../AppShell";

export default function ScheduledView() {
  const { user, liveChanges, openCompose } = useApp();
  const supabase = createClient();
  const [scheduled, setScheduled] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadScheduled = useCallback(async () => {
    try {
      const { data, error: fetchErr } = await supabase
        .from("scheduled_emails")
        .select("*")
        .eq("user_id", user.id)
        .order("send_at", { ascending: true })
        .limit(200);
      if (fetchErr) throw fetchErr;
      setScheduled(data || []);
      setError(null);
    } catch {
      setError("Failed to load scheduled emails. Try reloading.");
    } finally {
      setLoading(false);
    }
  }, [user.id, supabase]);

  useEffect(() => { loadScheduled(); }, [loadScheduled]);

  // Live updates: re-fetch when scheduled_emails table changes
  const prevScheduledChange = useRef(liveChanges.scheduled_emails);
  useEffect(() => {
    if (liveChanges.scheduled_emails !== prevScheduledChange.current) {
      prevScheduledChange.current = liveChanges.scheduled_emails;
      loadScheduled();
    }
  }, [liveChanges.scheduled_emails, loadScheduled]);

  const cancelScheduled = async (id: string) => {
    await supabase
      .from("scheduled_emails")
      .update({ status: "cancelled" })
      .eq("id", id);
    setScheduled((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: "cancelled" } : s)),
    );
  };

  const statusColors: Record<string, string> = {
    pending: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    sent: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    cancelled: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  };

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-slate-900 dark:text-white mb-4">
        Scheduled Emails
      </h1>
      {error && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm flex items-center gap-2">
          <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>error</span>
          {error}
        </div>
      )}
      {loading ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : scheduled.length === 0 ? (
        <div className="text-center py-12 text-[var(--muted)]">
          <span
            className="material-symbols-outlined mb-2"
            style={{ fontSize: "48px" }}
          >
            schedule_send
          </span>
          <p className="text-sm">No scheduled emails.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {scheduled.map((s) => (
            <div
              key={s.id}
              onClick={() => {
                if (s.status === "pending") {
                  openCompose(undefined, { _scheduledId: s.id, ...s });
                }
              }}
              className={`p-4 rounded-xl border border-[var(--border)] flex items-center gap-3 ${s.status === "pending" ? "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" : ""}`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                  {s.subject}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  To: {s.to_addresses?.join(", ")} · Sends:{" "}
                  {new Date(s.send_at).toLocaleString()}
                </p>
              </div>
              <span
                className={`px-2 py-0.5 rounded text-xs font-medium ${statusColors[s.status]}`}
              >
                {s.status}
              </span>
              {s.status === "pending" && (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); openCompose(undefined, { _scheduledId: s.id, ...s }); }}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-xs font-medium"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>edit</span>
                    Edit
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); cancelScheduled(s.id); }}
                    className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500"
                    title="Cancel"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>close</span>
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
