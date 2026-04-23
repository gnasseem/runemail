"use client";

import { useApp } from "../AppShell";

interface SolveAgentButtonProps {
  disabled?: boolean;
  size?: "sm" | "md";
}

/**
 * Primary entry point for the Auto-Resolve agent. Replaces the Regenerate
 * button on the briefing view. When clicked, starts (or reopens) a session and
 * opens the AgentWorkspace. The session keeps running in the background if the
 * user navigates elsewhere.
 */
export default function SolveAgentButton({
  disabled,
  size = "md",
}: SolveAgentButtonProps) {
  const { agentSession, startSolveAgent, openAgentWorkspace } = useApp();
  const busy =
    agentSession &&
    ["planning", "asking", "executing"].includes(agentSession.status);
  const ready = agentSession?.status === "ready";

  const label = busy
    ? agentSession?.status === "asking"
      ? "Review decision"
      : agentSession?.status === "executing"
        ? "Executing..."
        : "Resolving..."
    : ready
      ? "Review plan"
      : "Auto-Resolve";

  const icon = busy ? "bolt" : ready ? "check_circle" : "auto_awesome";

  const handleClick = () => {
    if (disabled) return;
    if (agentSession) {
      openAgentWorkspace();
    } else {
      void startSolveAgent();
    }
  };

  const sizeClasses =
    size === "sm" ? "px-3.5 py-1.5 text-[11.5px]" : "px-4 py-2 text-[12.5px]";

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      title={label}
      className={`group relative inline-flex items-center gap-2 rounded-full font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:hover:bg-emerald-600 transition-colors cursor-pointer shadow-[0_2px_8px_-2px_rgba(5,150,105,0.45)] ${sizeClasses}`}
    >
      <span
        className="material-symbols-outlined"
        style={{ fontSize: size === "sm" ? "14px" : "16px" }}
      >
        {icon}
      </span>
      <span className="tracking-tight">{label}</span>
      {busy && (
        <span className="solve-dot-wave text-white/90 inline-flex">
          <span />
          <span />
          <span />
        </span>
      )}
    </button>
  );
}
