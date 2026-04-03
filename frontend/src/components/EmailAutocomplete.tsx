"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export interface Contact {
  email: string;
  name: string;
  /** When set, this is a domain group suggestion — selecting it inserts all these addresses */
  _groupEmails?: string[];
}

/** Parse a raw RFC 2822 address like `"Name" <email>` or `Name <email>` or bare `email` */
function parseAddress(raw: string): { email: string; name: string } | null {
  if (!raw) return null;
  const angleMatch = raw.match(/^(.*?)<([^>]+)>\s*$/);
  if (angleMatch) {
    const name = angleMatch[1].trim().replace(/^"|"$/g, "").trim();
    const email = angleMatch[2].trim().toLowerCase();
    if (!email.includes("@")) return null;
    return { email, name };
  }
  const bare = raw.trim().toLowerCase();
  if (bare.includes("@") && !bare.includes(" ")) return { email: bare, name: "" };
  return null;
}

/** Loads all known contacts from DB: senders, recipients, meeting attendees */
export function useContacts(userId: string): { contacts: Contact[]; addContacts: (newContacts: Contact[]) => void } {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const supabase = createClient();

  const addContacts = (newContacts: Contact[]) => {
    setContacts((prev) => {
      const seen = new Map(prev.map((c) => [c.email, c.name]));
      for (const c of newContacts) {
        if (!seen.has(c.email)) seen.set(c.email, c.name);
      }
      return Array.from(seen.entries()).map(([email, name]) => ({ email, name }));
    });
  };

  useEffect(() => {
    (async () => {
      const { data: accounts } = await supabase
        .from("gmail_accounts")
        .select("id")
        .eq("user_id", userId)
        .eq("is_active", true);

      const accountIds = (accounts ?? []).map((a: { id: string }) => a.id);

      const seen = new Map<string, string>(); // email → name

      // 1. Senders from received emails
      if (accountIds.length > 0) {
        const { data: emailRows } = await supabase
          .from("emails")
          .select("sender_email, sender_name")
          .in("gmail_account_id", accountIds)
          .limit(500);
        for (const row of emailRows ?? []) {
          const parsed = parseAddress(row.sender_email);
          if (!parsed) continue;
          if (!seen.has(parsed.email)) {
            seen.set(parsed.email, row.sender_name || parsed.name);
          }
        }
      }

      // 2. Recipients from sent/scheduled emails
      const { data: sentRows } = await supabase
        .from("scheduled_emails")
        .select("to_addresses, cc_addresses, bcc_addresses")
        .eq("user_id", userId)
        .limit(200);
      for (const row of sentRows ?? []) {
        const addrs = [
          ...(row.to_addresses ?? []),
          ...(row.cc_addresses ?? []),
          ...(row.bcc_addresses ?? []),
        ];
        for (const raw of addrs) {
          const parsed = parseAddress(raw);
          if (parsed && !seen.has(parsed.email)) seen.set(parsed.email, parsed.name);
        }
      }

      // 3. Meeting attendees
      const { data: meetingRows } = await supabase
        .from("meetings")
        .select("attendees")
        .eq("user_id", userId)
        .limit(200);
      for (const row of meetingRows ?? []) {
        for (const raw of row.attendees ?? []) {
          const parsed = parseAddress(raw);
          if (parsed && !seen.has(parsed.email)) seen.set(parsed.email, parsed.name);
        }
      }

      // 4. email_memory (ranked contacts — override name if available)
      const { data: memoryRows } = await supabase
        .from("email_memory")
        .select("sender_email, sender_name")
        .eq("user_id", userId)
        .order("interaction_count", { ascending: false })
        .limit(300);
      for (const row of memoryRows ?? []) {
        const parsed = parseAddress(row.sender_email);
        if (parsed) {
          seen.set(parsed.email, row.sender_name || parsed.name || seen.get(parsed.email) || "");
        }
      }

      setContacts(
        Array.from(seen.entries()).map(([email, name]) => ({ email, name }))
      );
    })();
  }, [userId]);

  return { contacts, addContacts };
}

/** Autocomplete logic for a comma-separated email field */
function useEmailAutocomplete(contacts: Contact[], multi = true) {
  const [suggestions, setSuggestions] = useState<Contact[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);

  const getSuggestions = useCallback(
    (value: string) => {
      const lastToken = multi
        ? (value.split(",").pop()?.trim() ?? "")
        : value.trim();
      if (lastToken.length < 1) { setSuggestions([]); return; }
      const lower = lastToken.toLowerCase();
      const filtered = contacts.filter(
        (c) =>
          c.email.toLowerCase().includes(lower) ||
          c.name.toLowerCase().includes(lower)
      );

      // Build domain group suggestions: when 2+ contacts share a domain that matches the query,
      // offer a one-click "Add all @domain (N)" option.
      const domainGroups = new Map<string, string[]>();
      for (const c of filtered) {
        const atIdx = c.email.indexOf("@");
        if (atIdx < 0) continue;
        const domain = c.email.slice(atIdx + 1).toLowerCase();
        if (!domainGroups.has(domain)) domainGroups.set(domain, []);
        domainGroups.get(domain)!.push(c.email);
      }
      const groupSuggestions: Contact[] = [];
      for (const [domain, emails] of domainGroups) {
        if (emails.length >= 2) {
          groupSuggestions.push({
            email: `__group__@${domain}`,
            name: `Add all @${domain} (${emails.length})`,
            _groupEmails: emails,
          });
        }
      }

      setSuggestions([...groupSuggestions, ...filtered.slice(0, 6)]);
      setActiveIdx(0);
    },
    [contacts, multi]
  );

  const applySuggestion = useCallback(
    (value: string, contact: Contact) => {
      if (contact._groupEmails) {
        // Replace the current token with all group emails
        if (multi) {
          const parts = value.split(",");
          parts[parts.length - 1] = " " + contact._groupEmails.join(", ");
          setSuggestions([]);
          return parts.join(",").replace(/^ /, "");
        } else {
          setSuggestions([]);
          return contact._groupEmails[0] ?? "";
        }
      }
      if (multi) {
        const parts = value.split(",");
        parts[parts.length - 1] = " " + contact.email;
        setSuggestions([]);
        return parts.join(",").replace(/^ /, "");
      } else {
        setSuggestions([]);
        return contact.email;
      }
    },
    [multi]
  );

  const clear = useCallback(() => setSuggestions([]), []);

  return { suggestions, activeIdx, setActiveIdx, getSuggestions, applySuggestion, clear };
}

/**
 * A controlled email input with autocomplete dropdown.
 * - `multi` (default true): comma-separated list of addresses
 * - `multi=false`: single address
 * - `label` is optional; omit for a plain input
 */
export function EmailField({
  label,
  value,
  onChange,
  contacts,
  className,
  suffix,
  placeholder,
  multi = true,
  inputClassName,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  contacts: Contact[];
  className?: string;
  suffix?: React.ReactNode;
  placeholder?: string;
  multi?: boolean;
  inputClassName?: string;
}) {
  const { suggestions, activeIdx, setActiveIdx, getSuggestions, applySuggestion, clear } =
    useEmailAutocomplete(contacts, multi);
  const ref = useRef<HTMLInputElement>(null);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!suggestions.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      onChange(applySuggestion(value, suggestions[activeIdx]));
    } else if (e.key === "Escape") { clear(); }
  };

  return (
    <div className={`relative ${label ? "flex items-center gap-2" : ""} ${className ?? ""}`}>
      {label && (
        <span className="text-xs text-[var(--muted)] w-8 shrink-0">{label}</span>
      )}
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); getSuggestions(e.target.value); }}
        onKeyDown={handleKey}
        onBlur={() => setTimeout(clear, 150)}
        placeholder={placeholder}
        className={
          inputClassName ??
          (label
            ? "flex-1 px-2 py-1.5 border-b border-[var(--border)] bg-transparent text-sm focus:outline-none focus:border-[var(--accent)]"
            : "w-full px-3 py-1.5 rounded-lg border border-[var(--border)] bg-transparent text-sm focus:outline-none")
        }
      />
      {suffix}
      {suggestions.length > 0 && (
        <div
          className={`absolute ${label ? "left-10" : "left-0"} top-full z-50 w-80 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg overflow-hidden text-[var(--foreground)]`}
        >
          {suggestions.map((c, i) => (
            <button
              key={c.email}
              type="button"
              onMouseDown={() => onChange(applySuggestion(value, c))}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-[var(--surface-2)] ${i === activeIdx ? "bg-[var(--surface-2)]" : ""}`}
            >
              <span className="material-symbols-outlined text-[var(--muted)]" style={{ fontSize: "14px" }}>
                {c._groupEmails ? "group" : "person"}
              </span>
              <span className="truncate">
                {c._groupEmails ? (
                  <span className="font-medium text-[var(--accent)]">{c.name}</span>
                ) : (
                  <>
                    {c.name && <span className="font-medium">{c.name} </span>}
                    <span className="text-[var(--muted)]">{c.email}</span>
                  </>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
