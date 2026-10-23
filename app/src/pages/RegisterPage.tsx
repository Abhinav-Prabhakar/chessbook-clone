import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Board } from "../components/Board";
import { BoardHeader, Sidebar } from "../components/ui";
import { useAuth } from "../auth";
import { START_FEN } from "../chess";

export function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      await register(name, email, password);
      navigate("/", { replace: true });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cb-app">
      <main className="cb-main">
        <section className="cb-board-col">
          <BoardHeader />
          <Board fen={START_FEN} />
        </section>

        <Sidebar auth backTo="/" backLabel="Back">
          <div className="cb-page-head">
            <h1 className="cb-page-title">Sign up</h1>
            <p className="cb-page-sub">Start with a free repertoire. No credit card required.</p>
          </div>

          <form onSubmit={submit} className="cb-auth-form">
            {error && <div className="cb-auth-error">{error}</div>}
            <div className="cb-auth-row">
              <div className="cb-field">
                <label htmlFor="register-name">Name</label>
                <input
                  id="register-name"
                  className="cb-input"
                  autoComplete="name"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="cb-field">
                <label htmlFor="register-email">Email</label>
                <input
                  id="register-email"
                  className="cb-input"
                  type="email"
                  autoComplete="email"
                  placeholder="example@gmail.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="cb-auth-row">
              <div className="cb-field">
                <label htmlFor="register-password">Password</label>
                <input
                  id="register-password"
                  className="cb-input"
                  type="password"
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <div className="cb-field">
                <label htmlFor="register-confirm">Confirm password</label>
                <input
                  id="register-confirm"
                  className="cb-input"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Repeat password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>
            </div>
            <button type="submit" className="cb-auth-submit" disabled={busy}>
              {busy ? "Creating account…" : "Create account"}
            </button>
            <p className="cb-auth-terms">
              By creating an account you agree to the{" "}
              <Link to="/legal/privacy">privacy policy</Link> and our{" "}
              <Link to="/legal/fulfillment">fulfillment terms</Link>.
            </p>
          </form>

          <div className="cb-auth-footer cb-auth-footer-left">
            Already have an account? <Link to="/login">Log in</Link>
          </div>
        </Sidebar>
      </main>
    </div>
  );
}
