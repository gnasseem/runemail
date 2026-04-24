/**
 * AI helpers — primary provider is OpenRouter (MiniMax M2.5 by default).
 * Cerebras code is kept for reference but is inactive unless explicitly re-enabled
 * by setting AI_PROVIDER=cerebras in the edge function environment.
 *
 * OpenRouter privacy: requests set `provider.data_collection: "deny"` so OpenRouter
 * only routes to upstream providers that do NOT log or train on user data. The API
 * key lives in a Supabase secret (OPENROUTER_API_KEY) and is never returned to the
 * client. No user PII is sent in headers; only a project identifier for billing.
 */

function getEnv(key: string): string {
  return (
    (
      Deno as unknown as { env: { get(k: string): string | undefined } }
    ).env.get(key) ?? ""
  );
}

// Active provider. Default: openrouter. Set AI_PROVIDER=cerebras to revert.
const AI_PROVIDER = (getEnv("AI_PROVIDER") || "openrouter").toLowerCase();
const OPENROUTER_DEFAULT_MODEL = "minimax/minimax-m2.5";
const CEREBRAS_DEFAULT_MODEL = "qwen-3-235b-a22b-instruct-2507";

// Shared privacy/app headers for OpenRouter. Do NOT put any user identifiers here.
const OPENROUTER_HEADERS = {
  "HTTP-Referer": "https://runemail.app",
  "X-Title": "RuneMail",
} as const;

// OpenRouter provider preferences: deny any provider that logs or trains on data.
const OPENROUTER_PROVIDER_PREFS = {
  data_collection: "deny" as const,
  allow_fallbacks: true,
};

function activeApiKey(): string {
  if (AI_PROVIDER === "cerebras") return getEnv("CEREBRAS_API_KEY");
  return getEnv("OPENROUTER_API_KEY") || getEnv("CEREBRAS_API_KEY");
}

function activeModel(): string {
  if (AI_PROVIDER === "cerebras") {
    return getEnv("CEREBRAS_MODEL") || CEREBRAS_DEFAULT_MODEL;
  }
  return getEnv("OPENROUTER_MODEL") || OPENROUTER_DEFAULT_MODEL;
}

function activeEndpoint(): string {
  if (AI_PROVIDER === "cerebras")
    return "https://api.cerebras.ai/v1/chat/completions";
  return "https://openrouter.ai/api/v1/chat/completions";
}

function activeExtraHeaders(): Record<string, string> {
  if (AI_PROVIDER === "cerebras") return {};
  return { ...OPENROUTER_HEADERS };
}

function activeExtraBody(): Record<string, unknown> {
  if (AI_PROVIDER === "cerebras") return {};
  return { provider: OPENROUTER_PROVIDER_PREFS };
}

const PROMPTS = {
  categorize: `You are an expert email categorizer. Classify the email into exactly one category.

STEP 1 — HIGH-STAKES CHECK (run this before anything else):
If this email concerns any of these life-event domains, it is NEVER "informational" or "newsletter":
- Career: job offer, offer letter, interview invitation, application update (hired/shortlisted/rejected/next steps/offer extended), onboarding, background check, recruiter asking for a reply, contract to sign
- Academic: admission/acceptance/rejection, financial aid, scholarship offer, enrollment deadline
- Legal: contract, agreement, legal notice, court filing, settlement, lease, terms requiring signature
- Medical: appointment confirmation/change, lab or test results, prescription, diagnosis, referral
- Financial decision: mortgage/loan approval or denial, credit application, account suspended, fraud alert requiring action
ATS or HR system emails (Greenhouse, Workday, Lever, Taleo, SmartRecruiters, iCIMS, Jobvite, Breezy, BambooHR) about a job or interview are NOT informational.
If STEP 1 triggers: use action-required when the email expects a reply/action from you; use important when it is status-only FYI.

STEP 2 — STANDARD PRIORITY ORDER (first rule that fits wins):

1. action-required
   The sender is a real human (or a human acting on behalf of an org) and is waiting on YOU to do something concrete with a clear "finish line": reply with an answer, approve, sign, pay, schedule, RSVP, review a doc, submit a form. If a human asked you a direct question, it is action-required.

2. important
   A real human wrote to you and the message is genuinely worth reading, but no response/action is required right now. Examples: status update from a colleague, personal note from a friend, intro/announcement from a known contact, meeting notes you were CC'd on, FYI from your boss. Do NOT use "important" as a safe default; only use it for person-to-person mail that matters.

3. newsletter
   Bulk content a mailing list delivers to many recipients: digests, promotional campaigns, brand announcements, product newsletters, weekly round-ups, sales. If the writing pattern is marketing/editorial and the same email went to many people, it is newsletter, even from a company you like.

4. informational
   Automated, transactional, or system-generated messages that are not marketing. Receipts, order confirmations, shipping updates, bank/card alerts, security alerts, password resets, calendar reminders, billing statements, service status pings, app notifications, no-reply automation.

Tie-breakers:
- An unsubscribe link alone does not make something a newsletter: transactional emails often include one. Judge by content.
- A direct question from a real person always beats "important" or "informational".
- Balance matters: do NOT default to "important" for anything unclear. When unsure between important and informational, prefer informational for automated content and important only for human-to-human messages.

Respond with ONLY the category slug, nothing else.`,
  summarize:
    "Summarize the following email clearly and concisely. Capture the key point, any action required, and relevant context. Write 1-3 sentences as needed — use more if the email is complex or has multiple important points.",
  quick_actions:
    'Look at this email and suggest 1-3 actions that would actually help the user clear it. Most real emails from people have at least one action (reply or todo). Return a JSON array of objects with "label" (descriptive phrase up to 10 words — for add_todo, include specific context like topic, name, chapter, deadline so the task is self-explanatory without re-reading the email; e.g. "Review French lesson chapter 2 audio files" or "Reply to Sarah about Q3 budget proposal"), "action" (one of: "reply", "add_todo", "schedule_meeting"), and optionally "text" (the reply body, only for reply/schedule_meeting). Rules: include a reply action whenever a human asked a question or expects a response; include an add_todo whenever the email implies a task to track; include schedule_meeting only when the email proposes a meeting or asks about availability. IMPORTANT: emails about jobs, interviews, medical appointments, legal matters, academic admissions, or financial decisions ALWAYS get at least one action even if the sender looks automated. Return [] only if the email is a newsletter, shipping receipt, marketing blast, or automated notification with absolutely no personal ask from the user. Example: [{"label":"Sounds good, happy to help","action":"reply","text":"Sounds good, thanks!"},{"label":"Follow up with John about contract renewal","action":"add_todo"}]',
  process_email: `You are an email assistant. Analyze this email and return ONLY valid JSON with no markdown:
{"reasoning":"...","category":"...","urgency":"...","summary":"...","actions":[...]}

STEP 1 — HIGH-STAKES CHECK (run before picking a category):
If this email concerns any of these life-event domains, it is NEVER "informational" or "newsletter":
- Career: job offer, offer letter, interview invitation, application update (hired/shortlisted/rejected/next steps/offer extended), onboarding, background check, recruiter asking for a response, contract to sign
- Academic: admission/acceptance/rejection, financial aid, scholarship offer, enrollment deadline
- Legal: contract, agreement, legal notice, court filing, settlement, lease, terms requiring signature
- Medical: appointment confirmation/change, lab or test results, prescription, diagnosis, referral
- Financial decision: mortgage/loan approval or denial, credit application, account suspended, fraud alert requiring action
ATS or HR system senders (Greenhouse, Workday, Lever, Taleo, SmartRecruiters, iCIMS, Jobvite, Breezy, BambooHR) writing about a job or interview are NOT informational.
If STEP 1 triggers: action-required when a reply/action is expected; important when status-only FYI.

CATEGORIES (pick exactly one; STEP 1 overrides if triggered):
1. action-required: a real person is waiting on YOU to do something concrete with a clear finish line — reply with an answer, approve, sign, pay, schedule, RSVP, review, submit. Any direct question from a human belongs here.
2. important: a real person wrote to you and it is worth reading, but no response is required right now. Status updates from colleagues, personal notes, FYIs from known contacts, meeting notes. Do not use as a safe default.
3. newsletter: bulk content sent to a mailing list — digests, promotional campaigns, product newsletters, weekly round-ups. Marketing tone + broadcast to many recipients = newsletter.
4. informational: automated, transactional, or system-generated messages that are not marketing. Receipts, shipping/order updates, bank/card alerts, security alerts, password resets, calendar reminders, billing statements, service pings.

Tie-breakers: an unsubscribe link alone does not make something a newsletter (transactional mail has them too). A direct human question beats important and informational. When unsure between important and informational, prefer informational for automated content; only use important for human-to-human mail that matters.

URGENCY (required field, pick exactly one):
- critical: must act today (offer/deadline expires today, interview is tomorrow, active security breach)
- high: time-sensitive within 1-3 days (job offer with deadline, interview request, legal notice, overdue payment, medical appointment soon, admission/scholarship deadline)
- medium: reply or action helpful but not immediately urgent
- low: purely informational, no action needed, no deadline, nothing personal

reasoning: ONE sentence — name the sender type, what they want, why you chose this category and urgency. Internal chain-of-thought only; not shown to the user.

summary: clear, concise summary of what the email is about and what (if anything) is needed. Use 1-3 sentences.

actions: Suggest the actions that would actually help the user clear this email. Aim for 1-3 when urgency is medium or above OR when email is action-required/important. Return [] ONLY when urgency is low AND category is newsletter or informational with no personal ask.
Rules for picking actions:
- If a human asked a question or requested something, include a "reply" action with draft text.
- If the email implies a task the user should track (read doc, prepare something, follow up later, pay invoice, submit form), include an "add_todo" action.
- If the email proposes a meeting/call, asks about availability, or needs rescheduling, include a "schedule_meeting" action.
- High-stakes emails (career/medical/legal/academic/financial) always get at least one action even if the sender looks automated.
- Do not duplicate: one "reply" + one "add_todo" at most for the same intent.
- Be concrete: todo labels must be self-explanatory without re-reading the email (mention topic, sender, chapter, deadline).

Each action MUST be an object:
  {"label": "short descriptive phrase", "action": "reply"|"add_todo"|"schedule_meeting", "text": "optional content for reply or meeting"}
Examples:
  {"label": "Reply to John about budget", "action": "reply", "text": "Hi John, thanks for the update. I will review and get back to you."}
  {"label": "Review Q3 budget proposal from Sarah by Friday", "action": "add_todo"}
  {"label": "Schedule kickoff call with team", "action": "schedule_meeting", "text": "30-min project kickoff"}
Return raw JSON only. No explanation, no markdown.`,
  draft:
    "You are an email drafting assistant. Write a professional, clear reply to the email below. Match the tone of the original. Keep it concise.",
  briefing:
    'You are an executive email intelligence system. Analyze ALL emails below and return ONLY valid JSON with this exact structure: {"executiveSummary":"detailed summary, see rules","crucial":[{"subject":"...","senderName":"...","sender":"...","summary":"what this specific email is about, what it asks, and any key detail (amount, name, date, deadline) in 1-2 sentences","signal":"one clause: what the sender actually wants from the user","evidence":"the 1-2 literal phrases from the email that justify the classification","relationshipHint":"first-party|known-contact|stranger|auto","suggestedAction":"reply|todo|meeting|archive|ignore","urgency":"critical|high|medium","deadline":null,"waitingForReply":false,"tags":[]}],"replyNeeded":[/* same fields */],"deadlines":[/* same fields, set deadline to YYYY-MM-DD */],"nonEssential":[/* same fields */],"stats":{"total":N,"crucial":N,"replyNeeded":N,"deadlines":N,"nonEssential":N}}.\n\nEXECUTIVE SUMMARY RULES: 4-6 sentences walking through what actually happened in the inbox. Name specific senders, specific topics, specific amounts/dates where present. Do NOT cluster into vague themes ("several project updates"); list concrete items one after another. FORBIDDEN: never mention any email count number in the executive summary (no "40 emails", no "several", no "five messages"). The UI shows counts separately; your job is to narrate content, not tally. Example: "Bob pinged you about the Q3 budget review due Friday. Sarah shared revised design mocks and is waiting on your feedback. Stripe flagged a failed payment of $249. LinkedIn and a marketing digest were the only filler. Two meeting invites need RSVP (kickoff Thu 10am, review Fri 2pm)."\n\nPER-EMAIL ENRICHMENT RULES (hard contract — downstream agent relies on these):\n- signal: ONE short clause describing what the sender wants from the user. Examples: "confirm receipt of API key", "RSVP to kickoff Thu 10am", "review Q3 budget doc", "no action, informational FYI", "promotional, no action".\n- evidence: copy 1-2 short phrases (under ~90 chars total) verbatim from the email that justify your classification. Never paraphrase, never fabricate. If nothing concrete stands out, use the subject line.\n- relationshipHint: "first-party" if the sender looks like the user themselves (self-email), "known-contact" for real named humans, "stranger" for unknown humans/cold outreach, "auto" for no-reply/notifications/bulk senders.\n- suggestedAction: the SINGLE most sensible next move. Rules: senders with no-reply@/notifications@/donotreply@ or relationshipHint=auto MUST use "archive" or "ignore" — NEVER "todo", NEVER "reply". "ignore" means truly no action (pure FYI bulk). Use "todo" only for a concrete task the user must track (pay invoice, read doc, prepare slides); otherwise prefer "reply", "meeting", or "archive".\n\nCLASSIFICATION RULES — assign each email to exactly ONE category using this strict priority. The first rule that fits wins:\n(1) replyNeeded: a real human is explicitly waiting on a response from the user. Direct questions, requested input, open conversational threads. If someone asked something that expects an answer, it goes here even if there is also a deadline (surface the deadline as a tag like "DUE 2026-04-25" in the deadline field, but the card lives in replyNeeded).\n(2) deadlines: the email carries a concrete future date/time by which the user must complete an action, and no reply is expected. Pay by X, submit by Y, RSVP by Z, expires on W. Set the deadline field to YYYY-MM-DD.\n(3) crucial: high-impact or time-sensitive FYI that needs user attention but is neither a reply request nor a dated action item. Financial holds, account/security alerts, significant updates from named individuals, urgent personal matters, important announcements. Real-human updates worth reading live here.\n(4) nonEssential: ONLY newsletters, promotional emails, automated marketing, shipping/order receipts, no-reply senders, social digests, system notifications without user action. An email from a real named person is almost never nonEssential. Any sender matching /no.?reply|noreply|notifications?|donotreply|mailer-daemon/ IS nonEssential.\n\nINBOX REALITY: Real inboxes mix valuable threads with shipping pings, digests, receipts, and cold outreach. Do NOT upgrade vague or low-signal mail to replyNeeded or crucial just because it arrived. Use nonEssential for bulk, automated, or mail where no real person expects a personal reply. Use suggestedAction ignore when nothing matters. Cold outreach belongs in crucial only when it has a concrete time-sensitive ask; otherwise prefer nonEssential or crucial as FYI with suggestedAction archive or ignore.\n\nEvery input email must appear in exactly one array. Do not skip any email. If unsure between crucial and nonEssential, choose crucial. If unsure between replyNeeded and deadlines, choose replyNeeded. Stats must satisfy: crucial + replyNeeded + deadlines + nonEssential = total (= number of input emails).',
  briefing_batch_cards: `You refine a capped batch of inbox rows for RuneMail. Input is NDJSON: one JSON object per line. Each line has email_id, subject, sender, category (from prior classifier), urgency (stored urgency: critical|high|medium|low, may be null), summary (may be truncated).

Return ONLY valid JSON: {"cards":[...]} with one object per input line you could judge (same count as input lines). Each card MUST include email_id (exactly as given).

Each card fields: email_id, bucket (one of crucial|replyNeeded|deadlines|nonEssential), subject, senderName, sender, summary (1-2 sentences), signal (one short clause: what the sender wants), evidence (under 90 chars, verbatim from subject or summary; if none, repeat subject slice), relationshipHint (first-party|known-contact|stranger|auto), suggestedAction (reply|todo|meeting|archive|ignore), urgency (critical|high|medium), deadline (null or YYYY-MM-DD), waitingForReply (boolean), tags (string array, can be empty).

URGENCY FLOOR: if the stored urgency field is "critical" or "high", do not downgrade it — use it as a minimum floor for your output urgency. A stored-high email cannot be output as urgency medium.

CAREER AND HIGH-STAKES OVERRIDE: emails about job offers, interview invitations, application status, medical appointments/results, legal notices/contracts, academic admissions, or financial decisions (mortgage, loan, account suspended) are NEVER nonEssential regardless of how the sender looks. If category was "informational" but subject/summary contains career/job/interview/offer/hiring/admitted/rejected/offer letter/medical/legal/financial signals, override to crucial or replyNeeded.

AUTO SENDERS EXCEPTION: the auto-sender rule (no-reply|noreply|notifications|donotreply) routes to nonEssential ONLY when the email is genuinely bulk/transactional. ATS and HR system emails about a specific candidate's job/interview are NOT bulk — they go to replyNeeded or crucial.

BROADCAST AND LOW-STAKE CIVIC MAIL: mass voting requests, petitions, generic "cast your vote", campus-wide surveys, LinkedIn-style blasts without a personal obligation belong in nonEssential with suggestedAction archive or ignore and urgency medium, waitingForReply false, unless the body clearly shows a direct one-to-one obligation to this user.

FYI ARTICLE OR SCIENCE SHARES: if category was "important" but the text is only sharing an article, science curiosity, or "thought you would enjoy" with no question and no task for this user, use nonEssential and urgency medium, never high.

REPLY VS DEADLINE: if a human expects a written reply, use replyNeeded even with a date. Use deadlines only when the action is dated but no personal reply thread (pay by, submit form by, expire on).

Do not invent email_id values. Do not omit cards for any input line.`,
  briefing_executive: `You write the executive summary for a morning email briefing. You receive a short digest: bucket counts and a list of notable threads (subject, sender, category).

Write 4-6 sentences in plain prose. Name specific senders and topics where the digest provides them. Do NOT output JSON. Do NOT use markdown fences.

FORBIDDEN in the prose: any tally of how many emails or messages (no digits with "email", "message", "item", "unread"). The UI already shows counts.

If the digest is thin, still write a calm overview of what the day looks like based on what is given.`,
  extract_entities:
    'Extract entities from this email that would be useful to remember for future reference. Return a JSON array of objects with "entity" (proper name or specific identifier), "entity_type" (person|company|project|topic|location), and "info" (one concrete sentence about what was learned — must include a specific fact, role, or relationship, not just that they appeared in an email). Rules: only include named people with a clear role or relationship; only include companies/projects if a specific detail was learned (what they do, deal size, status); skip generic words like "meeting", "email", "deadline", "invoice", "document"; skip entities where info would be trivially vague. Confidence bar: only include if you would recommend storing this fact for future drafts or decisions. Return an empty array if nothing clearly useful was found.',
  style_analysis:
    'Analyze the writing style of these sent emails (written BY the user). Return ONLY valid JSON with EXACTLY these four string keys and no extras: {"greeting_style":"<short>","closing_style":"<short>","tone":"formal|casual|mixed","avg_length":"short|medium|long"}. FIELD RULES — greeting_style: the exact most common opening word or phrase the user writes (e.g. "Hi", "Hey", "Hi {name}", "Hello", "Dear", "Good morning"). closing_style: the exact most common sign-off the user writes (e.g. "Best", "Thanks", "Cheers", "Best regards", "Talk soon", "Thanks,\\nGeorge"). NEVER return empty strings — if there is truly no greeting or closing, use "Hi" and "Thanks" as sensible defaults. tone: single word from formal/casual/mixed. avg_length: single word from short/medium/long. Do NOT wrap in markdown. Do NOT add commentary. Return JSON only.',
  meeting_detect:
    'Determine if this email contains or requests a meeting. Return JSON: {"has_meeting": boolean, "title": string, "suggested_duration": number (minutes), "attendees": string[], "suggested_date": string or null}.',
  agent_system: `You are RuneMail's Auto-Resolve executive agent. Your job is to completely clear the user's current briefing by producing a fully confirmed action plan: drafted replies, todos, calendar events, and a single bulk archive. At the end, the user reviews and executes approved actions with one click.

You have tools. You MUST use them. You never speak in plain prose to the user. Every output from you is either tool calls or, when you truly have nothing to say, a single short line of status text (one sentence, max 12 words, no lists, no options in text).

## HARD RULES (non-negotiable)

1. THINK LIKE THE USER. Every propose_action MUST include a reasoning field — one first-person-style sentence that explains why THIS action is right for THIS user given their style profile, past replies with this sender, and the specific ask in this email. If you cannot write that sentence truthfully, you do not yet have enough context — call more read tools first.

2. GATHER BEFORE ACTING. Before proposing any non-trivial action you MUST call the relevant read tools:
   - Always begin with get_briefing_context so you know what emails exist in your scope.
   - For ANY email in "crucial" or "replyNeeded" you WILL touch: call get_thread(email_id) AND past_replies_by_me(sender) AND user_style_profile — no shortcut. Use search_emails to find related historical threads when relevant.
   - For any meeting you will propose: call calendar_freebusy first, then surface 2-3 concrete open slots via ask_user.
   - Batch read-tool calls together in one assistant turn whenever possible (parallel tool calls are supported).

3. NEVER ASSUME. If any decision depends on information you were not given (which date/time, which tone, whether to reply or archive, whom to include, whether to send now or save as draft, what exactly to say), you MUST call ask_user with 2-4 concrete options plus allow_custom=true.

4. BATCH INDEPENDENT QUESTIONS. ask_user accepts a "questions" array. When you have multiple independent decisions, emit them in ONE ask_user call so the user can answer them together — the UI renders them as a grid. Only use a single question when decisions chain (answer to Q1 changes what Q2 should be).

5. REPLIES DEFAULT TO SENDING. Set send_now=true by default. Only set send_now=false if the user explicitly said "save as draft" or the reply is risky/incomplete (placeholder content, legal/contract wording needing personal review). The review UI lets the user flip between Send, Draft, or Resolve-without-reply per-action.

6. MATCH THE USER'S VOICE. After user_style_profile returns, use the returned greeting / closing / tone / length as constraints on every reply body.

7. NO TODOS FOR NOISE. If the source email is in the nonEssential bucket, or its suggestedAction is "archive"/"ignore", or the sender matches no-reply/notifications/donotreply/mailer-daemon, you MAY NOT propose a todo or a reply for it. The server will reject such calls. Only "archive" applies.

8. DO NOT DUPLICATE. One reply + one todo is the maximum per email. If a reply covers the ask, do not also add a todo. Never propose two actions with the same (type, linked_email_id) — the server will reject the second.

9. BE CONCRETE. Todo titles must make sense without reopening the email ("Sign last page of NYU employment agreement by Apr 28", not "sign agreement"). Reply bodies must reference the specific ask with specific details from the thread.

10. ONE ARCHIVE BATCH. You may emit AT MOST ONE archive action across the whole run, grouping ALL nonEssential email_ids into a single call with summary like "42 newsletters and receipts from this week". The server will reject a second archive call and tell you to revise the first.

11. WHEN TO FINALIZE. Call the finalize tool ONLY when: (a) every ask_user question has been answered, (b) every propose_action reflects a confirmed decision with reasoning, (c) you have covered all meaningful items in your scope. Pass a one-paragraph plain-language summary.

12. NEVER WRITE TEXT WITH OPTION LISTS. If you feel the urge to type "1. X  2. Y  3. Z" or "Option A / Option B", STOP and call ask_user instead. Choices only ever live inside ask_user cards.

## ACTION BUDGET

- 0-3 replies per run. Only reply when the user has clearly said what to say, or you have asked and gotten an answer.
- 0-6 todos per run. Each todo MUST link to an email that is in crucial/replyNeeded/deadlines — never in nonEssential.
- 0-3 meetings per run. Each meeting MUST have a time the user explicitly picked from a freebusy-aware ask_user.
- Exactly 0 or 1 archive batch per run.

## STYLE

Your status text (when you rarely emit content) should be like "Reading Hanan's thread." or "Checking calendar for Friday." — tight, present-tense, under 12 words, no emoji, no options.

## TIMEZONE

Today is {TODAY}. User timezone: {TIMEZONE}. All ISO times you output in meeting proposals are in the user's local timezone with no Z suffix.`,
  agent_system_bucket: `You are a SUB-AGENT of RuneMail's Auto-Resolve system, owning the "{BUCKET}" scope only. A parent agent has split the briefing into buckets; another sub-agent is handling the others in parallel. Focus exclusively on the emails in your scope.

You follow every rule in the full Auto-Resolve agent system (think-like-user reasoning on every propose_action, gather before acting, no-todos-for-noise, batch questions, one archive per run at most, never duplicate actions). Keep within your bucket's budget:

- replies: 0-3 reply actions. Read thread + past_replies_by_me + user_style_profile before drafting.
- meetings: 0-3 meeting actions. Always call calendar_freebusy and ask_user with concrete slots.
- todos: 0-6 todo actions. Each links to an email in crucial/replyNeeded/deadlines only.
- noise: exactly 1 archive action bundling ALL nonEssential email_ids in your scope. No reads, no questions.

Finalize as soon as your bucket is resolved. Do NOT propose actions outside your bucket — the parent merges our outputs.

Today is {TODAY}. User timezone: {TIMEZONE}.`,
  draft_reply_in_context: `You are drafting one email reply on behalf of the user. Rules:
- Write in the user's voice using the greeting, closing, tone, and length passed in context.
- Keep it concise. Short if the user tends short, medium if medium.
- Address the SPECIFIC ask from the original email.
- Do not use placeholders like [Your Name] or [Company].
- No preamble. Only the email body, including greeting and closing.`,
};

/**
 * Generic LLM call — routes through the active provider (OpenRouter or Cerebras).
 * OpenAI-compatible chat/completions schema is used by both providers.
 */
async function llm(
  systemPrompt: string,
  userText: string,
  temperature = 0.3,
  maxTokens = 512,
): Promise<string> {
  const apiKey = activeApiKey();
  const model = activeModel();
  const url = activeEndpoint();
  const extraHeaders = activeExtraHeaders();
  const extraBody = activeExtraBody();

  if (!apiKey) {
    throw new Error(
      "No LLM API key configured (set OPENROUTER_API_KEY for OpenRouter or CEREBRAS_API_KEY for Cerebras)",
    );
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("LLM request timed out after 30s")),
        30_000,
      );
    });
    let res: Response;
    try {
      res = await Promise.race([
        fetch(url, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            ...extraHeaders,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userText },
            ],
            temperature,
            max_tokens: maxTokens,
            ...extraBody,
          }),
        }),
        timeoutPromise,
      ]);
      clearTimeout(timeoutId);
    } catch {
      clearTimeout(timeoutId);
      controller.abort();
      await new Promise((r) => setTimeout(r, 2_000));
      continue;
    }

    if (res.status === 429) {
      const rawRetry = parseInt(res.headers.get("retry-after") ?? "5", 10);
      const waitMs = Math.min(
        isNaN(rawRetry) || rawRetry > 3600 ? 5000 : rawRetry * 1000,
        10_000,
      );
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    if (res.status === 500 || res.status === 502 || res.status === 503) {
      const backoff = Math.min(3 * (attempt + 1), 20);
      await new Promise((r) => setTimeout(r, backoff * 1000));
      continue;
    }

    if (!res.ok) {
      const errorText = await res.text();
      const errorObj = (() => {
        try {
          return JSON.parse(errorText);
        } catch {
          return { message: errorText };
        }
      })();
      const err = new Error("LLM_API_ERROR");
      (err as any).status = res.status;
      (err as any).details = errorObj;
      throw err;
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      await new Promise((r) => setTimeout(r, 2_000));
      continue;
    }
    return stripThinkTags(content.trim());
  }

  throw new Error("LLM_API_ERROR: max retries exceeded");
}

// Legacy aliases kept for the rest of the file's existing call sites.
const cerebras = llm;
const gemini = llm;

/**
 * Tool-calling chat completion. Returns the raw OpenAI-shaped response
 * (the first choice) so callers can dispatch tool_calls / content themselves.
 */
export async function llmWithTools(params: {
  messages: {
    role: string;
    content: string | null;
    tool_calls?: unknown[];
    tool_call_id?: string;
    name?: string;
  }[];
  tools: unknown[];
  temperature?: number;
  maxTokens?: number;
}): Promise<{
  content: string | null;
  reasoning: string | null;
  tool_calls: {
    id: string;
    function: { name: string; arguments: string };
  }[];
  finish_reason: string | null;
}> {
  const apiKey = activeApiKey();
  const model = activeModel();
  const url = activeEndpoint();
  const extraHeaders = activeExtraHeaders();
  const extraBody = activeExtraBody();
  if (!apiKey) throw new Error("No LLM API key configured");

  // OpenRouter/MiniMax expose a reasoning stream alongside the main content.
  // Enabling it gives us the chain-of-thought we surface in the workspace UI.
  const reasoningBody =
    AI_PROVIDER === "cerebras" ? {} : { reasoning: { effort: "medium" } };

  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("Agent LLM request timed out after 60s")),
        60_000,
      );
    });
    let res: Response;
    try {
      res = await Promise.race([
        fetch(url, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            ...extraHeaders,
          },
          body: JSON.stringify({
            model,
            messages: params.messages,
            tools: params.tools,
            tool_choice: "auto",
            parallel_tool_calls: true,
            temperature: params.temperature ?? 0.4,
            max_tokens: params.maxTokens ?? 2048,
            ...reasoningBody,
            ...extraBody,
          }),
        }),
        timeoutPromise,
      ]);
      clearTimeout(timeoutId);
    } catch {
      clearTimeout(timeoutId);
      controller.abort();
      await new Promise((r) => setTimeout(r, 2_000));
      continue;
    }

    if (res.status === 429) {
      const rawRetry = parseInt(res.headers.get("retry-after") ?? "5", 10);
      await new Promise((r) =>
        setTimeout(
          r,
          Math.min(isNaN(rawRetry) ? 5000 : rawRetry * 1000, 10_000),
        ),
      );
      continue;
    }
    if (res.status >= 500) {
      await new Promise((r) => setTimeout(r, 3_000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(
        `Agent LLM error (${res.status}): ${errText.slice(0, 400)}`,
      );
    }
    const data = await res.json();
    const choice = data.choices?.[0];
    const message = choice?.message ?? {};
    // OpenRouter exposes reasoning under `message.reasoning` (string) or
    // `message.reasoning_details[].text` (array) depending on provider. Merge.
    let reasoning: string | null = null;
    if (typeof message.reasoning === "string" && message.reasoning.trim()) {
      reasoning = message.reasoning.trim();
    } else if (Array.isArray(message.reasoning_details)) {
      const parts = (message.reasoning_details as Array<{ text?: string }>)
        .map((r) => (typeof r.text === "string" ? r.text : ""))
        .filter(Boolean);
      if (parts.length) reasoning = parts.join("\n").trim();
    }
    return {
      content:
        typeof message.content === "string"
          ? stripThinkTags(message.content)
          : null,
      reasoning,
      tool_calls:
        (message.tool_calls as {
          id: string;
          function: { name: string; arguments: string };
        }[]) ?? [],
      finish_reason: choice?.finish_reason ?? null,
    };
  }
  throw new Error("Agent LLM: max retries exceeded");
}

export { PROMPTS };

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
  const cleaned = raw.replace(/```\s*json\s*\n?|\n?```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to recover a truncated JSON object by finding the last complete top-level value.
    // Walk back from the end looking for a closing brace/bracket.
    let s = cleaned;
    for (let i = s.length - 1; i > 0; i--) {
      if (s[i] === "}" || s[i] === "]") {
        try {
          return JSON.parse(s.slice(0, i + 1));
        } catch {
          /* keep trying */
        }
      }
    }
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
]);

function buildSignalContext(signals: EmailSignals): {
  context: string;
  definiteCategory: string | null;
} {
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
  if (signals.hasListUnsubscribe)
    lines.push(
      "Has List-Unsubscribe header: yes (strong newsletter/bulk signal)",
    );
  const prec = signals.precedenceHeader?.toLowerCase();
  if (prec && ["bulk", "list", "junk"].includes(prec))
    lines.push(`Precedence header: ${prec} (bulk/automated mail)`);
  if (signals.replyToEmail)
    lines.push(
      `Reply-To differs from sender: yes (common in marketing emails)`,
    );
  if (signals.isReply) lines.push("Is a reply in an active thread: yes");
  if (signals.hasAttachments) lines.push("Has attachments: yes");
  if (signals.ccRecipients)
    lines.push("Has CC recipients: yes (group/broadcast email)");

  // Sender relationship
  const count = signals.senderInteractionCount ?? 0;
  if (count >= 5)
    lines.push(
      `Sender interaction history: ${count} previous emails (established contact)`,
    );
  else if (count > 0)
    lines.push(
      `Sender interaction history: ${count} previous email(s) (occasional contact)`,
    );
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
    lines.push(
      "NOTE: User starred this email — lean towards action-required or important.",
    );
  }

  const context =
    lines.length > 0
      ? `SIGNALS:\n${lines.map((l) => `- ${l}`).join("\n")}\n\n`
      : "";
  return { context, definiteCategory };
}

export async function processFullEmail(
  subject: string,
  sender: string,
  body: string,
  signals?: EmailSignals,
  userTags?: { slug: string; description: string }[],
  categoryHints?: { category_slug: string; description: string }[],
): Promise<{
  category: string;
  urgency: string;
  summary: string;
  quick_actions: unknown[];
  tags: string[];
}> {
  const emailText = `Subject: ${subject}\nFrom: ${sender}\n\n${body.slice(0, 6000)}`;

  const { context: signalContext, definiteCategory } = signals
    ? buildSignalContext(signals)
    : { context: "", definiteCategory: null };

  let prompt = PROMPTS.process_email;
  if (categoryHints && categoryHints.length > 0) {
    const hintLines = categoryHints
      .map((h) => `- If ${h.description}, classify as "${h.category_slug}"`)
      .join("\n");
    prompt += `\n\nUser-defined categorization rules (apply these when they match the email):\n${hintLines}`;
  }
  if (userTags && userTags.length > 0) {
    const tagLines = userTags
      .map((t) => `- ${t.slug}: ${t.description || t.slug}`)
      .join("\n");
    prompt += `\n\nCustom tags (apply any that fit, can be multiple or none):\n${tagLines}\nAdd "tags": ["slug1",...] to the JSON if any apply. Omit "tags" key if none match.`;
  }

  const textWithSignals = signalContext
    ? `${signalContext}${emailText}`
    : emailText;

  const raw = await gemini(prompt, textWithSignals, 0.2, 2048);
  const parsed = parseJson(raw) as any;

  const valid = ["important", "action-required", "newsletter", "informational"];
  const cat = (parsed?.category || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z-]/g, "");
  const finalCategory =
    definiteCategory ?? (valid.includes(cat) ? cat : "informational");

  const validUrgency = ["critical", "high", "medium", "low"];
  const parsedUrgency = (parsed?.urgency || "").toLowerCase().trim();
  const finalUrgency = validUrgency.includes(parsedUrgency) ? parsedUrgency : "medium";

  const validTagSlugs = new Set((userTags || []).map((t) => t.slug));
  const returnedTags = Array.isArray(parsed?.tags)
    ? (parsed.tags as string[]).filter((t) => validTagSlugs.has(t))
    : [];

  return {
    category: finalCategory,
    urgency: finalUrgency,
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
  const {
    intent,
    subject,
    recipientName,
    senderName,
    replyTo,
    styleContext,
    knowledgeContext,
  } = opts;
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

export async function refineDraft(opts: {
  currentDraft: string;
  feedback: string;
  senderName: string;
  styleContext?: string;
  knowledgeContext?: string;
}): Promise<string> {
  const { currentDraft, feedback, senderName, styleContext, knowledgeContext } =
    opts;
  const closing = senderName ? `Best regards,\n${senderName}` : "Best regards,";

  let context = `Current draft:\n${currentDraft}\n\nUser feedback on what to change: ${feedback}`;
  if (knowledgeContext)
    context += `\n\nBackground context:\n${knowledgeContext}`;
  if (styleContext) context += `\n\nWrite in this style: ${styleContext}`;

  const systemPrompt = `You are an email drafting assistant. The user reviewed an AI-generated draft and wants changes. Revise the draft according to their feedback exactly. Rules:
1. Write ONLY the email body — no subject line.
2. Keep the existing greeting and closing unless the feedback asks to change them.
3. Apply the requested changes faithfully and completely.
4. Do NOT use placeholder text like [Your Name] or [Company].
5. End with: "${closing}"`;

  return cerebras(systemPrompt, context, 0.4, 1024);
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

export async function generateBriefing(
  emailsText: string,
  knowledgeContext?: string,
): Promise<Record<string, unknown>> {
  const fullText = knowledgeContext
    ? `## Background Knowledge\n${knowledgeContext}\n\n## Emails\n${emailsText}`
    : emailsText;
  const todayDate = new Date().toISOString().split("T")[0]; // UTC date
  const raw = await gemini(
    `Today's date is ${todayDate}. ${PROMPTS.briefing}`,
    fullText,
    0.3,
    6144,
  );
  const parsed = parseJson(raw) as Record<string, unknown> | null;
  // Accept any response that has at least one recognized briefing key
  const isValidShape =
    parsed &&
    typeof parsed === "object" &&
    (parsed.executiveSummary ||
      Array.isArray(parsed.crucial) ||
      Array.isArray(parsed.replyNeeded) ||
      Array.isArray(parsed.deadlines) ||
      parsed.topPriority ||
      parsed.stats);
  if (isValidShape) {
    // Guarantee a non-error summary when the arrays are present but summary is missing
    if (!(parsed as any).executiveSummary) {
      (parsed as any).executiveSummary =
        (parsed as any).summary || "Here is your email briefing.";
    }
    return parsed as Record<string, unknown>;
  }
  return {
    executiveSummary:
      (parsed as any)?.summary ?? "Unable to generate briefing summary.",
    crucial: [],
    replyNeeded: [],
    deadlines: [],
    nonEssential: [],
    stats: (parsed as any)?.stats ?? {
      total: 0,
      crucial: 0,
      replyNeeded: 0,
      deadlines: 0,
      nonEssential: 0,
    },
  };
}

const BRIEFING_FAILURE_SUBSTRINGS = [
  "unable to generate briefing",
  "unable to generate summary",
];

/** True when the stored executive summary failed or is empty and should be regenerated. */
export function briefingSummaryNeedsRecovery(
  s: string | undefined | null,
): boolean {
  if (s === undefined || s === null) return true;
  const t = s.trim();
  if (!t) return true;
  const lower = t.toLowerCase();
  return BRIEFING_FAILURE_SUBSTRINGS.some((x) => lower.includes(x));
}

/**
 * Refine up to a few dozen briefing rows: bucket placement plus Auto-Resolve fields.
 */
export async function refineBriefingCards(
  ndjsonLines: string,
): Promise<Record<string, unknown>[]> {
  const todayDate = new Date().toISOString().split("T")[0];
  const raw = await gemini(
    `Today's date is ${todayDate}. ${PROMPTS.briefing_batch_cards}`,
    ndjsonLines,
    0.25,
    8192,
  );
  const parsed = parseJson(raw) as { cards?: Record<string, unknown>[] } | null;
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.cards)) {
    return [];
  }
  return parsed.cards;
}

/**
 * Short executive briefing prose from a compact digest (not the full inbox).
 */
export async function generateBriefingExecutiveSummary(
  digest: string,
  knowledgeContext?: string,
): Promise<string> {
  const userText = knowledgeContext
    ? `## Background\n${knowledgeContext}\n\n## Digest\n${digest}`
    : digest;
  const todayDate = new Date().toISOString().split("T")[0];
  const raw = await gemini(
    `Today's date is ${todayDate}. ${PROMPTS.briefing_executive}`,
    userText,
    0.35,
    2048,
  );
  const text = stripThinkTags(typeof raw === "string" ? raw.trim() : "").trim();
  if (!text) {
    return "Your briefing is ready; scan the sections for what needs attention.";
  }
  return text;
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

  const userText = `## Current Briefing\n${previousBriefingJson}\n\n## New Emails\n${newEmailsText}`;

  const raw = await gemini(prompt, userText, 0.2, 4096);
  const parsed = parseJson(raw);
  return parsed && typeof parsed === "object"
    ? (parsed as Record<string, unknown>)
    : null;
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
  const greeting = (parsed?.greeting_style ?? "").trim();
  const closing = (parsed?.closing_style ?? "").trim();
  const tone = (parsed?.tone ?? "").trim().toLowerCase();
  const length = (parsed?.avg_length ?? "").trim().toLowerCase();
  return {
    greeting_style: greeting || "Hi",
    closing_style: closing || "Thanks",
    tone: ["formal", "casual", "mixed"].includes(tone) ? tone : "mixed",
    avg_length: ["short", "medium", "long"].includes(length)
      ? length
      : "medium",
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
    ? parsed.filter((t: unknown) => typeof t === "string").slice(0, 6)
    : [];
}

export async function suggestTodosFromEmails(
  emailsText: string,
): Promise<{ task: string; source: string }[]> {
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
  styleProfile: {
    greeting_style: string;
    closing_style: string;
    tone: string;
    avg_length: string;
  } | null;
  topSenders?: {
    sender_email: string;
    sender_name?: string;
    interaction_count: number;
    relationship_notes: string | null;
  }[];
  knowledgeEntries?: {
    entity: string;
    entity_type: string;
    info: string;
    importance?: string | null;
  }[];
  recentEmails?: {
    id: string;
    date: string;
    sender_email: string;
    sender: string;
    subject: string;
    summary: string | null;
    category: string;
  }[];
}

export interface ChatToolCall {
  name:
    | "create_todo"
    | "update_todo"
    | "delete_todo"
    | "list_todos"
    | "save_draft"
    | "delete_draft"
    | "list_drafts"
    | "add_knowledge"
    | "send_email"
    | "reply_to_email"
    | "create_meeting"
    | "update_meeting"
    | "delete_meeting"
    | "list_meetings"
    | "search_emails"
    | "search_emails_by_sender"
    | "search_emails_by_date"
    | "search_emails_by_sender_and_date"
    | "lookup_contact"
    | "get_recent_emails"
    | "get_email"
    | "search_knowledge_base"
    | "get_read_receipts"
    | "get_sent_emails"
    | "archive_email"
    | "suggest_reply_options"
    | "get_email_thread"
    | "list_tags"
    | "create_tag"
    | "apply_tag"
    | "remove_tag";
  arguments: Record<string, unknown>;
}

// deno-lint-ignore no-explicit-any
export type SupabaseClient = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

function buildChatSystemPrompt(context: ChatContext): string {
  const now = new Date().toISOString().split("T")[0];
  const sections: string[] = [
    `You are RuneMail Assistant, a highly capable executive secretary for ${context.userDisplayName}. Today is ${now}.
User's timezone: ${context.timezone || "UTC"}. All times the user mentions are in their local timezone.
You are proactive, thorough, and decisive — you gather context, think it through, and either act or present the user with a clear choice. Do NOT use <think> tags. Be direct and concise.

## CRITICAL RULE — OPTIONS FORMAT (overrides everything)
You are STRICTLY FORBIDDEN from writing numbered or bulleted options in your text reply.
NEVER write things like "1. Accept  2. Decline  3. Ask for agenda" or "Option A: ..." in your message.
When you need to present ANY choices to the user, you MUST call the suggest_reply_options tool instead.
If you catch yourself about to write a list of choices — STOP immediately and call suggest_reply_options.
This rule has no exceptions. Options always appear as clickable cards, never as text.

## SEARCH-FIRST RULE — NEVER ASK BEFORE SEARCHING
When user refers to "email from [Person]", "email about [Topic]", or any email without an explicit ID:
1. IMMEDIATELY call search_emails_by_sender([Person]) and/or search_emails([Topic]) — do not ask first.
2. If ONE email matches: read it with get_email(id), then proceed.
3. If MULTIPLE emails match: call suggest_reply_options with the emails as options (label = subject, description = snippet + date). Let the user pick.
4. If ZERO found: try a shorter keyword or search_emails as fallback. Only say "not found" after 2 attempts.
You are FORBIDDEN from asking "which email do you mean?" or "could you provide more context?" without first searching. Search autonomously, then disambiguate with cards if needed.

## CONTACT RESEARCH PROTOCOL
When ANY person is mentioned (by name, email, or relationship), ALWAYS perform ALL of these in a single turn before composing or acting:
1. Call lookup_contact([name]) to get their email address, interaction history, and relationship notes.
2. Call search_emails_by_sender([name]) to retrieve all their past emails.
3. Call get_email(id) on the most recent result to read the full context.
4. If the email has a thread_id and conversation history matters, call get_email_thread(thread_id) to see the full thread.
Do ALL steps before composing any reply, creating a meeting, or making any decision involving that person.
EXCEPTION: If lookup_contact returns no results AND search_emails_by_sender returns nothing, the person has never contacted you. In this one case only, ask the user for their email address.

## SECRETARY BEHAVIOR
You act like a skilled executive secretary:
- ALWAYS gather information before acting: read the email, check the calendar, look up the person.
- For CLEAR explicit instructions ("decline", "accept", "send this", "cancel"): execute immediately, no confirmation.
- For UNCLEAR intent (how to reply, what to say): call suggest_reply_options with 2-4 distinct approaches.
- For UNCLEAR target (which email, which meeting): search first; if multiple results, use suggest_reply_options to let user pick.
- When suggesting alternative meeting times: ALWAYS call list_meetings first, find real free slots, suggest SPECIFIC times (e.g. "Monday Apr 7 at 2 PM") — never vague ranges like "morning or afternoon".
- When the user picks an option card, immediately execute it — no further confirmation.

## GATHER FIRST — BATCH ALL INFORMATION CALLS
In your FIRST response, call ALL information-gathering tools you need SIMULTANEOUSLY (you can call multiple tools in one response). This includes: lookup_contact, search_emails_by_sender, search_emails, search_emails_by_date, get_email, get_email_thread, list_todos, list_meetings, get_read_receipts, search_knowledge_base, get_recent_emails.

NEVER call information tools one per round. Batch all reads in a single response, then take all actions in the next response.

Pattern: Round 1 = gather everything needed. Round 2 = take all actions. Round 3 = confirm.
Exception: if you discover a new ID from a search result and need to fetch the full content, one extra gather round is fine.

## RULES
1. SEARCH BEFORE ACTING: Any person, company, project, or topic mentioned -> call lookup_contact and/or search_knowledge_base FIRST. EXCEPTION: if lookup_contact returns no results, the person has never emailed you. In this case ONLY, ask the user for their email address.
2. For ALL email content: use email search tools. Never answer from memory about email contents.
3. Batch tools freely in one round: lookup + search emails + read email + check calendar — all at once.
4. WHEN TO ACT vs. SHOW OPTIONS:
   - Clear intent + clear target -> execute immediately (no confirmation)
   - Unclear intent -> suggest_reply_options with 2-4 reply approaches
   - Unclear target (multiple emails/meetings) -> search first, then suggest_reply_options to pick
   - Meeting reschedule/decline -> list_meetings first, propose SPECIFIC free time slots as suggest_reply_options
5. When creating a meeting: use proper ISO datetime + attendee emails. Times are in user's timezone (${context.timezone || "UTC"}).
6. Do NOT include Zoom in meetings unless explicitly asked.
7. COMPLETE every task. If asked to do multiple things, do ALL of them.
8. Confirm completed actions in PAST TENSE: "I sent", "I created" — never "I will send".
9. If first email search returns no results, retry with a shorter keyword before giving up.
10. EMAIL FORMAT: greeting line, blank line, body paragraphs, blank line, closing phrase, then "${context.userDisplayName}" on a new line. No extra punctuation on greeting.
11. EXECUTE PREFIX: When the user's message begins with "Execute:", treat it as an immediate confirmed instruction. Call the relevant tool right away — no re-confirmation, no more option cards.
12. NEVER announce actions in future tense. Do NOT write "I'll now reach out to...", "I will send...", or "I'm going to..." for any action you intend to take. CALL THE TOOL FIRST. Your final reply must only confirm what already happened: "I sent the email to...", "I created the meeting...", "I archived...". If you catch yourself writing a future-tense action description, stop and make the tool call instead.

## TOOL SELECTION
- Any person/company/project mentioned -> lookup_contact + search_knowledge_base (always first)
- "email from [Person]" without ID -> search_emails_by_sender([Person]) FIRST; if multiple -> suggest_reply_options to pick; if one -> get_email(id) and proceed
- "email about [Topic]" without ID -> search_emails([Topic]) FIRST; if multiple -> suggest_reply_options to pick
- "reply to [Person]'s email" -> search_emails_by_sender([Person]), read it, then suggest_reply_options for approach (unless intent is explicit)
- "reply to [email]" with explicit content -> get_email(id) then reply_to_email directly
- "reply to [email]" without stated content -> get_email(id) + suggest_reply_options for reply approach
- "decline / reschedule [meeting email]" -> get_email(id) + list_meetings + suggest_reply_options with SPECIFIC free time slots
- "last N emails" / "recent emails" -> get_recent_emails(limit=N)
- "emails from X" -> search_emails_by_sender
- "emails this week" -> search_emails_by_date
- "emails about Y" -> search_emails
- "what did X send me today" -> search_emails_by_sender_and_date
- "read / show me email [id]" -> get_email(id)
- "email X about Y" -> lookup_contact + send_email (execute immediately if content is clear)
- "set up a meeting with X" -> lookup_contact + create_meeting
- "show my meetings" / "list meetings" -> list_meetings
- "update / reschedule meeting" -> update_meeting(id, ...)
- "cancel / delete meeting" -> delete_meeting(id)
- "create a todo" -> create_todo
- "mark todo done" -> update_todo(id, is_completed: true)
- "edit todo" -> update_todo(id, text: "new text")
- "delete todo" -> delete_todo(id)
- "show todos" -> list_todos
- "draft an email" -> save_draft; "send an email" -> send_email
- "show drafts" -> list_drafts
- "delete draft" -> delete_draft(id)
- "sent emails" -> get_sent_emails
- "read receipts" -> get_read_receipts
- "archive email" -> archive_email(id)
- "show thread" / "full conversation" / thread context -> get_email_thread(thread_id from get_email result)
- "list tags" / "show my tags" -> list_tags
- "create tag [name]" -> create_tag(display_name, slug, color)
- "tag email with [tag]" / "apply tag" -> apply_tag(email_id, tag_slug)
- "remove tag from email" -> remove_tag(email_id, tag_slug)`,
  ];

  if (context.styleProfile) {
    const s = context.styleProfile;
    sections.push(
      `## Writing Style\nGreeting pattern: ${s.greeting_style}\nClosing pattern: ${s.closing_style} (always follow with a new line containing only "${context.userDisplayName}")\nTone: ${s.tone}, Length: ${s.avg_length}`,
    );
  } else {
    sections.push(
      `## Writing Style\nAlways sign emails as:\nBest regards,\n${context.userDisplayName}`,
    );
  }

  return sections.join("\n\n");
}

const CHAT_TOOLS = [
  {
    type: "function",
    function: {
      name: "search_knowledge_base",
      description:
        "Search the knowledge base by keyword or topic. Use when looking for context about a project, company, topic, or person not immediately found in the Knowledge Base section above.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Search term - a name, project, company, or topic keyword",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recent_emails",
      description:
        "Get the most recent emails from the inbox. Use when the user asks for 'last N emails', 'recent emails', or 'my inbox'. Specify exact limit to match what the user asks for.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description:
              "Number of recent emails to retrieve (e.g. 4, 10). Default 10.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_contact",
      description:
        "Look up a person's email address and info by name. Searches email_memory and knowledge_base. ALWAYS use this before send_email or create_meeting when user refers to someone by name.",
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
      description:
        "Search all emails by keyword or topic. Searches subject, sender, and body. Use for topic searches like 'budget report'. For sender queries, use search_emails_by_sender instead.",
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
      description:
        "Find emails from a specific person (no date filter). If user mentions a time period too, use search_emails_by_sender_and_date instead.",
      parameters: {
        type: "object",
        properties: {
          sender: {
            type: "string",
            description: "Sender name or email address",
          },
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
          start_date: {
            type: "string",
            description: "Start date (YYYY-MM-DD)",
          },
          end_date: {
            type: "string",
            description: "End date (YYYY-MM-DD). Defaults to today.",
          },
        },
        required: ["start_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_emails_by_sender_and_date",
      description:
        "Find emails from a person within a date range. Best for 'what did X send me today/this week'.",
      parameters: {
        type: "object",
        properties: {
          sender: {
            type: "string",
            description: "Sender name or email address",
          },
          start_date: {
            type: "string",
            description: "Start date (YYYY-MM-DD)",
          },
          end_date: {
            type: "string",
            description: "End date (YYYY-MM-DD). Defaults to today.",
          },
        },
        required: ["sender", "start_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_email",
      description:
        "Send an email on behalf of the user. Compose a professional email body. You MUST have the recipient's email address (use lookup_contact first if needed).",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address" },
          subject: { type: "string", description: "Email subject line" },
          body: {
            type: "string",
            description: "Email body (plain text, newlines for formatting)",
          },
        },
        required: ["to", "subject", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_draft",
      description:
        "Save a draft email (not sent). Use when user says 'draft' rather than 'send'.",
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
      description:
        "Create a calendar event/meeting. Use lookup_contact first to get attendee emails. Times should be in the user's local timezone as ISO 8601 (without Z suffix). Only set include_zoom to true if the user explicitly asks for a Zoom link.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Meeting title" },
          start_time: {
            type: "string",
            description:
              "Start time in user's local timezone as ISO 8601 (e.g. 2026-03-30T17:00:00)",
          },
          end_time: {
            type: "string",
            description:
              "End time in user's local timezone as ISO 8601 (e.g. 2026-03-30T18:00:00)",
          },
          attendees: {
            type: "array",
            items: { type: "string" },
            description: "List of attendee email addresses",
          },
          description: {
            type: "string",
            description: "Optional meeting description",
          },
          include_zoom: {
            type: "boolean",
            description:
              "Whether to create a Zoom meeting link. Default false, only set true if user asks.",
          },
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
      description:
        "Add an entry to the user's knowledge base (person, company, project, etc.).",
      parameters: {
        type: "object",
        properties: {
          entity: { type: "string", description: "Name of the entity" },
          entity_type: {
            type: "string",
            enum: [
              "person",
              "company",
              "project",
              "topic",
              "location",
              "other",
            ],
            description: "Type of entity",
          },
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
      description:
        "Read the full content of a specific email by its ID. Use after search results return email IDs.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The email UUID from search results",
          },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reply_to_email",
      description:
        "Send a reply to an existing email (maintains thread). Use get_email first to read the original.",
      parameters: {
        type: "object",
        properties: {
          email_id: {
            type: "string",
            description: "The UUID of the email being replied to",
          },
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
          limit: {
            type: "number",
            description: "Number of sent emails to retrieve. Default 10.",
          },
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
          filter: {
            type: "string",
            enum: ["pending", "completed", "all"],
            description: "Filter by status. Default: pending.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_todo",
      description:
        "Update a todo item - mark it complete/incomplete or change its text. Requires the todo ID from list_todos.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Todo ID" },
          text: {
            type: "string",
            description: "New text for the todo (optional)",
          },
          is_completed: {
            type: "boolean",
            description: "Mark as complete (true) or incomplete (false)",
          },
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
      description:
        "List the user's meetings. Use to show upcoming or recent meetings with full details.",
      parameters: {
        type: "object",
        properties: {
          filter: {
            type: "string",
            enum: ["upcoming", "past", "all"],
            description: "Filter meetings. Default: upcoming.",
          },
          limit: {
            type: "number",
            description: "Max meetings to return. Default 10.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_meeting",
      description:
        "Edit an existing meeting. Requires meeting ID from list_meetings.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Meeting ID" },
          title: { type: "string", description: "New title" },
          start_time: {
            type: "string",
            description: "New start time (ISO 8601 in user's local timezone)",
          },
          end_time: {
            type: "string",
            description: "New end time (ISO 8601 in user's local timezone)",
          },
          attendees: {
            type: "array",
            items: { type: "string" },
            description: "Updated attendee email list",
          },
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
      description:
        "Delete/cancel a meeting. Requires meeting ID from list_meetings.",
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
          limit: {
            type: "number",
            description: "Number of drafts to return. Default 10.",
          },
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
      description:
        "Get read receipt tracking data - see which sent emails were opened and when.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Number of receipts to return. Default 10.",
          },
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
  {
    type: "function",
    function: {
      name: "suggest_reply_options",
      description:
        "Use this tool ANY time the user needs to choose between options — this is the ONLY allowed way to present choices. Use cases: (1) reply approach is unclear — present 2-4 reply stances; (2) multiple emails match the user's description — present them so user can pick which one to act on; (3) alternative meeting times — present specific free time slots; (4) any other ambiguity. NEVER present options in your text reply. Labels should be short (e.g. subject line or action). Descriptions should be one sentence. Do NOT call send_email, reply_to_email, or save_draft until the user picks.",
      parameters: {
        type: "object",
        properties: {
          options: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: {
                  type: "string",
                  description:
                    "Short label, e.g. 'Accept', 'Decline', 'Ask for more time'",
                },
                description: {
                  type: "string",
                  description: "One sentence: what this reply would say",
                },
              },
              required: ["label", "description"],
            },
            description: "2-4 reply options",
          },
          recommended: {
            type: "number",
            description: "0-based index of the recommended option",
          },
          context: {
            type: "string",
            description: "One sentence explaining what the email is about",
          },
        },
        required: ["options", "recommended"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_email_thread",
      description:
        "Fetch all emails in a conversation thread by thread_id. Use after get_email returns a thread_id to see the full back-and-forth history. Returns emails ordered oldest-first.",
      parameters: {
        type: "object",
        properties: {
          thread_id: {
            type: "string",
            description: "The thread_id from a get_email result",
          },
        },
        required: ["thread_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_tags",
      description:
        "List all custom tags/categories the user has created. Use before apply_tag or remove_tag to get valid tag slugs.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_tag",
      description: "Create a new custom tag/category for labeling emails.",
      parameters: {
        type: "object",
        properties: {
          display_name: {
            type: "string",
            description: "Human-readable tag name, e.g. 'Work Projects'",
          },
          slug: {
            type: "string",
            description:
              "URL-safe lowercase identifier with hyphens, e.g. 'work-projects'",
          },
          color: {
            type: "string",
            description: "Hex color code, e.g. '#3b82f6'. Default '#6b7280'.",
          },
        },
        required: ["display_name", "slug"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_tag",
      description:
        "Apply a tag/label to an email. Use list_tags first to get valid slugs.",
      parameters: {
        type: "object",
        properties: {
          email_id: { type: "string", description: "The email UUID" },
          tag_slug: {
            type: "string",
            description: "The tag slug to apply (from list_tags)",
          },
        },
        required: ["email_id", "tag_slug"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_tag",
      description: "Remove a tag/label from an email.",
      parameters: {
        type: "object",
        properties: {
          email_id: { type: "string", description: "The email UUID" },
          tag_slug: { type: "string", description: "The tag slug to remove" },
        },
        required: ["email_id", "tag_slug"],
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
  const apiKey = activeApiKey();
  const model = activeModel();
  const url = activeEndpoint();
  const extraHeaders = activeExtraHeaders();
  const extraBody = activeExtraBody();
  if (!apiKey) throw new Error("No LLM API key configured");

  const systemPrompt = buildChatSystemPrompt(context);
  const allToolCalls: ChatToolCall[] = [];

  let messages: {
    role: string;
    content: string | null;
    tool_calls?: unknown[];
    tool_call_id?: string;
  }[] = [
    { role: "system", content: systemPrompt },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: message },
  ];

  const callAPI = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("Chat request timed out after 35s")),
          35_000,
        );
      });
      let res: Response;
      try {
        res = await Promise.race([
          fetch(url, {
            method: "POST",
            signal: controller.signal,
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
              ...extraHeaders,
            },
            body: JSON.stringify({
              model,
              messages,
              tools: CHAT_TOOLS,
              tool_choice: "auto",
              // MiniMax M2.5 and OpenAI-compatible models support parallel tool calls.
              // Gather phase in the system prompt already asks the model to batch reads;
              // this flag lets the model actually emit multiple tool_calls per turn.
              parallel_tool_calls: true,
              temperature: 0.5,
              max_tokens: 2048,
              ...extraBody,
            }),
          }),
          timeoutPromise,
        ]);
        clearTimeout(timeoutId);
      } catch {
        clearTimeout(timeoutId);
        controller.abort();
        await new Promise((r) => setTimeout(r, 2_000));
        continue;
      }

      if (res.status === 429) {
        const rawRetry = parseInt(res.headers.get("retry-after") ?? "5", 10);
        const waitMs = Math.min(
          isNaN(rawRetry) || rawRetry > 3600 ? 5000 : rawRetry * 1000,
          10_000,
        );
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      if (res.status === 500 || res.status === 503) {
        const backoff = Math.min(5 * (attempt + 1), 20);
        await new Promise((r) => setTimeout(r, backoff * 1000));
        continue;
      }

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(
          `Chat API error (${res.status}): ${errText.slice(0, 300)}`,
        );
      }

      return await res.json();
    }
    throw new Error("Chat API: max retries exceeded");
  };

  // Tool-calling loop — up to 8 rounds for complex multi-step tasks.
  for (let round = 0; round < 8; round++) {
    const data = await callAPI();
    const choice = data.choices?.[0];
    const assistantMsg = choice?.message;

    if (
      choice?.finish_reason !== "tool_calls" ||
      !assistantMsg?.tool_calls?.length
    ) {
      const reply = stripThinkTags(assistantMsg?.content ?? "");
      if (!reply.trim()) {
        // Empty content from a non-tool-call response — treat as transient, retry via callAPI
        messages.push({ role: "user", content: "Please respond." });
        continue;
      }
      return { reply, tool_calls: allToolCalls };
    }

    // Model wants to call tools — add assistant message and process each tool
    messages.push(assistantMsg);

    for (const tc of assistantMsg.tool_calls as {
      id: string;
      function: { name: string; arguments: string };
    }[]) {
      const args = (() => {
        try {
          return JSON.parse(tc.function?.arguments ?? "{}");
        } catch {
          return {};
        }
      })() as Record<string, unknown>;

      const toolCall: ChatToolCall = {
        name: tc.function?.name as ChatToolCall["name"],
        arguments: args,
      };
      allToolCalls.push(toolCall);

      let toolResult: string;
      if (tc.function?.name === "get_recent_emails" && supabase && userId) {
        const limit = Math.min(Math.max(1, Number(args.limit) || 10), 50);
        const { data: results } = await supabase
          .from("emails")
          .select(
            "id, subject, sender, sender_email, received_at, snippet, email_processed(summary, category)",
          )
          .eq("user_id", userId)
          .order("received_at", { ascending: false })
          .limit(limit);
        const emails = results ?? [];
        toolResult =
          emails.length > 0
            ? `Here are the ${emails.length} most recent emails:\n` +
              emails
                .map((e: any) => {
                  const p = Array.isArray(e.email_processed)
                    ? e.email_processed[0]
                    : e.email_processed;
                  return `[${e.id}] ${e.received_at?.split("T")[0]} From: ${e.sender || e.sender_email} | ${e.subject} | ${p?.summary ?? e.snippet ?? "(no summary)"} | ${p?.category ?? "unknown"}`;
                })
                .join("\n")
            : "No emails found.";
      } else if (
        tc.function?.name === "search_knowledge_base" &&
        supabase &&
        userId
      ) {
        const query = ((args.query as string) ?? "").trim();
        const { data: kbResults } = await supabase
          .from("knowledge_base")
          .select("entity, entity_type, info, importance")
          .eq("user_id", userId)
          .or(`entity.ilike.%${query}%,info.ilike.%${query}%`)
          .order("importance", { ascending: false })
          .limit(15);
        const entries = kbResults ?? [];
        toolResult =
          entries.length > 0
            ? "Knowledge base results:\n" +
              entries
                .map((k: any) => `- ${k.entity} (${k.entity_type}): ${k.info}`)
                .join("\n")
            : `No knowledge base entries found for "${query}".`;
      } else if (tc.function?.name === "lookup_contact" && supabase && userId) {
        const name = ((args.name as string) ?? "").trim();
        // Search email_memory for sender info
        const { data: memoryResults } = await supabase
          .from("email_memory")
          .select(
            "sender_email, sender_name, interaction_count, relationship_notes, last_subject",
          )
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
          parts.push(
            "Contacts found:\n" +
              contacts
                .map(
                  (c: any) =>
                    `- ${c.sender_name || "Unknown"} <${c.sender_email}> (${c.interaction_count} emails)${c.relationship_notes ? ` - ${c.relationship_notes}` : ""}${c.last_subject ? ` | Last email: ${c.last_subject}` : ""}`,
                )
                .join("\n"),
          );
        }
        if (knowledge.length > 0) {
          parts.push(
            "Knowledge base:\n" +
              knowledge
                .map((k: any) => `- ${k.entity} (${k.entity_type}): ${k.info}`)
                .join("\n"),
          );
        }
        toolResult =
          parts.length > 0
            ? parts.join("\n\n")
            : `No contact or knowledge found for "${name}". Check the Contacts section in context, or ask the user for the email address.`;
      } else if (tc.function?.name === "search_emails" && supabase && userId) {
        const query = ((args.query as string) ?? "").trim();
        const { data: results } = await supabase
          .from("emails")
          .select(
            "id, subject, sender, sender_email, received_at, snippet, email_processed(summary, category)",
          )
          .eq("user_id", userId)
          .or(
            `subject.ilike.%${query}%,sender.ilike.%${query}%,sender_email.ilike.%${query}%,body_text.ilike.%${query}%`,
          )
          .order("received_at", { ascending: false })
          .limit(20);
        const emails = results ?? [];
        toolResult =
          emails.length > 0
            ? "Found emails:\n" +
              emails
                .map((e: any) => {
                  const p = Array.isArray(e.email_processed)
                    ? e.email_processed[0]
                    : e.email_processed;
                  return `[${e.id}] ${e.received_at?.split("T")[0]} From: ${e.sender || e.sender_email} | ${e.subject} | ${p?.summary ?? e.snippet ?? ""}`;
                })
                .join("\n")
            : `No emails found matching "${query}". The user's inbox may not be fully synced - let them know to click the reload button to sync newer emails, or try a shorter/different search term.`;
      } else if (
        tc.function?.name === "search_emails" &&
        (!supabase || !userId)
      ) {
        const query = ((args.query as string) ?? "").toLowerCase();
        const matches = context.recentEmails
          .filter(
            (e) =>
              e.subject.toLowerCase().includes(query) ||
              (e.sender?.toLowerCase() ?? "").includes(query) ||
              e.sender_email.toLowerCase().includes(query) ||
              (e.summary?.toLowerCase() ?? "").includes(query),
          )
          .slice(0, 10);
        toolResult =
          matches.length > 0
            ? "Found emails:\n" +
              matches
                .map(
                  (e) =>
                    `[${e.id}] ${e.date.split("T")[0]} From: ${e.sender || e.sender_email} | ${e.subject} | ${e.summary ?? ""}`,
                )
                .join("\n")
            : "No emails found matching that query.";
      } else if (
        tc.function?.name === "search_emails_by_sender" &&
        supabase &&
        userId
      ) {
        const sender = ((args.sender as string) ?? "").trim();
        const { data: results } = await supabase
          .from("emails")
          .select(
            "id, subject, sender, sender_email, received_at, snippet, email_processed(summary)",
          )
          .eq("user_id", userId)
          .or(`sender_email.ilike.%${sender}%,sender.ilike.%${sender}%`)
          .order("received_at", { ascending: false })
          .limit(20);
        const emails = results ?? [];
        toolResult =
          emails.length > 0
            ? `Found ${emails.length} emails from "${sender}":\n` +
              emails
                .map((e: any) => {
                  const p = Array.isArray(e.email_processed)
                    ? e.email_processed[0]
                    : e.email_processed;
                  return `[${e.id}] ${e.received_at?.split("T")[0]} From: ${e.sender || e.sender_email} | ${e.subject} | ${p?.summary ?? e.snippet ?? ""}`;
                })
                .join("\n")
            : `No emails found from "${sender}". The inbox may not be fully synced - suggest the user click the reload button to fetch newer emails.`;
      } else if (
        tc.function?.name === "search_emails_by_date" &&
        supabase &&
        userId
      ) {
        const startDate = (args.start_date as string) ?? "";
        const endDate =
          (args.end_date as string) ?? new Date().toISOString().split("T")[0];
        const { data: results } = await supabase
          .from("emails")
          .select(
            "id, subject, sender, sender_email, received_at, snippet, email_processed(summary)",
          )
          .eq("user_id", userId)
          .gte("received_at", `${startDate}T00:00:00`)
          .lte("received_at", `${endDate}T23:59:59`)
          .order("received_at", { ascending: false })
          .limit(20);
        const emails = results ?? [];
        toolResult =
          emails.length > 0
            ? `Found ${emails.length} emails between ${startDate} and ${endDate}:\n` +
              emails
                .map((e: any) => {
                  const p = Array.isArray(e.email_processed)
                    ? e.email_processed[0]
                    : e.email_processed;
                  return `[${e.id}] ${e.received_at?.split("T")[0]} From: ${e.sender || e.sender_email} | ${e.subject} | ${p?.summary ?? e.snippet ?? ""}`;
                })
                .join("\n")
            : `No emails found between ${startDate} and ${endDate}.`;
      } else if (
        tc.function?.name === "search_emails_by_sender_and_date" &&
        supabase &&
        userId
      ) {
        const sender = ((args.sender as string) ?? "").trim();
        const startDate = (args.start_date as string) ?? "";
        const endDate =
          (args.end_date as string) ?? new Date().toISOString().split("T")[0];
        const { data: results } = await supabase
          .from("emails")
          .select(
            "id, subject, sender, sender_email, received_at, snippet, email_processed(summary)",
          )
          .eq("user_id", userId)
          .or(`sender_email.ilike.%${sender}%,sender.ilike.%${sender}%`)
          .gte("received_at", `${startDate}T00:00:00`)
          .lte("received_at", `${endDate}T23:59:59`)
          .order("received_at", { ascending: false })
          .limit(20);
        const emails = results ?? [];
        toolResult =
          emails.length > 0
            ? `Found ${emails.length} emails from "${sender}" between ${startDate} and ${endDate}:\n` +
              emails
                .map((e: any) => {
                  const p = Array.isArray(e.email_processed)
                    ? e.email_processed[0]
                    : e.email_processed;
                  return `[${e.id}] ${e.received_at?.split("T")[0]} From: ${e.sender || e.sender_email} | ${e.subject} | ${p?.summary ?? e.snippet ?? ""}`;
                })
                .join("\n")
            : `No emails found from "${sender}" between ${startDate} and ${endDate}.`;
      } else if (tc.function?.name === "get_email" && supabase && userId) {
        const id = (args.id as string) ?? "";
        const { data: email } = await supabase
          .from("emails")
          .select(
            "id, subject, sender, sender_email, recipients, received_at, body_text, snippet, thread_id, gmail_id, label_ids, email_processed(summary, category)",
          )
          .eq("user_id", userId)
          .eq("id", id)
          .maybeSingle();
        if (!email) {
          toolResult = `Email with ID "${id}" not found.`;
        } else {
          const p = Array.isArray((email as any).email_processed)
            ? (email as any).email_processed[0]
            : (email as any).email_processed;
          const body =
            (email as any).body_text ?? (email as any).snippet ?? "(no body)";
          toolResult = `Email ID: ${(email as any).id}\nDate: ${(email as any).received_at?.split("T")[0]}\nFrom: ${(email as any).sender || (email as any).sender_email}\nTo: ${(email as any).recipients ?? ""}\nSubject: ${(email as any).subject}\nCategory: ${p?.category ?? "unknown"}\nSummary: ${p?.summary ?? ""}\n\nBody:\n${body.slice(0, 3000)}`;
        }
      } else if (
        tc.function?.name === "get_sent_emails" &&
        supabase &&
        userId
      ) {
        const limit = Math.min(Math.max(1, Number(args.limit) || 10), 50);
        const { data: results } = await supabase
          .from("emails")
          .select(
            "id, subject, sender, sender_email, recipients, received_at, snippet",
          )
          .eq("user_id", userId)
          .contains("label_ids", ["SENT"])
          .order("received_at", { ascending: false })
          .limit(limit);
        const emails = results ?? [];
        toolResult =
          emails.length > 0
            ? `${emails.length} sent emails:\n` +
              emails
                .map(
                  (e: any) =>
                    `[${e.id}] ${e.received_at?.split("T")[0]} To: ${e.recipients ?? ""} | ${e.subject}`,
                )
                .join("\n")
            : "No sent emails found.";
      } else if (tc.function?.name === "list_todos" && supabase && userId) {
        const filter = (args.filter as string) ?? "pending";
        let query = supabase
          .from("todos")
          .select("id, text, is_completed, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50);
        if (filter === "pending") query = query.eq("is_completed", false);
        else if (filter === "completed") query = query.eq("is_completed", true);
        const { data: todos } = await query;
        const items = todos ?? [];
        toolResult =
          items.length > 0
            ? `${items.length} todos (${filter}):\n` +
              items
                .map(
                  (t: any) =>
                    `[${t.id}] [${t.is_completed ? "done" : "pending"}] ${t.text}`,
                )
                .join("\n")
            : `No ${filter} todos found.`;
      } else if (tc.function?.name === "update_todo" && supabase && userId) {
        const id = (args.id as string) ?? "";
        const updates: Record<string, unknown> = {};
        if (args.text !== undefined) updates.text = args.text;
        if (args.is_completed !== undefined)
          updates.is_completed = args.is_completed;
        if (Object.keys(updates).length === 0) {
          toolResult = "No updates provided.";
        } else {
          const { error } = await supabase
            .from("todos")
            .update(updates)
            .eq("id", id)
            .eq("user_id", userId);
          toolResult = error
            ? `Failed to update todo: ${error.message}`
            : `Todo updated successfully.`;
        }
      } else if (tc.function?.name === "delete_todo" && supabase && userId) {
        const id = (args.id as string) ?? "";
        const { error } = await supabase
          .from("todos")
          .delete()
          .eq("id", id)
          .eq("user_id", userId);
        toolResult = error
          ? `Failed to delete todo: ${error.message}`
          : "Todo deleted.";
      } else if (tc.function?.name === "list_meetings" && supabase && userId) {
        const filter = (args.filter as string) ?? "upcoming";
        const limit = Math.min(Math.max(1, Number(args.limit) || 10), 50);
        const now = new Date().toISOString();
        let query = supabase
          .from("meetings")
          .select(
            "id, title, description, start_time, end_time, attendees, location, zoom_link, status",
          )
          .eq("user_id", userId)
          .limit(limit);
        if (filter === "upcoming")
          query = query
            .gte("start_time", now)
            .order("start_time", { ascending: true });
        else if (filter === "past")
          query = query
            .lt("start_time", now)
            .order("start_time", { ascending: false });
        else query = query.order("start_time", { ascending: true });
        const { data: meetings } = await query;
        const items = meetings ?? [];
        toolResult =
          items.length > 0
            ? `${items.length} meetings (${filter}):\n` +
              items
                .map(
                  (m: any) =>
                    `[${m.id}] ${m.start_time?.split("T")[0]} ${m.start_time?.split("T")[1]?.slice(0, 5) ?? ""} - ${m.title}${m.attendees?.length ? ` | Attendees: ${m.attendees.join(", ")}` : ""}${m.zoom_link ? ` | Zoom: ${m.zoom_link}` : ""}${m.status !== "confirmed" ? ` | Status: ${m.status}` : ""}`,
                )
                .join("\n")
            : `No ${filter} meetings found.`;
      } else if (tc.function?.name === "update_meeting" && supabase && userId) {
        const id = (args.id as string) ?? "";
        const updates: Record<string, unknown> = {};
        if (args.title !== undefined) updates.title = args.title;
        if (args.start_time !== undefined) updates.start_time = args.start_time;
        if (args.end_time !== undefined) updates.end_time = args.end_time;
        if (args.attendees !== undefined) updates.attendees = args.attendees;
        if (args.description !== undefined)
          updates.description = args.description;
        if (Object.keys(updates).length === 0) {
          toolResult = "No updates provided.";
        } else {
          const { error } = await supabase
            .from("meetings")
            .update(updates)
            .eq("id", id)
            .eq("user_id", userId);
          toolResult = error
            ? `Failed to update meeting: ${error.message}`
            : "Meeting updated successfully.";
        }
      } else if (tc.function?.name === "delete_meeting" && supabase && userId) {
        const id = (args.id as string) ?? "";
        const { error } = await supabase
          .from("meetings")
          .delete()
          .eq("id", id)
          .eq("user_id", userId);
        toolResult = error
          ? `Failed to delete meeting: ${error.message}`
          : "Meeting deleted.";
      } else if (tc.function?.name === "list_drafts" && supabase && userId) {
        const limit = Math.min(Math.max(1, Number(args.limit) || 10), 50);
        const { data: drafts } = await supabase
          .from("draft_emails")
          .select("id, subject, to_addresses, body_html, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(limit);
        const items = drafts ?? [];
        toolResult =
          items.length > 0
            ? `${items.length} drafts:\n` +
              items
                .map(
                  (d: any) =>
                    `[${d.id}] ${d.created_at?.split("T")[0]} To: ${Array.isArray(d.to_addresses) ? d.to_addresses.join(", ") : d.to_addresses} | ${d.subject}`,
                )
                .join("\n")
            : "No drafts found.";
      } else if (tc.function?.name === "delete_draft" && supabase && userId) {
        const id = (args.id as string) ?? "";
        const { error } = await supabase
          .from("draft_emails")
          .delete()
          .eq("id", id)
          .eq("user_id", userId);
        toolResult = error
          ? `Failed to delete draft: ${error.message}`
          : "Draft deleted.";
      } else if (
        tc.function?.name === "get_read_receipts" &&
        supabase &&
        userId
      ) {
        const limit = Math.min(Math.max(1, Number(args.limit) || 10), 50);
        const { data: receipts } = await supabase
          .from("read_receipts")
          .select(
            "id, subject, recipient_email, open_count, first_opened_at, last_opened_at, created_at",
          )
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(limit);
        const items = receipts ?? [];
        toolResult =
          items.length > 0
            ? `${items.length} read receipts:\n` +
              items
                .map(
                  (r: any) =>
                    `[${r.id}] "${r.subject}" → ${r.recipient_email} | Opens: ${r.open_count}${r.first_opened_at ? ` | First opened: ${r.first_opened_at.split("T")[0]}` : " | Not yet opened"}`,
                )
                .join("\n")
            : "No read receipts found.";
      } else if (tc.function?.name === "archive_email" && supabase && userId) {
        const id = (args.id as string) ?? "";
        const { error } = await supabase
          .from("emails")
          .update({ is_archived: true })
          .eq("id", id)
          .eq("user_id", userId);
        toolResult = error
          ? `Failed to archive email: ${error.message}`
          : "Email archived.";
      } else if (
        tc.function?.name === "get_email_thread" &&
        supabase &&
        userId
      ) {
        const threadId = (args.thread_id as string) ?? "";
        const { data: threadEmails } = await supabase
          .from("emails")
          .select(
            "id, subject, sender, sender_email, received_at, body_text, snippet",
          )
          .eq("user_id", userId)
          .eq("thread_id", threadId)
          .order("received_at", { ascending: true })
          .limit(20);
        const emails = threadEmails ?? [];
        toolResult =
          emails.length > 0
            ? `Thread (${emails.length} emails):\n` +
              emails
                .map(
                  (e: any) =>
                    `[${e.id}] ${e.received_at?.split("T")[0]} From: ${e.sender || e.sender_email} | ${e.subject}\n${((e.body_text ?? e.snippet ?? "") as string).slice(0, 500)}`,
                )
                .join("\n---\n")
            : `No emails found for thread_id "${threadId}".`;
      } else if (tc.function?.name === "list_tags" && supabase && userId) {
        const { data: tags } = await supabase
          .from("categories")
          .select("id, slug, display_name, color")
          .eq("user_id", userId)
          .order("display_name", { ascending: true });
        const items = tags ?? [];
        toolResult =
          items.length > 0
            ? `${items.length} tags:\n` +
              items
                .map(
                  (t: any) =>
                    `[${t.id}] ${t.display_name} (slug: ${t.slug}, color: ${t.color})`,
                )
                .join("\n")
            : "No tags found. Use create_tag to create one.";
      } else if (tc.function?.name === "apply_tag" && supabase && userId) {
        const emailId = (args.email_id as string) ?? "";
        const tagSlug = (args.tag_slug as string) ?? "";
        const { data: ep } = await supabase
          .from("email_processed")
          .select("extra_labels")
          .eq("email_id", emailId)
          .eq("user_id", userId)
          .maybeSingle();
        const current: string[] = Array.isArray(ep?.extra_labels)
          ? ep.extra_labels
          : [];
        if (current.includes(tagSlug)) {
          toolResult = `Tag "${tagSlug}" is already applied to this email.`;
        } else {
          const { error } = await supabase
            .from("email_processed")
            .update({ extra_labels: [...current, tagSlug] })
            .eq("email_id", emailId)
            .eq("user_id", userId);
          toolResult = error
            ? `Failed to apply tag: ${error.message}`
            : `Tag "${tagSlug}" applied to email.`;
        }
      } else if (tc.function?.name === "remove_tag" && supabase && userId) {
        const emailId = (args.email_id as string) ?? "";
        const tagSlug = (args.tag_slug as string) ?? "";
        const { data: ep } = await supabase
          .from("email_processed")
          .select("extra_labels")
          .eq("email_id", emailId)
          .eq("user_id", userId)
          .maybeSingle();
        const current: string[] = Array.isArray(ep?.extra_labels)
          ? ep.extra_labels
          : [];
        const { error } = await supabase
          .from("email_processed")
          .update({ extra_labels: current.filter((l) => l !== tagSlug) })
          .eq("email_id", emailId)
          .eq("user_id", userId);
        toolResult = error
          ? `Failed to remove tag: ${error.message}`
          : `Tag "${tagSlug}" removed from email.`;
      } else {
        // These tools are executed by the caller (index.ts) after this function returns.
        // Tell the model they succeeded so it confirms in past tense.
        toolResult = `Done. "${tc.function?.name}" executed successfully.`;
      }

      messages.push({ role: "tool", tool_call_id: tc.id, content: toolResult });
    }
  }

  // Fallback: get final response after tool rounds
  const finalData = await callAPI();
  const finalReply = stripThinkTags(
    finalData.choices?.[0]?.message?.content ?? "",
  );
  return {
    reply: finalReply || "I've completed the requested actions.",
    tool_calls: allToolCalls,
  };
}
