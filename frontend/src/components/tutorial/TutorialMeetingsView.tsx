"use client";

import { useState } from "react";
import { MOCK_MEETINGS, MOCK_MEETING_SUGGESTIONS, type MockMeeting } from "./mockData";

const STATUS_COLORS: Record<string, string> = {
  proposed: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  confirmed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  cancelled: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

const STATUS_ICONS: Record<string, string> = {
  proposed: "event_upcoming",
  confirmed: "event_available",
  cancelled: "event_busy",
};

function formatMeetingTime(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  const dateStr = s.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  const startTime = s.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const endTime = e.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${dateStr}, ${startTime} - ${endTime}`;
}

function isToday(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
}

type MockSlot = { label: string; time: string };

type Props = {
  extraMeetings: MockMeeting[];
  onMeetingScheduled: (meeting: MockMeeting) => void;
};

export default function TutorialMeetingsView({ extraMeetings, onMeetingScheduled }: Props) {
  const [schedulingId, setSchedulingId] = useState<string | null>(null);
  const [scheduledIds, setScheduledIds] = useState<Set<string>>(new Set());

  const allMeetings = [...extraMeetings, ...MOCK_MEETINGS];

  const MOCK_SLOTS: MockSlot[] = [
    { label: "Thursday, Apr 3 at 11:00 AM", time: new Date(Date.now() + 3 * 86400000).toISOString() },
    { label: "Thursday, Apr 3 at 2:00 PM", time: new Date(Date.now() + 3 * 86400000 + 3 * 3600000).toISOString() },
    { label: "Friday, Apr 4 at 10:00 AM", time: new Date(Date.now() + 4 * 86400000).toISOString() },
  ];

  const [selectedSlot, setSelectedSlot] = useState<MockSlot>(MOCK_SLOTS[0]);

  const handleConfirm = (suggestion: typeof MOCK_MEETING_SUGGESTIONS[0]) => {
    const newMeeting: MockMeeting = {
      id: `demo-scheduled-${suggestion.email_id}`,
      title: suggestion.title,
      start_time: selectedSlot.time,
      end_time: new Date(new Date(selectedSlot.time).getTime() + 3600000).toISOString(),
      attendees: suggestion.attendees,
      location: null,
      zoom_link: null,
      calendar_event_id: null,
      status: "confirmed",
    };
    setScheduledIds((prev) => new Set(prev).add(suggestion.email_id));
    setSchedulingId(null);
    onMeetingScheduled(newMeeting);
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 max-w-2xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-xl bg-[var(--accent)] flex items-center justify-center">
          <span className="material-symbols-outlined text-white dark:text-[#202124]" style={{ fontSize: "18px", fontVariationSettings: "'FILL' 1" }}>event</span>
        </div>
        <div>
          <h1 className="text-[18px] font-bold text-[var(--foreground)]">Meetings</h1>
          <p className="text-[12px] text-[var(--muted)]">{allMeetings.length} meetings</p>
        </div>
      </div>

      {/* Meeting suggestions */}
      {MOCK_MEETING_SUGGESTIONS.filter((s) => !scheduledIds.has(s.email_id)).length > 0 && (
        <div data-tour="meeting-suggestions" className="mb-6">
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-[var(--muted)] mb-3 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[var(--accent)]" style={{ fontSize: "13px", fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
            AI Meeting Suggestions
          </h2>
          <div className="flex flex-col gap-3">
            {MOCK_MEETING_SUGGESTIONS.filter((s) => !scheduledIds.has(s.email_id)).map((suggestion) => (
              <div key={suggestion.email_id}>
                <div className="rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-light)] p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-[var(--foreground)] truncate">
                        {suggestion.title}
                      </p>
                      <p className="text-[11px] text-[var(--muted)] mt-0.5 flex items-center gap-1">
                        <span className="material-symbols-outlined" style={{ fontSize: "11px" }}>mail</span>
                        From: {suggestion.email_sender} - "{suggestion.email_subject}"
                      </p>
                    </div>
                    <button
                      onClick={() => setSchedulingId(schedulingId === suggestion.email_id ? null : suggestion.email_id)}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white dark:text-[#202124] text-[12px] font-semibold hover:opacity-90 active:scale-[0.97] transition-all cursor-pointer"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: "14px", fontVariationSettings: "'FILL' 1" }}>event_available</span>
                      Schedule
                    </button>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
                    <span className="material-symbols-outlined" style={{ fontSize: "13px" }}>group</span>
                    {suggestion.attendees.join(", ")}
                  </div>
                </div>

                {/* Scheduler dropdown */}
                {schedulingId === suggestion.email_id && (
                  <div className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 shadow-lg">
                    <p className="text-[12px] font-semibold text-[var(--foreground)] mb-3">
                      Pick a time slot:
                    </p>
                    <div className="flex flex-col gap-2 mb-4">
                      {MOCK_SLOTS.map((slot) => (
                        <button
                          key={slot.label}
                          onClick={() => setSelectedSlot(slot)}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-[12px] text-left transition-all cursor-pointer ${
                            selectedSlot.label === slot.label
                              ? "border-[var(--accent)] bg-[var(--accent-light)] text-[var(--accent)] font-semibold"
                              : "border-[var(--border)] hover:bg-[var(--surface-2)] text-[var(--foreground)]"
                          }`}
                        >
                          <span
                            className="material-symbols-outlined"
                            style={{ fontSize: "14px", fontVariationSettings: selectedSlot.label === slot.label ? "'FILL' 1" : "'FILL' 0" }}
                          >
                            {selectedSlot.label === slot.label ? "radio_button_checked" : "radio_button_unchecked"}
                          </span>
                          {slot.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleConfirm(suggestion)}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--accent)] text-white dark:text-[#202124] text-[12px] font-semibold hover:opacity-90 active:scale-[0.97] transition-all cursor-pointer"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: "14px", fontVariationSettings: "'FILL' 1" }}>event_available</span>
                        Confirm Meeting
                      </button>
                      <button
                        onClick={() => setSchedulingId(null)}
                        className="px-3 py-2 rounded-lg border border-[var(--border)] text-[12px] text-[var(--muted)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confirmed / Proposed meetings */}
      <h2 className="text-[11px] font-bold uppercase tracking-widest text-[var(--muted)] mb-3">
        Scheduled Meetings
      </h2>
      <div className="flex flex-col gap-3">
        {allMeetings.map((meeting) => {
          const today = isToday(meeting.start_time);
          return (
            <div
              key={meeting.id}
              className={`rounded-xl border p-4 ${today ? "border-[var(--accent)]/40 bg-[var(--accent-light)]" : "border-[var(--border)] bg-[var(--background)]"}`}
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-[13px] font-semibold text-[var(--foreground)] truncate">{meeting.title}</p>
                    {today && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[var(--accent)] text-white dark:text-[#202124] shrink-0">
                        TODAY
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[var(--muted)] flex items-center gap-1">
                    <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>schedule</span>
                    {formatMeetingTime(meeting.start_time, meeting.end_time)}
                  </p>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-1 rounded-lg ${STATUS_COLORS[meeting.status]}`}>
                  {meeting.status}
                </span>
              </div>
              {meeting.attendees.length > 0 && (
                <p className="text-[11px] text-[var(--muted)] flex items-center gap-1">
                  <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>group</span>
                  {meeting.attendees.slice(0, 3).join(", ")}
                  {meeting.attendees.length > 3 ? ` +${meeting.attendees.length - 3} more` : ""}
                </p>
              )}
              {(meeting.zoom_link || meeting.location) && (
                <p className="text-[11px] text-[var(--muted)] flex items-center gap-1 mt-1">
                  <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>
                    {meeting.zoom_link ? "videocam" : "location_on"}
                  </span>
                  {meeting.zoom_link ? "Zoom link available" : meeting.location}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
