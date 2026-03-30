// All tutorial mock data - computed relative to Date.now() so it always looks fresh

const now = Date.now();
const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();
const daysAgo = (d: number) => new Date(now - d * 86400_000).toISOString();
const inDays = (d: number) => new Date(now + d * 86400_000);

// Build date strings for meetings (today, tomorrow, +N days)
function todayAt(h: number, m = 0) {
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}
function dayAt(offsetDays: number, h: number, m = 0) {
  const d = new Date(now + offsetDays * 86400_000);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}
function dateStr(offsetDays: number) {
  const d = inDays(offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ─── EMAIL TYPES ──────────────────────────────────────────────────────────────

export type MockEmail = {
  id: string;
  gmail_id: string;
  thread_id: string;
  subject: string;
  sender: string;
  sender_email: string;
  snippet: string;
  body_html: string;
  body_text: string;
  received_at: string;
  is_read: boolean;
  is_starred: boolean;
  is_archived: boolean;
  has_attachments: boolean;
  email_processed: {
    category: string;
    summary: string;
    quick_actions: { label: string; action: string }[];
    extra_labels: string[] | null;
  } | null;
};

export type MockTodo = {
  id: string;
  text: string;
  is_completed: boolean;
  source: string;
  created_at: string;
  email_id: string | null;
};

export type MockMeeting = {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  attendees: string[];
  location: string | null;
  zoom_link: string | null;
  calendar_event_id: string | null;
  status: "proposed" | "confirmed" | "cancelled";
};

export type MockMeetingSuggestion = {
  email_id: string;
  email_subject: string;
  email_sender: string;
  title: string;
  attendees: string[];
  suggested_time?: string;
};

export type MockReceipt = {
  id: string;
  tracking_id: string;
  recipient_email: string;
  subject: string;
  open_count: number;
  first_opened_at: string | null;
  last_opened_at: string | null;
  created_at: string;
};

export type MockTag = {
  id: string;
  slug: string;
  display_name: string;
  color: string;
  description: string;
  rules: { match_type: string; match_value: string; hits: number }[];
};

export type MockBriefing = {
  executiveSummary: string;
  topPriority: {
    email_id: string;
    subject: string;
    sender: string;
    senderName: string;
    summary: string;
    urgency: "critical" | "high" | "medium";
    deadline?: string;
    waitingForReply?: boolean;
    tags: string[];
  }[];
  deadlines: { task: string; date: string; source: string }[];
  waitingForReply: {
    email_id: string;
    subject: string;
    sender: string;
    senderName: string;
    summary: string;
    urgency: "critical" | "high" | "medium";
    tags: string[];
  }[];
  stats: { total: number; critical: number; deadlines: number; waitingOnYou: number; filtered: number };
};

// ─── EMAILS ───────────────────────────────────────────────────────────────────

export const MOCK_EMAILS: MockEmail[] = [
  {
    id: "demo-email-1",
    gmail_id: "demo-gmail-1",
    thread_id: "demo-thread-1",
    subject: "Series B metrics deck needed by Friday",
    sender: "Rachel Kim",
    sender_email: "rachel.kim@horizonlabs.io",
    snippet: "Alex, we have investor calls starting Monday and I need the product metrics deck ready no later than...",
    body_html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a">
<p>Alex,</p>
<p>We have investor calls starting Monday and I need the product metrics deck ready no later than <strong>Friday 5pm</strong>. The deck should cover Q1 activation rates, NPS trend, ARR breakdown by segment, and the new enterprise pipeline.</p>
<p>James specifically asked for a before/after comparison on churn since we implemented the new onboarding flow. Can you pull that from Mixpanel and add a slide?</p>
<p>Ping me if you're blocked on any data. I can get you access to the Looker dashboards if needed.</p>
<p>Rachel<br><em>CEO, Horizon Labs</em></p>
</div>`,
    body_text: "Alex, We have investor calls starting Monday and I need the product metrics deck ready no later than Friday 5pm. The deck should cover Q1 activation rates, NPS trend, ARR breakdown by segment, and the new enterprise pipeline. James specifically asked for a before/after comparison on churn since we implemented the new onboarding flow. Can you pull that from Mixpanel and add a slide? Ping me if you're blocked on any data. Rachel",
    received_at: hoursAgo(2),
    is_read: false,
    is_starred: true,
    is_archived: false,
    has_attachments: false,
    email_processed: {
      category: "important",
      summary: "Rachel needs the Series B investor deck finalized by Friday 5pm, covering Q1 metrics, churn comparison, and ARR breakdown by segment.",
      quick_actions: [
        { label: "Reply to Rachel", action: "reply" },
        { label: "Add todo: Prepare metrics deck", action: "add_todo" },
        { label: "Schedule metrics review", action: "schedule_meeting" },
      ],
      extra_labels: ["series-b"],
    },
  },
  {
    id: "demo-email-2",
    gmail_id: "demo-gmail-2",
    thread_id: "demo-thread-2",
    subject: "URGENT: Production incident - 2am deployment rolled back",
    sender: "David Chen",
    sender_email: "david.chen@horizonlabs.io",
    snippet: "We rolled back the 2am deployment after detecting elevated error rates on the payments service. Root cause is...",
    body_html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a">
<p>Alex,</p>
<p>Heads up: we rolled back the 2am deployment after detecting <strong>elevated error rates on the payments service</strong> (p99 latency went from 280ms to 4.2s). Root cause traced to a deadlock in the billing queue introduced in the new retry logic.</p>
<p>Current status: rolled back, all metrics nominal. No customer data was affected. We have a fix ready but I need your sign-off before re-deploying. Also need to decide: do we push tonight or wait until Monday when full team is available?</p>
<p>I'll be online until 11pm. Let me know.</p>
<p>David<br><em>Engineering Lead</em></p>
</div>`,
    body_text: "Alex, Heads up: we rolled back the 2am deployment after detecting elevated error rates on the payments service. Root cause traced to a deadlock in the billing queue. Current status: rolled back, all metrics nominal. We have a fix ready but I need your sign-off. Do we push tonight or wait until Monday? David",
    received_at: hoursAgo(4),
    is_read: false,
    is_starred: false,
    is_archived: false,
    has_attachments: false,
    email_processed: {
      category: "action-required",
      summary: "Production deployment rolled back due to billing queue deadlock causing 15x latency spike. Fix is ready; needs sign-off decision on re-deploy timing.",
      quick_actions: [
        { label: "Reply with decision", action: "reply" },
        { label: "Add todo: Review deployment fix", action: "add_todo" },
      ],
      extra_labels: ["ops"],
    },
  },
  {
    id: "demo-email-3",
    gmail_id: "demo-gmail-3",
    thread_id: "demo-thread-3",
    subject: "Contract renewal - 3-year proposal attached",
    sender: "Marcus Webb",
    sender_email: "marcus.webb@vertex.com",
    snippet: "Hi Alex, following up on our conversation last week. We're ready to move forward with the 3-year renewal...",
    body_html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a">
<p>Hi Alex,</p>
<p>Following up on our conversation last week. Vertex Labs is ready to move forward with the 3-year renewal. I've attached our proposed terms - we're looking at <strong>$840K ARR with a 15% YoY increase</strong>, same SLA commitments plus the new SOC 2 Type II requirement we discussed.</p>
<p>One ask: we'd like to add a dedicated CSM to the contract. Given our usage growth (up 340% YoY), I think it's justified. Happy to discuss a structure that works for both sides.</p>
<p>Can we get 30 minutes this week to align before I loop in our procurement team?</p>
<p>Marcus Webb<br><em>VP Technology, Vertex Labs</em></p>
</div>`,
    body_text: "Hi Alex, Vertex Labs is ready to move forward with the 3-year renewal at $840K ARR with 15% YoY increase. We'd like to add a dedicated CSM. Can we get 30 minutes this week? Marcus Webb, VP Technology, Vertex Labs",
    received_at: hoursAgo(6),
    is_read: false,
    is_starred: true,
    is_archived: false,
    has_attachments: true,
    email_processed: {
      category: "action-required",
      summary: "Marcus at Vertex Labs is ready to sign a 3-year renewal at $840K ARR, requesting a dedicated CSM and 30-minute alignment call this week.",
      quick_actions: [
        { label: "Reply to Marcus", action: "reply" },
        { label: "Schedule renewal call", action: "schedule_meeting" },
        { label: "Add todo: Prepare counter-proposal", action: "add_todo" },
      ],
      extra_labels: ["clients"],
    },
  },
  {
    id: "demo-email-4",
    gmail_id: "demo-gmail-4",
    thread_id: "demo-thread-4",
    subject: "IP Assignment Agreement - signature required by Thursday",
    sender: "Tom Bradford",
    sender_email: "tom.bradford@legal.io",
    snippet: "Alex, as discussed with your legal counsel, the IP Assignment Agreement needs to be signed before the Series B...",
    body_html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a">
<p>Alex,</p>
<p>As discussed with your legal counsel, the IP Assignment Agreement needs to be executed before the Series B close. Investors require this as a condition precedent.</p>
<p><strong>Deadline: Thursday, end of business.</strong></p>
<p>The agreement covers: (1) IP created prior to Horizon Labs incorporation assigned to the company, (2) standard work-for-hire provisions for future IP, (3) carve-outs for pre-incorporation personal projects as listed in Exhibit A.</p>
<p>Please review Exhibit A carefully. If any personal projects are missing, let me know immediately. Once signed via DocuSign, I'll countersign and send to lead investor counsel.</p>
<p>Tom Bradford<br><em>Corporate Counsel</em></p>
</div>`,
    body_text: "Alex, The IP Assignment Agreement must be signed by Thursday. It's a condition precedent for the Series B close. Please review Exhibit A for personal project carve-outs. Tom Bradford, Corporate Counsel",
    received_at: daysAgo(1),
    is_read: false,
    is_starred: false,
    is_archived: false,
    has_attachments: true,
    email_processed: {
      category: "action-required",
      summary: "IP Assignment Agreement must be signed by Thursday - it's a legal condition precedent for the Series B close. Review Exhibit A for personal project carve-outs.",
      quick_actions: [
        { label: "Reply to Tom", action: "reply" },
        { label: "Add todo: Sign IP Agreement by Thursday", action: "add_todo" },
      ],
      extra_labels: ["legal", "series-b"],
    },
  },
  {
    id: "demo-email-5",
    gmail_id: "demo-gmail-5",
    thread_id: "demo-thread-5",
    subject: "Speaking invitation: AI Summit 2026 - confirm by April 5",
    sender: "Dr. Sarah Foster",
    sender_email: "s.foster@stanford.edu",
    snippet: "Dear Alex, on behalf of the Stanford AI Summit organizing committee, we'd like to invite you to deliver...",
    body_html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a">
<p>Dear Alex,</p>
<p>On behalf of the Stanford AI Summit organizing committee, we'd like to invite you to deliver a <strong>keynote on agentic AI in enterprise workflows</strong> at this year's conference (June 12-14, San Francisco).</p>
<p>Your work at Horizon Labs on AI-native productivity has been cited widely. We believe your perspective would resonate deeply with our audience of 2,000+ researchers and builders.</p>
<p>Slot: 45 minutes + 15 min Q&A. We cover travel, accommodation, and a $5,000 speaker honorarium.</p>
<p><strong>Please confirm by April 5</strong> so we can finalize the program and begin promotion. Happy to set up a call to answer questions.</p>
<p>Best,<br>Dr. Sarah Foster<br><em>AI Summit Program Chair, Stanford</em></p>
</div>`,
    body_text: "Dear Alex, We'd like to invite you to deliver a keynote on agentic AI at Stanford AI Summit (June 12-14, SF). 45 min keynote + $5,000 honorarium. Please confirm by April 5. Dr. Sarah Foster",
    received_at: daysAgo(1),
    is_read: false,
    is_starred: false,
    is_archived: false,
    has_attachments: false,
    email_processed: {
      category: "important",
      summary: "Stanford AI Summit invites Alex to keynote on agentic AI in enterprise (June 12-14, SF) with $5K honorarium. Confirmation needed by April 5.",
      quick_actions: [
        { label: "Reply to confirm", action: "reply" },
        { label: "Add todo: Confirm AI Summit by April 5", action: "add_todo" },
      ],
      extra_labels: null,
    },
  },
  {
    id: "demo-email-6",
    gmail_id: "demo-gmail-6",
    thread_id: "demo-thread-6",
    subject: "Board meeting April 8 - agenda + pre-read materials",
    sender: "James Liu",
    sender_email: "james.liu@sequoia.com",
    snippet: "Alex, attaching the draft agenda and pre-read package for the April 8 board meeting. A few items to flag...",
    body_html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a">
<p>Alex,</p>
<p>Attaching the draft agenda and pre-read package for the April 8 board meeting. A few items I want to flag:</p>
<ul>
<li><strong>Series B update</strong> - we'll want a crisp 10-minute slot. Investors will expect to see the metrics deck in advance.</li>
<li><strong>Enterprise pipeline review</strong> - I've asked Lisa to prepare a waterfall chart of Q2 pipeline. Please coordinate.</li>
<li><strong>Comp plan for new VP Eng</strong> - need board approval before we can extend the offer. I'll circulate a term sheet Friday.</li>
</ul>
<p>Please review by April 6 and flag any agenda additions. See you on the 8th.</p>
<p>James<br><em>Sequoia Capital</em></p>
</div>`,
    body_text: "Alex, Attaching the draft agenda and pre-read for April 8 board meeting. Key items: Series B update, enterprise pipeline review, VP Eng comp plan. Please review by April 6. James Liu, Sequoia Capital",
    received_at: daysAgo(2),
    is_read: false,
    is_starred: true,
    is_archived: false,
    has_attachments: true,
    email_processed: {
      category: "important",
      summary: "Board meeting April 8 agenda sent by James Liu (Sequoia). Key items: Series B update, enterprise pipeline, VP Eng comp approval. Review materials by April 6.",
      quick_actions: [
        { label: "Reply to James", action: "reply" },
        { label: "Schedule board prep", action: "schedule_meeting" },
      ],
      extra_labels: ["series-b"],
    },
  },
  {
    id: "demo-email-7",
    gmail_id: "demo-gmail-7",
    thread_id: "demo-thread-7",
    subject: "Q2 roadmap: 3 decisions need your input before Sprint 24",
    sender: "Raj Patel",
    sender_email: "raj.patel@horizonlabs.io",
    snippet: "Alex, before we kick off Sprint 24 planning on Thursday I need alignment on 3 open questions that are blocking the team...",
    body_html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a">
<p>Alex,</p>
<p>Before we kick off Sprint 24 planning on Thursday I need alignment on 3 open questions that are blocking the team:</p>
<ol>
<li><strong>Microservices migration</strong> - do we split the monolith in Q2 or defer to Q3? The team is split 50/50 and I need a tiebreaker. My recommendation: defer to Q3, focus Q2 on reliability wins.</li>
<li><strong>Mobile app scope</strong> - enterprise customers are pushing for native iOS. Should this be Q2 or stay deprioritized?</li>
<li><strong>AI model upgrade path</strong> - Gemini 2.0 is available. Cost is 3x but performance gains on our benchmark are 40%. Worth it?</li>
</ol>
<p>Can you drop 15 minutes on Thursday before planning kickoff to align?</p>
<p>Raj<br><em>CTO, Horizon Labs</em></p>
</div>`,
    body_text: "Alex, Need your input on 3 Q2 roadmap questions before Sprint 24: microservices migration timing, mobile app scope, and AI model upgrade path. Can you align Thursday before planning kickoff? Raj, CTO",
    received_at: daysAgo(2),
    is_read: false,
    is_starred: false,
    is_archived: false,
    has_attachments: false,
    email_processed: {
      category: "action-required",
      summary: "Raj needs input on 3 Q2 decisions blocking Sprint 24: microservices migration timing, mobile app scope, and Gemini 2.0 upgrade cost-benefit.",
      quick_actions: [
        { label: "Reply with decisions", action: "reply" },
        { label: "Schedule roadmap sync", action: "schedule_meeting" },
      ],
      extra_labels: null,
    },
  },
  {
    id: "demo-email-8",
    gmail_id: "demo-gmail-8",
    thread_id: "demo-thread-8",
    subject: "Sprint 23 retro notes + Sprint 24 kickoff Thursday 10am",
    sender: "Maya Lin",
    sender_email: "maya.lin@horizonlabs.io",
    snippet: "Hi team, attaching the Sprint 23 retrospective notes and confirming the Sprint 24 kickoff for Thursday at 10am...",
    body_html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a">
<p>Hi team,</p>
<p>Attaching the Sprint 23 retrospective notes. Key themes: deployment pipeline reliability, onboarding flow completion rate (up 12%), and the need for better cross-team visibility on dependencies.</p>
<p><strong>Sprint 24 Kickoff: Thursday 10am, Main Conference Room + Zoom.</strong></p>
<p>Pre-work: please review the proposed sprint backlog in Notion and vote on priority by Wednesday EOD. The team voted to tackle the CSV export bug (#1482) as a quick win.</p>
<p>Maya<br><em>Product Manager, Horizon Labs</em></p>
</div>`,
    body_text: "Hi team, Sprint 23 retro notes attached. Key wins: onboarding flow up 12%. Sprint 24 Kickoff is Thursday 10am. Please review the sprint backlog in Notion and vote on priority by Wednesday. Maya",
    received_at: daysAgo(2),
    is_read: true,
    is_starred: false,
    is_archived: false,
    has_attachments: true,
    email_processed: {
      category: "informational",
      summary: "Sprint 23 retrospective shared; Sprint 24 kickoff is Thursday 10am. Review and vote on sprint backlog in Notion by Wednesday EOD.",
      quick_actions: [
        { label: "Schedule Sprint 24 kickoff", action: "schedule_meeting" },
      ],
      extra_labels: null,
    },
  },
  {
    id: "demo-email-9",
    gmail_id: "demo-gmail-9",
    thread_id: "demo-thread-9",
    subject: "v3.0 dashboard mockups ready - 14 screens attached",
    sender: "Priya Sharma",
    sender_email: "priya.sharma@horizonlabs.io",
    snippet: "Alex, the v3.0 dashboard redesign is ready for your review. 14 screens covering the new navigation, analytics module...",
    body_html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a">
<p>Alex,</p>
<p>The v3.0 dashboard redesign is ready for your review. 14 screens covering:</p>
<ul>
<li>New top navigation and workspace switcher</li>
<li>Redesigned analytics module with drill-down capability</li>
<li>Mobile-responsive breakpoints (375px, 768px, 1440px)</li>
<li>Updated component library: buttons, cards, modals, data tables</li>
</ul>
<p>Key design decision to flag: we moved the primary action from top-right to a persistent bottom bar on mobile. Happy to defend this in a sync if needed.</p>
<p>Figma link in the attachment. Please leave comments directly in Figma by <strong>end of week</strong>.</p>
<p>Priya<br><em>Lead Designer</em></p>
</div>`,
    body_text: "Alex, v3.0 dashboard redesign ready for review - 14 screens in Figma. Key change: primary action moved to bottom bar on mobile. Please leave Figma comments by end of week. Priya, Lead Designer",
    received_at: daysAgo(2),
    is_read: true,
    is_starred: false,
    is_archived: false,
    has_attachments: true,
    email_processed: {
      category: "informational",
      summary: "Priya has completed v3.0 dashboard redesign (14 screens). Needs Figma review comments by end of week. Notable change: primary action moved to mobile bottom bar.",
      quick_actions: [
        { label: "Reply to Priya", action: "reply" },
      ],
      extra_labels: null,
    },
  },
  {
    id: "demo-email-10",
    gmail_id: "demo-gmail-10",
    thread_id: "demo-thread-10",
    subject: "Performance reviews open Monday - 8 direct reports",
    sender: "Sofia Garcia",
    sender_email: "sofia.garcia@horizonlabs.io",
    snippet: "Hi Alex, performance review season opens Monday. You have 8 direct reports this cycle. The deadline for manager...",
    body_html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a">
<p>Hi Alex,</p>
<p>Performance review season opens Monday. You have <strong>8 direct reports</strong> this cycle. The deadline for manager reviews is April 18.</p>
<p>This cycle we've added a new calibration step: all manager reviews go through a cross-functional calibration session on April 20 before feedback is shared with employees.</p>
<p>Lattice access has been updated. Let me know if you have any issues logging in or if you need a refresher on the rubric.</p>
<p>Sofia Garcia<br><em>Head of People, Horizon Labs</em></p>
</div>`,
    body_text: "Hi Alex, performance review season opens Monday. You have 8 direct reports. Deadline for manager reviews is April 18. New this cycle: calibration session on April 20. Sofia Garcia, HR",
    received_at: daysAgo(3),
    is_read: true,
    is_starred: false,
    is_archived: false,
    has_attachments: false,
    email_processed: {
      category: "informational",
      summary: "Performance review cycle opens Monday with 8 direct reports to review by April 18. New calibration step added on April 20 before feedback is shared.",
      quick_actions: [
        { label: "Add todo: Complete performance reviews", action: "add_todo" },
      ],
      extra_labels: null,
    },
  },
  {
    id: "demo-email-11",
    gmail_id: "demo-gmail-11",
    thread_id: "demo-thread-11",
    subject: "Invoice #INV-2847: $4,320 due April 15",
    sender: "Stripe",
    sender_email: "billing@stripe.com",
    snippet: "Your Stripe invoice for March is ready. Amount due: $4,320.00. Due date: April 15, 2026.",
    body_html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a">
<p>Your Stripe invoice for March is ready.</p>
<p><strong>Amount due: $4,320.00</strong><br>Due date: April 15, 2026</p>
<p>Invoice breakdown: Platform fee $2,000 + usage-based charges $2,320 (12.4M API calls at $0.000187/call).</p>
</div>`,
    body_text: "Your Stripe invoice for March is ready. Amount due: $4,320.00. Due date: April 15, 2026.",
    received_at: daysAgo(3),
    is_read: true,
    is_starred: false,
    is_archived: false,
    has_attachments: true,
    email_processed: {
      category: "informational",
      summary: "Stripe March invoice for $4,320 (platform + usage fees for 12.4M API calls) due April 15.",
      quick_actions: [],
      extra_labels: ["ops"],
    },
  },
  {
    id: "demo-email-12",
    gmail_id: "demo-gmail-12",
    thread_id: "demo-thread-12",
    subject: "Cost anomaly detected: $1,200 above forecast this month",
    sender: "AWS",
    sender_email: "no-reply@aws.amazon.com",
    snippet: "An anomaly was detected in your AWS account. Your costs are $1,200 above forecast for March...",
    body_html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a">
<p>An anomaly was detected in your AWS account (Horizon Labs Production).</p>
<p><strong>Anomaly:</strong> EC2 spend is $1,200 above forecast for March.<br>
<strong>Likely cause:</strong> us-east-1 r6i.2xlarge instances running continuously since March 18.</p>
<p>We recommend reviewing your EC2 instances and enabling auto-stop for non-production environments.</p>
</div>`,
    body_text: "AWS cost anomaly: EC2 spend is $1,200 above forecast. Likely cause: r6i.2xlarge instances running since March 18. Review and enable auto-stop for non-prod.",
    received_at: daysAgo(3),
    is_read: true,
    is_starred: false,
    is_archived: false,
    has_attachments: false,
    email_processed: {
      category: "action-required",
      summary: "AWS detected EC2 spending $1,200 above forecast due to r6i.2xlarge instances left running since March 18. Action needed to stop non-production instances.",
      quick_actions: [
        { label: "Add todo: Review AWS EC2 instances", action: "add_todo" },
      ],
      extra_labels: ["ops"],
    },
  },
  {
    id: "demo-email-13",
    gmail_id: "demo-gmail-13",
    thread_id: "demo-thread-13",
    subject: "Your Sales Hub Pro trial expires in 3 days",
    sender: "HubSpot",
    sender_email: "noreply@hubspot.com",
    snippet: "Your 14-day Sales Hub Pro trial ends in 3 days. Upgrade now to keep access to your pipelines and sequences...",
    body_html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a">
<p>Your 14-day Sales Hub Pro trial ends in <strong>3 days</strong>.</p>
<p>After your trial ends, you'll lose access to: email sequences, deal pipeline automation, meeting scheduling links, and conversation intelligence.</p>
<p>Upgrade to Sales Hub Pro at $90/seat/month to keep access.</p>
</div>`,
    body_text: "Your HubSpot Sales Hub Pro trial ends in 3 days. Upgrade at $90/seat/month to keep pipeline automation, sequences, and meeting scheduling.",
    received_at: daysAgo(4),
    is_read: true,
    is_starred: false,
    is_archived: false,
    has_attachments: false,
    email_processed: {
      category: "action-required",
      summary: "HubSpot Sales Hub Pro trial expires in 3 days. Upgrade at $90/seat/month or lose pipeline automation, sequences, and conversation intelligence.",
      quick_actions: [
        { label: "Add todo: Evaluate HubSpot vs Salesforce", action: "add_todo" },
      ],
      extra_labels: null,
    },
  },
  {
    id: "demo-email-14",
    gmail_id: "demo-gmail-14",
    thread_id: "demo-thread-14",
    subject: "This week in AI: agents, memory, and the new productivity stack",
    sender: "LinkedIn Newsletter",
    sender_email: "newsletter@linkedin.com",
    snippet: "The rise of agentic workflows is redefining what productivity software looks like. This week: GPT-4o with real-time voice...",
    body_html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a">
<p>This week in AI: agents, memory, and the new productivity stack.</p>
<p>The rise of agentic workflows is redefining productivity software. Key stories this week: GPT-4o real-time voice, Gemini 2.0 Pro benchmark results, and why memory management is the next frontier for enterprise AI.</p>
</div>`,
    body_text: "This week in AI: agents, memory, and the new productivity stack. The rise of agentic workflows is redefining productivity software.",
    received_at: daysAgo(4),
    is_read: true,
    is_starred: false,
    is_archived: false,
    has_attachments: false,
    email_processed: {
      category: "newsletter",
      summary: "LinkedIn AI newsletter covering agentic workflows, GPT-4o real-time voice, Gemini 2.0 benchmarks, and enterprise memory management.",
      quick_actions: [
        { label: "Archive", action: "archive" },
      ],
      extra_labels: null,
    },
  },
  {
    id: "demo-email-15",
    gmail_id: "demo-gmail-15",
    thread_id: "demo-thread-15",
    subject: "Notion weekly digest: 3 new pages in your workspace",
    sender: "Notion",
    sender_email: "notify@mail.notion.so",
    snippet: "New pages shared with you: Sprint 24 Planning, Q2 OKR Review, Design System v3.0...",
    body_html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a">
<p>3 new pages were shared in your Horizon Labs workspace this week:</p>
<ul>
<li>Sprint 24 Planning (Maya Lin)</li>
<li>Q2 OKR Review Draft (Rachel Kim)</li>
<li>Design System v3.0 Overview (Priya Sharma)</li>
</ul>
</div>`,
    body_text: "3 new pages in your Notion workspace: Sprint 24 Planning, Q2 OKR Review, Design System v3.0.",
    received_at: daysAgo(5),
    is_read: true,
    is_starred: false,
    is_archived: false,
    has_attachments: false,
    email_processed: {
      category: "newsletter",
      summary: "Notion weekly digest: Sprint 24 Planning, Q2 OKR Review, and Design System v3.0 pages shared in your workspace.",
      quick_actions: [
        { label: "Archive", action: "archive" },
      ],
      extra_labels: null,
    },
  },
];

// ─── TODOS ────────────────────────────────────────────────────────────────────

export const MOCK_TODOS: MockTodo[] = [
  {
    id: "demo-todo-1",
    text: "Prepare Series B product metrics deck (due Friday)",
    is_completed: false,
    source: "Email from Rachel Kim",
    created_at: hoursAgo(2),
    email_id: "demo-email-1",
  },
  {
    id: "demo-todo-2",
    text: "Sign IP Assignment Agreement before Thursday",
    is_completed: false,
    source: "Email from Tom Bradford",
    created_at: daysAgo(1),
    email_id: "demo-email-4",
  },
  {
    id: "demo-todo-3",
    text: "Prepare counter-proposal for Vertex Labs contract renewal",
    is_completed: false,
    source: "Email from Marcus Webb",
    created_at: hoursAgo(6),
    email_id: "demo-email-3",
  },
  {
    id: "demo-todo-4",
    text: "Confirm AI Summit 2026 speaking slot (deadline April 5)",
    is_completed: false,
    source: "Email from Dr. Sarah Foster",
    created_at: daysAgo(1),
    email_id: "demo-email-5",
  },
  {
    id: "demo-todo-5",
    text: "Leave feedback on v3.0 dashboard mockups in Figma",
    is_completed: false,
    source: "manual",
    created_at: daysAgo(2),
    email_id: null,
  },
  {
    id: "demo-todo-6",
    text: "Evaluate HubSpot vs Salesforce before trial expires",
    is_completed: false,
    source: "Email from HubSpot",
    created_at: daysAgo(4),
    email_id: "demo-email-13",
  },
];

// ─── MEETINGS ─────────────────────────────────────────────────────────────────

export const MOCK_MEETINGS: MockMeeting[] = [
  {
    id: "demo-meeting-1",
    title: "Q2 Roadmap Sync",
    start_time: todayAt(15, 0),
    end_time: todayAt(16, 0),
    attendees: ["raj.patel@horizonlabs.io", "maya.lin@horizonlabs.io", "rachel.kim@horizonlabs.io"],
    location: "Main Conference Room",
    zoom_link: "https://zoom.us/j/demo-123",
    calendar_event_id: "demo-cal-1",
    status: "confirmed",
  },
  {
    id: "demo-meeting-2",
    title: "Vertex Labs Renewal Call",
    start_time: dayAt(1, 10, 30),
    end_time: dayAt(1, 11, 0),
    attendees: ["marcus.webb@vertex.com"],
    location: null,
    zoom_link: "https://zoom.us/j/demo-456",
    calendar_event_id: null,
    status: "proposed",
  },
  {
    id: "demo-meeting-3",
    title: "Board Meeting Prep",
    start_time: dayAt(4, 14, 0),
    end_time: dayAt(4, 15, 0),
    attendees: ["james.liu@sequoia.com", "rachel.kim@horizonlabs.io"],
    location: "Exec Suite",
    zoom_link: null,
    calendar_event_id: "demo-cal-3",
    status: "confirmed",
  },
  {
    id: "demo-meeting-4",
    title: "AI Summit Speaker Prep",
    start_time: dayAt(7, 9, 0),
    end_time: dayAt(7, 9, 45),
    attendees: ["s.foster@stanford.edu"],
    location: null,
    zoom_link: "https://zoom.us/j/demo-789",
    calendar_event_id: null,
    status: "proposed",
  },
];

export const MOCK_MEETING_SUGGESTIONS: MockMeetingSuggestion[] = [
  {
    email_id: "demo-email-1",
    email_subject: "Series B metrics deck needed by Friday",
    email_sender: "Rachel Kim",
    title: "Series B Metrics Review",
    attendees: ["rachel.kim@horizonlabs.io"],
    suggested_time: dayAt(3, 11, 0),
  },
  {
    email_id: "demo-email-8",
    email_subject: "Sprint 23 retro notes + Sprint 24 kickoff Thursday 10am",
    email_sender: "Maya Lin",
    title: "Sprint 24 Kickoff",
    attendees: ["raj.patel@horizonlabs.io", "maya.lin@horizonlabs.io"],
    suggested_time: dayAt(3, 10, 0),
  },
];

// ─── READ RECEIPTS ────────────────────────────────────────────────────────────

export const MOCK_RECEIPTS: MockReceipt[] = [
  {
    id: "demo-receipt-1",
    tracking_id: "demo-track-1",
    recipient_email: "marcus.webb@vertex.com",
    subject: "Q1 Performance Summary - Horizon Labs",
    open_count: 4,
    first_opened_at: hoursAgo(26),
    last_opened_at: hoursAgo(3),
    created_at: daysAgo(2),
  },
  {
    id: "demo-receipt-2",
    tracking_id: "demo-track-2",
    recipient_email: "james.liu@sequoia.com",
    subject: "Partnership Proposal - Horizon Labs",
    open_count: 2,
    first_opened_at: daysAgo(1),
    last_opened_at: daysAgo(1),
    created_at: daysAgo(3),
  },
  {
    id: "demo-receipt-3",
    tracking_id: "demo-track-3",
    recipient_email: "aws-billing@amazon.com",
    subject: "Follow-up: AWS cost optimization review",
    open_count: 0,
    first_opened_at: null,
    last_opened_at: null,
    created_at: daysAgo(4),
  },
];

// ─── CUSTOM TAGS ──────────────────────────────────────────────────────────────

export const MOCK_TAGS: MockTag[] = [
  {
    id: "demo-tag-1",
    slug: "series-b",
    display_name: "Series B",
    color: "#8b5cf6",
    description: "Everything related to the Series B fundraise",
    rules: [
      { match_type: "subject", match_value: "series b", hits: 12 },
      { match_type: "sender_domain", match_value: "sequoia.com", hits: 7 },
    ],
  },
  {
    id: "demo-tag-2",
    slug: "clients",
    display_name: "Clients",
    color: "#3b82f6",
    description: "Emails from current and prospective clients",
    rules: [
      { match_type: "sender_domain", match_value: "vertex.com", hits: 31 },
      { match_type: "subject", match_value: "contract", hits: 8 },
    ],
  },
  {
    id: "demo-tag-3",
    slug: "legal",
    display_name: "Legal",
    color: "#ef4444",
    description: "Legal documents and compliance items",
    rules: [
      { match_type: "sender_domain", match_value: "legal.io", hits: 15 },
      { match_type: "subject", match_value: "agreement", hits: 22 },
    ],
  },
  {
    id: "demo-tag-4",
    slug: "ops",
    display_name: "Ops",
    color: "#10b981",
    description: "Infrastructure, billing, and operational alerts",
    rules: [
      { match_type: "sender_domain", match_value: "aws.amazon.com", hits: 44 },
      { match_type: "sender_domain", match_value: "stripe.com", hits: 19 },
    ],
  },
];

// ─── BRIEFING ─────────────────────────────────────────────────────────────────

export const MOCK_BRIEFING: MockBriefing = {
  executiveSummary:
    "High-stakes week. The Series B metrics deck is due Friday and Rachel needs it ready for investor calls. There is an active legal deadline Thursday for the IP Assignment Agreement - missing it blocks the Series B close. Vertex Labs is ready to sign a 3-year renewal worth $840K ARR but is waiting on your counter-proposal. The board meeting is April 8 and James has sent pre-reads. Last night's production incident was contained; David needs a deployment decision.",
  topPriority: [
    {
      email_id: "demo-email-1",
      subject: "Series B metrics deck needed by Friday",
      sender: "rachel.kim@horizonlabs.io",
      senderName: "Rachel Kim",
      summary: "Rachel needs the Series B investor deck by Friday 5pm. Missing this blocks Monday investor calls.",
      urgency: "critical",
      deadline: dateStr(4),
      waitingForReply: false,
      tags: ["DEADLINE", "SERIES B"],
    },
    {
      email_id: "demo-email-4",
      subject: "IP Assignment Agreement - signature required by Thursday",
      sender: "tom.bradford@legal.io",
      senderName: "Tom Bradford",
      summary: "IP Agreement must be signed by Thursday - it is a legal condition precedent for the Series B close.",
      urgency: "critical",
      deadline: dateStr(3),
      waitingForReply: false,
      tags: ["DEADLINE", "LEGAL"],
    },
    {
      email_id: "demo-email-3",
      subject: "Contract renewal - 3-year proposal attached",
      sender: "marcus.webb@vertex.com",
      senderName: "Marcus Webb",
      summary: "Vertex Labs ready to sign 3-year renewal ($840K ARR). Waiting on your counter-proposal and scheduling a 30-min call.",
      urgency: "high",
      waitingForReply: true,
      tags: ["REPLY NEEDED", "CLIENT"],
    },
  ],
  deadlines: [
    { task: "IP Assignment Agreement signature", date: dateStr(3), source: "Email from Tom Bradford" },
    { task: "Series B product metrics deck", date: dateStr(4), source: "Email from Rachel Kim" },
    { task: "AI Summit 2026 confirmation", date: dateStr(6), source: "Email from Dr. Sarah Foster" },
  ],
  waitingForReply: [
    {
      email_id: "demo-email-3",
      subject: "Contract renewal - 3-year proposal attached",
      sender: "marcus.webb@vertex.com",
      senderName: "Marcus Webb",
      summary: "Marcus is waiting for your counter-proposal on the Vertex Labs 3-year renewal.",
      urgency: "high",
      tags: ["CLIENT"],
    },
    {
      email_id: "demo-email-5",
      subject: "Speaking invitation: AI Summit 2026 - confirm by April 5",
      sender: "s.foster@stanford.edu",
      senderName: "Dr. Sarah Foster",
      summary: "Stanford AI Summit waiting for your keynote confirmation by April 5.",
      urgency: "medium",
      tags: [],
    },
  ],
  stats: { total: 15, critical: 2, deadlines: 3, waitingOnYou: 2, filtered: 0 },
};

// ─── DRAFT ────────────────────────────────────────────────────────────────────

export const MOCK_DRAFT = {
  id: "demo-draft-1",
  to: "marcus.webb@vertex.com",
  subject: "Re: Contract renewal - 3-year proposal attached",
  body_html: `<p>Hi Marcus,</p>
<p>Thank you for sending over the renewal proposal. I've reviewed the terms and I'm excited about continuing our partnership.</p>
<p>A few points I'd like to align on before we finalize:</p>
<p>[Continue writing...]</p>`,
  created_at: hoursAgo(5),
};

// ─── SCHEDULED EMAIL ──────────────────────────────────────────────────────────

export const MOCK_SCHEDULED = {
  id: "demo-scheduled-1",
  to_addresses: ["s.foster@stanford.edu"],
  subject: "Re: Speaking invitation: AI Summit 2026 - confirm by April 5",
  send_at: dayAt(1, 9, 0),
  status: "pending" as const,
};
