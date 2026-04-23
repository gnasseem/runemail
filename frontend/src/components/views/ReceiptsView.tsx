"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useApp } from "../AppShell";

export default function ReceiptsView() {
  const { user, pendingReceipt, search, getViewCache, setViewCache, liveChanges } = useApp();
  const supabase = createClient();
  const [receipts, setReceipts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"receipts" | "analytics">("receipts");

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

  // Analytics computations
  const analytics = useMemo(() => {
    if (receipts.length === 0) return null;
    const opened = receipts.filter((r) => r.open_count > 0);
    const openRate = Math.round((opened.length / receipts.length) * 100);
    const openTimes = opened
      .filter((r) => r.first_opened_at && r.created_at)
      .map((r) => (new Date(r.first_opened_at).getTime() - new Date(r.created_at).getTime()) / 3600000);
    const avgOpenHours = openTimes.length > 0 ? openTimes.reduce((a, b) => a + b, 0) / openTimes.length : null;
    const byHour: Record<number, number> = {};
    opened.forEach((r) => {
      if (r.first_opened_at) byHour[new Date(r.first_opened_at).getHours()] = (byHour[new Date(r.first_opened_at).getHours()] || 0) + 1;
    });
    const peakHour = Object.entries(byHour).sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0];
    const byRecipient: Record<string, { opens: number; emails: number }> = {};
    receipts.forEach((r) => {
      if (!byRecipient[r.recipient_email]) byRecipient[r.recipient_email] = { opens: 0, emails: 0 };
      byRecipient[r.recipient_email].emails++;
      if (r.open_count > 0) byRecipient[r.recipient_email].opens++;
    });
    const topRecipients = Object.entries(byRecipient)
      .sort((a, b) => b[1].opens - a[1].opens || b[1].emails - a[1].emails)
      .slice(0, 5);
    return { openRate, avgOpenHours, peakHour: peakHour ? parseInt(peakHour) : null, topRecipients, total: receipts.length, openedCount: opened.length };
  }, [receipts]);

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

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-[var(--surface-2)] rounded-xl p-1 w-fit">
        {(["receipts", "analytics"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${tab === t ? "bg-[var(--surface)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--foreground)]"}`}>{t}</button>
        ))}
      </div>

      {tab === "analytics" && (
        <div className="space-y-4">
          {!analytics || analytics.total === 0 ? (
            <p className="text-sm text-[var(--muted)]">No tracked emails yet. Send with read receipt enabled to see analytics.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Open rate", value: `${analytics.openRate}%`, icon: "open_in_new", color: "text-green-600 dark:text-green-400" },
                  { label: "Emails tracked", value: analytics.total, icon: "email", color: "text-[var(--accent)]" },
                  { label: "Opened", value: analytics.openedCount, icon: "visibility", color: "text-blue-600 dark:text-blue-400" },
                  { label: "Avg open time", value: analytics.avgOpenHours != null ? (analytics.avgOpenHours < 1 ? "<1h" : `${Math.round(analytics.avgOpenHours)}h`) : "N/A", icon: "schedule", color: "text-violet-600 dark:text-violet-400" },
                ].map((stat) => (
                  <div key={stat.label} className="bg-[var(--surface-2)] rounded-xl p-3 text-center">
                    <span className={`material-symbols-outlined block mb-1 ${stat.color}`} style={{ fontSize: "20px", fontVariationSettings: "'FILL' 1" }}>{stat.icon}</span>
                    <p className={`text-lg font-bold ${stat.color}`}>{stat.value}</p>
                    <p className="text-[10px] text-[var(--muted)] mt-0.5">{stat.label}</p>
                  </div>
                ))}
              </div>

              {analytics.peakHour != null && (
                <div className="bg-[var(--surface-2)] rounded-xl p-4 flex items-center gap-3">
                  <span className="material-symbols-outlined text-amber-500" style={{ fontSize: "24px", fontVariationSettings: "'FILL' 1" }}>wb_sunny</span>
                  <div>
                    <p className="text-sm font-semibold text-[var(--foreground)]">Best time to send</p>
                    <p className="text-xs text-[var(--muted)]">Recipients open your emails most often around <strong className="text-[var(--foreground)]">{analytics.peakHour === 0 ? 12 : analytics.peakHour > 12 ? analytics.peakHour - 12 : analytics.peakHour}:00{analytics.peakHour < 12 ? "am" : "pm"}</strong></p>
                  </div>
                </div>
              )}

              {analytics.topRecipients.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-2">Most responsive recipients</h3>
                  <div className="space-y-2">
                    {analytics.topRecipients.map(([email, stats]) => (
                      <div key={email} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-[var(--surface-2)]">
                        <span className="text-xs text-[var(--foreground)] flex-1 truncate">{email}</span>
                        <span className="text-xs text-[var(--muted)]">{stats.opens}/{stats.emails} opened</span>
                        <div className="w-16 bg-[var(--border)] rounded-full h-1.5">
                          <div className="bg-[var(--accent)] h-1.5 rounded-full" style={{ width: `${Math.round((stats.opens / stats.emails) * 100)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === "receipts" && (loading ? (
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
      ))}
    </div>
  );
}
