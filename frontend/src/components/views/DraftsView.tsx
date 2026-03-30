"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useApp } from "../AppShell";

export default function DraftsView() {
  const { user, registerSyncFn, openCompose, draftVersion, search, liveChanges } = useApp();
  const supabase = createClient();
  const [localDrafts, setLocalDrafts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadLocalDrafts = useCallback(async () => {
    const { data } = await supabase
      .from("draft_emails")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setLocalDrafts(data || []);
  }, [user.id, supabase]);

  useEffect(() => {
    loadLocalDrafts().finally(() => setLoading(false));
  }, [loadLocalDrafts]);

  useEffect(() => {
    registerSyncFn(() => loadLocalDrafts());
  }, [registerSyncFn, loadLocalDrafts]);

  // Reload when ComposeModal creates or deletes a draft
  useEffect(() => {
    if (draftVersion > 0) loadLocalDrafts();
  }, [draftVersion, loadLocalDrafts]);

  // Live updates from draft_emails table
  const prevDraftsChange = useRef(liveChanges.draft_emails);
  useEffect(() => {
    if (liveChanges.draft_emails !== prevDraftsChange.current) {
      prevDraftsChange.current = liveChanges.draft_emails;
      loadLocalDrafts();
    }
  }, [liveChanges.draft_emails, loadLocalDrafts]);

  const filtered = localDrafts.filter((d) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const snippet = d.snippet || (d.body_html ? d.body_html.replace(/<[^>]+>/g, "") : "");
    return (d.subject || "").toLowerCase().includes(q) || snippet.toLowerCase().includes(q);
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">
          Drafts
        </h1>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--muted)]">Loading drafts...</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-[var(--muted)]">
          <span className="material-symbols-outlined mb-2" style={{ fontSize: "48px" }}>drafts</span>
          <p className="text-sm">No drafts.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((d: any) => (
            <div
              key={d.id}
              onClick={() => openCompose(undefined, d)}
              className="group p-3 rounded-lg border border-[var(--border)] hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    {d.subject || "(no subject)"}
                  </p>
                  <p className="text-xs text-[var(--muted)] truncate">
                    {d.snippet || (d.body_html ? d.body_html.replace(/<[^>]+>/g, "").slice(0, 80) : "")}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-light)] text-[var(--accent)]">Draft</span>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      setLocalDrafts((prev) => prev.filter((x) => x.id !== d.id));
                      await supabase.from("draft_emails").delete().eq("id", d.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-[var(--muted)] hover:text-red-500 transition-opacity"
                    title="Delete draft"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: "15px" }}>delete</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
