"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useApp } from "../AppShell";

type Meeting = {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  attendees: string[];
  location: string | null;
  zoom_link: string | null;
  calendar_event_id: string | null;
  status: "proposed" | "confirmed" | "cancelled";
};

type SuggestedMeeting = {
  email_id: string;
  email_subject: string;
  email_sender: string;
  title: string;
  attendees: string[];
  suggested_time?: string;
};

type FreeSlot = { start: string; end: string };
type SchedulerStep = "form" | "slots";
type SchedulingMode = "find" | "specific";

const statusColors: Record<string, string> = {
  proposed: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  confirmed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  cancelled: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

const statusIcons: Record<string, string> = {
  proposed: "event_upcoming",
  confirmed: "event_available",
  cancelled: "event_busy",
};

function groupSlotsByDay(slots: FreeSlot[]): Record<string, FreeSlot[]> {
  const groups: Record<string, FreeSlot[]> = {};
  for (const slot of slots) {
    const day = new Date(slot.start).toLocaleDateString([], {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
    if (!groups[day]) groups[day] = [];
    groups[day].push(slot);
  }
  return groups;
}

type WorkingHours = { start?: string; end?: string; days?: number[] } | null;

function getNextWorkingSlot(wh: WorkingHours): string {
  const now = new Date();
  const days = wh?.days || [1, 2, 3, 4, 5];
  const [startH, startM] = (wh?.start || "09:00").split(":").map(Number);
  for (let d = 0; d <= 7; d++) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + d);
    candidate.setHours(startH, startM, 0, 0);
    if (!days.includes(candidate.getDay())) continue;
    if (candidate > now) {
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${candidate.getFullYear()}-${pad(candidate.getMonth() + 1)}-${pad(candidate.getDate())}T${pad(candidate.getHours())}:${pad(candidate.getMinutes())}`;
    }
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T09:00`;
}

export default function MeetingsView() {
  const { user, profile, addToast, getViewCache, setViewCache, liveChanges } = useApp();
  const supabase = createClient();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [showScheduler, setShowScheduler] = useState(false);
  const [filter, setFilter] = useState<"all" | "upcoming" | "past">("upcoming");
  const [freeSlots, setFreeSlots] = useState<FreeSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [creating, setCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editStartTime, setEditStartTime] = useState("");
  const [editDuration, setEditDuration] = useState("30");
  const [editAttendees, setEditAttendees] = useState("");
  const [saving, setSaving] = useState(false);
  const [schedulerStep, setSchedulerStep] = useState<SchedulerStep>("form");
  const [selectedSlot, setSelectedSlot] = useState<FreeSlot | null>(null);
  const [schedulingMode, setSchedulingMode] = useState<SchedulingMode>("find");
  const [specificDateTime, setSpecificDateTime] = useState(() => getNextWorkingSlot(null));

  // Suggested meetings from email analysis
  const [suggestedMeetings, setSuggestedMeetings] = useState<SuggestedMeeting[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  // New meeting form
  const [newTitle, setNewTitle] = useState("");
  const [newDuration, setNewDuration] = useState("30");
  const [newAttendees, setNewAttendees] = useState("");
  const [createZoomLink, setCreateZoomLink] = useState(false);

  const loadMeetings = useCallback(async () => {
    const cacheKey = `meetings_${filter}`;
    const cached = getViewCache(cacheKey);
    if (cached) {
      setMeetings(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }

    let query = supabase
      .from("meetings")
      .select("*")
      .eq("user_id", user.id)
      .order("start_time", { ascending: true });

    const now = new Date().toISOString();
    if (filter === "upcoming") query = query.gte("start_time", now);
    else if (filter === "past") query = query.lt("start_time", now);

    const { data } = await query.limit(200);
    const result = (data || []) as Meeting[];
    setMeetings(result);
    setViewCache(cacheKey, result);
    setLoading(false);
  }, [user.id, filter]);

  useEffect(() => { loadMeetings(); }, [loadMeetings]);

  // Live updates: re-fetch when meetings table changes
  const prevMeetingsChange = useRef(liveChanges.meetings);
  useEffect(() => {
    if (liveChanges.meetings !== prevMeetingsChange.current) {
      prevMeetingsChange.current = liveChanges.meetings;
      loadMeetings();
    }
  }, [liveChanges.meetings, loadMeetings]);

  const loadSuggestedMeetings = useCallback(async () => {
    setLoadingSuggestions(true);
    try {
      // Use pre-computed quick_actions from email_processed — no on-demand AI
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const { data: processed } = await supabase
        .from("email_processed")
        .select("email_id, quick_actions, emails!inner(subject, sender, sender_email, received_at, user_id)")
        .eq("emails.user_id", user.id)
        .filter("emails.received_at", "gte", threeDaysAgo)
        .not("quick_actions", "is", null)
        .limit(30);

      const suggestions: SuggestedMeeting[] = [];
      if (processed) {
        for (const p of processed) {
          const email = (p as any).emails;
          const actions = Array.isArray(p.quick_actions) ? p.quick_actions : [];
          const meetingAction = actions.find((a: any) => a.action === "schedule_meeting");
          if (meetingAction) {
            suggestions.push({
              email_id: p.email_id,
              email_subject: email?.subject || "(no subject)",
              email_sender: email?.sender || email?.sender_email || "",
              title: meetingAction.label?.replace(/^Schedule:\s*/i, "") || `Meeting re: ${email?.subject?.slice(0, 40) || ""}`,
              attendees: email?.sender_email ? [email.sender_email] : [],
            });
          }
        }
      }
      setSuggestedMeetings(suggestions);
    } catch {
      // silently fail
    }
    setLoadingSuggestions(false);
  }, [user.id, supabase]);

  useEffect(() => { loadSuggestedMeetings(); }, [loadSuggestedMeetings]);

  // Live updates: re-fetch suggestions when new emails are processed
  const prevProcessedChange = useRef(liveChanges.email_processed);
  useEffect(() => {
    if (liveChanges.email_processed !== prevProcessedChange.current) {
      prevProcessedChange.current = liveChanges.email_processed;
      loadSuggestedMeetings();
    }
  }, [liveChanges.email_processed, loadSuggestedMeetings]);

  const fetchFreeSlots = async () => {
    setLoadingSlots(true);
    setFreeSlots([]);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/api";
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${apiUrl}/calendar/free-slots?duration=${newDuration}`,
        { headers: { Authorization: `Bearer ${session?.access_token}` } },
      );
      if (res.ok) {
        const data = await res.json();
        const slots = data.slots || [];
        setFreeSlots(slots);
        if (slots.length === 0) {
          addToast("info", "No available slots found. Try adjusting your working hours in Settings.");
        } else {
          setSchedulerStep("slots");
        }
      } else {
        addToast("error", "Could not fetch calendar slots");
      }
    } catch {
      addToast("error", "Network error");
    }
    setLoadingSlots(false);
  };

  const createMeeting = async () => {
    if (!newTitle) return;
    if (schedulingMode === "find" && !selectedSlot) return;
    if (schedulingMode === "specific" && !specificDateTime) return;
    setCreating(true);
    const durationMin = parseInt(newDuration, 10) || 30;
    const startTime = schedulingMode === "specific"
      ? new Date(specificDateTime)
      : new Date(selectedSlot!.start);
    const endTime = new Date(startTime.getTime() + durationMin * 60000);
    const attendees = newAttendees.split(",").map((s) => s.trim()).filter(Boolean);

    const meetingData: Record<string, unknown> = {
      user_id: user.id,
      title: newTitle,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      attendees,
      status: "proposed",
    };

    if (createZoomLink) {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/api";
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${apiUrl}/zoom/create-meeting`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({ topic: newTitle, start_time: startTime.toISOString(), duration: durationMin }),
        });
        if (res.ok) {
          const zoom = await res.json();
          meetingData.zoom_link = zoom.join_url;
        }
      } catch (err) { console.error("[MeetingsView] Zoom creation:", err); addToast("info", "Could not create Zoom link"); }
    }

    try {
      const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/api";
      const { data: { session } } = await supabase.auth.getSession();
      const calRes = await fetch(`${apiUrl}/calendar/create-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          title: newTitle,
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          attendees,
          location: (meetingData.zoom_link as string) || "",
          description: "Scheduled from RuneMail",
          sendUpdates: "all",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      if (calRes.ok) {
        const cal = await calRes.json();
        meetingData.calendar_event_id = cal.event_id;
        meetingData.status = "confirmed";
        addToast("success", "Meeting created and added to Calendar");
      } else {
        const errBody = await calRes.json().catch(() => ({}));
        const errMsg = errBody?.error ?? "calendar sync failed";
        console.error("[MeetingsView] calendar sync error:", errMsg);
        if (errMsg.includes("insufficient_scope") || errMsg.includes("No calendar access") || errMsg.includes("token refresh failed")) {
          addToast("info", "Meeting saved. Reconnect your Google account in Settings to enable Calendar sync.");
        } else {
          addToast("info", "Meeting saved (calendar sync failed)");
        }
      }
    } catch {
      addToast("info", "Meeting saved (calendar unavailable)");
    }

    await supabase.from("meetings").insert(meetingData);
    resetScheduler();
    loadMeetings();
  };

  const resetScheduler = () => {
    setNewTitle("");
    setNewAttendees("");
    setNewDuration("30");
    setCreateZoomLink(false);
    setFreeSlots([]);
    setSelectedSlot(null);
    setSchedulerStep("form");
    setSchedulingMode("find");
    setSpecificDateTime(getNextWorkingSlot(profile?.working_hours as WorkingHours));
    setShowScheduler(false);
  };

  const openSchedulerFromSuggestion = (s: SuggestedMeeting) => {
    setNewTitle(s.title);
    setNewAttendees(s.attendees.join(", "));
    setNewDuration("30");
    setSchedulerStep("form");
    setFreeSlots([]);
    setSelectedSlot(null);
    setShowScheduler(true);
    setSelectedMeeting(null);
  };

  const cancelMeeting = async (id: string) => {
    await supabase.from("meetings").update({ status: "cancelled" }).eq("id", id);
    setMeetings((prev) => prev.map((m) => m.id === id ? { ...m, status: "cancelled" as const } : m));
    if (selectedMeeting?.id === id) setSelectedMeeting((prev) => prev ? { ...prev, status: "cancelled" as const } : prev);
    addToast("info", "Meeting cancelled");
  };

  const confirmMeeting = async (id: string) => {
    await supabase.from("meetings").update({ status: "confirmed" }).eq("id", id);
    setMeetings((prev) => prev.map((m) => m.id === id ? { ...m, status: "confirmed" as const } : m));
    if (selectedMeeting?.id === id) setSelectedMeeting((prev) => prev ? { ...prev, status: "confirmed" as const } : prev);
    addToast("success", "Meeting confirmed");
  };

  const deleteMeeting = async (id: string) => {
    await supabase.from("meetings").delete().eq("id", id);
    setMeetings((prev) => prev.filter((m) => m.id !== id));
    if (selectedMeeting?.id === id) setSelectedMeeting(null);
    addToast("info", "Meeting deleted");
  };

  const openEdit = (m: Meeting) => {
    setEditTitle(m.title);
    const pad = (n: number) => String(n).padStart(2, "0");
    const s = new Date(m.start_time);
    setEditStartTime(`${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}T${pad(s.getHours())}:${pad(s.getMinutes())}`);
    const durMin = Math.round((new Date(m.end_time).getTime() - new Date(m.start_time).getTime()) / 60000);
    setEditDuration(String(durMin));
    setEditAttendees((m.attendees || []).join(", "));
    setIsEditing(true);
  };

  const saveMeeting = async () => {
    if (!selectedMeeting || !editTitle) return;
    setSaving(true);
    const startTime = new Date(editStartTime);
    const durationMin = parseInt(editDuration, 10) || 30;
    const endTime = new Date(startTime.getTime() + durationMin * 60000);
    const attendees = editAttendees.split(",").map((s) => s.trim()).filter(Boolean);

    const updates = {
      title: editTitle,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      attendees,
    };

    await supabase.from("meetings").update(updates).eq("id", selectedMeeting.id);

    if (selectedMeeting.calendar_event_id) {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/api";
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${apiUrl}/calendar/update-event`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({
            event_id: selectedMeeting.calendar_event_id,
            title: editTitle,
            start_time: startTime.toISOString(),
            end_time: endTime.toISOString(),
            attendees,
          }),
        });
        if (res.ok) {
          addToast("success", "Meeting updated and participants notified");
        } else {
          addToast("info", "Meeting saved (calendar update failed)");
        }
      } catch {
        addToast("info", "Meeting saved (calendar unavailable)");
      }
    } else {
      addToast("success", "Meeting updated");
    }

    const updated = { ...selectedMeeting, ...updates };
    setMeetings((prev) => prev.map((m) => m.id === selectedMeeting.id ? updated : m));
    setSelectedMeeting(updated);
    setIsEditing(false);
    setSaving(false);
  };

  const formatMeetingTime = (start: string, end: string) => {
    const s = new Date(start);
    const e = new Date(end);
    return `${s.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · ${s.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} – ${e.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  };

  const durationLabel = (min: string) => {
    const m = parseInt(min, 10);
    if (m < 60) return `${m} min`;
    if (m === 60) return "1 hour";
    return `${m / 60} hours`;
  };

  const slotGroups = groupSlotsByDay(freeSlots);

  return (
    <div className="h-full flex overflow-hidden">
      {/* ── Left pane: suggestions + meetings list ── */}
      <div className={`flex flex-col border-r border-[var(--border)] flex-shrink-0 w-80 lg:w-96 ${(selectedMeeting || showScheduler) ? "hidden md:flex" : "flex"}`}>
        {/* Header */}
        <div className="px-3 py-2.5 border-b border-[var(--border)] flex items-center justify-between flex-shrink-0">
          <h1 className="text-base font-bold text-slate-900 dark:text-white">Meetings</h1>
          <button
            onClick={() => { resetScheduler(); setShowScheduler(true); setSelectedMeeting(null); }}
            className="flex items-center justify-center p-1.5 rounded-lg bg-[var(--accent)] text-white hover:opacity-90"
            title="New meeting"
          >
            <span className="material-symbols-outlined" style={{ fontSize: "18px", lineHeight: 1 }}>add</span>
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {/* ── Suggested from emails ── */}
          <div className="border-b border-[var(--border)]">
            <div className="px-3 py-2 flex items-center gap-1.5 bg-amber-50 dark:bg-amber-900/20">
              <span className="material-symbols-outlined text-amber-600 dark:text-amber-400" style={{ fontSize: "14px" }}>auto_awesome</span>
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide">Suggested from emails</p>
              {loadingSuggestions && (
                <span className="ml-auto text-[10px] text-amber-500 animate-pulse">Scanning…</span>
              )}
            </div>

            {loadingSuggestions ? (
              <div className="space-y-0">
                {[1, 2].map((i) => (
                  <div key={i} className="px-3 py-3 border-b border-[var(--border)] animate-pulse">
                    <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-3/4 mb-2" />
                    <div className="h-2.5 bg-slate-100 dark:bg-slate-800 rounded w-1/2" />
                  </div>
                ))}
              </div>
            ) : suggestedMeetings.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-[var(--muted)]">
                No meeting requests detected in recent emails
              </div>
            ) : (
              suggestedMeetings.map((s, i) => (
                <div key={i} className="px-3 py-2.5 border-b border-[var(--border)] last:border-0 hover:bg-amber-50/50 dark:hover:bg-amber-900/10 transition-colors">
                  <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{s.title}</p>
                  <p className="text-xs text-[var(--muted)] truncate mt-0.5">{s.email_sender}</p>
                  {s.suggested_time && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5 flex items-center gap-1">
                      <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>schedule</span>
                      {s.suggested_time}
                    </p>
                  )}
                  <button
                    onClick={() => openSchedulerFromSuggestion(s)}
                    className="mt-1.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--accent)] text-white text-xs font-medium hover:opacity-90"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: "13px" }}>calendar_add_on</span>
                    Schedule
                  </button>
                </div>
              ))
            )}
          </div>

          {/* ── Filter tabs ── */}
          <div className="flex border-b border-[var(--border)] flex-shrink-0">
            {(["upcoming", "all", "past"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex-1 py-2 text-xs font-medium border-b-2 transition-colors capitalize ${filter === f ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-[var(--muted)]"}`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* ── Meeting list ── */}
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-pulse text-[var(--muted)] text-sm">Loading…</div>
            </div>
          ) : meetings.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-36 text-[var(--muted)] px-4">
              <span className="material-symbols-outlined mb-2" style={{ fontSize: "32px" }}>event</span>
              <p className="text-xs text-center">
                {filter === "upcoming" ? "No upcoming meetings." : "No meetings found."}
              </p>
            </div>
          ) : (
            meetings.map((m) => (
              <button
                key={m.id}
                onClick={() => { setSelectedMeeting(m); setShowScheduler(false); }}
                className={`w-full text-left px-3 py-2.5 border-b border-[var(--border)] hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${selectedMeeting?.id === m.id ? "bg-[var(--accent-light)] border-l-2 border-l-[var(--accent)]" : ""}`}
              >
                <div className="flex items-start gap-2">
                  <span className={`material-symbols-outlined mt-0.5 shrink-0 ${m.status === "confirmed" ? "text-emerald-500" : m.status === "cancelled" ? "text-red-400" : "text-blue-500"}`} style={{ fontSize: "18px" }}>
                    {statusIcons[m.status] || "event"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${m.status === "cancelled" ? "line-through text-[var(--muted)]" : "text-slate-900 dark:text-white"}`}>
                      {m.title}
                    </p>
                    <p className="text-[11px] text-[var(--muted)] mt-0.5">
                      {new Date(m.start_time).toLocaleDateString([], { month: "short", day: "numeric" })} · {new Date(m.start_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${statusColors[m.status]}`}>{m.status}</span>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Google Calendar link */}
        <div className="px-3 py-2 border-t border-[var(--border)] flex-shrink-0">
          <a
            href="https://calendar.google.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 text-xs text-[var(--accent)] hover:underline py-1"
          >
            <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>open_in_new</span>
            Open Google Calendar
          </a>
        </div>
      </div>

      {/* ── Right pane: scheduler / detail / empty state ── */}
      <div className={`flex-1 overflow-hidden flex flex-col ${!(selectedMeeting || showScheduler) ? "hidden md:flex" : "flex"}`}>
        {showScheduler ? (
          <div className="flex-1 overflow-auto">
            {/* Scheduler header */}
            <div className="px-5 py-3 border-b border-[var(--border)] flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => {
                  if (schedulerStep === "slots") {
                    setSchedulerStep("form");
                    setSelectedSlot(null);
                  } else {
                    resetScheduler();
                  }
                }}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-900 dark:text-white"
              >
                <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>arrow_back</span>
              </button>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  {schedulerStep === "form" ? "Schedule a Meeting" : "Pick a Time"}
                </h2>
                {schedulerStep === "slots" && (
                  <p className="text-xs text-[var(--muted)]">
                    {newTitle} · {durationLabel(newDuration)}
                    {newAttendees && ` · ${newAttendees.split(",").length} attendee${newAttendees.split(",").length > 1 ? "s" : ""}`}
                  </p>
                )}
              </div>
              {schedulerStep === "slots" && (
                <span className="ml-auto text-xs text-[var(--muted)]">{freeSlots.length} slots available</span>
              )}
            </div>

            {schedulerStep === "form" ? (
              /* ── Step 1: Meeting details ── */
              <div className="p-5 max-w-lg mx-auto space-y-4">
                {/* Title */}
                <div>
                  <label className="block text-xs font-medium text-[var(--muted)] mb-1.5">Meeting Title</label>
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="e.g. Product sync with Alex"
                    autoFocus
                    className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 text-slate-900 dark:text-white"
                  />
                </div>

                {/* Duration */}
                <div>
                  <label className="block text-xs font-medium text-[var(--muted)] mb-1.5">Duration</label>
                  <div className="flex gap-2 flex-wrap">
                    {[
                      { label: "15 min", value: "15" },
                      { label: "30 min", value: "30" },
                      { label: "45 min", value: "45" },
                      { label: "1 hour", value: "60" },
                      { label: "1.5 hr", value: "90" },
                      { label: "2 hours", value: "120" },
                    ].map(({ label, value }) => (
                      <button
                        key={value}
                        onClick={() => setNewDuration(value)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${newDuration === value ? "bg-[var(--accent)] text-white border-[var(--accent)]" : "border-[var(--border)] text-slate-700 dark:text-slate-300 hover:border-[var(--accent)] hover:text-[var(--accent)]"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Attendees */}
                <div>
                  <label className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                    Recipients <span className="text-[var(--muted)] font-normal">(comma-separated emails)</span>
                  </label>
                  <textarea
                    value={newAttendees}
                    onChange={(e) => setNewAttendees(e.target.value)}
                    placeholder="alex@example.com, sarah@example.com"
                    rows={2}
                    className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 resize-none text-slate-900 dark:text-white"
                  />
                </div>

                {/* Zoom toggle */}
                <div className="flex items-center justify-between p-3 rounded-lg border border-[var(--border)] bg-slate-50 dark:bg-slate-800/50">
                  <div className="flex items-center gap-2.5">
                    <span className="material-symbols-outlined text-[var(--muted)]" style={{ fontSize: "20px" }}>videocam</span>
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-white">Add Zoom link</p>
                      <p className="text-xs text-[var(--muted)]">Auto-generates a meeting link</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setCreateZoomLink(!createZoomLink)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${createZoomLink ? "bg-[var(--accent)]" : "bg-slate-300 dark:bg-slate-600"}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${createZoomLink ? "translate-x-6" : "translate-x-1"}`} />
                  </button>
                </div>

                {/* Time selection mode */}
                <div>
                  <label className="block text-xs font-medium text-[var(--muted)] mb-1.5">Time</label>
                  <div className="flex rounded-lg border border-[var(--border)] overflow-hidden mb-3">
                    <button
                      onClick={() => setSchedulingMode("find")}
                      className={`flex-1 py-2 text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${schedulingMode === "find" ? "bg-[var(--accent)] text-white" : "text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"}`}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: "15px" }}>search</span>
                      Find available
                    </button>
                    <button
                      onClick={() => setSchedulingMode("specific")}
                      className={`flex-1 py-2 text-sm font-medium transition-colors flex items-center justify-center gap-1.5 border-l border-[var(--border)] ${schedulingMode === "specific" ? "bg-[var(--accent)] text-white" : "text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"}`}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: "15px" }}>edit_calendar</span>
                      Pick specific
                    </button>
                  </div>

                  {schedulingMode === "find" ? (
                    <>
                      <button
                        onClick={fetchFreeSlots}
                        disabled={!newTitle.trim() || loadingSlots}
                        className="w-full px-4 py-2.5 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2"
                      >
                        {loadingSlots ? (
                          <>
                            <span className="material-symbols-outlined animate-spin" style={{ fontSize: "16px" }}>refresh</span>
                            Checking your calendar…
                          </>
                        ) : (
                          <>
                            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>calendar_month</span>
                            Find Available Times
                          </>
                        )}
                      </button>
                      <p className="text-xs text-[var(--muted)] text-center mt-1.5">
                        Based on your working hours and existing calendar events
                      </p>
                    </>
                  ) : (
                    <>
                      <input
                        type="datetime-local"
                        value={specificDateTime}
                        onChange={(e) => setSpecificDateTime(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 text-slate-900 dark:text-white mb-3"
                      />
                      <button
                        onClick={createMeeting}
                        disabled={!newTitle.trim() || !specificDateTime || creating}
                        className="w-full px-4 py-2.5 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2"
                      >
                        {creating ? (
                          <>
                            <span className="material-symbols-outlined animate-spin" style={{ fontSize: "16px" }}>refresh</span>
                            Creating…
                          </>
                        ) : (
                          <>
                            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>event_available</span>
                            Schedule Meeting
                            {createZoomLink && " + Zoom"}
                          </>
                        )}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : (
              /* ── Step 2: Slot picker ── */
              <div className="p-5 max-w-lg mx-auto">
                {Object.keys(slotGroups).length === 0 ? (
                  <div className="text-center py-12 text-[var(--muted)]">
                    <span className="material-symbols-outlined mb-2" style={{ fontSize: "40px" }}>event_busy</span>
                    <p className="text-sm">No available slots found.</p>
                    <p className="text-xs mt-1">Check your working hours in Settings.</p>
                    <button
                      onClick={() => setSchedulerStep("form")}
                      className="mt-4 px-4 py-2 rounded-lg border border-[var(--border)] text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      Go back
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="space-y-5">
                      {Object.entries(slotGroups).map(([day, slots]) => (
                        <div key={day}>
                          <p className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-2">{day}</p>
                          <div className="flex flex-wrap gap-2">
                            {slots.map((slot, i) => {
                              const isSelected = selectedSlot?.start === slot.start;
                              return (
                                <button
                                  key={i}
                                  onClick={() => setSelectedSlot(slot)}
                                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${isSelected ? "bg-[var(--accent)] text-white border-[var(--accent)] shadow-sm scale-105" : "border-[var(--border)] text-slate-700 dark:text-slate-300 hover:border-[var(--accent)] hover:text-[var(--accent)]"}`}
                                >
                                  {new Date(slot.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>

                    {selectedSlot && (
                      <div className="mt-6 p-3 rounded-xl bg-[var(--accent-light)] border border-[var(--accent)]/20">
                        <p className="text-xs font-medium text-[var(--accent)] mb-0.5">Selected time</p>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                          {new Date(selectedSlot.start).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
                        </p>
                        <p className="text-sm text-slate-700 dark:text-slate-300">
                          {new Date(selectedSlot.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          {" "}-{" "}
                          {new Date(new Date(selectedSlot.start).getTime() + parseInt(newDuration) * 60000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          {" "}·{" "}{durationLabel(newDuration)}
                        </p>
                      </div>
                    )}

                    <button
                      onClick={createMeeting}
                      disabled={!selectedSlot || creating}
                      className="mt-4 w-full px-4 py-2.5 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                      {creating ? (
                        <>
                          <span className="material-symbols-outlined animate-spin" style={{ fontSize: "16px" }}>refresh</span>
                          Creating…
                        </>
                      ) : (
                        <>
                          <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>event_available</span>
                          Schedule Meeting
                          {createZoomLink && " + Zoom"}
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        ) : selectedMeeting ? (
          /* ── Meeting detail ── */
          <div className="flex-1 overflow-auto p-5 max-w-xl">
            <div className="flex items-center gap-2 mb-4">
              <button
                onClick={() => { setSelectedMeeting(null); setIsEditing(false); }}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
              >
                <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>arrow_back</span>
              </button>
              <span className={`material-symbols-outlined ${selectedMeeting.status === "confirmed" ? "text-emerald-500" : selectedMeeting.status === "cancelled" ? "text-red-400" : "text-blue-500"}`} style={{ fontSize: "28px" }}>
                {statusIcons[selectedMeeting.status]}
              </span>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white truncate">{selectedMeeting.title}</h2>
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${statusColors[selectedMeeting.status]}`}>{selectedMeeting.status}</span>
              </div>
              {selectedMeeting.status !== "cancelled" && !isEditing && (
                <button
                  onClick={() => openEdit(selectedMeeting)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400"
                  title="Edit meeting"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>edit</span>
                </button>
              )}
            </div>

            {isEditing ? (
              /* ── Edit form ── */
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--muted)] mb-1.5">Title</label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    autoFocus
                    className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--muted)] mb-1.5">Start time</label>
                  <input
                    type="datetime-local"
                    value={editStartTime}
                    onChange={(e) => setEditStartTime(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--muted)] mb-1.5">Duration</label>
                  <div className="flex gap-2 flex-wrap">
                    {[
                      { label: "15 min", value: "15" },
                      { label: "30 min", value: "30" },
                      { label: "45 min", value: "45" },
                      { label: "1 hour", value: "60" },
                      { label: "1.5 hr", value: "90" },
                      { label: "2 hours", value: "120" },
                    ].map(({ label, value }) => (
                      <button
                        key={value}
                        onClick={() => setEditDuration(value)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${editDuration === value ? "bg-[var(--accent)] text-white border-[var(--accent)]" : "border-[var(--border)] text-slate-700 dark:text-slate-300 hover:border-[var(--accent)] hover:text-[var(--accent)]"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                    Attendees <span className="font-normal">(comma-separated emails)</span>
                  </label>
                  <textarea
                    value={editAttendees}
                    onChange={(e) => setEditAttendees(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 resize-none text-slate-900 dark:text-white"
                  />
                </div>
                {selectedMeeting.calendar_event_id && (
                  <p className="text-xs text-[var(--muted)] flex items-center gap-1">
                    <span className="material-symbols-outlined" style={{ fontSize: "13px" }}>info</span>
                    Saving will update Google Calendar and notify all participants.
                  </p>
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={saveMeeting}
                    disabled={!editTitle.trim() || !editStartTime || saving}
                    className="flex-1 px-4 py-2.5 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {saving ? (
                      <>
                        <span className="material-symbols-outlined animate-spin" style={{ fontSize: "16px" }}>refresh</span>
                        Saving…
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>save</span>
                        Save changes
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => setIsEditing(false)}
                    className="px-4 py-2.5 rounded-lg border border-[var(--border)] text-sm text-[var(--foreground)] hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-3 mb-5">
                  <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                    <span className="material-symbols-outlined text-[var(--muted)]" style={{ fontSize: "18px" }}>schedule</span>
                    {formatMeetingTime(selectedMeeting.start_time, selectedMeeting.end_time)}
                  </div>
                  {selectedMeeting.location && (
                    <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                      <span className="material-symbols-outlined text-[var(--muted)]" style={{ fontSize: "18px" }}>location_on</span>
                      {selectedMeeting.location}
                    </div>
                  )}
                  {selectedMeeting.attendees?.length > 0 && (
                    <div className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                      <span className="material-symbols-outlined text-[var(--muted)] mt-0.5" style={{ fontSize: "18px" }}>group</span>
                      <span>{selectedMeeting.attendees.join(", ")}</span>
                    </div>
                  )}
                  {selectedMeeting.zoom_link && (
                    <a href={selectedMeeting.zoom_link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-[var(--accent)] hover:underline">
                      <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>videocam</span>
                      Join Zoom Meeting
                    </a>
                  )}
                  {selectedMeeting.calendar_event_id && (
                    <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                      <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>calendar_month</span>
                      Synced to Google Calendar
                    </div>
                  )}
                </div>

                {selectedMeeting.status !== "cancelled" && (
                  <div className="flex gap-2">
                    {selectedMeeting.status === "proposed" && (
                      <button onClick={() => confirmMeeting(selectedMeeting.id)} className="flex-1 px-3 py-2 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:opacity-90">
                        Confirm
                      </button>
                    )}
                    <button onClick={() => cancelMeeting(selectedMeeting.id)} className="px-3 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--foreground)] hover:bg-slate-50 dark:hover:bg-slate-800">
                      Cancel Meeting
                    </button>
                  </div>
                )}
                <button onClick={() => deleteMeeting(selectedMeeting.id)} className="mt-2 w-full px-3 py-2 rounded-lg text-red-500 text-sm hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-800">
                  Delete
                </button>
              </>
            )}
          </div>
        ) : (
          /* ── Empty state ── */
          <div className="flex-1 flex flex-col items-center justify-center text-[var(--muted)] gap-3">
            <span className="material-symbols-outlined" style={{ fontSize: "56px" }}>event</span>
            <div className="text-center">
              <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Select a meeting or schedule a new one</p>
              <p className="text-xs mt-1">Use the suggestions on the left to get started</p>
            </div>
            <button
              onClick={() => { resetScheduler(); setShowScheduler(true); }}
              className="mt-1 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 flex items-center gap-2"
            >
              <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>add</span>
              New Meeting
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
