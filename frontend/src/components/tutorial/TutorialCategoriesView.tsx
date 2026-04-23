"use client";

import { MOCK_TAGS } from "./mockData";

export default function TutorialCategoriesView() {
  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 max-w-2xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-xl bg-[var(--accent)] flex items-center justify-center">
          <span className="material-symbols-outlined text-white dark:text-[#202124]" style={{ fontSize: "18px", fontVariationSettings: "'FILL' 1" }}>label</span>
        </div>
        <div>
          <h1 className="text-[18px] font-bold text-[var(--foreground)]">Categories and Tags</h1>
          <p className="text-[12px] text-[var(--muted)]">Auto-organize with smart rules</p>
        </div>
      </div>

      {/* Built-in categories */}
      <section className="mb-6">
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-[var(--muted)] mb-3">
          Built-in AI Categories
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {[
            { name: "Important", color: "#ef4444", count: 3, icon: "priority_high" },
            { name: "Action Required", color: "#f97316", count: 5, icon: "bolt" },
            { name: "Informational", color: "#3b82f6", count: 5, icon: "info" },
            { name: "Newsletter", color: "#8b5cf6", count: 2, icon: "newspaper" },
          ].map((cat) => (
            <div
              key={cat.name}
              className="rounded-xl border border-[var(--border)] p-4 flex items-center gap-3 hover:bg-[var(--surface-2)] transition-colors"
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${cat.color}18` }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: "18px", color: cat.color, fontVariationSettings: "'FILL' 1" }}>
                  {cat.icon}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-[var(--foreground)] truncate">{cat.name}</p>
                <p className="text-[11px] text-[var(--muted)]">{cat.count} emails</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Custom tags */}
      <section>
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-[var(--muted)] mb-3 flex items-center justify-between">
          <span>Custom Tags</span>
          <button className="text-[10px] text-[var(--accent)] hover:underline font-semibold cursor-pointer">
            + New tag
          </button>
        </h2>
        <div className="flex flex-col gap-3">
          {MOCK_TAGS.map((tag) => (
            <div
              key={tag.id}
              className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4"
            >
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: tag.color }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[11px] font-bold px-2 py-0.5 rounded-md"
                      style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
                    >
                      {tag.display_name}
                    </span>
                    <span className="text-[11px] text-[var(--muted)]">{tag.description}</span>
                  </div>
                </div>
              </div>

              {/* Rules */}
              {tag.rules.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)] mb-2">
                    Auto-rules
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {tag.rules.map((rule, i) => (
                      <div key={i} className="flex items-center gap-2 text-[11px]">
                        <span className="px-1.5 py-0.5 rounded bg-[var(--surface-2)] text-[var(--muted)] font-mono">
                          {rule.match_type === "sender_domain" ? "domain" : "subject"}
                        </span>
                        <span className="text-[var(--foreground)] font-medium">{rule.match_value}</span>
                        <span className="ml-auto text-[var(--muted)]">{rule.hits} hits</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
