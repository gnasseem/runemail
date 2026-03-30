"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useApp } from "../AppShell";

type CategoryRule = {
  id: string;
  match_type: string;
  match_value: string;
  category_slug: string;
  hits: number;
  created_at: string;
};

type Tag = {
  id: string;
  slug: string;
  display_name: string;
  color: string;
  description: string;
  rules: any[];
};

const MAIN_CATEGORIES = [
  { slug: "important", display_name: "Important", color: "#ef4444" },
  { slug: "action-required", display_name: "Action Required", color: "#f97316" },
  { slug: "newsletter", display_name: "Newsletter", color: "#a855f7" },
  { slug: "informational", display_name: "Informational", color: "#3b82f6" },
];

const PRESET_COLORS = [
  { hex: "#ef4444", name: "Red" },
  { hex: "#f97316", name: "Orange" },
  { hex: "#eab308", name: "Yellow" },
  { hex: "#22c55e", name: "Green" },
  { hex: "#10b981", name: "Emerald" },
  { hex: "#06b6d4", name: "Cyan" },
  { hex: "#3b82f6", name: "Blue" },
  { hex: "#6366f1", name: "Indigo" },
  { hex: "#a855f7", name: "Purple" },
  { hex: "#ec4899", name: "Pink" },
  { hex: "#6b7280", name: "Gray" },
  { hex: "#1e293b", name: "Slate" },
];

export default function CategoriesView() {
  const { user, addToast } = useApp();
  const supabase = createClient();
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"rules" | "tags">("rules");

  // New rule form
  const [newMatchType, setNewMatchType] = useState("subject");
  const [newMatchValue, setNewMatchValue] = useState("");
  const [newRuleTarget, setNewRuleTarget] = useState("important");

  // New tag form
  const [newTagName, setNewTagName] = useState("");
  const [newTagDescription, setNewTagDescription] = useState("");
  const [newTagColor, setNewTagColor] = useState(PRESET_COLORS[4].hex);

  useEffect(() => {
    loadData();
  }, [user.id]);

  const loadData = async () => {
    setLoading(true);
    const [rulesRes, tagsRes] = await Promise.all([
      supabase
        .from("category_rules")
        .select("*")
        .eq("user_id", user.id)
        .order("hits", { ascending: false }),
      supabase
        .from("categories")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true }),
    ]);
    setRules(rulesRes.data || []);
    setTags(tagsRes.data || []);
    setLoading(false);
  };

  const addRule = async () => {
    if (!newMatchValue.trim()) return;
    const { data } = await supabase
      .from("category_rules")
      .insert({
        user_id: user.id,
        match_type: newMatchType,
        match_value: newMatchValue.trim(),
        category_slug: newRuleTarget,
      })
      .select();
    if (data?.[0]) {
      setRules((prev) => [data[0], ...prev]);
      addToast("info", "Rule saved. It will apply to upcoming mail, not previous emails.");
    }
    setNewMatchValue("");
  };

  const deleteRule = async (id: string) => {
    await supabase.from("category_rules").delete().eq("id", id);
    setRules((prev) => prev.filter((r) => r.id !== id));
  };

  const addTag = async () => {
    if (!newTagName.trim()) return;
    const slug = newTagName.trim().toLowerCase().replace(/\s+/g, "-");
    const { data } = await supabase
      .from("categories")
      .insert({
        user_id: user.id,
        slug,
        display_name: newTagName.trim(),
        color: newTagColor,
        description: newTagDescription.trim(),
      })
      .select();
    if (data?.[0]) {
      setTags((prev) => [...prev, data[0]]);
      addToast("info", "Tag created. It will apply to upcoming mail, not previous emails.");
    }
    setNewTagName("");
    setNewTagDescription("");
    setNewTagColor(PRESET_COLORS[4].hex);
  };

  const deleteTag = async (id: string) => {
    await supabase.from("categories").delete().eq("id", id);
    setTags((prev) => prev.filter((t) => t.id !== id));
  };

  const matchTypeLabels: Record<string, string> = {
    subject: "Subject contains",
    sender: "Sender contains",
    keyword: "Body keyword",
    domain: "Sender domain",
  };

  const getRuleTargetLabel = (slug: string) => {
    const main = MAIN_CATEGORIES.find((c) => c.slug === slug);
    if (main) return main.display_name;
    const tag = tags.find((t) => t.slug === slug);
    return tag?.display_name || slug;
  };

  const getRuleTargetColor = (slug: string) => {
    const main = MAIN_CATEGORIES.find((c) => c.slug === slug);
    if (main) return main.color;
    const tag = tags.find((t) => t.slug === slug);
    return tag?.color || "#6b7280";
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-slate-900 dark:text-white mb-1">
        Categories & Tags
      </h1>
      <p className="text-sm text-[var(--muted)] mb-5">
        Every email gets one main category. Tags are optional labels you define; an email can have multiple tags.
      </p>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-[var(--border)]">
        {(["rules", "tags"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--muted)] hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            {t === "rules" ? "Categorization Rules" : "Tags"}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : tab === "rules" ? (
        <div className="space-y-4">
          {/* Add rule form */}
          <div className="p-4 rounded-xl border border-[var(--border)] bg-slate-50 dark:bg-slate-800/50 space-y-3">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Add Rule
            </span>
            <div className="flex flex-wrap gap-2">
              <select
                value={newMatchType}
                onChange={(e) => setNewMatchType(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm"
              >
                <option value="subject">Subject contains</option>
                <option value="sender">Sender contains</option>
                <option value="keyword">Body keyword</option>
                <option value="domain">Sender domain</option>
              </select>
              <input
                type="text"
                value={newMatchValue}
                onChange={(e) => setNewMatchValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addRule()}
                placeholder="Match value…"
                className="flex-1 min-w-[120px] px-3 py-1.5 rounded-lg border border-[var(--border)] bg-transparent text-sm focus:outline-none"
              />
              <select
                value={newRuleTarget}
                onChange={(e) => setNewRuleTarget(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm"
              >
                <optgroup label="Main Categories">
                  {MAIN_CATEGORIES.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.display_name}
                    </option>
                  ))}
                </optgroup>
                {tags.length > 0 && (
                  <optgroup label="Tags">
                    {tags.map((t) => (
                      <option key={t.id} value={t.slug}>
                        {t.display_name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <button
                onClick={addRule}
                disabled={!newMatchValue.trim()}
                className="px-4 py-1.5 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>

          {/* Main categories reference */}
          <div>
            <p className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-2">Main Categories</p>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {MAIN_CATEGORIES.map((c) => (
                <div key={c.slug} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border)]">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                  <span className="text-sm font-medium text-slate-900 dark:text-white">{c.display_name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Rules list */}
          {rules.length === 0 ? (
            <div className="text-center py-12 text-[var(--muted)]">
              <span
                className="material-symbols-outlined mb-2"
                style={{ fontSize: "48px" }}
              >
                rule
              </span>
              <p className="text-sm">
                No categorization rules yet. Rules are auto-learned when you
                override categories, or add them manually above.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex items-center gap-3 p-3 rounded-xl border border-[var(--border)] group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                        {matchTypeLabels[rule.match_type] || rule.match_type}
                      </span>
                      <span className="text-sm font-medium text-slate-900 dark:text-white">
                        &ldquo;{rule.match_value}&rdquo;
                      </span>
                      <span className="text-xs text-[var(--muted)]">→</span>
                      <span
                        className="text-xs px-2 py-0.5 rounded font-medium text-white"
                        style={{
                          backgroundColor: getRuleTargetColor(rule.category_slug),
                        }}
                      >
                        {getRuleTargetLabel(rule.category_slug)}
                      </span>
                    </div>
                    <span className="text-[10px] text-[var(--muted)]">
                      {rule.hits} hits
                    </span>
                  </div>
                  <button
                    onClick={() => deleteRule(rule.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-400 transition-opacity"
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: "18px" }}
                    >
                      delete
                    </span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {/* Create Tag form */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Create Tag
            </h3>
            <p className="text-xs text-[var(--muted)] mb-3">
              Tags are optional; an email can have multiple tags. Add a description so the AI knows when to apply this tag.
            </p>
            <div className="p-4 rounded-xl border border-[var(--border)] bg-slate-50 dark:bg-slate-800/50 space-y-3">
              <input
                type="text"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addTag()}
                placeholder="Tag name"
                className="w-full px-3 py-1.5 rounded-lg border border-[var(--border)] bg-transparent text-sm focus:outline-none"
              />
              <textarea
                value={newTagDescription}
                onChange={(e) => setNewTagDescription(e.target.value)}
                placeholder="Describe when this tag should be applied… (e.g. emails from my bank or about invoices and payments)"
                rows={2}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent text-sm focus:outline-none resize-none"
              />
              <div className="flex items-center gap-2">
                <label className="text-xs text-[var(--muted)] shrink-0">Color</label>
                <select
                  value={newTagColor}
                  onChange={(e) => setNewTagColor(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-slate-900 dark:text-white"
                >
                  {PRESET_COLORS.map((c) => (
                    <option key={c.hex} value={c.hex}>{c.name}</option>
                  ))}
                </select>
                <div className="w-6 h-6 rounded border border-[var(--border)] shrink-0" style={{ backgroundColor: newTagColor }} />
              </div>
              <div className="flex items-center justify-between">
                {newTagName && (
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs px-2 py-0.5 rounded font-medium text-white"
                      style={{ backgroundColor: newTagColor }}
                    >
                      {newTagName}
                    </span>
                    <span className="text-xs text-[var(--muted)]">preview</span>
                  </div>
                )}
                <button
                  onClick={addTag}
                  disabled={!newTagName.trim()}
                  className="ml-auto px-4 py-1.5 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  Create Tag
                </button>
              </div>
            </div>
          </div>

          {/* Tags list */}
          {tags.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                Your Tags
              </h3>
              <div className="space-y-2">
                {tags.map((tag) => (
                  <div
                    key={tag.id}
                    className="flex items-start gap-3 p-3 rounded-xl border border-[var(--border)] group"
                  >
                    <div
                      className="w-3 h-3 rounded-full shrink-0 mt-1"
                      style={{ backgroundColor: tag.color }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-900 dark:text-white">
                          {tag.display_name}
                        </span>
                        <span className="text-xs text-[var(--muted)] font-mono">
                          {tag.slug}
                        </span>
                      </div>
                      {tag.description && (
                        <p className="text-xs text-[var(--muted)] mt-0.5 truncate">
                          {tag.description}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => deleteTag(tag.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-400 transition-opacity shrink-0"
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: "18px" }}
                      >
                        delete
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tags.length === 0 && (
            <div className="text-center py-8 text-[var(--muted)]">
              <span
                className="material-symbols-outlined mb-2"
                style={{ fontSize: "40px" }}
              >
                label
              </span>
              <p className="text-sm">No tags yet. Create one above.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
