"use client";

import { useState, useRef, useEffect, useMemo, Fragment } from "react";
import DOMPurify from "dompurify";

// Module-level attachment blob cache -- survives across email navigations
const attachmentBlobCache = new Map<
  string,
  { blobUrl: string; blob: Blob; text: string | null; sheetHtml: string | null }
>();

import { createClient } from "@/lib/supabase/client";
import { useApp } from "./AppShell";
import { initWebLLM, isWebLLMReady } from "@/lib/webllm";
import { emailGraph } from "@/lib/emailGraph";
import DateTimePicker from "./DateTimePicker";

type EmailDetailProps = {
  email: any;
  onBack: () => void;
  onArchive: () => void;
  onReply: () => void;
  onMarkUnread?: () => void;
  onSnooze?: () => void;
  onRethink?: (updated: any) => void;
};

const CATEGORIES = [
  "important",
  "action-required",
  "newsletter",
  "informational",
];

const categoryColorMap: Record<string, string> = {
  important: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  "action-required":
    "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  newsletter:
    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  informational:
    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
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
    try {
      return decodeURIComponent(escape(str));
    } catch {
      return str;
    }
  }

  // Mixed: some chars are already proper Unicode (>0xFF), some are mojibake bytes.
  // Fix only the byte-range segments so we don't corrupt the already-correct chars.
  let result = "";
  let byteSegment = "";
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code <= 0xff) {
      byteSegment += str[i];
    } else {
      if (byteSegment) {
        try {
          result += decodeURIComponent(escape(byteSegment));
        } catch {
          result += byteSegment;
        }
        byteSegment = "";
      }
      result += str[i];
    }
  }
  if (byteSegment) {
    try {
      result += decodeURIComponent(escape(byteSegment));
    } catch {
      result += byteSegment;
    }
  }
  return result;
}

// ── Strip quoted reply chains ────────────────────────────────────────────────

function stripQuotedHtml(html: string): string {
  if (typeof window === "undefined") return html;
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");

    // Remove blockquotes (quoted previous messages)
    doc.querySelectorAll("blockquote").forEach((el) => el.remove());

    // Remove Gmail quote divs
    doc
      .querySelectorAll(".gmail_quote, .gmail_attr, [class*='quote']")
      .forEach((el) => el.remove());

    // Remove "On [date], [person] wrote:" attribution lines that precede quotes.
    // These are usually the last <div> or <p> containing that pattern.
    const attributionRe = /On .{5,80}wrote:/i;
    doc.querySelectorAll("div, p, span").forEach((el) => {
      if (
        attributionRe.test(el.textContent || "") &&
        !el.querySelector("blockquote")
      ) {
        // Only remove leaf-level or near-leaf attributions
        if ((el.textContent || "").trim().length < 400) el.remove();
      }
    });

    // Trim trailing <br>/<hr> left over
    const body = doc.body;
    let last = body.lastChild;
    while (
      last &&
      (last.nodeName === "BR" ||
        last.nodeName === "HR" ||
        (last.nodeType === 3 && !(last.textContent || "").trim()))
    ) {
      const prev = last.previousSibling;
      body.removeChild(last);
      last = prev;
    }

    return body.innerHTML.trim();
  } catch {
    return html;
  }
}

function stripQuotedText(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^>/.test(line)) break;
    // Attribution lines can span 1-3 lines (Gmail wraps long email addresses mid-line).
    // Join a window of up to 4 lines and check if "wrote:" appears anywhere in it.
    if (/^On /i.test(line.trim())) {
      const chunk = lines.slice(i, Math.min(i + 4, lines.length)).join(" ");
      if (/wrote:/.test(chunk)) break;
    }
    result.push(line);
  }
  return result.join("\n").trimEnd();
}

// ── Plain-text linkifier ─────────────────────────────────────────────────────

function linkify(text: string) {
  const URL_RE = /(https?:\/\/\S+)/g;
  const parts = text.split(URL_RE);
  return parts.map((part, i) =>
    URL_RE.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-400 dark:text-blue-400 underline break-all hover:text-blue-300"
      >
        {part}
      </a>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

const PURIFY_HTML = { USE_PROFILES: { html: true } } as const;

function looksLikeCssOnlyPlainText(s: string): boolean {
  const t = s.trim();
  if (t.length < 80) return false;
  if (!/[{};]/.test(t)) return false;
  const lines = t.split("\n").filter((l) => l.trim().length);
  if (lines.length < 2) return false;
  const cssy = lines.filter(
    (l) =>
      /[{}:;]/.test(l) &&
      (/\b(color|background|border|padding|margin|table\.|@media|font-|display|!important)\b/i.test(
        l,
      ) ||
        /^\s*[a-z#.][^{]*\{/i.test(l)),
  );
  return cssy.length / lines.length > 0.45;
}

function hasVisibleContentFromHtml(safeHtml: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    const doc = new DOMParser().parseFromString(safeHtml, "text/html");
    const b = doc.body;
    if (!b) return false;
    if (b.querySelector("img, picture, video, table, svg, canvas")) return true;
    return (b.textContent || "").replace(/\s+/g, " ").trim().length > 0;
  } catch {
    return true;
  }
}

function safeEmailHtml(html: string | null | undefined): string {
  if (!html || !String(html).trim()) return "";
  return stripQuotedHtml(DOMPurify.sanitize(html, PURIFY_HTML));
}

type ResolvedBody =
  | { kind: "html"; html: string }
  | { kind: "text"; text: string }
  | { kind: "snippet"; text: string }
  | { kind: "empty" };

function resolveEmailBodyDisplay(p: {
  body_html: string | null | undefined;
  body_text: string | null | undefined;
  snippet: string | null | undefined;
}): ResolvedBody {
  const safe = safeEmailHtml(p.body_html ?? null);
  if (safe && hasVisibleContentFromHtml(safe)) {
    return { kind: "html", html: safe };
  }
  const stripped = p.body_text ? stripQuotedText(p.body_text) : "";
  if (stripped && !looksLikeCssOnlyPlainText(stripped)) {
    return { kind: "text", text: stripped };
  }
  const sn = (p.snippet || "").trim();
  if (sn && !looksLikeCssOnlyPlainText(sn)) {
    return { kind: "snippet", text: sn };
  }
  if (safe) {
    return { kind: "html", html: safe };
  }
  return { kind: "empty" };
}

// ── Dark-mode email color adaptation ────────────────────────────────────────

function parseRgb(color: string): [number, number, number] | null {
  const s = color.trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)))
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  if ((m = s.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i)))
    return [
      parseInt(m[1] + m[1], 16),
      parseInt(m[2] + m[2], 16),
      parseInt(m[3] + m[3], 16),
    ];
  if ((m = s.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i)))
    return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
  const named: Record<string, [number, number, number]> = {
    black: [0, 0, 0],
    white: [255, 255, 255],
    red: [255, 0, 0],
    green: [0, 128, 0],
    blue: [0, 0, 255],
    yellow: [255, 255, 0],
    orange: [255, 165, 0],
    purple: [128, 0, 128],
    pink: [255, 192, 203],
    gray: [128, 128, 128],
    grey: [128, 128, 128],
    silver: [192, 192, 192],
    gold: [255, 215, 0],
    cyan: [0, 255, 255],
    lime: [0, 255, 0],
    teal: [0, 128, 128],
    navy: [0, 0, 128],
    maroon: [128, 0, 0],
    olive: [128, 128, 0],
  };
  return named[s.toLowerCase()] ?? null;
}

function relLum([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function toHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const rn = r / 255,
    gn = g / 255,
    bn = b / 255;
  const max = Math.max(rn, gn, bn),
    min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return Math.round((l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)) * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function lightenColor([r, g, b]: [number, number, number]): string {
  const [h, s] = toHsl([r, g, b]);
  if (s < 0.05) return "#d1d5db"; // achromatic gray
  return hslToHex(h, Math.min(s, 0.65), 0.82);
}



function adaptTextForDarkMode(html: string): string {
  if (typeof window === "undefined") return html;
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const walk = (el: Element): void => {
      if (el instanceof HTMLElement) {
        // Lighten explicit dark text colors
        if (el.style.color) {
          const rgb = parseRgb(el.style.color);
          if (rgb && relLum(rgb) < 0.25) el.style.color = lightenColor(rgb);
        }
        const cAttr = el.getAttribute("color");
        if (cAttr && !el.style.color) {
          const rgb = parseRgb(cAttr);
          if (rgb && relLum(rgb) < 0.25)
            el.setAttribute("color", lightenColor(rgb));
        }
        // Remove near-white/white backgrounds so the dark UI shows through
        if (el.style.backgroundColor) {
          const rgb = parseRgb(el.style.backgroundColor);
          if (rgb && relLum(rgb) > 0.7)
            el.style.backgroundColor = "transparent";
        }
        const bgAttr = el.getAttribute("bgcolor");
        if (bgAttr) {
          const rgb = parseRgb(bgAttr);
          if (rgb && relLum(rgb) > 0.7) el.removeAttribute("bgcolor");
        }
      }
      for (const child of el.children) walk(child);
    };
    if (doc.body) walk(doc.body);
    return doc.body.innerHTML;
  } catch {
    return html;
  }
}

function EmailBody({ html, isDark }: { html: string; isDark: boolean }) {
  const processed = useMemo(() => {
    const content = fixMojibake(html);
    return isDark ? adaptTextForDarkMode(content) : content;
  }, [html, isDark]);

  return (
    <div
      dangerouslySetInnerHTML={{ __html: processed }}
      style={{
        fontSize: "14px",
        lineHeight: "1.65",
        wordBreak: "break-word",
        overflowX: "auto",
        maxWidth: "100%",
        color: isDark ? "#e2e8f0" : undefined,
      }}
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
  const { user, profile, openCompose, addToast, theme, setView, setSearch } =
    useApp() as any;
  const supabase = createClient();

  const senderEmailAddr = email.sender_email || "";

  const [proc, setProc] = useState<any>(
    Array.isArray(email.email_processed)
      ? email.email_processed[0]
      : email.email_processed,
  );
  const [categoryOverride, setCategoryOverride] = useState("");
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);
  const [showTagMenu, setShowTagMenu] = useState(false);
  const [userTags, setUserTags] = useState<
    { slug: string; display_name: string; color: string }[]
  >([]);
  const [emailTags, setEmailTags] = useState<string[]>(
    Array.isArray(proc?.extra_labels) ? proc.extra_labels : [],
  );
  const tagRef = useRef<HTMLDivElement>(null);
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);
  // Follow-up tracking
  const [isTracked, setIsTracked] = useState(false);
  const [showTrackPopup, setShowTrackPopup] = useState(false);
  const [trackRemindAt, setTrackRemindAt] = useState<string>(() => {
    const d = new Date(Date.now() + 3 * 86_400_000);
    d.setHours(9, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`;
  });
  const [trackingSaving, setTrackingSaving] = useState(false);

  useEffect(() => {
    if (!email.thread_id) return;
    supabase
      .from("follow_up_reminders")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("thread_id", email.thread_id)
      .then(({ count }) => setIsTracked((count ?? 0) > 0));
  }, [email.thread_id, user.id]);

  // Preload attachments into the module-level cache so preview opens instantly.
  // Fires after mount; errors are silently swallowed — this is best-effort only.
  useEffect(() => {
    const atts = Array.isArray(email.attachments) ? email.attachments : [];
    if (atts.length === 0) return;
    const run = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      for (const att of atts as {
        filename: string;
        mime_type: string;
        size: number;
        attachment_id: string;
      }[]) {
        const cacheKey = `${email.gmail_id}::${att.attachment_id}`;
        if (attachmentBlobCache.has(cacheKey)) continue;
        // Skip large files (>10 MB) to avoid wasting bandwidth on preload.
        if (att.size > 10 * 1024 * 1024) continue;
        fetchAttachmentBlob(att).catch(() => {});
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email.id]);

  const trackFollowUp = async () => {
    if (trackingSaving) return;
    setTrackingSaving(true);
    const remindAt = new Date(trackRemindAt).toISOString();
    const recipients = (email.recipients || "")
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
    const firstRecipient = recipients[0] || email.recipients || "";
    const nameMatch = firstRecipient.match(/^(.*?)\s*<[^>]+>/);
    const emailMatch = firstRecipient.match(/<([^>]+)>/);
    const recipientEmail = emailMatch
      ? emailMatch[1]
      : firstRecipient.replace(/<.*>/, "").trim();
    const recipientName = nameMatch ? nameMatch[1].trim() : null;
    const { error } = await supabase.from("follow_up_reminders").upsert(
      {
        user_id: user.id,
        email_id: email.id,
        thread_id: email.thread_id || email.id,
        recipient_email: recipientEmail || email.recipients || "unknown",
        recipient_name: recipientName,
        subject: email.subject || "(no subject)",
        remind_at: remindAt,
        status: "waiting",
      },
      { onConflict: "user_id,thread_id" },
    );
    setTrackingSaving(false);
    setShowTrackPopup(false);
    if (!error) {
      setIsTracked(true);
      addToast("success", "Follow-up reminder set");
    } else addToast("error", "Failed to set reminder");
  };

  const [rethinking, setRethinking] = useState(false);
  const [extractingTodos, setExtractingTodos] = useState(false);
  const [addedTodos, setAddedTodos] = useState<Set<string>>(new Set());
  const [analyzingEmail, setAnalyzingEmail] = useState(false);
  type ThreadAtt = {
    filename: string;
    mime_type: string;
    size: number;
    attachment_id: string;
  };
  type ThreadEmail = {
    id: string;
    subject: string;
    sender: string;
    sender_email: string;
    received_at: string;
    body_html: string | null;
    body_text: string | null;
    snippet: string;
    is_read: boolean;
    gmail_id: string;
    has_attachments: boolean;
    attachments: ThreadAtt[];
  };
  const [threadEmails, setThreadEmails] = useState<ThreadEmail[]>([]);
  const [threadLoading, setThreadLoading] = useState(!!email.thread_id);
  type AttachmentPreviewState = {
    att: {
      filename: string;
      mime_type: string;
      size: number;
      attachment_id: string;
    };
    blobUrl: string | null;
    blob: Blob | null;
    text: string | null;
    sheetHtml: string | null;
    error: string | null;
  };
  const [previewAtt, setPreviewAtt] = useState<AttachmentPreviewState | null>(
    null,
  );
  const docxContainerRef = useRef<HTMLDivElement>(null);
  const snoozeRef = useRef<HTMLDivElement>(null);
  const catRef = useRef<HTMLDivElement>(null);

  // Fetch all thread emails for chat view
  useEffect(() => {
    setThreadLoading(!!email.thread_id);
    setThreadEmails([]);
    if (!email.thread_id) return;
    supabase
      .from("emails")
      .select(
        "id, subject, sender, sender_email, received_at, body_html, body_text, snippet, is_read, gmail_id, has_attachments, attachments",
      )
      .eq("user_id", user.id)
      .eq("thread_id", email.thread_id)
      .order("received_at", { ascending: true })
      .limit(20)
      .then(({ data }) => {
        setThreadLoading(false);
        if (data && data.length > 1) {
          setThreadEmails(data as ThreadEmail[]);
          // Preload thread attachments in the background.
          for (const msg of data as ThreadEmail[]) {
            const msgAtts = Array.isArray(msg.attachments) ? msg.attachments : [];
            for (const att of msgAtts) {
              if (att.size > 10 * 1024 * 1024) continue;
              fetchAttachmentBlob(att, msg.gmail_id).catch(() => {});
            }
          }
        }
      });
  }, [email.thread_id, email.id, user.id]);

  // Load user tags
  useEffect(() => {
    supabase
      .from("categories")
      .select("slug, display_name, color")
      .eq("user_id", user.id)
      .then(({ data }) => {
        if (data)
          setUserTags(
            data as { slug: string; display_name: string; color: string }[],
          );
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

  // Module-level cache doesn't need per-instance cleanup (blobs reused across emails)

  // Render docx into container when preview is ready
  useEffect(() => {
    if (!previewAtt?.blob || !docxContainerRef.current) return;
    if (!isDocxFile(previewAtt.att.mime_type, previewAtt.att.filename)) return;
    const container = docxContainerRef.current;
    container.innerHTML = "";
    import("docx-preview").then(({ renderAsync }) => {
      renderAsync(previewAtt.blob!, container, undefined, {
        className: "docx-preview",
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        ignoreFonts: false,
        breakPages: true,
        useBase64URL: true,
      }).catch(() => {
        container.innerHTML =
          "<p style='padding:16px;color:var(--muted);font-size:12px'>Failed to render document.</p>";
      });
    });
  }, [previewAtt?.blob, previewAtt?.att.attachment_id]);

  const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/api";

  const getAuthHeaders = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token}`,
    };
  };

  const isDocxFile = (mime: string, filename: string) =>
    mime?.includes("wordprocessingml") || /\.docx$/i.test(filename);

  const isExcelFile = (mime: string, filename: string) =>
    mime?.includes("spreadsheetml") ||
    mime === "application/vnd.ms-excel" ||
    /\.xlsx?$/i.test(filename);

  const fetchAttachmentBlob = async (
    att: {
      filename: string;
      mime_type: string;
      size: number;
      attachment_id: string;
    },
    gmailIdOverride?: string,
  ) => {
    const gid = gmailIdOverride || email.gmail_id;
    const cacheKey = `${gid}::${att.attachment_id}`;
    const cached = attachmentBlobCache.get(cacheKey);
    if (cached) return cached;
    const headers = await getAuthHeaders();
    const res = await fetch(
      `${apiUrl}/attachment?gmail_id=${encodeURIComponent(gid)}&attachment_id=${encodeURIComponent(att.attachment_id)}`,
      { headers: { Authorization: headers.Authorization } },
    );
    if (!res.ok) throw new Error("Failed to fetch attachment");
    const { data } = await res.json();
    const base64 = (data as string).replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
    const blob = new Blob([bytes], {
      type: att.mime_type || "application/octet-stream",
    });
    const blobUrl = URL.createObjectURL(blob);
    let text: string | null = null;
    let sheetHtml: string | null = null;
    if (
      att.mime_type?.startsWith("text/") ||
      att.mime_type === "application/json"
    ) {
      text = await blob.text();
    } else if (isExcelFile(att.mime_type, att.filename)) {
      try {
        const { read, utils } = await import("xlsx");
        const ab = await blob.arrayBuffer();
        const wb = read(new Uint8Array(ab), { type: "array" });
        const parts = wb.SheetNames.map((name) => {
          const html = utils.sheet_to_html(wb.Sheets[name]);
          return `<h4 style="margin:12px 0 6px;font-size:11px;font-weight:600;color:var(--muted)">${name}</h4>${html}`;
        });
        sheetHtml = parts.join(
          "<hr style='border:none;border-top:1px solid var(--border);margin:12px 0'/>",
        );
      } catch {
        /* fall through to unsupported */
      }
    }
    const result = { blobUrl, blob, text, sheetHtml };
    attachmentBlobCache.set(cacheKey, result);
    return result;
  };

  const downloadAttachment = async (
    att: {
      filename: string;
      mime_type: string;
      size: number;
      attachment_id: string;
    },
    gmailIdOverride?: string,
  ) => {
    try {
      const { blobUrl } = await fetchAttachmentBlob(att, gmailIdOverride);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = att.filename;
      a.click();
    } catch {
      addToast("error", "Download failed");
    }
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

    addToast("success", `Category changed to "${newCategory}"`);
  };

  const toggleTag = async (slug: string) => {
    const updated = emailTags.includes(slug)
      ? emailTags.filter((t) => t !== slug)
      : [...emailTags, slug];
    setEmailTags(updated);
    await supabase
      .from("email_processed")
      .update({ extra_labels: updated })
      .eq("email_id", email.id);
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
    await supabase
      .from("emails")
      .update({ is_snoozed: true, snooze_until: until })
      .eq("id", email.id);
    // Keep localStorage as fast local cache
    localStorage.setItem(`snooze:${email.id}`, until);
    setShowSnoozeMenu(false);
    addToast("success", `Snoozed until ${label}`);
    onSnooze?.();
  };

  const handleRethink = async () => {
    if (rethinking) return;
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
              .upsert(
                { email_id: email.id, ...updated },
                { onConflict: "email_id" },
              );
            setProc(updated);
            onRethink?.(updated);
            addToast("success", "AI analysis refreshed (local)");
            setRethinking(false);
            return;
          }
        }
        if (aiMode === "local") {
          addToast(
            "error",
            "Local AI not ready. Make sure the model is loaded.",
          );
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
            emails: [
              {
                id: email.id,
                subject: email.subject || "",
                sender: email.sender || "",
                snippet: email.snippet || "",
                body_text: email.body_text || email.body || "",
              },
            ],
          });

          const suggestions = result.todoSuggestions || [];
          if (suggestions.length > 0) {
            await supabase.from("todos").insert(
              suggestions.map((s) => ({
                user_id: user.id,
                text: s.task,
                source: "email",
              })),
            );
            addToast(
              "success",
              `Added ${suggestions.length} task${suggestions.length > 1 ? "s" : ""} to Todos`,
            );
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
        addToast(
          "success",
          count > 0
            ? `Added ${count} task${count > 1 ? "s" : ""} to Todos`
            : "No actionable tasks found",
        );
      } else {
        addToast("error", "Could not extract tasks");
      }
    } catch {
      addToast("error", "Network error");
    }
    setExtractingTodos(false);
  };

  const addTodoFromChip = async (task: string) => {
    await supabase
      .from("todos")
      .insert({ user_id: user.id, text: task, source: "email" });
    setAddedTodos((prev) => new Set([...prev, task]));
    addToast("success", "Added to Todos");
  };

  const generateSuggestions = async () => {
    setAnalyzingEmail(true);
    try {
      const ready = await initWebLLM();
      if (!ready) {
        addToast("error", "Local AI not ready");
        setAnalyzingEmail(false);
        return;
      }
      const result = await emailGraph.invoke({
        task: "process_email",
        currentEmail: {
          id: email.id,
          subject: email.subject || "",
          sender: email.sender || "",
          snippet: email.snippet || "",
          body_text: email.body_text || "",
        },
      });
      const updated = {
        category: result.category || proc?.category || "informational",
        summary: result.summary || proc?.summary || null,
        quick_actions: result.quickActions || [],
      };
      await supabase
        .from("email_processed")
        .upsert(
          { user_id: user.id, email_id: email.id, ...updated },
          { onConflict: "email_id" },
        );
      setProc(updated);
      onRethink?.(updated);
    } catch {
      addToast("error", "Analysis failed");
    }
    setAnalyzingEmail(false);
  };

  const handleQuickAction = (action: any) => {
    const label = (action.label || action.text || action || "").toLowerCase();
    if (label.includes("forward")) {
      openCompose({
        ...email,
        sender_email: "",
        subject: `Fwd: ${email.subject}`,
      });
    } else {
      openCompose({
        ...email,
        _prefillBody: action.text || "",
        _autoGenerate: !!action.text,
      });
    }
  };

  const senderEmailLc = (email.sender_email || "").toLowerCase();
  const isNoreply =
    /no.?reply|do.not.reply|noreply|mailer-daemon|postmaster/.test(
      senderEmailLc,
    );
  const replyActions = isNoreply
    ? []
    : (proc?.quick_actions || []).filter((qa: any) => qa.action === "reply");
  const meetingActions = (proc?.quick_actions || []).filter(
    (qa: any) => qa.action === "schedule_meeting",
  );
  const todoActions = (proc?.quick_actions || []).filter(
    (qa: any) => qa.action === "add_todo",
  );
  const hasNoActions = !proc?.quick_actions || proc.quick_actions.length === 0;
  // Only show the panel when there are actual actions to render.
  // If the AI ran and returned [] it made a deliberate decision — hide the panel.
  const hasActions =
    replyActions.length > 0 ||
    meetingActions.length > 0 ||
    todoActions.length > 0;
  const showSuggestionsPanel =
    hasActions &&
    (!isNoreply || meetingActions.length > 0 || todoActions.length > 0);

  const singleMessageBody = resolveEmailBodyDisplay({
    body_html: email.body_html,
    body_text: email.body_text,
    snippet: email.snippet,
  });
  const isMultiMessageThread = threadEmails.length > 1;

  return (
    <div className="h-full flex overflow-hidden bg-[var(--background)]">
      {/* Main email content column */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* ── Compact header ── */}
        <div className="px-3 py-1.5 flex-shrink-0 bg-[var(--surface)]">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={onBack}
              className="md:hidden p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: "16px" }}
              >
                arrow_back
              </span>
            </button>
            <div className="min-w-0 flex-1">
              {/* Sender + subject + time + badges — first line */}
              <div className="flex items-center gap-2 min-w-0">
                <p className="text-[12px] font-semibold text-[var(--foreground)] shrink-0 max-w-[35%] truncate">
                  {(email.sender ?? "").replace(/<.*>/, "").trim() ||
                    email.sender_email ||
                    "Unknown"}
                </p>
                <p className="text-[11px] text-[var(--muted)] truncate flex-1 min-w-0">
                  {email.subject || "(no subject)"}
                </p>
                <div className="flex items-center gap-0.5 shrink-0">
                  {/* Category badge + dropdown */}
                  <div ref={catRef} className="relative">
                    <button
                      onClick={() => {
                        setShowCategoryMenu(!showCategoryMenu);
                        setShowTagMenu(false);
                      }}
                      className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium cursor-pointer ${categoryColorMap[currentCategory] || "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}
                      title="Change category"
                    >
                      {currentCategory || "uncategorized"}
                    </button>
                    {showCategoryMenu && (
                      <div className="absolute right-0 top-full mt-1 bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-lg p-1 z-20 min-w-[160px]">
                        {CATEGORIES.map((cat) => (
                          <button
                            key={cat}
                            onClick={() => overrideCategory(cat)}
                            className={`w-full text-left px-2.5 py-1.5 text-xs rounded flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800`}
                          >
                            <span
                              className={`inline-block w-2 h-2 rounded-full shrink-0 ${categoryColorMap[cat]?.includes("red") ? "bg-red-500" : categoryColorMap[cat]?.includes("orange") ? "bg-orange-500" : categoryColorMap[cat]?.includes("purple") ? "bg-purple-500" : "bg-blue-500"}`}
                            />
                            <span
                              className={`flex-1 ${categoryColorMap[cat] || ""} px-1 py-0.5 rounded text-[10px] font-medium ${currentCategory === cat ? "font-bold" : ""}`}
                            >
                              {cat}
                            </span>
                            {currentCategory === cat && (
                              <span
                                className="material-symbols-outlined text-[var(--accent)]"
                                style={{ fontSize: "12px" }}
                              >
                                check
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Tag + button */}
                  <div ref={tagRef} className="relative">
                    <button
                      onClick={() => {
                        setShowTagMenu(!showTagMenu);
                        setShowCategoryMenu(false);
                      }}
                      className="flex items-center p-0.5 rounded text-[var(--muted)] hover:bg-slate-100 dark:hover:bg-slate-700"
                      title="Add tag"
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: "12px" }}
                      >
                        add
                      </span>
                    </button>
                    {showTagMenu && (
                      <div className="absolute right-0 top-full mt-1 bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-lg p-2 z-20 min-w-[160px]">
                        <p className="text-[10px] text-[var(--muted)] font-semibold uppercase tracking-wide mb-1.5 px-1">
                          Tags
                        </p>
                        {userTags.length === 0 ? (
                          <p className="text-xs text-[var(--muted)] px-1 py-1">
                            No tags yet. Create tags in Categories.
                          </p>
                        ) : (
                          userTags.map((tag) => {
                            const active = emailTags.includes(tag.slug);
                            return (
                              <button
                                key={tag.slug}
                                onClick={() => toggleTag(tag.slug)}
                                className="w-full text-left px-2 py-1.5 text-xs rounded flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                              >
                                <span
                                  className="w-2.5 h-2.5 rounded-full shrink-0"
                                  style={{ backgroundColor: tag.color }}
                                />
                                <span className="flex-1 text-slate-900 dark:text-white">
                                  {tag.display_name}
                                </span>
                                {active && (
                                  <span
                                    className="material-symbols-outlined text-[var(--accent)]"
                                    style={{ fontSize: "12px" }}
                                  >
                                    check
                                  </span>
                                )}
                              </button>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {/* Applied tags */}
                {emailTags.length > 0 &&
                  emailTags.map((slug) => {
                    const tag = userTags.find((t) => t.slug === slug);
                    if (!tag) return null;
                    return (
                      <span
                        key={slug}
                        className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium shrink-0"
                        style={{
                          backgroundColor: `${tag.color}20`,
                          color: tag.color,
                          boxShadow: `inset 0 0 0 1px ${tag.color}40`,
                        }}
                      >
                        {tag.display_name}
                      </span>
                    );
                  })}
                {email.has_attachments && (
                  <span
                    className="material-symbols-outlined text-[var(--muted)] shrink-0"
                    style={{ fontSize: "12px" }}
                    title="Has attachments"
                  >
                    attachment
                  </span>
                )}
                <span className="text-[10px] text-[var(--muted)] shrink-0 tabular-nums">
                  {new Date(email.received_at).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Email body or Thread chat view ── */}
        {threadLoading ? (
          <div className="flex-1 flex flex-col gap-3 px-3 py-3">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className={`flex flex-col gap-1 ${n % 2 === 0 ? "items-end" : "items-start"}`}
              >
                <div className="h-3 w-24 rounded bg-[var(--border)] animate-pulse" />
                <div
                  className={`h-12 rounded-2xl animate-pulse bg-[var(--border)] ${n % 2 === 0 ? "w-48 rounded-tr-sm" : "w-64 rounded-tl-sm"}`}
                />
              </div>
            ))}
          </div>
        ) : threadEmails.length > 1 ? (
          <div className="flex-1 min-h-0 overflow-auto email-reader-pane bg-[var(--background)]">
            <div className="w-full max-w-3xl mx-auto px-3 sm:px-4 py-4 min-w-0">
              <div className="mb-4 flex items-center gap-2 rounded-xl border border-[var(--border)] dark:border-white/[0.10] bg-[var(--surface-2)]/60 dark:bg-white/[0.04] px-3 py-2.5">
                <span
                  className="material-symbols-outlined text-[var(--accent)] shrink-0"
                  style={{ fontSize: "20px" }}
                  aria-hidden
                >
                  forum
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Thread
                  </p>
                  <p className="text-[13px] font-medium text-[var(--foreground)] truncate">
                    {threadEmails.length} messages in this conversation
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-0">
                {threadEmails.map((msg, msgIndex) => {
                  const msgSenderName =
                    (msg.sender ?? "").replace(/<.*>/, "").trim() ||
                    msg.sender_email ||
                    "Unknown";
                  const isMe = !!(
                    user?.email &&
                    msg.sender_email &&
                    msg.sender_email.toLowerCase() === user.email.toLowerCase()
                  );
                  const atts = Array.isArray(msg.attachments)
                    ? (msg.attachments as ThreadAtt[])
                    : [];
                  const bodyDisplay = resolveEmailBodyDisplay({
                    body_html: msg.body_html,
                    body_text: msg.body_text,
                    snippet: msg.snippet,
                  });
                  const timeStr = new Date(msg.received_at).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  const isLast = msgIndex === threadEmails.length - 1;
                  return (
                    <div
                      key={msg.id}
                      className="flex gap-3 min-w-0 pb-5 last:pb-0"
                    >
                      <div className="flex w-10 shrink-0 flex-col items-center pt-1">
                        <div
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors duration-200 ${
                            isMe
                              ? "bg-[var(--accent)]/20 text-[var(--accent)] ring-2 ring-[var(--accent)]/35"
                              : "bg-[var(--surface-2)] text-[var(--foreground)] ring-1 ring-[var(--border)]"
                          }`}
                          title={`Message ${msgIndex + 1} of ${threadEmails.length}`}
                        >
                          {msgIndex + 1}
                        </div>
                        {!isLast && (
                          <div
                            className="mt-1 w-px flex-1 min-h-[20px] bg-gradient-to-b from-[var(--border)] to-transparent"
                            aria-hidden
                          />
                        )}
                      </div>
                      <article
                        className={`min-w-0 flex-1 overflow-hidden rounded-2xl border bg-[var(--surface)] transition-shadow duration-200 motion-reduce:transition-none ${
                          isMe
                            ? "border-[var(--accent)]/40 shadow-sm dark:shadow-[0_4px_20px_rgba(0,0,0,0.45)]"
                            : "border-[var(--border)] shadow-sm dark:border-white/[0.10] dark:shadow-[0_4px_20px_rgba(0,0,0,0.35)] dark:ring-1 dark:ring-white/[0.06]"
                        }`}
                      >
                        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--border)]/70 dark:border-white/[0.08] bg-[var(--surface-2)]/30 dark:bg-white/[0.03] px-3 py-2.5 sm:px-4">
                          <div className="min-w-0">
                            <p className="text-[13px] font-semibold leading-snug text-[var(--foreground)]">
                              {isMe ? "You" : msgSenderName}
                            </p>
                            <p className="mt-0.5 text-[11px] text-[var(--muted)] tabular-nums">
                              {timeStr}
                            </p>
                          </div>
                          <span className="shrink-0 rounded-md bg-[var(--surface-2)] dark:bg-white/[0.07] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
                            {msgIndex + 1} / {threadEmails.length}
                          </span>
                        </header>
                        <div className="px-3 py-3 sm:px-4 sm:py-4">
                          {bodyDisplay.kind === "html" && (
                            <EmailBody
                              html={bodyDisplay.html}
                              isDark={theme === "dark"}
                            />
                          )}
                          {bodyDisplay.kind === "text" && (
                            <pre className="whitespace-pre-wrap font-sans text-[13px] leading-[1.65] text-[var(--foreground)]">
                              {linkify(bodyDisplay.text)}
                            </pre>
                          )}
                          {bodyDisplay.kind === "snippet" && (
                            <p className="text-[13px] leading-relaxed text-[var(--muted)]">
                              {bodyDisplay.text}
                            </p>
                          )}
                          {bodyDisplay.kind === "empty" && (
                            <p className="text-xs text-[var(--muted)]">
                              (no content)
                            </p>
                          )}
                          {msg.has_attachments && atts.length > 0 && (
                            <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-[var(--border)]/50 dark:border-white/[0.06] pt-2.5">
                              {atts.map((att) => (
                                <div
                                  key={att.attachment_id}
                                  className="flex items-center overflow-hidden rounded-lg border border-[var(--border)] dark:border-white/[0.08] bg-[var(--surface-2)]/60 transition-colors duration-150 group"
                                >
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      setPreviewAtt({
                                        att,
                                        blobUrl: null,
                                        blob: null,
                                        text: null,
                                        sheetHtml: null,
                                        error: null,
                                      });
                                      try {
                                        const result =
                                          await fetchAttachmentBlob(
                                            att,
                                            msg.gmail_id,
                                          );
                                        setPreviewAtt({
                                          att,
                                          ...result,
                                          error: null,
                                        });
                                      } catch {
                                        setPreviewAtt((prev) =>
                                          prev
                                            ? {
                                                ...prev,
                                                error:
                                                  "Failed to load attachment",
                                              }
                                            : null,
                                        );
                                      }
                                    }}
                                    className="flex cursor-pointer items-center gap-1 px-2 py-1 hover:bg-slate-100/80 dark:hover:bg-white/[0.06]"
                                  >
                                    <span
                                      className="material-symbols-outlined text-[var(--muted)] group-hover:text-[var(--accent)]"
                                      style={{ fontSize: "13px" }}
                                    >
                                      {att.mime_type?.startsWith("image/")
                                        ? "image"
                                        : att.mime_type?.includes("pdf")
                                          ? "picture_as_pdf"
                                          : "description"}
                                    </span>
                                    <span className="max-w-[120px] truncate text-left text-[10px] font-medium text-[var(--foreground)]">
                                      {att.filename}
                                    </span>
                                    {att.size > 0 && (
                                      <span className="shrink-0 text-[9px] text-[var(--muted)] tabular-nums">
                                        {att.size > 1024 * 1024
                                          ? `${(att.size / 1024 / 1024).toFixed(1)}M`
                                          : `${Math.ceil(att.size / 1024)}K`}
                                      </span>
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      downloadAttachment(att, msg.gmail_id)
                                    }
                                    className="cursor-pointer border-l border-[var(--border)] dark:border-white/[0.08] px-1.5 py-1 hover:bg-slate-100/80 dark:hover:bg-white/[0.06]"
                                    title="Download"
                                    aria-label={`Download ${att.filename}`}
                                  >
                                    <span
                                      className="material-symbols-outlined text-[var(--muted)] hover:text-[var(--accent)]"
                                      style={{ fontSize: "11px" }}
                                    >
                                      download
                                    </span>
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </article>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-auto email-reader-pane bg-[var(--background)] px-3 py-4 sm:px-5">
            <div className="mx-auto w-full max-w-3xl min-w-0">
              {singleMessageBody.kind === "html" && (
                <EmailBody
                  html={singleMessageBody.html}
                  isDark={theme === "dark"}
                />
              )}
              {singleMessageBody.kind === "text" && (
                <pre className="max-w-prose whitespace-pre-wrap font-sans text-[15px] leading-[1.65] text-[var(--foreground)]">
                  {linkify(singleMessageBody.text)}
                </pre>
              )}
              {singleMessageBody.kind === "snippet" && (
                <p className="max-w-prose text-[15px] leading-relaxed text-[var(--muted)]">
                  {singleMessageBody.text}
                </p>
              )}
              {singleMessageBody.kind === "empty" && (
                <span className="text-sm text-[var(--muted)]">
                  (no content)
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── Attachments + AI Suggestions Panel ── */}
        {((Array.isArray(email.attachments) &&
          email.attachments.length > 0 &&
          !isMultiMessageThread) ||
          showSuggestionsPanel) && (
          <div className="px-3 pt-2 pb-2 flex-shrink-0 bg-[var(--accent)]/5 flex flex-col gap-1.5">
            {/* Attachments row — only for single-message view (thread messages show their own) */}
            {!isMultiMessageThread &&
              Array.isArray(email.attachments) &&
              email.attachments.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span
                    className="material-symbols-outlined text-[var(--muted)]"
                    style={{ fontSize: "13px" }}
                  >
                    attach_file
                  </span>
                  {(
                    email.attachments as {
                      filename: string;
                      mime_type: string;
                      size: number;
                      attachment_id: string;
                    }[]
                  ).map((att, i) => (
                    <div
                      key={i}
                      className="flex items-center rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden group"
                    >
                      <button
                        onClick={async () => {
                          setPreviewAtt({
                            att,
                            blobUrl: null,
                            blob: null,
                            text: null,
                            sheetHtml: null,
                            error: null,
                          });
                          try {
                            const result = await fetchAttachmentBlob(att);
                            setPreviewAtt({ att, ...result, error: null });
                          } catch {
                            setPreviewAtt((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    error: "Failed to load attachment",
                                  }
                                : null,
                            );
                          }
                        }}
                        className="flex items-center gap-1 px-2.5 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        <span
                          className="material-symbols-outlined text-[var(--muted)] group-hover:text-[var(--accent)]"
                          style={{ fontSize: "13px" }}
                        >
                          {att.mime_type?.startsWith("image/")
                            ? "image"
                            : att.mime_type?.includes("pdf")
                              ? "picture_as_pdf"
                              : "description"}
                        </span>
                        <span className="text-[11px] font-medium text-[var(--foreground)] truncate max-w-[140px]">
                          {att.filename}
                        </span>
                        <span className="text-[9px] text-[var(--muted)] shrink-0">
                          {att.size > 1024 * 1024
                            ? `${(att.size / 1024 / 1024).toFixed(1)} MB`
                            : `${Math.ceil(att.size / 1024)} KB`}
                        </span>
                        <span
                          className="material-symbols-outlined text-[var(--muted)] group-hover:text-[var(--accent)] shrink-0"
                          style={{ fontSize: "12px" }}
                        >
                          visibility
                        </span>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadAttachment(att);
                        }}
                        className="px-1.5 py-1.5 border-l border-[var(--border)] hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
                        title="Download"
                      >
                        <span
                          className="material-symbols-outlined text-[var(--muted)] hover:text-[var(--accent)]"
                          style={{ fontSize: "12px" }}
                        >
                          download
                        </span>
                      </button>
                    </div>
                  ))}
                </div>
              )}

            {showSuggestionsPanel && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span
                  className="material-symbols-outlined text-[var(--muted)] shrink-0"
                  style={{ fontSize: "13px" }}
                >
                  auto_awesome
                </span>
                {replyActions.map((qa: any, i: number) => {
                  const label = (qa.label || "").replace(/^Reply:\s*/i, "");
                  const prefill = qa.text || label;
                  return (
                    <button
                      key={`reply-${i}`}
                      onClick={() =>
                        openCompose({
                          ...email,
                          _prefillBody: prefill,
                          _autoGenerate: true,
                        })
                      }
                      className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-[11px] font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                      title={label}
                    >
                      <span
                        className="material-symbols-outlined text-blue-400"
                        style={{ fontSize: "12px" }}
                      >
                        chat_bubble
                      </span>
                      <span>{label}</span>
                    </button>
                  );
                })}
                {meetingActions.map((qa: any, i: number) => {
                  const label = (qa.label || "").replace(/^Schedule:\s*/i, "");
                  return (
                    <button
                      key={`meeting-${i}`}
                      onClick={() => setView("meetings")}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors"
                      title={label}
                    >
                      <span
                        className="material-symbols-outlined text-emerald-500"
                        style={{ fontSize: "12px" }}
                      >
                        event_upcoming
                      </span>
                      <span>{label}</span>
                    </button>
                  );
                })}
                {todoActions.map((qa: any, i: number) => {
                  const task = (qa.label || "").replace(/^Todo:\s*/i, "");
                  const added = addedTodos.has(task);
                  return (
                    <button
                      key={`todo-${i}`}
                      onClick={() => !added && addTodoFromChip(task)}
                      disabled={added}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-medium transition-all ${
                        added
                          ? "border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-950/40 dark:text-green-400 cursor-default"
                          : "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50"
                      }`}
                      title={task}
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{
                          fontSize: "13px",
                          fontVariationSettings: added
                            ? "'FILL' 1"
                            : "'FILL' 0",
                        }}
                      >
                        {added ? "check_circle" : "add_task"}
                      </span>
                      <span>{task}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Action bar ── */}
        <div className="px-3 py-1.5 border-t border-[var(--border)] flex-shrink-0 flex items-center gap-1.5 flex-wrap">
          {/* Reply button — always visible */}
          <button
            onClick={() => onReply()}
            className="flex items-center gap-1 px-2 py-1 rounded-lg border border-[var(--border)] text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: "12px" }}
            >
              reply
            </span>
            Reply
          </button>

          {/* Reply All — show when the email had multiple recipients or CC */}
          {(email.recipients || email.cc_recipients) && (
            <button
              onClick={() => openCompose({ ...email, _replyAll: true })}
              className="flex items-center gap-1 px-2 py-1 rounded-lg border border-[var(--border)] text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: "12px" }}
              >
                reply_all
              </span>
              Reply All
            </button>
          )}

          <div className="flex-1" />

          {/* Action buttons */}
          <button
            onClick={() =>
              openCompose({
                ...email,
                sender_email: "",
                subject: `Fwd: ${email.subject}`,
              })
            }
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: "13px" }}
            >
              forward_to_inbox
            </span>
            Delegate
          </button>
          <button
            onClick={handleMarkUnread}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: "13px" }}
            >
              mark_email_unread
            </span>
            Unread
          </button>
          <div ref={snoozeRef} className="relative">
            <button
              onClick={() => setShowSnoozeMenu(!showSnoozeMenu)}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: "13px" }}
              >
                snooze
              </span>
              Snooze
            </button>
            {showSnoozeMenu && (
              <div className="absolute bottom-full mb-1 right-0 bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-lg p-1 z-20 min-w-[160px]">
                {SNOOZE_OPTIONS.map((opt) => (
                  <button
                    key={opt.hours}
                    onClick={() => handleSnooze(opt.hours, opt.label)}
                    className="w-full text-left px-3 py-1.5 text-xs rounded text-[var(--foreground)] hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Track follow-up — shown for sent/outbound emails with a thread_id */}
          {email.thread_id && (
            <div className="relative">
              <button
                onClick={() => {
                  if (isTracked) {
                    setView("followups");
                  } else {
                    setShowTrackPopup((v) => !v);
                  }
                }}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                  isTracked
                    ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-light)]"
                    : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
                }`}
                title={isTracked ? "View in Follow-ups" : "Track follow-up"}
              >
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: "13px",
                    fontVariationSettings: isTracked ? "'FILL' 1" : "'FILL' 0",
                  }}
                >
                  schedule_send
                </span>
                {isTracked ? "Tracked" : "Track"}
              </button>
              {showTrackPopup && !isTracked && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowTrackPopup(false)}
                  />
                  <div className="absolute bottom-full mb-2 right-0 z-20 bg-[var(--background)] border border-[var(--border)] rounded-xl shadow-xl p-3 w-64">
                    <p className="text-[11px] font-semibold text-[var(--foreground)] mb-2">
                      Remind me if no reply by
                    </p>
                    <div className="mb-2">
                      <DateTimePicker
                        value={trackRemindAt}
                        onChange={setTrackRemindAt}
                        placeholder="Pick date and time"
                      />
                    </div>
                    <button
                      onClick={trackFollowUp}
                      disabled={trackingSaving}
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs font-semibold hover:opacity-90 disabled:opacity-60 transition-opacity"
                    >
                      {trackingSaving ? (
                        <span
                          className="material-symbols-outlined animate-spin"
                          style={{ fontSize: "13px" }}
                        >
                          progress_activity
                        </span>
                      ) : (
                        <span
                          className="material-symbols-outlined"
                          style={{ fontSize: "13px" }}
                        >
                          add_alert
                        </span>
                      )}
                      Set Reminder
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          <button
            onClick={onArchive}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: "13px" }}
            >
              archive
            </span>
            Archive
          </button>
        </div>
      </div>
      {/* end main column */}

      {/* ── Attachment Preview Modal ── */}
      {previewAtt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setPreviewAtt(null)}
        >
          <div
            className="relative flex flex-col bg-[var(--background)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden"
            style={{ width: "min(92vw, 900px)", height: "min(90vh, 700px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
              <span
                className="material-symbols-outlined text-[var(--accent)]"
                style={{ fontSize: "18px" }}
              >
                {previewAtt.att.mime_type?.startsWith("image/")
                  ? "image"
                  : previewAtt.att.mime_type?.includes("pdf")
                    ? "picture_as_pdf"
                    : "description"}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-[var(--foreground)] truncate">
                  {previewAtt.att.filename}
                </p>
                <p className="text-[10px] text-[var(--muted)]">
                  {previewAtt.att.size > 1024 * 1024
                    ? `${(previewAtt.att.size / 1024 / 1024).toFixed(1)} MB`
                    : `${Math.ceil(previewAtt.att.size / 1024)} KB`}
                  {" · "}
                  {previewAtt.att.mime_type || "unknown type"}
                </p>
              </div>
              <button
                onClick={() => downloadAttachment(previewAtt.att)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-[11px] font-semibold hover:opacity-90 transition-opacity shrink-0"
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: "13px" }}
                >
                  download
                </span>
                Download
              </button>
              <button
                onClick={() => setPreviewAtt(null)}
                className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] transition-colors shrink-0"
                title="Close"
              >
                <span
                  className="material-symbols-outlined text-[var(--muted)]"
                  style={{ fontSize: "16px" }}
                >
                  close
                </span>
              </button>
            </div>

            {/* Content area */}
            <div className="flex-1 overflow-auto flex items-center justify-center bg-[var(--surface-2)]">
              {/* Loading */}
              {!previewAtt.blobUrl && !previewAtt.error && (
                <div className="flex flex-col items-center gap-3 text-[var(--muted)]">
                  <span
                    className="material-symbols-outlined animate-spin text-[var(--accent)]"
                    style={{ fontSize: "28px" }}
                  >
                    progress_activity
                  </span>
                  <span className="text-[12px]">Loading preview...</span>
                </div>
              )}

              {/* Error */}
              {previewAtt.error && (
                <div className="flex flex-col items-center gap-3 text-[var(--muted)]">
                  <span
                    className="material-symbols-outlined text-red-400"
                    style={{ fontSize: "28px" }}
                  >
                    error_outline
                  </span>
                  <span className="text-[12px]">{previewAtt.error}</span>
                  <button
                    onClick={() => downloadAttachment(previewAtt.att)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] text-[11px] font-medium hover:bg-[var(--surface)] transition-colors"
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: "13px" }}
                    >
                      download
                    </span>
                    Download instead
                  </button>
                </div>
              )}

              {/* Image preview */}
              {previewAtt.blobUrl &&
                previewAtt.att.mime_type?.startsWith("image/") && (
                  <img
                    src={previewAtt.blobUrl}
                    alt={previewAtt.att.filename}
                    className="max-w-full max-h-full object-contain"
                    style={{ padding: "16px" }}
                  />
                )}

              {/* PDF preview */}
              {previewAtt.blobUrl &&
                previewAtt.att.mime_type?.includes("pdf") && (
                  <iframe
                    src={previewAtt.blobUrl}
                    title={previewAtt.att.filename}
                    className="w-full h-full border-0"
                  />
                )}

              {/* Text / CSV / JSON preview */}
              {previewAtt.blobUrl && previewAtt.text !== null && (
                <pre className="w-full h-full overflow-auto p-4 text-[11px] font-mono text-[var(--foreground)] leading-relaxed whitespace-pre-wrap break-all">
                  {previewAtt.text}
                </pre>
              )}

              {/* Word (.docx) preview */}
              {previewAtt.blobUrl &&
                isDocxFile(
                  previewAtt.att.mime_type,
                  previewAtt.att.filename,
                ) && (
                  <div
                    ref={docxContainerRef}
                    className="w-full h-full overflow-auto bg-white"
                    style={{ colorScheme: "light" }}
                  />
                )}

              {/* Excel preview */}
              {previewAtt.blobUrl && previewAtt.sheetHtml !== null && (
                <div
                  className="attachment-sheet-preview w-full h-full overflow-auto p-4"
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(previewAtt.sheetHtml, {
                      USE_PROFILES: { html: true },
                    }),
                  }}
                />
              )}

              {/* Unsupported type */}
              {previewAtt.blobUrl &&
                !previewAtt.att.mime_type?.startsWith("image/") &&
                !previewAtt.att.mime_type?.includes("pdf") &&
                previewAtt.text === null &&
                !isDocxFile(
                  previewAtt.att.mime_type,
                  previewAtt.att.filename,
                ) &&
                previewAtt.sheetHtml === null && (
                  <div className="flex flex-col items-center gap-3 text-[var(--muted)] text-center px-8">
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: "36px" }}
                    >
                      draft
                    </span>
                    <p className="text-[13px] font-medium text-[var(--foreground)]">
                      Preview not available
                    </p>
                    <p className="text-[11px]">
                      This file type cannot be previewed in the browser.
                    </p>
                    <button
                      onClick={() => downloadAttachment(previewAtt.att)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-[11px] font-semibold hover:opacity-90 transition-opacity"
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: "13px" }}
                      >
                        download
                      </span>
                      Download to open
                    </button>
                  </div>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
