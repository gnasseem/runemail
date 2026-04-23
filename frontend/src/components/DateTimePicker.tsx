"use client";

import { useState, useEffect, useRef } from "react";

interface Props {
  value: string; // "YYYY-MM-DDTHH:MM" or ""
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  showWarning?: boolean;
}

function pad(n: number) { return String(n).padStart(2, "0"); }

function toDatetimeLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseValue(v: string) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate(), hour: d.getHours(), minute: d.getMinutes() };
}

const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function DateTimePicker({ value, onChange, placeholder = "Select date and time", className = "", showWarning = false }: Props) {
  const [open, setOpen] = useState(false);
  const [dropStyle, setDropStyle] = useState<React.CSSProperties>({});
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const today = new Date();

  const parsed = parseValue(value);

  const [viewYear, setViewYear] = useState(() => parsed?.year ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => parsed?.month ?? today.getMonth());
  const [selDay, setSelDay] = useState<{ year: number; month: number; day: number } | null>(
    parsed ? { year: parsed.year, month: parsed.month, day: parsed.day } : null
  );

  function toAmPm(h: number) {
    return {
      h12: h === 0 ? 12 : h > 12 ? h - 12 : h,
      ap: (h >= 12 ? "PM" : "AM") as "AM" | "PM",
    };
  }

  const initH = parsed ? toAmPm(parsed.hour) : { h12: 9, ap: "AM" as const };
  const [hour12, setHour12] = useState(initH.h12);
  const [minute, setMinute] = useState(parsed ? Math.round((parsed.minute) / 15) * 15 % 60 : 0);
  const [ampm, setAmpm] = useState<"AM" | "PM">(initH.ap);

  useEffect(() => {
    const p = parseValue(value);
    if (p) {
      setViewYear(p.year); setViewMonth(p.month);
      setSelDay({ year: p.year, month: p.month, day: p.day });
      const { h12, ap } = toAmPm(p.hour);
      setHour12(h12); setMinute(Math.round(p.minute / 15) * 15 % 60); setAmpm(ap);
    } else { setSelDay(null); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        btnRef.current && !btnRef.current.contains(e.target as Node) &&
        dropRef.current && !dropRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function emit(day: typeof selDay, h12: number, m: number, ap: "AM" | "PM") {
    if (!day) return;
    let h24 = h12;
    if (ap === "AM" && h12 === 12) h24 = 0;
    if (ap === "PM" && h12 !== 12) h24 = h12 + 12;
    onChange(toDatetimeLocal(new Date(day.year, day.month, day.day, h24, m)));
  }

  function openPicker() {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const popH = 280;
      const top = spaceBelow >= popH ? rect.bottom + 6 : rect.top - popH - 6;
      setDropStyle({ position: "fixed", top, left: rect.left, width: Math.max(rect.width, 248) });
    }
    setOpen(o => !o);
  }

  function selectDay(year: number, month: number, day: number) {
    const nd = { year, month, day };
    setSelDay(nd);
    emit(nd, hour12, minute, ampm);
  }

  function stepHour(dir: 1 | -1) {
    const nh = hour12 + dir;
    const next = nh < 1 ? 12 : nh > 12 ? 1 : nh;
    setHour12(next); emit(selDay, next, minute, ampm);
  }
  function stepMinute(dir: 1 | -1) {
    const nm = (minute + dir * 15 + 60) % 60;
    setMinute(nm); emit(selDay, hour12, nm, ampm);
  }
  function toggleAmPm() {
    const next: "AM" | "PM" = ampm === "AM" ? "PM" : "AM";
    setAmpm(next); emit(selDay, hour12, minute, next);
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrev = new Date(viewYear, viewMonth, 0).getDate();
  const cells: { year: number; month: number; day: number; cur: boolean }[] = [];
  for (let i = firstDow - 1; i >= 0; i--) {
    const mo = viewMonth === 0 ? 11 : viewMonth - 1;
    const yr = viewMonth === 0 ? viewYear - 1 : viewYear;
    cells.push({ year: yr, month: mo, day: daysInPrev - i, cur: false });
  }
  for (let d = 1; d <= daysInMonth; d++) cells.push({ year: viewYear, month: viewMonth, day: d, cur: true });
  while (cells.length < 35) {
    const mo = viewMonth === 11 ? 0 : viewMonth + 1;
    const yr = viewMonth === 11 ? viewYear + 1 : viewYear;
    cells.push({ year: yr, month: mo, day: cells.length - firstDow - daysInMonth + 1, cur: false });
  }

  const label = parsed
    ? new Date(value).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={openPicker}
        className={`flex items-center gap-2 w-full px-3 py-2.5 rounded-lg border bg-transparent text-sm focus:outline-none transition-colors ${
          showWarning
            ? "border-amber-400"
            : "border-[var(--border)] hover:border-[var(--accent)]"
        } ${className}`}
      >
        <span className="material-symbols-outlined text-[var(--accent)]" style={{ fontSize: "15px" }}>calendar_month</span>
        <span className={`flex-1 text-left text-sm ${label ? "text-slate-900 dark:text-white" : "text-[var(--muted)]"}`}>
          {label || placeholder}
        </span>
        <span className="material-symbols-outlined text-[var(--muted)]" style={{ fontSize: "14px" }}>
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>

      {open && (
        <div
          ref={dropRef}
          style={{ ...dropStyle, zIndex: 9999 }}
          className="bg-[var(--background)] border border-[var(--border)] rounded-xl shadow-xl p-3"
        >
          {/* Month nav */}
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={prevMonth}
              className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-[var(--muted)]">
              <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>chevron_left</span>
            </button>
            <span className="text-xs font-semibold text-slate-900 dark:text-white">
              {MONTH_NAMES[viewMonth]} {viewYear}
            </span>
            <button type="button" onClick={nextMonth}
              className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-[var(--muted)]">
              <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>chevron_right</span>
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 mb-0.5">
            {DAY_LABELS.map(d => (
              <div key={d} className="text-center text-[9px] font-bold text-[var(--muted)] py-0.5">{d}</div>
            ))}
          </div>

          {/* Calendar grid — compact circles */}
          <div className="grid grid-cols-7 gap-0.5 mb-3">
            {cells.map((cell, i) => {
              const isSel = selDay && cell.year === selDay.year && cell.month === selDay.month && cell.day === selDay.day;
              const isToday = cell.cur && cell.year === today.getFullYear() && cell.month === today.getMonth() && cell.day === today.getDate();
              return (
                <button key={i} type="button"
                  onClick={() => selectDay(cell.year, cell.month, cell.day)}
                  className={`h-7 w-full rounded-md text-[11px] font-medium transition-all ${
                    isSel
                      ? "bg-[var(--accent)] text-white"
                      : isToday
                      ? "ring-1 ring-[var(--accent)] text-[var(--accent)] font-bold"
                      : cell.cur
                      ? "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                      : "text-slate-300 dark:text-slate-600"
                  }`}
                >{cell.day}</button>
              );
            })}
          </div>

          {/* Time row — compact single horizontal line */}
          <div className="border-t border-[var(--border)] pt-2.5 flex items-center gap-1.5">
            <span className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-wider mr-auto">Time</span>

            {/* Hour stepper */}
            <button type="button" onClick={() => stepHour(-1)}
              className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-[var(--muted)]">
              <span className="material-symbols-outlined" style={{ fontSize: "13px" }}>chevron_left</span>
            </button>
            <span className="text-sm font-bold text-slate-900 dark:text-white w-6 text-center tabular-nums">{pad(hour12)}</span>
            <button type="button" onClick={() => stepHour(1)}
              className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-[var(--muted)]">
              <span className="material-symbols-outlined" style={{ fontSize: "13px" }}>chevron_right</span>
            </button>

            <span className="text-sm font-bold text-[var(--muted)]">:</span>

            {/* Minute stepper */}
            <button type="button" onClick={() => stepMinute(-1)}
              className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-[var(--muted)]">
              <span className="material-symbols-outlined" style={{ fontSize: "13px" }}>chevron_left</span>
            </button>
            <span className="text-sm font-bold text-slate-900 dark:text-white w-6 text-center tabular-nums">{pad(minute)}</span>
            <button type="button" onClick={() => stepMinute(1)}
              className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-[var(--muted)]">
              <span className="material-symbols-outlined" style={{ fontSize: "13px" }}>chevron_right</span>
            </button>

            {/* AM/PM toggle */}
            <button type="button" onClick={toggleAmPm}
              className={`ml-1 px-2 py-1 rounded-lg text-xs font-bold transition-all ${
                ampm === "AM"
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                  : "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"
              }`}>
              {ampm}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
