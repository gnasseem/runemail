"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useApp } from "../AppShell";

export default function ReceiptsView() {
  const { user, pendingReceipt, search, getViewCache, setViewCache, liveChanges } = useApp();
  const supabase = createClient();
  const [receipts, setReceipts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const filtered = useMemo(() => {
    if (!search.trim()) return receipts;
    const q = search.toLowerCase();
    return receipts.filter((r) =>
      (r.subject || "").toLowerCase().includes(q) || (r.recipient_email || "").toLowerCase().includes(q)
    );
  }, [receipts, search]);

  const loadReceipts = useCallback(async () => {
    const cached = getViewCache("receipts");
    if (cached) {
      setReceipts(cached);
      setLoading(false);
    }
    const { data } = await supabase
      .from("read_receipts")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200);
    const result = data || [];
    setReceipts(result);
    setViewCache("receipts", result);
    setLoading(false);
  }, [user.id, supabase]);

  useEffect(() => {
    loadReceipts();
  }, [loadReceipts]);

  // Optimistically prepend a just-created receipt
  useEffect(() => {
    if (!pendingReceipt) return;
    setReceipts((prev) => {
      if (prev.some((r) => r.id === pendingReceipt.id)) return prev;
      return [pendingReceipt, ...prev];
    });
  }, [pendingReceipt]);

  // Live updates: re-fetch when read_receipts table changes (via centralized realtime + visibility)
  const prevReceiptsChange = useRef(liveChanges.read_receipts);
  useEffect(() => {
    if (liveChanges.read_receipts !== prevReceiptsChange.current) {
      prevReceiptsChange.current = liveChanges.read_receipts;
      loadReceipts();
    }
  }, [liveChanges.read_receipts, loadReceipts]);

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">
          Read Receipts
        </h1>
        <button
          onClick={loadReceipts}
          className="p-1.5 rounded-lg hover:bg-[var(--bg-secondary)] text-[var(--muted)] hover:text-slate-900 dark:hover:text-white transition-colors"
          title="Refresh receipts"
        >
          <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>refresh</span>
        </button>
      </div>
      {loading ? (
        <p className="text-sm text-[var(--muted)]">Loading...</p>
      ) : receipts.length === 0 ? (
        <div className="text-center py-12 text-[var(--muted)]">
          <span
            className="material-symbols-outlined mb-2"
            style={{ fontSize: "48px" }}
          >
            mark_email_read
          </span>
          <p className="text-sm">
            No tracked emails yet. Enable read tracking when sending.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-[var(--muted)]">
          <span className="material-symbols-outlined mb-2" style={{ fontSize: "48px" }}>search_off</span>
          <p className="text-sm">No receipts match your search.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <div
              key={r.id}
              className="p-4 rounded-xl border border-[var(--border)]"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    {r.subject}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    To: {r.recipient_email}
                  </p>
                </div>
                <div className="text-right">
                  <div
                    className={`text-lg font-bold ${r.open_count > 0 ? "text-[var(--success)]" : "text-[var(--muted)]"}`}
                  >
                    {r.open_count}
                  </div>
                  <div className="text-[10px] text-[var(--muted)] uppercase">
                    opens
                  </div>
                </div>
              </div>
              {r.first_opened_at && (
                <p className="text-xs text-[var(--muted)] mt-2">
                  First opened: {new Date(r.first_opened_at).toLocaleString()}
                  {r.last_opened_at &&
                    r.last_opened_at !== r.first_opened_at && (
                      <>
                        {" "}
                        · Last: {new Date(r.last_opened_at).toLocaleString()}
                      </>
                    )}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
