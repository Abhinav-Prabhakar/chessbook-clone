import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Called after the boundary clears its error, before re-rendering children. */
  onReset?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Recoverable render-error boundary for the routed app (audit D210).
 *
 * The production app does not blank the page when a single screen throws: it
 * keeps the shell and offers a way back. This boundary catches render/lifecycle
 * errors from any routed page, keeps the router alive, and offers "Try again"
 * (re-render the same route), "Reload page" and "Back to dashboard".
 *
 * It intentionally does not catch event-handler or async errors; those are
 * handled by the pages' own catch blocks and the offline queue.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The local build has no telemetry; keep the detail in the browser console
    // so a developer can still diagnose the failing component stack.
    console.error("[chessbook] render error", error, info.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        className="cb-splash"
        role="alert"
        aria-live="assertive"
        data-testid="error-boundary"
        style={{ maxWidth: 520, margin: "0 auto", textAlign: "center" }}
      >
        <h1 style={{ fontSize: 22, lineHeight: "30px", margin: "0 0 8px" }}>
          Something went wrong
        </h1>
        <p style={{ margin: "0 0 18px", color: "var(--cb-text-2)", fontSize: 13 }}>
          This screen hit an error. Your saved repertoire and review history are untouched.
        </p>
        <pre
          style={{
            margin: "0 0 18px",
            padding: "10px 12px",
            borderRadius: 6,
            background: "var(--cb-bg-raised)",
            color: "var(--cb-text-3)",
            fontSize: 11,
            lineHeight: "17px",
            whiteSpace: "pre-wrap",
            textAlign: "left",
          }}
        >
          {error.message || String(error)}
        </pre>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          <button type="button" className="cb-btn primary" onClick={this.reset}>
            Try again
          </button>
          <button
            type="button"
            className="cb-btn"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
          <Link className="cb-btn ghost" to="/dashboard" onClick={this.reset}>
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
