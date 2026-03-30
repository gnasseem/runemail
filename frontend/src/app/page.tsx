"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import "./landing.css";

type AIMode = "cloud" | "local" | "hybrid";

const AI_MODES: { id: AIMode; name: string; desc: string; icon: React.ReactNode }[] = [
  {
    id: "local",
    name: "Local",
    desc: "AI runs entirely in your browser. Nothing ever leaves your device.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2"/>
        <path d="M8 21h8M12 17v4"/>
        <path d="M7 8h1m3 0h1m3 0h1"/>
        <path d="M7 11h10"/>
      </svg>
    ),
  },
  {
    id: "cloud",
    name: "Cloud",
    desc: "Powerful server-side AI via Gemini. Fast and always available.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 0 1 0 9Z"/>
      </svg>
    ),
  },
  {
    id: "hybrid",
    name: "Hybrid",
    desc: "Local first, falls back to cloud. Best of both worlds.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/>
      </svg>
    ),
  },
];

function AIModeModal({ onContinue, onClose }: { onContinue: (mode: AIMode, theme: "dark" | "light") => void; onClose: () => void }) {
  const [selected, setSelected] = useState<AIMode>("cloud");
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  return (
    <div className="ax-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ax-modal">
        <button className="ax-modal-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="ax-modal-label">Before you begin</div>
        <h2 className="ax-modal-title">Personalise your<br />RuneMail experience</h2>
        <p className="ax-modal-sub">Pick how your AI runs and how the app looks. Both can be changed anytime in Settings.</p>

        {/* AI Mode */}
        <div className="ax-modal-section-label">AI processing</div>
        <div className="ax-mode-grid">
          {AI_MODES.map((mode) => (
            <button
              key={mode.id}
              className={`ax-mode-card${selected === mode.id ? " selected" : ""}`}
              onClick={() => setSelected(mode.id)}
            >
              <div className="ax-mode-check">
                <div className="ax-mode-check-dot" />
              </div>
              <div className="ax-mode-icon">{mode.icon}</div>
              <div>
                <div className="ax-mode-name">{mode.name}</div>
                <div className="ax-mode-desc">{mode.desc}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Theme */}
        <div className="ax-modal-section-label" style={{ marginTop: 28 }}>Appearance</div>
        <div className="ax-theme-row">
          <button
            className={`ax-theme-option${theme === "dark" ? " selected" : ""}`}
            onClick={() => {
              setTheme("dark");
              document.documentElement.classList.remove("theme-light");
              document.documentElement.classList.add("theme-dark");
              localStorage.setItem("runemail_pending_theme", "dark");
            }}
          >
            <span className="ax-theme-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            </span>
            <span className="ax-theme-label">Dark</span>
          </button>
          <button
            className={`ax-theme-option${theme === "light" ? " selected" : ""}`}
            onClick={() => {
              setTheme("light");
              document.documentElement.classList.remove("theme-dark");
              document.documentElement.classList.add("theme-light");
              localStorage.setItem("runemail_pending_theme", "light");
            }}
          >
            <span className="ax-theme-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4"/>
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
              </svg>
            </span>
            <span className="ax-theme-label">Light</span>
          </button>
        </div>

        <button className="ax-modal-continue" style={{ marginTop: 32 }} onClick={() => onContinue(selected, theme)}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Continue with Google
        </button>
      </div>
    </div>
  );
}

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
  </svg>
);

export default function LandingPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const [showModeModal, setShowModeModal] = useState(false);

  const triggerOAuth = async (mode: AIMode, theme: "dark" | "light") => {
    setShowModeModal(false);
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?ai_mode=${mode}&theme=${theme}&is_signup=1`,
        scopes:
          "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events",
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
  };

  const triggerDirectSignIn = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes:
          "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events",
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
  };

  const handleSignUp = () => setShowModeModal(true);
  const handleSignIn = triggerDirectSignIn;

  useEffect(() => {
    const checkAndRedirect = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { count } = await supabase
        .from("gmail_accounts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("is_active", true);
      if (count && count > 0) window.location.href = "/app";
    };
    checkAndRedirect();
  }, []);

  useEffect(() => {
    // ── 1. Perspective grid canvas ──
    const canvas = canvasRef.current;
    let animFrame = 0;
    let t = 0;
    if (canvas) {
      const ctx = canvas.getContext("2d")!;
      const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
      resize();
      window.addEventListener("resize", resize);

      const tick = () => {
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        const cx = w / 2;
        const hy = h * 0.56;
        t += 0.0008;

        // Converging vertical lines
        const numV = 22;
        for (let i = 0; i <= numV; i++) {
          const frac = i / numV;
          const bx = -w * 0.25 + frac * w * 1.5;
          ctx.beginPath();
          ctx.moveTo(cx, hy);
          ctx.lineTo(bx, h + 20);
          ctx.strokeStyle = "rgba(200,255,0,0.028)";
          ctx.lineWidth = 0.7;
          ctx.stroke();
        }

        // Scrolling horizontal lines
        const numH = 18;
        for (let j = 0; j < numH; j++) {
          const raw = ((j / numH) + t) % 1;
          const progress = Math.pow(raw, 1.6);
          const y = hy + (h + 20 - hy) * progress;
          const halfW = w * 0.75 * progress;
          const alpha = progress * 0.072;
          ctx.beginPath();
          ctx.moveTo(cx - halfW, y);
          ctx.lineTo(cx + halfW, y);
          ctx.strokeStyle = `rgba(200,255,0,${alpha})`;
          ctx.lineWidth = 0.7;
          ctx.stroke();
        }

        // Floating dots
        const seed = Math.sin(t * 0.4) * 10000;
        for (let k = 0; k < 28; k++) {
          const px = (Math.sin(k * 7.3 + seed * 0.001) * 0.5 + 0.5) * w;
          const py = (Math.cos(k * 5.1 + seed * 0.0013) * 0.5 + 0.5) * h * 0.9;
          const alpha = (Math.sin(k + t * 2) * 0.5 + 0.5) * 0.12;
          ctx.beginPath();
          ctx.arc(px, py, 1.2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(200,255,0,${alpha})`;
          ctx.fill();
        }

        animFrame = requestAnimationFrame(tick);
      };
      tick();
    }

    // ── 2. Cursor glow ──
    const cursor = cursorRef.current;
    let raf: number | null = null;
    const onMove = (e: MouseEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        if (cursor) { cursor.style.left = e.clientX + "px"; cursor.style.top = e.clientY + "px"; }
      });
    };
    document.addEventListener("mousemove", onMove);

    // ── 3. Navbar scroll ──
    const nav = document.getElementById("ax-nav");
    const onScroll = () => { if (nav) nav.classList.toggle("scrolled", window.scrollY > 40); };
    window.addEventListener("scroll", onScroll);

    // ── 4. Scroll-in animations ──
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add("visible"); }),
      { threshold: 0.08, rootMargin: "0px 0px -50px 0px" }
    );
    document.querySelectorAll(".fade-up").forEach((el) => obs.observe(el));

    // ── 5. Animated stat counters ──
    const counterObs = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target as HTMLElement;
        const target = parseFloat(el.dataset.target || "0");
        const isFloat = el.dataset.float === "1";
        const suffix = el.dataset.suffix || "";
        const duration = 1400;
        const start = performance.now();
        const step = (now: number) => {
          const pct = Math.min((now - start) / duration, 1);
          const ease = 1 - Math.pow(1 - pct, 3);
          const val = target * ease;
          el.textContent = (isFloat ? val.toFixed(1) : Math.round(val).toString()) + suffix;
          if (pct < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
        counterObs.unobserve(el);
      });
    }, { threshold: 0.6 });
    document.querySelectorAll(".ax-counter").forEach((el) => counterObs.observe(el));

    // ── 6. Feature tabs ──
    const tabHandler = (ev: Event) => {
      const tab = ev.currentTarget as HTMLElement;
      const target = tab.dataset.tab;
      document.querySelectorAll(".ax-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      document.querySelectorAll(".ax-tab-pane").forEach((p) => {
        p.classList.remove("active");
        if ((p as HTMLElement).dataset.pane === target) {
          p.classList.add("active");
          // Ensure all fade-up cards in this pane are visible
          p.querySelectorAll(".fade-up").forEach((el) => el.classList.add("visible"));
          // Restart CSS animations on bento visuals so they replay on every tab switch
          const animated = p.querySelectorAll<HTMLElement>(
            ".bv-inbox-row, .bv-cat-chip, .bv-brief-title, .bv-brief-line, .bv-typetext, .bv-cursor"
          );
          animated.forEach((el) => {
            el.style.animation = "none";
            void el.getBoundingClientRect(); // force reflow
            el.style.animation = "";
          });
        }
      });
    };
    const tabs = document.querySelectorAll(".ax-tab");
    tabs.forEach((t) => t.addEventListener("click", tabHandler as EventListener));

    // ── 7. Card 3D tilt ──
    const tiltCards = document.querySelectorAll<HTMLElement>(".tilt-card");
    const tiltHandlers: Array<{ el: HTMLElement; enter: () => void; move: (e: MouseEvent) => void; leave: () => void }> = [];
    tiltCards.forEach((card) => {
      const enter = () => { card.style.transition = "transform 0.05s ease"; };
      const move = (e: MouseEvent) => {
        const rect = card.getBoundingClientRect();
        const mx = (e.clientX - rect.left) / rect.width - 0.5;
        const my = (e.clientY - rect.top) / rect.height - 0.5;
        card.style.transform = `perspective(800px) rotateY(${mx * 10}deg) rotateX(${-my * 8}deg) scale(1.015)`;
      };
      const leave = () => {
        card.style.transition = "transform 0.6s cubic-bezier(0.16,1,0.3,1)";
        card.style.transform = "";
      };
      card.addEventListener("mouseenter", enter);
      card.addEventListener("mousemove", move);
      card.addEventListener("mouseleave", leave);
      tiltHandlers.push({ el: card, enter, move, leave });
    });

    // ── 8. Smooth scroll ──
    const smoothFn = (ev: Event) => {
      const a = ev.currentTarget as HTMLAnchorElement;
      const target = document.querySelector(a.getAttribute("href") ?? "");
      if (target) { ev.preventDefault(); target.scrollIntoView({ behavior: "smooth", block: "start" }); }
    };
    const anchors = document.querySelectorAll('a[href^="#"]');
    anchors.forEach((a) => a.addEventListener("click", smoothFn as EventListener));

    return () => {
      cancelAnimationFrame(animFrame);
      document.removeEventListener("mousemove", onMove);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", () => {});
      obs.disconnect();
      counterObs.disconnect();
      tabs.forEach((t) => t.removeEventListener("click", tabHandler as EventListener));
      tiltHandlers.forEach(({ el, enter, move, leave }) => {
        el.removeEventListener("mouseenter", enter);
        el.removeEventListener("mousemove", move);
        el.removeEventListener("mouseleave", leave);
      });
      anchors.forEach((a) => a.removeEventListener("click", smoothFn as EventListener));
    };
  }, []);

  const marqueeItems = [
    "AI Categorization", "Smart Drafting", "Read Receipts",
    "Todo Extraction", "Meeting Scheduling", "Daily Briefing",
    "Multi-Account", "Local AI Mode", "Privacy First",
    "Zoom Integration", "Style Learning", "One-Click Reply",
    "AI Chatbot", "Natural Language", "Chat to Send",
  ];

  return (
    <>
      {showModeModal && (
        <AIModeModal onContinue={(mode, theme) => triggerOAuth(mode, theme)} onClose={() => setShowModeModal(false)} />
      )}

      {/* Cursor glow */}
      <div className="ax-cursor" ref={cursorRef} style={{ left: "50vw", top: "50vh" }} />

      {/* ── Navbar ── */}
      <nav className="ax-nav" id="ax-nav">
        <div className="ax-container">
          <div className="ax-nav-inner">
            <a className="ax-brand" href="/">
              <img src="/Logo.png" alt="RuneMail" width={32} height={32} style={{ borderRadius: 8, objectFit: "contain" }} />
              <span className="ax-wordmark">RuneMail</span>
            </a>
            <div className="ax-nav-links">
              <a className="ax-nav-link" href="#features">Features</a>
              <a className="ax-nav-link" href="#ai-chat">AI Chat</a>
              <a className="ax-nav-link" href="#compare">Compare</a>
              <button className="ax-nav-link" style={{ background: "none", border: "none", cursor: "pointer" }} onClick={handleSignIn}>Sign in</button>
              <button className="ax-nav-cta" onClick={handleSignUp}>Get started</button>
            </div>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="ax-hero">
        <canvas className="ax-grid-canvas" ref={canvasRef} />
        <div className="ax-hero-scanline" />
        <div className="ax-container" style={{ position: "relative", zIndex: 2 }}>
          <div className="ax-hero-inner">
            <div className="ax-hero-content">
              <div className="ax-hero-badge fade-up">
                <span className="badge-pulse" />
                Local AI · runs entirely in your browser
              </div>
              <h1 className="ax-hero-title">
                <span className="ht-line ht-1 fade-up">YOUR EMAIL.</span>
                <span className="ht-line ht-2 fade-up">FINALLY</span>
                <span className="ht-line ht-3 fade-up">THINKS<span className="ht-dot">.</span></span>
              </h1>
              <p className="ax-hero-sub fade-up">
                RuneMail layers AI intelligence on top of Gmail. Every email is categorized, summarized, and acted upon the moment it arrives. Inbox chaos becomes structured clarity.
              </p>
              <div className="ax-hero-cta fade-up">
                <button className="ax-btn-primary" onClick={handleSignUp}>
                  <GoogleIcon />
                  Sign up with Google
                </button>
                <button className="ax-btn-ghost" style={{ background: "none", border: "none", cursor: "pointer" }} onClick={handleSignIn}>
                  Sign in
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              </div>
              <div className="ax-trust fade-up">
                <span><span className="trust-check">✓</span> Free forever</span>
                <span><span className="trust-check">✓</span> No credit card</span>
                <span><span className="trust-check">✓</span> Works with Gmail</span>
              </div>
            </div>

            {/* Mockup */}
            <div className="ax-hero-visual fade-up">
              <div className="ax-mockup-wrap tilt-card">
                <div className="ax-mockup-glow" />
                <div className="ax-mockup">
                  <div className="ax-mockup-chrome">
                    <div className="ax-m-dots">
                      <span /><span /><span />
                    </div>
                    <span className="ax-m-title">RuneMail</span>
                    <span className="ax-m-status">
                      <span className="ax-m-dot" />
                      AI Active
                    </span>
                  </div>
                  <div className="ax-mockup-body">
                    <div className="ax-m-sidebar">
                      {[
                        { icon: "inbox", active: true },
                        { icon: "send", active: false },
                        { icon: "summarize", active: false },
                        { icon: "task_alt", active: false },
                        { icon: "event", active: false },
                        { icon: "settings", active: false },
                      ].map(({ icon, active }, i) => (
                        <div key={i} className={`ax-m-navicon${active ? " active" : ""}`}>
                          <span className="material-symbols-rounded" style={{ fontSize: "13px" }}>{icon}</span>
                        </div>
                      ))}
                    </div>
                    <div className="ax-m-list">
                      {[
                        { from: "Team Standup", subj: "Sprint review moved to 3 PM", badge: "Important", bc: "badge-important", color: "linear-gradient(135deg,#2563eb,#60a5fa)" },
                        { from: "Sarah Chen", subj: "Contract needs signature by Friday", badge: "Action", bc: "badge-action", color: "linear-gradient(135deg,#e8710a,#fbbf24)" },
                        { from: "Newsletter", subj: "Weekly digest: 5 articles for you", badge: "Newsletter", bc: "badge-news", color: "linear-gradient(135deg,#7c3aed,#a78bfa)" },
                        { from: "Alex Rivera", subj: "Quick question about Q4 budget", badge: "Info", bc: "badge-info", color: "linear-gradient(135deg,#0369a1,#38bdf8)" },
                        { from: "Billing Alert", subj: "Invoice #4421 ready for review", badge: "Action", bc: "badge-action", color: "linear-gradient(135deg,#15803d,#4ade80)" },
                      ].map((email, i) => (
                        <div key={i} className={`ax-m-row${i === 0 ? " selected" : ""}`}>
                          <div className="ax-m-avatar" style={{ background: email.color }} />
                          <div className="ax-m-text">
                            <div className="ax-m-from">{email.from}</div>
                            <div className="ax-m-subj">{email.subj}</div>
                          </div>
                          <span className={`ax-m-badge ${email.bc}`}>{email.badge}</span>
                        </div>
                      ))}
                      <div className="ax-m-ai-bar">
                        <span className="ax-m-ai-label">
                          <span className="ai-blink">▋</span>
                          AI processing 3 new emails…
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Ticker ── */}
      <div className="ax-ticker">
        <div className="ax-ticker-track">
          {[0, 1].map((pass) => (
            <div key={pass} className="ax-ticker-inner">
              {marqueeItems.map((item, i) => (
                <span key={i} className="ax-ticker-item">
                  <span className="ax-ticker-sep">/</span>
                  {item}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ── Stats ── */}
      <section className="ax-stats">
        <div className="ax-container">
          <div className="ax-stats-grid">
            <div className="ax-stat-item fade-up">
              <div className="ax-stat-num-wrap">
                <span className="ax-counter ax-stat-num" data-target="10" data-suffix="×">0×</span>
              </div>
              <span className="ax-stat-label">Faster email triage</span>
            </div>
            <div className="ax-stat-item fade-up" style={{ animationDelay: "0.1s" }}>
              <div className="ax-stat-num-wrap">
                <span className="ax-counter ax-stat-num" data-target="100" data-suffix="%">0%</span>
              </div>
              <span className="ax-stat-label">Privacy-first design</span>
            </div>
            <div className="ax-stat-item fade-up" style={{ animationDelay: "0.2s" }}>
              <div className="ax-stat-num-wrap">
                <span className="ax-stat-num ax-stat-label-val">Local</span>
              </div>
              <span className="ax-stat-label">AI runs in your browser</span>
            </div>
            <div className="ax-stat-item fade-up" style={{ animationDelay: "0.3s" }}>
              <div className="ax-stat-num-wrap">
                <span className="ax-stat-num ax-stat-label-val">Free</span>
              </div>
              <span className="ax-stat-label">No subscription required</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features Bento ── */}
      <section className="ax-features" id="features">
        <div className="ax-container">
          <div className="ax-section-head fade-up">
            <div className="ax-label">FEATURES</div>
            <h2 className="ax-section-title">
              Everything Gmail does.<br />
              <span className="ax-lime">Plus an AI brain.</span>
            </h2>
            <p className="ax-section-sub">
              RuneMail layers an intelligent AI engine on top of the full inbox experience you already know. No plugins, no learning curve.
            </p>
            <div className="ax-tabs">
              <button className="ax-tab active" data-tab="intelligence">
                <span className="material-symbols-rounded" style={{ fontSize: "14px" }}>psychology</span>
                Intelligence
              </button>
              <button className="ax-tab" data-tab="productivity">
                <span className="material-symbols-rounded" style={{ fontSize: "14px" }}>bolt</span>
                Productivity
              </button>
              <button className="ax-tab" data-tab="flexibility">
                <span className="material-symbols-rounded" style={{ fontSize: "14px" }}>tune</span>
                Flexibility
              </button>
              <button className="ax-tab" data-tab="chat">
                <span className="material-symbols-rounded" style={{ fontSize: "14px" }}>chat</span>
                AI Chat
              </button>
            </div>
          </div>

          <div className="ax-tab-panes">
            {/* Intelligence */}
            <div className="ax-tab-pane active" data-pane="intelligence">
              <div className="ax-bento">
                <div className="ax-bento-card ax-bento--a tilt-card fade-up">
                  <div className="ax-bento-visual">
                    <div className="bv-inbox">
                      <div className="bv-inbox-row"><div className="bv-inbox-line" /><div className="bv-cat-chip bv-cat--important">Important</div></div>
                      <div className="bv-inbox-row"><div className="bv-inbox-line" /><div className="bv-cat-chip bv-cat--action">Action</div></div>
                      <div className="bv-inbox-row"><div className="bv-inbox-line" /><div className="bv-cat-chip bv-cat--info">Info</div></div>
                      <div className="bv-inbox-row"><div className="bv-inbox-line" /><div className="bv-cat-chip bv-cat--news">Newsletter</div></div>
                    </div>
                  </div>
                  <h3>AI Categorization</h3>
                  <p>Every email automatically sorted into smart categories. See what matters first, no filters needed.</p>
                </div>
                <div className="ax-bento-card ax-bento--b tilt-card fade-up">
                  <div className="ax-bento-visual">
                    <div className="bv-brief">
                      <div className="bv-brief-title" />
                      <div className="bv-brief-line" style={{ width: "85%" }} />
                      <div className="bv-brief-line" style={{ width: "72%" }} />
                      <div className="bv-brief-line" style={{ width: "90%" }} />
                      <div className="bv-brief-line" style={{ width: "61%" }} />
                    </div>
                  </div>
                  <h3>Daily Briefing</h3>
                  <p>A personal assistant that greets you every morning with a digest of your inbox and today&apos;s schedule.</p>
                </div>
                <div className="ax-bento-card ax-bento--c tilt-card fade-up">
                  <div className="ax-bento-visual">
                    <div className="bv-compose">
                      <div className="bv-compose-meta">
                        <span className="bv-compose-label">To</span>
                        <span className="bv-compose-val">sarah@company.com</span>
                      </div>
                      <div className="bv-compose-meta">
                        <span className="bv-compose-label">Re</span>
                        <span className="bv-compose-val">Q4 Strategy</span>
                      </div>
                      <div className="bv-compose-body">
                        <span className="bv-typetext">Hi Sarah, thanks for your note. I&apos;ll review the doc and follow up by Friday.</span>
                        <span className="bv-cursor">|</span>
                      </div>
                    </div>
                  </div>
                  <h3>Smart Drafting</h3>
                  <p>One click, one AI-written reply that matches your personal writing style and tone.</p>
                </div>
              </div>
            </div>

            {/* Productivity */}
            <div className="ax-tab-pane" data-pane="productivity">
              <div className="ax-bento">
                <div className="ax-bento-card ax-bento--a tilt-card fade-up">
                  <div className="ax-bento-visual">
                    <div className="bv-todos">
                      {[true, true, false, false].map((done, i) => (
                        <div key={i} className="bv-todo-row">
                          <div className={`bv-check${done ? " done" : ""}`}>{done ? "✓" : ""}</div>
                          <div className={`bv-todo-bar${done ? " done" : ""}`} />
                        </div>
                      ))}
                    </div>
                  </div>
                  <h3>Todo Extraction</h3>
                  <p>Action items buried in email threads are automatically surfaced as todos, before you even ask.</p>
                </div>
                <div className="ax-bento-card ax-bento--b tilt-card fade-up">
                  <div className="ax-bento-visual">
                    <div className="bv-cal">
                      {[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15].map((d) => (
                        <div key={d} className={`bv-cal-cell${[3,9,10].includes(d) ? " booked" : ""}`}>{d}</div>
                      ))}
                    </div>
                  </div>
                  <h3>Meeting Scheduling</h3>
                  <p>Convert meeting requests into calendar events with one click, including Zoom link generation.</p>
                </div>
                <div className="ax-bento-card ax-bento--c tilt-card fade-up">
                  <div className="ax-bento-visual">
                    <div className="bv-receipt">
                      <span className="material-symbols-rounded bv-send-icon">send</span>
                      <div className="bv-checks">
                        <span className="material-symbols-rounded bv-check-icon" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                        <span className="material-symbols-rounded bv-check-icon" style={{ fontVariationSettings: "'FILL' 1", animationDelay: "0.15s" }}>check_circle</span>
                      </div>
                    </div>
                  </div>
                  <h3>Read Receipts</h3>
                  <p>Know exactly when your emails are opened with pixel-based tracking built into the compose flow.</p>
                </div>
              </div>
            </div>

            {/* Flexibility */}
            <div className="ax-tab-pane" data-pane="flexibility">
              <div className="ax-bento">
                <div className="ax-bento-card ax-bento--a tilt-card fade-up">
                  <div className="ax-bento-icon">
                    <span className="material-symbols-rounded">computer</span>
                  </div>
                  <h3>Local AI Mode</h3>
                  <p>Run AI entirely in your browser with WebLLM. Your emails never leave your device. Complete privacy guaranteed.</p>
                </div>
                <div className="ax-bento-card ax-bento--b tilt-card fade-up">
                  <div className="ax-bento-icon">
                    <span className="material-symbols-rounded">cloud</span>
                  </div>
                  <h3>Cloud &amp; Hybrid</h3>
                  <p>Switch to cloud AI for faster responses. Hybrid routes simple tasks locally and uses cloud only for complex drafting.</p>
                </div>
                <div className="ax-bento-card ax-bento--c tilt-card fade-up">
                  <div className="ax-bento-icon">
                    <span className="material-symbols-rounded">manage_accounts</span>
                  </div>
                  <h3>Multi-Account</h3>
                  <p>Connect multiple Gmail accounts and switch between them seamlessly. All inboxes, unified in one place.</p>
                </div>
              </div>
            </div>

            {/* AI Chat */}
            <div className="ax-tab-pane" data-pane="chat">
              <div className="ax-bento">
                <div className="ax-bento-card ax-bento--a tilt-card fade-up">
                  <div className="ax-bento-icon">
                    <span className="material-symbols-rounded">forum</span>
                  </div>
                  <h3>Ask Anything</h3>
                  <p>Speak naturally. Ask &ldquo;What did Sarah say about the contract?&rdquo; or &ldquo;Do I have any meetings Friday?&rdquo; and get instant answers.</p>
                </div>
                <div className="ax-bento-card ax-bento--b tilt-card fade-up">
                  <div className="ax-bento-icon">
                    <span className="material-symbols-rounded">bolt</span>
                  </div>
                  <h3>Take Real Action</h3>
                  <p>The AI does not just respond; it acts. Send emails, create calendar events, and add todos from a single chat message.</p>
                </div>
                <div className="ax-bento-card ax-bento--c tilt-card fade-up">
                  <div className="ax-bento-icon">
                    <span className="material-symbols-rounded">psychology</span>
                  </div>
                  <h3>Full Inbox Context</h3>
                  <p>The AI reads your full inbox before responding. It knows who owes you a reply, what is overdue, and what needs your attention first.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── AI Chat ── */}
      <section className="ax-aichat" id="ai-chat">
        <div className="ax-container">
          <div className="ax-aichat-inner">
            {/* Copy */}
            <div className="ax-aichat-copy">
              <div className="ax-label fade-up">AI ASSISTANT</div>
              <h2 className="ax-section-title fade-up" style={{ transitionDelay: "0.06s" }}>
                Your entire inbox,<br />
                <span className="ax-lime">one message away.</span>
              </h2>
              <p className="ax-section-sub fade-up" style={{ transitionDelay: "0.12s" }}>
                Chat naturally with RuneMail&apos;s AI. Ask what&apos;s urgent, get instant summaries, draft replies, and schedule meetings without ever opening an email.
              </p>
              <ul className="ax-aichat-caps fade-up" style={{ transitionDelay: "0.18s" }}>
                {[
                  { icon: "mark_email_read", text: "Read and summarize any email thread" },
                  { icon: "rate_review", text: "Draft and send replies in your voice" },
                  { icon: "edit_calendar", text: "Schedule meetings and generate Zoom links" },
                  { icon: "checklist", text: "Create and manage todos from chat" },
                ].map(({ icon, text }) => (
                  <li key={icon} className="ax-aichat-cap">
                    <div className="ax-aichat-cap-icon">
                      <span className="material-symbols-rounded" style={{ fontSize: "16px" }}>{icon}</span>
                    </div>
                    <span>{text}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Chat window mockup */}
            <div className="ax-aichat-visual fade-up" style={{ transitionDelay: "0.04s" }}>
              <div className="ax-chatwin tilt-card">
                <div className="ax-chatwin-chrome">
                  <div className="ax-chatwin-info">
                    <div className="ax-chatwin-avatar">
                      <img src="/Logo.png" alt="" width={20} height={20} style={{ borderRadius: 5, objectFit: "contain" }} />
                    </div>
                    <div>
                      <div className="ax-chatwin-name">RuneMail AI</div>
                      <div className="ax-chatwin-status">
                        <span className="ax-chatwin-dot" />
                        Online
                      </div>
                    </div>
                  </div>
                </div>
                <div className="ax-chatwin-body">
                  <div className="ax-cmsg ax-cmsg--user fade-up" style={{ transitionDelay: "0.4s" }}>
                    <div className="ax-cmsg-bubble">What are my most urgent emails today?</div>
                  </div>
                  <div className="ax-cmsg ax-cmsg--ai fade-up" style={{ transitionDelay: "0.75s" }}>
                    <div className="ax-cmsg-content">
                      <div className="ax-cmsg-bubble">3 urgent items: Sarah&apos;s contract due Friday, team standup moved to 3PM, and invoice #4421 needs approval.</div>
                    </div>
                  </div>
                  <div className="ax-cmsg ax-cmsg--user fade-up" style={{ transitionDelay: "1.1s" }}>
                    <div className="ax-cmsg-bubble">Schedule a meeting with Sarah on Friday at 2pm</div>
                  </div>
                  <div className="ax-cmsg ax-cmsg--ai fade-up" style={{ transitionDelay: "1.45s" }}>
                    <div className="ax-cmsg-content">
                      <div className="ax-cmsg-bubble">Done. &ldquo;Contract Review&rdquo; created for Fri Mar 28 at 2:00 PM. Zoom link generated, invite sent to Sarah.</div>
                      <div className="ax-cmsg-pill">
                        <span className="material-symbols-rounded" style={{ fontSize: "11px" }}>event</span>
                        Contract Review &middot; Fri Mar 28, 2:00 PM
                      </div>
                    </div>
                  </div>
                  <div className="ax-cmsg ax-cmsg--user fade-up" style={{ transitionDelay: "1.8s" }}>
                    <div className="ax-cmsg-bubble">Send her a quick confirmation email</div>
                  </div>
                  <div className="ax-cmsg ax-cmsg--ai fade-up" style={{ transitionDelay: "2.1s" }}>
                    <div className="ax-cmsg-content">
                      <div className="ax-cmsg-bubble">Email sent to sarah@company.com confirming your Friday 2PM meeting.</div>
                      <div className="ax-cmsg-pill ax-cmsg-pill--sent">
                        <span className="material-symbols-rounded" style={{ fontSize: "11px" }}>send</span>
                        Email sent
                      </div>
                    </div>
                  </div>
                </div>
                <div className="ax-chatwin-input">
                  <span className="ax-chatwin-placeholder">Ask anything about your inbox<span className="ax-chatwin-cur">|</span></span>
                  <div className="ax-chatwin-sendbtn">
                    <span className="material-symbols-rounded" style={{ fontSize: "15px" }}>send</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Privacy ── */}
      <section className="ax-privacy">
        <div className="ax-container">
          <div className="ax-privacy-inner">
            <div className="ax-privacy-copy fade-up">
              <div className="ax-label">PRIVACY FIRST</div>
              <h2 className="ax-section-title">
                Your data,<br />
                your choice.
              </h2>
              <p className="ax-section-sub">
                RuneMail gives you full control over where your data is processed. Run AI entirely in your browser so nothing leaves your device, or use cloud AI for faster responses.
              </p>
              <a className="ax-privacy-link" href="/privacy">Read our Privacy Policy →</a>
            </div>
            <div className="ax-privacy-cards">
              <div className="ax-privacy-card tilt-card fade-up">
                <div className="ax-priv-icon">
                  <span className="material-symbols-rounded">computer</span>
                </div>
                <div>
                  <h4>Local AI (Browser-based)</h4>
                  <p>Run AI with WebLLM. Your emails never leave your device and you need no API keys. Complete on-device privacy.</p>
                </div>
              </div>
              <div className="ax-privacy-card tilt-card fade-up" style={{ transitionDelay: "0.12s" }}>
                <div className="ax-priv-icon">
                  <span className="material-symbols-rounded">cloud</span>
                </div>
                <div>
                  <h4>Cloud &amp; Hybrid Modes</h4>
                  <p>Want faster responses? Switch to Cloud AI. Hybrid routes simple tasks locally and uses cloud only for complex operations.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Compare ── */}
      <section className="ax-compare" id="compare">
        <div className="ax-container">
          <div className="ax-section-head fade-up">
            <div className="ax-label">COMPARE</div>
            <h2 className="ax-section-title">How RuneMail stacks up</h2>
            <p className="ax-section-sub">
              Head-to-head with Gmail, Superhuman, and Shortwave.
            </p>
          </div>
          <div className="fade-up" style={{ transitionDelay: "0.1s" }}>
            <div className="ax-compare-wrap">
              <table className="ax-table">
                <thead>
                  <tr>
                    <th className="ax-table-feat-col">Feature</th>
                    <th>
                      <span className="ax-table-th-name">Gmail</span>
                      <span className="ax-table-th-price">Free</span>
                    </th>
                    <th>
                      <span className="ax-table-th-name">Superhuman</span>
                      <span className="ax-table-th-price">$30/mo</span>
                    </th>
                    <th>
                      <span className="ax-table-th-name">Shortwave</span>
                      <span className="ax-table-th-price">$9/mo</span>
                    </th>
                    <th className="ax-table-hl">
                      <span className="ax-table-brand">
                        <img src="/Logo.png" alt="" width={16} height={16} style={{ borderRadius: 4, objectFit: "contain" }} />
                        RuneMail
                      </span>
                      <span className="ax-table-th-price" style={{ color: "var(--lime)", opacity: 0.8 }}>Free Forever</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {([
                    ["AI email categorization",   null,  true,  true,  true],
                    ["AI chatbot assistant",       null,  true,  true,  true],
                    ["AI-written reply drafts",    null,  true,  true,  true],
                    ["Writing style matching",     false, true,  true,  true],
                    ["Per-email summaries",        false, true,  true,  true],
                    ["Daily briefing dashboard",   false, false, false, true],
                    ["Todo extraction from emails",false, false, true,  true],
                    ["Built-in read receipts",     false, true,  true,  true],
                    ["Local AI (runs in browser)", false, false, false, true],
                    ["Zoom meeting integration",   false, false, false, true],
                    ["Multi-account support",      true,  true,  true,  true],
                    ["Team collaboration",         false, false, true,  false],
                  ] as [string, boolean|null, boolean|null, boolean|null, boolean|null][]).map(([feature, gmail, superhuman, shortwave, runemail], i) => {
                    const cell = (val: boolean | null, highlight = false) =>
                      val === true  ? <span className={highlight ? "ax-check ax-check--lime" : "ax-check"}>✓</span>
                    : val === false ? <span className="ax-cross">✗</span>
                    :                 <span className="ax-partial">~</span>;
                    return (
                      <tr key={i}>
                        <td className="ax-table-feat-col">{feature}</td>
                        <td>{cell(gmail)}</td>
                        <td>{cell(superhuman)}</td>
                        <td>{cell(shortwave)}</td>
                        <td className="ax-table-hl">{cell(runemail, true)}</td>
                      </tr>
                    );
                  })}
                  <tr className="ax-table-price-row">
                    <td className="ax-table-feat-col">Price</td>
                    <td className="ax-price">Free</td>
                    <td className="ax-price ax-price--paid">$30/mo</td>
                    <td className="ax-price ax-price--paid">$9/mo</td>
                    <td className="ax-table-hl">
                      <span className="ax-price-badge">Free Forever</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="ax-cta">
        <div className="ax-cta-bg" />
        <div className="ax-container" style={{ position: "relative", zIndex: 1 }}>
          <div className="ax-cta-inner fade-up">
            <div className="ax-label" style={{ color: "#030309" }}>GET STARTED</div>
            <h2 className="ax-cta-title">
              Take back your inbox.<br />Start today.
            </h2>
            <p className="ax-cta-sub">
              Free forever. No credit card. Works with any Gmail account.
            </p>
            <button className="ax-cta-btn" onClick={handleSignIn}>
              <GoogleIcon />
              Sign in with Google · it&apos;s free
            </button>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="ax-footer">
        <div className="ax-container">
          <div className="ax-footer-inner">
            <div>
              <div className="ax-footer-brand">
                <img src="/Logo.png" alt="RuneMail" width={28} height={28} style={{ borderRadius: 7, objectFit: "contain" }} />
                <span className="ax-wordmark" style={{ fontSize: "0.95rem" }}>RuneMail</span>
              </div>
              <p className="ax-footer-tag">AI-powered email for humans.</p>
            </div>
            <div className="ax-footer-links">
              <a href="#features">Features</a>
              <a href="#ai-chat">AI Chat</a>
              <a href="#compare">Compare</a>
              <a href="/privacy">Privacy</a>
              <a href="/terms">Terms</a>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
