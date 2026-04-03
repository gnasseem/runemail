"use client";

import { useState, useRef, useEffect, useMemo, Fragment } from "react";
import DOMPurify from "dompurify";
import { createClient } from "@/lib/supabase/client";
import { useApp } from "./AppShell";
import { initWebLLM, isWebLLMReady } from "@/lib/webllm";
import { emailGraph } from "@/lib/emailGraph";

type EmailDetailProps = {
  email: any;
  onBack: () => void;
  onArchive: () => void;
  onReply: () => void;
  onMarkUnread?: () => void;
  onSnooze?: () => void;
  onRethink?: (updated: any) => void;
};

const CATEGORIES = ["important", "action-required", "newsletter", "informational"];

const categoryColorMap: Record<string, string> = {
  important: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  "action-required": "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  newsletter: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  informational: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};

const SNOOZE_OPTIONS = [
  { label: "1 hour", hours: 1 },
  { label: "3 hours", hours: 3 },
  { label: "Tomorrow morning", hours: 16 },
  { label: "Next week", hours: 168 },
];

function fixMojibake(str: string): string {
  // No high bytes — nothing to fix
  if (!/[\x80-\xFF]/.test(str)) return str;

  // If all chars are in byte range (≤0xFF), convert the whole string at once
  if (!/[^\x00-\xFF]/.test(str)) {
    try { return decodeURIComponent(escape(str)); } catch { return str; }
  }

  // Mixed: some chars are already proper Unicode (>0xFF), some are mojibake bytes.
  // Fix only the byte-range segments so we don't corrupt the already-correct chars.
  let result = "";
  let byteSegment = "";
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code <= 0xFF) {
      byteSegment += str[i];
    } else {
      if (byteSegment) {
        try { result += decodeURIComponent(escape(byteSegment)); }
        catch { result += byteSegment; }
        byteSegment = "";
      }
      result += str[i];
    }
  }
  if (byteSegment) {
    try { result += decodeURIComponent(escape(byteSegment)); }
    catch { result += byteSegment; }
  }
  return result;
}

// ── Plain-text linkifier ─────────────────────────────────────────────────────

function linkify(text: string) {
  const URL_RE = /(https?:\/\/\S+)/g;
  const parts = text.split(URL_RE);
  return parts.map((part, i) =>
    URL_RE.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer"
         className="text-blue-400 dark:text-blue-400 underline break-all hover:text-blue-300">
        {part}
      </a>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    )
  );
}

// ── Dark-mode email color adaptation ────────────────────────────────────────

function parseRgb(color: string): [number, number, number] | null {
  const s = color.trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)))
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  if ((m = s.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i)))
    return [parseInt(m[1] + m[1], 16), parseInt(m[2] + m[2], 16), parseInt(m[3] + m[3], 16)];
  if ((m = s.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i)))
    return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
  const named: Record<string, [number, number, number]> = { black: [0, 0, 0], white: [255, 255, 255] };
  return named[s.toLowerCase()] ?? null;
}

function relLum([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function lightenColor([r, g, b]: [number, number, number]): string {
  // Convert to HSL, push lightness to 0.82 to make dark colors visible on dark bg
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return '#d1d5db'; // achromatic gray
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  // Rebuild with L=0.82, capped saturation
  const newL = 0.82, newS = Math.min(s, 0.65);
  const a = newS * Math.min(newL, 1 - newL);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return Math.round((newL - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)) * 255)
      .toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function adaptEmailForDarkMode(html: string): string {
  if (typeof window === 'undefined') return html;
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const walk = (el: Element): void => {
      if (el instanceof HTMLElement) {
        // Fix inline text color that's too dark for dark bg
        if (el.style.color) {
          const rgb = parseRgb(el.style.color);
          if (rgb && relLum(rgb) < 0.25) el.style.color = lightenColor(rgb);
        }
        // Fix legacy color attribute
        const cAttr = el.getAttribute('color');
        if (cAttr && !el.style.color) {
          const rgb = parseRgb(cAttr);
          if (rgb && relLum(rgb) < 0.25) el.setAttribute('color', lightenColor(rgb));
        }
        // Fix near-white inline background
        if (el.style.backgroundColor) {
          const rgb = parseRgb(el.style.backgroundColor);
          if (rgb && relLum(rgb) > 0.85) el.style.backgroundColor = '#202124';
        }
        // Fix legacy bgcolor attribute
        const bgAttr = el.getAttribute('bgcolor');
        if (bgAttr && !el.style.backgroundColor) {
          const rgb = parseRgb(bgAttr);
          if (rgb && relLum(rgb) > 0.85) el.setAttribute('bgcolor', '#202124');
        }
      }
      for (const child of el.children) walk(child);
    };
    if (doc.body) walk(doc.body);
    return doc.documentElement.outerHTML;
  } catch { return html; }
}

function buildEmailSrcDoc(html: string, isDark: boolean): string {
  let content = fixMojibake(html);
  if (isDark) content = adaptEmailForDarkMode(content);
  const lightCss = `body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:8px;word-break:break-word}`;
  // No !important on `a` so inline button styles (color:white) win over this fallback
  const darkCss = isDark ? `
    html,body{background:#202124!important;color:#e5e7eb!important}
    a{color:#60a5fa}
    img{opacity:.85}
  ` : '';
  const style = `<style>${lightCss}${darkCss}</style>`;
  if (content.includes('</head>')) return content.replace('</head>', `${style}</head>`);
  if (content.includes('<body')) return content.replace('<body', `${style}<body`);
  return style + content;
}

function EmailFrame({ html, isDark }: { html: string; isDark: boolean }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);
  const srcDoc = useMemo(() => buildEmailSrcDoc(html, isDark), [html, isDark]);

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

export default function EmailDetail({
  email,
  onBack,
  onArchive,
  onReply,
  onMarkUnread,
  onSnooze,
  onRethink,
}: EmailDetailProps) {
  const { user, profile, openCompose, addToast, theme, setView } = useApp();
  const supabase = createClient();

  const [proc, setProc] = useState<any>(
    Array.isArray(email.email_processed)
      ? email.email_processed[0]
      : email.email_processed,
  );
  const [categoryOverride, setCategoryOverride] = useState("");
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);
  const [showTagMenu, setShowTagMenu] = useState(false);
  const [userTags, setUserTags] = useState<{ slug: string; display_name: string; color: string }[]>([]);
  const [emailTags, setEmailTags] = useState<string[]>(
    Array.isArray(proc?.extra_labels) ? proc.extra_labels : []
  );
  const tagRef = useRef<HTMLDivElement>(null);
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);
  const [rethinking, setRethinking] = useState(false);
  const [extractingTodos, setExtractingTodos] = useState(false);
  const [addedTodos, setAddedTodos] = useState<Set<string>>(new Set());
  const [analyzingEmail, setAnalyzingEmail] = useState(false);
  const snoozeRef = useRef<HTMLDivElement>(null);
  const catRef = useRef<HTMLDivElement>(null);

  type ContactMemory = {
    interaction_count: number;
    relationship_notes: string | null;
    last_subject: string | null;
    last_interaction_at: string | null;
  };
  const [contactMemory, setContactMemory] = useState<ContactMemory | null>(null);

  // Load contact history from email_memory
  useEffect(() => {
    if (!email.sender_email) return;
    supabase
      .from("email_memory")
      .select("interaction_count, relationship_notes, last_subject, last_interaction_at")
      .eq("user_id", user.id)
      .eq("sender_email", email.sender_email)
      .maybeSingle()
      .then(({ data }) => { if (data) setContactMemory(data as ContactMemory); });
  }, [email.sender_email, user.id]);

  // Load user tags
  useEffect(() => {
    supabase.from("categories").select("slug, display_name, color").eq("user_id", user.id).then(({ data }) => {
      if (data) setUserTags(data as { slug: string; display_name: string; color: string }[]);
    });
  }, [user.id]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (snoozeRef.current && !snoozeRef.current.contains(e.target as Node))
        setShowSnoozeMenu(false);
      if (catRef.current && !catRef.current.contains(e.target as Node))
        setShowCategoryMenu(false);
      if (tagRef.current && !tagRef.current.contains(e.target as Node))
        setShowTagMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/api";

  const getAuthHeaders = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token}`,
    };
  };

  const currentCategory = categoryOverride || proc?.category;

  const overrideCategory = async (newCategory: string) => {
    setCategoryOverride(newCategory);
    setShowCategoryMenu(false);

    // Update local state and notify parent immediately
    const updatedProc = { ...proc, category: newCategory };
    setProc(updatedProc);
    onRethink?.(updatedProc);

    await supabase
      .from("email_processed")
      .update({ category: newCategory })
      .eq("email_id", email.id);

    // Learn category rules
    const subject = email.subject || "";
    const senderDomain = (email.sender_email || "").split("@")[1];
    if (subject) {
      await supabase.from("category_rules").upsert(
        { user_id: user.id, match_type: "subject", match_value: subject.split(" ").slice(0, 3).join(" ").toLowerCase(), category_slug: newCategory, hits: 1 },
        { onConflict: "user_id,match_type,match_value" },
      );
    }
    if (senderDomain) {
      await supabase.from("category_rules").upsert(
        { user_id: user.id, match_type: "domain", match_value: senderDomain, category_slug: newCategory, hits: 1 },
        { onConflict: "user_id,match_type,match_value" },
      );
    }
    addToast("success", `Category changed to "${newCategory}"`);
  };

  const toggleTag = async (slug: string) => {
    const updated = emailTags.includes(slug)
      ? emailTags.filter((t) => t !== slug)
      : [...emailTags, slug];
    setEmailTags(updated);
    await supabase.from("email_processed").update({ extra_labels: updated }).eq("email_id", email.id);
    // Notify parent (InboxView) so the sidebar card updates immediately
    onRethink?.({ ...proc, extra_labels: updated });
  };

  const handleMarkUnread = async () => {
    await supabase.from("emails").update({ is_read: false }).eq("id", email.id);
    addToast("info", "Marked as unread");
    onMarkUnread?.();
  };

  const handleSnooze = async (hours: number, label: string) => {
    const until = new Date(Date.now() + hours * 3600 * 1000).toISOString();
    // Persist to DB for cross-device sync
    await supabase.from("emails").update({ is_snoozed: true, snooze_until: until }).eq("id", email.id);
    // Keep localStorage as fast local cache
    localStorage.setItem(`snooze:${email.id}`, until);
    setShowSnoozeMenu(false);
    addToast("success", `Snoozed until ${label}`);
    onSnooze?.();
  };

  const handleRethink = async () => {
    setRethinking(true);
    const aiMode = profile?.ai_mode || "cloud";

    // ── Local rethink via graph ──────────────────────────────────────────────
    if (aiMode === "local" || aiMode === "hybrid") {
      try {
        const ready = await initWebLLM();
        if (ready && isWebLLMReady()) {
          const result = await emailGraph.invoke({
            task: "rethink",
            currentEmail: {
              id: email.id,
              subject: email.subject || "",
              sender: email.sender || "",
              snippet: email.snippet || "",
              body_text: email.body_text || email.body || "",
            },
          });

          if (!result.error) {
            const updated = {
              category: result.category || proc?.category,
              summary: result.summary || proc?.summary,
              quick_actions: result.quickActions || proc?.quick_actions,
            };
            // Persist to DB
            await supabase
              .from("email_processed")
              .upsert({ email_id: email.id, ...updated }, { onConflict: "email_id" });
            setProc(updated);
            onRethink?.(updated);
            addToast("success", "AI analysis refreshed (local)");
            setRethinking(false);
            return;
          }
        }
        if (aiMode === "local") {
          addToast("error", "Local AI not ready. Make sure the model is loaded.");
          setRethinking(false);
          return;
        }
      } catch (err) {
        console.error("Local rethink failed:", err);
        if (aiMode === "local") {
          addToast("error", "Local AI error.");
          setRethinking(false);
          return;
        }
      }
    }

    // ── Cloud rethink ─────────────────────────────────────────────────────────
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${apiUrl}/rethink-email`, {
        method: "POST",
        headers,
        body: JSON.stringify({ email_id: email.id }),
      });
      if (res.ok) {
        const updated = await res.json();
        setProc(updated);
        onRethink?.(updated);
        addToast("success", "AI analysis refreshed");
      } else {
        addToast("error", "Rethink failed");
      }
    } catch {
      addToast("error", "Network error");
    }
    setRethinking(false);
  };

  const handleExtractTodos = async () => {
    setExtractingTodos(true);
    const aiMode = profile?.ai_mode || "cloud";

    // ── Local extraction via graph ────────────────────────────────────────────
    if (aiMode === "local" || aiMode === "hybrid") {
      try {
        const ready = await initWebLLM();
        if (ready && isWebLLMReady()) {
          const result = await emailGraph.invoke({
            task: "todos",
            emails: [{
              id: email.id,
              subject: email.subject || "",
              sender: email.sender || "",
              snippet: email.snippet || "",
              body_text: email.body_text || email.body || "",
            }],
          });

          const suggestions = result.todoSuggestions || [];
          if (suggestions.length > 0) {
            await supabase.from("todos").insert(
              suggestions.map((s) => ({ user_id: user.id, text: s.task, source: "email" }))
            );
            addToast("success", `Added ${suggestions.length} task${suggestions.length > 1 ? "s" : ""} to Todos`);
          } else {
            addToast("info", "No actionable tasks found in this email");
          }
          setExtractingTodos(false);
          return;
        }
        if (aiMode === "local") {
          addToast("error", "Local AI not ready.");
          setExtractingTodos(false);
          return;
        }
      } catch (err) {
        console.error("Local extract todos failed:", err);
        if (aiMode === "local") {
          addToast("error", "Local AI error.");
          setExtractingTodos(false);
          return;
        }
      }
    }

    // ── Cloud extraction ──────────────────────────────────────────────────────
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${apiUrl}/extract-todos`, {
        method: "POST",
        headers,
        body: JSON.stringify({ email_id: email.id }),
      });
      if (res.ok) {
        const data = await res.json();
        const count = data.count ?? 0;
        addToast("success", count > 0 ? `Added ${count} task${count > 1 ? "s" : ""} to Todos` : "No actionable tasks found");
      } else {
        addToast("error", "Could not extract tasks");
      }
    } catch {
      addToast("error", "Network error");
    }
    setExtractingTodos(false);
  };

  const addTodoFromChip = async (task: string) => {
    await supabase.from("todos").insert({ user_id: user.id, text: task, source: "email" });
    setAddedTodos((prev) => new Set([...prev, task]));
    addToast("success", "Added to Todos");
  };

  const generateSuggestions = async () => {
    setAnalyzingEmail(true);
    try {
      const ready = await initWebLLM();
      if (!ready) { addToast("error", "Local AI not ready"); setAnalyzingEmail(false); return; }
      const result = await emailGraph.invoke({
        task: "process_email",
        currentEmail: { id: email.id, subject: email.subject || "", sender: email.sender || "", snippet: email.snippet || "", body_text: email.body_text || "" },
      });
      const updated = {
        category: result.category || proc?.category || "informational",
        summary: result.summary || proc?.summary || null,
        quick_actions: result.quickActions || [],
      };
      await supabase.from("email_processed").upsert({ user_id: user.id, email_id: email.id, ...updated }, { onConflict: "email_id" });
      setProc(updated);
      onRethink?.(updated);
    } catch { addToast("error", "Analysis failed"); }
    setAnalyzingEmail(false);
  };

  const handleQuickAction = (action: any) => {
    const label = (action.label || action.text || action || "").toLowerCase();
    if (label.includes("forward")) {
      openCompose({ ...email, sender_email: "", subject: `Fwd: ${email.subject}` });
    } else {
      openCompose({ ...email, _prefillBody: action.text || "", _autoGenerate: !!(action.text) });
    }
  };

  const senderEmailLc = (email.sender_email || "").toLowerCase();
  const isNoreply = /no.?reply|do.not.reply|noreply|mailer-daemon|postmaster/.test(senderEmailLc);
  const replyActions = isNoreply ? [] : (proc?.quick_actions || []).filter((qa: any) => qa.action === "reply");
  const meetingActions = (proc?.quick_actions || []).filter((qa: any) => qa.action === "schedule_meeting");
  const todoActions = (proc?.quick_actions || []).filter((qa: any) => qa.action === "add_todo");
  const hasNoActions = !proc?.quick_actions || proc.quick_actions.length === 0;
  // Only show the panel when there are actual actions to render.
  // If the AI ran and returned [] it made a deliberate decision — hide the panel.
  const hasActions = replyActions.length > 0 || meetingActions.length > 0 || todoActions.length > 0;
  const showSuggestionsPanel = hasActions && (!isNoreply || meetingActions.length > 0 || todoActions.length > 0);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[var(--background)]">

      {/* ── Compact header ── */}
      <div className="px-3 py-1.5 flex-shrink-0 border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={onBack} className="md:hidden p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0">
            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>arrow_back</span>
          </button>
          <div className="min-w-0 flex-1">
            {/* Sender + subject + time + badges — first line */}
            <div className="flex items-center gap-2 min-w-0">
              <p className="text-[12px] font-semibold text-[var(--foreground)] shrink-0 max-w-[35%] truncate">
                {(email.sender ?? "").replace(/<.*>/, "").trim() || email.sender_email || "Unknown"}
              </p>
              <p className="text-[11px] text-[var(--muted)] truncate flex-1 min-w-0">
                {email.subject || "(no subject)"}
              </p>
              <div className="flex items-center gap-0.5 shrink-0">
                {/* Category badge + dropdown */}
                <div ref={catRef} className="relative">
                  <button
                    onClick={() => { setShowCategoryMenu(!showCategoryMenu); setShowTagMenu(false); }}
                    className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium ${categoryColorMap[currentCategory] || "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}
                    title="Change category"
                  >
                    {currentCategory || "uncategorized"}
                    <span className="material-symbols-outlined" style={{ fontSize: "10px" }}>arrow_drop_down</span>
                  </button>
                  {showCategoryMenu && (
                    <div className="absolute right-0 top-full mt-1 bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-lg p-1 z-20 min-w-[160px]">
                      {CATEGORIES.map((cat) => (
                        <button key={cat} onClick={() => overrideCategory(cat)}
                          className={`w-full text-left px-2.5 py-1.5 text-xs rounded flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800`}>
                          <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${categoryColorMap[cat]?.includes("red") ? "bg-red-500" : categoryColorMap[cat]?.includes("orange") ? "bg-orange-500" : categoryColorMap[cat]?.includes("purple") ? "bg-purple-500" : "bg-blue-500"}`} />
                          <span className={`flex-1 ${categoryColorMap[cat] || ""} px-1 py-0.5 rounded text-[10px] font-medium ${currentCategory === cat ? "font-bold" : ""}`}>{cat}</span>
                          {currentCategory === cat && <span className="material-symbols-outlined text-[var(--accent)]" style={{ fontSize: "12px" }}>check</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {/* Tag + button */}
                <div ref={tagRef} className="relative">
                  <button
                    onClick={() => { setShowTagMenu(!showTagMenu); setShowCategoryMenu(false); }}
                    className="flex items-center p-0.5 rounded text-[var(--muted)] hover:bg-slate-100 dark:hover:bg-slate-700"
                    title="Add tag"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>add</span>
                  </button>
                  {showTagMenu && (
                    <div className="absolute right-0 top-full mt-1 bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-lg p-2 z-20 min-w-[160px]">
                      <p className="text-[10px] text-[var(--muted)] font-semibold uppercase tracking-wide mb-1.5 px-1">Tags</p>
                      {userTags.length === 0 ? (
                        <p className="text-xs text-[var(--muted)] px-1 py-1">No tags yet. Create tags in Categories.</p>
                      ) : (
                        userTags.map((tag) => {
                          const active = emailTags.includes(tag.slug);
                          return (
                            <button key={tag.slug} onClick={() => toggleTag(tag.slug)}
                              className="w-full text-left px-2 py-1.5 text-xs rounded flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                              <span className="flex-1 text-slate-900 dark:text-white">{tag.display_name}</span>
                              {active && <span className="material-symbols-outlined text-[var(--accent)]" style={{ fontSize: "12px" }}>check</span>}
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              </div>
              {/* Applied tags */}
              {emailTags.length > 0 && emailTags.map((slug) => {
                const tag = userTags.find((t) => t.slug === slug);
                if (!tag) return null;
                return (
                  <span key={slug} className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium shrink-0"
                    style={{ backgroundColor: `${tag.color}20`, color: tag.color, boxShadow: `inset 0 0 0 1px ${tag.color}40` }}>
                    {tag.display_name}
                  </span>
                );
              })}
              {email.has_attachments && (
                <span className="material-symbols-outlined text-[var(--muted)] shrink-0" style={{ fontSize: "12px" }} title="Has attachments">attachment</span>
              )}
              <span className="text-[10px] text-[var(--muted)] shrink-0 tabular-nums">
                {new Date(email.received_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            {/* AI summary — second line, full text */}
            {proc?.summary && (
              <div className="mt-1 px-2 py-1 rounded-md bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border border-blue-100 dark:border-blue-900/40 flex items-start gap-1.5 min-w-0">
                <span className="material-symbols-outlined shrink-0 mt-px text-blue-500 dark:text-blue-400" style={{ fontSize: "12px", fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
                <p className="text-[11px] font-medium text-blue-700 dark:text-blue-300 leading-snug">{proc.summary}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Email body — minimal border ── */}
      <div className="flex-1 overflow-auto px-4 py-3">
        <div className="border-l-2 border-[var(--border)] pl-3">
          {email.body_html ? (
            <div className="rounded-md overflow-hidden">
              <EmailFrame html={DOMPurify.sanitize(email.body_html)} isDark={theme === "dark"} />
            </div>
          ) : (
            <pre className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300 font-sans leading-relaxed">
              {email.body_text ? linkify(email.body_text) : "(no content)"}
            </pre>
          )}
        </div>
      </div>

      {/* ── Attachments ── */}
      {Array.isArray(email.attachments) && email.attachments.length > 0 && (
        <div className="px-4 pb-3 flex-shrink-0 border-t border-[var(--border)]">
          <p className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-2 pt-2.5">
            Attachments ({email.attachments.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {(email.attachments as { filename: string; mime_type: string; size: number; attachment_id: string }[]).map((att, i) => (
              <button
                key={i}
                onClick={async () => {
                  try {
                    const headers = await getAuthHeaders();
                    const res = await fetch(
                      `${apiUrl}/attachment?gmail_id=${encodeURIComponent(email.gmail_id)}&attachment_id=${encodeURIComponent(att.attachment_id)}`,
                      { headers: { Authorization: headers.Authorization } },
                    );
                    if (!res.ok) { addToast("error", "Failed to download attachment"); return; }
                    const { data } = await res.json();
                    const base64 = (data as string).replace(/-/g, "+").replace(/_/g, "/");
                    const binary = atob(base64);
                    const bytes = new Uint8Array(binary.length);
                    for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
                    const blob = new Blob([bytes], { type: att.mime_type || "application/octet-stream" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = att.filename;
                    a.click();
                    URL.revokeObjectURL(url);
                  } catch { addToast("error", "Download failed"); }
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group"
              >
                <span className="material-symbols-outlined text-[var(--muted)] group-hover:text-[var(--accent)]" style={{ fontSize: "15px" }}>
                  {att.mime_type?.startsWith("image/") ? "image" : att.mime_type?.includes("pdf") ? "picture_as_pdf" : "attach_file"}
                </span>
                <div className="min-w-0 text-left">
                  <p className="text-[11px] font-medium text-[var(--foreground)] truncate max-w-[160px]">{att.filename}</p>
                  <p className="text-[9px] text-[var(--muted)]">
                    {att.size > 1024 * 1024 ? `${(att.size / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(att.size / 1024)} KB`}
                  </p>
                </div>
                <span className="material-symbols-outlined text-[var(--muted)] shrink-0" style={{ fontSize: "13px" }}>download</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── AI Suggestions Panel ── */}
      {showSuggestionsPanel && (
        <div className="px-3 pt-2.5 pb-2 border-t border-[var(--border)] flex-shrink-0 bg-gradient-to-b from-[var(--surface)] to-[var(--background)]">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="material-symbols-outlined text-indigo-400 dark:text-indigo-500" style={{ fontSize: "13px", fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
            <span className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">AI Suggestions</span>
          </div>

          <div className="flex flex-col gap-2">
              {/* Reply suggestions */}
              {replyActions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {replyActions.map((qa: any, i: number) => {
                    const label = (qa.label || "").replace(/^Reply:\s*/i, "");
                    const prefill = qa.text || label;
                    return (
                      <button key={i}
                        onClick={() => openCompose({ ...email, _prefillBody: prefill, _autoGenerate: true })}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-[11px] font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                        title={label}
                      >
                        <span className="material-symbols-outlined text-blue-400" style={{ fontSize: "12px" }}>chat_bubble</span>
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Meeting scheduling suggestions */}
              {meetingActions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {meetingActions.map((qa: any, i: number) => {
                    const label = (qa.label || "").replace(/^Schedule:\s*/i, "");
                    return (
                      <button key={i}
                        onClick={() => setView("meetings")}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors"
                        title={label}
                      >
                        <span className="material-symbols-outlined text-emerald-500" style={{ fontSize: "12px" }}>event_upcoming</span>
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Todo suggestions */}
              {todoActions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {todoActions.map((qa: any, i: number) => {
                    const task = (qa.label || "").replace(/^Todo:\s*/i, "");
                    const added = addedTodos.has(task);
                    return (
                      <button key={i} onClick={() => !added && addTodoFromChip(task)} disabled={added}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-medium transition-all ${
                          added
                            ? "border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-950/40 dark:text-green-400 cursor-default"
                            : "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50"
                        }`}
                        title={task}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: "13px", fontVariationSettings: added ? "'FILL' 1" : "'FILL' 0" }}>
                          {added ? "check_circle" : "add_task"}
                        </span>
                        <span>{task}</span>
                      </button>
                    );
                  })}
                </div>
              )}
          </div>
        </div>
      )}

      {/* ── Action bar ── */}
      <div className="px-3 py-1.5 border-t border-[var(--border)] flex-shrink-0 flex items-center gap-1.5 flex-wrap">
        {/* Reply button — always visible */}
        <button
          onClick={() => onReply()}
          className="flex items-center gap-1 px-2 py-1 rounded-lg border border-[var(--border)] text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
        >
          <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>reply</span>
          Reply
        </button>

        {/* Reply All — show when the email had multiple recipients or CC */}
        {(email.recipients || email.cc_recipients) && (
          <button
            onClick={() => openCompose({ ...email, _replyAll: true })}
            className="flex items-center gap-1 px-2 py-1 rounded-lg border border-[var(--border)] text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
          >
            <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>reply_all</span>
            Reply All
          </button>
        )}

        <div className="flex-1" />

        {/* Action buttons */}
        <button
          onClick={() => openCompose({ ...email, sender_email: "", subject: `Fwd: ${email.subject}` })}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
        >
          <span className="material-symbols-outlined" style={{ fontSize: "13px" }}>forward_to_inbox</span>
          Delegate
        </button>
        <button
          onClick={handleMarkUnread}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <span className="material-symbols-outlined" style={{ fontSize: "13px" }}>mark_email_unread</span>
          Unread
        </button>
        <div ref={snoozeRef} className="relative">
          <button
            onClick={() => setShowSnoozeMenu(!showSnoozeMenu)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <span className="material-symbols-outlined" style={{ fontSize: "13px" }}>snooze</span>
            Snooze
          </button>
          {showSnoozeMenu && (
            <div className="absolute bottom-full mb-1 right-0 bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-lg p-1 z-20 min-w-[160px]">
              {SNOOZE_OPTIONS.map((opt) => (
                <button key={opt.hours} onClick={() => handleSnooze(opt.hours, opt.label)}
                  className="w-full text-left px-3 py-1.5 text-xs rounded hover:bg-slate-100 dark:hover:bg-slate-800">
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={onArchive}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
        >
          <span className="material-symbols-outlined" style={{ fontSize: "13px" }}>archive</span>
          Archive
        </button>
      </div>

    </div>
  );
}
