/**
 * Shared briefing builder.
 *
 * Staged pipeline: deterministic triage from DB categories, capped LLM refinement
 * for Auto-Resolve fields and bucket tuning, then a separate executive summary
 * from a compact digest so large inboxes do not require one giant JSON object.
 */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  briefingSummaryNeedsRecovery,
  generateBriefingExecutiveSummary,
  refineBriefingCards,
} from "./ai.ts";

type BriefingScope = "today_new" | "today_unread" | "past_week" | "all_recent";

type Bucket = "crucial" | "replyNeeded" | "deadlines" | "nonEssential";

const REFINE_BATCH_CAP = 32;

const BROADCAST_LOW_STAKE =
  /\b(needs your vote|cast your vote|vote for|your vote|voting for|petition|sign the petition|take our survey|complete this survey|poll closes|election day|student government|sga election|run for|candidate for|senator|congress)\b/i;

/** Mass civic or vote solicitation (often mis-tagged "important"). */
const VOTE_OR_CIVIC_BODY =
  /\b(vote for|your vote|needs your vote|cast your vote|election|candidate|petition|campaign|student government)\b/i;

/** Casual article or science FYI with no obligation to respond. */
const LOW_STAKES_FYI_SHARE =
  /\b(shares (an |this )?(interesting )?article|interesting article|thought you('d)? enjoy|sharing (an |this )?article|for your (reading|interest)|explaining what|cool (read|link))\b/i;

function extractAddressFromSender(sender: string): string | null {
  const m = sender.match(/<([^>]+)>/);
  const raw = (m ? m[1] : sender).trim().toLowerCase();
  return raw.includes("@") ? raw : null;
}

function hasExplicitReplyAsk(blob: string): boolean {
  return /\b(please (reply|respond|confirm|let me know)|need your (answer|response|signature|approval)|reply by|respond by|rsvp|deadline|due (by|on)|can you|could you)\b/i
    .test(blob);
}

/** When category is "important" but content is promotion or low-stakes FYI. */
function shouldDemoteImportantToNonEssential(
  subject: string,
  blob: string,
  knownSender: boolean,
): boolean {
  const b = blob.toLowerCase();
  if (hasExplicitReplyAsk(b)) return false;
  if (BROADCAST_LOW_STAKE.test(b) || VOTE_OR_CIVIC_BODY.test(b)) return true;
  if (LOW_STAKES_FYI_SHARE.test(b)) return true;
  const subj = (subject || "").trim();
  if (
    subj.length <= 28 &&
    !subj.includes("?") &&
    /\b(entropy|physics|science|article)\b/i.test(b) &&
    /\b(shar(es|ed)|interesting|explaining)\b/i.test(b)
  ) {
    return true;
  }
  if (!knownSender && VOTE_OR_CIVIC_BODY.test(subj.toLowerCase())) return true;
  return false;
}

export interface NormalizedBriefing {
  executiveSummary: string;
  crucial: unknown[];
  replyNeeded: unknown[];
  deadlines: unknown[];
  nonEssential: unknown[];
  stats: {
    total: number;
    crucial: number;
    replyNeeded: number;
    deadlines: number;
    nonEssential: number;
  };
}

function firstProcessed(e: {
  email_processed?: unknown;
}): {
  category?: string;
  urgency?: string | null;
  summary?: string | null;
  quick_actions?: unknown;
} | null {
  const p = e.email_processed;
  if (!p) return null;
  return (Array.isArray(p) ? p[0] : p) as {
    category?: string;
    urgency?: string | null;
    summary?: string | null;
    quick_actions?: unknown;
  };
}

function isAutoSender(sender: string): boolean {
  return /no.?reply|noreply|notifications?|donotreply|mailer-daemon/i.test(
    sender ?? "",
  );
}

function hasReplyQuickAction(q: unknown): boolean {
  if (!Array.isArray(q)) return false;
  return q.some(
    (a) =>
      a &&
      typeof a === "object" &&
      String((a as { action?: string }).action).toLowerCase() === "reply",
  );
}

function baseCard(
  row: {
    id: string;
    subject?: string | null;
    sender?: string | null;
    snippet?: string | null;
  },
  p: ReturnType<typeof firstProcessed>,
): Record<string, unknown> {
  const summary = (p?.summary || row.snippet || "").trim();
  const senderName =
    (row.sender || "").split("<")[0]?.trim() || row.sender || "";
  return {
    subject: row.subject ?? "",
    senderName,
    sender: row.sender ?? "",
    summary: summary || "(no summary)",
    urgency: "medium",
    deadline: null,
    waitingForReply: false,
    tags: [] as string[],
    email_id: row.id,
  };
}

/**
 * Deterministic first pass plus flag for LLM refinement.
 */
const HIGH_STAKES_SIGNALS =
  /\b(job offer|offer letter|interview|application (status|update|result)|hired|shortlisted|rejected|next steps|onboarding|background check|recruiter|offer extended|admission|accepted|financial aid|scholarship|enrollment|legal notice|contract|agreement|court|settlement|lease|appointment|lab results|test results|prescription|diagnosis|referral|mortgage|loan approval|loan denial|credit (application|decision)|account suspended|fraud alert)\b/i;

function triageRow(
  row: {
    id: string;
    subject?: string | null;
    sender?: string | null;
    snippet?: string | null;
    email_processed?: unknown;
  },
  knownSenders: Set<string>,
): { bucket: Bucket; card: Record<string, unknown>; refine: boolean } {
  const p = firstProcessed(row);
  const cat = (p?.category ?? "unknown").toLowerCase();
  const storedUrgency = (p?.urgency ?? "").toLowerCase();
  const isHighUrgency = storedUrgency === "critical" || storedUrgency === "high";
  const auto = isAutoSender(row.sender ?? "");
  const card = {
    ...baseCard(row, p),
    // Honour stored urgency as a floor when it is critical or high.
    ...(isHighUrgency ? { urgency: storedUrgency } : {}),
  };
  const replyQA = hasReplyQuickAction(p?.quick_actions);
  const blob = `${row.subject ?? ""} ${
    p?.summary ?? ""
  } ${row.snippet ?? ""}`.toLowerCase();
  const addr = extractAddressFromSender(row.sender ?? "");
  const knownSender = !!(addr && knownSenders.has(addr));
  const isHighStakes = HIGH_STAKES_SIGNALS.test(row.subject ?? "") ||
    HIGH_STAKES_SIGNALS.test(p?.summary ?? "") ||
    HIGH_STAKES_SIGNALS.test(row.snippet ?? "");

  if (cat === "newsletter") {
    return {
      bucket: "nonEssential",
      card: {
        ...card,
        urgency: "medium",
        suggestedAction: "archive",
        relationshipHint: "auto",
        signal: "Bulk or promotional content.",
        evidence: (String(row.subject ?? "")).slice(0, 80),
      },
      refine: false,
    };
  }

  // High-stakes emails must never land in nonEssential even if sender looks auto.
  if (cat === "informational" && auto && !isHighStakes && !isHighUrgency) {
    return {
      bucket: "nonEssential",
      card: {
        ...card,
        suggestedAction: "archive",
        relationshipHint: "auto",
        signal: "Automated notification.",
        evidence: (String(row.subject ?? "")).slice(0, 80),
      },
      refine: false,
    };
  }

  if (cat === "action-required" || (replyQA && cat !== "newsletter")) {
    return {
      bucket: "replyNeeded",
      card: {
        ...card,
        urgency: "high",
        waitingForReply: true,
        suggestedAction: "reply",
        signal: "Sender is waiting on your response or action.",
        evidence: (String(row.subject ?? "")).slice(0, 80),
      },
      refine: true,
    };
  }

  if (cat === "important") {
    if (
      shouldDemoteImportantToNonEssential(
        String(row.subject ?? ""),
        blob,
        knownSender,
      )
    ) {
      return {
        bucket: "nonEssential",
        card: {
          ...card,
          urgency: "medium",
          suggestedAction: "archive",
          relationshipHint: "stranger",
          signal: "Promotion or casual FYI; no reply expected.",
          evidence: (String(row.subject ?? "")).slice(0, 80),
          tags: ["FYI_OR_PROMO"],
        },
        refine: false,
      };
    }
    return {
      bucket: "crucial",
      card: {
        ...card,
        urgency: "medium",
        suggestedAction: "todo",
        signal: "Worth reading; follow up if needed.",
        evidence: (String(row.subject ?? "")).slice(0, 80),
      },
      refine: true,
    };
  }

  if (cat === "informational" && !auto) {
    return {
      bucket: "crucial",
      card: {
        ...card,
        urgency: "medium",
        suggestedAction: "todo",
        signal: "Review if relevant.",
        evidence: (String(row.subject ?? "")).slice(0, 80),
      },
      refine: true,
    };
  }

  if (cat === "unknown" || !p) {
    if (auto) {
      return {
        bucket: "nonEssential",
        card: {
          ...card,
          suggestedAction: "archive",
          relationshipHint: "auto",
          signal: "Automated or bulk sender.",
          evidence: (String(row.subject ?? "")).slice(0, 80),
        },
        refine: false,
      };
    }
    return {
      bucket: "crucial",
      card: {
        ...card,
        urgency: "medium",
        suggestedAction: "todo",
        signal: "Unclassified; skim to prioritize.",
        evidence: (String(row.subject ?? "")).slice(0, 80),
      },
      refine: true,
    };
  }

  return {
    bucket: "nonEssential",
    card: {
      ...card,
      suggestedAction: "archive",
      relationshipHint: "auto",
      signal: "Low priority for briefing.",
      evidence: (String(row.subject ?? "")).slice(0, 80),
    },
    refine: false,
  };
}

function normBucket(b: unknown): Bucket {
  const s = String(b ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const map: Record<string, Bucket> = {
    crucial: "crucial",
    replyneeded: "replyNeeded",
    reply_needed: "replyNeeded",
    deadlines: "deadlines",
    nonessential: "nonEssential",
    non_essential: "nonEssential",
  };
  return map[s] ?? "crucial";
}

function findCardInBuckets(
  id: string,
  buckets: Record<Bucket, Record<string, unknown>[]>,
): Record<string, unknown> | null {
  for (const k of Object.keys(buckets) as Bucket[]) {
    const found = buckets[k].find(
      (c) => (c as { email_id?: string }).email_id === id,
    );
    if (found) return { ...found };
  }
  return null;
}

function removeIdFromBuckets(
  id: string,
  buckets: Record<Bucket, Record<string, unknown>[]>,
) {
  for (const k of Object.keys(buckets) as Bucket[]) {
    buckets[k] = buckets[k].filter((c) => (c as { email_id?: string }).email_id !== id);
  }
}

function applyFyiAndVoteDemotion(buckets: Record<Bucket, Record<string, unknown>[]>) {
  const scan = [...buckets.crucial];
  for (const card of scan) {
    const sub = String((card as { subject?: string }).subject ?? "");
    const sum = String((card as { summary?: string }).summary ?? "");
    const blob = `${sub} ${sum}`.toLowerCase();
    if (hasExplicitReplyAsk(blob)) continue;
    if (
      !LOW_STAKES_FYI_SHARE.test(blob) &&
      !VOTE_OR_CIVIC_BODY.test(blob) &&
      !(sub.length <= 28 && /\b(entropy|physics)\b/i.test(blob) &&
        /\b(shares|shared|sharing|interesting|explaining)\b/i.test(blob))
    ) {
      continue;
    }
    const id = (card as { email_id?: string }).email_id;
    if (!id) continue;
    removeIdFromBuckets(id, buckets);
    buckets.nonEssential.push({
      ...card,
      urgency: "medium",
      waitingForReply: false,
      suggestedAction: "archive",
      relationshipHint:
        (card as { relationshipHint?: string }).relationshipHint ?? "stranger",
      signal: "FYI or civic content; not briefing priority.",
      tags: [...((card as { tags?: string[] }).tags ?? []), "FYI_OR_PROMO"],
    });
  }
}

function applyBroadcastDowngrade(
  buckets: Record<Bucket, Record<string, unknown>[]>,
) {
  const scan = [...buckets.replyNeeded, ...buckets.crucial];
  for (const card of scan) {
    const sub = String((card as { subject?: string }).subject ?? "");
    const sum = String((card as { summary?: string }).summary ?? "");
    const blob = `${sub} ${sum}`;
    if (!BROADCAST_LOW_STAKE.test(blob)) continue;
    const id = (card as { email_id?: string }).email_id;
    if (!id) continue;
    removeIdFromBuckets(id, buckets);
    buckets.nonEssential.push({
      ...card,
      urgency: "medium",
      waitingForReply: false,
      suggestedAction: "archive",
      relationshipHint:
        (card as { relationshipHint?: string }).relationshipHint ?? "stranger",
      signal: "Broadcast or low-stake civic message; no personal reply expected.",
      tags: [...((card as { tags?: string[] }).tags ?? []), "BROADCAST"],
    });
  }
}

function buildDigestForExecutive(
  buckets: Record<Bucket, Record<string, unknown>[]>,
): string {
  const lines: string[] = [];
  lines.push(
    `Buckets: crucial=${buckets.crucial.length}, replyNeeded=${buckets.replyNeeded.length}, deadlines=${buckets.deadlines.length}, nonEssential=${buckets.nonEssential.length}.`,
  );
  const pick = (arr: Record<string, unknown>[], label: string, n: number) => {
    for (let i = 0; i < Math.min(n, arr.length); i++) {
      const c = arr[i] as {
        subject?: string;
        sender?: string;
        summary?: string;
        signal?: string;
      };
      const sig = c.signal ? ` — ${c.signal}` : "";
      lines.push(
        `[${label}] ${c.subject ?? ""} (from ${c.sender ?? ""})${sig}`,
      );
    }
  };
  pick(buckets.replyNeeded, "reply", 8);
  pick(buckets.deadlines, "deadline", 5);
  pick(buckets.crucial, "crucial", 8);
  if (
    buckets.nonEssential.length > 0 &&
    buckets.crucial.length + buckets.replyNeeded.length === 0
  ) {
    lines.push(
      "Most incoming items are newsletters, receipts, or automated notices.",
    );
  }
  return lines.join("\n");
}

function cleanExecutiveCounts(raw: string): string {
  return raw
    .replace(/\b\d+\s+(emails?|messages?|items?|unread|new)\b/gi, "your inbox")
    .replace(
      /\b(several|a few|many|some|multiple)\s+(emails?|messages?|items?)\b/gi,
      "your inbox",
    )
    .replace(/(your inbox)(\s+(your inbox))+/gi, "your inbox")
    .trim();
}

export async function buildBriefingForUser(
  userId: string,
  supabase: SupabaseClient,
  requestedScope?: BriefingScope,
): Promise<NormalizedBriefing> {
  let scope: BriefingScope = requestedScope ?? "today_new";
  if (!["today_new", "today_unread", "past_week", "all_recent"].includes(scope)) {
    scope = "today_new";
  }
  if (!requestedScope) {
    const { data: userProfile } = await supabase
      .from("profiles")
      .select("briefing_scope")
      .eq("id", userId)
      .single();
    if (userProfile?.briefing_scope) {
      scope = userProfile.briefing_scope as BriefingScope;
    }
  }

  let emailsQuery = supabase
    .from("emails")
    .select(
      "id, subject, sender, snippet, received_at, is_read, label_ids, email_processed(category, urgency, summary, quick_actions)",
    )
    .eq("user_id", userId)
    .not("label_ids", "cs", '{"SENT"}')
    .order("received_at", { ascending: false });

  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).toISOString();
  const weekAgo = new Date(
    now.getTime() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  if (scope === "today_new") {
    emailsQuery = emailsQuery.gte("received_at", todayStart).limit(100);
  } else if (scope === "today_unread") {
    emailsQuery = emailsQuery
      .gte("received_at", todayStart)
      .eq("is_read", false)
      .limit(100);
  } else if (scope === "past_week") {
    emailsQuery = emailsQuery.gte("received_at", weekAgo).limit(100);
  } else {
    emailsQuery = emailsQuery.limit(40);
  }

  const [{ data: recent }, { data: briefingKb }, { data: briefingMem }] =
    await Promise.all([
      emailsQuery,
      supabase
        .from("knowledge_base")
        .select("entity, entity_type, info, importance")
        .eq("user_id", userId)
        .in("importance", ["critical", "high"])
        .order("use_count", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(30),
      supabase
        .from("email_memory")
        .select("sender_email, interaction_count, relationship_notes")
        .eq("user_id", userId)
        .order("interaction_count", { ascending: false })
        .limit(10),
    ]);

  if (!recent?.length) {
    return {
      executiveSummary: "No recent emails to brief on.",
      crucial: [],
      replyNeeded: [],
      deadlines: [],
      nonEssential: [],
      stats: {
        total: 0,
        crucial: 0,
        replyNeeded: 0,
        deadlines: 0,
        nonEssential: 0,
      },
    };
  }

  const briefingKbParts: string[] = [];
  if (briefingKb?.length) {
    briefingKbParts.push(
      "Known entities:\n" +
        briefingKb
          .map(
            (k: { entity: string; entity_type: string; info: string }) =>
              `${k.entity} (${k.entity_type}): ${k.info}`,
          )
          .join("\n"),
    );
  }
  if (briefingMem?.length) {
    briefingKbParts.push(
      "Top contacts:\n" +
        briefingMem
          .map(
            (m: {
              sender_email: string;
              interaction_count: number;
              relationship_notes: string | null;
            }) =>
              `${m.sender_email} (${m.interaction_count} emails)${m.relationship_notes ? ` \u2014 ${m.relationship_notes}` : ""}`,
          )
          .join("\n"),
    );
  }
  const briefingKnowledgeContext = briefingKbParts.length
    ? briefingKbParts.join("\n\n")
    : undefined;

  const buckets: Record<Bucket, Record<string, unknown>[]> = {
    crucial: [],
    replyNeeded: [],
    deadlines: [],
    nonEssential: [],
  };

  const knownSenders = new Set<string>();
  for (const m of briefingMem ?? []) {
    const e = (m as { sender_email?: string }).sender_email?.trim().toLowerCase();
    if (e) knownSenders.add(e);
  }

  type Row = (typeof recent)[number];
  const refineRows: Row[] = [];

  for (const row of recent as Row[]) {
    const { bucket, card, refine } = triageRow(row, knownSenders);
    buckets[bucket].push(card);
    if (refine) refineRows.push(row);
  }

  const refinePriority = (r: Row) => {
    const p = firstProcessed(r);
    const cat = (p?.category ?? "").toLowerCase();
    if (cat === "action-required") return 0;
    if (hasReplyQuickAction(p?.quick_actions)) return 1;
    if (cat === "important") return 2;
    return 3;
  };

  refineRows.sort((a, b) => {
    const d = refinePriority(a) - refinePriority(b);
    if (d !== 0) return d;
    const ta = new Date(a.received_at ?? 0).getTime();
    const tb = new Date(b.received_at ?? 0).getTime();
    return tb - ta;
  });

  const toRefine = refineRows.slice(0, REFINE_BATCH_CAP);
  const refineIdSet = new Set(toRefine.map((r) => r.id));
  if (toRefine.length > 0) {
    const ndjson = toRefine
      .map((row) => {
        const p = firstProcessed(row);
        return JSON.stringify({
          email_id: row.id,
          subject: row.subject ?? "",
          sender: row.sender ?? "",
          category: p?.category ?? "unknown",
          urgency: p?.urgency ?? null,
          summary: (p?.summary || row.snippet || "").slice(0, 520),
        });
      })
      .join("\n");

    try {
      const refined = await refineBriefingCards(ndjson);
      const byId = new Map<string, Record<string, unknown>>();
      for (const patch of refined) {
        const id = patch.email_id as string | undefined;
        if (!id || typeof id !== "string" || !refineIdSet.has(id)) continue;
        byId.set(id, patch);
      }
      for (const [id, patch] of byId) {
        const prev = findCardInBuckets(id, buckets);
        removeIdFromBuckets(id, buckets);
        const b = normBucket(patch.bucket);
        const merged: Record<string, unknown> = {
          ...(prev ?? { email_id: id }),
          ...patch,
          email_id: id,
          subject: (patch.subject as string) || (prev?.subject as string) || "",
          senderName: (patch.senderName as string) ||
            (prev?.senderName as string) || "",
          sender: (patch.sender as string) || (prev?.sender as string) || "",
          summary: (patch.summary as string) || (prev?.summary as string) || "",
          urgency: (() => {
            const stored = (prev?.urgency as string) ?? "";
            const llm = (patch.urgency as string) ?? "";
            // Stored critical/high from process_email acts as a floor.
            if (stored === "critical" || llm === "critical") return "critical";
            if (stored === "high" || llm === "high") return "high";
            return "medium";
          })(),
          deadline: patch.deadline ?? prev?.deadline ?? null,
          waitingForReply: patch.waitingForReply !== undefined
            ? Boolean(patch.waitingForReply)
            : Boolean(prev?.waitingForReply),
          tags: Array.isArray(patch.tags)
            ? patch.tags
            : (prev?.tags as string[]) ?? [],
        };
        buckets[b].push(merged);
      }
    } catch (e) {
      console.error("[buildBriefing] refineBriefingCards:", e);
    }
  }

  applyBroadcastDowngrade(buckets);
  applyFyiAndVoteDemotion(buckets);

  const waitingInCrucial = buckets.crucial.filter((e) => e.waitingForReply);
  if (waitingInCrucial.length > 0) {
    buckets.replyNeeded.push(...waitingInCrucial);
    buckets.crucial = buckets.crucial.filter((e) => !e.waitingForReply);
  }
  const deadlineInCrucial = buckets.crucial.filter((e) => e.deadline);
  if (deadlineInCrucial.length > 0) {
    buckets.deadlines.push(...deadlineInCrucial);
    buckets.crucial = buckets.crucial.filter((e) => !e.deadline);
  }

  const subjectToId = new Map<string, string>();
  for (const e of recent as Row[]) {
    const key = (e.subject ?? "").toLowerCase();
    subjectToId.set(key, e.id);
  }
  const attachIds = (cards: Record<string, unknown>[]) =>
    cards.map((card) => {
      const id = card.email_id as string | undefined;
      if (id) return card;
      const key = ((card.subject as string) ?? "").toLowerCase();
      let eid = subjectToId.get(key);
      if (!eid) {
        for (const [s, id] of subjectToId) {
          if (s.includes(key) || key.includes(s)) {
            eid = id;
            break;
          }
        }
      }
      return eid ? { ...card, email_id: eid } : card;
    });

  let crucial = attachIds(buckets.crucial);
  let replyNeeded = attachIds(buckets.replyNeeded);
  let deadlines = attachIds(buckets.deadlines);
  let nonEssential = attachIds(buckets.nonEssential);

  const seen = new Set<string>();
  for (const arr of [crucial, replyNeeded, deadlines, nonEssential]) {
    for (const c of arr) {
      const id = (c as { email_id?: string }).email_id;
      if (id) seen.add(id);
    }
  }
  for (const e of recent as Row[]) {
    if (seen.has(e.id)) continue;
    const p = firstProcessed(e);
    nonEssential.push({
      subject: e.subject ?? "",
      senderName: (e.sender || "").split("<")[0]?.trim() || e.sender || "",
      sender: e.sender ?? "",
      summary: (p?.summary || e.snippet || "").trim() || "(no summary)",
      urgency: "medium",
      deadline: null,
      waitingForReply: false,
      tags: [],
      email_id: e.id,
      suggestedAction: "archive",
    });
    seen.add(e.id);
  }

  const finalTotal =
    crucial.length + replyNeeded.length + deadlines.length + nonEssential.length;

  let executiveSummary = cleanExecutiveCounts(
    await generateBriefingExecutiveSummary(
      buildDigestForExecutive({
        crucial,
        replyNeeded,
        deadlines,
        nonEssential,
      }),
      briefingKnowledgeContext,
    ),
  );

  if (briefingSummaryNeedsRecovery(executiveSummary)) {
    executiveSummary = cleanExecutiveCounts(
      await generateBriefingExecutiveSummary(
        buildDigestForExecutive({
          crucial,
          replyNeeded,
          deadlines,
          nonEssential,
        }),
        undefined,
      ),
    );
  }
  if (briefingSummaryNeedsRecovery(executiveSummary)) {
    executiveSummary =
      "Your briefing is ready; scan Reply needed and Crucial for what deserves attention today.";
  }

  return {
    executiveSummary,
    crucial,
    replyNeeded,
    deadlines,
    nonEssential,
    stats: {
      total: finalTotal,
      crucial: crucial.length,
      replyNeeded: replyNeeded.length,
      deadlines: deadlines.length,
      nonEssential: nonEssential.length,
    },
  };
}
