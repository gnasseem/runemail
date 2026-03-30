"use client";

import { useState, createContext, useContext, useCallback, useEffect, useRef } from "react";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import ComposeModal from "./ComposeModal";
import AssistantPanel from "./AssistantPanel";
import { ToastContainer, type ToastItem } from "./Toast";
import TutorialShell from "./tutorial/TutorialShell";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useLiveUpdates, type LiveChangeCounters } from "@/lib/useLiveUpdates";
import { subscribeToPush } from "@/lib/pushNotifications";

type Profile = {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  ai_mode: "cloud" | "local" | "hybrid";
  theme: "light" | "dark";
  style_notes?: string | null;
  working_hours?: Record<string, unknown> | null;
  last_briefing?: Record<string, unknown> | null;
  last_briefing_at?: string | null;
  briefing_scope?: string | null;
  calendar_send_invites?: boolean | null;
};

// In-memory view data cache for instant view switching
type ViewCacheEntry = { data: any; timestamp: number };

export type AppContextType = {
  user: User;
  profile: Profile;
  view: string;
  setView: (v: string) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  theme: "light" | "dark";
  setTheme: (v: "light" | "dark") => void;
  openCompose: (replyTo?: any, draft?: any) => void;
  addToast: (type: ToastItem["type"], message: string) => void;
  // Global search
  search: string;
  setSearch: (v: string) => void;
  // Global sync (used by InboxView for initial fetch overlay)
  syncing: boolean;
  setSyncing: (v: boolean) => void;
  registerSyncFn: (fn: () => void) => void;
  registerAnalyzeLocallyFn: (fn: () => Promise<void>) => void;
  // Inbox filter/sort (shared between TopBar and InboxView)
  inboxFilters: Set<string>;
  setInboxFilters: (v: Set<string>) => void;
  inboxSort: "newest" | "smart";
  setInboxSort: (v: "newest" | "smart") => void;
  inboxCustomCategories: string[];
  setInboxCustomCategories: (v: string[]) => void;
  inboxCustomTags: { slug: string; displayName: string; color: string }[];
  setInboxCustomTags: (v: { slug: string; displayName: string; color: string }[]) => void;
  // Draft change notifications
  draftVersion: number;
  notifyDraftChange: () => void;
  // Sent email notifications
  pendingSentEmail: { id: string; to: string; subject: string; body_html: string; date: string } | null;
  notifySent: (email: { to: string; subject: string; body_html: string }) => void;
  // Read receipt notifications
  pendingReceipt: { id: string; subject: string; recipient_email: string; open_count: number; created_at: string } | null;
  notifyReceipt: (receipt: { subject: string; recipient_email: string }) => void;
  // View data cache
  getViewCache: (key: string) => any | null;
  setViewCache: (key: string, data: any) => void;
  invalidateViewCache: (...keys: string[]) => void;
  // Live update change counters (per-table)
  liveChanges: LiveChangeCounters;
  // Processing banner (how many emails are being AI-processed)
  processingCount: number;
  // Briefing version — increments whenever a new briefing is saved
  briefingVersion: number;
  // Assistant panel open state (used by ComposeModal to shift position)
  assistantOpen: boolean;
  // Tutorial
  startTutorial: () => void;
};

export const AppContext = createContext<AppContextType | null>(null);
export const useApp = () => useContext(AppContext)!;

export default function AppShell({
  user,
  profile,
  children,
}: {
  user: User;
  profile: Profile;
  children: React.ReactNode;
}) {
  const [viewRaw, setViewRaw] = useState("inbox");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(
    profile?.theme || "light",
  );
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeReplyTo, setComposeReplyTo] = useState<any>(null);
  const [composeDraft, setComposeDraft] = useState<any>(null);
  const [composeMinimized, setComposeMinimized] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [search, setSearch] = useState("");
  const setView = useCallback((v: string) => {
    setViewRaw(v);
    setSearch("");
  }, []);
  const view = viewRaw;
  const [syncing, setSyncing] = useState(false);
  const syncFnRef = useRef<(() => void) | null>(null);
  const analyzeLocallyFnRef = useRef<(() => Promise<void>) | null>(null);
  const [inboxFilters, setInboxFilters] = useState<Set<string>>(new Set());
  const [inboxSort, setInboxSort] = useState<"newest" | "smart">("newest");
  const [inboxCustomCategories, setInboxCustomCategories] = useState<string[]>([]);
  const [inboxCustomTags, setInboxCustomTags] = useState<{ slug: string; displayName: string; color: string }[]>([]);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [tutorialActive, setTutorialActive] = useState(false);
  const startTutorial = useCallback(() => setTutorialActive(true), []);
  const [draftVersion, setDraftVersion] = useState(0);
  const notifyDraftChange = useCallback(() => setDraftVersion((v) => v + 1), []);
  const [briefingVersion, setBriefingVersion] = useState(0);
  const [pendingSentEmail, setPendingSentEmail] = useState<{ id: string; to: string; subject: string; body_html: string; date: string } | null>(null);
  const notifySent = useCallback((email: { to: string; subject: string; body_html: string }) => {
    setPendingSentEmail({ id: `pending-${Date.now()}`, date: new Date().toISOString(), ...email });
  }, []);
  const [pendingReceipt, setPendingReceipt] = useState<{ id: string; subject: string; recipient_email: string; open_count: number; created_at: string } | null>(null);
  const notifyReceipt = useCallback((receipt: { subject: string; recipient_email: string }) => {
    setPendingReceipt({ id: `pending-${Date.now()}`, open_count: 0, created_at: new Date().toISOString(), ...receipt });
  }, []);

  const registerSyncFn = useCallback((fn: () => void) => {
    syncFnRef.current = fn;
  }, []);

  const registerAnalyzeLocallyFn = useCallback((fn: () => Promise<void>) => {
    analyzeLocallyFnRef.current = fn;
  }, []);

  // Stable ref so useLiveUpdates can call addToast without a stale closure
  const addToastRef = useRef<((type: ToastItem["type"], msg: string) => void) | null>(null);
  const onBriefingUpdatedRef = useRef<(() => void) | null>(null);

  // View data cache (in-memory, survives view switches but not page reloads)
  const viewCacheRef = useRef<Record<string, ViewCacheEntry>>({});
  const getViewCache = useCallback((key: string) => {
    const entry = viewCacheRef.current[key];
    if (!entry) return null;
    // Cache valid for 5 minutes
    if (Date.now() - entry.timestamp > 5 * 60 * 1000) {
      delete viewCacheRef.current[key];
      return null;
    }
    return entry.data;
  }, []);
  const setViewCache = useCallback((key: string, data: any) => {
    viewCacheRef.current[key] = { data, timestamp: Date.now() };
  }, []);
  const invalidateViewCache = useCallback((...keys: string[]) => {
    for (const key of keys) delete viewCacheRef.current[key];
  }, []);

  // Centralized live updates (realtime + background sync + visibility refresh)
  const { changeCounters: liveChanges, processingCount } = useLiveUpdates(
    user.id,
    profile?.ai_mode || "cloud",
    profile?.last_briefing_at ?? null,
    (profile?.working_hours as { start?: string; end?: string; days?: number[] } | null) ?? null,
    {
      addToast: (type, msg) => addToastRef.current?.(type, msg),
      analyzeLocally: async () => { await analyzeLocallyFnRef.current?.(); },
      onBriefingUpdated: () => onBriefingUpdatedRef.current?.(),
    },
  );

  // Background prefetch of common view data after initial load
  const prefetchDone = useRef(false);
  useEffect(() => {
    if (prefetchDone.current) return;
    prefetchDone.current = true;
    const supabase = createClient();
    const timer = setTimeout(async () => {
      try {
        const [todosRes, meetingsRes, receiptsRes] = await Promise.all([
          supabase.from("todos").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
          supabase.from("meetings").select("*").eq("user_id", user.id).gte("start_time", new Date().toISOString()).order("start_time", { ascending: true }).limit(50),
          supabase.from("read_receipts").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
        ]);
        if (todosRes.data) viewCacheRef.current["todos"] = { data: todosRes.data, timestamp: Date.now() };
        if (meetingsRes.data) viewCacheRef.current["meetings_upcoming"] = { data: meetingsRes.data, timestamp: Date.now() };
        if (receiptsRes.data) viewCacheRef.current["receipts"] = { data: receiptsRes.data, timestamp: Date.now() };
      } catch {
        // Non-blocking prefetch
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [user.id]);

  // Register service worker and subscribe to Web Push (silent, non-blocking)
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.access_token) return;
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      subscribeToPush(supabaseUrl, session.access_token).catch(() => {
        // Push not supported or permission denied — silently ignore
      });
    });
  }, [user.id]);

  const openCompose = (replyTo?: any, draft?: any) => {
    setComposeReplyTo(replyTo || null);
    setComposeDraft(draft || null);
    setComposeOpen(true);
    setComposeMinimized(false);
  };

  const addToast = useCallback(
    (type: ToastItem["type"], message: string) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((prev) => [...prev, { id, type, message }]);
    },
    [],
  );
  // Keep refs in sync so useLiveUpdates callbacks can call these without stale closures
  addToastRef.current = addToast;
  onBriefingUpdatedRef.current = () => setBriefingVersion((v) => v + 1);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Show toast when returning from add-account redirect flow
  useEffect(() => {
    const linked = localStorage.getItem("runemail_account_linked");
    if (linked) {
      localStorage.removeItem("runemail_account_linked");
      addToast("success", `Gmail account linked: ${linked}`);
    }
  }, [addToast]);

  return (
    <AppContext.Provider
      value={{
        user,
        profile,
        view,
        setView,
        sidebarOpen,
        setSidebarOpen,
        theme,
        setTheme,
        openCompose,
        addToast,
        search,
        setSearch,
        syncing,
        setSyncing,
        registerSyncFn,
        registerAnalyzeLocallyFn,
        inboxFilters,
        setInboxFilters,
        inboxSort,
        setInboxSort,
        inboxCustomCategories,
        setInboxCustomCategories,
        inboxCustomTags,
        setInboxCustomTags,
        draftVersion,
        notifyDraftChange,
        pendingSentEmail,
        notifySent,
        pendingReceipt,
        notifyReceipt,
        getViewCache,
        setViewCache,
        invalidateViewCache,
        liveChanges,
        processingCount,
        briefingVersion,
        assistantOpen,
        startTutorial,
      }}
    >
      <div className={`${theme} h-screen flex flex-col overflow-hidden`}>
        <TopBar />
        <div className="flex flex-1 overflow-hidden" style={{ marginRight: assistantOpen ? "380px" : "0", transition: "margin-right 0.2s ease" }}>
          <Sidebar />
          <main className="flex-1 overflow-auto bg-[var(--background)]">
            {children}
          </main>
        </div>

        {composeOpen && !composeMinimized && (
          <ComposeModal
            replyTo={composeReplyTo}
            draft={composeDraft}
            onClose={() => { setComposeOpen(false); setComposeDraft(null); }}
            onMinimize={() => setComposeMinimized(true)}
          />
        )}

        {composeOpen && composeMinimized && (
          <button
            onClick={() => setComposeMinimized(false)}
            className="fixed bottom-0 z-50 flex items-center gap-2 px-4 py-2.5 rounded-t-xl bg-[var(--accent)] text-white text-sm font-medium shadow-lg hover:opacity-90 transition-opacity"
          style={{ right: assistantOpen ? "388px" : "16px", transition: "right 0.2s ease" }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: "18px" }}
            >
              edit
            </span>
            {composeReplyTo ? "Reply" : "New Email"}
            <span
              onClick={(e) => {
                e.stopPropagation();
                setComposeOpen(false);
              }}
              className="material-symbols-outlined ml-2 hover:text-white/70 cursor-pointer"
              style={{ fontSize: "16px" }}
            >
              close
            </span>
          </button>
        )}

        {/* Floating assistant button */}
        {!assistantOpen && (
          <button
            data-tour="assistant"
            onClick={() => setAssistantOpen(true)}
            className="fixed bottom-16 right-8 z-40 w-13 h-13 rounded-full bg-[var(--accent)] text-white shadow-lg hover:opacity-90 active:scale-95 transition-all flex items-center justify-center"
            title="Open Assistant"
            style={{ width: "52px", height: "52px" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "24px" }}>
              assistant
            </span>
          </button>
        )}

        <AssistantPanel
          open={assistantOpen}
          onClose={() => setAssistantOpen(false)}
        />

        {tutorialActive && (
          <TutorialShell
            userId={user.id}
            syncComplete={!syncing}
            onComplete={() => {
              setTutorialActive(false);
              setView("inbox");
            }}
          />
        )}
        <ToastContainer toasts={toasts} removeToast={removeToast} />
      </div>
    </AppContext.Provider>
  );
}
