import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Board } from "../components/Board";
import { Breadcrumb, Sidebar } from "../components/ui";
import { useAuth } from "../auth";
import { useToast } from "../components/Toast";
import { START_FEN } from "../chess";

export function LoginPage() {
  const { user, login } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={next} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(email, password);
      navigate(next, { replace: true });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const useDemo = () => {
    setEmail("local@chessbook.local");
    setPassword("local-only");
    setError("");
  };

  return (
    <div className="cb-app">
      <header className="cb-topbar">
        <Link to="/" className="cb-logo" aria-label="Chessbook home">
          <img src="/homepage_imgs/chessbook.svg" alt="Chessbook" />
        </Link>
        <div className="cb-top-actions">
          <Link to="/login" className="cb-top-link">
            Log in
          </Link>
          <span className="cb-top-sep">|</span>
          <Link to="/register" className="cb-top-link">
            Sign up
          </Link>
        </div>
      </header>

      <main className="cb-main">
        <section className="cb-board-col">
          <Board fen={START_FEN} />
        </section>

        <Sidebar backTo="/" backLabel="Back">
          <Breadcrumb items={[{ label: "Account", to: "/" }, { label: "Log in" }]} />
          <div className="cb-page-head" style={{ paddingTop: 0 }}>
            <h1 className="cb-page-title">Log in</h1>
          </div>

          <form onSubmit={submit} className="cb-auth-form">
            {error && <div className="cb-auth-error">{error}</div>}
            <div className="cb-auth-row">
              <div className="cb-field">
                <label htmlFor="login-email">Email</label>
                <input
                  id="login-email"
                  className="cb-input"
                  type="email"
                  autoComplete="email"
                  placeholder="example@gmail.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="cb-field">
                <label htmlFor="login-password">Password</label>
                <input
                  id="login-password"
                  className="cb-input"
                  type="password"
                  autoComplete="current-password"
                  placeholder=""
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>
            <button
              type="button"
              className="cb-link cb-auth-forgot"
              onClick={() => toast("Password reset is not available in the demo.", "info")}
            >
              Forgot your password?
            </button>
            <button type="submit" className="cb-auth-submit" disabled={busy}>
              {busy ? "Logging in…" : "Log in"}
            </button>
          </form>

          <div className="cb-demo-note" style={{ margin: "18px" }}>
            <strong>Demo account</strong>
            <br />
            <code>local@chessbook.local</code> / <code>local-only</code>
            <br />
            <button
              type="button"
              className="cb-link"
              style={{ padding: 0, background: "none", border: 0, cursor: "pointer" }}
              onClick={useDemo}
            >
              Fill demo credentials
            </button>
          </div>

          <div className="cb-auth-footer cb-auth-footer-left">
            New to Chessbook? <Link to="/register">Create a free account</Link>
            <br />
            <a href="/signup/">Back to the marketing site</a>
          </div>
        </Sidebar>
      </main>
    </div>
  );
}
