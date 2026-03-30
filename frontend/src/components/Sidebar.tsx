"use client";

import { useApp } from "./AppShell";

const mailItems = [
  { id: "inbox", icon: "inbox", label: "Inbox" },
  { id: "sent", icon: "send", label: "Sent" },
  { id: "drafts", icon: "drafts", label: "Drafts" },
];

const aiItems = [
  { id: "briefing", icon: "summarize", label: "Briefing" },
  { id: "todos", icon: "checklist", label: "Todos" },
  { id: "meetings", icon: "event", label: "Meetings" },
  { id: "receipts", icon: "mark_email_read", label: "Read Receipts" },
  { id: "categories", icon: "label", label: "Categories" },
];

const settingsItems = [
  { id: "settings", icon: "settings", label: "Settings" },
];

function NavGroup({ label, items, view, setView, setSidebarOpen }: {
  label: string;
  items: { id: string; icon: string; label: string }[];
  view: string;
  setView: (v: string) => void;
  setSidebarOpen: (v: boolean) => void;
}) {
  return (
    <div className="mb-4">
      <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)] opacity-60">
        {label}
      </p>
      {items.map((item) => (
        <button
          key={item.id}
          data-tour={item.id}
          onClick={() => {
            setView(item.id);
            setSidebarOpen(false);
          }}
          className={`
            w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150
            ${
              view === item.id
                ? "bg-[var(--accent-light)] text-[var(--accent)]"
                : "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
            }
          `}
        >
          <span
            className="material-symbols-outlined shrink-0"
            style={{
              fontSize: "18px",
              fontVariationSettings: view === item.id ? "'FILL' 1" : "'FILL' 0",
            }}
          >
            {item.icon}
          </span>
          {item.label}
        </button>
      ))}
    </div>
  );
}

export default function Sidebar() {
  const { view, setView, sidebarOpen, setSidebarOpen, openCompose } = useApp();

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-50
          w-52 border-r bg-[var(--sidebar-bg)] border-[var(--border)]
          transform transition-transform duration-200 ease-out
          lg:transform-none
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
          flex flex-col pt-3 pb-3
        `}
      >
        {/* Compose button */}
        <div className="px-3 mb-5">
          <button
            data-tour="compose"
            onClick={() => {
              openCompose();
              setSidebarOpen(false);
            }}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-[var(--accent)] text-[13px] font-semibold shadow-sm hover:opacity-90 active:scale-[0.98] transition-all duration-150 text-white dark:text-[#202124]"
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: "18px", fontVariationSettings: "'FILL' 1" }}
            >
              edit
            </span>
            Compose
          </button>
        </div>

        <nav className="flex-1 px-2 overflow-y-auto">
          <NavGroup label="Mail" items={mailItems} view={view} setView={setView} setSidebarOpen={setSidebarOpen} />
          <NavGroup label="AI Features" items={aiItems} view={view} setView={setView} setSidebarOpen={setSidebarOpen} />
          <NavGroup label="Account" items={settingsItems} view={view} setView={setView} setSidebarOpen={setSidebarOpen} />
        </nav>
      </aside>
    </>
  );
}
