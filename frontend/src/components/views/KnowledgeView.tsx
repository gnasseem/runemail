"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useApp } from "../AppShell";
import { EmailField, useContacts } from "../EmailAutocomplete";
import AssistantChat from "../AssistantChat";

type KnowledgeEntry = {
  id: string;
  entity: string;
  entity_type: string;
  info: string;
  source: string | null;
  confidence: number;
  created_at: string;
  importance: string;
  use_count: number;
  last_used_at: string | null;
};

type DelegationRule = {
  id: string;
  pattern: string;
  target_email: string;
  is_enabled: boolean;
  weight: number;
};

type Tab = "assistant" | "knowledge" | "delegation";

export default function KnowledgeView() {
  const { user } = useApp();
  const supabase = createClient();
  const { contacts } = useContacts(user.id);
  const [tab, setTab] = useState<Tab>("assistant");
  const [loading, setLoading] = useState(true);

  // Knowledge base
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>([]);
  const [newEntity, setNewEntity] = useState("");
  const [newEntityType, setNewEntityType] = useState("person");
  const [newInfo, setNewInfo] = useState("");

  // Delegation rules
  const [delegations, setDelegations] = useState<DelegationRule[]>([]);
  const [newPattern, setNewPattern] = useState("");
  const [newTargetEmail, setNewTargetEmail] = useState("");


  useEffect(() => {
    if (tab !== "assistant") loadTab();
  }, [tab, user.id]);

  const loadTab = async () => {
    setLoading(true);
    switch (tab) {
      case "knowledge": {
        const { data } = await supabase
          .from("knowledge_base")
          .select("*")
          .eq("user_id", user.id)
          .order("importance", { ascending: true })
          .order("use_count", { ascending: false })
          .order("updated_at", { ascending: false })
          .limit(500);
        // Sort: critical > high > normal > low, then by use_count desc
        const importanceOrder: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
        const sorted = (data || []).sort((a: any, b: any) => {
          const ia = importanceOrder[a.importance] ?? 2;
          const ib = importanceOrder[b.importance] ?? 2;
          if (ia !== ib) return ia - ib;
          return (b.use_count || 0) - (a.use_count || 0);
        });
        setKnowledge(sorted);
        break;
      }
      case "delegation": {
        const { data } = await supabase
          .from("delegation_rules")
          .select("*")
          .eq("user_id", user.id)
          .order("weight", { ascending: false })
          .limit(200);
        setDelegations(data || []);
        break;
      }
    }
    setLoading(false);
  };

  const addKnowledge = async () => {
    if (!newEntity.trim() || !newInfo.trim()) return;
    const { data } = await supabase
      .from("knowledge_base")
      .insert({
        user_id: user.id,
        entity: newEntity.trim(),
        entity_type: newEntityType,
        info: newInfo.trim(),
        source: "manual",
        confidence: 1.0,
      })
      .select();
    if (data?.[0]) setKnowledge((prev) => [data[0], ...prev]);
    setNewEntity("");
    setNewInfo("");
  };

  const deleteKnowledge = async (id: string) => {
    await supabase.from("knowledge_base").delete().eq("id", id);
    setKnowledge((prev) => prev.filter((k) => k.id !== id));
  };

  const addDelegation = async () => {
    if (!newPattern.trim() || !newTargetEmail.trim()) return;
    const { data } = await supabase
      .from("delegation_rules")
      .insert({
        user_id: user.id,
        pattern: newPattern.trim(),
        target_email: newTargetEmail.trim(),
      })
      .select();
    if (data?.[0]) setDelegations((prev) => [data[0], ...prev]);
    setNewPattern("");
    setNewTargetEmail("");
  };

  const toggleDelegation = async (id: string, enabled: boolean) => {
    await supabase
      .from("delegation_rules")
      .update({ is_enabled: !enabled })
      .eq("id", id);
    setDelegations((prev) =>
      prev.map((d) => (d.id === id ? { ...d, is_enabled: !enabled } : d)),
    );
  };

  const deleteDelegation = async (id: string) => {
    await supabase.from("delegation_rules").delete().eq("id", id);
    setDelegations((prev) => prev.filter((d) => d.id !== id));
  };

  const entityTypeIcons: Record<string, string> = {
    person: "person",
    company: "business",
    project: "folder",
    topic: "label",
    location: "location_on",
    date: "event",
    other: "info",
  };

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "assistant", label: "Assistant", icon: "assistant" },
    { id: "knowledge", label: "Knowledge Base", icon: "psychology" },
    { id: "delegation", label: "Delegation Rules", icon: "forward_to_inbox" },
  ];

  return (
    <div className={`p-6 max-w-3xl mx-auto ${tab === "assistant" ? "h-full flex flex-col" : ""}`}>
      <h1 className="text-xl font-bold text-slate-900 dark:text-white mb-1">
        Knowledge & Memory
      </h1>
      <p className="text-sm text-[var(--muted)] mb-5">
        AI-extracted entities, delegation rules, cross-email relationships, and
        sender history.
      </p>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-[var(--border)] overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === t.id
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--muted)] hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: "18px" }}
            >
              {t.icon}
            </span>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "assistant" ? (
        <AssistantChat className="flex-1 min-h-0 -mx-6 border border-[var(--border)] rounded-xl overflow-hidden" />
      ) : loading ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : tab === "knowledge" ? (
        <div className="space-y-4">
          <div className="p-4 rounded-xl border border-[var(--border)] bg-slate-50 dark:bg-slate-800/50 space-y-3">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Add Knowledge Entry
            </span>
            <div className="flex flex-wrap gap-2">
              <select
                value={newEntityType}
                onChange={(e) => setNewEntityType(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm"
              >
                <option value="person">Person</option>
                <option value="company">Company</option>
                <option value="project">Project</option>
                <option value="topic">Topic</option>
                <option value="location">Location</option>
                <option value="other">Other</option>
              </select>
              <input
                type="text"
                value={newEntity}
                onChange={(e) => setNewEntity(e.target.value)}
                placeholder="Entity name"
                className="flex-1 min-w-[100px] px-3 py-1.5 rounded-lg border border-[var(--border)] bg-transparent text-sm focus:outline-none"
              />
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newInfo}
                onChange={(e) => setNewInfo(e.target.value)}
                placeholder="Key facts or notes…"
                className="flex-1 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-transparent text-sm focus:outline-none"
              />
              <button
                onClick={addKnowledge}
                disabled={!newEntity.trim() || !newInfo.trim()}
                className="px-4 py-1.5 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>

          {knowledge.length === 0 ? (
            <div className="text-center py-12 text-[var(--muted)]">
              <span
                className="material-symbols-outlined mb-2"
                style={{ fontSize: "48px" }}
              >
                psychology
              </span>
              <p className="text-sm">
                Knowledge base is empty. Entries are auto-extracted from emails
                or added manually.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {knowledge.map((k) => (
                <div
                  key={k.id}
                  className="flex items-start gap-3 p-3 rounded-xl border border-[var(--border)] group"
                >
                  <span
                    className="material-symbols-outlined text-[var(--accent)] mt-0.5"
                    style={{ fontSize: "20px" }}
                  >
                    {entityTypeIcons[k.entity_type] || "info"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-900 dark:text-white">
                        {k.entity}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[var(--muted)]">
                        {k.entity_type}
                      </span>
                      {k.source && (
                        <span className="text-[10px] text-[var(--muted)]">
                          via {k.source}
                        </span>
                      )}
                      {k.use_count > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                          used {k.use_count}x
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                      {k.info}
                    </p>
                  </div>
                  <select
                    value={k.importance || "normal"}
                    onChange={async (e) => {
                      const newImportance = e.target.value;
                      await supabase.from("knowledge_base").update({ importance: newImportance }).eq("id", k.id);
                      setKnowledge((prev) => prev.map((entry) => entry.id === k.id ? { ...entry, importance: newImportance } : entry));
                    }}
                    className={`shrink-0 text-[10px] font-medium px-1.5 py-1 rounded border border-[var(--border)] bg-[var(--surface)] cursor-pointer focus:outline-none ${
                      k.importance === "critical" ? "text-red-600 dark:text-red-400" :
                      k.importance === "high" ? "text-orange-600 dark:text-orange-400" :
                      k.importance === "low" ? "text-slate-400" : "text-[var(--muted)]"
                    }`}
                  >
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="normal">Normal</option>
                    <option value="low">Low</option>
                  </select>
                  <button
                    onClick={() => deleteKnowledge(k.id)}
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
          )}
        </div>
      ) : tab === "delegation" ? (
        <div className="space-y-4">
          <div className="p-4 rounded-xl border border-[var(--border)] bg-slate-50 dark:bg-slate-800/50 space-y-3">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Add Delegation Rule
            </span>
            <p className="text-xs text-[var(--muted)]">
              When an email matches the pattern, it will be flagged for
              forwarding to the target address.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                placeholder="Pattern (e.g. 'invoice', 'support request')"
                className="flex-1 min-w-[150px] px-3 py-1.5 rounded-lg border border-[var(--border)] bg-transparent text-sm focus:outline-none"
              />
              <EmailField
                value={newTargetEmail}
                onChange={setNewTargetEmail}
                contacts={contacts}
                placeholder="Forward to email"
                multi={false}
                className="flex-1 min-w-[150px]"
              />
              <button
                onClick={addDelegation}
                disabled={!newPattern.trim() || !newTargetEmail.trim()}
                className="px-4 py-1.5 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>

          {delegations.length === 0 ? (
            <div className="text-center py-12 text-[var(--muted)]">
              <span
                className="material-symbols-outlined mb-2"
                style={{ fontSize: "48px" }}
              >
                forward_to_inbox
              </span>
              <p className="text-sm">
                No delegation rules. Create rules to auto-forward matching
                emails.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {delegations.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center gap-3 p-3 rounded-xl border border-[var(--border)] group"
                >
                  <button onClick={() => toggleDelegation(d.id, d.is_enabled)}>
                    <span
                      className={`material-symbols-outlined ${d.is_enabled ? "text-[var(--success)]" : "text-[var(--muted)]"}`}
                      style={{
                        fontSize: "22px",
                        fontVariationSettings: d.is_enabled
                          ? "'FILL' 1"
                          : "'FILL' 0",
                      }}
                    >
                      toggle_on
                    </span>
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-slate-900 dark:text-white">
                        &ldquo;{d.pattern}&rdquo;
                      </span>
                      <span
                        className="material-symbols-outlined text-[var(--muted)]"
                        style={{ fontSize: "16px" }}
                      >
                        arrow_forward
                      </span>
                      <span className="text-sm text-[var(--accent)]">
                        {d.target_email}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => deleteDelegation(d.id)}
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
      ) : null}
    </div>
  );
}
