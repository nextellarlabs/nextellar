"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  public state: ErrorBoundaryState = {
    error: null,
    errorInfo: null,
    showDetails: false,
  };

  public static getDerivedStateFromError(
    error: Error,
  ): Partial<ErrorBoundaryState> {
    return { error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught a rendering error:", {
      error,
      componentStack: errorInfo.componentStack,
    });

    this.setState({ errorInfo });
  }

  private reset = () => {
    this.setState({
      error: null,
      errorInfo: null,
      showDetails: false,
    });
  };

  private toggleDetails = () => {
    this.setState((state) => ({ showDetails: !state.showDetails }));
  };

  public render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6 py-12 text-[var(--foreground)]">
        <section className="w-full max-w-2xl rounded-2xl border border-black/10 bg-white p-6 shadow-sm dark:border-white/15 dark:bg-zinc-950 sm:p-8">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-blue-600 dark:text-blue-300">
            Render error
          </p>
          <h1 className="mt-3 text-2xl font-semibold sm:text-3xl">
            Something went wrong
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-300 sm:text-base">
            The app hit an unexpected rendering error. Try again to re-render
            the current page, or show the technical details for debugging.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={this.reset}
              className="rounded-full bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Try Again
            </button>
            <button
              type="button"
              onClick={this.toggleDetails}
              className="rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-900 transition hover:bg-zinc-100 dark:border-white/20 dark:text-white dark:hover:bg-white/10"
            >
              {this.state.showDetails ? "Hide Details" : "Show Details"}
            </button>
          </div>

          {this.state.showDetails ? (
            <pre className="mt-6 max-h-80 overflow-auto rounded-xl border border-red-200 bg-red-50 p-4 text-xs leading-5 text-red-900 dark:border-red-400/25 dark:bg-red-950/35 dark:text-red-100">
              {this.state.error.toString()}
              {this.state.errorInfo?.componentStack
                ? `\n\nComponent stack:${this.state.errorInfo.componentStack}`
                : ""}
            </pre>
          ) : null}
        </section>
      </main>
    );
  }
}

export default ErrorBoundary;
