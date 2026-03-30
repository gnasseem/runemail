"use client";

import { lazy, Suspense } from "react";
import { useApp } from "./AppShell";
import ViewErrorBoundary from "./ViewErrorBoundary";
import ViewSkeleton from "./ViewSkeleton";

const InboxView = lazy(() => import("./views/InboxView"));
const SentView = lazy(() => import("./views/SentView"));
const DraftsView = lazy(() => import("./views/DraftsView"));
const ScheduledView = lazy(() => import("./views/ScheduledView"));
const TodosView = lazy(() => import("./views/TodosView"));
const MeetingsView = lazy(() => import("./views/MeetingsView"));
const ReceiptsView = lazy(() => import("./views/ReceiptsView"));
const CategoriesView = lazy(() => import("./views/CategoriesView"));
const BriefingView = lazy(() => import("./views/BriefingView"));
const SettingsView = lazy(() => import("./views/SettingsView"));

const views: Record<string, React.LazyExoticComponent<React.ComponentType>> = {
  inbox: InboxView,
  sent: SentView,
  drafts: DraftsView,
  scheduled: ScheduledView,
  todos: TodosView,
  meetings: MeetingsView,
  receipts: ReceiptsView,
  categories: CategoriesView,
  briefing: BriefingView,
  settings: SettingsView,
};

export default function EmailDashboard() {
  const { view } = useApp();
  const View = views[view] || InboxView;
  return (
    <ViewErrorBoundary viewName={view}>
      <Suspense fallback={<ViewSkeleton />}>
        <View />
      </Suspense>
    </ViewErrorBoundary>
  );
}
