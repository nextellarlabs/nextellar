"use client";

import React, { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  showDetails: boolean;
  theme: "light" | "dark";
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    showDetails: false,
    theme: "light",
  };

  private observer: MutationObserver | null = null;

  public static getDerivedStateFromError(error: Error): State {
    const isDark =
      typeof document !== "undefined"
        ? document.documentElement.classList.contains("dark")
        : false;
    return {
      hasError: true,
      error,
      showDetails: false,
      theme: isDark ? "dark" : "light",
    };
  }

  public componentDidMount(): void {
    // Get current theme
    const isDark = document.documentElement.classList.contains("dark");
    this.setState({ theme: isDark ? "dark" : "light" });

    // Watch for theme changes
    this.observer = new MutationObserver(() => {
      const nowDark = document.documentElement.classList.contains("dark");
      this.setState({ theme: nowDark ? "dark" : "light" });
    });

    this.observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  public componentWillUnmount(): void {
    this.observer?.disconnect();
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  private handleTryAgain = (): void => {
    this.setState({ hasError: false, error: null, showDetails: false });
  };

  private handleToggleDetails = (): void => {
    this.setState((prev) => ({ showDetails: !prev.showDetails }));
  };

  public render(): ReactNode {
    const { hasError, error, showDetails, theme } = this.state;
    const { children } = this.props;

    if (hasError) {
      const isDark = theme === "dark";

      return (
        <div
          className="min-h-screen flex items-center justify-center p-4"
          style={{
            backgroundColor: isDark ? "#0a0a0a" : "#ffffff",
            color: isDark ? "#ededed" : "#171717",
          }}
        >
          <div
            className="max-w-md w-full rounded-lg p-6 shadow-lg"
            style={{
              backgroundColor: isDark ? "#0a0a0a" : "#ffffff",
              border: `1px solid ${isDark ? "rgba(237,237,237,0.15)" : "rgba(23,23,23,0.15)"}`,
            }}
          >
            <div className="text-center">
              <div
                className="mx-auto flex items-center justify-center h-12 w-12 rounded-full mb-4"
                style={{
                  backgroundColor: isDark
                    ? "rgba(239,68,68,0.2)"
                    : "rgba(239,68,68,0.1)",
                }}
              >
                <svg
                  className="h-6 w-6"
                  style={{ color: isDark ? "#f87171" : "#dc2626" }}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
              <h3
                className="text-lg font-medium mb-2"
                style={{ color: isDark ? "#ededed" : "#171717" }}
              >
                Something went wrong
              </h3>
              <p
                className="text-sm mb-4"
                style={{
                  color: isDark ? "#ededed" : "#171717",
                  opacity: "0.7",
                }}
              >
                {error?.message || "An unexpected error occurred"}
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center mb-4">
                <button
                  onClick={this.handleTryAgain}
                  className="px-4 py-2 rounded-md text-sm font-medium"
                  style={{
                    backgroundColor: isDark ? "#ededed" : "#171717",
                    color: isDark ? "#0a0a0a" : "#ffffff",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.opacity = "0.9")}
                  onMouseOut={(e) => (e.currentTarget.style.opacity = "1")}
                >
                  Try Again
                </button>
                <button
                  onClick={this.handleToggleDetails}
                  className="px-4 py-2 rounded-md text-sm font-medium"
                  style={{
                    border: `1px solid ${isDark ? "rgba(237,237,237,0.2)" : "rgba(23,23,23,0.2)"}`,
                    color: isDark ? "#ededed" : "#171717",
                    backgroundColor: "transparent",
                  }}
                  onMouseOver={(e) =>
                    (e.currentTarget.style.backgroundColor = isDark
                      ? "rgba(237,237,237,0.05)"
                      : "rgba(23,23,23,0.05)")
                  }
                  onMouseOut={(e) =>
                    (e.currentTarget.style.backgroundColor = "transparent")
                  }
                >
                  {showDetails ? "Hide Details" : "Show Details"}
                </button>
              </div>
              {showDetails && error && (
                <details
                  className="text-left mt-4 p-3 rounded-md"
                  style={{
                    backgroundColor: isDark
                      ? "rgba(237,237,237,0.05)"
                      : "rgba(23,23,23,0.05)",
                  }}
                >
                  <summary
                    className="text-xs font-medium cursor-pointer mb-2"
                    style={{
                      color: isDark ? "#ededed" : "#171717",
                      opacity: "0.7",
                    }}
                  >
                    Error Details
                  </summary>
                  <pre
                    className="text-xs whitespace-pre-wrap break-words"
                    style={{
                      color: isDark ? "#ededed" : "#171717",
                      opacity: "0.6",
                    }}
                  >
                    {error.toString()}
                  </pre>
                </details>
              )}
            </div>
          </div>
        </div>
      );
    }

    return children;
  }
}
