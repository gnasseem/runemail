"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useApp } from "./AppShell";
import { initWebLLM } from "@/lib/webllm";
import { emailGraph } from "@/lib/emailGraph";
import { EmailField, useContacts } from "./EmailAutocomplete";

type ComposeProps = {
  onClose: () => void;
  onMinimize: () => void;
  replyTo?: any;
  draft?: any;
};

interface Template {
  id: string;
  name: string;
  subject: string | null;
  body_html: string;
}

function getNow(): { date: string; time: string } {
  const now = new Date();
  const date = now.toISOString().split("T")[0];
  const h = String(now.getHours()).padStart(2, "0");
  const m = now.getMinutes() < 30 ? "00" : "30";
  return { date, time: `${h}:${m}` };
}

type WorkingHours = { start?: string; end?: string; days?: number[] } | null;

function getNextWorkingSlot(wh: WorkingHours): Date {
  const now = new Date();
  const days = wh?.days || [1, 2, 3, 4, 5];
  const [startH, startM] = (wh?.start || "09:00").split(":").map(Number);
  for (let d = 0; d <= 7; d++) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + d);
    candidate.setHours(startH, startM, 0, 0);
    if (!days.includes(candidate.getDay())) continue;
    if (candidate > now) return candidate;
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return tomorrow;
}

function isOutsideWorkingHours(isoStr: string, wh: WorkingHours): boolean {
  if (!isoStr || !wh) return false;
  const d = new Date(isoStr);
  const days = wh.days || [1, 2, 3, 4, 5];
  if (!days.includes(d.getDay())) return true;
  const [startH, startM] = (wh.start || "09:00").split(":").map(Number);
  const [endH, endM] = (wh.end || "17:00").split(":").map(Number);
  const mins = d.getHours() * 60 + d.getMinutes();
  return mins < startH * 60 + startM || mins >= endH * 60 + endM;
}


export default function ComposeModal({
  onClose,
  onMinimize,
  replyTo,
  draft,
}: ComposeProps) {
  const { user, profile, addToast, notifyDraftChange, notifySent, notifyReceipt, assistantOpen } = useApp();
  const supabase = createClient();
  const draftId = useRef(draft?.id ?? crypto.randomUUID());
  const [to, setTo] = useState(
    draft ? (draft.to_addresses || []).join(", ") : (replyTo?.sender_email || "")
  );
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [subject, setSubject] = useState(
    draft ? (draft.subject || "") : (replyTo ? (/^Re:/i.test(replyTo.subject || "") ? replyTo.subject : `Re: ${replyTo.subject}`) : ""),
  );
  const [body, setBody] = useState<string>(
    draft ? (draft.body_html || "") : (replyTo?._prefillBody || "")
  );
  const [sending, setSending] = useState(false);
  const [scheduleAt, setScheduleAt] = useState(draft?.send_at || "");
  const [trackOpens, setTrackOpens] = useState(false);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [saveTemplateName, setSaveTemplateName] = useState("");

  // Right side panel: 'meeting' | 'templates' | null
  const [rightPanel, setRightPanel] = useState<null | "meeting" | "templates">(null);
  const togglePanel = (panel: "meeting" | "templates") =>
    setRightPanel((prev) => (prev === panel ? null : panel));

  // Schedule send popup
  const [showSchedulePopup, setShowSchedulePopup] = useState(false);
  const _initSched = draft?.send_at ? new Date(draft.send_at) : null;
  const [schedDay, setSchedDay] = useState(_initSched ? String(_initSched.getDate()) : "");
  const [schedMonth, setSchedMonth] = useState(_initSched ? String(_initSched.getMonth() + 1) : "");
  const [schedYear, setSchedYear] = useState(_initSched ? String(_initSched.getFullYear()) : "");
  const [schedHour, setSchedHour] = useState(_initSched ? String(_initSched.getHours()).padStart(2, "0") : "");
  const [schedMin, setSchedMin] = useState(_initSched ? String(_initSched.getMinutes()).padStart(2, "0") : "");
  const schedDayRef = useRef<HTMLInputElement>(null);
  const schedMonthRef = useRef<HTMLInputElement>(null);
  const schedYearRef = useRef<HTMLInputElement>(null);
  const schedHourRef = useRef<HTMLInputElement>(null);
  const schedMinRef = useRef<HTMLInputElement>(null);

  const syncScheduleAt = (d: string, mo: string, y: string, h: string, mi: string) => {
    if (d && mo && y && h && mi) {
      // Construct as local time so the schedule respects the user's timezone.
      // Using the Date(year, monthIndex, day, hour, min) constructor interprets
      // values in local time, avoiding the UTC-parse bug from ISO strings.
      const localDate = new Date(
        parseInt(y, 10),
        parseInt(mo, 10) - 1,
        parseInt(d, 10),
        parseInt(h, 10),
        parseInt(mi, 10),
      );
      setScheduleAt(localDate.toISOString());
    } else {
      setScheduleAt("");
    }
  };

  // AI draft state
  const [generatingDraft, setGeneratingDraft] = useState(false);

  // Attachments
  const [attachments, setAttachments] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setAttachments((prev) => [...prev, ...files]);
    e.target.value = "";
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Meeting scheduler state (title & attendees derived from subject & to)
  const { date: nowDate, time: nowTime } = getNow();
  // meetingDate = "YYYY-MM-DD", meetingTime = "HH:MM" — derived from segmented inputs
  const [meetingDate, setMeetingDate] = useState(nowDate);
  const [meetingTime, setMeetingTime] = useState(nowTime);
  // Segmented inputs for meeting date/time
  const [mtgDay, setMtgDay] = useState(() => { const p = nowDate.split("-"); return p[2] || ""; });
  const [mtgMonth, setMtgMonth] = useState(() => { const p = nowDate.split("-"); return p[1] || ""; });
  const [mtgYear, setMtgYear] = useState(() => { const p = nowDate.split("-"); return p[0] || ""; });
  const [mtgHour, setMtgHour] = useState(() => nowTime.split(":")[0] || "");
  const [mtgMin, setMtgMin] = useState(() => nowTime.split(":")[1] || "");
  const mtgDayRef = useRef<HTMLInputElement>(null);
  const mtgMonthRef = useRef<HTMLInputElement>(null);
  const mtgYearRef = useRef<HTMLInputElement>(null);
  const mtgHourRef = useRef<HTMLInputElement>(null);
  const mtgMinRef = useRef<HTMLInputElement>(null);
  const syncMeetingAt = (d: string, mo: string, y: string, h: string, mi: string) => {
    if (d && mo && y.length === 4 && h && mi) {
      setMeetingDate(`${y}-${mo.padStart(2,"0")}-${d.padStart(2,"0")}`);
      setMeetingTime(`${h.padStart(2,"0")}:${mi.padStart(2,"0")}`);
    }
  };
  const [meetingDuration, setMeetingDuration] = useState("");
  const [meetingLocation, setMeetingLocation] = useState("");
  const [createZoomLink, setCreateZoomLink] = useState(false);

  const [gmailAccounts, setGmailAccounts] = useState<{ id: string; gmail_address: string }[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>(replyTo?.gmail_account_id || "");
  const { contacts, addContacts } = useContacts(user.id);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("email_templates")
        .select("id, name, subject, body_html")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (data) setTemplates(data);
    })();
    (async () => {
      const { data } = await supabase
        .from("gmail_accounts")
        .select("id, gmail_address")
        .eq("user_id", user.id)
        .eq("is_active", true);
      if (data) {
        setGmailAccounts(data as { id: string; gmail_address: string }[]);
        if (!selectedAccountId && data.length > 0) {
          setSelectedAccountId((data[0] as { id: string }).id);
        }
      }
    })();
  }, [user.id]);

  const applyTemplate = (t: Template) => {
    if (t.subject && !replyTo) setSubject(t.subject);
    setBody(t.body_html);
    setRightPanel(null);
    setShowSaveTemplate(false);
  };

  const saveAsTemplate = async () => {
    const name = saveTemplateName.trim();
    if (!name || !body) return;
    const { data } = await supabase
      .from("email_templates")
      .insert({ user_id: user.id, name, subject, body_html: body })
      .select("id, name, subject, body_html");
    if (data?.[0]) setTemplates((prev) => [data[0], ...prev]);
    setSaveTemplateName("");
    setShowSaveTemplate(false);
  };

  const deleteTemplate = async (id: string) => {
    await supabase.from("email_templates").delete().eq("id", id);
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  };

  const generateDraft = async () => {
    if (!body.trim()) {
      addToast("error", "Write your message intent first");
      return;
    }
    setGeneratingDraft(true);

    const aiMode = profile?.ai_mode || "cloud";

    // ── Local / Hybrid ──────────────────────────────────────────────────────
    if (aiMode === "local" || aiMode === "hybrid") {
      try {
        const ready = await initWebLLM();
        if (!ready) {
          if (aiMode === "local") {
            addToast("error", "WebLLM not loaded. Make sure local AI is initialized.");
            setGeneratingDraft(false);
            return;
          }
          // hybrid: fall through to cloud
        } else {
          const result = await emailGraph.invoke({
            task: "draft",
            userId: user.id,
            draftIntent: body,
            draftContext: {
              to,
              subject,
              senderName: profile?.display_name || "",
              replyTo: replyTo
                ? { subject: replyTo.subject, body: replyTo.body_text?.slice(0, 800) || "" }
                : undefined,
            },
          });

          if (result.draft) {
            setBody(result.draft);
            setGeneratingDraft(false);
            return;
          }

          if (aiMode === "local") {
            addToast("error", "Local AI could not generate a draft.");
            setGeneratingDraft(false);
            return;
          }
          // hybrid: fall through to cloud
        }
      } catch (err) {
        console.error("Local draft generation failed:", err);
        if (aiMode === "local") {
          addToast("error", "Local AI error generating draft.");
          setGeneratingDraft(false);
          return;
        }
      }
    }

    // ── Cloud ─────────────────────────────────────────────────────────────
    try {
      const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/api";
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${apiUrl}/draft-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          intent: body,
          subject,
          to,
          senderName: profile?.display_name || "",
          replyTo: replyTo ? { subject: replyTo.subject, body: replyTo.body_text?.slice(0, 1000) } : undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.draft) setBody(data.draft);
      } else {
        addToast("error", "Could not generate draft");
      }
    } catch {
      addToast("error", "Network error");
    }
    setGeneratingDraft(false);
  };

  // Auto-generate when opened via quick reply (body pre-filled, flag set)
  const hasAutoTriggered = useRef(false);
  useEffect(() => {
    if (replyTo?._autoGenerate && !hasAutoTriggered.current && body && to && subject) {
      hasAutoTriggered.current = true;
      generateDraft();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

const saveDraft = async () => {
    if (!body) return;
    const toAddresses = to.split(",").map((s: string) => s.trim()).filter(Boolean);
    await supabase.from("draft_emails").upsert({
      id: draftId.current,
      user_id: user.id,
      to_addresses: toAddresses,
      subject,
      body_html: body,
    }, { onConflict: "id" });
    notifyDraftChange();
    addToast("success", "Draft saved");
    onClose();
  };

  const createMeetingRecord = async () => {
    if (!meetingDate || !meetingTime || !meetingDuration) return;

    const durationMin = parseInt(meetingDuration, 10);
    if (isNaN(durationMin) || durationMin <= 0) { addToast("error", "Enter a valid meeting duration"); return; }
    const [yr, mo, dy] = meetingDate.split("-").map(Number);
    const [hr, mn] = meetingTime.split(":").map(Number);
    const startTime = new Date(yr, mo - 1, dy, hr, mn);
    const endTime = new Date(startTime.getTime() + durationMin * 60000);
    const attendees = to
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
    const title = subject || "Meeting";

    const meetingData: Record<string, unknown> = {
      user_id: user.id,
      title,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      attendees,
      location: meetingLocation || null,
      status: "proposed",
    };

    if (createZoomLink) {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/api";
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${apiUrl}/zoom/create-meeting`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({ topic: title, start_time: startTime.toISOString(), duration: durationMin }),
        });
        if (res.ok) {
          const zoom = await res.json();
          meetingData.zoom_link = zoom.join_url;
        }
      } catch (err) { console.error("[ComposeModal] Zoom creation:", err); addToast("info", "Could not create Zoom link"); }
    }

    try {
      const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/api";
      const { data: { session } } = await supabase.auth.getSession();
      const calRes = await fetch(`${apiUrl}/calendar/create-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          title,
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          attendees,
          location: meetingLocation || (meetingData.zoom_link as string) || "",
          description: `Scheduled from RuneMail`,
          sendUpdates: "all",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      if (calRes.ok) {
        const cal = await calRes.json();
        meetingData.calendar_event_id = cal.event_id;
      }
    } catch (err) { console.error("[ComposeModal] Calendar creation:", err); }

    await supabase.from("meetings").insert(meetingData);

    const startDt = new Date(`${meetingDate}T${meetingTime}`);
    const endDt = endTime;
    const dayName = startDt.toLocaleDateString("en-US", { weekday: "long" });
    const dateStr = startDt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const timeStr = startDt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    const endTimeStr = endDt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    const locationLine = meetingData.zoom_link
      ? `<a href="${meetingData.zoom_link}" style="color:#1a73e8;text-decoration:none">${meetingData.zoom_link}</a>`
      : meetingLocation || "";

    const meetingBlock = `
<div style="font-family:Google Sans,Roboto,Arial,sans-serif;max-width:600px;margin:20px 0">
  <table cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #dadce0;border-radius:8px;overflow:hidden">
    <tr>
      <td style="background:#1a73e8;padding:0;width:6px"></td>
      <td style="padding:24px 28px">
        <table cellpadding="0" cellspacing="0" style="width:100%">
          <tr>
            <td>
              <div style="font-size:22px;font-weight:400;color:#202124;margin-bottom:4px">${title}</div>
              <div style="font-size:13px;color:#5f6368;margin-bottom:20px">Invitation from Google Calendar</div>
            </td>
            <td style="text-align:right;vertical-align:top">
              <div style="display:inline-block;background:#f1f3f4;border-radius:4px;padding:8px 12px;text-align:center">
                <div style="font-size:11px;color:#5f6368;text-transform:uppercase;letter-spacing:.5px;font-weight:500">${startDt.toLocaleDateString("en-US",{month:"short"})}</div>
                <div style="font-size:28px;font-weight:400;color:#202124;line-height:1">${startDt.getDate()}</div>
              </div>
            </td>
          </tr>
        </table>
        <table cellpadding="0" cellspacing="0" style="width:100%">
          <tr>
            <td style="padding:8px 0;border-top:1px solid #e8eaed">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:20px;vertical-align:top;padding-top:1px">
                    <img src="https://ssl.gstatic.com/calendar/images/dynamiclogo_2020q4/calendar_20_2x.png" width="18" height="18" alt="" style="display:block" onerror="this.style.display='none'" />
                  </td>
                  <td style="padding-left:12px">
                    <div style="font-size:13px;color:#202124;font-weight:500">${dayName}, ${dateStr}</div>
                    <div style="font-size:13px;color:#5f6368">${timeStr} – ${endTimeStr} (${durationMin} min)</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          ${locationLine ? `
          <tr>
            <td style="padding:8px 0;border-top:1px solid #e8eaed">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:20px;vertical-align:top;padding-top:1px">
                    <span style="font-size:16px;color:#5f6368">📍</span>
                  </td>
                  <td style="padding-left:12px;font-size:13px;color:#202124">${locationLine}</td>
                </tr>
              </table>
            </td>
          </tr>` : ""}
          <tr>
            <td style="padding:16px 0 8px;border-top:1px solid #e8eaed">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:8px">
                    <a href="#" style="display:inline-block;padding:8px 20px;background:#1a73e8;color:#fff;border-radius:4px;font-size:13px;font-weight:500;text-decoration:none;font-family:Google Sans,Roboto,Arial,sans-serif">Accept</a>
                  </td>
                  <td style="padding-right:8px">
                    <a href="#" style="display:inline-block;padding:8px 20px;background:#fff;color:#1a73e8;border:1px solid #dadce0;border-radius:4px;font-size:13px;font-weight:500;text-decoration:none;font-family:Google Sans,Roboto,Arial,sans-serif">Maybe</a>
                  </td>
                  <td>
                    <a href="#" style="display:inline-block;padding:8px 20px;background:#fff;color:#1a73e8;border:1px solid #dadce0;border-radius:4px;font-size:13px;font-weight:500;text-decoration:none;font-family:Google Sans,Roboto,Arial,sans-serif">Decline</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>`;

    setBody((prev) => prev + meetingBlock);
  };

  const handleSend = async (bodyOverride?: string) => {
    if (!to || !subject) return;
    setSending(true);

    try {
      if (rightPanel === "meeting" && meetingDate && meetingDuration) {
        await createMeetingRecord();
      }

      const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/api";
      const { data: { session } } = await supabase.auth.getSession();
      const rawBody = bodyOverride || body;
      // Convert plain-text newlines to <br> for HTML email rendering
      const sendBody = rawBody.includes("<br") || rawBody.includes("<p") || rawBody.includes("<div")
        ? rawBody
        : rawBody.replace(/\n/g, "<br>");

      if (scheduleAt) {
        const { data: accounts } = await supabase
          .from("gmail_accounts")
          .select("id")
          .eq("user_id", user.id)
          .eq("is_active", true)
          .limit(1);
        if (!accounts?.length) {
          addToast("error", "Connect a Gmail account first");
          setSending(false);
          return;
        }
        if (draft?._scheduledId) {
          await supabase.from("scheduled_emails").update({
            gmail_account_id: accounts[0].id,
            to_addresses: to.split(",").map((s: string) => s.trim()),
            cc_addresses: cc ? cc.split(",").map((s: string) => s.trim()) : null,
            bcc_addresses: bcc ? bcc.split(",").map((s: string) => s.trim()) : null,
            subject,
            body_html: sendBody,
            send_at: scheduleAt,
            status: "pending",
          }).eq("id", draft._scheduledId);
        } else {
          await supabase.from("scheduled_emails").insert({
            user_id: user.id,
            gmail_account_id: accounts[0].id,
            to_addresses: to.split(",").map((s: string) => s.trim()),
            cc_addresses: cc ? cc.split(",").map((s: string) => s.trim()) : null,
            bcc_addresses: bcc ? bcc.split(",").map((s: string) => s.trim()) : null,
            subject,
            body_html: sendBody,
            send_at: scheduleAt,
            in_reply_to: replyTo?.gmail_id,
            thread_id: replyTo?.thread_id,
          });
        }
      } else {
        const attachmentData = await Promise.all(
          attachments.map(
            (file) =>
              new Promise<{ name: string; contentType: string; data: string }>((resolve) => {
                const reader = new FileReader();
                reader.onload = () => {
                  const base64 = (reader.result as string).split(",")[1];
                  resolve({ name: file.name, contentType: file.type || "application/octet-stream", data: base64 });
                };
                reader.readAsDataURL(file);
              })
          )
        );

        await fetch(`${apiUrl}/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({
            to: to.split(",").map((s: string) => s.trim()),
            cc: cc ? cc.split(",").map((s: string) => s.trim()) : undefined,
            bcc: bcc ? bcc.split(",").map((s: string) => s.trim()) : undefined,
            subject,
            body_html: sendBody,
            in_reply_to: replyTo?.gmail_id,
            thread_id: replyTo?.thread_id,
            track: trackOpens,
            gmail_account_id: selectedAccountId || undefined,
            attachments: attachmentData.length ? attachmentData : undefined,
          }),
        });
      }
      // Delete source record: scheduled email sent immediately, or regular draft
      if (draft?._scheduledId && !scheduleAt) {
        await supabase.from("scheduled_emails").delete().eq("id", draft._scheduledId);
      } else if (draft?.id) {
        await supabase.from("draft_emails").delete().eq("id", draft.id);
        notifyDraftChange();
      }
      // Immediately persist recipient addresses so they appear in autocomplete without waiting for next fetch
      const allRecipients = [
        ...to.split(","),
        ...(cc ? cc.split(",") : []),
        ...(bcc ? bcc.split(",") : []),
      ]
        .map((s) => s.trim())
        .filter((s) => s.includes("@"));
      if (allRecipients.length > 0) {
        const newContacts = allRecipients.map((email) => ({ email: email.toLowerCase(), name: "" }));
        addContacts(newContacts);
        supabase.from("email_memory").upsert(
          newContacts.map((c) => ({
            user_id: user.id,
            sender_email: c.email,
            sender_name: "",
            interaction_count: 1,
            last_interaction_at: new Date().toISOString(),
          })),
          { onConflict: "user_id,sender_email", ignoreDuplicates: true }
        );
      }
      const sentTo = to.split(",").map((s: string) => s.trim()).join(", ");
      notifySent({ to: sentTo, subject, body_html: sendBody });
      if (trackOpens) notifyReceipt({ subject, recipient_email: to.split(",")[0].trim() });

      // Prepend to sent localStorage cache so SentView shows it immediately
      try {
        const cacheKey = `runemail_sent_cache_${user.id}`;
        const raw = localStorage.getItem(cacheKey);
        const existing = raw ? JSON.parse(raw) : { data: [], ts: 0 };
        const newEntry = { id: `local-${Date.now()}`, subject, to: sentTo, date: new Date().toISOString(), body_html: sendBody };
        localStorage.setItem(cacheKey, JSON.stringify({ data: [newEntry, ...(existing.data || [])], ts: existing.ts }));
      } catch { /* non-critical */ }

      onClose();
    } finally {
      setSending(false);
    }
  };

  return (
    <>
    {/* AI Draft Preview overlay */}

    <div
      data-compose-modal
      className="fixed bottom-0 z-50 w-full shadow-2xl rounded-t-xl border border-b-0 border-[var(--border)] bg-[var(--background)] flex flex-col"
      style={{ right: assistantOpen ? "388px" : "16px", maxWidth: `${680 + (rightPanel === "templates" ? 256 : rightPanel === "meeting" ? 240 : 0)}px`, maxHeight: "min(75vh, 620px)", transition: "right 0.2s ease, max-width 0.2s ease" }}
    >
      {/* Title bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--accent)] rounded-t-xl cursor-default select-none shrink-0">
        <span className="text-sm font-medium text-white">
          {replyTo ? "Reply" : "New Message"}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onMinimize}
            className="p-1 rounded hover:bg-white/10 text-white/70 hover:text-white"
            title="Minimize"
          >
            <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>minimize</span>
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-white/10 text-white/70 hover:text-white"
            title="Close"
          >
            <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>close</span>
          </button>
        </div>
      </div>

      {/* Form + optional right side panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main compose area */}
        <div className="flex-1 overflow-auto flex flex-col min-w-0">
          <div className="flex-1 overflow-auto px-4 pt-3 pb-2 space-y-2">
            {/* From selector */}
            {gmailAccounts.length > 1 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--muted)] w-8">From</span>
                <select
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                  className="flex-1 px-2 py-1.5 border-b border-[var(--border)] bg-[var(--surface)] text-sm focus:outline-none focus:border-[var(--accent)]"
                >
                  {gmailAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>{acc.gmail_address}</option>
                  ))}
                </select>
              </div>
            )}

            <EmailField
              label="To"
              value={to}
              onChange={setTo}
              contacts={contacts}
              suffix={
                !showCcBcc ? (
                  <button
                    onClick={() => setShowCcBcc(true)}
                    className="text-xs text-[var(--muted)] hover:text-[var(--accent)] shrink-0"
                  >
                    Cc/Bcc
                  </button>
                ) : (
                  <button
                    onClick={() => { setShowCcBcc(false); setCc(""); setBcc(""); }}
                    className="text-xs text-[var(--muted)] hover:text-[var(--accent)] shrink-0"
                    title="Hide Cc/Bcc"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>close</span>
                  </button>
                )
              }
            />

            {showCcBcc && (
              <>
                <EmailField label="Cc" value={cc} onChange={setCc} contacts={contacts} />
                <EmailField label="Bcc" value={bcc} onChange={setBcc} contacts={contacts} />
              </>
            )}

            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--muted)] w-8">Sub</span>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject"
                className="flex-1 px-2 py-1.5 border-b border-[var(--border)] bg-transparent text-sm focus:outline-none focus:border-[var(--accent)]"
              />
            </div>

            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your message intent or draft…"
              rows={7}
              className="w-full px-2 py-2 bg-transparent text-sm focus:outline-none resize-none"
            />

            {/* Attachment pills */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-2 pb-2">
                {attachments.map((file, idx) => (
                  <div key={idx} className="flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-xs text-[var(--foreground)]">
                    <span className="material-symbols-outlined" style={{ fontSize: "13px" }}>attach_file</span>
                    <span className="max-w-[140px] truncate">{file.name}</span>
                    <span className="text-[var(--muted)]">({formatFileSize(file.size)})</span>
                    <button onClick={() => removeAttachment(idx)} className="ml-0.5 text-[var(--muted)] hover:text-red-500">
                      <span className="material-symbols-outlined" style={{ fontSize: "13px" }}>close</span>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>

          {/* Bottom toolbar */}
          <div className="flex items-center gap-1.5 px-3 py-2 border-t border-[var(--border)] shrink-0">
            {/* Generate button */}
            <button
              onClick={generateDraft}
              disabled={generatingDraft || !to || !subject}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              <span className={`material-symbols-outlined ${generatingDraft ? "animate-spin" : ""}`} style={{ fontSize: "16px" }}>
                {generatingDraft ? "progress_activity" : "auto_awesome"}
              </span>
              {generatingDraft ? "Generating…" : "Generate"}
            </button>

            {/* Send directly (without AI) */}
            <button
              onClick={() => handleSend()}
              disabled={sending || !to || !subject}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--border)] text-sm text-[var(--muted)] hover:text-slate-900 dark:hover:text-white hover:border-slate-400 disabled:opacity-50"
              title="Send without AI"
            >
              <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>send</span>
              {sending ? "Sending…" : scheduleAt ? "Schedule" : "Send"}
            </button>

            <div className="flex items-center gap-0.5 ml-1">
              {/* Attach file */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className={`flex items-center gap-1 px-2 py-1.5 rounded-full text-xs hover:bg-slate-100 dark:hover:bg-slate-800 ${attachments.length > 0 ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}
                title="Attach files"
              >
                <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>attach_file</span>
                {attachments.length > 0 ? `${attachments.length}` : "Attach"}
              </button>

              {/* Track email */}
              <button
                onClick={() => setTrackOpens(!trackOpens)}
                className={`flex items-center gap-1 px-2 py-1.5 rounded-full text-xs hover:bg-slate-100 dark:hover:bg-slate-800 ${trackOpens ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}
                title={trackOpens ? "Read receipts ON" : "Read receipts OFF"}
              >
                <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                  {trackOpens ? "mark_email_read" : "mail"}
                </span>
                Track
              </button>

              {/* Templates */}
              <button
                onClick={() => { togglePanel("templates"); setShowSaveTemplate(false); }}
                className={`flex items-center gap-1 px-2 py-1.5 rounded-full text-xs hover:bg-slate-100 dark:hover:bg-slate-800 ${rightPanel === "templates" ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}
                title="Templates"
              >
                <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>description</span>
                Templates
              </button>

              {/* Schedule meeting — disabled until To + Subject filled */}
              <button
                onClick={() => togglePanel("meeting")}
                disabled={!to || !subject}
                className={`flex items-center gap-1 px-2 py-1.5 rounded-full text-xs hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed ${rightPanel === "meeting" ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}
                title={!to || !subject ? "Enter recipient and subject first" : "Schedule meeting"}
              >
                <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>event</span>
                Meeting
              </button>

              {/* Schedule send popup */}
              <div className="relative">
                <button
                  onClick={() => {
                    if (!showSchedulePopup && !schedDay && !schedHour) {
                      const wh = profile?.working_hours as WorkingHours;
                      const slot = getNextWorkingSlot(wh);
                      const pad = (n: number) => String(n).padStart(2, "0");
                      const d = String(slot.getDate());
                      const mo = String(slot.getMonth() + 1);
                      const y = String(slot.getFullYear());
                      const h = pad(slot.getHours());
                      const mi = pad(slot.getMinutes());
                      setSchedDay(d); setSchedMonth(mo); setSchedYear(y);
                      setSchedHour(h); setSchedMin(mi);
                      syncScheduleAt(d, mo, y, h, mi);
                    }
                    setShowSchedulePopup((p) => !p);
                  }}
                  className={`p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 ${scheduleAt || showSchedulePopup ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}
                  title="Schedule send"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>schedule_send</span>
                </button>
                {showSchedulePopup && (
                  <div className="absolute bottom-full mb-2 right-0 z-50 bg-[var(--background)] border border-[var(--border)] rounded-xl shadow-2xl p-3 w-60">
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Schedule send</span>
                      <button onClick={() => setShowSchedulePopup(false)} className="text-[var(--muted)] hover:text-slate-900 dark:hover:text-white">
                        <span className="material-symbols-outlined" style={{ fontSize: "15px" }}>close</span>
                      </button>
                    </div>
                    <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--foreground)]">
                      <input ref={schedDayRef} type="text" inputMode="numeric" maxLength={2} placeholder="DD" value={schedDay}
                        onChange={(e) => { const v = e.target.value.replace(/\D/g,""); setSchedDay(v); syncScheduleAt(v, schedMonth, schedYear, schedHour, schedMin); if (v.length === 2) schedMonthRef.current?.focus(); }}
                        className="w-7 text-center bg-transparent focus:outline-none placeholder:text-[var(--muted)]" />
                      <span className="text-[var(--muted)]">/</span>
                      <input ref={schedMonthRef} type="text" inputMode="numeric" maxLength={2} placeholder="MM" value={schedMonth}
                        onChange={(e) => { const v = e.target.value.replace(/\D/g,""); setSchedMonth(v); syncScheduleAt(schedDay, v, schedYear, schedHour, schedMin); if (v.length === 2) schedYearRef.current?.focus(); }}
                        className="w-7 text-center bg-transparent focus:outline-none placeholder:text-[var(--muted)]" />
                      <span className="text-[var(--muted)]">/</span>
                      <input ref={schedYearRef} type="text" inputMode="numeric" maxLength={4} placeholder="YYYY" value={schedYear}
                        onChange={(e) => { const v = e.target.value.replace(/\D/g,""); setSchedYear(v); syncScheduleAt(schedDay, schedMonth, v, schedHour, schedMin); if (v.length === 4) schedHourRef.current?.focus(); }}
                        className="w-10 text-center bg-transparent focus:outline-none placeholder:text-[var(--muted)]" />
                      <span className="text-[var(--muted)] ml-1">·</span>
                      <input ref={schedHourRef} type="text" inputMode="numeric" maxLength={2} placeholder="HH" value={schedHour}
                        onChange={(e) => { const v = e.target.value.replace(/\D/g,""); setSchedHour(v); syncScheduleAt(schedDay, schedMonth, schedYear, v, schedMin); if (v.length === 2) schedMinRef.current?.focus(); }}
                        className="w-7 text-center bg-transparent focus:outline-none placeholder:text-[var(--muted)]" />
                      <span className="text-[var(--muted)]">:</span>
                      <input ref={schedMinRef} type="text" inputMode="numeric" maxLength={2} placeholder="MM" value={schedMin}
                        onChange={(e) => { const v = e.target.value.replace(/\D/g,""); setSchedMin(v); syncScheduleAt(schedDay, schedMonth, schedYear, schedHour, v); }}
                        className="w-7 text-center bg-transparent focus:outline-none placeholder:text-[var(--muted)]" />
                    </div>
                    {scheduleAt && isOutsideWorkingHours(scheduleAt, profile?.working_hours as WorkingHours) && (
                      <p className="flex items-center gap-1 text-[11px] text-amber-500 mt-2">
                        <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>warning</span>
                        Outside your working hours
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-2.5">
                      {scheduleAt && (
                        <button
                          onClick={() => { setScheduleAt(""); setSchedDay(""); setSchedMonth(""); setSchedYear(""); setSchedHour(""); setSchedMin(""); }}
                          className="text-xs text-[var(--muted)] hover:text-red-500 flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: "13px" }}>close</span>
                          Clear
                        </button>
                      )}
                      <button
                        onClick={() => setShowSchedulePopup(false)}
                        className="ml-auto px-3 py-1 rounded-lg bg-[var(--accent)] text-white text-xs font-medium hover:opacity-90"
                      >
                        {scheduleAt ? "Confirm" : "Close"}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Save draft */}
              <button
                onClick={saveDraft}
                className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-[var(--muted)]"
                title="Save draft"
              >
                <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>save</span>
              </button>
            </div>

            {/* Discard */}
            <button
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-[var(--muted)] ml-auto"
              title="Discard"
            >
              <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>delete</span>
            </button>
          </div>
        </div>

        {/* Right side panel — Meeting */}
        {rightPanel === "meeting" && (
          <div className="w-60 border-l border-[var(--border)] overflow-auto p-3 space-y-2.5 bg-slate-50 dark:bg-slate-800/50 shrink-0">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Schedule Meeting</span>
              <button onClick={() => setRightPanel(null)} className="text-[var(--muted)] hover:text-slate-900 dark:hover:text-white">
                <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>close</span>
              </button>
            </div>
            <div className="text-xs text-[var(--muted)] bg-[var(--background)] rounded px-2 py-1.5 border border-[var(--border)] space-y-0.5">
              <div className="truncate"><span className="font-medium">To:</span> {to || "—"}</div>
              <div className="truncate"><span className="font-medium">Title:</span> {subject || "—"}</div>
            </div>
            <div className="flex items-center gap-1 px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--foreground)]">
              <input ref={mtgDayRef} type="text" inputMode="numeric" maxLength={2} placeholder="DD" value={mtgDay}
                onChange={(e) => { const v = e.target.value.replace(/\D/g,""); setMtgDay(v); syncMeetingAt(v, mtgMonth, mtgYear, mtgHour, mtgMin); if (v.length === 2) mtgMonthRef.current?.focus(); }}
                className="w-7 text-center bg-transparent focus:outline-none placeholder:text-[var(--muted)]" />
              <span className="text-[var(--muted)]">/</span>
              <input ref={mtgMonthRef} type="text" inputMode="numeric" maxLength={2} placeholder="MM" value={mtgMonth}
                onChange={(e) => { const v = e.target.value.replace(/\D/g,""); setMtgMonth(v); syncMeetingAt(mtgDay, v, mtgYear, mtgHour, mtgMin); if (v.length === 2) mtgYearRef.current?.focus(); }}
                className="w-7 text-center bg-transparent focus:outline-none placeholder:text-[var(--muted)]" />
              <span className="text-[var(--muted)]">/</span>
              <input ref={mtgYearRef} type="text" inputMode="numeric" maxLength={4} placeholder="YYYY" value={mtgYear}
                onChange={(e) => { const v = e.target.value.replace(/\D/g,""); setMtgYear(v); syncMeetingAt(mtgDay, mtgMonth, v, mtgHour, mtgMin); if (v.length === 4) mtgHourRef.current?.focus(); }}
                className="w-10 text-center bg-transparent focus:outline-none placeholder:text-[var(--muted)]" />
              <span className="text-[var(--muted)] ml-1">·</span>
              <input ref={mtgHourRef} type="text" inputMode="numeric" maxLength={2} placeholder="HH" value={mtgHour}
                onChange={(e) => { const v = e.target.value.replace(/\D/g,""); setMtgHour(v); syncMeetingAt(mtgDay, mtgMonth, mtgYear, v, mtgMin); if (v.length === 2) mtgMinRef.current?.focus(); }}
                className="w-7 text-center bg-transparent focus:outline-none placeholder:text-[var(--muted)]" />
              <span className="text-[var(--muted)]">:</span>
              <input ref={mtgMinRef} type="text" inputMode="numeric" maxLength={2} placeholder="MM" value={mtgMin}
                onChange={(e) => { const v = e.target.value.replace(/\D/g,""); setMtgMin(v); syncMeetingAt(mtgDay, mtgMonth, mtgYear, mtgHour, v); }}
                className="w-7 text-center bg-transparent focus:outline-none placeholder:text-[var(--muted)]" />
            </div>
            <select value={meetingDuration} onChange={(e) => setMeetingDuration(e.target.value)}
              className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--surface)] text-sm focus:outline-none">
              <option value="" disabled>Duration</option>
              <option value="15">15 min</option>
              <option value="30">30 min</option>
              <option value="45">45 min</option>
              <option value="60">1 hr</option>
              <option value="90">1.5 hr</option>
              <option value="120">2 hr</option>
            </select>
            <input type="text" value={meetingLocation} onChange={(e) => setMeetingLocation(e.target.value)}
              placeholder="Location (optional)"
              className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-transparent text-sm focus:outline-none" />
            <label className="flex items-center gap-2 text-xs text-[var(--muted)] cursor-pointer">
              <input type="checkbox" checked={createZoomLink} onChange={(e) => setCreateZoomLink(e.target.checked)} className="rounded" />
              Create Zoom link
            </label>
          </div>
        )}

{/* Right side panel — Templates */}
        {rightPanel === "templates" && (
          <div className="w-64 border-l border-[var(--border)] overflow-auto flex flex-col bg-slate-50 dark:bg-slate-800/50 shrink-0">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Templates</span>
              <button onClick={() => { setRightPanel(null); setShowSaveTemplate(false); }} className="text-[var(--muted)] hover:text-slate-900 dark:hover:text-white">
                <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>close</span>
              </button>
            </div>
            <div className="flex-1 overflow-auto">
              {templates.length === 0 ? (
                <p className="text-xs text-[var(--muted)] px-3 py-3">No templates yet. Save your current message as one below.</p>
              ) : (
                templates.map((t) => (
                  <div key={t.id} className="flex items-center justify-between px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-700 border-b border-[var(--border)] last:border-0">
                    <button onClick={() => applyTemplate(t)} className="text-[12px] text-slate-900 dark:text-white text-left flex-1 truncate">
                      {t.name}
                    </button>
                    <button onClick={() => deleteTemplate(t.id)} className="text-[var(--muted)] hover:text-red-500 ml-2 shrink-0">
                      <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>delete</span>
                    </button>
                  </div>
                ))
              )}
            </div>
            {/* Save current as template */}
            <div className="border-t border-[var(--border)] p-2.5">
              {showSaveTemplate ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={saveTemplateName}
                    onChange={(e) => setSaveTemplateName(e.target.value)}
                    placeholder="Template name"
                    className="flex-1 px-2 py-1 rounded border border-[var(--border)] bg-[var(--background)] text-xs focus:outline-none"
                    autoFocus
                  />
                  <button
                    onClick={saveAsTemplate}
                    disabled={!saveTemplateName.trim() || !body}
                    className="px-2 py-1 rounded bg-[var(--accent)] text-white text-xs font-medium hover:opacity-90 disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowSaveTemplate(true)}
                  className="w-full px-2 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--accent)] hover:bg-slate-100 dark:hover:bg-slate-700 rounded flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>add</span>
                  Save current as template
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
