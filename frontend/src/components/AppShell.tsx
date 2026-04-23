"use client";

import {
  useState,
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
} from "react";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import ComposeModal from "./ComposeModal";
import AssistantPanel from "./AssistantPanel";
import { ToastContainer, type ToastItem } from "./Toast";
import AgentWorkspace from "./solve/AgentWorkspace";
import TutorialShell from "./tutorial/TutorialShell";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useLiveUpdates, type LiveChangeCounters } from "@/lib/useLiveUpdates";
import {
  startAgent as apiStartAgent,
  answerAgent as apiAnswerAgent,
  answerAgentBatch as apiAnswerAgentBatch,
  executeAgent as apiExecuteAgent,
  cancelAgent as apiCancelAgent,
  fetchSession as apiFetchSession,
  fetchTurns as apiFetchTurns,
  subscribeAgent,
  normalizeAgentSessionError,
} from "@/lib/agentClient";
import type {
  AgentSessionState,
  AgentAnswer,
  AgentBatchAnswer,
  AgentAction,
  AgentTurnRow,
  TtsJob,
} from "@/lib/agentTypes";
import {
  getBriefingTtsFromCache,
  setBriefingTtsCache,
} from "@/lib/briefingTtsCache";
import {
  getBriefingAudioAutoplay,
  persistBriefingAudioAutoplay,
} from "@/lib/briefingAudioPref";

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
  updateProfile: (patch: Partial<Profile>) => void;
  view: string;
  setView: (v: string) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  theme: "light" | "dark";
  setTheme: (v: "light" | "dark") => void;
  openCompose: (replyTo?: any, draft?: any) => void;
  addToast: (
    type: ToastItem["type"],
    message: string,
    options?: { action?: ToastItem["action"]; duration?: number },
  ) => void;
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
  setInboxCustomTags: (
    v: { slug: string; displayName: string; color: string }[],
  ) => void;
  // Draft change notifications
  draftVersion: number;
  notifyDraftChange: () => void;
  // Sent email notifications
  pendingSentEmail: {
    id: string;
    to: string;
    subject: string;
    body_html: string;
    date: string;
  } | null;
  notifySent: (email: {
    to: string;
    subject: string;
    body_html: string;
  }) => void;
  // Read receipt notifications
  pendingReceipt: {
    id: string;
    subject: string;
    recipient_email: string;
    open_count: number;
    created_at: string;
  } | null;
  notifyReceipt: (receipt: {
    subject: string;
    recipient_email: string;
  }) => void;
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
  notifyBriefingUpdated: () => void;
  briefingRegenerating: boolean;
  requestBriefingRegeneration: () => void;
  prefetchBriefingExecutiveTts: (executiveSummary: string) => void;
  /** Stored in localStorage so settings save does not require a DB migration. */
  briefingAudioAutoplay: boolean;
  setBriefingAudioAutoplay: (value: boolean) => void;
  // Assistant panel open state (used by ComposeModal to shift position)
  assistantOpen: boolean;
  // Tutorial
  startTutorial: () => void;
  // Solve-Everything agent session (survives navigation)
  agentSession: AgentSessionState | null;
  agentTurns: AgentTurnRow[];
  agentWorkspaceOpen: boolean;
  openAgentWorkspace: () => void;
  closeAgentWorkspace: () => void;
  startSolveAgent: () => Promise<void>;
  answerSolveAgent: (answer: AgentAnswer) => Promise<void>;
  answerSolveAgentBatch: (batch: AgentBatchAnswer) => Promise<void>;
  executeSolveAgent: (
    approved: AgentAction[],
  ) => Promise<
    Record<
      string,
      { status: "success" | "error"; info?: string; error?: string }
    >
  >;
  cancelSolveAgent: () => Promise<void>;
  /** True while a cancel request is in flight (direct DB update or API fallback). */
  solveAgentCancelInFlight: boolean;
  resetSolveAgent: () => void;
  // Background TTS jobs keyed by (kind+key) e.g. "briefing:<version>"
  ttsJobs: Record<string, TtsJob>;
  startTts: (
    kind: string,
    key: string,
    text: string,
    voice?: string,
  ) => Promise<void>;
  pauseTts: (kind: string, key: string) => void;
  resumeTts: (kind: string, key: string) => void;
  stopTts: (kind: string, key: string) => void;
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
  const [profileState, setProfileState] = useState<Profile>(profile);
  const updateProfile = useCallback((patch: Partial<Profile>) => {
    setProfileState((prev) => ({ ...prev, ...patch }));
  }, []);
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
  const [inboxSort, setInboxSort] = useState<"newest" | "smart">("smart");
  const [inboxCustomCategories, setInboxCustomCategories] = useState<string[]>(
    [],
  );
  const [inboxCustomTags, setInboxCustomTags] = useState<
    { slug: string; displayName: string; color: string }[]
  >([]);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [tutorialActive, setTutorialActive] = useState(false);
  const startTutorial = useCallback(() => setTutorialActive(true), []);
  const [draftVersion, setDraftVersion] = useState(0);
  const notifyDraftChange = useCallback(
    () => setDraftVersion((v) => v + 1),
    [],
  );
  const [briefingVersion, setBriefingVersion] = useState(0);
  const [briefingRegenerating, setBriefingRegenerating] = useState(false);
  const briefingGenLockRef = useRef(false);
  const viewRef = useRef(viewRaw);
  useEffect(() => {
    viewRef.current = viewRaw;
  }, [viewRaw]);
  const profileRef = useRef(profileState);
  useEffect(() => {
    profileRef.current = profileState;
  }, [profileState]);

  const [briefingAudioAutoplay, setBriefingAudioAutoplayState] = useState(() =>
    getBriefingAudioAutoplay(),
  );
  const setBriefingAudioAutoplay = useCallback((value: boolean) => {
    persistBriefingAudioAutoplay(value);
    setBriefingAudioAutoplayState(value);
  }, []);
  const [pendingSentEmail, setPendingSentEmail] = useState<{
    id: string;
    to: string;
    subject: string;
    body_html: string;
    date: string;
  } | null>(null);
  const notifySent = useCallback(
    (email: { to: string; subject: string; body_html: string }) => {
      setPendingSentEmail({
        id: `pending-${Date.now()}`,
        date: new Date().toISOString(),
        ...email,
      });
    },
    [],
  );
  const [pendingReceipt, setPendingReceipt] = useState<{
    id: string;
    subject: string;
    recipient_email: string;
    open_count: number;
    created_at: string;
  } | null>(null);
  const notifyReceipt = useCallback(
    (receipt: { subject: string; recipient_email: string }) => {
      setPendingReceipt({
        id: `pending-${Date.now()}`,
        open_count: 0,
        created_at: new Date().toISOString(),
        ...receipt,
      });
    },
    [],
  );

  const registerSyncFn = useCallback((fn: () => void) => {
    syncFnRef.current = fn;
  }, []);

  const registerAnalyzeLocallyFn = useCallback((fn: () => Promise<void>) => {
    analyzeLocallyFnRef.current = fn;
  }, []);

  // Stable ref so useLiveUpdates can call addToast without a stale closure
  const addToastRef = useRef<
    | ((
        type: ToastItem["type"],
        msg: string,
        options?: { action?: ToastItem["action"]; duration?: number },
      ) => void)
    | null
  >(null);
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
    profileState?.ai_mode || "cloud",
    profileState?.last_briefing_at ?? null,
    (profileState?.working_hours as {
      start?: string;
      end?: string;
      days?: number[];
    } | null) ?? null,
    {
      addToast: (type, msg) => addToastRef.current?.(type, msg),
      analyzeLocally: async () => {
        await analyzeLocallyFnRef.current?.();
      },
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
          supabase
            .from("todos")
            .select("*")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(50),
          supabase
            .from("meetings")
            .select("*")
            .eq("user_id", user.id)
            .gte("start_time", new Date().toISOString())
            .order("start_time", { ascending: true })
            .limit(50),
          supabase
            .from("read_receipts")
            .select("*")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(50),
        ]);
        if (todosRes.data)
          viewCacheRef.current["todos"] = {
            data: todosRes.data,
            timestamp: Date.now(),
          };
        if (meetingsRes.data)
          viewCacheRef.current["meetings_upcoming"] = {
            data: meetingsRes.data,
            timestamp: Date.now(),
          };
        if (receiptsRes.data)
          viewCacheRef.current["receipts"] = {
            data: receiptsRes.data,
            timestamp: Date.now(),
          };
      } catch {
        // Non-blocking prefetch
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [user.id]);

  // Service worker registration plus first-load push permission prompt.
  // We ask once on initial load; subsequent loads rely on the Settings button.
  useEffect(() => {
    let cancelTimer: ReturnType<typeof setTimeout> | null = null;
    import("@/lib/pushNotifications").then(
      async ({ registerServiceWorker, isPushSupported, subscribeToPush }) => {
        await registerServiceWorker();
        if (!isPushSupported()) return;
        try {
          if (typeof Notification === "undefined") return;
          const asked = localStorage.getItem("runemail_push_prompted");
          if (asked === "1" || Notification.permission !== "default") {
            localStorage.setItem("runemail_push_prompted", "1");
            return;
          }
          cancelTimer = setTimeout(async () => {
            localStorage.setItem("runemail_push_prompted", "1");
            try {
              const sb = createClient();
              const {
                data: { session },
              } = await sb.auth.getSession();
              if (!session?.access_token) return;
              await subscribeToPush(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                session.access_token,
              );
            } catch {
              /* ignore */
            }
          }, 1500);
        } catch {
          /* ignore */
        }
      },
    );
    return () => {
      if (cancelTimer) clearTimeout(cancelTimer);
    };
  }, []);

  const openCompose = (replyTo?: any, draft?: any) => {
    setComposeReplyTo(replyTo || null);
    setComposeDraft(draft || null);
    setComposeOpen(true);
    setComposeMinimized(false);
  };

  const addToast = useCallback(
    (
      type: ToastItem["type"],
      message: string,
      options?: { action?: ToastItem["action"]; duration?: number },
    ) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((prev) => [
        ...prev,
        {
          id,
          type,
          message,
          action: options?.action,
          duration: options?.duration,
        },
      ]);
    },
    [],
  );
  const notifyBriefingUpdated = useCallback(
    () => setBriefingVersion((v) => v + 1),
    [],
  );

  const invalidateViewCacheRef = useRef(invalidateViewCache);
  invalidateViewCacheRef.current = invalidateViewCache;

  const prefetchBriefingExecutiveTts = useCallback(
    async (executiveSummary: string) => {
      const text = executiveSummary.trim();
      if (!text || !getBriefingAudioAutoplay()) return;
      if (getBriefingTtsFromCache(user.id, text)) return;
      try {
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const chosenVoice = (() => {
          try {
            const stored = localStorage.getItem("runemail_tts_voice");
            if (!stored || stored.startsWith("en-US-")) return "cedar";
            return stored;
          } catch {
            return "cedar";
          }
        })();
        const apiUrl =
          process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/api/tts";
        const res = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ text, voice: chosenVoice }),
        });
        if (!res.ok) return;
        const { audioContent } = await res.json();
        if (typeof audioContent === "string" && audioContent.length > 0) {
          setBriefingTtsCache(user.id, text, audioContent);
        }
      } catch {
        /* non-critical */
      }
    },
    [user.id],
  );

  const requestBriefingRegeneration = useCallback(async () => {
    if (briefingGenLockRef.current) return;
    briefingGenLockRef.current = true;
    setBriefingRegenerating(true);
    const supabase = createClient();
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/api";
      const res = await fetch(`${apiUrl}/briefing`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data?.executiveSummary && !data?.briefing) return;
      const briefingData = data.briefing ?? data;
      const ts = Date.now();
      const iso = new Date(ts).toISOString();
      try {
        localStorage.setItem(
          `runemail_briefing_cache_${user.id}`,
          JSON.stringify({ data: briefingData, ts }),
        );
      } catch {
        /* ignore */
      }
      await supabase
        .from("profiles")
        .update({
          last_briefing: briefingData,
          last_briefing_at: iso,
        })
        .eq("id", user.id);
      updateProfile({
        last_briefing: briefingData as Profile["last_briefing"],
        last_briefing_at: iso,
      });
      invalidateViewCacheRef.current("briefing");
      notifyBriefingUpdated();
      const summaryText =
        typeof (briefingData as { executiveSummary?: string })
          .executiveSummary === "string"
          ? (briefingData as { executiveSummary: string }).executiveSummary
          : "";
      if (summaryText) void prefetchBriefingExecutiveTts(summaryText);
      if (viewRef.current !== "briefing") {
        addToast("info", "Briefing finished updating.");
      }
    } catch (err) {
      console.error("[AppShell] briefing regeneration:", err);
    } finally {
      briefingGenLockRef.current = false;
      setBriefingRegenerating(false);
    }
  }, [
    user.id,
    addToast,
    notifyBriefingUpdated,
    updateProfile,
    prefetchBriefingExecutiveTts,
  ]);

  // Keep refs in sync so useLiveUpdates callbacks can call these without stale closures
  addToastRef.current = addToast;
  onBriefingUpdatedRef.current = notifyBriefingUpdated;

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

  // ── Solve-Everything agent state ───────────────────────────────────────
  const AGENT_SESSION_KEY = `runemail_agent_session_${user.id}`;
  const [agentSession, setAgentSession] = useState<AgentSessionState | null>(
    null,
  );
  const [agentTurns, setAgentTurns] = useState<AgentTurnRow[]>([]);
  const [agentWorkspaceOpen, setAgentWorkspaceOpen] = useState(false);
  const [solveAgentCancelInFlight, setSolveAgentCancelInFlight] =
    useState(false);
  const agentUnsubRef = useRef<(() => void) | null>(null);
  const lastStatusRef = useRef<string | null>(null);
  const agentWorkspaceOpenRef = useRef(false);
  useEffect(() => {
    agentWorkspaceOpenRef.current = agentWorkspaceOpen;
  }, [agentWorkspaceOpen]);

  const loadAgentTurns = useCallback(async (sessionId: string) => {
    const supabase = createClient();
    const rows = await apiFetchTurns(supabase, sessionId);
    setAgentTurns(rows);
  }, []);

  const attachAgentRealtime = useCallback(
    (sessionId: string) => {
      agentUnsubRef.current?.();
      const supabase = createClient();
      agentUnsubRef.current = subscribeAgent(supabase, sessionId, {
        onSession: (s) => {
          setAgentSession((prev) => (prev ? { ...prev, ...s } : s));
          // Surface a toast + notification on status transitions when the
          // workspace is closed so the user knows they need to act.
          const prev = lastStatusRef.current;
          if (s.status !== prev) {
            lastStatusRef.current = s.status;
            if (!agentWorkspaceOpenRef.current) {
              if (s.status === "asking") {
                addToast("info", "Solver needs your input");
              } else if (s.status === "ready") {
                addToast("info", "Plan ready for review");
              }
            }
          }
        },
        onTurn: (t) =>
          setAgentTurns((prev) => {
            if (prev.find((p) => p.id === t.id)) return prev;
            return [...prev, t].sort((a, b) => a.idx - b.idx);
          }),
      });
    },
    [addToast],
  );

  // Restore session from sessionStorage on mount.
  useEffect(() => {
    const stored = (() => {
      try {
        const raw = sessionStorage.getItem(AGENT_SESSION_KEY);
        return raw ? (JSON.parse(raw) as { id: string }) : null;
      } catch {
        return null;
      }
    })();
    if (!stored?.id) return;
    const sid = stored.id;
    const looksLikeUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sid);
    if (!looksLikeUuid || sid === "__starting__") {
      try {
        sessionStorage.removeItem(AGENT_SESSION_KEY);
      } catch {}
      return;
    }
    const supabase = createClient();
    (async () => {
      const session = await apiFetchSession(supabase, stored.id);
      if (!session) {
        sessionStorage.removeItem(AGENT_SESSION_KEY);
        return;
      }
      setAgentSession(session);
      await loadAgentTurns(stored.id);
      if (
        ["planning", "asking", "executing", "ready"].includes(session.status)
      ) {
        attachAgentRealtime(stored.id);
      }
    })();
    return () => {
      agentUnsubRef.current?.();
      agentUnsubRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [AGENT_SESSION_KEY]);

  // Persist session id whenever it changes.
  useEffect(() => {
    if (!agentSession) {
      try {
        sessionStorage.removeItem(AGENT_SESSION_KEY);
      } catch {}
      return;
    }
    if (agentSession.id === "__starting__") {
      return;
    }
    try {
      sessionStorage.setItem(
        AGENT_SESSION_KEY,
        JSON.stringify({ id: agentSession.id }),
      );
    } catch {}
  }, [agentSession?.id, agentSession, AGENT_SESSION_KEY]);

  const startSolveAgent = useCallback(async () => {
    // Optimistic: open the workspace instantly with a placeholder session so
    // the UI feels instant. The real session_id arrives from the backend shortly
    // and we swap the state in place.
    setAgentSession({
      id: "__starting__",
      status: "planning",
      draft_actions: [],
      pending_question: null,
      plan: null,
      results: {},
    });
    setAgentTurns([]);
    setAgentWorkspaceOpen(true);

    const supabase = createClient();
    try {
      const { session_id } = await apiStartAgent(supabase);
      const session = await apiFetchSession(supabase, session_id);
      if (session) setAgentSession(session);
      else
        setAgentSession((prev) => (prev ? { ...prev, id: session_id } : prev));
      attachAgentRealtime(session_id);
    } catch (err) {
      const msg =
        normalizeAgentSessionError(err) ?? "Could not start solve agent";
      setAgentSession((prev) =>
        prev ? { ...prev, status: "error", error: msg } : prev,
      );
      addToast("error", `Could not start solve agent: ${msg}`);
    }
  }, [addToast, attachAgentRealtime]);

  const answerSolveAgent = useCallback(
    async (answer: AgentAnswer) => {
      if (!agentSession) return;
      const supabase = createClient();
      try {
        setAgentSession((s) =>
          s
            ? {
                ...s,
                pending_question: null,
                pending_questions: [],
                status: "planning",
              }
            : s,
        );
        const result = await apiAnswerAgent(supabase, agentSession.id, answer);
        const full = await apiFetchSession(supabase, agentSession.id);
        if (full) setAgentSession(full);
        await loadAgentTurns(agentSession.id);
        void result;
      } catch (err) {
        addToast("error", `Answer failed: ${(err as Error).message}`);
      }
    },
    [agentSession, addToast, loadAgentTurns],
  );

  const answerSolveAgentBatch = useCallback(
    async (batch: AgentBatchAnswer) => {
      if (!agentSession) return;
      const supabase = createClient();
      try {
        setAgentSession((s) =>
          s
            ? {
                ...s,
                pending_question: null,
                pending_questions: [],
                status: "planning",
              }
            : s,
        );
        const result = await apiAnswerAgentBatch(
          supabase,
          agentSession.id,
          batch,
        );
        const full = await apiFetchSession(supabase, agentSession.id);
        if (full) setAgentSession(full);
        await loadAgentTurns(agentSession.id);
        void result;
      } catch (err) {
        addToast("error", `Answer batch failed: ${(err as Error).message}`);
      }
    },
    [agentSession, addToast, loadAgentTurns],
  );

  const executeSolveAgent = useCallback(
    async (approved: AgentAction[]) => {
      if (!agentSession) return {};
      const supabase = createClient();
      setAgentSession((s) => (s ? { ...s, status: "executing" } : s));
      try {
        const { results } = await apiExecuteAgent(
          supabase,
          agentSession.id,
          approved,
        );
        const full = await apiFetchSession(supabase, agentSession.id);
        if (full) setAgentSession(full);
        const ok = Object.values(results).filter(
          (r) => r.status === "success",
        ).length;
        const bad = Object.values(results).filter(
          (r) => r.status === "error",
        ).length;
        addToast(
          bad ? "error" : "success",
          `Solve finished: ${ok} succeeded${bad ? `, ${bad} failed` : ""}`,
        );
        return results;
      } catch (err) {
        addToast("error", `Execute failed: ${(err as Error).message}`);
        return {} as Record<
          string,
          { status: "success" | "error"; info?: string; error?: string }
        >;
      }
    },
    [agentSession, addToast],
  );

  const cancelSolveAgent = useCallback(async () => {
    if (!agentSession) return;
    // Placeholder session (optimistic open before the backend has created the
    // real session). Just nuke local state.
    if (agentSession.id === "__starting__") {
      agentUnsubRef.current?.();
      agentUnsubRef.current = null;
      setAgentSession(null);
      setAgentTurns([]);
      setAgentWorkspaceOpen(false);
      addToast("info", "Cancelled");
      return;
    }
    setSolveAgentCancelInFlight(true);
    agentUnsubRef.current?.();
    agentUnsubRef.current = null;
    const supabase = createClient();
    const sid = agentSession.id;
    try {
      const { data: updated, error } = await supabase
        .from("agent_sessions")
        .update({
          status: "cancelled",
          pending_question: null,
          pending_questions: [],
        })
        .eq("id", sid)
        .eq("user_id", user.id)
        .select(
          "id, status, draft_actions, pending_question, pending_questions, plan, results, summary, error, updated_at, briefing_at, parent_id, bucket",
        )
        .maybeSingle();

      if (error) throw error;

      if (updated) {
        setAgentSession({
          ...(updated as unknown as AgentSessionState),
          error: normalizeAgentSessionError(
            (updated as { error?: unknown }).error,
          ) as string | null | undefined,
        });
      } else {
        await apiCancelAgent(supabase, sid);
        const full = await apiFetchSession(supabase, sid);
        if (full) setAgentSession(full);
        else
          setAgentSession((prev) =>
            prev ? { ...prev, status: "cancelled" } : prev,
          );
      }

      addToast("info", "Plan cancelled");
    } catch {
      try {
        await apiCancelAgent(supabase, sid);
        const full = await apiFetchSession(supabase, sid);
        if (full) setAgentSession(full);
        else
          setAgentSession((prev) =>
            prev ? { ...prev, status: "cancelled" } : prev,
          );
        addToast("info", "Plan cancelled");
      } catch {
        addToast("error", "Could not cancel plan");
      }
    } finally {
      setSolveAgentCancelInFlight(false);
    }
  }, [agentSession, addToast, user.id]);

  const resetSolveAgent = useCallback(() => {
    agentUnsubRef.current?.();
    agentUnsubRef.current = null;
    setAgentSession(null);
    setAgentTurns([]);
    setAgentWorkspaceOpen(false);
    try {
      sessionStorage.removeItem(AGENT_SESSION_KEY);
    } catch {}
  }, [AGENT_SESSION_KEY]);

  const openAgentWorkspace = useCallback(() => setAgentWorkspaceOpen(true), []);
  const closeAgentWorkspace = useCallback(
    () => setAgentWorkspaceOpen(false),
    [],
  );

  // ── Background TTS jobs ────────────────────────────────────────────────
  const [ttsJobs, setTtsJobs] = useState<Record<string, TtsJob>>({});
  const ttsJobsRef = useRef<Record<string, TtsJob>>({});
  useEffect(() => {
    ttsJobsRef.current = ttsJobs;
  }, [ttsJobs]);
  const ttsAudioRef = useRef<Record<string, HTMLAudioElement>>({});
  const ttsKey = (kind: string, key: string) => `${kind}:${key}`;

  const startTts = useCallback(
    async (kind: string, key: string, text: string, voice?: string) => {
      const k = ttsKey(kind, key);
      const existing = ttsJobsRef.current[k];

      if (existing?.status === "buffered" && ttsAudioRef.current[k]) {
        try {
          await ttsAudioRef.current[k].play();
          setTtsJobs((prev) => {
            const cur = prev[k];
            if (!cur) return prev;
            return { ...prev, [k]: { ...cur, status: "playing" } };
          });
        } catch {
          addToast("info", "Tap Listen again to start audio.");
        }
        return;
      }

      if (existing && existing.status === "playing") {
        ttsAudioRef.current[k]?.pause();
        setTtsJobs((prev) => ({
          ...prev,
          [k]: { ...existing, status: "paused" },
        }));
        return;
      }
      if (existing && existing.status === "paused" && ttsAudioRef.current[k]) {
        try {
          await ttsAudioRef.current[k].play();
          setTtsJobs((prev) => ({
            ...prev,
            [k]: { ...existing, status: "playing" },
          }));
        } catch {
          addToast("info", "Tap Listen again to start audio.");
        }
        return;
      }
      if (existing?.status === "loading") {
        return;
      }

      const job: TtsJob = {
        id: Math.random().toString(36).slice(2),
        kind,
        key,
        status: "loading",
        startedAt: Date.now(),
      };
      setTtsJobs((prev) => ({ ...prev, [k]: job }));

      try {
        let audioContent: string | null = null;
        if (kind === "briefing" && text.trim()) {
          audioContent = getBriefingTtsFromCache(user.id, text);
        }

        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error("Not authenticated");
        const chosenVoice =
          voice ??
          (() => {
            try {
              const stored = localStorage.getItem("runemail_tts_voice");
              if (!stored || stored.startsWith("en-US-")) return "cedar";
              return stored;
            } catch {
              return "cedar";
            }
          })();

        if (!audioContent) {
          const apiUrl =
            process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/api/tts";
          const res = await fetch(apiUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ text, voice: chosenVoice }),
          });
          if (!res.ok) throw new Error("TTS request failed");
          const body = (await res.json()) as { audioContent?: string };
          audioContent = body.audioContent ?? null;
          if (!audioContent) throw new Error("TTS request failed");
          if (kind === "briefing" && text.trim()) {
            setBriefingTtsCache(user.id, text, audioContent);
          }
        }

        const audio = new Audio(`data:audio/mp3;base64,${audioContent}`);
        ttsAudioRef.current[k] = audio;
        audio.onended = () => {
          setTtsJobs((prev) => {
            const cur = prev[k];
            if (!cur) return prev;
            return { ...prev, [k]: { ...cur, status: "done" } };
          });
          delete ttsAudioRef.current[k];
        };
        audio.onerror = () => {
          setTtsJobs((prev) => {
            const cur = prev[k];
            if (!cur) return prev;
            return {
              ...prev,
              [k]: { ...cur, status: "error", error: "playback error" },
            };
          });
        };

        try {
          await audio.play();
          setTtsJobs((prev) => {
            const cur = prev[k] ?? job;
            return {
              ...prev,
              [k]: {
                ...cur,
                status: "playing",
                audioBase64: audioContent ?? undefined,
              },
            };
          });
        } catch {
          setTtsJobs((prev) => {
            const cur = prev[k] ?? job;
            return {
              ...prev,
              [k]: {
                ...cur,
                status: "buffered",
                audioBase64: audioContent ?? undefined,
              },
            };
          });
          addToast("info", "Tap Listen again to start audio.");
        }
      } catch (err) {
        setTtsJobs((prev) => ({
          ...prev,
          [k]: { ...job, status: "error", error: (err as Error).message },
        }));
      }
    },
    [user.id, addToast],
  );

  const pauseTts = useCallback((kind: string, key: string) => {
    const k = ttsKey(kind, key);
    ttsAudioRef.current[k]?.pause();
    setTtsJobs((prev) => {
      const cur = prev[k];
      if (!cur) return prev;
      return { ...prev, [k]: { ...cur, status: "paused" } };
    });
  }, []);

  const resumeTts = useCallback((kind: string, key: string) => {
    const k = ttsKey(kind, key);
    ttsAudioRef.current[k]?.play();
    setTtsJobs((prev) => {
      const cur = prev[k];
      if (!cur) return prev;
      return { ...prev, [k]: { ...cur, status: "playing" } };
    });
  }, []);

  const stopTts = useCallback((kind: string, key: string) => {
    const k = ttsKey(kind, key);
    const audio = ttsAudioRef.current[k];
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      delete ttsAudioRef.current[k];
    }
    setTtsJobs((prev) => {
      const { [k]: _removed, ...rest } = prev;
      void _removed;
      return rest;
    });
  }, []);

  return (
    <AppContext.Provider
      value={{
        user,
        profile: profileState,
        updateProfile,
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
        notifyBriefingUpdated,
        briefingRegenerating,
        requestBriefingRegeneration,
        prefetchBriefingExecutiveTts,
        briefingAudioAutoplay,
        setBriefingAudioAutoplay,
        assistantOpen,
        startTutorial,
        agentSession,
        agentTurns,
        agentWorkspaceOpen,
        openAgentWorkspace,
        closeAgentWorkspace,
        startSolveAgent,
        answerSolveAgent,
        answerSolveAgentBatch,
        executeSolveAgent,
        cancelSolveAgent,
        solveAgentCancelInFlight,
        resetSolveAgent,
        ttsJobs,
        startTts,
        pauseTts,
        resumeTts,
        stopTts,
      }}
    >
      <div className={`${theme} h-screen flex flex-col overflow-hidden`}>
        <TopBar />
        <div
          className="flex flex-1 overflow-hidden"
          style={{
            marginRight: assistantOpen ? "380px" : "0",
            transition: "margin-right 0.2s ease",
          }}
        >
          <Sidebar />
          <main className="flex-1 overflow-auto bg-[var(--background)]">
            {children}
          </main>
        </div>

        {composeOpen && !composeMinimized && (
          <ComposeModal
            replyTo={composeReplyTo}
            draft={composeDraft}
            onClose={() => {
              setComposeOpen(false);
              setComposeDraft(null);
            }}
            onMinimize={() => setComposeMinimized(true)}
          />
        )}

        {composeOpen && composeMinimized && (
          <button
            onClick={() => setComposeMinimized(false)}
            className="fixed bottom-0 z-50 flex items-center gap-2 px-4 py-2.5 rounded-t-xl bg-[var(--accent)] text-white text-sm font-medium shadow-lg hover:opacity-90 transition-opacity"
            style={{
              right: assistantOpen ? "388px" : "16px",
              transition: "right 0.2s ease",
            }}
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
            className="fixed bottom-16 z-40 rounded-full bg-[var(--accent)] text-white shadow-lg hover:opacity-90 active:scale-95 transition-all flex items-center justify-center"
            title="Open Assistant"
            style={{
              width: "52px",
              height: "52px",
              right: "32px",
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: "24px" }}
            >
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
        <AgentWorkspace
          open={agentWorkspaceOpen}
          onClose={closeAgentWorkspace}
        />
      </div>
    </AppContext.Provider>
  );
}
