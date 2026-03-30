"use client";

import { useRef, useEffect, useState } from "react";
import { useApp } from "./AppShell";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

const STATUS_CHIPS = [
  { key: "unread",  label: "Unread",   icon: "mark_email_unread", activeClass: "border-slate-400 bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600" },
  { key: "starred", label: "Starred",  icon: "star",              activeClass: "border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-700" },
];

const CATEGORY_CHIPS = [
  { key: "important",       label: "Important",       dot: "#ef4444", activeClass: "border-red-300 bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800" },
  { key: "action-required", label: "Action Required", dot: "#f59e0b", activeClass: "border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800" },
  { key: "newsletter",      label: "Newsletter",      dot: "#a855f7", activeClass: "border-violet-300 bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400 dark:border-violet-800" },
  { key: "informational",   label: "Informational",   dot: "#3b82f6", activeClass: "border-sky-300 bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400 dark:border-sky-800" },
];

export default function TopBar() {
  const {
    user, profile, theme, setTheme, setSidebarOpen,
    search, setSearch, view,
    inboxFilters, setInboxFilters, inboxSort, setInboxSort, inboxCustomCategories, inboxCustomTags,
  } = useApp();
  const supabase = createClient();
  const router = useRouter();

  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (filterMenuRef.current && !filterMenuRef.current.contains(e.target as Node)) setShowFilterMenu(false);
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) setShowSortMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  const toggleTheme = async () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    await supabase.from("profiles").update({ theme: next }).eq("id", user.id);
  };

  const initials = (profile?.display_name || user.email || "?")[0].toUpperCase();


  return (
    <header className="h-13 px-4 flex items-center justify-between border-b bg-[var(--background)] border-[var(--border)] shrink-0 z-30" style={{ height: "52px" }}>
      {/* Left: hamburger + logo */}
      <div className="flex items-center gap-2.5 shrink-0">
        <button
          onClick={() => setSidebarOpen(true)}
          className="lg:hidden p-1.5 rounded-lg hover:bg-[var(--surface-2)] text-[var(--muted)]"
        >
          <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>menu</span>
        </button>
        <div className="flex items-center gap-2">
          <img
            src="/Logo.png"
            alt="RuneMail"
            style={{ width: 28, height: 28, borderRadius: 7, objectFit: "contain" }}
          />
          <span className="runemail-wordmark text-[17px] hidden sm:inline tracking-tight">
            RuneMail
          </span>
        </div>
      </div>

      {/* Center: search + filter + sort (inbox, sent, drafts, todos, receipts) */}
      {(view === "inbox" || view === "sent" || view === "drafts" || view === "todos" || view === "receipts") && (
        <div className="flex-1 max-w-2xl mx-4 hidden md:flex items-center gap-1.5">
          {/* Search bar */}
          <div className="relative flex-1">
            <span
              className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none"
              style={{ fontSize: "15px" }}
            >
              search
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                view === "inbox" ? "Search inbox…" :
                view === "sent" ? "Search sent…" :
                view === "drafts" ? "Search drafts…" :
                view === "todos" ? "Search tasks…" :
                "Search receipts…"
              }
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[13px] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/25 focus:border-[var(--accent)]/40 transition-all"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--foreground)]"
              >
                <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>close</span>
              </button>
            )}
          </div>

          {/* Filter dropdown (inbox only) */}
          {view === "inbox" && <div className="relative shrink-0" ref={filterMenuRef}>
            <button
              onClick={() => { setShowFilterMenu(v => !v); setShowSortMenu(false); }}
              className={`px-2.5 py-1.5 rounded-lg text-[12px] font-medium border flex items-center gap-1 transition-all ${
                inboxFilters.size > 0
                  ? "border-[var(--accent)]/60 bg-[var(--accent-light)] text-[var(--accent)]"
                  : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-2)]"
              }`}
            >
              <span className="material-symbols-outlined" style={{ fontSize: "13px" }}>filter_list</span>
              Filter{inboxFilters.size > 0 ? ` (${inboxFilters.size})` : ""}
            </button>
            {showFilterMenu && (
              <div className="absolute right-0 top-full mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg p-1.5 z-50 min-w-[185px] flex flex-col gap-0.5">
                {/* Status section */}
                <p className="px-2 pt-0.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">Status</p>
                {STATUS_CHIPS.map((chip) => (
                  <button
                    key={chip.key}
                    onClick={() => {
                      const next = new Set(inboxFilters);
                      if (next.has(chip.key)) next.delete(chip.key);
                      else next.add(chip.key);
                      setInboxFilters(next);
                    }}
                    className={`w-full text-left px-2.5 py-1.5 text-[12px] rounded-md transition-colors flex items-center gap-2 ${
                      inboxFilters.has(chip.key)
                        ? `${chip.activeClass} font-semibold border`
                        : "hover:bg-[var(--surface-2)] text-[var(--foreground)]"
                    }`}
                  >
                    <span className="material-symbols-outlined shrink-0" style={{ fontSize: "13px" }}>{chip.icon}</span>
                    {chip.label}
                    {inboxFilters.has(chip.key) && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-current shrink-0" />}
                  </button>
                ))}

                {/* Categories section */}
                <p className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] border-t border-[var(--border)] mt-0.5">Categories</p>
                {[
                  ...CATEGORY_CHIPS,
                  ...inboxCustomCategories.map((c) => ({ key: c, label: c, dot: "#6b7280", activeClass: "border-slate-300 bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600" })),
                ].map((chip) => (
                  <button
                    key={chip.key}
                    onClick={() => {
                      const next = new Set(inboxFilters);
                      if (next.has(chip.key)) next.delete(chip.key);
                      else next.add(chip.key);
                      setInboxFilters(next);
                    }}
                    className={`w-full text-left px-2.5 py-1.5 text-[12px] rounded-md transition-colors flex items-center gap-2 ${
                      inboxFilters.has(chip.key)
                        ? `${chip.activeClass} font-semibold border`
                        : "hover:bg-[var(--surface-2)] text-[var(--foreground)]"
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: chip.dot }} />
                    {chip.label}
                    {inboxFilters.has(chip.key) && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-current shrink-0" />}
                  </button>
                ))}

                {/* Tags section */}
                {inboxCustomTags.length > 0 && (
                  <>
                    <p className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] border-t border-[var(--border)] mt-0.5">Tags</p>
                    {inboxCustomTags.map((tag) => (
                      <button
                        key={tag.slug}
                        onClick={() => {
                          const next = new Set(inboxFilters);
                          if (next.has(tag.slug)) next.delete(tag.slug);
                          else next.add(tag.slug);
                          setInboxFilters(next);
                        }}
                        className={`w-full text-left px-2.5 py-1.5 text-[12px] rounded-md transition-colors flex items-center gap-2 ${
                          inboxFilters.has(tag.slug)
                            ? "font-semibold border"
                            : "hover:bg-[var(--surface-2)] text-[var(--foreground)]"
                        }`}
                        style={inboxFilters.has(tag.slug) ? {
                          backgroundColor: `${tag.color}18`,
                          color: tag.color,
                          borderColor: `${tag.color}50`,
                        } : {}}
                      >
                        <span className="material-symbols-outlined shrink-0" style={{ fontSize: "13px", color: tag.color }}>label</span>
                        {tag.displayName}
                        {inboxFilters.has(tag.slug) && <span className="ml-auto w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />}
                      </button>
                    ))}
                  </>
                )}

                {inboxFilters.size > 0 && (
                  <button
                    onClick={() => setInboxFilters(new Set())}
                    className="w-full text-left px-2.5 py-1.5 text-[11px] rounded-md text-[var(--muted)] hover:bg-[var(--surface-2)] border-t border-[var(--border)] mt-0.5 pt-1.5"
                  >
                    Clear all filters
                  </button>
                )}
              </div>
            )}
          </div>}

          {/* Sort dropdown (inbox only) */}
          {view === "inbox" && <div className="relative shrink-0" ref={sortMenuRef}>
            <button
              onClick={() => { setShowSortMenu(v => !v); setShowFilterMenu(false); }}
              className="px-2.5 py-1.5 rounded-lg text-[12px] font-medium border border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-2)] flex items-center gap-1"
            >
              <span className="material-symbols-outlined" style={{ fontSize: "13px" }}>sort</span>
              {inboxSort === "newest" ? "Newest" : "Smart"}
            </button>
            {showSortMenu && (
              <div className="absolute right-0 top-full mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg p-1 z-50 min-w-[135px]">
                {([["newest", "Newest first"], ["smart", "Smart sort"]] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => { setInboxSort(key); setShowSortMenu(false); }}
                    className={`w-full text-left px-3 py-1.5 text-[12px] rounded-md hover:bg-[var(--surface-2)] transition-colors ${inboxSort === key ? "font-semibold text-[var(--accent)]" : "text-[var(--foreground)]"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>}
        </div>
      )}

      {/* Right: actions */}
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={toggleTheme}
          className="flex items-center justify-center p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--muted)] transition-colors focus:outline-none"
          title="Toggle theme"
        >
          <span className="material-symbols-outlined" style={{ fontSize: "18px", lineHeight: 1 }}>
            {theme === "light" ? "dark_mode" : "light_mode"}
          </span>
        </button>

        <div className="flex items-center gap-2 ml-2 pl-2 border-l border-[var(--border)]">
          {profile?.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt=""
              className="w-7 h-7 rounded-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center text-[var(--foreground)] font-semibold text-xs">
              {initials}
            </div>
          )}
          <button
            onClick={handleSignOut}
            className="text-[12px] font-medium text-[var(--muted)] hover:text-[var(--danger)] transition-colors focus:outline-none"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
