export type TagSuggestion = {
  id: string;
  name: string;
  slug: string;
  color: string;
  description: string;
  matchCount: number;
  examples: string[];
  source: "domain" | "keyword";
};

type EmailRow = { subject: string; sender_email: string };

type DomainTemplate = {
  slug: string;
  name: string;
  color: string;
  description: string;
};

type KeywordCluster = {
  slug: string;
  name: string;
  color: string;
  description: string;
  keywords: string[];
};

type DismissedStore = {
  userId: string;
  slugs: string[];
  updatedAt: string;
};

// ── Domain → tag templates ────────────────────────────────────────────────────
// Keyed by sender domain. Multiple domains can share a slug (counts are merged).
const DOMAIN_TAG_MAP: Record<string, DomainTemplate> = {
  "github.com":      { slug: "github",     name: "GitHub",     color: "#6366f1", description: "Notifications and activity from GitHub repositories" },
  "gitlab.com":      { slug: "gitlab",     name: "GitLab",     color: "#f97316", description: "Notifications and activity from GitLab projects" },
  "linear.app":      { slug: "linear",     name: "Linear",     color: "#8b5cf6", description: "Issue updates and project activity from Linear" },
  "notion.so":       { slug: "notion",     name: "Notion",     color: "#64748b", description: "Comments, mentions, and updates from Notion" },
  "slack.com":       { slug: "slack",      name: "Slack",      color: "#22c55e", description: "Notifications and digests from Slack" },
  "atlassian.com":   { slug: "jira",       name: "Jira",       color: "#3b82f6", description: "Jira issue updates, assignments, and comments" },
  "jira.com":        { slug: "jira",       name: "Jira",       color: "#3b82f6", description: "Jira issue updates, assignments, and comments" },
  "figma.com":       { slug: "figma",      name: "Figma",      color: "#ec4899", description: "Figma file comments, shares, and updates" },
  "asana.com":       { slug: "asana",      name: "Asana",      color: "#f97316", description: "Task assignments and project updates from Asana" },
  "trello.com":      { slug: "trello",     name: "Trello",     color: "#3b82f6", description: "Trello card activity and board notifications" },
  "monday.com":      { slug: "monday",     name: "Monday",     color: "#ef4444", description: "Updates and assignments from Monday.com" },
  "zoom.us":         { slug: "zoom",       name: "Zoom",       color: "#3b82f6", description: "Zoom meeting invites, recordings, and webinar links" },
  "loom.com":        { slug: "loom",       name: "Loom",       color: "#8b5cf6", description: "Loom video shares and comments" },
  "vercel.com":      { slug: "vercel",     name: "Vercel",     color: "#14b8a6", description: "Vercel deployment status updates and alerts" },
  "sentry.io":       { slug: "sentry",     name: "Sentry",     color: "#ef4444", description: "Error alerts and performance issues from Sentry" },
  "pagerduty.com":   { slug: "pagerduty",  name: "PagerDuty",  color: "#ef4444", description: "Incident alerts and on-call notifications from PagerDuty" },
  "hubspot.com":     { slug: "hubspot",    name: "HubSpot",    color: "#f97316", description: "CRM activity, deal updates, and contact notifications from HubSpot" },
  "salesforce.com":  { slug: "salesforce", name: "Salesforce", color: "#3b82f6", description: "Salesforce CRM notifications and pipeline updates" },
  "intercom.io":     { slug: "intercom",   name: "Intercom",   color: "#3b82f6", description: "Customer conversation notifications from Intercom" },
  "stripe.com":      { slug: "stripe",     name: "Stripe",     color: "#8b5cf6", description: "Stripe payment notifications, disputes, and receipts" },
  "clickup.com":     { slug: "clickup",    name: "ClickUp",    color: "#ec4899", description: "Task updates and notifications from ClickUp" },
  "airtable.com":    { slug: "airtable",   name: "Airtable",   color: "#22c55e", description: "Record updates and base activity from Airtable" },
  "datadog.com":     { slug: "datadog",    name: "Datadog",    color: "#8b5cf6", description: "Monitoring alerts and reports from Datadog" },
};

// ── Keyword clusters ──────────────────────────────────────────────────────────
const KEYWORD_CLUSTERS: KeywordCluster[] = [
  {
    slug: "finance",
    name: "Finance & Bills",
    color: "#22c55e",
    description: "Invoices, bills, receipts, payment confirmations, and financial statements",
    keywords: ["invoice", "receipt", "payment", "billing", "bill", "statement", "transaction", "charge", "subscription", "renewal", "refund", "balance due", "overdue", "wire transfer", "bank statement"],
  },
  {
    slug: "travel",
    name: "Travel",
    color: "#14b8a6",
    description: "Flight confirmations, hotel bookings, itineraries, and travel-related emails",
    keywords: ["flight", "booking confirmation", "itinerary", "hotel", "reservation", "check-in", "boarding pass", "airline", "your trip", "airbnb", "rental car", "e-ticket", "passport"],
  },
  {
    slug: "newsletters",
    name: "Newsletters",
    color: "#8b5cf6",
    description: "Email newsletters, digests, and subscription-based content updates",
    keywords: ["newsletter", "digest", "weekly roundup", "unsubscribe", "this week in", "edition", "issue #", "weekly update", "monthly update", "curated", "briefing", "what's new"],
  },
  {
    slug: "shopping",
    name: "Shopping",
    color: "#f97316",
    description: "Order confirmations, shipping updates, and e-commerce notifications",
    keywords: ["order confirmed", "your order", "has shipped", "out for delivery", "delivered", "tracking number", "shipment", "purchase confirmation", "return request", "package", "amazon"],
  },
  {
    slug: "health",
    name: "Health",
    color: "#ef4444",
    description: "Medical appointments, prescriptions, lab results, and health-related communications",
    keywords: ["appointment", "prescription", "lab result", "test result", "doctor", "clinic", "health", "medical", "insurance claim", "pharmacy", "patient portal", "your health"],
  },
  {
    slug: "security",
    name: "Security Alerts",
    color: "#ef4444",
    description: "Login alerts, password resets, two-factor authentication, and account security notices",
    keywords: ["security alert", "new sign-in", "new login", "password reset", "two-factor", "2fa", "verify your", "verification code", "unusual activity", "account access", "confirm your email"],
  },
  {
    slug: "jobs",
    name: "Jobs & Recruiting",
    color: "#eab308",
    description: "Job applications, recruiter outreach, and hiring-related emails",
    keywords: ["application received", "job opportunity", "we reviewed your", "interview", "hiring", "open position", "recruiter", "linkedin recruiter", "offer letter", "candidate", "apply now"],
  },
  {
    slug: "events",
    name: "Events",
    color: "#ec4899",
    description: "Event invitations, RSVPs, conference registrations, and webinar links",
    keywords: ["invitation", "rsvp", "conference", "webinar", "register now", "join us", "you're invited", "event registration", "meetup", "summit", "workshop", "virtual event"],
  },
  {
    slug: "social",
    name: "Social",
    color: "#6366f1",
    description: "Notifications from social networks such as LinkedIn, Twitter, and similar platforms",
    keywords: ["linkedin", "mentioned you", "commented on your", "liked your", "followed you", "connection request", "twitter", "instagram", "reacted to", "tagged you", "new follower"],
  },
  {
    slug: "legal",
    name: "Legal & Compliance",
    color: "#64748b",
    description: "Contracts, NDAs, privacy policy updates, terms of service, and compliance notices",
    keywords: ["agreement", "contract", "terms of service", "privacy policy", "nda", "compliance", "legal notice", "policy update", "gdpr", "data protection", "terms and conditions"],
  },
];

const DOMAIN_THRESHOLD = 3;
const KEYWORD_THRESHOLD = 5;
const MAX_SUGGESTIONS = 8;
const EXAMPLES_LIMIT = 3;

export function analyzeEmailPatterns(
  emails: EmailRow[],
  existingTagSlugs: string[],
  dismissedSlugs: string[],
): TagSuggestion[] {
  // ── Domain pass ───────────────────────────────────────────────────────────
  // Accumulate by template slug (multiple domains can share a slug, e.g. jira.com + atlassian.com)
  const domainAccum = new Map<string, { template: DomainTemplate; count: number; examples: string[] }>();

  for (const email of emails) {
    if (!email.sender_email) continue;
    const atIdx = email.sender_email.lastIndexOf("@");
    if (atIdx === -1) continue;
    const domain = email.sender_email.slice(atIdx + 1).toLowerCase().trim();
    const template = DOMAIN_TAG_MAP[domain];
    if (!template) continue;

    const existing = domainAccum.get(template.slug);
    if (existing) {
      existing.count += 1;
      if (existing.examples.length < EXAMPLES_LIMIT) existing.examples.push(email.sender_email);
    } else {
      domainAccum.set(template.slug, { template, count: 1, examples: [email.sender_email] });
    }
  }

  // ── Keyword pass ──────────────────────────────────────────────────────────
  const keywordAccum = new Map<string, { cluster: KeywordCluster; count: number; examples: string[] }>();

  for (const email of emails) {
    const subjectLower = (email.subject ?? "").toLowerCase();
    for (const cluster of KEYWORD_CLUSTERS) {
      if (!cluster.keywords.some((kw) => subjectLower.includes(kw))) continue;
      const existing = keywordAccum.get(cluster.slug);
      if (existing) {
        existing.count += 1;
        if (existing.examples.length < EXAMPLES_LIMIT) {
          const truncated = email.subject.length > 50 ? email.subject.slice(0, 47) + "..." : email.subject;
          existing.examples.push(truncated);
        }
      } else {
        const truncated = (email.subject ?? "").length > 50 ? email.subject.slice(0, 47) + "..." : email.subject;
        keywordAccum.set(cluster.slug, { cluster, count: 1, examples: [truncated] });
      }
    }
  }

  // ── Build candidates ──────────────────────────────────────────────────────
  const blocked = new Set([...existingTagSlugs, ...dismissedSlugs]);
  const candidates: TagSuggestion[] = [];

  for (const [slug, { template, count, examples }] of domainAccum) {
    if (count < DOMAIN_THRESHOLD || blocked.has(slug)) continue;
    candidates.push({
      id: `suggestion-${slug}`,
      name: template.name,
      slug,
      color: template.color,
      description: template.description,
      matchCount: count,
      examples: [...new Set(examples)].slice(0, EXAMPLES_LIMIT),
      source: "domain",
    });
  }

  for (const [slug, { cluster, count, examples }] of keywordAccum) {
    if (count < KEYWORD_THRESHOLD || blocked.has(slug)) continue;
    candidates.push({
      id: `suggestion-${slug}`,
      name: cluster.name,
      slug,
      color: cluster.color,
      description: cluster.description,
      matchCount: count,
      examples: examples.slice(0, EXAMPLES_LIMIT),
      source: "keyword",
    });
  }

  candidates.sort((a, b) => b.matchCount - a.matchCount);
  return candidates.slice(0, MAX_SUGGESTIONS);
}

// ── localStorage helpers ──────────────────────────────────────────────────────
const DISMISSED_PREFIX = "runemail:dismissed-tag-suggestions:";

export function getDismissedSlugs(userId: string): string[] {
  try {
    const raw = localStorage.getItem(`${DISMISSED_PREFIX}${userId}`);
    if (!raw) return [];
    const parsed: DismissedStore = JSON.parse(raw);
    return parsed.slugs ?? [];
  } catch {
    return [];
  }
}

export function addDismissedSlug(userId: string, slug: string): void {
  try {
    const current = getDismissedSlugs(userId);
    if (current.includes(slug)) return;
    const store: DismissedStore = { userId, slugs: [...current, slug], updatedAt: new Date().toISOString() };
    localStorage.setItem(`${DISMISSED_PREFIX}${userId}`, JSON.stringify(store));
  } catch {
    // silently ignore (SSR or private browsing)
  }
}

export function removeDismissedSlug(userId: string, slug: string): void {
  try {
    const current = getDismissedSlugs(userId);
    const store: DismissedStore = { userId, slugs: current.filter((s) => s !== slug), updatedAt: new Date().toISOString() };
    localStorage.setItem(`${DISMISSED_PREFIX}${userId}`, JSON.stringify(store));
  } catch {}
}
