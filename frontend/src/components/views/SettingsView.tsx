"use client";

import { useState, useEffect, useRef } from "react";
import DOMPurify from "dompurify";
import { createClient } from "@/lib/supabase/client";
import { useApp } from "../AppShell";
import WebLLMConsentModal from "../WebLLMConsentModal";
import { EmailField, useContacts } from "../EmailAutocomplete";
import { subscribeToPush, isPushSupported } from "@/lib/pushNotifications";

// Sanitize user-authored signature HTML before rendering via
// dangerouslySetInnerHTML or saving back to the DB. Keeps inline styles
// and basic formatting but strips <script>, event handlers, iframes, etc.
function sanitizeSignatureHtml(html: string): string {
  return DOMPurify.sanitize(html ?? "", {
    USE_PROFILES: { html: true },
    ALLOWED_ATTR: [
      "href",
      "src",
      "alt",
      "title",
      "style",
      "class",
      "target",
      "rel",
      "width",
      "height",
      "cellpadding",
      "cellspacing",
      "border",
      "align",
      "color",
      "face",
      "size",
    ],
    FORBID_TAGS: [
      "script",
      "style",
      "iframe",
      "object",
      "embed",
      "form",
      "input",
      "button",
    ],
    FORBID_ATTR: [
      "onerror",
      "onload",
      "onclick",
      "onmouseover",
      "onfocus",
      "onblur",
    ],
  });
}

type DelegationRule = {
  id: string;
  pattern: string;
  target_email: string;
  is_enabled: boolean;
  weight: number;
};

type TabId =
  | "account"
  | "ai"
  | "schedule"
  | "briefing"
  | "automation"
  | "templates"
  | "signatures";

interface EmailTemplate {
  id: string;
  name: string;
  subject: string | null;
  body_html: string;
}

interface EmailSignature {
  id: string;
  name: string;
  html: string;
  is_default: boolean;
  gmail_account_id: string | null;
  created_at: string;
}

function to12h(time24: string): {
  hour: string;
  minute: string;
  ampm: "AM" | "PM";
} {
  const [h, m] = (time24 || "09:00").split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return { hour: String(hour12), minute: String(m).padStart(2, "0"), ampm };
}

function to24h(hour: string, minute: string, ampm: "AM" | "PM"): string {
  let h = parseInt(hour, 10);
  if (ampm === "AM" && h === 12) h = 0;
  if (ampm === "PM" && h !== 12) h += 12;
  return `${h.toString().padStart(2, "0")}:${minute}`;
}

function TimePickerAmPm({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { hour, minute, ampm } = to12h(value || "09:00");

  const openDropdown = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: "fixed",
        top: rect.bottom + 6,
        left: rect.left,
        width: rect.width < 224 ? 224 : rect.width,
      });
    }
    setOpen(!open);
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        btnRef.current &&
        !btnRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative mt-1">
      <button
        ref={btnRef}
        type="button"
        onClick={openDropdown}
        className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border border-[var(--border)] hover:border-[var(--accent)] transition-colors group"
      >
        <span
          className="material-symbols-outlined text-[var(--accent)]"
          style={{ fontSize: "15px" }}
        >
          schedule
        </span>
        <span className="text-sm font-semibold text-slate-900 dark:text-white flex-1 text-left tabular-nums">
          {hour}:{minute}
        </span>
        <span
          className={`text-xs font-bold px-1.5 py-0.5 rounded ${ampm === "AM" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" : "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"}`}
        >
          {ampm}
        </span>
        <span
          className="material-symbols-outlined text-[var(--muted)]"
          style={{ fontSize: "14px" }}
        >
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>

      {open && (
        <div
          ref={dropdownRef}
          style={{ ...dropdownStyle, zIndex: 9999 }}
          className="bg-[var(--background)] border border-[var(--border)] rounded-xl shadow-xl p-3 w-56"
        >
          <p className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5">
            Hour
          </p>
          <div className="grid grid-cols-6 gap-1 mb-3">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => onChange(to24h(String(h), minute, ampm))}
                className={`py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  hour === String(h)
                    ? "bg-[var(--accent)] text-white shadow-sm"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                {h}
              </button>
            ))}
          </div>

          <p className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5">
            Minute
          </p>
          <div className="flex gap-1 mb-3">
            {["00", "15", "30", "45"].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onChange(to24h(hour, m, ampm))}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  minute === m
                    ? "bg-[var(--accent)] text-white shadow-sm"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                :{m}
              </button>
            ))}
          </div>

          <div className="flex rounded-lg overflow-hidden border border-[var(--border)]">
            {(["AM", "PM"] as const).map((period) => (
              <button
                key={period}
                type="button"
                onClick={() => {
                  onChange(to24h(hour, minute, period));
                  setOpen(false);
                }}
                className={`flex-1 py-1.5 text-xs font-bold transition-all ${
                  ampm === period
                    ? period === "AM"
                      ? "bg-blue-500 text-white"
                      : "bg-orange-500 text-white"
                    : "text-[var(--muted)] hover:bg-slate-50 dark:hover:bg-slate-800"
                }`}
              >
                {period}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const aiModes = [
  {
    id: "cloud" as const,
    label: "Cloud",
    icon: "cloud",
    desc: "Fast AI processing via secure server. Emails are processed server-side with no data stored beyond your session.",
    badge: "Default",
  },
  {
    id: "local" as const,
    label: "Local",
    icon: "computer",
    desc: "Maximum privacy. AI runs entirely inside your browser via WebLLM. No data leaves your device.",
    badge: "Private",
  },
  {
    id: "hybrid" as const,
    label: "Hybrid",
    icon: "sync_alt",
    desc: "Local processing when the app is open, cloud processing for background tasks when you're away.",
    badge: "Best of Both",
  },
];

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "account", label: "Account", icon: "manage_accounts" },
  { id: "ai", label: "AI", icon: "auto_awesome" },
  { id: "schedule", label: "Schedule", icon: "schedule" },
  { id: "briefing", label: "Briefing", icon: "summarize" },
  { id: "automation", label: "Automation", icon: "alt_route" },
  { id: "templates", label: "Templates", icon: "description" },
  { id: "signatures", label: "Signatures", icon: "draw" },
];

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-4 px-5 border-b border-[var(--border)] last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--foreground)]">{label}</p>
        {description && (
          <p className="text-xs text-[var(--muted)] mt-0.5 leading-relaxed">
            {description}
          </p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${value ? "bg-[var(--accent)]" : "bg-slate-300 dark:bg-slate-600"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${value ? "translate-x-5" : ""}`}
      />
    </button>
  );
}

function SectionCard({
  children,
  className = "",
  allowOverflow = false,
}: {
  children: React.ReactNode;
  className?: string;
  allowOverflow?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-[var(--border)] ${allowOverflow ? "overflow-visible" : "overflow-hidden"} ${className}`}
    >
      {children}
    </div>
  );
}

function SectionLabel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`text-[11px] font-semibold uppercase tracking-widest px-1 pt-1 pb-1 text-[var(--muted)] ${className}`}
    >
      {children}
    </p>
  );
}

export default function SettingsView() {
  const {
    user,
    profile,
    updateProfile,
    addToast,
    startTutorial,
    briefingAudioAutoplay,
    setBriefingAudioAutoplay,
  } = useApp();
  const supabase = createClient();
  const { contacts } = useContacts(user.id);

  const [activeTab, setActiveTab] = useState<TabId>("account");
  // OpenAI gpt-4o-mini-tts voices, proxied through OpenRouter.
  const TTS_VOICES = [
    { name: "cedar", label: "Cedar", description: "Warm, grounded" },
    { name: "marin", label: "Marin", description: "Bright, conversational" },
    { name: "alloy", label: "Alloy", description: "Balanced, neutral" },
    { name: "ash", label: "Ash", description: "Calm, contemplative" },
    { name: "ballad", label: "Ballad", description: "Expressive, storyteller" },
    { name: "coral", label: "Coral", description: "Friendly, upbeat" },
    { name: "echo", label: "Echo", description: "Steady, confident" },
    { name: "fable", label: "Fable", description: "Soft, gentle" },
    { name: "nova", label: "Nova", description: "Clear, professional" },
    { name: "onyx", label: "Onyx", description: "Deep, resonant" },
    { name: "sage", label: "Sage", description: "Measured, thoughtful" },
    { name: "shimmer", label: "Shimmer", description: "Light, welcoming" },
    { name: "verse", label: "Verse", description: "Lyrical, dynamic" },
  ] as const;
  const DEFAULT_VOICE = "cedar";
  const LEGACY_VOICE_PREFIX = "en-US-";
  const [selectedVoice, setSelectedVoice] = useState<string>(() => {
    try {
      const stored = localStorage.getItem("runemail_tts_voice");
      if (!stored || stored.startsWith(LEGACY_VOICE_PREFIX)) {
        return DEFAULT_VOICE;
      }
      return stored;
    } catch {
      return DEFAULT_VOICE;
    }
  });
  // Clear any legacy Google voice preference once, so saved prefs don't
  // silently keep using an unsupported name.
  useEffect(() => {
    try {
      const stored = localStorage.getItem("runemail_tts_voice");
      if (stored && stored.startsWith(LEGACY_VOICE_PREFIX)) {
        localStorage.setItem("runemail_tts_voice", DEFAULT_VOICE);
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  // Delegation rules
  const [delegations, setDelegations] = useState<DelegationRule[]>([]);
  const [delegationsLoaded, setDelegationsLoaded] = useState(false);
  const [newPattern, setNewPattern] = useState("");
  const [newTargetEmail, setNewTargetEmail] = useState("");
  const [aiMode, setAiMode] = useState<"cloud" | "local" | "hybrid">(
    profile?.ai_mode || "cloud",
  );
  const [showWebLLMConsent, setShowWebLLMConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLoadRef = useRef(true);
  const [gmailAccounts, setGmailAccounts] = useState<
    { id: string; gmail_address: string }[]
  >([]);
  const [removingAccount, setRemovingAccount] = useState<string | null>(null);
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(
    null,
  );
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [templateForm, setTemplateForm] = useState<{
    name: string;
    subject: string;
    body_html: string;
  }>({ name: "", subject: "", body_html: "" });
  const [savingTemplate, setSavingTemplate] = useState(false);

  // Signatures
  const [signatures, setSignatures] = useState<EmailSignature[]>([]);
  const [signaturesLoaded, setSignaturesLoaded] = useState(false);
  const [editingSignature, setEditingSignature] =
    useState<EmailSignature | null>(null);
  const [sigForm, setSigForm] = useState<{
    name: string;
    html: string;
    is_default: boolean;
    gmail_account_id: string;
  }>({ name: "", html: "", is_default: false, gmail_account_id: "" });
  const [savingSignature, setSavingSignature] = useState(false);
  const [showSigEditor, setShowSigEditor] = useState(false);

  // Writing style
  const [styleNotes, setStyleNotes] = useState(profile?.style_notes || "");
  const [detectedStyle, setDetectedStyle] = useState<{
    greeting_style: string;
    closing_style: string;
    tone: string;
    avg_length: string;
    last_learned_at: string;
  } | null>(null);
  const [styleGreeting, setStyleGreeting] = useState("");
  const [styleClosing, setStyleClosing] = useState("");
  const [styleTone, setStyleTone] = useState("");
  const [styleLength, setStyleLength] = useState("");
  const [detectingStyle, setDetectingStyle] = useState(false);

  // Notifications
  const [notificationLevel, setNotificationLevel] = useState<
    "all" | "important" | "none"
  >((profile as any)?.notification_level || "important");
  const [notificationPreview, setNotificationPreview] = useState<boolean>(
    (profile as any)?.notification_preview !== false,
  );
  const [pushPermission, setPushPermission] = useState<
    "default" | "granted" | "denied" | "unsupported"
  >("default");
  const [enablingPush, setEnablingPush] = useState(false);

  useEffect(() => {
    if (!isPushSupported()) {
      setPushPermission("unsupported");
      return;
    }
    setPushPermission(
      Notification.permission as "default" | "granted" | "denied",
    );
  }, []);

  const handleDetectStyle = async () => {
    if (detectingStyle) return;
    setDetectingStyle(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        addToast("error", "Session expired. Please sign in again.");
        return;
      }
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/api/learn-style`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        addToast(
          "error",
          err.error || "Couldn't detect style yet. Send a few emails first.",
        );
        return;
      }
      const data = await res.json();
      const s = data.style || {};
      setDetectedStyle({
        greeting_style: s.greeting_style || "",
        closing_style: s.closing_style || "",
        tone: s.tone || "",
        avg_length: s.avg_length || "",
        last_learned_at: new Date().toISOString(),
      });
      setStyleGreeting(s.greeting_style || "");
      setStyleClosing(s.closing_style || "");
      setStyleTone(s.tone || "");
      setStyleLength(s.avg_length || "");
      addToast(
        "success",
        `Writing style detected from ${data.sample_count} sent emails.`,
      );
    } catch {
      addToast("error", "Could not detect writing style.");
    } finally {
      setDetectingStyle(false);
    }
  };

  const handleEnablePush = async () => {
    setEnablingPush(true);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        addToast("error", "Session expired, please sign in again.");
        return;
      }
      const ok = await subscribeToPush(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        session.access_token,
      );
      const newPermission = Notification.permission as
        | "default"
        | "granted"
        | "denied";
      setPushPermission(newPermission);
      if (ok) addToast("success", "Push notifications enabled.");
      else if (newPermission === "denied")
        addToast(
          "error",
          "Notifications blocked. Allow them in your browser settings.",
        );
      else addToast("error", "Could not enable notifications. Try again.");
    } finally {
      setEnablingPush(false);
    }
  };

  // Working hours
  const [workStart, setWorkStart] = useState("09:00");
  const [workEnd, setWorkEnd] = useState("17:00");
  const [workDays, setWorkDays] = useState([1, 2, 3, 4, 5]);
  const [workDnd, setWorkDnd] = useState(false);

  // Briefing scope
  const [briefingScope, setBriefingScope] = useState(
    profile?.briefing_scope || "today_new",
  );

  // Calendar invites
  const [calendarSendInvites, setCalendarSendInvites] = useState(
    profile?.calendar_send_invites !== false,
  );

  const previewVoice = async (voiceName: string, label: string) => {
    previewAudioRef.current?.pause();
    previewAudioRef.current = null;
    if (previewingVoice === voiceName) {
      setPreviewingVoice(null);
      return;
    }
    setPreviewingVoice(voiceName);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const res = await fetch(
        process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/api/tts",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            text: `Hi, I'm ${label} and I'll be your briefing voice.`,
            voice: voiceName,
          }),
        },
      );
      if (!res.ok) throw new Error();
      const { audioContent } = await res.json();
      const audio = new Audio(`data:audio/mp3;base64,${audioContent}`);
      previewAudioRef.current = audio;
      audio.onended = () => setPreviewingVoice(null);
      audio.onerror = () => setPreviewingVoice(null);
      audio.play();
    } catch {
      setPreviewingVoice(null);
    }
  };

  const loadGmailAccounts = () => {
    supabase
      .from("gmail_accounts")
      .select("id, gmail_address")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .then(({ data }) =>
        setGmailAccounts(
          (data || []) as { id: string; gmail_address: string }[],
        ),
      );
  };

  const loadDelegations = async () => {
    const { data } = await supabase
      .from("delegation_rules")
      .select("*")
      .eq("user_id", user.id)
      .order("weight", { ascending: false })
      .limit(200);
    setDelegations(data || []);
    setDelegationsLoaded(true);
  };

  const loadTemplates = async () => {
    const { data } = await supabase
      .from("email_templates")
      .select("id, name, subject, body_html")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setEmailTemplates(data || []);
    setTemplatesLoaded(true);
  };

  const deleteTemplate = async (id: string) => {
    await supabase.from("email_templates").delete().eq("id", id);
    setEmailTemplates((prev) => prev.filter((t) => t.id !== id));
    if (editingTemplate?.id === id) setShowTemplateEditor(false);
    addToast("success", "Template deleted");
  };

  const openNewTemplate = () => {
    setEditingTemplate(null);
    setTemplateForm({ name: "", subject: "", body_html: "" });
    setShowTemplateEditor(true);
  };

  const openEditTemplate = (t: EmailTemplate) => {
    setEditingTemplate(t);
    setTemplateForm({
      name: t.name,
      subject: t.subject || "",
      body_html: t.body_html,
    });
    setShowTemplateEditor(true);
  };

  const saveTemplate = async () => {
    if (!templateForm.name.trim()) {
      addToast("error", "Template name is required");
      return;
    }
    if (!templateForm.body_html.trim()) {
      addToast("error", "Template body is required");
      return;
    }
    setSavingTemplate(true);
    if (editingTemplate) {
      const { data } = await supabase
        .from("email_templates")
        .update({
          name: templateForm.name,
          subject: templateForm.subject || null,
          body_html: templateForm.body_html,
        })
        .eq("id", editingTemplate.id)
        .select("id, name, subject, body_html");
      if (data?.[0]) {
        setEmailTemplates((prev) =>
          prev.map((t) => (t.id === editingTemplate.id ? data[0] : t)),
        );
        setShowTemplateEditor(false);
        addToast("success", "Template updated");
      } else {
        addToast("error", "Failed to update template");
      }
    } else {
      const { data } = await supabase
        .from("email_templates")
        .insert({
          user_id: user.id,
          name: templateForm.name,
          subject: templateForm.subject || null,
          body_html: templateForm.body_html,
        })
        .select("id, name, subject, body_html");
      if (data?.[0]) {
        setEmailTemplates((prev) => [data[0], ...prev]);
        setShowTemplateEditor(false);
        addToast("success", "Template created");
      } else {
        addToast("error", "Failed to create template");
      }
    }
    setSavingTemplate(false);
  };

  const loadSignatures = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/api/signatures`,
        {
          headers: { Authorization: `Bearer ${session.access_token}` },
        },
      );
      const json = await res.json();
      setSignatures(json.signatures ?? []);
    } catch {
      /* non-critical */
    }
    setSignaturesLoaded(true);
  };

  const openNewSignature = () => {
    setEditingSignature(null);
    const displayName = profile?.display_name || "Your Name";
    setSigForm({
      name: "",
      html: `<p><strong>${displayName}</strong><br />Your Title<br />Your Company</p>`,
      is_default: signatures.length === 0,
      gmail_account_id: gmailAccounts[0]?.id || "",
    });
    setShowSigEditor(true);
  };

  const openEditSignature = (sig: EmailSignature) => {
    setEditingSignature(sig);
    setSigForm({
      name: sig.name,
      html: sig.html,
      is_default: sig.is_default,
      gmail_account_id: sig.gmail_account_id || "",
    });
    setShowSigEditor(true);
  };

  const saveSignature = async () => {
    if (!sigForm.name.trim()) {
      addToast("error", "Signature name is required");
      return;
    }
    setSavingSignature(true);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setSavingSignature(false);
      return;
    }
    try {
      const body = {
        name: sigForm.name,
        html: sanitizeSignatureHtml(sigForm.html),
        is_default: sigForm.is_default,
        gmail_account_id: sigForm.gmail_account_id || null,
      };
      const url = editingSignature
        ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/api/signatures/${editingSignature.id}`
        : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/api/signatures`;
      const res = await fetch(url, {
        method: editingSignature ? "PATCH" : "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.signature) {
        if (editingSignature) {
          setSignatures((prev) =>
            prev.map((s) =>
              s.id === editingSignature.id
                ? json.signature
                : sigForm.is_default
                  ? { ...s, is_default: false }
                  : s,
            ),
          );
        } else {
          setSignatures((prev) => [
            ...(sigForm.is_default
              ? prev.map((s) => ({ ...s, is_default: false }))
              : prev),
            json.signature,
          ]);
        }
        setShowSigEditor(false);
        addToast(
          "success",
          editingSignature ? "Signature updated" : "Signature created",
        );
      } else {
        addToast("error", json.error || "Failed to save signature");
      }
    } catch {
      addToast("error", "Failed to save signature");
    }
    setSavingSignature(false);
  };

  const deleteSignature = async (id: string) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/api/signatures/${id}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      },
    );
    setSignatures((prev) => prev.filter((s) => s.id !== id));
    addToast("success", "Signature deleted");
  };

  const addDelegation = async () => {
    if (!newPattern.trim() || !newTargetEmail.trim()) return;
    const { data } = await supabase
      .from("delegation_rules")
      .insert({
        user_id: user.id,
        pattern: newPattern.trim(),
        target_email: newTargetEmail.trim(),
      })
      .select();
    if (data?.[0]) setDelegations((prev) => [data[0], ...prev]);
    setNewPattern("");
    setNewTargetEmail("");
  };

  const toggleDelegation = async (id: string, enabled: boolean) => {
    await supabase
      .from("delegation_rules")
      .update({ is_enabled: !enabled })
      .eq("id", id);
    setDelegations((prev) =>
      prev.map((d) => (d.id === id ? { ...d, is_enabled: !enabled } : d)),
    );
  };

  const deleteDelegation = async (id: string) => {
    await supabase.from("delegation_rules").delete().eq("id", id);
    setDelegations((prev) => prev.filter((d) => d.id !== id));
  };

  const removeGmailAccount = async (accountId: string) => {
    setRemovingAccount(accountId);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/api";
      const {
        data: { session },
      } = await supabase.auth.getSession();
      await fetch(`${apiUrl}/remove-gmail-account`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ account_id: accountId }),
      });
      const remaining = gmailAccounts.filter((a) => a.id !== accountId);
      if (remaining.length === 0) {
        await supabase.auth.signOut();
        window.location.href = "/";
      } else {
        loadGmailAccounts();
      }
    } catch {
      /* ignore */
    }
    setRemovingAccount(null);
  };

  useEffect(() => {
    loadGmailAccounts();

    supabase
      .from("style_profiles")
      .select(
        "greeting_style, closing_style, tone, avg_length, last_learned_at",
      )
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          const s = data as {
            greeting_style: string;
            closing_style: string;
            tone: string;
            avg_length: string;
            last_learned_at: string;
          };
          setDetectedStyle(s);
          setStyleGreeting(s.greeting_style || "");
          setStyleClosing(s.closing_style || "");
          setStyleTone(s.tone || "");
          setStyleLength(s.avg_length || "");
        }
      });

    if (profile?.working_hours) {
      const wh = profile.working_hours as any;
      if (wh.start) setWorkStart(wh.start);
      if (wh.end) setWorkEnd(wh.end);
      if (wh.days) setWorkDays(wh.days);
      if (wh.dnd !== undefined) setWorkDnd(!!wh.dnd);
    }

    loadDelegations();
    loadTemplates();
    loadSignatures();
  }, [user.id]);

  const handleModeChange = (mode: "cloud" | "local" | "hybrid") => {
    if ((mode === "local" || mode === "hybrid") && aiMode === "cloud") {
      const hasConsented = localStorage.getItem("webllm_consent") === "true";
      if (!hasConsented) {
        setShowWebLLMConsent(true);
        return;
      }
    }
    setAiMode(mode);
  };

  const handleWebLLMConsent = () => {
    localStorage.setItem("webllm_consent", "true");
    setShowWebLLMConsent(false);
    setAiMode("local");
  };

  const autoSave = async () => {
    setSaving(true);
    const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const { error: profileErr } = await supabase
      .from("profiles")
      .update({
        ai_mode: aiMode,
        style_notes: styleNotes || null,
        working_hours: {
          start: workStart,
          end: workEnd,
          days: workDays,
          timezone: detectedTimezone,
          dnd: workDnd,
        },
        briefing_scope: briefingScope,
        calendar_send_invites: calendarSendInvites,
        notification_level: notificationLevel,
        notification_preview: notificationPreview,
      })
      .eq("id", user.id);
    let styleErr: { message?: string } | null = null;
    if (
      detectedStyle ||
      styleGreeting ||
      styleClosing ||
      styleTone ||
      styleLength
    ) {
      const res = await supabase.from("style_profiles").upsert(
        {
          user_id: user.id,
          greeting_style: styleGreeting || null,
          closing_style: styleClosing || null,
          tone: styleTone || null,
          avg_length: styleLength || null,
        },
        { onConflict: "user_id" },
      );
      styleErr = res.error;
    }
    setSaving(false);
    if (profileErr || styleErr) {
      console.error("[settings/autosave] failed:", profileErr ?? styleErr);
      const hint =
        profileErr?.message || styleErr?.message || "Failed to save settings";
      addToast("error", hint);
      return;
    }
    updateProfile({
      ai_mode: aiMode,
      style_notes: styleNotes || null,
      working_hours: {
        start: workStart,
        end: workEnd,
        days: workDays,
        timezone: detectedTimezone,
        dnd: workDnd,
      },
      briefing_scope: briefingScope,
      calendar_send_invites: calendarSendInvites,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  useEffect(() => {
    if (initialLoadRef.current) {
      initialLoadRef.current = false;
      return;
    }
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      autoSave();
    }, 800);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [
    aiMode,
    styleNotes,
    workStart,
    workEnd,
    workDays,
    workDnd,
    briefingScope,
    calendarSendInvites,
    styleGreeting,
    styleClosing,
    styleTone,
    styleLength,
    notificationLevel,
    notificationPreview,
  ]);

  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const [deletingAccount, setDeletingAccount] = useState(false);
  const [accountToDelete, setAccountToDelete] = useState<string>("");
  const [confirmAccountDelete, setConfirmAccountDelete] = useState(false);

  useEffect(() => {
    if (gmailAccounts.length === 1) setAccountToDelete(gmailAccounts[0].id);
    else setAccountToDelete("");
    setConfirmAccountDelete(false);
  }, [gmailAccounts]);

  const deleteAccount = async () => {
    if (!accountToDelete) return;
    if (!confirmAccountDelete) {
      setConfirmAccountDelete(true);
      return;
    }
    setDeletingAccount(true);
    setConfirmAccountDelete(false);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/api";
      let {
        data: { session },
      } = await supabase.auth.getSession();
      const deleteBody = JSON.stringify({ account_id: accountToDelete });
      let res = await fetch(`${apiUrl}/delete-account`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: deleteBody,
      });
      if (res.status === 401) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        session = refreshed.session;
        res = await fetch(`${apiUrl}/delete-account`, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: deleteBody,
        });
      }
      if (res.ok) {
        [
          "runemail_sent_cache",
          "runemail_drafts_cache",
          "runemail_briefing_cache",
        ].forEach((key) => {
          localStorage.removeItem(`${key}_${user.id}`);
        });
        const remaining = gmailAccounts.filter((a) => a.id !== accountToDelete);
        if (remaining.length === 0) {
          localStorage.removeItem(`runemail_tutorial_v2_${user.id}`);
          await supabase.auth.signOut();
          window.location.href = "/";
        } else {
          window.location.reload();
        }
      } else {
        addToast("error", "Delete failed. Please try again.");
      }
    } catch {
      addToast("error", "Could not reach the server.");
    }
    setDeletingAccount(false);
  };

  const connectGmail = async (addAccount = false) => {
    if (addAccount) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/api";
      const redirectUri = `${window.location.origin}/auth/google-add-account`;
      try {
        const res = await fetch(
          `${apiUrl}/oauth/google-url?redirect_uri=${encodeURIComponent(redirectUri)}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
        );
        if (!res.ok) throw new Error("Failed to get OAuth URL");
        const { url, state } = await res.json();
        // Stash only the signed state so the callback can validate it came
        // from us. The Supabase session stays in cookies; we no longer move
        // the JWT through localStorage.
        if (state) sessionStorage.setItem("runemail_add_account_state", state);
        window.location.href = url;
      } catch (err: any) {
        addToast("error", err?.message ?? "Failed to start OAuth flow");
      }
    } else {
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          scopes:
            "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events",
          queryParams: { access_type: "offline", prompt: "consent" },
        },
      });
    }
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="max-w-xl mx-auto w-full px-6 pt-6 pb-0 shrink-0">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-lg font-bold text-[var(--foreground)]">
            Settings
          </h1>
          {(saving || saved) && (
            <div
              className={`flex items-center gap-1.5 text-xs font-medium transition-all ${saved ? "text-green-500" : "text-[var(--muted)]"}`}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: "14px" }}
              >
                {saving ? "sync" : "check_circle"}
              </span>
              {saving ? "Saving..." : "Saved"}
            </div>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex gap-0.5 bg-slate-100 dark:bg-slate-800/60 rounded-xl p-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 px-1 rounded-lg text-center transition-all duration-150 ${
                activeTab === tab.id
                  ? "bg-[var(--background)] text-[var(--accent)] shadow-sm"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: "18px" }}
              >
                {tab.icon}
              </span>
              <span className="text-[10px] font-semibold tracking-wide">
                {tab.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 px-6 py-5">
        <div className="max-w-xl mx-auto space-y-4">
          {/* ---- ACCOUNT ---- */}
          {activeTab === "account" && (
            <>
              <SectionLabel>Gmail Accounts</SectionLabel>
              <SectionCard>
                {gmailAccounts.length === 0 ? (
                  <div className="p-4 flex items-center gap-3 text-[var(--muted)]">
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: "22px" }}
                    >
                      error
                    </span>
                    <p className="text-sm">
                      No Gmail account connected. Connect one to start fetching
                      emails.
                    </p>
                  </div>
                ) : (
                  gmailAccounts.map((acc) => (
                    <div
                      key={acc.id}
                      className="p-3 flex items-center gap-3 border-b border-[var(--border)] last:border-0"
                    >
                      <span
                        className="material-symbols-outlined text-green-500"
                        style={{ fontSize: "20px" }}
                      >
                        check_circle
                      </span>
                      <p className="text-sm font-medium text-[var(--foreground)] flex-1 truncate">
                        {acc.gmail_address || "Connected account"}
                      </p>
                      <button
                        onClick={() => connectGmail(false)}
                        title="Re-connect"
                        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-[var(--muted)]"
                      >
                        <span
                          className="material-symbols-outlined"
                          style={{ fontSize: "16px" }}
                        >
                          sync
                        </span>
                      </button>
                      <button
                        onClick={() => removeGmailAccount(acc.id)}
                        disabled={removingAccount === acc.id}
                        title="Remove"
                        className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-400 disabled:opacity-50"
                      >
                        <span
                          className="material-symbols-outlined"
                          style={{ fontSize: "16px" }}
                        >
                          {removingAccount === acc.id
                            ? "hourglass_top"
                            : "close"}
                        </span>
                      </button>
                    </div>
                  ))
                )}
                <div className="p-3 border-t border-[var(--border)]">
                  <button
                    onClick={() => connectGmail(gmailAccounts.length > 0)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-dashed border-[var(--border)] text-sm text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: "18px" }}
                    >
                      add
                    </span>
                    {gmailAccounts.length === 0
                      ? "Connect Gmail"
                      : "Add another account"}
                  </button>
                </div>
              </SectionCard>

              <SectionLabel>Help</SectionLabel>
              <SectionCard>
                <SettingRow
                  label="Getting started tutorial"
                  description="Replay the onboarding walkthrough."
                >
                  <button
                    onClick={() => {
                      localStorage.removeItem(
                        `runemail_tutorial_v2_${user.id}`,
                      );
                      startTutorial();
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent-light)] text-[var(--accent)] text-xs font-semibold hover:opacity-80 transition-opacity"
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: "15px" }}
                    >
                      school
                    </span>
                    Replay
                  </button>
                </SettingRow>
              </SectionCard>

              <SectionLabel className="text-red-500">Danger Zone</SectionLabel>
              <div className="rounded-xl border border-red-200 dark:border-red-900 overflow-hidden">
                <div className="p-4 border-b border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-900/10">
                  <p className="text-sm text-[var(--muted)]">
                    Permanently remove a connected Gmail account and all its
                    associated emails, meetings, todos, and AI data from
                    RuneMail. This cannot be undone.
                  </p>
                </div>

                <div className="p-4 space-y-3">
                  {gmailAccounts.length === 0 ? (
                    <p className="text-sm text-[var(--muted)] italic">
                      No connected accounts.
                    </p>
                  ) : gmailAccounts.length > 1 ? (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">
                        Select account to delete
                      </p>
                      {gmailAccounts.map((acc) => (
                        <label
                          key={acc.id}
                          className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                            accountToDelete === acc.id
                              ? "border-red-400 bg-red-50 dark:bg-red-900/20"
                              : "border-[var(--border)] hover:border-red-300 dark:hover:border-red-700"
                          }`}
                        >
                          <input
                            type="radio"
                            name="accountToDelete"
                            value={acc.id}
                            checked={accountToDelete === acc.id}
                            onChange={() => {
                              setAccountToDelete(acc.id);
                              setConfirmAccountDelete(false);
                            }}
                            className="accent-red-500"
                          />
                          <span
                            className="material-symbols-outlined text-[var(--muted)]"
                            style={{ fontSize: "18px" }}
                          >
                            mail
                          </span>
                          <span className="text-sm font-medium text-[var(--foreground)] flex-1 truncate">
                            {acc.gmail_address}
                          </span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-[var(--border)]">
                      <span
                        className="material-symbols-outlined text-[var(--muted)]"
                        style={{ fontSize: "18px" }}
                      >
                        mail
                      </span>
                      <span className="text-sm font-medium text-[var(--foreground)]">
                        {gmailAccounts[0]?.gmail_address}
                      </span>
                    </div>
                  )}

                  {confirmAccountDelete && (
                    <p className="text-sm font-medium text-red-600 dark:text-red-400">
                      All emails, meetings, and todos from this account will be
                      permanently deleted. Click again to confirm.
                    </p>
                  )}

                  <div className="flex items-center gap-3">
                    <button
                      onClick={deleteAccount}
                      disabled={deletingAccount || !accountToDelete}
                      className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-40 transition-colors ${
                        confirmAccountDelete
                          ? "bg-red-600 hover:bg-red-700"
                          : "bg-red-500 hover:bg-red-600"
                      }`}
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: "18px" }}
                      >
                        {deletingAccount ? "hourglass_top" : "delete_forever"}
                      </span>
                      {deletingAccount
                        ? "Deleting..."
                        : confirmAccountDelete
                          ? "Yes, Delete Account"
                          : "Delete Account"}
                    </button>
                    {confirmAccountDelete && (
                      <button
                        onClick={() => setConfirmAccountDelete(false)}
                        className="text-sm text-[var(--muted)] hover:underline"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ---- AI & WRITING ---- */}
          {activeTab === "ai" && (
            <>
              <SectionLabel>Processing Mode</SectionLabel>
              <div className="space-y-2">
                {aiModes.map((mode) => (
                  <button
                    key={mode.id}
                    onClick={() => handleModeChange(mode.id)}
                    className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                      aiMode === mode.id
                        ? "border-[var(--accent)] bg-[var(--accent-light)]"
                        : "border-[var(--border)] hover:border-slate-300 dark:hover:border-slate-600"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`material-symbols-outlined mt-0.5 ${aiMode === mode.id ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}
                        style={{ fontSize: "22px" }}
                      >
                        {mode.icon}
                      </span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-semibold text-sm ${aiMode === mode.id ? "text-[var(--accent)]" : "text-[var(--foreground)]"}`}
                          >
                            {mode.label}
                          </span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                              aiMode === mode.id
                                ? "bg-[var(--accent)] text-white"
                                : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                            }`}
                          >
                            {mode.badge}
                          </span>
                        </div>
                        <p className="text-xs text-[var(--muted)] mt-1">
                          {mode.desc}
                        </p>
                      </div>
                      <div
                        className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 ${
                          aiMode === mode.id
                            ? "border-[var(--accent)]"
                            : "border-[var(--border)]"
                        }`}
                      >
                        {aiMode === mode.id && (
                          <div className="w-2 h-2 rounded-full bg-[var(--accent)]" />
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <SectionLabel>Writing Style</SectionLabel>
              <SectionCard>
                <div className="p-4 border-b border-[var(--border)]">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="material-symbols-outlined text-[var(--accent)]"
                        style={{ fontSize: "15px" }}
                      >
                        auto_awesome
                      </span>
                      <span className="text-xs font-medium text-[var(--accent)]">
                        {detectedStyle
                          ? "Auto-detected from your sent emails"
                          : "Detect from your sent emails or set manually"}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleDetectStyle}
                      disabled={detectingStyle}
                      className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                    >
                      <span
                        className={`material-symbols-outlined${detectingStyle ? " animate-spin" : ""}`}
                        style={{ fontSize: "13px" }}
                      >
                        {detectingStyle ? "progress_activity" : "auto_fix"}
                      </span>
                      {detectingStyle
                        ? "Detecting..."
                        : detectedStyle
                          ? "Redetect"
                          : "Detect now"}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      {
                        label: "Greeting",
                        value: styleGreeting,
                        set: setStyleGreeting,
                        placeholder: "e.g. Hi",
                      },
                      {
                        label: "Closing",
                        value: styleClosing,
                        set: setStyleClosing,
                        placeholder: "e.g. Best regards",
                      },
                      {
                        label: "Tone",
                        value: styleTone,
                        set: setStyleTone,
                        placeholder: "e.g. casual",
                      },
                      {
                        label: "Length",
                        value: styleLength,
                        set: setStyleLength,
                        placeholder: "e.g. short",
                      },
                    ].map(({ label, value, set, placeholder }) => (
                      <div key={label} className="flex flex-col gap-1">
                        <span className="text-xs text-[var(--muted)]">
                          {label}
                        </span>
                        <input
                          type="text"
                          value={value}
                          onChange={(e) => set(e.target.value)}
                          placeholder={placeholder}
                          className="px-2 py-1.5 rounded-lg border border-[var(--border)] bg-transparent text-xs font-medium text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                        />
                      </div>
                    ))}
                  </div>
                  {!detectedStyle &&
                    !styleGreeting &&
                    !styleClosing &&
                    !styleTone &&
                    !styleLength && (
                      <p className="text-[11px] text-[var(--muted)] mt-2">
                        Style not yet detected. Click Detect now, or fill these
                        fields manually.
                      </p>
                    )}
                </div>
                <div className="p-4">
                  <p className="text-xs text-[var(--muted)] mb-3">
                    Override or add context the AI can&apos;t detect, e.g.
                    &quot;Always sign off with &apos;Best, George&apos;&quot; or
                    &quot;Never use bullet points&quot;.
                  </p>
                  <textarea
                    value={styleNotes}
                    onChange={(e) => setStyleNotes(e.target.value)}
                    placeholder="e.g. Always sign off with 'Best, George'. Never use bullet points."
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] resize-none"
                  />
                </div>
              </SectionCard>
            </>
          )}

          {/* ---- SCHEDULE ---- */}
          {activeTab === "schedule" && (
            <>
              <SectionLabel>Working Hours</SectionLabel>
              <SectionCard allowOverflow>
                <div className="p-4 border-b border-[var(--border)]">
                  <p className="text-xs font-medium text-[var(--muted)] mb-2">
                    Work Days
                  </p>
                  <div className="flex gap-1.5">
                    {dayLabels.map((day, i) => (
                      <button
                        key={i}
                        onClick={() =>
                          setWorkDays((prev) =>
                            prev.includes(i)
                              ? prev.filter((d) => d !== i)
                              : [...prev, i],
                          )
                        }
                        className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          workDays.includes(i)
                            ? "bg-[var(--accent)] text-white"
                            : "bg-slate-100 dark:bg-slate-800 text-[var(--muted)] hover:bg-slate-200 dark:hover:bg-slate-700"
                        }`}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="p-4 overflow-visible">
                  <p className="text-xs font-medium text-[var(--muted)] mb-2">
                    Hours
                  </p>
                  <div className="flex items-center gap-3 overflow-visible">
                    <div className="flex-1 overflow-visible">
                      <label className="text-[10px] text-[var(--muted)] uppercase tracking-wide">
                        Start
                      </label>
                      <TimePickerAmPm
                        value={workStart}
                        onChange={setWorkStart}
                      />
                    </div>
                    <span className="text-[var(--muted)] mt-6 text-sm">to</span>
                    <div className="flex-1 overflow-visible">
                      <label className="text-[10px] text-[var(--muted)] uppercase tracking-wide">
                        End
                      </label>
                      <TimePickerAmPm value={workEnd} onChange={setWorkEnd} />
                    </div>
                  </div>
                </div>
              </SectionCard>

              <SectionLabel>Notifications</SectionLabel>
              <SectionCard>
                <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    {pushPermission === "granted" ? (
                      <span
                        className="material-symbols-outlined text-[var(--success)]"
                        style={{ fontSize: "18px" }}
                      >
                        check_circle
                      </span>
                    ) : pushPermission === "denied" ? (
                      <span
                        className="material-symbols-outlined text-[var(--danger)]"
                        style={{ fontSize: "18px" }}
                      >
                        block
                      </span>
                    ) : pushPermission === "unsupported" ? (
                      <span
                        className="material-symbols-outlined text-[var(--muted)]"
                        style={{ fontSize: "18px" }}
                      >
                        notifications_off
                      </span>
                    ) : (
                      <span
                        className="material-symbols-outlined text-[var(--muted)]"
                        style={{ fontSize: "18px" }}
                      >
                        notifications
                      </span>
                    )}
                    <div>
                      <p className="text-sm font-medium text-[var(--foreground)]">
                        Browser notifications
                      </p>
                      <p className="text-xs text-[var(--muted)]">
                        {pushPermission === "granted" &&
                          "Enabled. Notifications will appear even when the tab is closed."}
                        {pushPermission === "denied" &&
                          "Blocked. Open your browser\u2019s site settings to allow notifications."}
                        {pushPermission === "unsupported" &&
                          "Not supported in this browser."}
                        {pushPermission === "default" &&
                          "Allow RuneMail to send you push notifications."}
                      </p>
                    </div>
                  </div>
                  {pushPermission === "default" && (
                    <button
                      onClick={handleEnablePush}
                      disabled={enablingPush}
                      className="shrink-0 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
                    >
                      {enablingPush ? "Enabling..." : "Enable"}
                    </button>
                  )}
                  {pushPermission === "granted" && (
                    <button
                      onClick={handleEnablePush}
                      disabled={enablingPush}
                      className="shrink-0 px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--foreground)] text-xs font-medium hover:bg-[var(--surface-2)] disabled:opacity-50 transition-colors"
                      title="Re-register this browser for push notifications"
                    >
                      {enablingPush ? "Reconnecting..." : "Reconnect"}
                    </button>
                  )}
                  {pushPermission === "denied" && (
                    <button
                      onClick={handleEnablePush}
                      disabled={enablingPush}
                      className="shrink-0 px-3 py-1.5 rounded-lg border border-[var(--danger)] text-[var(--danger)] text-xs font-medium hover:bg-[var(--danger)]/10 disabled:opacity-50 transition-colors"
                      title="Ask the browser for notification permission again"
                    >
                      {enablingPush ? "Retrying..." : "Try again"}
                    </button>
                  )}
                </div>
                <div className="p-4 border-b border-[var(--border)]">
                  <p className="text-xs font-medium text-[var(--muted)] mb-3">
                    When should RuneMail notify you?
                  </p>
                  <div className="space-y-2">
                    {(
                      [
                        {
                          id: "all",
                          icon: "notifications",
                          label: "All emails",
                          desc: "Get notified for every new email that arrives.",
                        },
                        {
                          id: "important",
                          icon: "priority_high",
                          label: "Important only",
                          desc: "Only notify for important or action-required emails. Requires Cloud or Hybrid AI mode.",
                        },
                        {
                          id: "none",
                          icon: "notifications_off",
                          label: "None",
                          desc: "Never send push notifications.",
                        },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => setNotificationLevel(opt.id)}
                        className={`w-full text-left flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${
                          notificationLevel === opt.id
                            ? "border-[var(--accent)] bg-[var(--accent-light)]"
                            : "border-[var(--border)] hover:border-slate-300 dark:hover:border-slate-600"
                        }`}
                      >
                        <span
                          className={`material-symbols-outlined ${notificationLevel === opt.id ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}
                          style={{ fontSize: "18px" }}
                        >
                          {opt.icon}
                        </span>
                        <div className="flex-1">
                          <p
                            className={`text-sm font-medium ${notificationLevel === opt.id ? "text-[var(--accent)]" : "text-[var(--foreground)]"}`}
                          >
                            {opt.label}
                          </p>
                          <p className="text-xs text-[var(--muted)] mt-0.5">
                            {opt.desc}
                          </p>
                        </div>
                        <div
                          className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${notificationLevel === opt.id ? "border-[var(--accent)]" : "border-[var(--border)]"}`}
                        >
                          {notificationLevel === opt.id && (
                            <div className="w-2 h-2 rounded-full bg-[var(--accent)]" />
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <SettingRow
                  label="Show sender and subject"
                  description="Display email preview in the notification. Turn off for more privacy."
                >
                  <Toggle
                    value={notificationPreview}
                    onChange={setNotificationPreview}
                  />
                </SettingRow>
                <SettingRow
                  label="Do Not Disturb"
                  description="Silence push notifications outside your working hours."
                >
                  <Toggle value={workDnd} onChange={setWorkDnd} />
                </SettingRow>
              </SectionCard>
            </>
          )}

          {/* ---- BRIEFING ---- */}
          {activeTab === "briefing" && (
            <>
              <SectionLabel>Daily Briefing Scope</SectionLabel>
              <SectionCard>
                <div className="px-4 pt-3 pb-2 border-b border-[var(--border)]">
                  <p className="text-xs text-[var(--muted)]">
                    Choose which emails are included in your AI-generated daily
                    briefing.
                  </p>
                </div>
                {(
                  [
                    {
                      id: "today_new",
                      icon: "today",
                      label: "New emails today",
                      desc: "Only emails that arrived today and haven't been briefed yet.",
                    },
                    {
                      id: "today_unread",
                      icon: "mark_email_unread",
                      label: "Unread emails today",
                      desc: "Emails that arrived today and are still unread in Gmail.",
                    },
                    {
                      id: "past_week",
                      icon: "date_range",
                      label: "Past week",
                      desc: "Emails from the last 7 days for a broader overview.",
                    },
                    {
                      id: "all_recent",
                      icon: "inbox",
                      label: "Last 40 emails",
                      desc: "Your 40 most recent emails regardless of date.",
                    },
                  ] as const
                ).map((opt, i, arr) => (
                  <button
                    key={opt.id}
                    onClick={() => setBriefingScope(opt.id)}
                    className={`w-full text-left flex items-center gap-3 p-4 transition-colors ${
                      i < arr.length - 1
                        ? "border-b border-[var(--border)]"
                        : ""
                    } ${briefingScope === opt.id ? "bg-[var(--accent-light)]" : "hover:bg-slate-50 dark:hover:bg-slate-800/50"}`}
                  >
                    <span
                      className={`material-symbols-outlined ${briefingScope === opt.id ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}
                      style={{ fontSize: "20px" }}
                    >
                      {opt.icon}
                    </span>
                    <div className="flex-1">
                      <p
                        className={`text-sm font-medium ${briefingScope === opt.id ? "text-[var(--accent)]" : "text-[var(--foreground)]"}`}
                      >
                        {opt.label}
                      </p>
                      <p className="text-xs text-[var(--muted)] mt-0.5">
                        {opt.desc}
                      </p>
                    </div>
                    <div
                      className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${briefingScope === opt.id ? "border-[var(--accent)]" : "border-[var(--border)]"}`}
                    >
                      {briefingScope === opt.id && (
                        <div className="w-2 h-2 rounded-full bg-[var(--accent)]" />
                      )}
                    </div>
                  </button>
                ))}
              </SectionCard>

              <SectionLabel>Briefing audio</SectionLabel>
              <SectionCard>
                <SettingRow
                  label="Auto process audio"
                  description="Generate speech for your executive summary in the background and cache it so Listen starts instantly."
                >
                  <Toggle
                    value={briefingAudioAutoplay}
                    onChange={setBriefingAudioAutoplay}
                  />
                </SettingRow>
              </SectionCard>

              <SectionLabel>Briefing Audio Voice</SectionLabel>
              <SectionCard>
                <div className="px-4 pt-3 pb-2 border-b border-[var(--border)]">
                  <p className="text-xs text-[var(--muted)]">
                    Click a name to select, or press play to preview. Powered by
                    gpt-4o-mini-tts.
                  </p>
                </div>
                <div className="divide-y divide-[var(--border)]">
                  {TTS_VOICES.map((voice) => {
                    const isSelected = selectedVoice === voice.name;
                    const isPreviewing = previewingVoice === voice.name;
                    return (
                      <div
                        key={voice.name}
                        className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                          isSelected
                            ? "bg-[var(--accent-light)]"
                            : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                        }`}
                      >
                        <button
                          onClick={() => {
                            setSelectedVoice(voice.name);
                            try {
                              localStorage.setItem(
                                "runemail_tts_voice",
                                voice.name,
                              );
                            } catch {
                              /* ignore */
                            }
                          }}
                          className="flex items-center gap-3 flex-1 min-w-0 text-left"
                        >
                          <span
                            className={`material-symbols-outlined ${isSelected ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}
                            style={{ fontSize: "16px" }}
                          >
                            record_voice_over
                          </span>
                          <div className="flex-1 min-w-0">
                            <p
                              className={`text-sm font-medium ${isSelected ? "text-[var(--accent)]" : "text-[var(--foreground)]"}`}
                            >
                              {voice.label}
                            </p>
                            <p className="text-xs text-[var(--muted)]">
                              {voice.description}
                            </p>
                          </div>
                          {isSelected && (
                            <div className="shrink-0 w-2 h-2 rounded-full bg-[var(--accent)]" />
                          )}
                        </button>
                        <button
                          onClick={() => previewVoice(voice.name, voice.label)}
                          className={`shrink-0 flex items-center justify-center w-7 h-7 rounded-full transition-colors ${
                            isPreviewing
                              ? "bg-[var(--accent)] text-white"
                              : "text-[var(--muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-light)]"
                          }`}
                          title={
                            isPreviewing ? "Stop preview" : "Preview voice"
                          }
                        >
                          <span
                            className="material-symbols-outlined"
                            style={{ fontSize: "14px" }}
                          >
                            {isPreviewing ? "stop" : "play_arrow"}
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </SectionCard>

              <SectionLabel>Calendar</SectionLabel>
              <SectionCard>
                <SettingRow
                  label="Send calendar invites to attendees"
                  description="When enabled, attendees receive Google Calendar notification emails when you create or update meetings."
                >
                  <Toggle
                    value={calendarSendInvites}
                    onChange={setCalendarSendInvites}
                  />
                </SettingRow>
              </SectionCard>
            </>
          )}

          {/* ---- AUTOMATION ---- */}
          {activeTab === "automation" && (
            <>
              <SectionLabel>Delegation Rules</SectionLabel>
              <SectionCard>
                <div className="p-4 border-b border-[var(--border)] bg-slate-50 dark:bg-slate-800/40 space-y-3">
                  <p className="text-xs text-[var(--muted)]">
                    When an email matches the pattern, it will be flagged for
                    forwarding to the target address.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="text"
                      value={newPattern}
                      onChange={(e) => setNewPattern(e.target.value)}
                      placeholder="Pattern (e.g. invoice, support request)"
                      className="flex-1 min-w-[150px] px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                    />
                    <EmailField
                      value={newTargetEmail}
                      onChange={setNewTargetEmail}
                      contacts={contacts}
                      placeholder="Forward to email"
                      multi={false}
                      className="flex-1 min-w-[150px]"
                    />
                    <button
                      onClick={addDelegation}
                      disabled={!newPattern.trim() || !newTargetEmail.trim()}
                      className="px-4 py-1.5 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                </div>
                {!delegationsLoaded ? (
                  <div className="p-4 text-sm text-[var(--muted)]">
                    Loading...
                  </div>
                ) : delegations.length === 0 ? (
                  <div className="p-8 text-center text-sm text-[var(--muted)]">
                    <span
                      className="material-symbols-outlined block mx-auto mb-2 text-slate-300 dark:text-slate-600"
                      style={{ fontSize: "32px" }}
                    >
                      alt_route
                    </span>
                    No delegation rules yet.
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--border)]">
                    {delegations.map((d) => (
                      <div
                        key={d.id}
                        className="flex items-center gap-3 p-3 group"
                      >
                        <button
                          onClick={() => toggleDelegation(d.id, d.is_enabled)}
                        >
                          <span
                            className={`material-symbols-outlined ${d.is_enabled ? "text-[var(--success)]" : "text-[var(--muted)]"}`}
                            style={{
                              fontSize: "22px",
                              fontVariationSettings: d.is_enabled
                                ? "'FILL' 1"
                                : "'FILL' 0",
                            }}
                          >
                            toggle_on
                          </span>
                        </button>
                        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                          <span className="text-sm text-[var(--foreground)]">
                            &ldquo;{d.pattern}&rdquo;
                          </span>
                          <span
                            className="material-symbols-outlined text-[var(--muted)]"
                            style={{ fontSize: "16px" }}
                          >
                            arrow_forward
                          </span>
                          <span className="text-sm text-[var(--accent)]">
                            {d.target_email}
                          </span>
                        </div>
                        <button
                          onClick={() => deleteDelegation(d.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-400 transition-opacity"
                        >
                          <span
                            className="material-symbols-outlined"
                            style={{ fontSize: "18px" }}
                          >
                            delete
                          </span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </>
          )}

          {activeTab === "templates" && (
            <>
              <div className="flex items-center justify-between mb-2">
                <SectionLabel className="mb-0">Email Templates</SectionLabel>
                <button
                  onClick={openNewTemplate}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer"
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: "15px" }}
                  >
                    add
                  </span>
                  New Template
                </button>
              </div>

              {/* Template editor */}
              {showTemplateEditor && (
                <SectionCard className="mb-4 border-[var(--accent)] shadow-sm">
                  <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-[var(--accent)] flex items-center justify-center">
                        <span
                          className="material-symbols-outlined text-white"
                          style={{
                            fontSize: "15px",
                            fontVariationSettings: "'FILL' 1",
                          }}
                        >
                          description
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-[var(--foreground)]">
                        {editingTemplate ? "Edit Template" : "New Template"}
                      </p>
                    </div>
                    <button
                      onClick={() => setShowTemplateEditor(false)}
                      className="p-1 rounded hover:bg-[var(--surface-2)] text-[var(--muted)] cursor-pointer"
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: "18px" }}
                      >
                        close
                      </span>
                    </button>
                  </div>

                  <div className="p-4 space-y-4">
                    {/* Name */}
                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-widest text-[var(--muted)] mb-1.5">
                        Template Name
                      </label>
                      <input
                        type="text"
                        value={templateForm.name}
                        onChange={(e) =>
                          setTemplateForm((f) => ({
                            ...f,
                            name: e.target.value,
                          }))
                        }
                        placeholder="e.g. Follow-up, Introduction, Thank you"
                        className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                      />
                    </div>

                    {/* Subject */}
                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-widest text-[var(--muted)] mb-1.5">
                        Subject{" "}
                        <span className="normal-case font-normal opacity-60">
                          (optional)
                        </span>
                      </label>
                      <input
                        type="text"
                        value={templateForm.subject}
                        onChange={(e) =>
                          setTemplateForm((f) => ({
                            ...f,
                            subject: e.target.value,
                          }))
                        }
                        placeholder="Pre-fill the subject line when applied"
                        className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                      />
                    </div>

                    {/* Body */}
                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-widest text-[var(--muted)] mb-1.5">
                        Body
                      </label>
                      <textarea
                        value={templateForm.body_html}
                        onChange={(e) =>
                          setTemplateForm((f) => ({
                            ...f,
                            body_html: e.target.value,
                          }))
                        }
                        placeholder="Write your template content here..."
                        rows={8}
                        className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] transition-colors resize-y font-mono leading-relaxed"
                      />
                      <p className="text-[11px] text-[var(--muted)] mt-1.5">
                        This template can only be applied when composing an
                        email.
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-3 pt-1">
                      <button
                        onClick={saveTemplate}
                        disabled={
                          savingTemplate ||
                          !templateForm.name.trim() ||
                          !templateForm.body_html.trim()
                        }
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer"
                      >
                        {savingTemplate && (
                          <span
                            className="material-symbols-outlined animate-spin"
                            style={{ fontSize: "15px" }}
                          >
                            progress_activity
                          </span>
                        )}
                        {editingTemplate ? "Save Changes" : "Create Template"}
                      </button>
                      <button
                        onClick={() => setShowTemplateEditor(false)}
                        className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </SectionCard>
              )}

              {/* Template list */}
              <SectionCard>
                {!templatesLoaded ? (
                  <div className="p-6 flex justify-center">
                    <span
                      className="material-symbols-outlined animate-spin text-[var(--muted)]"
                      style={{ fontSize: "20px" }}
                    >
                      progress_activity
                    </span>
                  </div>
                ) : emailTemplates.length === 0 ? (
                  <div className="p-8 flex flex-col items-center gap-3 text-center">
                    <div className="w-12 h-12 rounded-2xl bg-[var(--surface-2)] flex items-center justify-center">
                      <span
                        className="material-symbols-outlined text-[var(--muted)]"
                        style={{
                          fontSize: "24px",
                          fontVariationSettings: "'FILL' 1, 'wght' 200",
                        }}
                      >
                        description
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[var(--foreground)] opacity-60">
                        No templates yet
                      </p>
                      <p className="text-xs text-[var(--muted)] mt-1">
                        Create one above, or save your current message as a
                        template while composing.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--border)]">
                    {emailTemplates.map((t) => {
                      const bodyText = t.body_html
                        .replace(/<[^>]+>/g, " ")
                        .replace(/\s+/g, " ")
                        .trim()
                        .slice(0, 120);
                      const isEditing =
                        editingTemplate?.id === t.id && showTemplateEditor;
                      return (
                        <div
                          key={t.id}
                          className={`flex items-start gap-3 px-4 py-3 transition-colors group ${isEditing ? "bg-[var(--accent-light)]" : "hover:bg-[var(--surface-2)]"}`}
                        >
                          <div className="w-8 h-8 rounded-lg bg-[var(--accent-light)] flex items-center justify-center shrink-0 mt-0.5">
                            <span
                              className="material-symbols-outlined text-[var(--accent)]"
                              style={{
                                fontSize: "16px",
                                fontVariationSettings: "'FILL' 1",
                              }}
                            >
                              description
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-[var(--foreground)] truncate">
                              {t.name}
                            </p>
                            {t.subject && (
                              <p className="text-xs text-[var(--muted)] truncate mt-0.5">
                                Subject: {t.subject}
                              </p>
                            )}
                            {bodyText && (
                              <p className="text-xs text-[var(--muted)] truncate mt-0.5 opacity-70">
                                {bodyText}
                                {bodyText.length === 120 ? "..." : ""}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() =>
                                isEditing
                                  ? setShowTemplateEditor(false)
                                  : openEditTemplate(t)
                              }
                              className="p-1 rounded hover:bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
                              title={
                                isEditing ? "Close editor" : "Edit template"
                              }
                            >
                              <span
                                className="material-symbols-outlined"
                                style={{ fontSize: "16px" }}
                              >
                                {isEditing ? "close" : "edit"}
                              </span>
                            </button>
                            <button
                              onClick={() => deleteTemplate(t.id)}
                              className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-[var(--muted)] hover:text-red-500 transition-colors"
                              title="Delete template"
                            >
                              <span
                                className="material-symbols-outlined"
                                style={{ fontSize: "16px" }}
                              >
                                delete
                              </span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </SectionCard>
            </>
          )}

          {activeTab === "signatures" && (
            <>
              <div className="flex items-center justify-between mb-2">
                <SectionLabel className="mb-0">Email Signatures</SectionLabel>
                <button
                  onClick={openNewSignature}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer"
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: "15px" }}
                  >
                    add
                  </span>
                  New Signature
                </button>
              </div>

              {/* Editor / form */}
              {showSigEditor && (
                <SectionCard className="mb-4 border-[var(--accent)] shadow-sm">
                  <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-[var(--accent)] flex items-center justify-center">
                        <span
                          className="material-symbols-outlined text-white"
                          style={{
                            fontSize: "15px",
                            fontVariationSettings: "'FILL' 1",
                          }}
                        >
                          draw
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-[var(--foreground)]">
                        {editingSignature ? "Edit Signature" : "New Signature"}
                      </p>
                    </div>
                    <button
                      onClick={() => setShowSigEditor(false)}
                      className="p-1 rounded hover:bg-[var(--surface-2)] text-[var(--muted)] cursor-pointer"
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: "18px" }}
                      >
                        close
                      </span>
                    </button>
                  </div>

                  <div className="p-4 space-y-4">
                    {/* Name + account row */}
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <label className="block text-[11px] font-semibold uppercase tracking-widest text-[var(--muted)] mb-1.5">
                          Name
                        </label>
                        <input
                          type="text"
                          value={sigForm.name}
                          onChange={(e) =>
                            setSigForm((f) => ({ ...f, name: e.target.value }))
                          }
                          placeholder="e.g. Work Signature"
                          className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                        />
                      </div>
                      {gmailAccounts.length > 1 && (
                        <div className="flex-1">
                          <label className="block text-[11px] font-semibold uppercase tracking-widest text-[var(--muted)] mb-1.5">
                            Account
                          </label>
                          <select
                            value={sigForm.gmail_account_id}
                            onChange={(e) =>
                              setSigForm((f) => ({
                                ...f,
                                gmail_account_id: e.target.value,
                              }))
                            }
                            className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] transition-colors cursor-pointer"
                          >
                            <option value="">All accounts</option>
                            {gmailAccounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.gmail_address}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>

                    {/* Rich HTML body */}
                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-widest text-[var(--muted)] mb-1.5">
                        Signature Content
                      </label>
                      {/* Simple contenteditable-backed rich area */}
                      <div className="rounded-xl border border-[var(--border)] overflow-hidden">
                        {/* Mini toolbar */}
                        <div className="flex items-center gap-1 px-3 py-2 bg-[var(--surface-2)] border-b border-[var(--border)]">
                          {[
                            { cmd: "bold", icon: "format_bold", title: "Bold" },
                            {
                              cmd: "italic",
                              icon: "format_italic",
                              title: "Italic",
                            },
                            {
                              cmd: "underline",
                              icon: "format_underlined",
                              title: "Underline",
                            },
                          ].map(({ cmd, icon, title }) => (
                            <button
                              key={cmd}
                              type="button"
                              title={title}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                document.execCommand(cmd, false);
                              }}
                              className="p-1.5 rounded hover:bg-[var(--border)] text-[var(--foreground)] transition-colors cursor-pointer"
                            >
                              <span
                                className="material-symbols-outlined"
                                style={{ fontSize: "16px" }}
                              >
                                {icon}
                              </span>
                            </button>
                          ))}
                          <div className="w-px h-5 bg-[var(--border)] mx-1" />
                          <button
                            type="button"
                            title="Insert link"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              const url = prompt("Link URL:");
                              if (url)
                                document.execCommand("createLink", false, url);
                            }}
                            className="p-1.5 rounded hover:bg-[var(--border)] text-[var(--foreground)] transition-colors cursor-pointer"
                          >
                            <span
                              className="material-symbols-outlined"
                              style={{ fontSize: "16px" }}
                            >
                              link
                            </span>
                          </button>
                          <button
                            type="button"
                            title="Clear formatting"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              document.execCommand("removeFormat", false);
                            }}
                            className="p-1.5 rounded hover:bg-[var(--border)] text-[var(--foreground)] transition-colors cursor-pointer"
                          >
                            <span
                              className="material-symbols-outlined"
                              style={{ fontSize: "16px" }}
                            >
                              format_clear
                            </span>
                          </button>
                        </div>
                        <div
                          contentEditable
                          suppressContentEditableWarning
                          dangerouslySetInnerHTML={{
                            __html: sanitizeSignatureHtml(sigForm.html),
                          }}
                          onInput={(e) =>
                            setSigForm((f) => ({
                              ...f,
                              html: (e.target as HTMLDivElement).innerHTML,
                            }))
                          }
                          className="min-h-[120px] p-4 text-sm text-[var(--foreground)] focus:outline-none"
                          style={{ lineHeight: "1.6" }}
                        />
                      </div>
                      <p className="text-[11px] text-[var(--muted)] mt-1.5">
                        Your signature is your contact block, appended after
                        your closing (e.g. "Best regards,"). Include your name,
                        title, company, phone, or a link.
                      </p>
                    </div>

                    {/* Default toggle */}
                    <div className="flex items-center justify-between py-3 px-4 rounded-xl bg-[var(--surface-2)]">
                      <div>
                        <p className="text-sm font-medium text-[var(--foreground)]">
                          Set as default
                        </p>
                        <p className="text-xs text-[var(--muted)] mt-0.5">
                          Auto-append to new emails
                          {gmailAccounts.length > 1
                            ? " for the selected account"
                            : ""}
                        </p>
                      </div>
                      <Toggle
                        value={sigForm.is_default}
                        onChange={(v) =>
                          setSigForm((f) => ({ ...f, is_default: v }))
                        }
                      />
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-3 pt-1">
                      <button
                        onClick={saveSignature}
                        disabled={savingSignature || !sigForm.name.trim()}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-all cursor-pointer"
                      >
                        {savingSignature ? (
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
                        {savingSignature
                          ? "Saving..."
                          : editingSignature
                            ? "Save Changes"
                            : "Create Signature"}
                      </button>
                      <button
                        onClick={() => setShowSigEditor(false)}
                        className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm font-medium text-[var(--foreground)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </SectionCard>
              )}

              {/* Signature list */}
              <SectionCard>
                {!signaturesLoaded ? (
                  <div className="p-6 flex justify-center">
                    <span
                      className="material-symbols-outlined animate-spin text-[var(--muted)]"
                      style={{ fontSize: "20px" }}
                    >
                      progress_activity
                    </span>
                  </div>
                ) : signatures.length === 0 ? (
                  <div className="p-10 flex flex-col items-center gap-4 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[var(--accent-light)] to-[var(--surface-2)] flex items-center justify-center shadow-sm">
                      <span
                        className="material-symbols-outlined text-[var(--accent)]"
                        style={{
                          fontSize: "28px",
                          fontVariationSettings: "'FILL' 1, 'wght' 200",
                        }}
                      >
                        draw
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[var(--foreground)]">
                        No signatures yet
                      </p>
                      <p className="text-xs text-[var(--muted)] mt-1 max-w-xs">
                        Create a signature with your name, title, company, and
                        contact info. It appears after your email closing.
                      </p>
                    </div>
                    <button
                      onClick={openNewSignature}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--accent)] text-white text-sm font-semibold hover:opacity-90 transition-opacity cursor-pointer shadow-sm"
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: "16px" }}
                      >
                        add
                      </span>
                      Create your first signature
                    </button>
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--border)]">
                    {signatures.map((sig) => {
                      const accountLabel = sig.gmail_account_id
                        ? (gmailAccounts.find(
                            (a) => a.id === sig.gmail_account_id,
                          )?.gmail_address ?? "Specific account")
                        : "All accounts";
                      const preview = sig.html
                        .replace(/<[^>]+>/g, " ")
                        .replace(/\s+/g, " ")
                        .trim()
                        .slice(0, 100);
                      return (
                        <div
                          key={sig.id}
                          className="group flex items-start gap-4 px-5 py-4 hover:bg-[var(--surface-2)] transition-colors"
                        >
                          {/* Icon */}
                          <div className="w-9 h-9 rounded-xl bg-[var(--accent-light)] flex items-center justify-center shrink-0 mt-0.5">
                            <span
                              className="material-symbols-outlined text-[var(--accent)]"
                              style={{
                                fontSize: "18px",
                                fontVariationSettings: "'FILL' 1",
                              }}
                            >
                              draw
                            </span>
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-semibold text-[var(--foreground)] truncate">
                                {sig.name}
                              </p>
                              {sig.is_default && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--accent)] text-white text-[10px] font-bold uppercase tracking-wide">
                                  <span
                                    className="material-symbols-outlined"
                                    style={{
                                      fontSize: "10px",
                                      fontVariationSettings: "'FILL' 1",
                                    }}
                                  >
                                    star
                                  </span>
                                  Default
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-[var(--muted)] mt-0.5 flex items-center gap-1">
                              <span
                                className="material-symbols-outlined"
                                style={{ fontSize: "12px" }}
                              >
                                mail
                              </span>
                              {accountLabel}
                            </p>
                            {preview && (
                              <p className="text-xs text-[var(--muted)] mt-1.5 opacity-70 leading-relaxed line-clamp-2">
                                {preview}
                                {preview.length >= 100 ? "..." : ""}
                              </p>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            <button
                              onClick={() => openEditSignature(sig)}
                              className="p-1.5 rounded-lg hover:bg-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] transition-all cursor-pointer"
                              title="Edit signature"
                            >
                              <span
                                className="material-symbols-outlined"
                                style={{ fontSize: "16px" }}
                              >
                                edit
                              </span>
                            </button>
                            <button
                              onClick={() => deleteSignature(sig.id)}
                              className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-[var(--muted)] hover:text-red-500 transition-all cursor-pointer"
                              title="Delete signature"
                            >
                              <span
                                className="material-symbols-outlined"
                                style={{ fontSize: "16px" }}
                              >
                                delete
                              </span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </SectionCard>

              {/* Info callout */}
              <div className="mt-3 flex items-start gap-3 px-4 py-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                <span
                  className="material-symbols-outlined text-blue-500 mt-0.5"
                  style={{
                    fontSize: "16px",
                    fontVariationSettings: "'FILL' 1",
                  }}
                >
                  info
                </span>
                <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
                  Your signature is appended after the email closing and
                  contains your contact details. It is added automatically when
                  you open a new email; you can switch or remove it inside the
                  Compose window.
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {showWebLLMConsent && (
        <WebLLMConsentModal
          onConsent={handleWebLLMConsent}
          onCancel={() => setShowWebLLMConsent(false)}
        />
      )}
    </div>
  );
}
