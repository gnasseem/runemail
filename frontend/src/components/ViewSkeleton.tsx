"use client";

export default function ViewSkeleton() {
  return (
    <div className="h-full flex overflow-hidden animate-pulse">
      {/* Left panel: list skeleton */}
      <div className="w-80 lg:w-96 border-r border-[var(--border)] p-0">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="px-4 py-3 border-b border-[var(--border)]">
            <div className="flex gap-3">
              <div className="w-2 h-2 rounded-full bg-[var(--surface-2)] mt-1.5 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="flex justify-between">
                  <div className="h-3.5 w-28 rounded bg-[var(--surface-2)]" />
                  <div className="h-3 w-10 rounded bg-[var(--surface-2)]" />
                </div>
                <div className="h-3 w-44 rounded bg-[var(--surface-2)]" />
                <div className="h-2.5 w-14 rounded bg-[var(--surface-2)]" />
              </div>
            </div>
          </div>
        ))}
      </div>
      {/* Right panel: detail skeleton */}
      <div className="flex-1 p-6 space-y-4">
        <div className="h-6 w-64 rounded bg-[var(--surface-2)]" />
        <div className="h-4 w-40 rounded bg-[var(--surface-2)]" />
        <div className="mt-6 space-y-2">
          <div className="h-3 w-full rounded bg-[var(--surface-2)]" />
          <div className="h-3 w-5/6 rounded bg-[var(--surface-2)]" />
          <div className="h-3 w-4/6 rounded bg-[var(--surface-2)]" />
        </div>
      </div>
    </div>
  );
}
