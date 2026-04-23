// Pre-scripted AI assistant interactions for the tutorial demo

export type ScriptedPrompt = {
  label: string;
  fullPrompt: string;
  response: string;
  /** Actions shown as colored chips inside the response */
  actions?: { type: "todo" | "meeting" | "draft"; label: string }[];
};

export const SCRIPTED_PROMPTS: ScriptedPrompt[] = [
  {
    label: "Summarize urgent emails, schedule a meeting with Marcus, and add a todo for the proposal",
    fullPrompt:
      "Summarize my urgent emails, schedule a meeting with Marcus about the contract renewal, and add a todo to prepare the proposal",
    response: `I found **3 urgent emails** that need your attention today:

**1. Series B metrics deck** - Rachel Kim, 2h ago
Rachel needs the investor metrics deck finalized by Friday 5pm. No deck means cancelled investor calls on Monday. This is blocking the Series B.

**2. IP Assignment Agreement** - Tom Bradford, yesterday
Legal requires your signature by Thursday. This is a condition precedent for the Series B close - missing it blocks the entire fundraise.

**3. Vertex Labs contract renewal** - Marcus Webb, 6h ago
Marcus is ready to sign a 3-year renewal worth ~$840K ARR but is waiting on your counter-proposal and a 30-minute alignment call.

---

I have taken the following actions:

**Meeting created:** Vertex Labs Renewal Call
With: marcus.webb@vertex.com
Wednesday, 2:00 pm - 2:30 pm
Added to your Meetings

**Todo added:** Prepare counter-proposal for Vertex Labs contract renewal
Added to your Todos

3 items completed.`,
    actions: [
      { type: "meeting", label: "Vertex Labs Renewal Call scheduled" },
      { type: "todo", label: "Todo added: Prepare counter-proposal" },
    ],
  },
  {
    label: "Draft a reply to Rachel saying the metrics deck will be ready Wednesday",
    fullPrompt:
      "Draft a reply to Rachel saying the metrics deck will be ready Wednesday, and add it as a high-priority todo",
    response: `Here is a draft reply to Rachel:

---

**To:** rachel.kim@horizonlabs.io
**Subject:** Re: Series B metrics deck needed by Friday

Hi Rachel,

The metrics deck will be ready by **Wednesday at 5pm** - well ahead of Friday. I will cover Q1 activation rates, NPS trend, ARR by segment, and the churn before/after comparison you asked for using Mixpanel data.

I will ping you Wednesday afternoon once it is in Drive so you have time to review before investor calls.

Talk soon,
Alex

---

I have also added a high-priority todo: **"Prepare Series B metrics deck - reply committed to Wednesday"**

Ready to send? I can open the compose window for you.`,
    actions: [
      { type: "draft", label: "Draft reply to Rachel prepared" },
      { type: "todo", label: "Todo added: Metrics deck by Wednesday" },
    ],
  },
  {
    label: "What does my schedule look like this week? Find a free hour on Thursday",
    fullPrompt:
      "What does my schedule look like this week? Find a free hour on Thursday for a team review",
    response: `Here is your schedule for the week:

**Today**
- 3:00 pm: Q2 Roadmap Sync (Raj, Maya, Rachel - 1hr)

**Tomorrow**
- 10:30 am: Vertex Labs Renewal Call (Marcus Webb - 30min)

**Thursday**
- 10:00 am: Sprint 24 Kickoff (Raj, Maya - 1hr)

**Friday**
- 2:00 pm: Board Meeting Prep (James Liu, Rachel - 1hr)

---

Looking at Thursday's calendar, I found a free slot:

**Thursday 11:30 am - 12:30 pm** - this slot works well, sitting between the Sprint 24 kickoff (ends 11am) and your lunch window.

Shall I create a "Team Review" meeting for Thursday at 11:30am? Just let me know who to invite.`,
    actions: [],
  },
  {
    label: "Summarize everything from Raj and Maya, create a roadmap meeting, and draft an agenda",
    fullPrompt:
      "Summarize everything from Raj and Maya this week, create a roadmap meeting for next Tuesday, and draft an agenda",
    response: `Here is a summary of recent emails from Raj and Maya:

**Raj Patel (CTO)** - Q2 roadmap decisions
Raj needs your input on 3 open questions blocking Sprint 24: (1) whether to do the microservices migration in Q2 or defer to Q3, (2) mobile app scope for enterprise iOS, and (3) whether the Gemini 2.0 upgrade is worth the 3x cost for a 40% performance gain. He recommends deferring microservices to Q3.

**Maya Lin (PM)** - Sprint 23 retro + Sprint 24 kickoff
Sprint 23 highlights: onboarding completion up 12%, deployment pipeline reliability flagged as a concern. Sprint 24 kickoff is Thursday 10am. Team is prioritizing the CSV export bug as a quick win.

---

**Meeting created:** Q2 Roadmap Discussion
With: raj.patel@horizonlabs.io, maya.lin@horizonlabs.io
Next Tuesday, 10:00 am - 11:00 am
Added to your Meetings

**Draft agenda:**

1. Microservices migration - Q2 vs Q3 decision (Raj to present tradeoffs)
2. Mobile app scope - enterprise iOS prioritization
3. Gemini 2.0 upgrade - cost/performance analysis
4. Sprint 24 alignment - key risks and dependencies
5. AOB

Meeting invite sent to Raj and Maya.`,
    actions: [
      { type: "meeting", label: "Q2 Roadmap Discussion created for Tuesday" },
      { type: "draft", label: "Agenda drafted and attached" },
    ],
  },
];

export function getScriptedResponse(prompt: string): ScriptedPrompt | null {
  const lower = prompt.toLowerCase();
  // Match by key phrases in each prompt
  if (lower.includes("marcus") && (lower.includes("contract") || lower.includes("renewal") || lower.includes("meeting"))) {
    return SCRIPTED_PROMPTS[0];
  }
  if (lower.includes("rachel") || lower.includes("metrics deck") || lower.includes("series b")) {
    return SCRIPTED_PROMPTS[1];
  }
  if (lower.includes("schedule") || lower.includes("thursday") || lower.includes("free") || lower.includes("slot")) {
    return SCRIPTED_PROMPTS[2];
  }
  if (lower.includes("raj") || lower.includes("maya") || lower.includes("roadmap") || lower.includes("agenda")) {
    return SCRIPTED_PROMPTS[3];
  }
  // Default to first prompt
  return SCRIPTED_PROMPTS[0];
}
