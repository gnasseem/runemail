/**
 * LangGraph-style email AI processing graph for RuneMail.
 *
 * Inspired by the original Streamlit/Python quick_actions_graph.py and
 * langgraph_pipeline.py. Adapted for browser-side TypeScript/WebLLM.
 *
 * ── Architecture ─────────────────────────────────────────────────────────────
 *
 *  MAIN GRAPH (router-based dispatch):
 *  ┌─────────────────────────────────────────────────────────────────┐
 *  │  START → router                                                 │
 *  │           ├──[categorize/rethink/process_email]──→ categorize   │
 *  │           │            │                                        │
 *  │           │   (conditional: important/action-required)          │
 *  │           │            ├──yes──→ summarize → extract_actions    │
 *  │           │            └──no──→ END                             │
 *  │           │                                                     │
 *  │           ├──[brief]──→ briefing ─────────────────────→ END    │
 *  │           ├──[todos]──→ todos ──────────────────────────→ END  │
 *  │           ├──[meetings]──→ meetings ───────────────────→ END   │
 *  │           ├──[draft]──→ draft ─────────────────────────→ END  │
 *  │           └──[auto_reply]──→ quick_actions_graph ──────→ END  │
 *  └─────────────────────────────────────────────────────────────────┘
 *
 *  QUICK ACTIONS SUBGRAPH (mirrors original quick_actions_graph.py):
 *  gather_context → reply_analysis → todo_analysis
 *                                    → meeting_analysis
 *                                    → archive_analysis
 *                                    → merge_actions → END
 *
 * ── Key LangGraph principles ─────────────────────────────────────────────────
 *  1. State accumulates as it flows — each node reads and returns partial state
 *  2. Conditional edges route dynamically based on runtime state values
 *  3. Router node dispatches to different subgraphs based on task type
 *  4. Nodes are pure async functions (no side effects beyond state updates)
 *  5. Single compiled graph singleton — build once, invoke many times
 */

import { localInference, initWebLLM, isWebLLMReady, extractJSON } from "./webllm";
import { createClient } from "@/lib/supabase/client";

// ── Types ─────────────────────────────────────────────────────────────────────

export type TaskType =
  | "categorize"
  | "process_email"
  | "brief"
  | "todos"
  | "meetings"
  | "draft"
  | "auto_reply"
  | "rethink"
  | "analyze_style";

export interface EmailInput {
  id?: string;
  subject: string;
  sender: string;
  sender_email?: string;
  snippet?: string;
  body_text?: string;
  // Structural signals for smarter categorization
  label_ids?: string[];
  has_attachments?: boolean;
  has_list_unsubscribe?: boolean;
  is_reply?: boolean;
  reply_to_email?: string;
  cc_recipients?: string;
  precedence_header?: string;
  sender_interaction_count?: number;
}

export interface QuickAction {
  label: string;
  action: string;
}

export interface TodoSuggestion {
  task: string;
  source: string;
}

export interface MeetingSuggestion {
  title: string;
  attendees: string[];
  suggestedTime?: string;
  source: string;
}

export interface BriefingEmail {
  subject: string;
  senderName: string;
  sender: string;
  summary: string;
  urgency: "critical" | "high" | "medium";
  deadline?: string | null;
  waitingForReply: boolean;
  tags: string[];
  email_id?: string;
  /** One line: what the sender wants (Auto-Resolve / cloud briefing). */
  signal?: string;
  evidence?: string;
  relationshipHint?: "first-party" | "known-contact" | "stranger" | "auto" | string;
  suggestedAction?: "reply" | "todo" | "meeting" | "archive" | "ignore" | string;
}

export interface DeadlineItem {
  task: string;
  date: string;
  source: string;
}

export interface BriefingResult {
  executiveSummary: string;
  // New shape (v2)
  crucial?: BriefingEmail[];
  replyNeeded?: BriefingEmail[];
  deadlines?: BriefingEmail[] | DeadlineItem[];
  nonEssential?: BriefingEmail[];
  // Old shape (v1) kept for backward compat with cached briefings
  topPriority?: BriefingEmail[];
  waitingForReply?: BriefingEmail[];
  stats: {
    total: number;
    // v2 fields
    crucial?: number;
    replyNeeded?: number;
    nonEssential?: number;
    // v1 fields
    critical?: number;
    deadlines?: number;
    waitingOnYou?: number;
    filtered?: number;
  };
  summary?: string;
  actionItems?: string[];
}

/** Core state that accumulates as it flows through the graph */
export interface EmailGraphState {
  task: TaskType;

  // ── Inputs ──────────────────────────────────────────────────────────────────
  userId?: string;
  emails?: EmailInput[];
  currentEmail?: EmailInput;
  draftIntent?: string;
  draftContext?: {
    to: string;
    subject: string;
    senderName?: string;
    replyTo?: { subject: string; body: string };
  };
  instructions?: string;
  tone?: string;
  existingTodos?: string[];   // for dedup in todo_analysis
  userTags?: { slug: string; description: string }[];  // user-defined tags for auto-assignment
  workingHours?: { start?: string; end?: string; days?: number[] } | null;

  // ── Outputs (accumulated across nodes) ─────────────────────────────────────
  category?: string;
  assignedTags?: string[];
  summary?: string;
  quickActions?: QuickAction[];

  // Quick-actions subgraph intermediate state (mirrors original Python nodes)
  _replyOptions?: string[];
  _todoOptions?: string[];
  _meetingOptions?: string[];
  _archiveOption?: string;

  todoSuggestions?: TodoSuggestion[];
  meetingSuggestions?: MeetingSuggestion[];
  briefing?: BriefingResult;
  draft?: string;
  knowledgeEntities?: Array<{ entity: string; entity_type: string; info: string; confidence: number }>;
  styleProfile?: {
    greeting_style: string;
    closing_style: string;
    tone: string;
    avg_length: string;
    sample_count: number;
  };

  // ── Internal ────────────────────────────────────────────────────────────────
  error?: string;
}

type NodeFn = (state: EmailGraphState) => Promise<Partial<EmailGraphState>>;

interface ConditionalEdge {
  router: (state: EmailGraphState) => string;
  mapping: Record<string, string>;
}

// ── Graph Engine ──────────────────────────────────────────────────────────────

class StateGraph {
  private nodes = new Map<string, NodeFn>();
  private edges = new Map<string, string>();
  private conditionalEdges = new Map<string, ConditionalEdge>();
  private entry = "";

  addNode(name: string, fn: NodeFn): this {
    this.nodes.set(name, fn);
    return this;
  }

  addEdge(from: string, to: string): this {
    this.edges.set(from, to);
    return this;
  }

  addConditionalEdges(
    from: string,
    router: (state: EmailGraphState) => string,
    mapping: Record<string, string>,
  ): this {
    this.conditionalEdges.set(from, { router, mapping });
    return this;
  }

  setEntryPoint(node: string): this {
    this.entry = node;
    return this;
  }

  compile(): CompiledGraph {
    return new CompiledGraph(
      new Map(this.nodes),
      new Map(this.edges),
      new Map(this.conditionalEdges),
      this.entry,
    );
  }
}

class CompiledGraph {
  constructor(
    private nodes: Map<string, NodeFn>,
    private edges: Map<string, string>,
    private conditionalEdges: Map<string, ConditionalEdge>,
    private entryPoint: string,
  ) {}

  async invoke(initialState: Partial<EmailGraphState>): Promise<EmailGraphState> {
    let state = { ...initialState } as EmailGraphState;
    let current = this.entryPoint;
    let steps = 0;
    const MAX_STEPS = 25;

    while (current !== "__end__" && steps < MAX_STEPS) {
      steps++;

      const nodeFn = this.nodes.get(current);
      if (!nodeFn) {
        console.error(`[EmailGraph] Node not found: "${current}"`);
        break;
      }

      try {
        const update = await nodeFn(state);
        state = { ...state, ...update };
      } catch (err) {
        console.error(`[EmailGraph] Error in node "${current}":`, err);
        state = { ...state, error: err instanceof Error ? err.message : String(err) };
        break;
      }

      const cond = this.conditionalEdges.get(current);
      if (cond) {
        const key = cond.router(state);
        current = cond.mapping[key] ?? "__end__";
      } else {
        current = this.edges.get(current) ?? "__end__";
      }
    }

    return state;
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

async function ensureModel(): Promise<void> {
  if (!isWebLLMReady()) {
    const ok = await initWebLLM();
    if (!ok) throw new Error("WebLLM could not be initialized");
  }
}

/**
 * Fuzzy dedup check — mirrors Python _fuzzy_match from quick_actions_graph.py.
 * Returns true if a and b share >= 60% of meaningful words.
 */
function fuzzyMatch(a: string, b: string): boolean {
  const stop = new Set(["the", "a", "an", "to", "and", "or", "of", "in", "on", "for", "is", "it", "this", "that"]);
  const words = (s: string) =>
    new Set(s.toLowerCase().match(/[a-z0-9]+/g)?.filter((w) => !stop.has(w)) ?? []);
  const wa = words(a);
  const wb = words(b);
  if (!wa.size || !wb.size) return false;
  const overlap = Array.from(wa).filter((w) => wb.has(w)).length;
  return overlap / Math.min(wa.size, wb.size) >= 0.75;
}

function senderIsNoReply(sender: string): boolean {
  const s = sender.toLowerCase();
  return ["noreply", "no-reply", "donotreply", "mailer-daemon", "bounce", "postmaster"].some((p) => s.includes(p));
}

// CATEGORY_UPDATES is intentionally excluded: Gmail's Updates tab includes
// GitHub notifications, Jira tickets, calendar invites, etc. that often need replies.
const NEWSLETTER_GMAIL_LABELS = new Set([
  "CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS",
]);

function buildEmailSignalContext(email: EmailInput): { signalLines: string[]; definiteCategory: string | null } {
  const labels = email.label_ids ?? [];
  const lines: string[] = [];

  const gmailCategories = labels.filter((l) => l.startsWith("CATEGORY_"));
  if (gmailCategories.length > 0) lines.push(`Gmail auto-category: ${gmailCategories.join(", ")}`);
  if (labels.includes("IMPORTANT")) lines.push("Gmail marked IMPORTANT: yes");
  if (labels.includes("STARRED")) lines.push("Starred by user: yes");

  if (email.has_list_unsubscribe) lines.push("Has List-Unsubscribe header: yes (possible newsletter/bulk — but transactional services also include this)");
  const prec = email.precedence_header?.toLowerCase();
  if (prec && ["bulk", "list", "junk"].includes(prec)) lines.push(`Precedence: ${prec} (bulk mail)`);
  if (email.reply_to_email) lines.push("Reply-To differs from sender (common in marketing)");
  if (email.is_reply) lines.push("Reply in active thread: yes");
  if (email.has_attachments) lines.push("Has attachments: yes");
  if (email.cc_recipients) lines.push("Has CC recipients: yes");

  const count = email.sender_interaction_count ?? 0;
  if (count >= 5) lines.push(`Sender history: ${count} prior emails (known contact)`);
  else if (count > 0) lines.push(`Sender history: ${count} prior email(s)`);

  const isDefiniteNewsletter =
    labels.some((l) => NEWSLETTER_GMAIL_LABELS.has(l)) ||
    (prec !== undefined && ["bulk", "list", "junk"].includes(prec));

  const isDefiniteImportant = labels.includes("STARRED");

  let definiteCategory: string | null = null;
  if (isDefiniteNewsletter) {
    definiteCategory = "newsletter";
  } else if (isDefiniteImportant) {
    lines.push("NOTE: User starred this — lean action-required or important.");
  }

  return { signalLines: lines, definiteCategory };
}

// ── Node Implementations ──────────────────────────────────────────────────────

// ─ Main graph nodes ───────────────────────────────────────────────────────────

/** Entry point — pure pass-through; routing done via conditional edges */
const routerNode: NodeFn = async () => ({});

/**
 * categorize: classify a single email using structural signals + AI.
 * Signal-first approach: definitive signals short-circuit the AI call.
 */
const categorizeNode: NodeFn = async (state) => {
  await ensureModel();
  const email = state.currentEmail;
  if (!email) return { error: "No email provided to categorize" };

  const { signalLines, definiteCategory } = buildEmailSignalContext(email);

  // Short-circuit: definitive signals (Gmail categories, no-reply, unsubscribe)
  if (definiteCategory === "newsletter") {
    return { category: "newsletter", assignedTags: [] };
  }

  const signalContext = signalLines.length > 0
    ? `SIGNALS:\n${signalLines.map((l) => `- ${l}`).join("\n")}\n\n`
    : "";

  const emailText = `Subject: ${email.subject}\nFrom: ${email.sender}\n${email.snippet || email.body_text?.slice(0, 500) || ""}`;

  const userTags = state.userTags || [];
  const tagsSection = userTags.length > 0
    ? `\n\nCustom tags (apply any that fit):\n${userTags.map((t) => `- ${t.slug}: ${t.description || t.slug}`).join("\n")}\nAdd "tags":["slug",...] if any apply.`
    : "";

  const outputShape = userTags.length > 0
    ? `{"category":"<important|action-required|newsletter|informational>","tags":["slug",...]}`
    : `{"category":"<important|action-required|newsletter|informational>"}`;

  const raw = await localInference(
    `Classify this email. Return JSON only:
${outputShape}

STEP 1 — HIGH-STAKES CHECK (run before standard rules):
If this email concerns any of these life-event domains, it is NEVER "informational" or "newsletter":
- Career: job offer, offer letter, interview invitation, application update (hired/shortlisted/rejected/next steps), onboarding, background check, recruiter asking for a response, contract to sign
- Academic: admission/acceptance/rejection, financial aid, scholarship, enrollment deadline
- Legal: contract, agreement, legal notice, settlement, lease, terms requiring signature
- Medical: appointment, lab results, prescription, diagnosis, referral
- Financial decision: mortgage, loan, credit decision, account suspended, fraud alert requiring action
ATS/HR senders (Greenhouse, Workday, Lever, Taleo, SmartRecruiters, iCIMS, Jobvite) writing about a job or interview are NOT informational.
If STEP 1 triggers: use action-required when a reply/action is expected; use important when status-only FYI.

STEP 2 — STANDARD RULES (first that fits):
1. action-required: a real person is waiting on YOU to do something concrete — reply, approve, sign, pay, schedule, RSVP, review, submit. A direct human question always belongs here.
2. important: a real person wrote to you and it is worth reading, no response required right now (status update, personal note, FYI from a known contact). Do NOT use as a safe default.
3. newsletter: bulk content sent to a mailing list — digests, promotional campaigns, brand newsletters, weekly round-ups, sales. Marketing tone + broadcast.
4. informational: automated/transactional/system messages that are NOT marketing — receipts, shipping, bank/card alerts, security alerts, password resets, calendar reminders, billing.

Tie-breakers: unsubscribe link alone does NOT make something a newsletter (transactional mail has them). When unsure between important and informational, prefer informational for automated content; use important only for real human-to-human mail. Use the SIGNALS above to guide your classification.${tagsSection}`,
    `${signalContext}${emailText}`,
    { temperature: 0.1, maxTokens: 256 },
  );

  const parsed = extractJSON<{ category?: string; tags?: string[] }>(raw, {});
  const valid = ["important", "action-required", "newsletter", "informational"];
  let category = valid.includes(parsed.category || "") ? parsed.category! : "informational";

  const validTagSlugs = new Set(userTags.map((t) => t.slug));
  const assignedTags = Array.isArray(parsed.tags)
    ? parsed.tags.filter((t: string) => validTagSlugs.has(t))
    : [];

  // Keyword-based safety net for high-stakes and urgent signals
  const fullText = `${email.subject} ${email.snippet || ""}`.toLowerCase();
  const highStakesKeywords = [
    "job offer", "offer letter", "interview", "application status", "hired", "shortlisted",
    "rejected", "onboarding", "recruiter", "admission", "accepted", "financial aid",
    "scholarship", "enrollment", "legal notice", "contract", "settlement", "lab results",
    "test results", "diagnosis", "mortgage", "loan approval", "account suspended",
    "security alert", "verify your account", "password reset", "suspicious activity",
    "unauthorized access", "by end of day", "by eod", "deadline",
  ];
  const hasHighStakesSignal = highStakesKeywords.some((k) => fullText.includes(k));

  if (hasHighStakesSignal && ["informational", "newsletter"].includes(category)) {
    category = "important";
  }

  return { category, assignedTags };
};

/**
 * summarize: concise but complete email summary.
 */
const summarizeNode: NodeFn = async (state) => {
  await ensureModel();
  const email = state.currentEmail;
  if (!email) return {};

  const body = email.body_text || email.snippet || "";
  const raw = await localInference(
    "Summarize this email clearly and concisely. Capture the key point, any action required, and relevant context. Write 1-3 sentences as needed — use more if the email is complex or has multiple points.",
    `Subject: ${email.subject}\nFrom: ${email.sender}\n\n${body}`,
    { temperature: 0.15, maxTokens: 300 },
  );

  return { summary: raw.trim() };
};

/**
 * extract_actions: run the quick-actions subgraph on currentEmail.
 * Mirrors original quick_actions_graph.py structure.
 */
const extractActionsNode: NodeFn = async (state) => {
  await ensureModel();
  const email = state.currentEmail;
  if (!email) return { quickActions: [] };
  // Skip if email lacks the minimum fields the subgraph nodes rely on
  if (!email.subject && !email.snippet && !email.body_text) return { quickActions: [] };

  // Run the quick-actions subgraph inline
  const qaState = await quickActionsGraph.invoke({
    task: "auto_reply",
    currentEmail: email,
    existingTodos: state.existingTodos || [],
  });

  const actions = qaState.quickActions || [];
  return { quickActions: actions };
};

// ── Quick-actions subgraph nodes (mirrors original quick_actions_graph.py) ──

/**
 * qa_gather_context: gather any additional context before analysis.
 * (In browser context, no DB memory — uses email fields directly.)
 */
const qaGatherContextNode: NodeFn = async (state) => {
  // No external memory in browser mode — pass through
  return {};
};

/**
 * qa_reply_analysis: determine if a reply is warranted and what type.
 * Mirrors original reply_analysis_node.
 */
const qaReplyAnalysisNode: NodeFn = async (state) => {
  await ensureModel();
  const email = state.currentEmail;
  if (!email) return { _replyOptions: [] };

  // Heuristics: no-reply senders and newsletters don't need replies
  if (senderIsNoReply(email.sender)) return { _replyOptions: [] };
  if (["newsletter", "informational"].includes(state.category || "")) return { _replyOptions: [] };

  const body = (email.body_text || email.snippet || "").slice(0, 1000);

  const raw = await localInference(
    `Decide whether this email warrants a reply. Most real human emails do — lean toward suggesting one.

WHEN TO REPLY (include at least one suggestion):
- A human asked you a direct question.
- Someone requested your approval, confirmation, decision, or feedback.
- An invitation, meeting request, or scheduling ping needs a response (accept/decline/propose time).
- A colleague pinged you with something that clearly wants acknowledgement.
- Tone is conversational and the sender is awaiting you.

WHEN NOT TO REPLY:
- Pure notifications, receipts, or FYI broadcasts where no one is waiting.
- Newsletters and informational emails (already filtered above).
- Vague side-notes that should be Todos ("check the doc", "read this") — those are NOT replies.

STYLE OF SUGGESTIONS:
- 1 suggestion is best; at most 2 if a clear fork exists (e.g. accept vs ask for details).
- Describe the reply as a conversational action TO the sender, e.g. "Confirm I can join Thursday at 3", "Ask for the updated agenda".
- Do NOT use "Reply:" prefix.

Output JSON array of reply descriptions. Example: ["Accept the invitation", "Ask for agenda"]
Return [] ONLY if truly no reply is warranted.`,
    `From: ${email.sender}\nSubject: ${email.subject}\nContent: ${body}`,
    { temperature: 0.2, maxTokens: 128 },
  );

  const options = extractJSON<string[]>(raw, []);
  const replies = Array.isArray(options)
    ? options.map((o) => `Reply: ${String(o).trim()}`).filter((o) => o.length > 8).slice(0, 2)
    : [];
  return { _replyOptions: replies };
};

/**
 * qa_todo_analysis: extract actionable tasks, deduplicate against existing todos.
 * Mirrors original todo_analysis_node with _fuzzy_match dedup.
 */
const qaTodoAnalysisNode: NodeFn = async (state) => {
  await ensureModel();
  const email = state.currentEmail;
  if (!email) return { _todoOptions: [] };

  const body = (email.body_text || email.snippet || "").slice(0, 1000);
  const existingTodos = state.existingTodos || [];

  const existingBlock = existingTodos.length
    ? `\nEXISTING TODOS (do NOT suggest duplicates):\n${existingTodos.slice(-8).map((t) => `- ${t}`).join("\n")}`
    : "";

  const raw = await localInference(
    `Extract concrete tasks FOR THE RECIPIENT from this email. Be generous — most work emails imply at least one task.

WHEN TO ADD A TODO:
- The email asks the recipient to do something that isn't just "send a reply" (review, read, submit, sign, pay, update, prepare, book, follow up, send an attachment, look into X).
- There is a deadline, due date, or "by EOD/Friday/next week".
- The sender mentions something the recipient needs to take ownership of later, even casually ("can you take a look when you get a chance").

WHEN NOT TO ADD A TODO:
- The only action is to reply conversationally (that's covered by reply suggestions).
- Pure notifications, receipts, marketing with no personal ask.

RULES:
- Tasks must be CONCRETE one-sentence actions starting with a verb (e.g. "Submit registration form by Friday", "Review the updated pricing deck").
- Include deadlines when mentioned.
- Maximum 2 tasks, prefer 1 clear task over 2 fuzzy ones.
- Do not duplicate existing todos.${existingBlock}

Output JSON array of task descriptions (no "Todo:" prefix). Return [] only if there is truly nothing actionable for the recipient beyond replying.`,
    `Subject: ${email.subject}\nContent: ${body}`,
    { temperature: 0.2, maxTokens: 128 },
  );

  const options = extractJSON<string[]>(raw, []);
  if (!Array.isArray(options)) return { _todoOptions: [] };

  const todos: string[] = [];
  for (const o of options) {
    const task = String(o).trim();
    if (!task) continue;
    // Fuzzy dedup against existing todos
    const isDup = existingTodos.some((e) => fuzzyMatch(task, e));
    if (!isDup) todos.push(`Todo: ${task}`);
  }
  return { _todoOptions: todos.slice(0, 2) };
};

/**
 * qa_meeting_analysis: detect meeting/scheduling needs.
 * Mirrors original meeting_analysis_node with keyword fast-check.
 */
const qaMeetingAnalysisNode: NodeFn = async (state) => {
  await ensureModel();
  const email = state.currentEmail;
  if (!email) return { _meetingOptions: [] };

  const fullText = `${email.subject} ${email.snippet || ""}`.toLowerCase();
  const meetingSignals = [
    "meeting", "call", "zoom", "teams", "meet", "conference",
    "catch up", "catch-up", "sync", "1-on-1", "schedule",
    "calendar", "availability", "available", "appointment",
    "let's meet", "let's chat", "workshop", "webinar",
  ];

  // Keyword fast-check before LLM (mirrors original optimization)
  if (!meetingSignals.some((sig) => fullText.includes(sig))) {
    return { _meetingOptions: [] };
  }

  const body = (email.body_text || email.snippet || "").slice(0, 800);

  const raw = await localInference(
    `Does this email request a meeting, call, or scheduling?
If yes, describe WHAT to schedule (not when — times are handled separately).
Output JSON array with at most 1 item (no "Schedule:" prefix). Return [] if no meeting needed.
Example: ["meeting with Dr. Smith to discuss proposal"]`,
    `Subject: ${email.subject}\nContent: ${body}`,
    { temperature: 0.15, maxTokens: 96 },
  );

  const options = extractJSON<string[]>(raw, []);
  if (!Array.isArray(options) || !options.length) return { _meetingOptions: [] };

  const desc = String(options[0]).trim();
  return { _meetingOptions: desc ? [`Schedule: ${desc}`] : [] };
};

/**
 * qa_archive_analysis: determine if email is purely FYI.
 * Mirrors original archive_analysis_node.
 */
const qaArchiveAnalysisNode: NodeFn = async (state) => {
  const email = state.currentEmail;
  if (!email) return { _archiveOption: "" };

  const hasAnyActions =
    (state._replyOptions?.length ?? 0) > 0 ||
    (state._todoOptions?.length ?? 0) > 0 ||
    (state._meetingOptions?.length ?? 0) > 0;

  if (hasAnyActions) return { _archiveOption: "" };

  // Newsletter/no-reply → always archive
  if (senderIsNoReply(email.sender) || ["newsletter", "informational"].includes(state.category || "")) {
    return { _archiveOption: "Archive: No action needed" };
  }

  // No actions identified → FYI only
  return { _archiveOption: "Archive: FYI only" };
};

/**
 * qa_merge_actions: combine, deduplicate, and rank all action options.
 * Priority: Reply > Schedule > Todo > Archive.
 * Mirrors original merge_actions_node.
 */
const qaMergeActionsNode: NodeFn = async (state) => {
  const final: QuickAction[] = [];
  const seen = new Set<string>();

  const add = (label: string, action: string) => {
    const key = label.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      final.push({ label, action });
    }
  };

  // Reply options
  for (const r of state._replyOptions || []) {
    add(r, "reply");
  }

  // Schedule options
  for (const m of state._meetingOptions || []) {
    add(m, "schedule_meeting");
  }

  // Todo options
  for (const t of state._todoOptions || []) {
    add(t, "add_todo");
  }

  // Archive (only if nothing else)
  if (state._archiveOption && final.length === 0) {
    add(state._archiveOption, "archive");
  }

  return { quickActions: final.slice(0, 4) };
};

// ── Shared task nodes ─────────────────────────────────────────────────────────

const LOCAL_BRIEFING_CAP = 16;

const BROADCAST_LOCAL_RE =
  /\b(needs your vote|cast your vote|vote for|petition|take our survey)\b/i;

function briefingSummaryFailedLocal(s: string | undefined): boolean {
  if (!s?.trim()) return true;
  return s.toLowerCase().includes("unable to generate briefing");
}

/**
 * briefing: generate a morning briefing from a list of emails (two-step for WebLLM).
 */
const briefingNode: NodeFn = async (state) => {
  await ensureModel();

  const total = state.emails?.length ?? 0;
  if (!total) {
    return {
      briefing: {
        executiveSummary: "No emails to brief on yet. Sync your inbox first.",
        topPriority: [],
        deadlines: [],
        waitingForReply: [],
        stats: { total: 0, critical: 0, deadlines: 0, waitingOnYou: 0, filtered: 0 },
      },
    };
  }

  const emails = state.emails ?? [];
  const capped = emails.slice(0, LOCAL_BRIEFING_CAP);
  const todayDate = new Date().toISOString().split("T")[0];

  const ndjson = capped
    .map((e) =>
      JSON.stringify({
        email_id: e.id ?? "",
        subject: e.subject ?? "",
        sender: e.sender ?? "",
        snippet: (e.snippet || e.body_text || "").slice(0, 400),
      })
    )
    .join("\n");

  const rawCards = await localInference(
    `Today's date is ${todayDate}. You classify a small batch of inbox lines for a briefing. Input is NDJSON: one JSON object per line with email_id, subject, sender, snippet.

Return ONLY valid JSON: {"cards":[...]} with the same number of cards as input lines (in the same order). Each card: email_id (echo from input), bucket (crucial|replyNeeded|deadlines|nonEssential), subject, senderName (short display name from From), sender, summary (1-2 sentences from snippet), signal (one short clause), evidence (short phrase from snippet or subject), relationshipHint (first-party|known-contact|stranger|auto), suggestedAction (reply|todo|meeting|archive|ignore), urgency (critical|high|medium), deadline (null or YYYY-MM-DD), waitingForReply (boolean), tags (string array).

Mass voting, petitions, or generic campus surveys without a personal obligation: bucket nonEssential, suggestedAction archive, urgency medium, waitingForReply false.

no-reply or bulk senders: nonEssential, relationshipHint auto.`,
    ndjson,
    { temperature: 0.25, maxTokens: 2200 },
  );

  const parsedCards = extractJSON<{ cards?: BriefingEmail[] & Record<string, unknown>[] }>(
    rawCards,
    {},
  );
  const rawList = Array.isArray(parsedCards.cards) ? parsedCards.cards : [];

  type Bucket = "crucial" | "replyNeeded" | "deadlines" | "nonEssential";
  const buckets: Record<Bucket, BriefingEmail[]> = {
    crucial: [],
    replyNeeded: [],
    deadlines: [],
    nonEssential: [],
  };

  const normBucket = (b: unknown): Bucket => {
    const s = String(b ?? "").toLowerCase().replace(/\s+/g, "");
    if (s === "replyneeded") return "replyNeeded";
    if (s === "nonessential") return "nonEssential";
    if (s === "deadlines" || s === "crucial") return s;
    return "crucial";
  };

  const attachIds = (card: BriefingEmail): BriefingEmail => {
    const id = card.email_id;
    if (id) return card;
    const key = (card.subject ?? "").toLowerCase();
    const match = capped.find((e) => {
      const s = (e.subject ?? "").toLowerCase();
      return s === key || s.includes(key) || key.includes(s);
    });
    return match?.id ? { ...card, email_id: match.id } : card;
  };

  for (const row of rawList) {
    const c = row as Record<string, unknown>;
    const card: BriefingEmail = {
      subject: String(c.subject ?? ""),
      senderName: String(c.senderName ?? c.sender ?? ""),
      sender: String(c.sender ?? ""),
      summary: String(c.summary ?? c.snippet ?? ""),
      urgency:
        c.urgency === "critical" || c.urgency === "high" ? c.urgency : "medium",
      deadline: (c.deadline as string) || null,
      waitingForReply: Boolean(c.waitingForReply),
      tags: Array.isArray(c.tags) ? (c.tags as string[]) : [],
      email_id: String(c.email_id ?? ""),
      signal: c.signal as string | undefined,
      evidence: c.evidence as string | undefined,
      relationshipHint: c.relationshipHint as string | undefined,
      suggestedAction: c.suggestedAction as string | undefined,
    };
    const fixed = attachIds(card);
    const blob = `${fixed.subject} ${fixed.summary}`;
    if (BROADCAST_LOCAL_RE.test(blob)) {
      fixed.waitingForReply = false;
      fixed.urgency = "medium";
      fixed.suggestedAction = "archive";
      buckets.nonEssential.push(fixed);
      continue;
    }
    buckets[normBucket(c.bucket)].push(fixed);
  }

  const seen = new Set(
    [...buckets.crucial, ...buckets.replyNeeded, ...buckets.deadlines, ...buckets.nonEssential]
      .map((e) => e.email_id)
      .filter(Boolean),
  );
  const seenSubjectSender = new Set(
    [...buckets.crucial, ...buckets.replyNeeded, ...buckets.deadlines, ...buckets.nonEssential].map(
      (e) => `${(e.subject ?? "").toLowerCase()}|${(e.sender ?? "").toLowerCase()}`,
    ),
  );
  for (const e of capped) {
    if (e.id) {
      if (seen.has(e.id)) continue;
    } else if (
      seenSubjectSender.has(
        `${(e.subject ?? "").toLowerCase()}|${(e.sender ?? "").toLowerCase()}`,
      )
    ) {
      continue;
    }
    const fallback: BriefingEmail = {
      subject: e.subject,
      senderName: e.sender.split("<")[0]?.trim() || e.sender,
      sender: e.sender,
      summary: e.snippet || e.body_text || "",
      urgency: "medium",
      deadline: null,
      waitingForReply: false,
      tags: [],
      email_id: e.id,
      signal: "Not classified by local model.",
      suggestedAction: "todo",
    };
    buckets.nonEssential.push(fallback);
    if (e.id) seen.add(e.id);
    seenSubjectSender.add(
      `${(e.subject ?? "").toLowerCase()}|${(e.sender ?? "").toLowerCase()}`,
    );
  }

  let crucial = buckets.crucial;
  let replyNeeded = buckets.replyNeeded;
  let deadlines = buckets.deadlines;
  let nonEssential = buckets.nonEssential;

  const waitingInCrucial = crucial.filter((e) => e.waitingForReply);
  if (waitingInCrucial.length > 0) {
    replyNeeded = [...replyNeeded, ...waitingInCrucial];
    crucial = crucial.filter((e) => !e.waitingForReply);
  }
  const deadlineInCrucial = crucial.filter((e) => e.deadline);
  if (deadlineInCrucial.length > 0) {
    deadlines = [...deadlines, ...deadlineInCrucial];
    crucial = crucial.filter((e) => !e.deadline);
  }

  const digest = [
    `Buckets: crucial=${crucial.length}, replyNeeded=${replyNeeded.length}, deadlines=${deadlines.length}, nonEssential=${nonEssential.length}.`,
    ...replyNeeded.slice(0, 6).map((e) => `[reply] ${e.subject} (${e.sender})`),
    ...crucial.slice(0, 5).map((e) => `[crucial] ${e.subject} (${e.sender})`),
    ...deadlines.slice(0, 4).map((e) => `[due] ${e.subject}`),
  ].join("\n");

  const rawExec = await localInference(
    `Today's date is ${todayDate}. Write the executive summary for this email digest. Rules: 3-5 sentences, plain prose only, no JSON, no markdown fences. Name specific senders and topics from the digest. Do not count emails with digits (no "5 emails").`,
    digest,
    { temperature: 0.35, maxTokens: 600 },
  );

  const rawExecTrim = typeof rawExec === "string" ? rawExec.trim() : "";
  let executiveSummary = "";
  if (rawExecTrim.startsWith("{")) {
    executiveSummary =
      extractJSON<{ executiveSummary?: string }>(rawExecTrim, {})
        .executiveSummary ?? "";
  }
  if (!executiveSummary?.trim()) {
    executiveSummary = rawExecTrim.slice(0, 2000);
  }
  if (briefingSummaryFailedLocal(executiveSummary)) {
    executiveSummary =
      "Your local briefing is ready; check Reply needed and Crucial for what to handle first.";
  }

  const statsTotal =
    crucial.length + replyNeeded.length + deadlines.length + nonEssential.length;

  return {
    briefing: {
      executiveSummary: executiveSummary ?? "",
      crucial,
      replyNeeded,
      deadlines,
      nonEssential,
      stats: {
        total: Math.max(total, statsTotal),
        crucial: crucial.length,
        replyNeeded: replyNeeded.length,
        deadlines: deadlines.length,
        nonEssential: nonEssential.length,
      },
    },
  };
};

/**
 * analyze_style: extract writing style profile from sent emails corpus.
 * Used on first sign-in for local/hybrid mode to learn user's tone and patterns.
 */
const analyzeStyleNode: NodeFn = async (state) => {
  await ensureModel();

  const emails = state.emails;
  if (!emails?.length || emails.length < 3) {
    return { error: "Need at least 3 sent emails to analyze style" };
  }

  const emailsText = emails
    .slice(0, 15)
    .map((e) => `Subject: ${e.subject}\n${e.snippet || e.body_text || ""}`)
    .join("\n---\n");

  const raw = await localInference(
    `Analyze these sent emails and extract the user's writing style. Return ONLY valid JSON:
{
  "greeting_style": "<e.g. Hi, Hello, Hey, Dear Name>",
  "closing_style": "<e.g. Best, Thanks, Regards, Cheers>",
  "tone": "formal|casual|mixed",
  "avg_length": "short|medium|long"
}
Base greeting/closing on patterns you observe. If unclear, use sensible defaults.`,
    emailsText,
    { temperature: 0.2, maxTokens: 128 },
  );

  const parsed = extractJSON<{
    greeting_style?: string;
    closing_style?: string;
    tone?: string;
    avg_length?: string;
  }>(raw, {});

  return {
    styleProfile: {
      greeting_style: parsed.greeting_style || "Hi",
      closing_style: parsed.closing_style || "Best",
      tone: parsed.tone || "mixed",
      avg_length: parsed.avg_length || "medium",
      sample_count: emails.length,
    },
  };
};

/**
 * todos: extract actionable task suggestions from a list of emails.
 * Uses fuzzy dedup against existingTodos.
 */
const todosNode: NodeFn = async (state) => {
  await ensureModel();

  if (!state.emails?.length) return { todoSuggestions: [] };

  const emailsText = state.emails
    .slice(0, 12)
    .map((e) => `Subject: ${e.subject}\nFrom: ${e.sender}\n${e.snippet || ""}`)
    .join("\n---\n");

  const existingTodos = state.existingTodos || [];
  const existingBlock = existingTodos.length
    ? `\nEXISTING TODOS (do NOT duplicate):\n${existingTodos.slice(-8).map((t) => `- ${t}`).join("\n")}`
    : "";

  const raw = await localInference(
    `Extract actionable tasks from these emails. Return JSON array only:
[{"task": "<specific action to take>", "source": "<email subject, max 40 chars>"}]
Only include tasks that genuinely require action. Return [] if nothing actionable.${existingBlock}`,
    emailsText,
    { temperature: 0.3, maxTokens: 512 },
  );

  const suggestions = extractJSON<TodoSuggestion[]>(raw, []);
  if (!Array.isArray(suggestions)) return { todoSuggestions: [] };

  // Fuzzy dedup
  const deduped = suggestions.filter((s) => {
    const task = (s.task || "").trim();
    return task && !existingTodos.some((e) => fuzzyMatch(task, e));
  });

  return { todoSuggestions: deduped.slice(0, 6) };
};

/**
 * meetings: identify emails requesting a meeting, call, or scheduling.
 */
const meetingsNode: NodeFn = async (state) => {
  await ensureModel();

  if (!state.emails?.length) return { meetingSuggestions: [] };

  const emailsText = state.emails
    .slice(0, 12)
    .map((e) =>
      `Subject: ${e.subject}\nFrom: ${e.sender} <${e.sender_email || ""}>\n${e.snippet || ""}`,
    )
    .join("\n---\n");

  const whNote = state.workingHours
    ? `\nUser's working hours: ${state.workingHours.start || "09:00"} to ${state.workingHours.end || "17:00"}, weekdays ${(state.workingHours.days || [1,2,3,4,5]).join(",")}. Suggest times within these hours.`
    : "";

  const raw = await localInference(
    `Identify emails requesting a meeting, call, or scheduling. Return JSON array only:
[{"title": "<meeting title>", "attendees": ["<email>"], "suggestedTime": "<specific date/time within working hours if inferable, else omit>", "source": "<email subject>"}]
Only include emails that explicitly ask to meet/call/schedule. Return [] if none found.${whNote}`,
    emailsText,
    { temperature: 0.2, maxTokens: 512 },
  );

  const suggestions = extractJSON<MeetingSuggestion[]>(raw, []);
  return { meetingSuggestions: Array.isArray(suggestions) ? suggestions.slice(0, 5) : [] };
};

/**
 * draft: generate an email from intent + context.
 */
const draftNode: NodeFn = async (state) => {
  await ensureModel();

  const ctx = state.draftContext;
  const intent = state.draftIntent || "";
  const subject = ctx?.subject || "";

  // Parse friendly recipient name from "Name <email>" or bare email
  const toRaw = (ctx?.to || "").split(",")[0].trim();
  const angleMatch = toRaw.match(/^(.*?)<[^>]+>\s*$/);
  const parsedName = angleMatch ? angleMatch[1].trim().replace(/^"|"$/g, "").trim() : "";
  const to = parsedName || toRaw || "the recipient";

  let userContent: string;
  if (ctx?.replyTo) {
    userContent = [
      `Original email subject: "${ctx.replyTo.subject}"`,
      `Original email content:`,
      ctx.replyTo.body.slice(0, 600),
      ``,
      `Reply to: ${to}`,
      intent ? `What to say in reply: ${intent}` : `Write a professional reply.`,
    ].join("\n");
  } else {
    userContent = [
      `Write an email to: ${to}`,
      subject ? `Topic: ${subject}` : "",
      intent ? `Message content: ${intent}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const senderName = ctx?.senderName || "";
  const closingLine = senderName ? `Best regards,\n${senderName}` : "Best regards,";

  // Fetch user's style profile and relevant knowledge entries for personalization
  let styleBlock = "";
  let knowledgeBlock = "";
  if (state.userId) {
    try {
      const supabase = createClient();
      const [styleRes, knowledgeRes] = await Promise.all([
        supabase.from("style_profiles").select("greeting_style, closing_style, tone, avg_length").eq("user_id", state.userId).maybeSingle(),
        supabase.from("knowledge_base").select("entity, entity_type, info").eq("user_id", state.userId).order("use_count", { ascending: false }).limit(10),
      ]);
      if (styleRes.data) {
        const s = styleRes.data as any;
        styleBlock = `\n[WRITING STYLE]\nGreeting: ${s.greeting_style || "professional"} | Closing: ${s.closing_style || "Best regards"} | Tone: ${s.tone || "professional"} | Length: ${s.avg_length || "concise"}`;
      }
      if (knowledgeRes.data?.length) {
        const entries = (knowledgeRes.data as any[]).map((e) => `- ${e.entity} (${e.entity_type}): ${e.info}`).join("\n");
        knowledgeBlock = `\n[CONTEXT ABOUT USER'S WORLD]\n${entries}`;
      }
    } catch { /* non-critical: proceed without personalization */ }
  }

  const raw = await localInference(
    `You are a writing assistant composing an email FOR the user (the sender). Follow every rule:
1. Write ONLY the email body text. NEVER write "Subject:" anywhere in the output.
2. You are writing FROM the user TO the recipient. Start with a greeting addressed to the RECIPIENT, not the user.
3. Use first person (I, my, we) — you are the sender.
4. NEVER use placeholder text like [Your Name], [Your Email], [Company], [Position], [Contact Information], [Signature]. End the email with exactly: "${closingLine}" — nothing after it.
5. Be concise: 2-4 short paragraphs maximum. Stay focused on the topic.
6. Write the actual content — do not refer to the email or instructions in the output.${styleBlock}${knowledgeBlock}`,
    userContent,
    { temperature: 0.5, maxTokens: 512 },
  );

  // Post-process: strip any subject line or placeholder that leaked in
  const cleaned = raw
    .trim()
    .replace(/^Subject\s*:[^\n]*\n*/im, "")
    .replace(/\[Your [^\]]+\]/gi, "")
    .replace(/\[Contact[^\]]+\]/gi, "")
    .replace(/\[Company[^\]]+\]/gi, "")
    .replace(/\[Position[^\]]+\]/gi, "")
    .replace(/\[Signature[^\]]+\]/gi, "")
    .trim();

  return { draft: cleaned };
};

// ── Graph Assemblies ──────────────────────────────────────────────────────────

/**
 * Quick-actions subgraph.
 * Mirrors original quick_actions_graph.py structure exactly.
 *
 * gather_context → reply_analysis → todo_analysis →
 *   meeting_analysis → archive_analysis → merge_actions → END
 */
function buildQuickActionsGraph(): CompiledGraph {
  const graph = new StateGraph();

  graph
    .addNode("qa_gather_context", qaGatherContextNode)
    .addNode("qa_reply_analysis", qaReplyAnalysisNode)
    .addNode("qa_todo_analysis", qaTodoAnalysisNode)
    .addNode("qa_meeting_analysis", qaMeetingAnalysisNode)
    .addNode("qa_archive_analysis", qaArchiveAnalysisNode)
    .addNode("qa_merge_actions", qaMergeActionsNode);

  graph.setEntryPoint("qa_gather_context");
  graph.addEdge("qa_gather_context", "qa_reply_analysis");
  graph.addEdge("qa_reply_analysis", "qa_todo_analysis");
  graph.addEdge("qa_todo_analysis", "qa_meeting_analysis");
  graph.addEdge("qa_meeting_analysis", "qa_archive_analysis");
  graph.addEdge("qa_archive_analysis", "qa_merge_actions");
  graph.addEdge("qa_merge_actions", "__end__");

  return graph.compile();
}

export const quickActionsGraph = buildQuickActionsGraph();

/**
 * knowledge_extract: extract named entities (people, companies, projects) from
 * an email for local-mode knowledge base. Only runs after extract_actions.
 */
const knowledgeExtractNode: NodeFn = async (state) => {
  await ensureModel();
  const email = state.currentEmail;
  if (!email) return { knowledgeEntities: [] };

  const body = (email.body_text || email.snippet || "").slice(0, 1200);
  const raw = await localInference(
    `Extract key named entities from this email for a personal knowledge base.
Return a JSON array of objects with fields: entity (string), entity_type ("person"|"company"|"project"|"topic"), info (one concise sentence), confidence (0.0-1.0).
Only extract entities useful to remember for future context. Return [] if nothing noteworthy.
JSON only, no other text.`,
    `EMAIL SUBJECT: ${email.subject || ""}\nFROM: ${email.sender || ""}\nBODY: ${body}`,
    { temperature: 0.1, maxTokens: 300 },
  );

  type RawEntity = { entity?: unknown; entity_type?: unknown; info?: unknown; confidence?: unknown };
  const parsed = extractJSON<RawEntity[]>(raw, []);
  const entities = Array.isArray(parsed)
    ? parsed.filter((e): e is { entity: string; entity_type: string; info: string; confidence: number } =>
        typeof e.entity === "string" && typeof e.info === "string",
      ).map((e) => ({
        entity: e.entity,
        entity_type: typeof e.entity_type === "string" ? e.entity_type : "topic",
        info: e.info,
        confidence: typeof e.confidence === "number" ? e.confidence : 0.7,
      }))
    : [];

  return { knowledgeEntities: entities };
};

/**
 * Main email processing graph.
 */
function buildEmailGraph(): CompiledGraph {
  const graph = new StateGraph();

  graph
    .addNode("router", routerNode)
    .addNode("categorize", categorizeNode)
    .addNode("summarize", summarizeNode)
    .addNode("extract_actions", extractActionsNode)
    .addNode("knowledge_extract", knowledgeExtractNode)
    .addNode("briefing", briefingNode)
    .addNode("todos", todosNode)
    .addNode("meetings", meetingsNode)
    .addNode("draft", draftNode)
    .addNode("analyze_style", analyzeStyleNode)
    // auto_reply delegates to the quick-actions subgraph inline
    .addNode("auto_reply", async (state) => {
      // Run quick-actions subgraph to get reply options
      const qaResult = await quickActionsGraph.invoke(state);
      // If there's an explicit reply instruction, run draft instead
      if (state.instructions || state.tone) {
        const draftResult = await draftNode({
          ...state,
          draftContext: {
            to: state.currentEmail?.sender_email || state.currentEmail?.sender || "",
            subject: /^Re:/i.test(state.currentEmail?.subject || "") ? (state.currentEmail?.subject || "") : `Re: ${state.currentEmail?.subject || ""}`,
            replyTo: {
              subject: state.currentEmail?.subject || "",
              body: state.currentEmail?.body_text || state.currentEmail?.snippet || "",
            },
          },
          draftIntent: [
            state.tone ? `[Tone: ${state.tone}]` : "",
            state.instructions || "",
          ]
            .filter(Boolean)
            .join(" "),
        });
        return { ...qaResult, draft: draftResult.draft };
      }
      return qaResult;
    });

  graph.setEntryPoint("router");

  // ── Router dispatch ──────────────────────────────────────────────────────────
  graph.addConditionalEdges(
    "router",
    (state) => state.task,
    {
      categorize: "categorize",
      process_email: "categorize",
      rethink: "categorize",
      brief: "briefing",
      todos: "todos",
      meetings: "meetings",
      draft: "draft",
      auto_reply: "auto_reply",
      analyze_style: "analyze_style",
    },
  );

  // ── After categorize: deep-analyze important/action-required only ────────────
  // This is the conditional branching that makes the graph non-linear:
  // newsletter/informational → done immediately
  // important/action-required OR rethink/process_email → full analysis
  graph.addConditionalEdges(
    "categorize",
    (state) => {
      const needsDeep = ["important", "action-required"].includes(state.category || "");
      const forceDeep = state.task === "rethink" || state.task === "process_email";
      return needsDeep || forceDeep ? "deep" : "skip";
    },
    {
      deep: "summarize",
      skip: "__end__",
    },
  );

  graph.addEdge("summarize", "extract_actions");
  graph.addEdge("extract_actions", "knowledge_extract");
  graph.addEdge("knowledge_extract", "__end__");

  graph.addEdge("briefing", "__end__");
  graph.addEdge("todos", "__end__");
  graph.addEdge("meetings", "__end__");
  graph.addEdge("draft", "__end__");
  graph.addEdge("auto_reply", "__end__");
  graph.addEdge("analyze_style", "__end__");

  return graph.compile();
}

// ── Singletons ────────────────────────────────────────────────────────────────

/**
 * The compiled email processing graph.
 *
 * @example
 * // Categorize + full analysis of a single email
 * const result = await emailGraph.invoke({
 *   task: "process_email",
 *   currentEmail: { subject: "...", sender: "...", snippet: "..." },
 * });
 * // result.category, result.summary, result.quickActions
 *
 * @example
 * // Generate morning briefing
 * const result = await emailGraph.invoke({
 *   task: "brief",
 *   emails: [...],
 * });
 * // result.briefing.summary, result.briefing.actionItems
 *
 * @example
 * // Get quick actions for an email (reply/todo/meeting/archive)
 * const result = await quickActionsGraph.invoke({
 *   task: "auto_reply",
 *   currentEmail: { subject: "...", sender: "...", snippet: "..." },
 * });
 * // result.quickActions = [{ label: "Reply: Accept", action: "reply" }, ...]
 */
export const emailGraph = buildEmailGraph();
