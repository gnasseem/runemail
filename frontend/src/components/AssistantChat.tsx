"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useApp } from "./AppShell";
import { initWebLLM, isWebLLMReady, localChatInference, extractJSON } from "@/lib/webllm";

type Action = { type: string; data: Record<string, unknown> };

// Web Speech API types (not in all TS lib versions)
interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onresult: ((e: SpeechRecognitionResultEvent) => void) | null;
}
interface SpeechRecognitionResultEvent {
  results: { [index: number]: { [index: number]: { transcript: string } } };
}
interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

type Message = {
  role: "user" | "assistant";
  content: string;
  actions?: Action[];
};

const MAX_MESSAGES = 16;
const GREETING = "Hi! I'm your email assistant. I can search emails, send messages, create meetings, manage todos, and answer questions about your inbox. What can I help with?";

// ── Local chat helpers ──────────────────────────────────────────────

function buildLocalSystemPrompt(displayName: string, timezone: string): string {
  const today = new Date().toISOString().split("T")[0];

  return `You are RuneMail Assistant for ${displayName}. Today: ${today}. Timezone: ${timezone}.

CRITICAL OUTPUT RULE: Respond with valid JSON only. No text outside JSON.
Format 1 - Call tools (you can call multiple at once): {"type":"tool_calls","calls":[{"name":"TOOL","args":{...}}, ...]}
Format 2 - Single tool call: {"type":"tool_call","name":"TOOL_NAME","args":{...}}
Format 3 - Reply to user: {"type":"reply","reply":"your message","actions":[]}

GATHER FIRST — BATCH ALL INFORMATION CALLS:
In your FIRST response, call ALL information-gathering tools you need SIMULTANEOUSLY.
Include: lookup_contact, search_emails_by_sender, search_emails, get_email, list_todos, list_meetings, search_knowledge_base, get_recent_emails.
NEVER call information tools one per round. Batch all reads, then take all actions.
Pattern: Round 1 = gather everything. Round 2 = take all actions. Round 3 = confirm.

CONTACT RESEARCH: When any person is mentioned, ALWAYS call lookup_contact(name) AND search_emails_by_sender(name) in the same round before acting. EXCEPTION: if lookup_contact returns nothing, ask the user for their email address.

BEHAVIOR:
- NEVER list options in "reply" field; use suggest_reply_options tool instead
- Confirm completed actions in past tense: "I sent", "I created"
- For unclear email references: search first, then act
- COMPLETE every task. If asked to do multiple things, do ALL of them.

TOOLS:
get_recent_emails(limit?) - Recent inbox emails
search_emails(query) - Search by keyword/topic/sender
search_emails_by_sender(sender) - All emails from a person
search_emails_by_date(start_date, end_date?) - Emails in date range YYYY-MM-DD
search_emails_by_sender_and_date(sender, start_date, end_date?) - Combined
get_email(id) - Full email content
get_email_thread(thread_id) - Full thread
send_email(to, subject, body) - Send email
reply_to_email(email_id, body) - Reply to an email
list_todos - List open todos
create_todo(text) - Create todo
update_todo(id, text?, is_completed?) - Update todo
delete_todo(id) - Delete todo
list_meetings - List upcoming meetings
create_meeting(title, start_time, end_time, attendees?, description?) - Create meeting (ISO 8601)
update_meeting(id, title?, start_time?, end_time?, attendees?) - Update meeting
delete_meeting(id) - Delete meeting
list_drafts - List drafts
save_draft(to, subject, body) - Save draft
delete_draft(id) - Delete draft
lookup_contact(name) - Get email address and history for a person
search_knowledge_base(query) - Search saved knowledge
add_knowledge(entity, entity_type, info) - Save info (entity_type: person/company/topic)
get_read_receipts - Emails sent but not opened
archive_email(email_id) - Archive email
list_tags - List tags
create_tag(display_name, slug, color?) - Create tag
suggest_reply_options(options, recommended, context?) - Show clickable option cards. options=[{label,description}], recommended=index

Sign all emails as: Best regards,\n${displayName}`;
}

type SupabaseClient = ReturnType<typeof createClient>;

async function executeLocalTool(
  name: string,
  args: Record<string, unknown>,
  supabase: SupabaseClient,
  userId: string,
  session: { access_token: string } | null,
  apiUrl: string,
  pendingActions: Action[],
  timezone: string,
): Promise<string> {
  try {
    switch (name) {
      case "get_recent_emails": {
        const limit = Math.min(Number(args.limit) || 10, 30);
        const { data } = await supabase
          .from("emails")
          .select("id, subject, sender, sender_email, received_at, snippet, email_processed(summary, category)")
          .eq("user_id", userId)
          .order("received_at", { ascending: false })
          .limit(limit);
        return JSON.stringify(data ?? []);
      }
      case "search_emails": {
        const { data } = await supabase
          .from("emails")
          .select("id, subject, sender, sender_email, received_at, snippet")
          .eq("user_id", userId)
          .or(`subject.ilike.%${args.query}%,body_text.ilike.%${args.query}%,sender.ilike.%${args.query}%`)
          .order("received_at", { ascending: false })
          .limit(15);
        return JSON.stringify(data ?? []);
      }
      case "search_emails_by_sender": {
        const { data } = await supabase
          .from("emails")
          .select("id, subject, sender, sender_email, received_at, snippet")
          .eq("user_id", userId)
          .or(`sender.ilike.%${args.sender}%,sender_email.ilike.%${args.sender}%`)
          .order("received_at", { ascending: false })
          .limit(15);
        return JSON.stringify(data ?? []);
      }
      case "search_emails_by_date": {
        const q = supabase
          .from("emails")
          .select("id, subject, sender, sender_email, received_at, snippet")
          .eq("user_id", userId)
          .gte("received_at", args.start_date as string);
        const { data } = await (args.end_date ? q.lte("received_at", args.end_date as string) : q)
          .order("received_at", { ascending: false })
          .limit(20);
        return JSON.stringify(data ?? []);
      }
      case "search_emails_by_sender_and_date": {
        const q = supabase
          .from("emails")
          .select("id, subject, sender, sender_email, received_at, snippet")
          .eq("user_id", userId)
          .or(`sender.ilike.%${args.sender}%,sender_email.ilike.%${args.sender}%`)
          .gte("received_at", args.start_date as string);
        const { data } = await (args.end_date ? q.lte("received_at", args.end_date as string) : q)
          .order("received_at", { ascending: false })
          .limit(15);
        return JSON.stringify(data ?? []);
      }
      case "get_email": {
        const { data } = await supabase
          .from("emails")
          .select("id, subject, sender, sender_email, received_at, body_text, thread_id, gmail_id, email_processed(summary, category, quick_actions)")
          .eq("id", args.id as string)
          .eq("user_id", userId)
          .maybeSingle();
        return JSON.stringify(data ?? { error: "Email not found" });
      }
      case "get_email_thread": {
        const { data } = await supabase
          .from("emails")
          .select("id, subject, sender, sender_email, received_at, body_text, gmail_id")
          .eq("user_id", userId)
          .eq("thread_id", args.thread_id as string)
          .order("received_at", { ascending: true });
        return JSON.stringify(data ?? []);
      }
      case "list_todos": {
        const { data } = await supabase
          .from("todos")
          .select("id, text, is_completed, created_at")
          .eq("user_id", userId)
          .eq("is_completed", false)
          .order("created_at", { ascending: false });
        return JSON.stringify(data ?? []);
      }
      case "create_todo": {
        const { data } = await supabase
          .from("todos")
          .insert({ user_id: userId, text: args.text as string, source: "assistant" })
          .select("id")
          .single();
        if (data) pendingActions.push({ type: "create_todo", data: { text: args.text as string, id: (data as { id: string }).id } });
        return JSON.stringify({ success: true, id: (data as { id: string } | null)?.id });
      }
      case "update_todo": {
        const updates: Record<string, unknown> = {};
        if (args.text !== undefined) updates.text = args.text;
        if (args.is_completed !== undefined) updates.is_completed = args.is_completed;
        await supabase.from("todos").update(updates).eq("id", args.id as string).eq("user_id", userId);
        pendingActions.push({ type: "update_todo", data: args });
        return JSON.stringify({ success: true });
      }
      case "delete_todo": {
        await supabase.from("todos").delete().eq("id", args.id as string).eq("user_id", userId);
        pendingActions.push({ type: "delete_todo", data: args });
        return JSON.stringify({ success: true });
      }
      case "list_meetings": {
        const { data } = await supabase
          .from("meetings")
          .select("id, title, start_time, end_time, attendees")
          .eq("user_id", userId)
          .gte("start_time", new Date().toISOString())
          .order("start_time", { ascending: true })
          .limit(10);
        return JSON.stringify(data ?? []);
      }
      case "create_meeting": {
        const res = await fetch(`${apiUrl}/calendar/create-event`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({
            title: args.title,
            start_time: args.start_time,
            end_time: args.end_time,
            attendees: args.attendees ?? [],
            description: args.description ?? "",
            timezone,
            sendUpdates: "all",
          }),
        });
        const meetingData = await res.json();
        if (res.ok) {
          pendingActions.push({ type: "create_meeting", data: { title: args.title as string, id: meetingData.id } });
          return JSON.stringify({ success: true, id: meetingData.id });
        }
        pendingActions.push({ type: "create_meeting_failed", data: { error: meetingData.error } });
        return JSON.stringify({ error: meetingData.error ?? "Failed to create meeting" });
      }
      case "update_meeting": {
        const updates: Record<string, unknown> = {};
        if (args.title) updates.title = args.title;
        if (args.start_time) updates.start_time = args.start_time;
        if (args.end_time) updates.end_time = args.end_time;
        if (args.attendees) updates.attendees = args.attendees;
        await supabase.from("meetings").update(updates).eq("id", args.id as string).eq("user_id", userId);
        pendingActions.push({ type: "update_meeting", data: args });
        return JSON.stringify({ success: true });
      }
      case "delete_meeting": {
        await supabase.from("meetings").delete().eq("id", args.id as string).eq("user_id", userId);
        pendingActions.push({ type: "delete_meeting", data: args });
        return JSON.stringify({ success: true });
      }
      case "list_drafts": {
        const { data } = await supabase
          .from("draft_emails")
          .select("id, to_addresses, subject, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false });
        return JSON.stringify(data ?? []);
      }
      case "save_draft": {
        const { data } = await supabase
          .from("draft_emails")
          .insert({
            user_id: userId,
            to_addresses: [args.to as string],
            subject: args.subject as string,
            body_html: (args.body as string).replace(/\n/g, "<br>"),
          })
          .select("id")
          .single();
        if (data) pendingActions.push({ type: "save_draft", data: { subject: args.subject as string, to: args.to as string, id: (data as { id: string }).id } });
        return JSON.stringify({ success: true });
      }
      case "delete_draft": {
        await supabase.from("draft_emails").delete().eq("id", args.id as string).eq("user_id", userId);
        pendingActions.push({ type: "delete_draft", data: args });
        return JSON.stringify({ success: true });
      }
      case "send_email": {
        const res = await fetch(`${apiUrl}/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({ to: [args.to], subject: args.subject, body_html: (args.body as string).replace(/\n/g, "<br>") }),
        });
        const sendData = await res.json();
        if (res.ok) {
          pendingActions.push({ type: "send_email", data: { to: args.to as string, subject: args.subject as string, message_id: sendData.id } });
          return JSON.stringify({ success: true });
        }
        pendingActions.push({ type: "send_email_failed", data: { error: sendData.error } });
        return JSON.stringify({ error: sendData.error ?? "Failed to send email" });
      }
      case "reply_to_email": {
        const { data: original } = await supabase
          .from("emails")
          .select("subject, sender_email, gmail_id, thread_id")
          .eq("id", args.email_id as string)
          .eq("user_id", userId)
          .maybeSingle();
        if (!original) return JSON.stringify({ error: "Original email not found" });
        const orig = original as { subject: string; sender_email: string; gmail_id: string; thread_id: string };
        const replySubject = orig.subject?.startsWith("Re:") ? orig.subject : `Re: ${orig.subject}`;
        const res = await fetch(`${apiUrl}/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({
            to: [orig.sender_email],
            subject: replySubject,
            body_html: (args.body as string).replace(/\n/g, "<br>"),
            in_reply_to: orig.gmail_id,
            thread_id: orig.thread_id,
          }),
        });
        const sendData = await res.json();
        if (res.ok) {
          pendingActions.push({ type: "send_email", data: { to: orig.sender_email, subject: replySubject, message_id: sendData.id } });
          return JSON.stringify({ success: true });
        }
        pendingActions.push({ type: "send_email_failed", data: { error: sendData.error } });
        return JSON.stringify({ error: sendData.error ?? "Failed to send reply" });
      }
      case "lookup_contact": {
        const [emailsRes, kbRes] = await Promise.all([
          supabase
            .from("emails")
            .select("sender, sender_email, received_at, subject")
            .eq("user_id", userId)
            .or(`sender.ilike.%${args.name}%,sender_email.ilike.%${args.name}%`)
            .order("received_at", { ascending: false })
            .limit(5),
          supabase
            .from("knowledge_base")
            .select("entity, entity_type, info")
            .eq("user_id", userId)
            .ilike("entity", `%${args.name}%`)
            .limit(5),
        ]);
        return JSON.stringify({ recent_emails: emailsRes.data ?? [], knowledge: kbRes.data ?? [] });
      }
      case "search_knowledge_base": {
        const { data } = await supabase
          .from("knowledge_base")
          .select("entity, entity_type, info")
          .eq("user_id", userId)
          .or(`entity.ilike.%${args.query}%,info.ilike.%${args.query}%`)
          .limit(10);
        return JSON.stringify(data ?? []);
      }
      case "add_knowledge": {
        await supabase
          .from("knowledge_base")
          .upsert({
            user_id: userId,
            entity: args.entity as string,
            entity_type: args.entity_type as string,
            info: args.info as string,
            source: "assistant",
            confidence: 1.0,
          }, { onConflict: "user_id,entity,entity_type" });
        pendingActions.push({ type: "add_knowledge", data: args });
        return JSON.stringify({ success: true });
      }
      case "get_read_receipts": {
        const { data } = await supabase
          .from("read_receipts")
          .select("subject, recipient_email, created_at, open_count")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(20);
        return JSON.stringify(data ?? []);
      }
      case "archive_email": {
        await supabase.from("emails").update({ is_archived: true }).eq("id", args.email_id as string).eq("user_id", userId);
        pendingActions.push({ type: "archive_email", data: args });
        return JSON.stringify({ success: true });
      }
      case "list_tags": {
        const { data } = await supabase
          .from("categories")
          .select("id, display_name, slug, color")
          .eq("user_id", userId);
        return JSON.stringify(data ?? []);
      }
      case "create_tag": {
        const { data } = await supabase
          .from("categories")
          .insert({ user_id: userId, display_name: args.display_name as string, slug: args.slug as string, color: (args.color as string) ?? "#6b7280" })
          .select("id")
          .single();
        if (data) pendingActions.push({ type: "create_tag", data: { display_name: args.display_name as string, slug: args.slug as string, color: (args.color as string) ?? "#6b7280", id: (data as { id: string }).id } });
        return JSON.stringify({ success: true });
      }
      case "apply_tag": {
        const emailId = args.email_id as string;
        const tagSlug = args.tag_slug as string;
        const { data: ep } = await supabase.from("email_processed").select("extra_labels").eq("email_id", emailId).eq("user_id", userId).maybeSingle();
        const current: string[] = Array.isArray((ep as Record<string, unknown> | null)?.extra_labels) ? (ep as Record<string, unknown>).extra_labels as string[] : [];
        if (!current.includes(tagSlug)) {
          await supabase.from("email_processed").update({ extra_labels: [...current, tagSlug] }).eq("email_id", emailId).eq("user_id", userId);
        }
        return JSON.stringify({ success: true });
      }
      case "remove_tag": {
        const emailId = args.email_id as string;
        const tagSlug = args.tag_slug as string;
        const { data: ep } = await supabase.from("email_processed").select("extra_labels").eq("email_id", emailId).eq("user_id", userId).maybeSingle();
        const current: string[] = Array.isArray((ep as Record<string, unknown> | null)?.extra_labels) ? (ep as Record<string, unknown>).extra_labels as string[] : [];
        await supabase.from("email_processed").update({ extra_labels: current.filter((l) => l !== tagSlug) }).eq("email_id", emailId).eq("user_id", userId);
        return JSON.stringify({ success: true });
      }
      case "suggest_reply_options": {
        const opts = args as { options: { label: string; description: string }[]; recommended: number; context?: string };
        pendingActions.push({ type: "suggest_options", data: { options: opts.options, recommended: opts.recommended ?? 0, context: opts.context ?? "" } });
        return JSON.stringify({ success: true, message: "Options shown to user" });
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    return JSON.stringify({ error: String(err) });
  }
}

// ── Component ───────────────────────────────────────────────────────

export default function AssistantChat({ className, visible }: { className?: string; visible?: boolean }) {
  const { addToast, setView, notifySent, profile } = useApp();
  const supabase = createClient();
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: GREETING },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const stoppedRef = useRef(false);

  const stopGenerating = () => {
    stoppedRef.current = true;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setLoading(false);
  };
  const prevVisible = useRef(visible);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  useEffect(() => {
    if (visible && !prevVisible.current) {
      setMessages([{ role: "assistant", content: GREETING }]);
      setInput("");
    }
    prevVisible.current = visible;
  }, [visible]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const resetConversation = useCallback(() => {
    setMessages([{ role: "assistant", content: "Starting fresh. What can I help with?" }]);
  }, []);

  const toggleMic = useCallback(() => {
    const w = window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
    const SpeechRecognition = w.SpeechRecognition || w.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      addToast("error", "Voice input is not supported in this browser.");
      return;
    }

    if (recording && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    recognition.onstart = () => setRecording(true);
    recognition.onend = () => {
      setRecording(false);
      recognitionRef.current = null;
    };
    recognition.onerror = () => {
      setRecording(false);
      recognitionRef.current = null;
    };
    recognition.onresult = (e: SpeechRecognitionResultEvent) => {
      const transcript = e.results[0][0].transcript;
      setInput((prev) => (prev ? prev + " " + transcript : transcript));
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + "px";
      }
    };

    recognition.start();
  }, [recording, addToast]);

  const runLocalChat = async (
    userMessage: string,
    history: { role: "user" | "assistant"; content: string }[],
    session: { access_token: string; user?: { id: string } } | null,
    userId: string,
  ): Promise<{ reply: string; actions: Action[] }> => {
    if (!isWebLLMReady()) {
      const ok = await initWebLLM();
      if (!ok) throw new Error("Local AI model failed to initialize. Try switching to cloud mode.");
    }

    const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/api";
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const displayName = (profile as { display_name?: string } | null)?.display_name || "User";
    const systemPrompt = buildLocalSystemPrompt(displayName, timezone);

    const chatMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemPrompt },
      ...history.map(h => ({ role: h.role as "user" | "assistant", content: h.content })),
      { role: "user", content: userMessage },
    ];

    const pendingActions: Action[] = [];

    for (let round = 0; round < 8; round++) {
      const raw = await localChatInference(chatMessages, { maxTokens: 2048 });
      if (!raw?.trim()) throw new Error("Local AI returned empty response");

      const parsed = extractJSON<{
        type?: string;
        name?: string;
        args?: Record<string, unknown>;
        calls?: { name: string; args: Record<string, unknown> }[];
        reply?: string;
        actions?: Action[];
      }>(raw, { type: "reply", reply: raw });

      // Handle batched tool calls (new format)
      if (parsed.type === "tool_calls" && Array.isArray(parsed.calls) && parsed.calls.length > 0) {
        const results: string[] = [];
        for (const call of parsed.calls) {
          const toolResult = await executeLocalTool(
            call.name,
            call.args ?? {},
            supabase,
            userId,
            session,
            apiUrl,
            pendingActions,
            timezone,
          );
          results.push(`[TOOL_RESULT: ${call.name}]\n${toolResult}`);
        }
        chatMessages.push({ role: "assistant", content: raw });
        chatMessages.push({
          role: "user",
          content: results.join("\n\n") + `\n\nContinue. Respond ONLY with JSON.`,
        });
      } else if (parsed.type === "tool_call" && parsed.name) {
        // Single tool call (legacy format still supported)
        const toolResult = await executeLocalTool(
          parsed.name,
          parsed.args ?? {},
          supabase,
          userId,
          session,
          apiUrl,
          pendingActions,
          timezone,
        );
        chatMessages.push({ role: "assistant", content: raw });
        chatMessages.push({
          role: "user",
          content: `[TOOL_RESULT: ${parsed.name}]\n${toolResult}\n\nContinue. Respond ONLY with JSON.`,
        });
      } else {
        const reply = parsed.reply?.trim() || raw.trim();
        return { reply, actions: [...pendingActions, ...(parsed.actions ?? [])] };
      }
    }

    throw new Error("Local AI exceeded maximum tool-call rounds");
  };

  const sendMessage = async (directText?: string) => {
    const userMessage = directText ?? input.trim();
    if (!userMessage || loading) return;

    if (!directText) {
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    }
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setLoading(true);

    const displayResult = (result: { reply: string; actions?: Action[] }) => {
      if (Array.isArray(result.actions)) {
        for (const action of result.actions) {
          if (action.type === "send_email") {
            notifySent({ to: action.data.to as string, subject: action.data.subject as string, body_html: "" });
          }
        }
      }
      setMessages((prev) => {
        const updated = [
          ...prev,
          { role: "assistant" as const, content: result.reply, actions: result.actions },
        ];
        if (updated.length >= MAX_MESSAGES) {
          return [
            ...updated,
            { role: "assistant" as const, content: "This conversation is getting long. Start fresh anytime with the button below." },
          ];
        }
        return updated;
      });
    };

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/api";
      const recentMessages = messages.slice(-10);
      const history = recentMessages.map((m) => ({ role: m.role, content: m.content }));
      const aiMode = (profile as { ai_mode?: string } | null)?.ai_mode || "cloud";
      const userId = session?.user?.id ?? "";

      if (aiMode === "local") {
        const result = await runLocalChat(userMessage, history, session, userId);
        displayResult(result);
        return;
      }

      if (aiMode === "hybrid") {
        try {
          const result = await runLocalChat(userMessage, history, session, userId);
          displayResult(result);
          return;
        } catch {
          // fall through to cloud
        }
      }

      // Cloud path — 100s timeout to handle multi-step tasks.
      // The controller is also stored on a ref so the Stop button can abort.
      const chatController = new AbortController();
      abortControllerRef.current = chatController;
      const chatTimeoutId = setTimeout(() => chatController.abort(), 100_000);

      let res: Response;
      try {
        res = await fetch(`${apiUrl}/chat`, {
          method: "POST",
          signal: chatController.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ message: userMessage, history, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
        });
      } catch (fetchErr) {
        clearTimeout(chatTimeoutId);
        if ((fetchErr as Error)?.name === "AbortError") {
          if (stoppedRef.current) {
            stoppedRef.current = false;
            return;
          }
          throw new Error("Request timed out. For complex multi-step tasks, try breaking them into smaller steps.");
        }
        throw fetchErr;
      }
      clearTimeout(chatTimeoutId);

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Request failed (${res.status})`);
      }

      const data = await res.json();
      if (!data.reply?.trim()) throw new Error("Empty response from assistant");
      displayResult({ reply: data.reply, actions: data.actions });
    } catch (err) {
      if (stoppedRef.current) {
        stoppedRef.current = false;
        return;
      }
      const msg = err instanceof Error ? err.message : "Unknown error";
      addToast("error", `Assistant error: ${msg}`);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${msg}` },
      ]);
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
    }
  };

  return (
    <div className={`flex flex-col ${className ?? ""}`}>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg, i) => (
          <div
            key={`${msg.role}-${i}-${msg.content.slice(0, 16)}`}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div className={`flex flex-col gap-1.5 ${msg.role === "user" ? "items-end max-w-[80%]" : "items-start w-full"}`}>
              <div
                className={`text-[13px] leading-relaxed whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "px-3.5 py-2 rounded-2xl rounded-br-sm bg-[var(--accent)] text-white"
                    : "text-[var(--foreground)] py-0.5"
                }`}
              >
                {msg.content}
              </div>
              {msg.actions?.map((action, j) => (
                <ActionChip
                  key={`action-${i}-${j}`}
                  action={action}
                  onViewDrafts={() => setView("drafts")}
                  onViewMeetings={() => setView("meetings")}
                  onViewSent={() => setView("sent")}
                  onViewTodos={() => setView("todos")}
                  onViewInbox={() => setView("inbox")}
                  onViewCategories={() => setView("categories")}
                  onSelectOption={(text) => sendMessage(text)}
                />
              ))}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-1.5 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: "0ms" }} />
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: "150ms" }} />
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* New conversation button */}
      {messages.length > 2 && (
        <div className="px-3 pb-1">
          <button
            onClick={resetConversation}
            className="w-full text-[11px] py-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--accent)] hover:bg-[var(--surface-2)] transition-colors flex items-center justify-center gap-1 cursor-pointer"
          >
            <span className="material-symbols-outlined" style={{ fontSize: "13px" }}>refresh</span>
            New conversation
          </button>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-[var(--border)] p-3 flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage(undefined);
            }
          }}
          placeholder="Ask anything or tell me what to do..."
          rows={1}
          className="flex-1 px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-[13px] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)]/50 resize-none overflow-y-hidden leading-relaxed transition-all"
          style={{ minHeight: "38px", maxHeight: "160px" }}
          disabled={loading}
        />
        <button
          onClick={toggleMic}
          disabled={loading}
          aria-label={recording ? "Stop recording" : "Start voice input"}
          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 cursor-pointer transition-all ${
            recording
              ? "bg-red-500 text-white animate-pulse hover:opacity-90"
              : "bg-[var(--surface-2)] text-[var(--muted)] border border-[var(--border)] hover:text-[var(--accent)] hover:border-[var(--accent)]/50"
          } disabled:opacity-40`}
        >
          <span className="material-symbols-outlined" style={{ fontSize: "17px" }}>
            {recording ? "stop" : "mic"}
          </span>
        </button>
        {loading ? (
          <button
            onClick={stopGenerating}
            aria-label="Stop generating"
            className="w-9 h-9 rounded-xl bg-[var(--danger)] text-white hover:opacity-90 transition-all flex items-center justify-center shrink-0 cursor-pointer"
          >
            <span className="material-symbols-outlined" style={{ fontSize: "17px" }}>stop</span>
          </button>
        ) : (
          <button
            onClick={() => sendMessage(undefined)}
            disabled={!input.trim()}
            aria-label="Send message"
            className="w-9 h-9 rounded-xl bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40 transition-all flex items-center justify-center shrink-0 cursor-pointer"
          >
            <span className="material-symbols-outlined" style={{ fontSize: "17px" }}>send</span>
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Action card color maps ──────────────────────────────────────── */
const CARD_ICON_STYLES = {
  green:  "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400",
  blue:   "bg-sky-100 dark:bg-sky-900/40 text-sky-600 dark:text-sky-400",
  red:    "bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400",
  purple: "bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400",
  slate:  "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400",
};

function ActionCard({ color, icon, title, subtitle, onClick }: {
  color: keyof typeof CARD_ICON_STYLES;
  icon: string;
  title: string;
  subtitle?: string;
  onClick?: () => void;
}) {
  const base = "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-left transition-all";
  const inner = (
    <>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${CARD_ICON_STYLES[color]}`}>
        <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>{icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold text-[var(--foreground)] leading-tight truncate">{title}</p>
        {subtitle && <p className="text-[11px] text-[var(--muted)] leading-tight mt-0.5 truncate">{subtitle}</p>}
      </div>
      {onClick && (
        <span className="material-symbols-outlined text-[var(--muted)] shrink-0 opacity-50 group-hover:opacity-100 transition-opacity" style={{ fontSize: "16px" }}>chevron_right</span>
      )}
    </>
  );
  if (onClick) {
    return (
      <button onClick={onClick} className={`${base} cursor-pointer hover:bg-[var(--accent)]/5 hover:border-[var(--accent)]/30 group`}>
        {inner}
      </button>
    );
  }
  return <div className={base}>{inner}</div>;
}

function ActionChip({
  action,
  onViewDrafts,
  onViewMeetings,
  onViewSent,
  onViewTodos,
  onViewInbox,
  onViewCategories,
  onSelectOption,
}: {
  action: Action;
  onViewDrafts: () => void;
  onViewMeetings: () => void;
  onViewSent: () => void;
  onViewTodos: () => void;
  onViewInbox: () => void;
  onViewCategories: () => void;
  onSelectOption: (text: string) => void;
}) {
  if (action.type === "suggest_options") {
    const { options, recommended, context } = action.data as {
      options: { label: string; description: string }[];
      recommended: number;
      context?: string;
    };
    return (
      <div className="w-full space-y-2 mt-0.5">
        {context && (
          <p className="text-[11px] text-[var(--muted)] px-0.5">{context}</p>
        )}
        {options.map((opt, idx) => (
          <button
            key={idx}
            onClick={() => onSelectOption(`Execute: ${opt.label} - ${opt.description}`)}
            className={`w-full text-left px-3 py-2.5 rounded-xl border-2 transition-all cursor-pointer group ${
              idx === recommended
                ? "border-[var(--accent)] bg-[var(--accent)]/8"
                : "border-[var(--border)] hover:border-[var(--accent)]/50 bg-[var(--surface-2)]"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                  idx === recommended
                    ? "bg-[var(--accent)] text-white"
                    : "bg-[var(--border)] text-[var(--muted)] group-hover:bg-[var(--accent)]/20 group-hover:text-[var(--accent)]"
                }`}
              >
                {idx + 1}
              </span>
              <span className={`text-[12px] font-semibold leading-tight ${
                idx === recommended ? "text-[var(--accent)]" : "text-[var(--foreground)]"
              }`}>
                {opt.label}
              </span>
              {idx === recommended && (
                <span className="ml-auto text-[10px] font-medium text-[var(--accent)] opacity-70 shrink-0">recommended</span>
              )}
            </div>
            <p className="text-[11px] text-[var(--muted)] mt-1 ml-7 leading-relaxed">{opt.description}</p>
          </button>
        ))}
      </div>
    );
  }
  if (action.type === "create_todo") {
    return <ActionCard color="green" icon="check_circle" title="Todo created" subtitle={action.data.text as string} onClick={onViewTodos} />;
  }
  if (action.type === "save_draft") {
    return <ActionCard color="blue" icon="draft" title="Draft saved" subtitle={`To: ${action.data.to as string}`} onClick={onViewDrafts} />;
  }
  if (action.type === "send_email") {
    return <ActionCard color="green" icon="send" title={`Email sent to ${action.data.to as string}`} subtitle={action.data.subject as string | undefined} onClick={onViewSent} />;
  }
  if (action.type === "send_email_failed") {
    return <ActionCard color="red" icon="error" title="Failed to send email" subtitle={action.data.error as string | undefined} />;
  }
  if (action.type === "create_meeting") {
    return <ActionCard color="purple" icon="event" title={`Meeting created: ${action.data.title as string}`} subtitle={action.data.start_time ? new Date(action.data.start_time as string).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : undefined} onClick={onViewMeetings} />;
  }
  if (action.type === "create_meeting_failed") {
    return <ActionCard color="red" icon="error" title="Failed to create meeting" />;
  }
  if (action.type === "update_todo") {
    const isCompleted = action.data.is_completed === true;
    return <ActionCard color="green" icon={isCompleted ? "check_circle" : "edit"} title={isCompleted ? "Todo marked complete" : "Todo updated"} onClick={onViewTodos} />;
  }
  if (action.type === "delete_todo") {
    return <ActionCard color="slate" icon="delete" title="Todo deleted" />;
  }
  if (action.type === "update_meeting") {
    return <ActionCard color="blue" icon="edit_calendar" title="Meeting updated" onClick={onViewMeetings} />;
  }
  if (action.type === "delete_meeting") {
    return <ActionCard color="slate" icon="event_busy" title="Meeting deleted" />;
  }
  if (action.type === "delete_draft") {
    return <ActionCard color="slate" icon="delete" title="Draft deleted" />;
  }
  if (action.type === "archive_email") {
    return <ActionCard color="slate" icon="archive" title="Email archived" onClick={onViewInbox} />;
  }
  if (action.type === "add_knowledge") {
    return <ActionCard color="purple" icon="psychology" title={`Saved: ${action.data.entity as string}`} subtitle={action.data.entity_type as string | undefined} />;
  }
  if (action.type === "create_tag") {
    return <ActionCard color="slate" icon="label" title={`Tag created: ${action.data.display_name as string}`} onClick={onViewCategories} />;
  }
  return null;
}
