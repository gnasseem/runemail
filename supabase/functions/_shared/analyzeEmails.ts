/**
 * Shared email analysis helper.
 *
 * Exported so it can be called from both the api edge function (on-demand via
 * /analyze-inbox or the Gmail webhook) and the process-emails cron function
 * (background fallback that catches emails the webhook missed).
 *
 * Performance notes:
 * - All emails in a batch are analyzed in parallel (no chunk barrier), so one
 *   slow email never stalls the other 49. The only cap is AI_PROCESS_CONCURRENCY
 *   which is a safety ceiling against provider-side throttling.
 * - For each email, processFullEmail and extractEntities run concurrently
 *   (they are independent LLM calls).
 * - Preamble DB reads (delegation rules, category rules, user tags, sender
 *   memory) run in parallel via Promise.all.
 * - Results are flushed to email_processed / knowledge_base as they complete
 *   (micro-batched) so Realtime streams rows to the UI progressively instead
 *   of waiting for the slowest email.
 */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { extractEntities, processFullEmail } from "./ai.ts";

function getEnv(key: string): string {
  return (
    (Deno as unknown as { env: { get(k: string): string | undefined } }).env.get(
      key,
    ) ?? ""
  );
}

/**
 * Analyze all unprocessed emails for a given user.
 * Returns the number of emails analyzed.
 */
export async function analyzeEmailsForUser(
  userId: string,
  supabase: SupabaseClient,
): Promise<{ analyzed: number; briefing: unknown }> {
  const { data: alreadyProcessed } = await supabase
    .from("email_processed")
    .select("email_id, quick_actions, category")
    .eq("user_id", userId);

  // Consider an email fully processed only if it has actions OR is a category that legitimately has none.
  // Emails with empty quick_actions on action-required/important categories were likely victims of
  // the token-truncation bug and should be retried.
  const processedIds = (alreadyProcessed || [])
    .filter((p) => {
      const hasActions = Array.isArray(p.quick_actions) && (p.quick_actions as unknown[]).length > 0;
      const noActionsExpected = ["newsletter", "informational"].includes((p.category as string) || "");
      return hasActions || noActionsExpected;
    })
    .map((p) => p.email_id as string);

  let unprocessedQuery = supabase
    .from("emails")
    .select("id, subject, sender, sender_email, recipients, body_text, snippet, label_ids, has_attachments, has_list_unsubscribe, is_reply, reply_to_email, cc_recipients, precedence_header")
    .eq("user_id", userId)
    .not("label_ids", "cs", '{"SENT"}')
    .order("received_at", { ascending: false })
    .limit(100);

  if (processedIds.length > 0) {
    unprocessedQuery = unprocessedQuery.not("id", "in", `(${processedIds.join(",")})`);
  }

  const { data: unprocessed } = await unprocessedQuery;
  const emailsToProcess = unprocessed || [];

  if (emailsToProcess.length === 0) {
    return { analyzed: 0, briefing: null };
  }

  // ── Parallel preamble: fetch all per-user config + sender memory at once ──
  const senderEmails = [
    ...new Set(emailsToProcess.map((e) => e.sender_email as string).filter(Boolean)),
  ];

  const [
    delegationRulesRes,
    allCategoryRulesRes,
    userTagRowsRes,
    memRowsRes,
  ] = await Promise.all([
    supabase
      .from("delegation_rules")
      .select("pattern, target_email")
      .eq("user_id", userId)
      .eq("is_enabled", true),
    supabase
      .from("category_rules")
      .select("match_type, match_value, category_slug")
      .eq("user_id", userId),
    supabase
      .from("categories")
      .select("slug, description")
      .eq("user_id", userId),
    senderEmails.length > 0
      ? supabase
          .from("email_memory")
          .select("sender_email, interaction_count")
          .eq("user_id", userId)
          .in("sender_email", senderEmails)
      : Promise.resolve({ data: [] as { sender_email: string; interaction_count: number }[] }),
  ]);

  const delegationRules = delegationRulesRes.data ?? [];
  const allCategoryRules = allCategoryRulesRes.data ?? [];
  const userTagRows = userTagRowsRes.data ?? [];
  const memRows = memRowsRes.data ?? [];

  const categoryRules = allCategoryRules.filter((r) => r.match_type !== "description");
  const categoryHints = allCategoryRules
    .filter((r) => r.match_type === "description")
    .map((r) => ({ category_slug: r.category_slug as string, description: r.match_value as string }));
  const userTags: { slug: string; description: string }[] = userTagRows.map((t) => ({
    slug: t.slug as string,
    description: (t.description as string) || "",
  }));
  const MAIN_CATEGORIES = new Set(["important", "action-required", "newsletter", "informational"]);

  const senderInteractionMap = new Map<string, number>();
  for (const row of memRows) {
    senderInteractionMap.set(row.sender_email as string, row.interaction_count as number);
  }

  // ── Micro-batching flush: stream rows into email_processed as they finish ──
  // so Realtime updates the UI progressively and the slowest email never
  // delays earlier ones from appearing.
  const rowBuffer: Record<string, unknown>[] = [];
  const kbBuffer: Record<string, unknown>[] = [];
  const FLUSH_SIZE = 8;

  const flushRows = async () => {
    if (rowBuffer.length === 0) return;
    const batch = rowBuffer.splice(0, rowBuffer.length);
    try {
      await supabase.from("email_processed").upsert(batch, { onConflict: "email_id" });
    } catch (err) {
      console.error("[analyzeEmailsForUser] upsert email_processed:", (err as Error).message);
    }
  };
  const flushKb = async () => {
    if (kbBuffer.length === 0) return;
    const batch = kbBuffer.splice(0, kbBuffer.length);
    try {
      await supabase
        .from("knowledge_base")
        .upsert(batch, { onConflict: "user_id,entity,entity_type" });
    } catch (err) {
      console.error("[analyzeEmailsForUser] upsert knowledge_base:", (err as Error).message);
    }
  };

  // Concurrency ceiling. For initial loads of ~50 this dispatches everything
  // at once. The cap only matters if we ever hand this function a huge backlog.
  const CONCURRENCY = Math.max(
    1,
    parseInt(getEnv("AI_PROCESS_CONCURRENCY") || "50", 10),
  );

  let processed = 0;
  let nextIdx = 0;

  const analyzeOne = async (email: Record<string, unknown>) => {
    try {
      const gmailLabels = (email.label_ids as string[]) ?? [];
      const ccStr = (email.cc_recipients as string) ?? "";
      const signals = {
        gmailLabels,
        hasAttachments: email.has_attachments as boolean,
        isReply: email.is_reply as boolean,
        hasListUnsubscribe: email.has_list_unsubscribe as boolean,
        replyToEmail: email.reply_to_email as string | undefined,
        ccRecipients: ccStr || undefined,
        precedenceHeader: email.precedence_header as string | undefined,
        senderInteractionCount: senderInteractionMap.get(email.sender_email as string),
      };

      const subject = (email.subject as string) || "";
      const sender = (email.sender as string) || "";
      const body = (email.body_text as string) || (email.snippet as string) || "";

      // Fire both LLM calls for this email in parallel. The entity extractor
      // doesn't need the category result; we decide whether to keep the
      // entities after the category comes back. This roughly halves the
      // per-email wall-clock vs. running them sequentially.
      const [result, rawEntities] = await Promise.all([
        processFullEmail(
          subject,
          sender,
          body,
          signals,
          userTags.length > 0 ? userTags : undefined,
          categoryHints.length > 0 ? categoryHints : undefined,
        ),
        extractEntities(subject, sender, body).catch((err) => {
          console.error("[analyzeEmailsForUser] entity extraction:", err);
          return [] as { entity: string; entity_type: string; info: string }[];
        }),
      ]);

      const delegationActions: { label: string; action: string; target: string }[] = [];
      if (delegationRules.length) {
        const searchText = `${subject} ${body}`.toLowerCase();
        for (const rule of delegationRules) {
          if (searchText.includes((rule.pattern as string).toLowerCase())) {
            delegationActions.push({
              label: `Delegate to ${rule.target_email}`,
              action: "delegate",
              target: rule.target_email as string,
            });
          }
        }
      }

      let finalCategory = result.category;
      const extraLabels: string[] = [...(result.tags || [])];
      if (categoryRules.length) {
        const subjectLc = subject.toLowerCase();
        const senderLc = sender.toLowerCase();
        const bodyLc = body.toLowerCase();
        for (const rule of categoryRules) {
          const val = (rule.match_value as string).toLowerCase();
          let matched = false;
          if (rule.match_type === "subject") matched = subjectLc.includes(val);
          else if (rule.match_type === "sender") matched = senderLc.includes(val);
          else if (rule.match_type === "keyword") matched = bodyLc.includes(val);
          if (matched) {
            const slug = rule.category_slug as string;
            if (MAIN_CATEGORIES.has(slug)) {
              finalCategory = slug;
            } else if (!extraLabels.includes(slug)) {
              extraLabels.push(slug);
            }
          }
        }
      }

      rowBuffer.push({
        user_id: userId,
        email_id: email.id as string,
        category: finalCategory,
        summary: result.summary,
        quick_actions: [...(result.quick_actions as object[]), ...delegationActions],
        extra_labels: extraLabels.length > 0 ? extraLabels : null,
      });

      // Only keep entities when it makes sense (skip newsletters).
      if (finalCategory !== "newsletter") {
        for (const entity of rawEntities) {
          kbBuffer.push({
            user_id: userId,
            entity: entity.entity,
            entity_type: entity.entity_type,
            info: entity.info,
            source: "email",
            confidence: 0.8,
          });
        }
      }

      processed += 1;

      // Opportunistic flushes: when a buffer hits FLUSH_SIZE, write now so the
      // frontend sees rows stream in while later emails are still analyzing.
      if (rowBuffer.length >= FLUSH_SIZE) await flushRows();
      if (kbBuffer.length >= FLUSH_SIZE) await flushKb();
    } catch (e) {
      console.error("[analyzeEmailsForUser] failed for email:", (e as Error).message);
    }
  };

  // Simple rolling worker pool: N workers each pull the next email off the
  // shared index until the list is exhausted. This removes the chunk barrier
  // in the old implementation where the slowest email in each group of 10
  // blocked the next group from starting.
  const worker = async () => {
    while (true) {
      const i = nextIdx++;
      if (i >= emailsToProcess.length) return;
      await analyzeOne(emailsToProcess[i] as Record<string, unknown>);
    }
  };

  const workerCount = Math.min(CONCURRENCY, emailsToProcess.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  // Final flush for anything that didn't hit the FLUSH_SIZE threshold.
  await Promise.all([flushRows(), flushKb()]);

  return { analyzed: processed, briefing: null };
}
