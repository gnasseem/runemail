"use client";

import { Component, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  viewName: string;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

export default class ViewErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error(`[${this.props.viewName}] View error:`, error, info.componentStack);
  }

  componentDidUpdate(prevProps: Props) {
    // Reset error state when view changes
    if (prevProps.viewName !== this.props.viewName && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-8 text-center">
          <span
            className="material-symbols-outlined text-red-400 mb-3"
            style={{ fontSize: "48px" }}
          >
            error
          </span>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
            Something went wrong
          </h2>
          <p className="text-sm text-[var(--muted)] mb-4 max-w-md">
            The {this.props.viewName} view encountered an error. Click &quot;Try Again&quot; to reload it.
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Try Again
          </button>
          {this.state.error && (
            <p className="mt-3 text-xs text-[var(--muted)] font-mono max-w-md truncate">
              {this.state.error.message}
            </p>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
