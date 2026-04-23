"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useApp } from "../AppShell";

type Contact = {
  sender_email: string;
  sender_name: string | null;
  interaction_count: number;
  relationship_notes: string | null;
  last_subject: string | null;
  last_interaction_at: string | null;
};

function daysSince(isoStr: string | null): number {
  if (!isoStr) return 9999;
  return Math.floor((Date.now() - new Date(isoStr).getTime()) / 86400000);
}

function healthLabel(contact: Contact): { label: string; color: string } {
  const days = daysSince(contact.last_interaction_at);
  if (days <= 7) return { label: "Active", color: "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30" };
  if (days <= 30) return { label: "Recent", color: "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30" };
  if (days <= 90) return { label: "Fading", color: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30" };
  return { label: "Dormant", color: "text-[var(--muted)] bg-[var(--surface-2)]" };
}

export default function RelationshipsView() {
  const { user } = useApp();
  const supabase = createClient();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Contact | null>(null);
  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("email_memory")
      .select("sender_email, sender_name, interaction_count, relationship_notes, last_subject, last_interaction_at")
      .eq("user_id", user.id)
      .order("interaction_count", { ascending: false })
      .limit(100);
    setContacts((data as Contact[]) ?? []);
    setLoading(false);
  }, [user.id]);

  useEffect(() => { fetch(); }, [fetch]);

  const filtered = contacts.filter((c) => {
    const q = search.toLowerCase();
    return !q || c.sender_email.includes(q) || (c.sender_name ?? "").toLowerCase().includes(q);
  });

  const saveNotes = async () => {
    if (!selected) return;
    setSavingNotes(true);
    await supabase.from("email_memory").update({ relationship_notes: notes }).eq("user_id", user.id).eq("sender_email", selected.sender_email);
    setContacts((prev) => prev.map((c) => c.sender_email === selected.sender_email ? { ...c, relationship_notes: notes } : c));
    setSelected((prev) => prev ? { ...prev, relationship_notes: notes } : prev);
    setSavingNotes(false);
  };

  return (
    <div className="h-full flex overflow-hidden">
      {/* Contact list */}
      <div className={`flex flex-col border-r border-[var(--border)] bg-[var(--background)] flex-shrink-0 w-80 lg:w-96 ${selected ? "hidden md:flex" : "flex"}`}>
        <div className="px-3 pt-3 pb-2 border-b border-[var(--border)] shrink-0">
          <h2 className="text-sm font-semibold text-[var(--foreground)] mb-2">Relationship Health</h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contacts..."
            className="w-full px-3 py-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-xs text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)]"
          />
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="space-y-0">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="px-4 py-3 border-b border-[var(--border)] animate-pulse">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[var(--surface-2)] shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-28 rounded bg-[var(--surface-2)]" />
                      <div className="h-2.5 w-40 rounded bg-[var(--surface-2)]" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-[var(--muted)]">
              <span className="material-symbols-outlined mb-2" style={{ fontSize: "32px" }}>person_off</span>
              <p className="text-xs">No contacts yet. Send some emails to build your network.</p>
            </div>
          ) : (
            filtered.map((c) => {
              const health = healthLabel(c);
              const days = daysSince(c.last_interaction_at);
              const initials = (c.sender_name ?? c.sender_email).slice(0, 2).toUpperCase();
              return (
                <button
                  key={c.sender_email}
                  onClick={() => { setSelected(c); setNotes(c.relationship_notes ?? ""); }}
                  className={`w-full text-left px-4 py-3 border-b border-[var(--border)] flex items-center gap-3 hover:bg-[var(--surface-2)] transition-colors ${selected?.sender_email === c.sender_email ? "bg-[var(--accent-light)]" : ""}`}
                >
                  <div className="w-9 h-9 rounded-full bg-[var(--accent-light)] flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-[var(--accent)]">{initials}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-[13px] font-medium text-[var(--foreground)] truncate flex-1">
                        {c.sender_name || c.sender_email.split("@")[0]}
                      </span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold shrink-0 ${health.color}`}>{health.label}</span>
                    </div>
                    <p className="text-[11px] text-[var(--muted)] truncate">{c.sender_email}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-[var(--muted)]">{c.interaction_count} emails</span>
                      {days < 9999 && <span className="text-[10px] text-[var(--muted)]">{days === 0 ? "Today" : `${days}d ago`}</span>}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Detail pane */}
      <div className={`flex-1 overflow-y-auto ${selected ? "flex" : "hidden md:flex"} flex-col`}>
        {selected ? (
          <div className="p-5 max-w-xl">
            <button onClick={() => setSelected(null)} className="md:hidden mb-4 flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--foreground)]">
              <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>arrow_back</span>
              Back
            </button>

            <div className="flex items-center gap-4 mb-5">
              <div className="w-14 h-14 rounded-2xl bg-[var(--accent-light)] flex items-center justify-center">
                <span className="text-xl font-bold text-[var(--accent)]">
                  {(selected.sender_name ?? selected.sender_email).slice(0, 2).toUpperCase()}
                </span>
              </div>
              <div>
                <h2 className="text-base font-semibold text-[var(--foreground)]">{selected.sender_name || selected.sender_email.split("@")[0]}</h2>
                <p className="text-xs text-[var(--muted)]">{selected.sender_email}</p>
                <div className={`mt-1 inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold ${healthLabel(selected).color}`}>
                  {healthLabel(selected).label}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-5">
              {[
                { label: "Total emails", value: selected.interaction_count, icon: "email" },
                { label: "Last contact", value: daysSince(selected.last_interaction_at) === 9999 ? "Never" : `${daysSince(selected.last_interaction_at)}d ago`, icon: "schedule" },
                { label: "Status", value: healthLabel(selected).label, icon: "favorite" },
              ].map((stat) => (
                <div key={stat.label} className="bg-[var(--surface-2)] rounded-xl p-3 text-center">
                  <span className="material-symbols-outlined text-[var(--accent)] block mb-1" style={{ fontSize: "18px", fontVariationSettings: "'FILL' 1" }}>{stat.icon}</span>
                  <p className="text-sm font-semibold text-[var(--foreground)]">{stat.value}</p>
                  <p className="text-[10px] text-[var(--muted)] mt-0.5">{stat.label}</p>
                </div>
              ))}
            </div>

            {selected.last_subject && (
              <div className="mb-4 px-3 py-2 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
                <p className="text-[10px] text-[var(--muted)] mb-0.5">Last email subject</p>
                <p className="text-xs text-[var(--foreground)]">{selected.last_subject}</p>
              </div>
            )}

            {daysSince(selected.last_interaction_at) > 30 && (
              <div className="mb-4 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-500 shrink-0" style={{ fontSize: "16px", fontVariationSettings: "'FILL' 1" }}>notifications_active</span>
                <p className="text-[11px] text-amber-700 dark:text-amber-300">
                  You haven't emailed {selected.sender_name || "this person"} in {daysSince(selected.last_interaction_at)} days. Consider reaching out.
                </p>
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-[var(--foreground)] block mb-1.5">Notes about this contact</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                placeholder="Add notes: role, company, relationship context..."
                className="w-full px-3 py-2 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-xs text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)] resize-none"
              />
              <button
                onClick={saveNotes}
                disabled={savingNotes}
                className="mt-2 px-4 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs font-medium hover:opacity-90 disabled:opacity-50"
              >
                {savingNotes ? "Saving..." : "Save notes"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[var(--muted)]">
            <div className="text-center">
              <span className="material-symbols-outlined block mb-2" style={{ fontSize: "40px", fontVariationSettings: "'FILL' 1, 'wght' 200" }}>people</span>
              <p className="text-sm opacity-50">Select a contact to see details</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
