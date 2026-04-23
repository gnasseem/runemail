"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useApp } from "../AppShell";
import DOMPurify from "dompurify";
import DateTimePicker from "../DateTimePicker";
import { measureEmailIframeBodyHeight } from "@/lib/emailIframe";

function SentEmailFrame({ html, isDark }: { html: string; isDark: boolean }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);
  const srcDoc = useMemo(() => {
    const lightCss = `<style>html,body{margin:0;padding:8px;box-sizing:border-box;min-height:0!important;height:auto!important;overflow-x:hidden}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;word-break:break-word;position:relative}img,table{max-width:100%!important;height:auto!important}</style>`;
    const darkCss = isDark
      ? `<style>html,body{background:#202124!important;color:#e5e7eb!important}a{color:#60a5fa}img{opacity:.85}</style>`
      : "";
    const safe = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    return `<base target="_blank">` + lightCss + darkCss + safe;
  }, [html, isDark]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    let detach: (() => void) | undefined;

    const bind = () => {
      const doc = iframe.contentDocument;
      const body = doc?.body;
      if (!body) return;

      const measureNow = () => {
        const b = iframe.contentDocument?.body;
        if (!b) return;
        setHeight(measureEmailIframeBodyHeight(b));
      };

      measureNow();
      requestAnimationFrame(measureNow);
      requestAnimationFrame(() => requestAnimationFrame(measureNow));
      const t1 = window.setTimeout(measureNow, 60);
      const t2 = window.setTimeout(measureNow, 280);
      const fontWait = doc.fonts?.ready?.then(measureNow);

      const roMeasure = () => requestAnimationFrame(measureNow);
      const ro = new ResizeObserver(roMeasure);
      ro.observe(body);
      const rootEl = iframe.contentDocument?.documentElement;
      if (rootEl) ro.observe(rootEl);
      const imgs = [...body.querySelectorAll("img")];
      imgs.forEach((img) => img.addEventListener("load", measureNow));
      detach = () => {
        window.clearTimeout(t1);
        window.clearTimeout(t2);
        void fontWait?.catch(() => {});
        ro.disconnect();
        imgs.forEach((img) => img.removeEventListener("load", measureNow));
      };
    };

    const onLoad = () => {
      detach?.();
      bind();
    };

    iframe.addEventListener("load", onLoad);

    return () => {
      iframe.removeEventListener("load", onLoad);
      detach?.();
    };
  }, [srcDoc]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      sandbox="allow-same-origin allow-popups"
      title="Email content"
      style={{ width: "100%", height, border: "none", display: "block" }}
    />
  );
}

function isoToDatetimeLocal(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SentView() {
  const { user, registerSyncFn, pendingSentEmail, search, liveChanges, theme } =
    useApp();
  const supabase = createClient();
  const [tab, setTab] = useState<"sent" | "scheduled">("sent");
  const [emails, setEmails] = useState<any[]>([]);
  const [scheduled, setScheduled] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<any | null>(null);
  const [selectedScheduled, setSelectedScheduled] = useState<any | null>(null);

  // Edit state for selected scheduled email
  const [editSubject, setEditSubject] = useState("");
  const [editTo, setEditTo] = useState("");
  const [editSendAt, setEditSendAt] = useState("");
  const [editBody, setEditBody] = useState("");
  const [saving, setSaving] = useState(false);

  const loadSent = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const { data, error: dbError } = await supabase
        .from("emails")
        .select(
          "id, subject, recipients, received_at, snippet, body_text, body_html, attachments",
        )
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
    const { data, error: dbError } = await supabase
      .from("scheduled_emails")
      .select("*")
      .eq("user_id", user.id)
      .order("send_at", { ascending: true });
    if (dbError) {
      setError("Could not load scheduled emails.");
      return;
    }
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

  const tabMountedRef = useRef(false);
  useEffect(() => {
    if (!tabMountedRef.current) { tabMountedRef.current = true; return; }
    if (tab === "sent") loadSent();
    else loadScheduled();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setTimeout(() => loadSent(), 2000);
  }, [pendingSentEmail]);

  // Populate edit fields whenever selected scheduled email changes
  useEffect(() => {
    if (selectedScheduled) {
      setEditSubject(selectedScheduled.subject || "");
      setEditTo((selectedScheduled.to_addresses || []).join(", "));
      setEditSendAt(isoToDatetimeLocal(selectedScheduled.send_at));
      const bodyText =
        selectedScheduled.body_text ||
        (selectedScheduled.body_html
          ? selectedScheduled.body_html
              .replace(/<br\s*\/?>/gi, "\n")
              .replace(/<[^>]+>/g, "")
              .trim()
          : "");
      setEditBody(bodyText);
    }
  }, [selectedScheduled?.id]);

  const cancelScheduled = async (id: string) => {
    await supabase
      .from("scheduled_emails")
      .update({ status: "cancelled" })
      .eq("id", id);
    const updated = (s: any) =>
      s.id === id ? { ...s, status: "cancelled" } : s;
    setScheduled((prev) => prev.map(updated));
    if (selectedScheduled?.id === id)
      setSelectedScheduled((prev: any) => ({ ...prev, status: "cancelled" }));
  };

  const saveScheduled = async () => {
    if (!selectedScheduled) return;
    setSaving(true);
    const toAddresses = editTo
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const sendAt = new Date(editSendAt).toISOString();
    const body_html = editBody.replace(/\n/g, "<br>");
    const updates = {
      subject: editSubject,
      to_addresses: toAddresses,
      send_at: sendAt,
      body_text: editBody,
      body_html,
    };
    await supabase
      .from("scheduled_emails")
      .update(updates)
      .eq("id", selectedScheduled.id);
    const updated = { ...selectedScheduled, ...updates };
    setScheduled((prev) =>
      prev.map((s) => (s.id === selectedScheduled.id ? updated : s)),
    );
    setSelectedScheduled(updated);
    setSaving(false);
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const scheduledStatusColors: Record<string, string> = {
    pending: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    sent: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    cancelled: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  };

  const hasRightContent =
    tab === "sent" ? !!selectedEmail : !!selectedScheduled;

  const filteredScheduled = scheduled.filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const bodyText = s.body_html ? s.body_html.replace(/<[^>]+>/g, " ") : "";
    return (
      (s.subject || "").toLowerCase().includes(q) ||
      (s.to_addresses || []).join(" ").toLowerCase().includes(q) ||
      bodyText.toLowerCase().includes(q)
    );
  });

  return (
    <div className="h-full flex overflow-hidden">
      {/* Left pane: list */}
      <div
        className={`flex flex-col border-r border-[var(--border)] flex-shrink-0 w-80 lg:w-96 ${hasRightContent ? "hidden md:flex" : "flex"}`}
      >
        <div className="px-3 py-2.5 border-b border-[var(--border)] flex flex-col gap-2 flex-shrink-0">
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setTab("sent");
                setSelectedEmail(null);
              }}
              className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${tab === "sent" ? "bg-[var(--accent-light)] text-[var(--accent)]" : "text-[var(--muted)] hover:bg-slate-100 dark:hover:bg-slate-800"}`}
            >
              Sent
            </button>
            <button
              onClick={() => {
                setTab("scheduled");
                setSelectedEmail(null);
              }}
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
                <div className="animate-pulse text-[var(--muted)] text-sm">
                  Loading...
                </div>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center h-48 px-4 text-center text-[var(--muted)]">
                <span
                  className="material-symbols-outlined mb-2 text-red-400"
                  style={{ fontSize: "40px" }}
                >
                  error_outline
                </span>
                <p className="text-sm text-red-500">{error}</p>
              </div>
            ) : emails.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-[var(--muted)] px-4">
                <span
                  className="material-symbols-outlined mb-2"
                  style={{ fontSize: "40px" }}
                >
                  send
                </span>
                <p className="text-sm text-center">No sent emails to show.</p>
              </div>
            ) : (
              emails
                .filter((e) => {
                  if (!search.trim()) return true;
                  const q = search.toLowerCase();
                  const bodyText = e.body_html
                    ? e.body_html.replace(/<[^>]+>/g, " ")
                    : e.body_text || "";
                  return (
                    (e.subject || "").toLowerCase().includes(q) ||
                    (e.recipients || "").toLowerCase().includes(q) ||
                    (e.snippet || "").toLowerCase().includes(q) ||
                    bodyText.toLowerCase().includes(q)
                  );
                })
                .map((e: any) => (
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
                      <p className="text-[10px] text-[var(--muted)] mt-0.5">
                        {formatDate(e.received_at)}
                      </p>
                    )}
                  </button>
                ))
            )
          ) : filteredScheduled.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-[var(--muted)] px-4">
              <span
                className="material-symbols-outlined mb-2"
                style={{ fontSize: "40px" }}
              >
                schedule_send
              </span>
              <p className="text-sm text-center">No scheduled emails.</p>
            </div>
          ) : (
            filteredScheduled.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedScheduled(s)}
                className={`w-full text-left px-3 py-2.5 border-b border-[var(--border)] hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${selectedScheduled?.id === s.id ? "bg-[var(--accent-light)] border-l-2 border-l-[var(--accent)]" : ""}`}
              >
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-slate-900 dark:text-white truncate flex-1">
                    {s.subject || "(no subject)"}
                  </p>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${scheduledStatusColors[s.status] || ""}`}
                  >
                    {s.status}
                  </span>
                </div>
                <p className="text-xs text-[var(--muted)] truncate mt-0.5">
                  To: {s.to_addresses?.join(", ")}
                </p>
                <p className="text-[10px] text-[var(--muted)] mt-0.5">
                  Sends: {new Date(s.send_at).toLocaleString()}
                </p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right pane */}
      <div
        className={`flex-1 overflow-hidden flex flex-col ${hasRightContent ? "flex" : "hidden md:flex"}`}
      >
        {tab === "scheduled" ? (
          selectedScheduled ? (
            <div className="flex-1 overflow-auto flex flex-col">
              {/* Header */}
              <div className="px-5 py-4 border-b border-[var(--border)] flex items-center gap-3 flex-shrink-0">
                <button
                  onClick={() => setSelectedScheduled(null)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 md:hidden shrink-0"
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: "20px" }}
                  >
                    arrow_back
                  </span>
                </button>
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white truncate">
                    {selectedScheduled.subject || "(no subject)"}
                  </h2>
                  <p className="text-xs text-[var(--muted)] mt-0.5">
                    To: {selectedScheduled.to_addresses?.join(", ")}
                  </p>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${scheduledStatusColors[selectedScheduled.status] || ""}`}
                >
                  {selectedScheduled.status}
                </span>
                {selectedScheduled.status === "pending" && (
                  <button
                    onClick={() => cancelScheduled(selectedScheduled.id)}
                    className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-400 shrink-0"
                    title="Cancel scheduled email"
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: "18px" }}
                    >
                      close
                    </span>
                  </button>
                )}
              </div>

              {selectedScheduled.status === "pending" ? (
                /* Edit form */
                <div className="flex-1 overflow-auto p-6">
                  <div className="w-full max-w-md mx-auto space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                        Subject
                      </label>
                      <input
                        type="text"
                        value={editSubject}
                        onChange={(e) => setEditSubject(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 text-slate-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                        To
                      </label>
                      <input
                        type="text"
                        value={editTo}
                        onChange={(e) => setEditTo(e.target.value)}
                        placeholder="Comma-separated emails"
                        className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 text-slate-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                        Send at
                      </label>
                      <DateTimePicker
                        value={editSendAt}
                        onChange={setEditSendAt}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                        Body
                      </label>
                      <textarea
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        rows={10}
                        className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 text-slate-900 dark:text-white resize-y"
                      />
                    </div>
                    <button
                      onClick={saveScheduled}
                      disabled={
                        saving ||
                        !editSubject.trim() ||
                        !editTo.trim() ||
                        !editSendAt
                      }
                      className="w-full px-4 py-2.5 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                      {saving ? (
                        <span
                          className="material-symbols-outlined animate-spin"
                          style={{ fontSize: "16px" }}
                        >
                          progress_activity
                        </span>
                      ) : (
                        <span
                          className="material-symbols-outlined"
                          style={{ fontSize: "16px" }}
                        >
                          save
                        </span>
                      )}
                      {saving ? "Saving..." : "Save changes"}
                    </button>
                  </div>
                </div>
              ) : (
                /* Read-only view for sent/failed/cancelled */
                <div className="p-5 space-y-3 max-w-xl">
                  <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                    <span
                      className="material-symbols-outlined text-[var(--muted)]"
                      style={{ fontSize: "16px" }}
                    >
                      schedule
                    </span>
                    {new Date(selectedScheduled.send_at).toLocaleString()}
                  </div>
                  {selectedScheduled.error_message && (
                    <p className="text-sm text-red-500">
                      {selectedScheduled.error_message}
                    </p>
                  )}
                  <div className="rounded-lg border border-[var(--border)] overflow-hidden mt-3">
                    {selectedScheduled.body_html ? (
                      <SentEmailFrame
                        html={selectedScheduled.body_html}
                        isDark={theme === "dark"}
                      />
                    ) : (
                      <p className="p-3 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                        {selectedScheduled.body_text || "(no content)"}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-[var(--muted)] gap-2">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: "56px" }}
              >
                schedule_send
              </span>
              <p className="text-sm">
                Select a scheduled email to view or edit
              </p>
            </div>
          )
        ) : selectedEmail ? (
          <div className="flex-1 overflow-auto flex flex-col">
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-start gap-3 flex-shrink-0">
              <button
                onClick={() => setSelectedEmail(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 md:hidden shrink-0"
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: "20px" }}
                >
                  arrow_back
                </span>
              </button>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-1">
                  {selectedEmail.subject || "(no subject)"}
                </h2>
                <p className="text-xs text-[var(--muted)]">
                  To: {selectedEmail.recipients}
                  {selectedEmail.received_at && (
                    <span className="ml-3">
                      {formatDate(selectedEmail.received_at)}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex-1 px-5 py-4">
              {selectedEmail.body_html ? (
                <SentEmailFrame
                  html={selectedEmail.body_html}
                  isDark={theme === "dark"}
                />
              ) : (
                <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                  {selectedEmail.body_text ||
                    selectedEmail.snippet ||
                    "(no content)"}
                </p>
              )}
            </div>
            {Array.isArray(selectedEmail.attachments) &&
              selectedEmail.attachments.length > 0 && (
                <div className="px-5 pb-4 flex-shrink-0 border-t border-[var(--border)]">
                  <p className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-2 pt-2.5">
                    Attachments ({selectedEmail.attachments.length})
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {(
                      selectedEmail.attachments as {
                        filename: string;
                        mime_type: string;
                        size: number;
                        attachment_id: string;
                      }[]
                    ).map((att, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)]"
                      >
                        <span
                          className="material-symbols-outlined text-[var(--muted)]"
                          style={{ fontSize: "15px" }}
                        >
                          {att.mime_type?.startsWith("image/")
                            ? "image"
                            : att.mime_type?.includes("pdf")
                              ? "picture_as_pdf"
                              : "attach_file"}
                        </span>
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium text-[var(--foreground)] truncate max-w-[160px]">
                            {att.filename}
                          </p>
                          <p className="text-[9px] text-[var(--muted)]">
                            {att.size > 1024 * 1024
                              ? `${(att.size / 1024 / 1024).toFixed(1)} MB`
                              : `${Math.ceil(att.size / 1024)} KB`}
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
            <span
              className="material-symbols-outlined"
              style={{ fontSize: "56px" }}
            >
              send
            </span>
            <p className="text-sm">Select a sent email to view</p>
          </div>
        )}
      </div>
    </div>
  );
}
