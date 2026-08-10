"use client";

import React, { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    errorInfo: null,
    showDetails: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo.componentStack);
    this.setState({ errorInfo });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, showDetails: false });
  };

  private toggleDetails = () => {
    this.setState((prevState) => ({ showDetails: !prevState.showDetails }));
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center px-6 py-12 bg-linear-to-br from-white/70 via-slate-100/55 to-white/65 dark:from-black/70 dark:via-zinc-900/60 dark:to-black/75 backdrop-blur-2xl text-black dark:text-white">
          <div className="w-full max-w-2xl rounded-3xl border border-white/60 dark:border-white/20 bg-white/55 dark:bg-white/10 backdrop-blur-xl p-6 sm:p-8 shadow-sm">
            <h1 className="text-2xl sm:text-3xl font-semibold mb-3">Something went wrong</h1>
            <p className="text-sm sm:text-base text-gray-700 dark:text-white/80 mb-6">
              The app hit an unexpected error while rendering. You can try again to recover.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={this.handleReset}
                className="px-5 py-2.5 rounded-full font-medium bg-black text-white hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200 transition-colors"
              >
                Try Again
              </button>
              {this.state.error && (
                <button
                  type="button"
                  onClick={this.toggleDetails}
                  className="px-5 py-2.5 rounded-full font-medium border border-gray-300 text-gray-900 hover:bg-gray-100 dark:border-white/20 dark:text-white dark:hover:bg-white/10 transition-colors"
                >
                  {this.state.showDetails ? "Hide Details" : "Show Details"}
                </button>
              )}
            </div>

            {this.state.showDetails && this.state.error && (
              <div className="mt-6 rounded-xl border border-white/60 dark:border-white/15 bg-white/45 dark:bg-black/35 backdrop-blur-sm p-4">
                <p className="text-sm font-semibold mb-2">Error Details</p>
                <pre className="text-xs sm:text-sm whitespace-pre-wrap wrap-break-word text-red-700 dark:text-red-300">
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack
                    ? `\n\nComponent Stack:${this.state.errorInfo.componentStack}`
                    : ""}
                </pre>
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;