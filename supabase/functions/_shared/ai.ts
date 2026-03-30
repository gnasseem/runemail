/**
 * Cerebras AI helpers — calls the REST API directly (OpenAI-compatible).
 * Rate limit: 30 RPM — requests are queued with retry on 429.
 */

function getEnv(key: string): string {
  return (
    (
      Deno as unknown as { env: { get(k: string): string | undefined } }
    ).env.get(key) ?? ""
  );
}

const PROMPTS = {
  categorize:
    `You are an expert email categorizer. Classify the email into exactly one category.

Categories:
- action-required: user must take a specific action (reply, pay a bill, approve/sign/review a document, attend something, make a decision). The sender is waiting on the user.
- important: genuinely worth the user's attention within a day or two, but no concrete immediate action needed (project updates from known contacts, personal emails, relevant news from a trusted sender)
- newsletter: bulk, marketing, promotional, automated, social media notifications, digests, announcements to a large audience, anything with an unsubscribe link
- informational: automated receipts, order confirmations, shipping updates, account notifications, system alerts — no action needed from user

Respond with ONLY the category slug, nothing else.`,
  summarize:
    "Summarize the following email in one concise sentence. Focus on the key point or action needed.",
  quick_actions:
    'Based on this email, suggest 1-3 actions. Each can be a quick reply or a todo task. Return as a JSON array of objects with "label" (descriptive phrase up to 10 words — for add_todo, include specific context like topic, name, chapter, deadline so the task is self-explanatory without reading the email; e.g. "Review French lesson chapter 2 audio files" or "Reply to Sarah about Q3 budget proposal"), "action" (one of: "reply", "add_todo", "schedule_meeting"), and optionally "text" (the reply body, only for reply/schedule_meeting). Example: [{"label":"Sounds good, happy to help","action":"reply","text":"Sounds good, thanks!"},{"label":"Follow up with John about contract renewal","action":"add_todo"}]',
  urgent_detect:
    'Determine if this email is urgent (deadlines, security alerts, payment issues, time-sensitive requests). Respond with ONLY "true" or "false".',
  process_email:
    `You are an email assistant. Analyze this email and return ONLY valid JSON with no markdown:
{"category":"...","summary":"...","actions":[...]}

Categories (pick exactly one):
- action-required: a real person is explicitly waiting for you to reply, approve, pay, sign, schedule, or decide. The sender expects a response. Examples: invoice due, contract to sign, direct question asked of you, RSVP needed, PR review requested, job offer to respond to.
- important: a real person wrote to you and it is worth reading, but no response is required right now. Examples: project status updates, personal emails from friends/colleagues, introduction emails, FYI updates from known contacts, meeting notes.
- newsletter: sent to a mailing list or large audience; has unsubscribe link; bulk/marketing/promotional. Examples: product newsletters, LinkedIn digests, company announcements, promotional offers, social media notifications.
- informational: fully automated system message, no human sender waiting. Examples: order confirmations, shipping tracking, password reset you triggered, bank transaction alerts, calendar notifications, automated monitoring alerts.

Decision rules (apply in order):
1. Has unsubscribe link or CATEGORY_PROMOTIONS/SOCIAL/FORUMS label? -> newsletter
2. Fully automated (no-reply address, receipt, tracking update)? -> informational
3. Real person sent it and is waiting for action/response? -> action-required
4. Real person sent it, no response needed? -> important

summary: one concise sentence on what the email is about or what is needed.
actions: 1-3 helpful actions as JSON objects, only if genuinely useful. Omit for newsletter/informational.
Each action MUST be an object with these exact fields:
  {"label": "short descriptive phrase", "action": "reply"|"add_todo"|"schedule_meeting", "text": "optional content for reply or meeting"}
Use "schedule_meeting" when: the email explicitly proposes a meeting/call, asks about availability, or involves rescheduling an appointment.
Examples:
  {"label": "Reply to John about budget", "action": "reply", "text": "Hi John, thanks for the update. I will review and get back to you."}
  {"label": "Review Q3 budget proposal from Sarah", "action": "add_todo"}
  {"label": "Schedule call with team to discuss project", "action": "schedule_meeting", "text": "30-min kickoff for the new project"}
  {"label": "Reschedule dietitian appointment", "action": "schedule_meeting", "text": "Online alternative for in-person appointment"}
Return raw JSON only. No explanation, no markdown.`,
  draft:
    "You are an email drafting assistant. Write a professional, clear reply to the email below. Match the tone of the original. Keep it concise.",
  briefing:
    'You are an executive email intelligence system. Analyze the emails below and return ONLY valid JSON for a busy executive who needs to know exactly what requires attention. Structure: {"executiveSummary":"2 sentences on what needs attention today","topPriority":[{"subject":"...","senderName":"...","sender":"...","summary":"1 sentence why it matters","urgency":"critical|high|medium","deadline":"YYYY-MM-DD or null","waitingForReply":true,"tags":["DEADLINE","REPLY_NEEDED","FINANCIAL","LEGAL"]}],"deadlines":[{"task":"what is due","date":"YYYY-MM-DD","source":"sender name"}],"waitingForReply":[/* same structure as topPriority */],"stats":{"total":N,"critical":N,"deadlines":N,"waitingOnYou":N,"filtered":N}}. Rules: topPriority max 7 — only emails genuinely needing executive action; urgency critical = same-day response or hard deadline within 48h; filtered = newsletters + automated + marketing count.',
  extract_entities:
    'Extract entities from this email that would be useful to remember for future reference. Return a JSON array of objects with "entity" (proper name or specific identifier), "entity_type" (person|company|project|topic|location), and "info" (one concrete sentence about what was learned — must include a specific fact, role, or relationship, not just that they appeared in an email). Rules: only include named people with a clear role or relationship; only include companies/projects if a specific detail was learned (what they do, deal size, status); skip generic words like "meeting", "email", "deadline", "invoice", "document"; skip entities where info would be trivially vague. Confidence bar: only include if you would recommend storing this fact for future drafts or decisions. Return an empty array if nothing clearly useful was found.',
  style_analysis:
    'Analyze the writing style of these sent emails. Return JSON with keys: "greeting_style" (common greeting pattern), "closing_style" (common sign-off), "tone" (formal/casual/mixed), "avg_length" (short/medium/long).',
  meeting_detect:
    'Determine if this email contains or requests a meeting. Return JSON: {"has_meeting": boolean, "title": string, "suggested_duration": number (minutes), "attendees": string[], "suggested_date": string or null}.',
};

async function cerebras(
  systemPrompt: string,
  userText: string,
  temperature = 0.3,
  maxTokens = 512,
): Promise<string> {
  const apiKey = getEnv("CEREBRAS_API_KEY");
  const model = getEnv("CEREBRAS_MODEL") || "qwen-3-235b-a22b-instruct-2507";

  if (!apiKey) {
    throw new Error("No LLM API key configured (CEREBRAS_API_KEY required)");
  }

  const url = "https://api.cerebras.ai/v1/chat/completions";

  // Retry loop — on 429/500/503, wait and retry until the limit resets
  for (let attempt = 0; attempt < 20; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userText },
          ],
          temperature,
          max_tokens: maxTokens,
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (res.status === 429) {
      // Rate limited — honour the retry-after header; default to 60s if absent
      const retryAfter = parseInt(res.headers.get("retry-after") ?? res.headers.get("x-ratelimit-reset-requests") ?? "60", 10);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }

    if (res.status === 500 || res.status === 503) {
      // Transient server error — back off and retry
      const backoff = Math.min(5 * (attempt + 1), 30);
      await new Promise((r) => setTimeout(r, backoff * 1000));
      continue;
    }

    if (!res.ok) {
      const errorText = await res.text();
      const errorObj = (() => {
        try { return JSON.parse(errorText); } catch { return { message: errorText }; }
      })();
      const err = new Error("LLM_API_ERROR");
      (err as any).status = res.status;
      (err as any).details = errorObj;
      throw err;
    }

    const data = await res.json();
    return stripThinkTags((data.choices?.[0]?.message?.content ?? "").trim());
  }

  throw new Error("LLM_API_ERROR: max retries exceeded");
}

// Keep the internal name generic so callers don't need to change
const gemini = cerebras;

/** Strip Qwen 3 <think>...</think> reasoning blocks from model output.
 * Also handles truncated output where the closing tag is missing (token limit hit). */
function stripThinkTags(text: string): string {
  // Remove complete <think>...</think> blocks
  let result = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  // Remove truncated <think> block with no closing tag (output cut off inside thinking)
  const openIdx = result.indexOf("<think>");
  if (openIdx !== -1) {
    result = result.slice(0, openIdx).trim();
  }
  return result;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw.replace(/```\s*json\s*\n?|\n?```/g, "").trim());
  } catch {
    return null;
  }
}

export interface EmailSignals {
  gmailLabels?: string[];
  hasAttachments?: boolean;
  isReply?: boolean;
  hasListUnsubscribe?: boolean;
  replyToEmail?: string;
  ccRecipients?: string;
  precedenceHeader?: string;
  senderInteractionCount?: number;
}

const NEWSLETTER_GMAIL_LABELS = new Set([
  "CATEGORY_PROMOTIONS",
  "CATEGORY_SOCIAL",
  "CATEGORY_FORUMS",
  "CATEGORY_UPDATES",
]);

function buildSignalContext(signals: EmailSignals): { context: string; definiteCategory: string | null } {
  const labels = signals.gmailLabels ?? [];
  const lines: string[] = [];

  // Gmail's own classification labels
  const gmailCategories = labels.filter((l) => l.startsWith("CATEGORY_"));
  if (gmailCategories.length > 0) {
    lines.push(`Gmail auto-category: ${gmailCategories.join(", ")}`);
  }
  if (labels.includes("IMPORTANT")) lines.push("Gmail marked IMPORTANT: yes");
  if (labels.includes("STARRED")) lines.push("Starred by user: yes");

  // Structural signals
  if (signals.hasListUnsubscribe) lines.push("Has List-Unsubscribe header: yes (strong newsletter/bulk signal)");
  const prec = signals.precedenceHeader?.toLowerCase();
  if (prec && ["bulk", "list", "junk"].includes(prec)) lines.push(`Precedence header: ${prec} (bulk/automated mail)`);
  if (signals.replyToEmail) lines.push(`Reply-To differs from sender: yes (common in marketing emails)`);
  if (signals.isReply) lines.push("Is a reply in an active thread: yes");
  if (signals.hasAttachments) lines.push("Has attachments: yes");
  if (signals.ccRecipients) lines.push("Has CC recipients: yes (group/broadcast email)");

  // Sender relationship
  const count = signals.senderInteractionCount ?? 0;
  if (count >= 5) lines.push(`Sender interaction history: ${count} previous emails (established contact)`);
  else if (count > 0) lines.push(`Sender interaction history: ${count} previous email(s) (occasional contact)`);
  else lines.push("Sender interaction history: none (new or unknown sender)");

  // Determine if category can be short-circuited based on definitive signals
  const isDefiniteNewsletter =
    labels.some((l) => NEWSLETTER_GMAIL_LABELS.has(l)) ||
    signals.hasListUnsubscribe ||
    (prec !== undefined && ["bulk", "list", "junk"].includes(prec));

  const isDefiniteImportant = labels.includes("STARRED");

  let definiteCategory: string | null = null;
  if (isDefiniteNewsletter) {
    definiteCategory = "newsletter";
  } else if (isDefiniteImportant) {
    // Starred = user explicitly marked it; still run AI to distinguish action-required vs important
    lines.push("NOTE: User starred this email — lean towards action-required or important.");
  }

  const context = lines.length > 0 ? `SIGNALS:\n${lines.map((l) => `- ${l}`).join("\n")}\n\n` : "";
  return { context, definiteCategory };
}

export async function processFullEmail(
  subject: string,
  sender: string,
  body: string,
  signals?: EmailSignals,
  userTags?: { slug: string; description: string }[],
): Promise<{
  category: string;
  summary: string;
  quick_actions: unknown[];
  tags: string[];
}> {
  const emailText = `Subject: ${subject}\nFrom: ${sender}\n\n${body.slice(0, 2000)}`;

  const { context: signalContext, definiteCategory } = signals
    ? buildSignalContext(signals)
    : { context: "", definiteCategory: null };

  let prompt = PROMPTS.process_email;
  if (userTags && userTags.length > 0) {
    const tagLines = userTags.map((t) => `- ${t.slug}: ${t.description || t.slug}`).join("\n");
    prompt += `\n\nCustom tags (apply any that fit, can be multiple or none):\n${tagLines}\nAdd "tags": ["slug1",...] to the JSON if any apply. Omit "tags" key if none match.`;
  }

  const textWithSignals = signalContext ? `${signalContext}${emailText}` : emailText;

  const raw = await gemini(prompt, textWithSignals, 0.2, 2048);
  const parsed = parseJson(raw) as any;

  const valid = ["important", "action-required", "newsletter", "informational"];
  const cat = (parsed?.category || "").toLowerCase().trim().replace(/[^a-z-]/g, "");
  const finalCategory = definiteCategory ?? (valid.includes(cat) ? cat : "informational");

  const validTagSlugs = new Set((userTags || []).map((t) => t.slug));
  const returnedTags = Array.isArray(parsed?.tags)
    ? (parsed.tags as string[]).filter((t) => validTagSlugs.has(t))
    : [];

  return {
    category: finalCategory,
    summary: (parsed?.summary || "").trim(),
    quick_actions: Array.isArray(parsed?.actions) ? parsed.actions : [],
    tags: returnedTags,
  };
}

export async function composeDraft(opts: {
  intent: string;
  subject: string;
  recipientName: string;
  senderName: string;
  replyTo?: { subject: string; body: string };
  styleContext?: string;
  knowledgeContext?: string;
}): Promise<string> {
  const { intent, subject, recipientName, senderName, replyTo, styleContext, knowledgeContext } = opts;
  const closing = senderName ? `Best regards,\n${senderName}` : "Best regards,";
  const greeting = recipientName ? `Hi ${recipientName},` : "Hi,";

  let context: string;
  if (replyTo) {
    context = [
      `Original email subject: "${replyTo.subject}"`,
      `Original email content:`,
      replyTo.body.slice(0, 800),
      ``,
      `What to say in reply: ${intent || "Write a professional reply."}`,
    ].join("\n");
  } else {
    context = [
      subject ? `Topic: ${subject}` : "",
      intent ? `Message intent: ${intent}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (knowledgeContext) {
    context += `\n\nBackground context about the recipient and related topics:\n${knowledgeContext}`;
  }

  if (styleContext) {
    context += `\n\nWrite in this style: ${styleContext}`;
  }

  const systemPrompt = `You are an email drafting assistant writing on behalf of the sender. Rules:
1. Write ONLY the email body — no subject line.
2. Start with exactly this greeting: "${greeting}"
3. Write 2-4 concise paragraphs covering the intent.
4. End with exactly: "${closing}"
5. Do NOT use any placeholder text like [Your Name] or [Company].`;

  return cerebras(systemPrompt, context, 0.45, 1024);
}

export async function generateDraft(
  emailText: string,
  instructions: string,
  styleContext?: string,
): Promise<string> {
  let prompt = instructions
    ? `${emailText}\n\nInstructions: ${instructions}`
    : emailText;
  if (styleContext) {
    prompt = `${prompt}\n\nWrite in this style: ${styleContext}`;
  }
  return gemini(PROMPTS.draft, prompt, 0.45, 1024);
}

export async function generateBriefing(emailsText: string, knowledgeContext?: string): Promise<Record<string, unknown>> {
  const fullText = knowledgeContext
    ? `## Background Knowledge\n${knowledgeContext}\n\n## Emails\n${emailsText}`
    : emailsText;
  const todayDate = new Date().toISOString().split("T")[0]; // UTC date
  const raw = await gemini(`Today's date is ${todayDate}. ${PROMPTS.briefing}`, fullText, 0.3, 2048);
  const parsed = parseJson(raw) as Record<string, unknown> | null;
  if (parsed && typeof parsed === "object" && (parsed.executiveSummary || parsed.topPriority)) {
    return parsed;
  }
  return {
    executiveSummary: (parsed as any)?.summary ?? "Unable to generate briefing summary.",
    topPriority: [],
    deadlines: [],
    waitingForReply: [],
    stats: (parsed as any)?.stats ?? {},
  };
}

/**
 * Incremental briefing update: merges new relevant emails into an existing
 * briefing without reprocessing everything. Much cheaper than a full rebuild.
 * Returns null if the new emails don't warrant any changes.
 */
export async function updateBriefing(
  previousBriefingJson: string,
  newEmailsText: string,
): Promise<Record<string, unknown> | null> {
  const todayDate = new Date().toISOString().split("T")[0]; // UTC date
  const prompt =
    `Today's date is ${todayDate}. You are an executive email intelligence system. You have an existing briefing and a set of NEW emails that just arrived. ` +
    `Update the briefing to incorporate only the new emails that matter. ` +
    `Keep existing items that are still relevant. Add new priority items only if they genuinely need executive attention. ` +
    `Update the stats counts. Do NOT add newsletters, spam, or low-priority automated emails to the briefing. ` +
    `Return the complete updated briefing as valid JSON using the same structure as the original. ` +
    `If none of the new emails are worth adding, return the original briefing unchanged with stats.total incremented.`;

  const userText =
    `## Current Briefing\n${previousBriefingJson}\n\n## New Emails\n${newEmailsText}`;

  const raw = await gemini(prompt, userText, 0.2, 2048);
  const parsed = parseJson(raw);
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
}

export async function extractEntities(
  subject: string,
  sender: string,
  body: string,
): Promise<{ entity: string; entity_type: string; info: string }[]> {
  const text = `Subject: ${subject}\nFrom: ${sender}\n\n${body}`;
  const raw = await gemini(PROMPTS.extract_entities, text, 0.2, 1024);
  const parsed = parseJson(raw);
  return Array.isArray(parsed) ? parsed : [];
}

export async function analyzeWritingStyle(sentEmails: string): Promise<{
  greeting_style: string;
  closing_style: string;
  tone: string;
  avg_length: string;
}> {
  const raw = await gemini(PROMPTS.style_analysis, sentEmails, 0.3, 512);
  const parsed = parseJson(raw) as {
    greeting_style?: string;
    closing_style?: string;
    tone?: string;
    avg_length?: string;
  } | null;
  return {
    greeting_style: parsed?.greeting_style ?? "",
    closing_style: parsed?.closing_style ?? "",
    tone: parsed?.tone ?? "mixed",
    avg_length: parsed?.avg_length ?? "medium",
  };
}

export async function detectMeeting(
  subject: string,
  sender: string,
  body: string,
): Promise<{
  has_meeting: boolean;
  title: string;
  suggested_duration: number;
  attendees: string[];
  suggested_date: string | null;
}> {
  const text = `Subject: ${subject}\nFrom: ${sender}\n\n${body}`;
  const raw = await gemini(PROMPTS.meeting_detect, text, 0.2, 512);
  const parsed = parseJson(raw) as {
    has_meeting?: boolean;
    title?: string;
    suggested_duration?: number;
    attendees?: string[];
    suggested_date?: string | null;
  } | null;
  return {
    has_meeting: parsed?.has_meeting ?? false,
    title: parsed?.title ?? subject,
    suggested_duration: parsed?.suggested_duration ?? 30,
    attendees: parsed?.attendees ?? [],
    suggested_date: parsed?.suggested_date ?? null,
  };
}

export async function extractTodos(
  subject: string,
  sender: string,
  body: string,
): Promise<string[]> {
  const text = `Subject: ${subject}\nFrom: ${sender}\n\n${body.slice(0, 1500)}`;
  const raw = await gemini(
    'Extract actionable to-do items from this email. Return a JSON array of concise task strings. Return [] if none found. Example: ["Reply to John about the proposal","Schedule call with team"]',
    text,
    0.2,
    512,
  );
  const parsed = parseJson(raw);
  return Array.isArray(parsed)
    ? parsed
        .filter((t: unknown) => typeof t === "string")
        .slice(0, 6)
    : [];
}

export async function suggestTodosFromEmails(emailsText: string): Promise<
  { task: string; source: string }[]
> {
  const raw = await gemini(
    'Based on these recent emails, suggest action items that need to be done. Return a JSON array of objects with "task" (concise task string) and "source" (email subject or sender, max 40 chars). Max 8 items. Return [] if nothing actionable.',
    emailsText,
    0.3,
    1024,
  );
  const parsed = parseJson(raw);
  return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
}

// ─── Personal Assistant Chat ──────────────────────────────────────────────────

export interface ChatContext {
  userDisplayName: string;
  timezone: string; // IANA timezone e.g. "Asia/Dubai"
  styleProfile: { greeting_style: string; closing_style: string; tone: string; avg_length: string } | null;
  topSenders?: { sender_email: string; sender_name?: string; interaction_count: number; relationship_notes: string | null }[];
  knowledgeEntries?: { entity: string; entity_type: string; info: string; importance?: string | null }[];
  recentEmails?: { id: string; date: string; sender_email: string; sender: string; subject: string; summary: string | null; category: string }[];
  openTodos: { text: string }[];
  upcomingMeetings: { title: string; start_time: string; attendees: string[] | null }[];
  pendingReplies: { subject: string; recipient_email: string; created_at: string }[];
}

export interface ChatToolCall {
  name: "create_todo" | "update_todo" | "delete_todo" | "list_todos" |
        "save_draft" | "delete_draft" | "list_drafts" |
        "add_knowledge" | "send_email" | "reply_to_email" |
        "create_meeting" | "update_meeting" | "delete_meeting" | "list_meetings" |
        "search_emails" | "search_emails_by_sender" | "search_emails_by_date" | "search_emails_by_sender_and_date" |
        "lookup_contact" | "get_recent_emails" | "get_email" |
        "search_knowledge_base" | "get_read_receipts" | "get_sent_emails" | "archive_email";
  arguments: Record<string, unknown>;
}

// deno-lint-ignore no-explicit-any
export type SupabaseClient = { from: (table: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any };

function buildChatSystemPrompt(context: ChatContext): string {
  const now = new Date().toISOString().split("T")[0];
  const sections: string[] = [
    `You are RuneMail Assistant, a deeply personal AI assistant for ${context.userDisplayName}. Today is ${now}.
User's timezone: ${context.timezone || "UTC"}. All times the user mentions are in their local timezone.
You have a rich personal knowledge base, full email history, and contacts database you can search at any time. Act like a trusted personal assistant who proactively looks up relevant context before answering. Do NOT use <think> tags. Be direct and concise.

## RULES
1. SEARCH BEFORE YOU ANSWER: Any time a person, company, project, or topic is mentioned, call lookup_contact and/or search_knowledge_base FIRST to pull up relevant context. Do not answer from memory alone.
2. The knowledge base may have dozens of detailed entries per person or project - search it, use only the relevant results.
3. For ALL email content (reading, searching, recent emails), use email search tools - never guess.
4. When asked to send an email, compose it in the user's writing style and use send_email.
5. When asked to create a meeting, use create_meeting with proper ISO datetime and attendee emails. The user speaks in their local timezone (${context.timezone || "UTC"}). Pass times exactly as they intend; the system handles conversion.
6. Chain multiple tools freely in one turn: look up contact, search KB, search emails, then act.
7. Do NOT include Zoom in meetings unless the user explicitly asks.
8. COMPLETE every task asked. If asked to do multiple things, do ALL of them in one response.
9. Confirm completed actions in PAST TENSE: "I sent", "I created", "I drafted" - NEVER "I will send".
10. EMAIL SEARCH: If the first search returns no results, try again with a shorter keyword or try search_emails as a fallback. Only say "no emails found" after trying at least 2 different search approaches.
11. EMAIL FORMAT: When composing emails, format the body exactly as: greeting line (e.g. "Hi [Name],"), blank line, body paragraphs, blank line, closing phrase, then "${context.userDisplayName}" on a new line. Never add extra commas or punctuation to the greeting line.

## TOOL SELECTION
- Any person/company/project mentioned -> lookup_contact + search_knowledge_base (always, before acting)
- "last N emails" / "recent emails" -> get_recent_emails(limit=N)
- "what did X send me today" -> search_emails_by_sender_and_date
- "emails from X" -> search_emails_by_sender
- "emails this week" -> search_emails_by_date
- "emails about Y" -> search_emails
- "read / show me email [id]" -> get_email(id)
- "email X about Y" -> lookup_contact + send_email
- "reply to [email]" -> get_email(id) then reply_to_email
- "set up a meeting with X" -> lookup_contact + create_meeting
- "show my meetings" / "list meetings" -> list_meetings
- "update / reschedule meeting" -> update_meeting(id, ...)
- "cancel / delete meeting" -> delete_meeting(id)
- "create a todo" -> create_todo
- "mark todo done" / "complete todo" -> update_todo(id, is_completed: true)
- "edit todo" -> update_todo(id, text: "new text")
- "delete todo" -> delete_todo(id)
- "show todos" / "list todos" -> list_todos
- "draft an email" -> save_draft (when user says "draft"); use send_email when they say "send"
- "show drafts" / "list drafts" -> list_drafts
- "delete draft" -> delete_draft(id)
- "sent emails" / "what have I sent" -> get_sent_emails
- "read receipts" / "who opened my email" -> get_read_receipts
- "archive email" -> archive_email(id)`,
  ];

  if (context.styleProfile) {
    const s = context.styleProfile;
    sections.push(`## Writing Style\nGreeting pattern: ${s.greeting_style}\nClosing pattern: ${s.closing_style} (always follow with a new line containing only "${context.userDisplayName}")\nTone: ${s.tone}, Length: ${s.avg_length}`);
  } else {
    sections.push(`## Writing Style\nAlways sign emails as:\nBest regards,\n${context.userDisplayName}`);
  }

  if (context.openTodos.length > 0) {
    const lines = context.openTodos.map((t) => `- ${t.text}`).join("\n");
    sections.push(`## Open Todos\n${lines}`);
  }

  if (context.upcomingMeetings.length > 0) {
    const lines = context.upcomingMeetings
      .map((m) => `- ${m.title} on ${m.start_time?.split("T")[0] ?? "TBD"}${m.attendees?.length ? ` with ${m.attendees.slice(0, 3).join(", ")}` : ""}`)
      .join("\n");
    sections.push(`## Upcoming Meetings\n${lines}`);
  }

  if (context.pendingReplies.length > 0) {
    const lines = context.pendingReplies
      .map((r) => `- "${r.subject}" → ${r.recipient_email} (sent ${r.created_at.split("T")[0]})`)
      .join("\n");
    sections.push(`## Tracked Emails Awaiting Reply\n${lines}`);
  }

  return sections.join("\n\n");
}

const CHAT_TOOLS = [
  {
    type: "function",
    function: {
      name: "search_knowledge_base",
      description: "Search the knowledge base by keyword or topic. Use when looking for context about a project, company, topic, or person not immediately found in the Knowledge Base section above.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search term - a name, project, company, or topic keyword" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recent_emails",
      description: "Get the most recent emails from the inbox. Use when the user asks for 'last N emails', 'recent emails', or 'my inbox'. Specify exact limit to match what the user asks for.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of recent emails to retrieve (e.g. 4, 10). Default 10." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_contact",
      description: "Look up a person's email address and info by name. Searches email_memory and knowledge_base. ALWAYS use this before send_email or create_meeting when user refers to someone by name.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Person's name to look up" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_emails",
      description: "Search all emails by keyword or topic. Searches subject, sender, and body. Use for topic searches like 'budget report'. For sender queries, use search_emails_by_sender instead.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search keyword or topic" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_emails_by_sender",
      description: "Find emails from a specific person (no date filter). If user mentions a time period too, use search_emails_by_sender_and_date instead.",
      parameters: {
        type: "object",
        properties: {
          sender: { type: "string", description: "Sender name or email address" },
        },
        required: ["sender"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_emails_by_date",
      description: "Find emails within a date range.",
      parameters: {
        type: "object",
        properties: {
          start_date: { type: "string", description: "Start date (YYYY-MM-DD)" },
          end_date: { type: "string", description: "End date (YYYY-MM-DD). Defaults to today." },
        },
        required: ["start_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_emails_by_sender_and_date",
      description: "Find emails from a person within a date range. Best for 'what did X send me today/this week'.",
      parameters: {
        type: "object",
        properties: {
          sender: { type: "string", description: "Sender name or email address" },
          start_date: { type: "string", description: "Start date (YYYY-MM-DD)" },
          end_date: { type: "string", description: "End date (YYYY-MM-DD). Defaults to today." },
        },
        required: ["sender", "start_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_email",
      description: "Send an email on behalf of the user. Compose a professional email body. You MUST have the recipient's email address (use lookup_contact first if needed).",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address" },
          subject: { type: "string", description: "Email subject line" },
          body: { type: "string", description: "Email body (plain text, newlines for formatting)" },
        },
        required: ["to", "subject", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_draft",
      description: "Save a draft email (not sent). Use when user says 'draft' rather than 'send'.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address" },
          subject: { type: "string", description: "Email subject line" },
          body: { type: "string", description: "Email body text" },
        },
        required: ["to", "subject", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_meeting",
      description: "Create a calendar event/meeting. Use lookup_contact first to get attendee emails. Times should be in the user's local timezone as ISO 8601 (without Z suffix). Only set include_zoom to true if the user explicitly asks for a Zoom link.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Meeting title" },
          start_time: { type: "string", description: "Start time in user's local timezone as ISO 8601 (e.g. 2026-03-30T17:00:00)" },
          end_time: { type: "string", description: "End time in user's local timezone as ISO 8601 (e.g. 2026-03-30T18:00:00)" },
          attendees: { type: "array", items: { type: "string" }, description: "List of attendee email addresses" },
          description: { type: "string", description: "Optional meeting description" },
          include_zoom: { type: "boolean", description: "Whether to create a Zoom meeting link. Default false, only set true if user asks." },
        },
        required: ["title", "start_time", "end_time"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_todo",
      description: "Create a new todo/task item for the user.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "The task description" },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_knowledge",
      description: "Add an entry to the user's knowledge base (person, company, project, etc.).",
      parameters: {
        type: "object",
        properties: {
          entity: { type: "string", description: "Name of the entity" },
          entity_type: { type: "string", enum: ["person", "company", "project", "topic", "location", "other"], description: "Type of entity" },
          info: { type: "string", description: "Key facts about the entity" },
        },
        required: ["entity", "entity_type", "info"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_email",
      description: "Read the full content of a specific email by its ID. Use after search results return email IDs.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The email UUID from search results" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reply_to_email",
      description: "Send a reply to an existing email (maintains thread). Use get_email first to read the original.",
      parameters: {
        type: "object",
        properties: {
          email_id: { type: "string", description: "The UUID of the email being replied to" },
          body: { type: "string", description: "Reply body (plain text)" },
        },
        required: ["email_id", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_sent_emails",
      description: "Get recently sent emails.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of sent emails to retrieve. Default 10." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_todos",
      description: "List the user's todo items.",
      parameters: {
        type: "object",
        properties: {
          filter: { type: "string", enum: ["pending", "completed", "all"], description: "Filter by status. Default: pending." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_todo",
      description: "Update a todo item - mark it complete/incomplete or change its text. Requires the todo ID from list_todos.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Todo ID" },
          text: { type: "string", description: "New text for the todo (optional)" },
          is_completed: { type: "boolean", description: "Mark as complete (true) or incomplete (false)" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_todo",
      description: "Delete a todo item permanently.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Todo ID" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_meetings",
      description: "List the user's meetings. Use to show upcoming or recent meetings with full details.",
      parameters: {
        type: "object",
        properties: {
          filter: { type: "string", enum: ["upcoming", "past", "all"], description: "Filter meetings. Default: upcoming." },
          limit: { type: "number", description: "Max meetings to return. Default 10." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_meeting",
      description: "Edit an existing meeting. Requires meeting ID from list_meetings.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Meeting ID" },
          title: { type: "string", description: "New title" },
          start_time: { type: "string", description: "New start time (ISO 8601 in user's local timezone)" },
          end_time: { type: "string", description: "New end time (ISO 8601 in user's local timezone)" },
          attendees: { type: "array", items: { type: "string" }, description: "Updated attendee email list" },
          description: { type: "string", description: "Updated description" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_meeting",
      description: "Delete/cancel a meeting. Requires meeting ID from list_meetings.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Meeting ID" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_drafts",
      description: "List the user's saved email drafts.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of drafts to return. Default 10." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_draft",
      description: "Delete a draft email. Requires draft ID from list_drafts.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Draft ID" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_read_receipts",
      description: "Get read receipt tracking data - see which sent emails were opened and when.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of receipts to return. Default 10." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "archive_email",
      description: "Archive an email (removes it from the inbox view).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Email ID to archive" },
        },
        required: ["id"],
      },
    },
  },
];

export async function chatWithAssistant(
  context: ChatContext,
  message: string,
  history: { role: "user" | "assistant"; content: string }[],
  supabase?: SupabaseClient,
  userId?: string,
): Promise<{ reply: string; tool_calls: ChatToolCall[] }> {
  const apiKey = getEnv("CEREBRAS_API_KEY");
  const model = getEnv("CEREBRAS_MODEL") || "qwen-3-235b-a22b-instruct-2507";
  if (!apiKey) throw new Error("No LLM API key configured");

  const systemPrompt = buildChatSystemPrompt(context);
  const allToolCalls: ChatToolCall[] = [];

  let messages: { role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string }[] = [
    { role: "system", content: systemPrompt },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: message },
  ];

  const callAPI = async () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const res = await fetch("https://api.cerebras.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          tools: CHAT_TOOLS,
          tool_choice: "auto",
          temperature: 0.5,
          max_tokens: 4096,
        }),
      });

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("retry-after") ?? "5", 10);
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        continue;
      }

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Chat API error: ${errText}`);
      }

      return await res.json();
    }
    throw new Error("Chat API: max retries exceeded");
  };

  // Tool-calling loop (up to 3 rounds)
  for (let round = 0; round < 5; round++) {
    const data = await callAPI();
    const choice = data.choices?.[0];
    const assistantMsg = choice?.message;

    if (choice?.finish_reason !== "tool_calls" || !assistantMsg?.tool_calls?.length) {
      return { reply: stripThinkTags(assistantMsg?.content ?? ""), tool_calls: allToolCalls };
    }

    // Model wants to call tools — add assistant message and process each tool
    messages.push(assistantMsg);

    for (const tc of assistantMsg.tool_calls as { id: string; function: { name: string; arguments: string } }[]) {
      const args = (() => {
        try { return JSON.parse(tc.function?.arguments ?? "{}"); } catch { return {}; }
      })() as Record<string, unknown>;

      const toolCall: ChatToolCall = { name: tc.function?.name as ChatToolCall["name"], arguments: args };
      allToolCalls.push(toolCall);

      let toolResult: string;
      if (tc.function?.name === "get_recent_emails" && supabase && userId) {
        const limit = Math.min(Math.max(1, Number(args.limit) || 10), 50);
        const { data: results } = await supabase
          .from("emails")
          .select("id, subject, sender, sender_email, received_at, snippet, email_processed(summary, category)")
          .eq("user_id", userId)
          .order("received_at", { ascending: false })
          .limit(limit);
        const emails = results ?? [];
        toolResult = emails.length > 0
          ? `Here are the ${emails.length} most recent emails:\n` + emails.map((e: any) => {
              const p = Array.isArray(e.email_processed) ? e.email_processed[0] : e.email_processed;
              return `[${e.id}] ${e.received_at?.split("T")[0]} From: ${e.sender || e.sender_email} | ${e.subject} | ${p?.summary ?? e.snippet ?? "(no summary)"} | ${p?.category ?? "unknown"}`;
            }).join("\n")
          : "No emails found.";
      } else if (tc.function?.name === "search_knowledge_base" && supabase && userId) {
        const query = ((args.query as string) ?? "").trim();
        const { data: kbResults } = await supabase
          .from("knowledge_base")
          .select("entity, entity_type, info, importance")
          .eq("user_id", userId)
          .or(`entity.ilike.%${query}%,info.ilike.%${query}%`)
          .order("importance", { ascending: false })
          .limit(15);
        const entries = kbResults ?? [];
        toolResult = entries.length > 0
          ? "Knowledge base results:\n" + entries.map((k: any) =>
              `- ${k.entity} (${k.entity_type}): ${k.info}`
            ).join("\n")
          : `No knowledge base entries found for "${query}".`;
      } else if (tc.function?.name === "lookup_contact" && supabase && userId) {
        const name = ((args.name as string) ?? "").trim();
        // Search email_memory for sender info
        const { data: memoryResults } = await supabase
          .from("email_memory")
          .select("sender_email, sender_name, interaction_count, relationship_notes, last_subject")
          .eq("user_id", userId)
          .or(`sender_email.ilike.%${name}%,sender_name.ilike.%${name}%`)
          .order("interaction_count", { ascending: false })
          .limit(5);
        // Also search knowledge_base
        const { data: kbResults } = await supabase
          .from("knowledge_base")
          .select("entity, entity_type, info")
          .eq("user_id", userId)
          .ilike("entity", `%${name}%`)
          .limit(5);
        const contacts = memoryResults ?? [];
        const knowledge = kbResults ?? [];
        const parts: string[] = [];
        if (contacts.length > 0) {
          parts.push("Contacts found:\n" + contacts.map((c: any) =>
            `- ${c.sender_name || "Unknown"} <${c.sender_email}> (${c.interaction_count} emails)${c.relationship_notes ? ` - ${c.relationship_notes}` : ""}${c.last_subject ? ` | Last email: ${c.last_subject}` : ""}`
          ).join("\n"));
        }
        if (knowledge.length > 0) {
          parts.push("Knowledge base:\n" + knowledge.map((k: any) =>
            `- ${k.entity} (${k.entity_type}): ${k.info}`
          ).join("\n"));
        }
        toolResult = parts.length > 0 ? parts.join("\n\n") : `No contact or knowledge found for "${name}". Check the Contacts section in context, or ask the user for the email address.`;
      } else if (tc.function?.name === "search_emails" && supabase && userId) {
        const query = ((args.query as string) ?? "").trim();
        const { data: results } = await supabase
          .from("emails")
          .select("id, subject, sender, sender_email, received_at, snippet, email_processed(summary, category)")
          .eq("user_id", userId)
          .or(`subject.ilike.%${query}%,sender.ilike.%${query}%,sender_email.ilike.%${query}%,body_text.ilike.%${query}%`)
          .order("received_at", { ascending: false })
          .limit(20);
        const emails = results ?? [];
        toolResult = emails.length > 0
          ? "Found emails:\n" + emails.map((e: any) => {
              const p = Array.isArray(e.email_processed) ? e.email_processed[0] : e.email_processed;
              return `[${e.id}] ${e.received_at?.split("T")[0]} From: ${e.sender || e.sender_email} | ${e.subject} | ${p?.summary ?? e.snippet ?? ""}`;
            }).join("\n")
          : `No emails found matching "${query}". The user's inbox may not be fully synced - let them know to click the reload button to sync newer emails, or try a shorter/different search term.`;
      } else if (tc.function?.name === "search_emails" && (!supabase || !userId)) {
        const query = ((args.query as string) ?? "").toLowerCase();
        const matches = context.recentEmails.filter((e) =>
          e.subject.toLowerCase().includes(query) ||
          (e.sender?.toLowerCase() ?? "").includes(query) ||
          e.sender_email.toLowerCase().includes(query) ||
          (e.summary?.toLowerCase() ?? "").includes(query)
        ).slice(0, 10);
        toolResult = matches.length > 0
          ? "Found emails:\n" + matches.map((e) => `[${e.id}] ${e.date.split("T")[0]} From: ${e.sender || e.sender_email} | ${e.subject} | ${e.summary ?? ""}`).join("\n")
          : "No emails found matching that query.";
      } else if (tc.function?.name === "search_emails_by_sender" && supabase && userId) {
        const sender = ((args.sender as string) ?? "").trim();
        const { data: results } = await supabase
          .from("emails")
          .select("id, subject, sender, sender_email, received_at, snippet, email_processed(summary)")
          .eq("user_id", userId)
          .or(`sender_email.ilike.%${sender}%,sender.ilike.%${sender}%`)
          .order("received_at", { ascending: false })
          .limit(20);
        const emails = results ?? [];
        toolResult = emails.length > 0
          ? `Found ${emails.length} emails from "${sender}":\n` + emails.map((e: any) => {
              const p = Array.isArray(e.email_processed) ? e.email_processed[0] : e.email_processed;
              return `[${e.id}] ${e.received_at?.split("T")[0]} From: ${e.sender || e.sender_email} | ${e.subject} | ${p?.summary ?? e.snippet ?? ""}`;
            }).join("\n")
          : `No emails found from "${sender}". The inbox may not be fully synced - suggest the user click the reload button to fetch newer emails.`;
      } else if (tc.function?.name === "search_emails_by_date" && supabase && userId) {
        const startDate = (args.start_date as string) ?? "";
        const endDate = (args.end_date as string) ?? new Date().toISOString().split("T")[0];
        const { data: results } = await supabase
          .from("emails")
          .select("id, subject, sender, sender_email, received_at, snippet, email_processed(summary)")
          .eq("user_id", userId)
          .gte("received_at", `${startDate}T00:00:00`)
          .lte("received_at", `${endDate}T23:59:59`)
          .order("received_at", { ascending: false })
          .limit(20);
        const emails = results ?? [];
        toolResult = emails.length > 0
          ? `Found ${emails.length} emails between ${startDate} and ${endDate}:\n` + emails.map((e: any) => {
              const p = Array.isArray(e.email_processed) ? e.email_processed[0] : e.email_processed;
              return `[${e.id}] ${e.received_at?.split("T")[0]} From: ${e.sender || e.sender_email} | ${e.subject} | ${p?.summary ?? e.snippet ?? ""}`;
            }).join("\n")
          : `No emails found between ${startDate} and ${endDate}.`;
      } else if (tc.function?.name === "search_emails_by_sender_and_date" && supabase && userId) {
        const sender = ((args.sender as string) ?? "").trim();
        const startDate = (args.start_date as string) ?? "";
        const endDate = (args.end_date as string) ?? new Date().toISOString().split("T")[0];
        const { data: results } = await supabase
          .from("emails")
          .select("id, subject, sender, sender_email, received_at, snippet, email_processed(summary)")
          .eq("user_id", userId)
          .or(`sender_email.ilike.%${sender}%,sender.ilike.%${sender}%`)
          .gte("received_at", `${startDate}T00:00:00`)
          .lte("received_at", `${endDate}T23:59:59`)
          .order("received_at", { ascending: false })
          .limit(20);
        const emails = results ?? [];
        toolResult = emails.length > 0
          ? `Found ${emails.length} emails from "${sender}" between ${startDate} and ${endDate}:\n` + emails.map((e: any) => {
              const p = Array.isArray(e.email_processed) ? e.email_processed[0] : e.email_processed;
              return `[${e.id}] ${e.received_at?.split("T")[0]} From: ${e.sender || e.sender_email} | ${e.subject} | ${p?.summary ?? e.snippet ?? ""}`;
            }).join("\n")
          : `No emails found from "${sender}" between ${startDate} and ${endDate}.`;
      } else if (tc.function?.name === "get_email" && supabase && userId) {
        const id = (args.id as string) ?? "";
        const { data: email } = await supabase
          .from("emails")
          .select("id, subject, sender, sender_email, recipients, received_at, body_text, snippet, thread_id, gmail_id, label_ids, email_processed(summary, category)")
          .eq("user_id", userId)
          .eq("id", id)
          .maybeSingle();
        if (!email) {
          toolResult = `Email with ID "${id}" not found.`;
        } else {
          const p = Array.isArray((email as any).email_processed) ? (email as any).email_processed[0] : (email as any).email_processed;
          const body = (email as any).body_text ?? (email as any).snippet ?? "(no body)";
          toolResult = `Email ID: ${(email as any).id}\nDate: ${(email as any).received_at?.split("T")[0]}\nFrom: ${(email as any).sender || (email as any).sender_email}\nTo: ${(email as any).recipients ?? ""}\nSubject: ${(email as any).subject}\nCategory: ${p?.category ?? "unknown"}\nSummary: ${p?.summary ?? ""}\n\nBody:\n${body.slice(0, 3000)}`;
        }
      } else if (tc.function?.name === "get_sent_emails" && supabase && userId) {
        const limit = Math.min(Math.max(1, Number(args.limit) || 10), 50);
        const { data: results } = await supabase
          .from("emails")
          .select("id, subject, sender, sender_email, recipients, received_at, snippet")
          .eq("user_id", userId)
          .contains("label_ids", ["SENT"])
          .order("received_at", { ascending: false })
          .limit(limit);
        const emails = results ?? [];
        toolResult = emails.length > 0
          ? `${emails.length} sent emails:\n` + emails.map((e: any) =>
              `[${e.id}] ${e.received_at?.split("T")[0]} To: ${e.recipients ?? ""} | ${e.subject}`
            ).join("\n")
          : "No sent emails found.";
      } else if (tc.function?.name === "list_todos" && supabase && userId) {
        const filter = (args.filter as string) ?? "pending";
        let query = supabase.from("todos").select("id, text, is_completed, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50);
        if (filter === "pending") query = query.eq("is_completed", false);
        else if (filter === "completed") query = query.eq("is_completed", true);
        const { data: todos } = await query;
        const items = todos ?? [];
        toolResult = items.length > 0
          ? `${items.length} todos (${filter}):\n` + items.map((t: any) =>
              `[${t.id}] [${t.is_completed ? "done" : "pending"}] ${t.text}`
            ).join("\n")
          : `No ${filter} todos found.`;
      } else if (tc.function?.name === "update_todo" && supabase && userId) {
        const id = (args.id as string) ?? "";
        const updates: Record<string, unknown> = {};
        if (args.text !== undefined) updates.text = args.text;
        if (args.is_completed !== undefined) updates.is_completed = args.is_completed;
        if (Object.keys(updates).length === 0) {
          toolResult = "No updates provided.";
        } else {
          const { error } = await supabase.from("todos").update(updates).eq("id", id).eq("user_id", userId);
          toolResult = error ? `Failed to update todo: ${error.message}` : `Todo updated successfully.`;
        }
      } else if (tc.function?.name === "delete_todo" && supabase && userId) {
        const id = (args.id as string) ?? "";
        const { error } = await supabase.from("todos").delete().eq("id", id).eq("user_id", userId);
        toolResult = error ? `Failed to delete todo: ${error.message}` : "Todo deleted.";
      } else if (tc.function?.name === "list_meetings" && supabase && userId) {
        const filter = (args.filter as string) ?? "upcoming";
        const limit = Math.min(Math.max(1, Number(args.limit) || 10), 50);
        const now = new Date().toISOString();
        let query = supabase.from("meetings").select("id, title, description, start_time, end_time, attendees, location, zoom_link, status").eq("user_id", userId).limit(limit);
        if (filter === "upcoming") query = query.gte("start_time", now).order("start_time", { ascending: true });
        else if (filter === "past") query = query.lt("start_time", now).order("start_time", { ascending: false });
        else query = query.order("start_time", { ascending: true });
        const { data: meetings } = await query;
        const items = meetings ?? [];
        toolResult = items.length > 0
          ? `${items.length} meetings (${filter}):\n` + items.map((m: any) =>
              `[${m.id}] ${m.start_time?.split("T")[0]} ${m.start_time?.split("T")[1]?.slice(0,5) ?? ""} - ${m.title}${m.attendees?.length ? ` | Attendees: ${m.attendees.join(", ")}` : ""}${m.zoom_link ? ` | Zoom: ${m.zoom_link}` : ""}${m.status !== "confirmed" ? ` | Status: ${m.status}` : ""}`
            ).join("\n")
          : `No ${filter} meetings found.`;
      } else if (tc.function?.name === "update_meeting" && supabase && userId) {
        const id = (args.id as string) ?? "";
        const updates: Record<string, unknown> = {};
        if (args.title !== undefined) updates.title = args.title;
        if (args.start_time !== undefined) updates.start_time = args.start_time;
        if (args.end_time !== undefined) updates.end_time = args.end_time;
        if (args.attendees !== undefined) updates.attendees = args.attendees;
        if (args.description !== undefined) updates.description = args.description;
        if (Object.keys(updates).length === 0) {
          toolResult = "No updates provided.";
        } else {
          const { error } = await supabase.from("meetings").update(updates).eq("id", id).eq("user_id", userId);
          toolResult = error ? `Failed to update meeting: ${error.message}` : "Meeting updated successfully.";
        }
      } else if (tc.function?.name === "delete_meeting" && supabase && userId) {
        const id = (args.id as string) ?? "";
        const { error } = await supabase.from("meetings").delete().eq("id", id).eq("user_id", userId);
        toolResult = error ? `Failed to delete meeting: ${error.message}` : "Meeting deleted.";
      } else if (tc.function?.name === "list_drafts" && supabase && userId) {
        const limit = Math.min(Math.max(1, Number(args.limit) || 10), 50);
        const { data: drafts } = await supabase
          .from("draft_emails")
          .select("id, subject, to_addresses, body_html, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(limit);
        const items = drafts ?? [];
        toolResult = items.length > 0
          ? `${items.length} drafts:\n` + items.map((d: any) =>
              `[${d.id}] ${d.created_at?.split("T")[0]} To: ${Array.isArray(d.to_addresses) ? d.to_addresses.join(", ") : d.to_addresses} | ${d.subject}`
            ).join("\n")
          : "No drafts found.";
      } else if (tc.function?.name === "delete_draft" && supabase && userId) {
        const id = (args.id as string) ?? "";
        const { error } = await supabase.from("draft_emails").delete().eq("id", id).eq("user_id", userId);
        toolResult = error ? `Failed to delete draft: ${error.message}` : "Draft deleted.";
      } else if (tc.function?.name === "get_read_receipts" && supabase && userId) {
        const limit = Math.min(Math.max(1, Number(args.limit) || 10), 50);
        const { data: receipts } = await supabase
          .from("read_receipts")
          .select("id, subject, recipient_email, open_count, first_opened_at, last_opened_at, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(limit);
        const items = receipts ?? [];
        toolResult = items.length > 0
          ? `${items.length} read receipts:\n` + items.map((r: any) =>
              `[${r.id}] "${r.subject}" → ${r.recipient_email} | Opens: ${r.open_count}${r.first_opened_at ? ` | First opened: ${r.first_opened_at.split("T")[0]}` : " | Not yet opened"}`
            ).join("\n")
          : "No read receipts found.";
      } else if (tc.function?.name === "archive_email" && supabase && userId) {
        const id = (args.id as string) ?? "";
        const { error } = await supabase.from("emails").update({ is_archived: true }).eq("id", id).eq("user_id", userId);
        toolResult = error ? `Failed to archive email: ${error.message}` : "Email archived.";
      } else {
        // Tools executed by the caller (index.ts): send_email, reply_to_email, save_draft, create_meeting, add_knowledge
        toolResult = `Action "${tc.function?.name}" queued for execution.`;
      }

      messages.push({ role: "tool", tool_call_id: tc.id, content: toolResult });
    }
  }

  // Fallback: get final response after tool rounds
  const finalData = await callAPI();
  return {
    reply: stripThinkTags(finalData.choices?.[0]?.message?.content ?? ""),
    tool_calls: allToolCalls,
  };
}
