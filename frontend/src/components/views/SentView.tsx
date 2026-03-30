"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useApp } from "../AppShell";
import DOMPurify from "dompurify";

function SentEmailFrame({ html, isDark }: { html: string; isDark: boolean }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);
  const srcDoc = useMemo(() => {
    const lightCss = `<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:8px;word-break:break-word}</style>`;
    const darkCss = isDark ? `<style>html,body{background:#202124!important;color:#e5e7eb!important}a{color:#60a5fa}img{opacity:.85}</style>` : "";
    const safe = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    return lightCss + darkCss + safe;
  }, [html, isDark]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const resize = () => {
      const doc = iframe.contentDocument;
      if (doc?.body) setHeight(doc.body.scrollHeight + 24);
    };
    iframe.addEventListener("load", resize);
    return () => iframe.removeEventListener("load", resize);
  }, [srcDoc]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      sandbox="allow-same-origin"
      title="Email content"
      style={{ width: "100%", height, border: "none", display: "block" }}
    />
  );
}

export default function SentView() {
  const { user, registerSyncFn, pendingSentEmail, search, liveChanges, theme } = useApp();
  const supabase = createClient();
  const [tab, setTab] = useState<"sent" | "scheduled">("sent");
  const [emails, setEmails] = useState<any[]>([]);
  const [scheduled, setScheduled] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<any | null>(null);

  const loadSent = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const { data, error: dbError } = await supabase
        .from("emails")
        .select("*")
        .eq("user_id", user.id)
        .contains("label_ids", ["SENT"])
        .order("received_at", { ascending: false })
        .limit(50);
      if (dbError) throw dbError;
      setEmails(data || []);
    } catch {
      setError("Could not load sent emails.");
    }
    setLoading(false);
  }, [user.id, supabase]);

  const loadScheduled = useCallback(async () => {
    const { data } = await supabase
      .from("scheduled_emails")
      .select("*")
      .eq("user_id", user.id)
      .order("send_at", { ascending: true });
    setScheduled(data || []);
  }, [user.id, supabase]);

  useEffect(() => {
    loadSent();
    loadScheduled();
  }, [loadSent, loadScheduled]);

  useEffect(() => {
    registerSyncFn(() => {
      loadSent();
      loadScheduled();
    });
  }, [registerSyncFn, loadSent, loadScheduled]);

  useEffect(() => {
    if (tab === "sent") loadSent();
    else loadScheduled();
  }, [tab]);

  // Live updates when scheduled_emails table changes
  const prevScheduledChange = useRef(liveChanges.scheduled_emails);
  useEffect(() => {
    if (liveChanges.scheduled_emails !== prevScheduledChange.current) {
      prevScheduledChange.current = liveChanges.scheduled_emails;
      loadScheduled();
    }
  }, [liveChanges.scheduled_emails, loadScheduled]);

  // Optimistically prepend a just-sent email, then refresh from DB
  useEffect(() => {
    if (!pendingSentEmail) return;
    // Map pendingSentEmail fields to DB schema shape for display
    const optimistic = {
      id: pendingSentEmail.id,
      subject: pendingSentEmail.subject,
      recipients: pendingSentEmail.to,
      body_html: pendingSentEmail.body_html,
      received_at: pendingSentEmail.date,
    };
    setEmails((prev) => {
      if (prev.some((e) => e.id === optimistic.id)) return prev;
      return [optimistic, ...prev];
    });
    // Refresh from DB after a short delay to get the real record
    setTimeout(() => loadSent(), 2000);
  }, [pendingSentEmail]);

  const cancelScheduled = async (id: string) => {
    await supabase.from("scheduled_emails").update({ status: "cancelled" }).eq("id", id);
    setScheduled((prev) => prev.map((s) => s.id === id ? { ...s, status: "cancelled" } : s));
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  };

  const scheduledStatusColors: Record<string, string> = {
    pending: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    sent: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    cancelled: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  };

  return (
    <div className="h-full flex overflow-hidden">
      {/* Left pane: list */}
      <div className={`flex flex-col border-r border-[var(--border)] flex-shrink-0 w-80 lg:w-96 ${selectedEmail ? "hidden md:flex" : "flex"}`}>
        <div className="px-3 py-2.5 border-b border-[var(--border)] flex flex-col gap-2 flex-shrink-0">
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setTab("sent"); setSelectedEmail(null); }}
              className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${tab === "sent" ? "bg-[var(--accent-light)] text-[var(--accent)]" : "text-[var(--muted)] hover:bg-slate-100 dark:hover:bg-slate-800"}`}
            >
              Sent
            </button>
            <button
              onClick={() => { setTab("scheduled"); setSelectedEmail(null); }}
              className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${tab === "scheduled" ? "bg-[var(--accent-light)] text-[var(--accent)]" : "text-[var(--muted)] hover:bg-slate-100 dark:hover:bg-slate-800"}`}
            >
              Scheduled
              {scheduled.filter((s) => s.status === "pending").length > 0 && (
                <span className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-[var(--accent)] text-white text-[9px]">
                  {scheduled.filter((s) => s.status === "pending").length}
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {tab === "sent" ? (
            loading ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-pulse text-[var(--muted)] text-sm">Loading...</div>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center h-48 px-4 text-center text-[var(--muted)]">
                <span className="material-symbols-outlined mb-2 text-red-400" style={{ fontSize: "40px" }}>error_outline</span>
                <p className="text-sm text-red-500">{error}</p>
              </div>
            ) : emails.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-[var(--muted)] px-4">
                <span className="material-symbols-outlined mb-2" style={{ fontSize: "40px" }}>send</span>
                <p className="text-sm text-center">No sent emails to show.</p>
              </div>
            ) : (
              emails.filter((e) => {
                if (!search.trim()) return true;
                const q = search.toLowerCase();
                const bodyText = e.body_html ? e.body_html.replace(/<[^>]+>/g, " ") : (e.body_text || "");
                return (
                  (e.subject || "").toLowerCase().includes(q) ||
                  (e.recipients || "").toLowerCase().includes(q) ||
                  (e.snippet || "").toLowerCase().includes(q) ||
                  bodyText.toLowerCase().includes(q)
                );
              }).map((e: any) => (
                <button
                  key={e.id}
                  onClick={() => setSelectedEmail(e)}
                  className={`w-full text-left px-3 py-2.5 border-b border-[var(--border)] hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${selectedEmail?.id === e.id ? "bg-[var(--accent-light)] border-l-2 border-l-[var(--accent)]" : ""}`}
                >
                  <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                    {e.subject || "(no subject)"}
                  </p>
                  <p className="text-xs text-[var(--muted)] truncate mt-0.5">
                    To: {e.recipients}
                  </p>
                  {e.received_at && (
                    <p className="text-[10px] text-[var(--muted)] mt-0.5">{formatDate(e.received_at)}</p>
                  )}
                </button>
              ))
            )
          ) : (
            scheduled.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-[var(--muted)] px-4">
                <span className="material-symbols-outlined mb-2" style={{ fontSize: "40px" }}>schedule_send</span>
                <p className="text-sm text-center">No scheduled emails.</p>
              </div>
            ) : (
              scheduled.filter((s) => {
                if (!search.trim()) return true;
                const q = search.toLowerCase();
                const bodyText = s.body_html ? s.body_html.replace(/<[^>]+>/g, " ") : "";
                return (
                  (s.subject || "").toLowerCase().includes(q) ||
                  (s.to_addresses || []).join(" ").toLowerCase().includes(q) ||
                  bodyText.toLowerCase().includes(q)
                );
              }).map((s) => (
                <div key={s.id} className="px-3 py-2.5 border-b border-[var(--border)] flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{s.subject}</p>
                    <p className="text-xs text-[var(--muted)] truncate">
                      To: {s.to_addresses?.join(", ")} · {new Date(s.send_at).toLocaleString()}
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${scheduledStatusColors[s.status] || ""}`}>
                    {s.status}
                  </span>
                  {s.status === "pending" && (
                    <button
                      onClick={() => cancelScheduled(s.id)}
                      className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-400 shrink-0"
                      title="Cancel"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>close</span>
                    </button>
                  )}
                </div>
              ))
            )
          )}
        </div>
      </div>

      {/* Right pane: email content */}
      <div className={`flex-1 overflow-hidden flex flex-col ${selectedEmail ? "flex" : "hidden md:flex"}`}>
        {selectedEmail ? (
          <div className="flex-1 overflow-auto flex flex-col">
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-start gap-3 flex-shrink-0">
              <button
                onClick={() => setSelectedEmail(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 md:hidden shrink-0"
              >
                <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>arrow_back</span>
              </button>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-1">
                  {selectedEmail.subject || "(no subject)"}
                </h2>
                <p className="text-xs text-[var(--muted)]">
                  To: {selectedEmail.recipients}
                  {selectedEmail.received_at && <span className="ml-3">{formatDate(selectedEmail.received_at)}</span>}
                </p>
              </div>
            </div>
            <div className="flex-1 px-5 py-4">
              {selectedEmail.body_html ? (
                <SentEmailFrame html={selectedEmail.body_html} isDark={theme === "dark"} />
              ) : (
                <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                  {selectedEmail.body_text || selectedEmail.snippet || "(no content)"}
                </p>
              )}
            </div>
            {Array.isArray(selectedEmail.attachments) && selectedEmail.attachments.length > 0 && (
              <div className="px-5 pb-4 flex-shrink-0 border-t border-[var(--border)]">
                <p className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-2 pt-2.5">
                  Attachments ({selectedEmail.attachments.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  {(selectedEmail.attachments as { filename: string; mime_type: string; size: number; attachment_id: string }[]).map((att, i) => (
                    <div key={i} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                      <span className="material-symbols-outlined text-[var(--muted)]" style={{ fontSize: "15px" }}>
                        {att.mime_type?.startsWith("image/") ? "image" : att.mime_type?.includes("pdf") ? "picture_as_pdf" : "attach_file"}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium text-[var(--foreground)] truncate max-w-[160px]">{att.filename}</p>
                        <p className="text-[9px] text-[var(--muted)]">
                          {att.size > 1024 * 1024 ? `${(att.size / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(att.size / 1024)} KB`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-[var(--muted)] gap-2">
            <span className="material-symbols-outlined" style={{ fontSize: "56px" }}>send</span>
            <p className="text-sm">Select a sent email to view</p>
          </div>
        )}
      </div>
    </div>
  );
}
