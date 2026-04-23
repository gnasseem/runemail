/**
 * Tool definitions for the Solve-Everything conversational agent.
 *
 * The agent has two categories of tools:
 *
 *   1. READ tools — return a string context that flows back into the
 *      conversation. Used by the model to gather context before acting.
 *      (search_emails, get_thread, past_replies_by_me, calendar_freebusy,
 *       user_style_profile)
 *
 *   2. CONTROL tools — signal a transition in the agent state machine.
 *      They are handled specially by `agentLoop.ts`:
 *        - ask_user     -> pauses the loop; frontend renders a QuestionCard
 *        - propose_action / revise_action -> stages a draft action
 *        - finalize     -> marks the plan ready for user review
 *
 * The model may call multiple read tools in one round, then either call a
 * single control tool (ask_user / finalize) or emit more proposals.
 */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

/** JSON schema for the OpenAI / OpenRouter / Cerebras tool API. */
export const AGENT_TOOLS = [
  // ── Read tools ────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "get_briefing_context",
      description:
        "Get the current briefing context (all emails the user is trying to clear). Returns a compact list of each card with id, sender, subject, summary, category (crucial/replyNeeded/deadlines/nonEssential), urgency, deadline. Call this FIRST before anything else so you know what you are working with.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_thread",
      description:
        "Read the full email body and thread context for a briefing email. Use this before proposing a reply or meeting so you can write in context. Returns subject, from, date, body text, and any prior thread messages.",
      parameters: {
        type: "object",
        properties: {
          email_id: { type: "string", description: "UUID of the email" },
        },
        required: ["email_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_emails",
      description:
        "Search the user's wider inbox history beyond the current briefing for related emails. Useful to check past context with a sender or topic.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Keyword, sender name, or email address.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "past_replies_by_me",
      description:
        "Find recent emails the USER themselves sent to a given person or topic. Use to match the user's voice/tone before drafting a reply.",
      parameters: {
        type: "object",
        properties: {
          to: {
            type: "string",
            description: "Recipient name or email address.",
          },
          topic: {
            type: "string",
            description: "Optional topic keyword to narrow results.",
          },
        },
        required: ["to"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calendar_freebusy",
      description:
        "Get the user's existing meetings within a date range so you can find free slots for proposing meeting times. Returns a list of busy blocks (start/end). Combine with working hours to suggest 2-3 concrete open slots and present them via ask_user.",
      parameters: {
        type: "object",
        properties: {
          from_iso: {
            type: "string",
            description:
              "Start of range in ISO 8601 (user's local timezone). Default: now.",
          },
          to_iso: {
            type: "string",
            description:
              "End of range in ISO 8601. Default: 7 days after from_iso.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "user_style_profile",
      description:
        "Return the user's preferred greeting, closing, tone, and typical email length. ALWAYS call this before drafting any reply so the voice matches.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },

  // ── Control tools ─────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "ask_user",
      description:
        "Pause the agent and ask the user clarifying questions. Supports BATCHING: you can emit 1-5 independent questions in a single call via the `questions` array (the UI renders them as a grid so the user answers them all at once). Only use a single question when decisions chain. Every question needs 2-4 concrete options (each with optional preview + recommended flag) plus an allow_custom flag. Never assume — always ask if a decision depends on unknown context. The agent resumes automatically after the user answers.",
      parameters: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            description:
              "1-5 independent decision cards. Prefer batching when questions do not depend on each other's answers.",
            items: {
              type: "object",
              properties: {
                eyebrow: {
                  type: "string",
                  description:
                    "Short uppercase context label, e.g. 'REPLY TO HANAN', 'MEETING WITH TAHSIN', 'ARCHIVE NEWSLETTERS'.",
                },
                question: {
                  type: "string",
                  description:
                    "The one-sentence question to the user. Specific and concrete.",
                },
                brief: {
                  type: "string",
                  description:
                    "2-3 sentence brief about the underlying situation so the user has full context without having to re-read the email. Mention sender name, key ask, dates, amounts.",
                },
                options: {
                  type: "array",
                  description: "2-4 option cards the user can pick.",
                  items: {
                    type: "object",
                    properties: {
                      id: {
                        type: "string",
                        description:
                          "Stable short identifier, e.g. 'draft_short_reply'.",
                      },
                      label: {
                        type: "string",
                        description:
                          "Short tappable label, e.g. 'Ask her to email it instead'.",
                      },
                      rationale: {
                        type: "string",
                        description:
                          "One-line reason this option exists (why the agent surfaced it).",
                      },
                      preview: {
                        type: "string",
                        description:
                          "Optional: the draft body / datetime / todo text this option would produce.",
                      },
                      recommended: {
                        type: "boolean",
                        description:
                          "Set to true on the ONE option the agent thinks is most likely the best choice given context. The UI pre-selects and badges it. Omit/false on the other options. At most one option per question should have recommended=true.",
                      },
                    },
                    required: ["id", "label"],
                  },
                },
                allow_custom: {
                  type: "boolean",
                  description:
                    "If true, the UI shows a custom text box. Default true.",
                },
                related_email_id: {
                  type: "string",
                  description:
                    "Optional: the briefing email this question is about, for UI linking.",
                },
              },
              required: ["eyebrow", "question", "brief", "options"],
            },
          },
          // Back-compat: single-question shape. New code should use `questions[]`.
          eyebrow: { type: "string" },
          question: { type: "string" },
          brief: { type: "string" },
          options: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                label: { type: "string" },
                rationale: { type: "string" },
                preview: { type: "string" },
                recommended: { type: "boolean" },
              },
              required: ["id", "label"],
            },
          },
          allow_custom: { type: "boolean" },
          related_email_id: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_action",
      description:
        "Stage a concrete action to be included in the final plan. Do NOT call this if the action requires a decision the user has not made yet — use ask_user first. You may propose multiple actions across multiple rounds.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["reply", "todo", "meeting", "archive"],
            description: "The kind of action.",
          },
          reasoning: {
            type: "string",
            description:
              "REQUIRED. One first-person-style sentence explaining why THIS action is right for THIS user given their style, past replies with this sender, and the specific ask. If you cannot write this truthfully, call more read tools first before proposing.",
          },
          priority: {
            type: "string",
            enum: ["high", "medium", "low"],
            description: "How important the agent considers this action.",
          },
          linked_email_id: {
            type: "string",
            description:
              "The briefing email this action is based on, if applicable.",
          },
          // reply payload
          to: {
            type: "string",
            description: "Reply: recipient email address.",
          },
          subject: {
            type: "string",
            description: "Reply: subject line (include 'Re: ' for threads).",
          },
          body: {
            type: "string",
            description:
              "Reply: full body text matching the user's voice (call user_style_profile first).",
          },
          send_now: {
            type: "boolean",
            description:
              "Reply default intent: true = send on confirm, false = save as draft. Default TRUE; the user can flip to draft per-reply in the review UI. Only set false when the reply is risky (legal, placeholder content, needs personal review).",
          },
          resolve_only: {
            type: "boolean",
            description:
              "Reply-only flag. Set true when the user answered the reply-confirm question with 'mark resolved, no email sent'. The executor skips both sending and drafting and just marks the source email handled.",
          },
          // todo payload
          title: {
            type: "string",
            description:
              "Todo: the task title (self-explanatory, e.g. 'Sign last page of NYU employment agreement').",
          },
          due: {
            type: "string",
            description: "Todo: optional due date YYYY-MM-DD.",
          },
          // meeting payload
          meeting_title: {
            type: "string",
            description: "Meeting: event title.",
          },
          start_iso: {
            type: "string",
            description:
              "Meeting: ISO 8601 start (user's local timezone, no Z).",
          },
          duration_mins: {
            type: "number",
            description: "Meeting: duration in minutes (15-240).",
          },
          attendees: {
            type: "array",
            items: { type: "string" },
            description: "Meeting: attendee email addresses.",
          },
          include_zoom: {
            type: "boolean",
            description: "Meeting: true to add a Zoom link. Default false.",
          },
          // archive payload
          email_ids: {
            type: "array",
            items: { type: "string" },
            description:
              "Archive: list of email UUIDs to archive together (group newsletters in batches).",
          },
          summary: {
            type: "string",
            description:
              "Archive: one-line description of what's being archived, e.g. '35 newsletters and receipts'.",
          },
        },
        required: ["type", "reasoning"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "revise_action",
      description:
        "Update or replace a previously proposed action, e.g. after the user answered an ask_user question that reshapes its payload.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The id of the action from the draft list.",
          },
          patch: {
            type: "object",
            description:
              "Partial payload to merge onto the action. Use the same field names as propose_action.",
          },
        },
        required: ["id", "patch"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "discard_action",
      description:
        "Remove a previously proposed action from the draft plan (e.g. the user decided it is not needed).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The action id to remove." },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finalize",
      description:
        "Call this ONLY when every unanswered question is resolved and every proposed action reflects a confirmed decision. Ends the planning phase. Include a one-paragraph summary of what the plan will do for the user.",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description:
              "One-paragraph plain-language summary of the full plan.",
          },
        },
        required: ["summary"],
      },
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Read tool implementations
// ─────────────────────────────────────────────────────────────────────────

export interface BriefingCard {
  email_id?: string;
  subject?: string;
  sender?: string;
  senderName?: string;
  summary?: string;
  urgency?: string;
  deadline?: string | null;
  waitingForReply?: boolean;
  tags?: string[];
}

export interface AgentToolContext {
  supabase: SupabaseClient;
  userId: string;
  timezone: string; // IANA
  briefingCards: {
    crucial: BriefingCard[];
    replyNeeded: BriefingCard[];
    deadlines: BriefingCard[];
    nonEssential: BriefingCard[];
  };
}

export async function runReadTool(
  name: string,
  args: Record<string, unknown>,
  ctx: AgentToolContext,
): Promise<string> {
  const { supabase, userId, briefingCards } = ctx;
  switch (name) {
    case "get_briefing_context": {
      const fmt = (cards: BriefingCard[], bucket: string) =>
        cards
          .map((c) => {
            const id = c.email_id ?? "no-id";
            return `[${id}] (${bucket}${c.deadline ? ` due ${c.deadline}` : ""}${c.urgency ? ` · ${c.urgency}` : ""}) From: ${c.senderName ?? c.sender ?? "Unknown"} | Subject: ${c.subject ?? ""} | ${c.summary ?? ""}`;
          })
          .join("\n");
      const sections = [
        briefingCards.crucial.length
          ? `CRUCIAL:\n${fmt(briefingCards.crucial, "crucial")}`
          : "",
        briefingCards.replyNeeded.length
          ? `REPLY NEEDED:\n${fmt(briefingCards.replyNeeded, "reply")}`
          : "",
        briefingCards.deadlines.length
          ? `DEADLINES:\n${fmt(briefingCards.deadlines, "deadline")}`
          : "",
        briefingCards.nonEssential.length
          ? `NON-ESSENTIAL:\n${fmt(briefingCards.nonEssential, "noise")}`
          : "",
      ].filter(Boolean);
      return sections.length
        ? sections.join("\n\n")
        : "The briefing is empty; there is nothing to solve.";
    }

    case "get_thread": {
      const emailId = String(args.email_id ?? "");
      if (!emailId) return "email_id is required.";
      const { data: email } = await supabase
        .from("emails")
        .select(
          "id, subject, sender, sender_email, received_at, body_text, snippet, thread_id, email_processed(summary)",
        )
        .eq("id", emailId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!email) return "Email not found.";
      const body = (email.body_text ?? email.snippet ?? "").slice(0, 4000);
      let threadPart = "";
      if (email.thread_id) {
        const { data: thread } = await supabase
          .from("emails")
          .select(
            "id, subject, sender, sender_email, received_at, body_text, snippet",
          )
          .eq("user_id", userId)
          .eq("thread_id", email.thread_id)
          .order("received_at", { ascending: true })
          .limit(20);
        if (thread && thread.length > 1) {
          threadPart =
            "\n\nFull thread (oldest first):\n" +
            thread
              .map(
                (m: any) =>
                  `[${m.id}] ${m.received_at?.split("T")[0]} From: ${m.sender ?? m.sender_email}\n${(m.body_text ?? m.snippet ?? "").slice(0, 1200)}`,
              )
              .join("\n---\n");
        }
      }
      return `[${email.id}] ${email.received_at?.split("T")[0]} From: ${email.sender ?? email.sender_email}\nSubject: ${email.subject}\n\n${body}${threadPart}`;
    }

    case "search_emails": {
      const q = String(args.query ?? "").trim();
      if (!q) return "query is required.";
      const { data: results } = await supabase
        .from("emails")
        .select(
          "id, subject, sender, sender_email, received_at, snippet, email_processed(summary)",
        )
        .eq("user_id", userId)
        .or(
          `subject.ilike.%${q}%,sender.ilike.%${q}%,sender_email.ilike.%${q}%,body_text.ilike.%${q}%`,
        )
        .order("received_at", { ascending: false })
        .limit(12);
      if (!results?.length) return `No emails found matching "${q}".`;
      return (
        "Matches:\n" +
        results
          .map((e: any) => {
            const p = Array.isArray(e.email_processed)
              ? e.email_processed[0]
              : e.email_processed;
            return `[${e.id}] ${e.received_at?.split("T")[0]} From: ${e.sender ?? e.sender_email} | ${e.subject} | ${p?.summary ?? e.snippet ?? ""}`;
          })
          .join("\n")
      );
    }

    case "past_replies_by_me": {
      const to = String(args.to ?? "").trim();
      const topic = String(args.topic ?? "").trim();
      if (!to) return "to is required.";
      let query = supabase
        .from("emails")
        .select("id, subject, sender, received_at, body_text, snippet")
        .eq("user_id", userId)
        .contains("label_ids", ["SENT"])
        .order("received_at", { ascending: false })
        .limit(8);
      const orParts: string[] = [];
      orParts.push(`to_recipients.ilike.%${to}%`);
      orParts.push(`subject.ilike.%${to}%`);
      query = query.or(orParts.join(","));
      if (topic) query = query.ilike("subject", `%${topic}%`);
      const { data } = await query;
      if (!data?.length) {
        return `No prior sent emails matching ${to}${topic ? ` / "${topic}"` : ""}. User has no history with this recipient.`;
      }
      return (
        "Past user-authored emails (to match voice):\n" +
        data
          .map(
            (e: any) =>
              `[${e.id}] ${e.received_at?.split("T")[0]} Subject: ${e.subject}\n${(e.body_text ?? e.snippet ?? "").slice(0, 800)}`,
          )
          .join("\n---\n")
      );
    }

    case "calendar_freebusy": {
      const fromIso = String(args.from_iso ?? "") || new Date().toISOString();
      const toIso =
        String(args.to_iso ?? "") ||
        new Date(Date.now() + 7 * 86400000).toISOString();
      const { data: meetings } = await supabase
        .from("meetings")
        .select("id, title, start_time, end_time, attendees")
        .eq("user_id", userId)
        .gte("start_time", fromIso)
        .lte("start_time", toIso)
        .order("start_time", { ascending: true });
      if (!meetings?.length)
        return `No meetings scheduled between ${fromIso} and ${toIso}. Any slot in working hours is open.`;
      return (
        `Existing busy blocks between ${fromIso} and ${toIso}:\n` +
        meetings
          .map(
            (m: any) =>
              `- ${m.start_time} -> ${m.end_time}: ${m.title} (${(m.attendees ?? []).join(", ")})`,
          )
          .join("\n") +
        `\n\nSuggest 2-3 open slots in the user's working hours that do not overlap any block, then call ask_user with those as options.`
      );
    }

    case "user_style_profile": {
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, style_notes, working_hours")
        .eq("id", userId)
        .maybeSingle();
      const styleNotes = (profile?.style_notes as string) || "";
      let greeting = "Hi";
      let closing = "Thanks";
      let tone = "mixed";
      let avgLength = "medium";
      try {
        if (styleNotes) {
          const parsed = JSON.parse(styleNotes);
          greeting = parsed.greeting_style ?? greeting;
          closing = parsed.closing_style ?? closing;
          tone = parsed.tone ?? tone;
          avgLength = parsed.avg_length ?? avgLength;
        }
      } catch {
        /* style_notes may be free text */
      }
      const workingHours =
        (profile?.working_hours as {
          start?: string;
          end?: string;
          days?: number[];
        } | null) ?? null;
      return JSON.stringify({
        display_name: profile?.display_name ?? "",
        greeting_style: greeting,
        closing_style: closing,
        tone,
        avg_length: avgLength,
        working_hours: workingHours,
        timezone: ctx.timezone,
      });
    }

    default:
      return `Unknown read tool: ${name}`;
  }
}

export const READ_TOOL_NAMES = new Set([
  "get_briefing_context",
  "get_thread",
  "search_emails",
  "past_replies_by_me",
  "calendar_freebusy",
  "user_style_profile",
]);

export const CONTROL_TOOL_NAMES = new Set([
  "ask_user",
  "propose_action",
  "revise_action",
  "discard_action",
  "finalize",
]);
