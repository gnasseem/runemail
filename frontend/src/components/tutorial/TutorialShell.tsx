"use client";

import { useState, useCallback, useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import TutorialNavigator from "./TutorialNavigator";
import TutorialChapterCard from "./TutorialChapterCard";
import TutorialInboxView from "./TutorialInboxView";
import TutorialBriefingView from "./TutorialBriefingView";
import TutorialTodosView from "./TutorialTodosView";
import TutorialMeetingsView from "./TutorialMeetingsView";
import TutorialReceiptsView from "./TutorialReceiptsView";
import TutorialCategoriesView from "./TutorialCategoriesView";
import TutorialAssistantPanel from "./TutorialAssistantPanel";
import TutorialComposeModal from "./TutorialComposeModal";
import { AppContext, useApp } from "@/components/AppShell";
import type { MockEmail, MockMeeting, MockReceipt } from "./mockData";

// ─── TYPES ────────────────────────────────────────────────────────────────────

type Bullet = { icon: string; text: string };

// ─── CHAPTER DEFINITIONS ─────────────────────────────────────────────────────

const CHAPTERS = [
  {
    num: 0,
    view: "inbox",
    title: "",
    subtitle: "",
    bullets: [] as Bullet[],
    showCard: false,
  },
  {
    num: 1,
    view: "inbox",
    title: "Your AI Inbox",
    subtitle:
      "Every email arrives categorized, summarized, and ready to act on.",
    bullets: [
      {
        icon: "bolt",
        text: "Emails ranked by urgency, each with a one-line summary",
      },
      {
        icon: "checklist",
        text: "Tap any email to see extracted action items",
      },
      {
        icon: "touch_app",
        text: "Use quick actions to add todos or draft replies instantly",
      },
    ] as Bullet[],
    showCard: true,
  },
  {
    num: 2,
    view: "briefing",
    title: "Your Daily Briefing",
    subtitle: "See what matters today, and let the agent clear it for you.",
    bullets: [
      {
        icon: "summarize",
        text: "One screen showing everything that matters today",
      },
      {
        icon: "event_upcoming",
        text: "Key deadlines detected from your email content",
      },
      {
        icon: "auto_awesome",
        text: "Tap Auto-Resolve to let the agent plan replies, meetings, and todos",
      },
    ] as Bullet[],
    showCard: true,
  },
  {
    num: 3,
    view: "inbox",
    title: "The AI Assistant",
    subtitle:
      "One message handles summaries, meetings, and replies all at once.",
    bullets: [
      {
        icon: "auto_awesome",
        text: "Send one message to do multiple things at once",
      },
      {
        icon: "tips_and_updates",
        text: "Try one of the suggested prompts below",
      },
    ] as Bullet[],
    showCard: true,
  },
  {
    num: 4,
    view: "todos",
    title: "Todos",
    subtitle: "Action items pulled from your emails automatically.",
    bullets: [
      {
        icon: "checklist",
        text: "Every email that needs action creates a todo",
      },
      { icon: "touch_app", text: "Mark done, or add your own from the inbox" },
    ] as Bullet[],
    showCard: true,
  },
  {
    num: 5,
    view: "meetings",
    title: "Meetings",
    subtitle: "Meeting requests from emails, ready to schedule in one click.",
    bullets: [
      {
        icon: "event_upcoming",
        text: "RuneMail detects meeting requests and fills in the details",
      },
      {
        icon: "event_available",
        text: "Pick a time slot and confirm to add it to your calendar",
      },
    ] as Bullet[],
    showCard: true,
  },
  {
    num: 6,
    view: "inbox",
    title: "Send and Track",
    subtitle: "AI drafts. Read receipts the moment your email is opened.",
    bullets: [
      {
        icon: "edit",
        text: "AI drafts your reply - click AI Draft to generate",
      },
      {
        icon: "visibility",
        text: "Toggle tracking to see when your email is opened",
      },
    ] as Bullet[],
    showCard: true,
  },
  {
    num: 7,
    view: "categories",
    title: "Labels and Tags",
    subtitle: "Create a tag once. Applied to matching emails automatically.",
    bullets: [
      {
        icon: "label",
        text: "Create a rule once, RuneMail tags matching emails automatically",
      },
      {
        icon: "category",
        text: "Built-in categories: Important, Action Required, Newsletter",
      },
    ] as Bullet[],
    showCard: true,
  },
  {
    num: 8,
    view: "followups",
    title: "Follow-up Reminders",
    subtitle: "Never let an important email go unanswered again.",
    bullets: [
      {
        icon: "schedule_send",
        text: "Track sent emails and get reminded if no one replies",
      },
      {
        icon: "lightbulb",
        text: "RuneMail auto-detects emails waiting for a response",
      },
      {
        icon: "bedtime",
        text: "Snooze, dismiss, or mark as replied to keep things tidy",
      },
    ] as Bullet[],
    showCard: true,
  },
];

// ─── COMPONENT ────────────────────────────────────────────────────────────────

type Props = {
  onComplete: () => void;
  syncComplete: boolean;
  userId: string;
};

export default function TutorialShell({
  onComplete,
  syncComplete,
  userId,
}: Props) {
  const realCtx = useApp();

  const [chapter, setChapter] = useState(0);
  const [showCard, setShowCard] = useState(false);
  const [tutView, setTutView] = useState("inbox");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeInitial, setComposeInitial] = useState<{
    to: string;
    subject: string;
  } | null>(null);
  const [exiting, setExiting] = useState(false);
  const [freeExplore, setFreeExplore] = useState(false);
  const [inboxReady, setInboxReady] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Tutorial-specific state that accumulates across chapters
  const [extraTodos, setExtraTodos] = useState<
    { id: string; text: string; source: string; email_id: string | null }[]
  >([]);
  const [extraMeetings, setExtraMeetings] = useState<MockMeeting[]>([]);
  const [extraReceipts, setExtraReceipts] = useState<MockReceipt[]>([]);

  // Sidebar badge counts (shown to make sidebar feel alive)
  const [todoBadge, setTodoBadge] = useState(6);
  const [meetingBadge, setMeetingBadge] = useState(4);

  // Override AppContext so the real Sidebar navigates within tutorial
  const handleTutorialNav = useCallback((v: string) => {
    setTutView(v);
    setMobileSidebarOpen(false);
  }, []);

  const handleTutorialOpenCompose = useCallback(() => {
    setComposeOpen(true);
  }, []);

  // The overridden context provided to Sidebar (and any other children)
  const tutCtx: typeof realCtx = {
    ...realCtx,
    view: tutView,
    setView: handleTutorialNav,
    openCompose: handleTutorialOpenCompose,
    assistantOpen: false, // hide real assistant panel
  };

  // ─── CHAPTER TRANSITIONS ───────────────────────────────────────────────────

  const goToChapter = useCallback((n: number) => {
    if (n > 7) {
      setFreeExplore(true);
      setAssistantOpen(false);
      return;
    }
    const ch = CHAPTERS[n];
    setChapter(n);
    setAssistantOpen(false);

    if (n === 0) {
      setTutView("inbox");
      return;
    }

    setTutView(ch.view);
    if (ch.showCard) {
      setShowCard(true);
    }
  }, []);

  // Start at chapter 1
  useEffect(() => {
    goToChapter(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When real sync finishes while user is in free explore, show inbox ready card
  useEffect(() => {
    if (syncComplete && freeExplore && !inboxReady) {
      setInboxReady(true);
    }
  }, [syncComplete, freeExplore, inboxReady]);

  const handleCardContinue = useCallback(() => {
    setShowCard(false);
    if (chapter === 3) {
      setTimeout(() => setAssistantOpen(true), 400);
    }
    if (chapter === 6) {
      setTimeout(() => setComposeOpen(true), 400);
    }
  }, [chapter]);

  const handleNext = useCallback(() => {
    if (chapter >= 8) setFreeExplore(true);
    else goToChapter(chapter + 1);
  }, [chapter, goToChapter]);

  const handlePrev = useCallback(() => {
    if (chapter > 1) goToChapter(chapter - 1);
  }, [chapter, goToChapter]);

  const handleExit = useCallback(() => {
    localStorage.setItem(`runemail_tutorial_v2_${userId}`, "seen");
    setExiting(true);
    setTimeout(() => onComplete(), 350);
  }, [userId, onComplete]);

  const handleInboxReady = useCallback(() => {
    localStorage.setItem(`runemail_tutorial_v2_${userId}`, "seen");
    setExiting(true);
    setTimeout(() => onComplete(), 400);
  }, [userId, onComplete]);

  // ─── IN-TUTORIAL INTERACTION HANDLERS ─────────────────────────────────────

  const handleAddTodo = useCallback(
    (text: string, emailId: string) => {
      const newTodo = {
        id: `tutorial-added-${Date.now()}`,
        text,
        source: "Quick action from email",
        email_id: emailId,
      };
      setExtraTodos((prev) => [newTodo, ...prev]);
      setTodoBadge((b) => b + 1);
      realCtx.addToast("success", `Todo added: "${text}"`);
    },
    [realCtx],
  );

  const handleMeetingScheduled = useCallback(
    (meeting: MockMeeting) => {
      setExtraMeetings((prev) => [meeting, ...prev]);
      setMeetingBadge((b) => b + 1);
      realCtx.addToast("success", `Meeting scheduled: "${meeting.title}"`);
    },
    [realCtx],
  );

  const handleMeetingFromInbox = useCallback(
    (emailId: string, title: string, attendees: string[]) => {
      const meeting: MockMeeting = {
        id: `inbox-meeting-${Date.now()}`,
        title,
        start_time: new Date(
          Date.now() + 3 * 86400000 + 11 * 3600000,
        ).toISOString(),
        end_time: new Date(
          Date.now() + 3 * 86400000 + 12 * 3600000,
        ).toISOString(),
        attendees,
        location: null,
        zoom_link: null,
        calendar_event_id: null,
        status: "confirmed",
      };
      handleMeetingScheduled(meeting);
    },
    [handleMeetingScheduled],
  );

  const handleReply = useCallback((email: MockEmail) => {
    setComposeInitial({
      to: email.sender_email,
      subject: `Re: ${email.subject}`,
    });
    setComposeOpen(true);
  }, []);

  const handleAssistantAction = useCallback(
    (type: "todo" | "meeting" | "draft", label: string) => {
      if (type === "todo") {
        const text = label.replace(/^todo added:\s*/i, "");
        setExtraTodos((prev) => [
          {
            id: `asst-todo-${Date.now()}`,
            text,
            source: "AI Assistant",
            email_id: null,
          },
          ...prev,
        ]);
        setTodoBadge((b) => b + 1);
      }
      if (type === "meeting") {
        const title = label
          .replace(/^.*?:\s*/i, "")
          .replace(/ (created|scheduled).*$/i, "");
        const m: MockMeeting = {
          id: `asst-meeting-${Date.now()}`,
          title,
          start_time: new Date(
            Date.now() + 2 * 86400000 + 14 * 3600000,
          ).toISOString(),
          end_time: new Date(
            Date.now() + 2 * 86400000 + 14.5 * 3600000,
          ).toISOString(),
          attendees: ["marcus.webb@vertex.com"],
          location: null,
          zoom_link: null,
          calendar_event_id: null,
          status: "confirmed",
        };
        setExtraMeetings((prev) => [m, ...prev]);
        setMeetingBadge((b) => b + 1);
      }
    },
    [],
  );

  const handleComposeSend = useCallback(
    (_subject: string, to: string, trackingEnabled: boolean) => {
      setComposeOpen(false);
      setComposeInitial(null);
      realCtx.addToast(
        "success",
        trackingEnabled ? "Email sent with tracking enabled" : "Email sent",
      );
      if (trackingEnabled) {
        const receipt: MockReceipt = {
          id: `tutorial-receipt-${Date.now()}`,
          tracking_id: `tut-${Date.now()}`,
          recipient_email: to,
          subject: "Re: Contract renewal - 3-year proposal attached",
          open_count: 0,
          first_opened_at: null,
          last_opened_at: null,
          created_at: new Date().toISOString(),
        };
        setExtraReceipts((prev) => [receipt, ...prev]);
      }
      // Navigate to receipts so user can see the tracked email
      setTimeout(() => setTutView("receipts"), 800);
    },
    [realCtx],
  );

  // ─── RENDER ────────────────────────────────────────────────────────────────

  const progressPercent = freeExplore ? 100 : Math.round((chapter / 8) * 100);

  return (
    <div
      className="fixed inset-0 z-[400] flex flex-col overflow-hidden"
      style={{
        background: "var(--background)",
        opacity: exiting ? 0 : 1,
        transition: "opacity 0.35s ease",
      }}
    >
      {/* Top progress bar */}
      <div className="absolute top-0 left-0 right-0 h-0.5 z-[405] bg-[var(--border)]">
        <div
          className="h-full bg-[var(--accent)] transition-all duration-700 ease-out"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* App layout using real Sidebar with overridden context */}
      <AppContext.Provider value={tutCtx}>
        {/* Mobile sidebar overlay */}
        {mobileSidebarOpen && (
          <div
            className="fixed inset-0 z-[450] md:hidden"
            onClick={() => setMobileSidebarOpen(false)}
          >
            <div className="absolute inset-0 bg-black/50" />
            <div
              className="absolute top-0 left-0 bottom-0 z-[451]"
              onClick={(e) => e.stopPropagation()}
            >
              <Sidebar />
            </div>
          </div>
        )}

        <div
          className="flex flex-1 overflow-hidden"
          style={{
            marginRight: assistantOpen ? "min(380px, 100vw)" : "0",
            transition: "margin-right 0.25s ease",
          }}
        >
          {/* Sidebar hidden on mobile */}
          <div className="hidden md:block">
            <Sidebar />
          </div>

          <main className="flex-1 overflow-auto flex flex-col bg-[var(--background)]">
            {/* Mobile top bar with hamburger */}
            <div className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] shrink-0">
              <button
                onClick={() => setMobileSidebarOpen(true)}
                className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] text-[var(--foreground)] transition-colors cursor-pointer"
                aria-label="Open menu"
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: "22px" }}
                >
                  menu
                </span>
              </button>
              <span className="text-[15px] font-bold text-[var(--foreground)] capitalize">
                {tutView}
              </span>
            </div>

            {tutView === "inbox" && (
              <TutorialInboxView
                onAddTodo={handleAddTodo}
                onReply={handleReply}
                onScheduleMeeting={handleMeetingFromInbox}
                onNavigateTodos={() => setTutView("todos")}
              />
            )}
            {tutView === "briefing" && <TutorialBriefingView />}
            {tutView === "todos" && (
              <TutorialTodosView extraTodos={extraTodos} />
            )}
            {tutView === "meetings" && (
              <TutorialMeetingsView
                extraMeetings={extraMeetings}
                onMeetingScheduled={handleMeetingScheduled}
              />
            )}
            {tutView === "receipts" && (
              <TutorialReceiptsView extraReceipts={extraReceipts} />
            )}
            {tutView === "categories" && <TutorialCategoriesView />}
            {/* Placeholder for views not in demo */}
            {![
              "inbox",
              "briefing",
              "todos",
              "meetings",
              "receipts",
              "categories",
            ].includes(tutView) && (
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="text-center max-w-xs">
                  <span
                    className="material-symbols-outlined text-[var(--muted)] mb-3"
                    style={{
                      fontSize: "40px",
                      display: "block",
                      fontVariationSettings: "'FILL' 1",
                    }}
                  >
                    grid_view
                  </span>
                  <p className="text-[14px] font-semibold text-[var(--foreground)] mb-1">
                    Demo focuses on key features
                  </p>
                  <p className="text-[13px] text-[var(--muted)]">
                    This section is available in your real account. Use the
                    navigator to continue the tour.
                  </p>
                </div>
              </div>
            )}
          </main>
        </div>
      </AppContext.Provider>

      {/* Tutorial assistant (rendered outside context override to not conflict) */}
      <TutorialAssistantPanel
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        onAction={handleAssistantAction}
      />

      {/* Tutorial compose modal */}
      {composeOpen && (
        <TutorialComposeModal
          onClose={() => {
            setComposeOpen(false);
            setComposeInitial(null);
          }}
          onSend={handleComposeSend}
          initialTo={composeInitial?.to}
          initialSubject={composeInitial?.subject}
        />
      )}

      {/* Chapter intro card */}
      <TutorialChapterCard
        chapter={chapter}
        title={CHAPTERS[chapter]?.title ?? ""}
        subtitle={CHAPTERS[chapter]?.subtitle ?? ""}
        bullets={CHAPTERS[chapter]?.bullets ?? []}
        visible={showCard}
        onContinue={handleCardContinue}
      />

      {/* Navigator - hidden during chapter cards and in free explore */}
      {!showCard && !freeExplore && (
        <TutorialNavigator
          chapter={chapter}
          totalChapters={8}
          onNext={handleNext}
          onPrev={handlePrev}
          onExit={handleExit}
          canGoNext={chapter <= 7}
          canGoPrev={chapter > 1}
        />
      )}

      {/* Free explore: slim banner at top */}
      {freeExplore && !inboxReady && (
        <div className="fixed top-2 left-1/2 z-[420] -translate-x-1/2">
          <div
            className="flex items-center gap-2.5 px-4 py-2 rounded-full border border-[var(--border)] shadow-lg text-[12px]"
            style={{
              background: "var(--background)",
              backdropFilter: "blur(12px)",
            }}
          >
            <span
              className="material-symbols-outlined text-[var(--accent)]"
              style={{
                fontSize: "14px",
                animation: "spin 1.5s linear infinite",
              }}
            >
              progress_activity
            </span>
            <span className="text-[var(--muted)]">
              Your real inbox is loading in the background
            </span>
            <button
              onClick={handleExit}
              className="ml-2 text-[var(--accent)] font-semibold hover:opacity-80 transition-opacity cursor-pointer"
            >
              Exit demo
            </button>
          </div>
        </div>
      )}

      {/* Inbox ready: chapter-card-style overlay */}
      {inboxReady && (
        <InboxReadyCard
          onEnter={handleInboxReady}
          onStay={() => setInboxReady(false)}
        />
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// ─── INBOX READY CARD ─────────────────────────────────────────────────────────

function InboxReadyCard({
  onEnter,
  onStay,
}: {
  onEnter: () => void;
  onStay: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 60);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className="fixed inset-0 z-[420] flex items-center justify-center"
      style={{
        background: "rgba(0,0,0,0.72)",
        backdropFilter: "blur(4px)",
        opacity: mounted ? 1 : 0,
        transition: "opacity 0.25s ease",
      }}
      onClick={onStay}
    >
      <div
        className="relative flex flex-col items-start max-w-lg w-full mx-4"
        style={{
          transform: mounted ? "translateY(0)" : "translateY(24px)",
          transition: "transform 0.35s cubic-bezier(0.16,1,0.3,1)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="w-full rounded-3xl p-8 border border-[var(--border)] max-h-[90vh] overflow-y-auto"
          style={{
            background:
              "linear-gradient(135deg, var(--background) 0%, var(--background) 60%, rgba(16,185,129,0.07) 100%)",
          }}
        >
          {/* Large muted number */}
          <div
            className="font-bold text-[var(--muted)] mb-2 select-none"
            style={{
              fontSize: "80px",
              lineHeight: 1,
              letterSpacing: "-0.04em",
              opacity: 0.12,
            }}
          >
            07
          </div>

          {/* Icon row */}
          <div className="flex items-center gap-3 mb-3 -mt-8">
            <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center shadow-lg">
              <span
                className="material-symbols-outlined text-white"
                style={{ fontSize: "20px", fontVariationSettings: "'FILL' 1" }}
              >
                mark_email_read
              </span>
            </div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-emerald-500">
              Your inbox is ready
            </p>
          </div>

          <h2
            className="font-bold text-[var(--foreground)] mb-3"
            style={{
              fontSize: "28px",
              lineHeight: 1.15,
              letterSpacing: "-0.02em",
            }}
          >
            Your emails are processed and waiting.
          </h2>
          <p className="text-[var(--muted)] text-[15px] leading-relaxed mb-6">
            RuneMail has fetched your inbox, generated your briefing, and
            extracted your action items. Everything is ready.
          </p>

          <button
            onClick={onEnter}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 text-white text-[13px] font-semibold hover:opacity-90 active:scale-[0.97] transition-all cursor-pointer shadow-lg mb-4"
          >
            Open my inbox
            <span
              className="material-symbols-outlined"
              style={{ fontSize: "16px" }}
            >
              arrow_forward
            </span>
          </button>

          <button
            onClick={onStay}
            className="text-[12px] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors cursor-pointer"
          >
            Keep exploring the demo
          </button>
        </div>
      </div>
    </div>
  );
}
