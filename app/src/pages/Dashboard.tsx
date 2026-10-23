import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import type { DashboardData } from "../types";
import { Board } from "../components/Board";
import {
  RepertoireRow,
  Row,
  Section,
  Sidebar,
  Splash,
  Stat,
} from "../components/ui";
import { useAuth } from "../auth";
import { useToast } from "../components/Toast";

export function Dashboard() {
  const { logout } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api
      .get<DashboardData>("/dashboard")
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return (
      <div className="cb-splash">
        <p>{error}</p>
        <button type="button" className="cb-btn" onClick={() => location.reload()}>
          Retry
        </button>
      </div>
    );
  }

  if (!data) return <Splash />;

  const white = data.repertoires.find((r) => r.color === "white");
  const practiceTarget =
    data.repertoires.find((r) => r.due > 0) ?? data.repertoires[0] ?? null;

  const logoutNow = async () => {
    await logout();
    toast("Signed out", "info");
    navigate("/login");
  };

  return (
    <div className="cb-app">
      <header className="cb-topbar">
        <Link to="/" className="cb-logo" aria-label="Chessbook home">
          <img src="/homepage_imgs/chessbook.svg" alt="Chessbook" />
        </Link>
        <div className="cb-top-actions">
          <span className="cb-plan-pill">{data.user.plan.toUpperCase()}</span>
          <span className="cb-top-link">Hi, {data.user.name}</span>
        </div>
      </header>

      <main className="cb-main">
        <section className="cb-board-col">
          <Board fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" />
          <div className="cb-board-footer">
            <span>Start position</span>
            <a href="https://lichess.org/analysis" target="_blank" rel="noreferrer">
              Analyze <i className="fa fa-up-right-from-square" aria-hidden />
            </a>
          </div>
        </section>

        <Sidebar>
          <Section
            title="Repertoires"
            action={
              <Link to="/add" className="cb-link">
                Add new
              </Link>
            }
          >
            {data.repertoires.map((repertoire) => (
              <RepertoireRow
                key={repertoire.id}
                repertoire={repertoire}
                to={`/repertoire/${repertoire.id}`}
              />
            ))}
          </Section>

          <Section
            title="Daily tasks"
            action={
              <span className="cb-row-meta">
                {data.tasks.streak > 0 ? `${data.tasks.streak} day streak` : "No streak"}{" "}
                <i className="fa fa-fire" aria-hidden />
              </span>
            }
          >
            <Row
              title="Practice moves"
              testId="practice-moves"
              to={practiceTarget ? `/practice/${practiceTarget.id}` : "/practice/white"}
              right={
                <span className="cb-row-meta strong">
                  {data.tasks.due} due <i className="fa fa-clock" aria-hidden />
                </span>
              }
            />
            <Row
              title="Play through a model game"
              to="/model"
              right={
                <span className="cb-row-meta strong">
                  {data.modelGame ? `${data.modelGame.white} vs. ${data.modelGame.black}` : "Model game"}{" "}
                  <i className="fa-solid fa-circle-star" style={{ color: "var(--cb-blue)" }} aria-hidden />
                </span>
              }
            />
          </Section>

          <Section
            title="Review your online games"
            action={
              <Link to="/settings" className="cb-link">
                Connect account
              </Link>
            }
          >
            <Row
              title="Correct your opening mistakes"
              meta="Not connected"
              onClick={() => toast("Connect a Lichess or Chess.com account in Settings.", "info")}
            />
            <Row
              title="View performance by opening"
              meta="Not connected"
              onClick={() => toast("Connect a Lichess or Chess.com account in Settings.", "info")}
            />
          </Section>

          <Section title="Your progress">
            <div className="cb-stat-grid" style={{ padding: 0 }}>
              <Stat value={`${white?.completion ?? 0}%`} label="White" hint="Repertoire" />
              <Stat value={`${data.tasks.mastered}`} label="Mastered" hint="Lines" />
              <Stat value={`${data.tasks.saved}`} label="Saved" hint="Lines" />
            </div>
          </Section>

          <Section title="Contact us">
            <Row
              ghost
              title="Join the Chessbook Discord"
              onClick={() => window.open("https://discord.gg/vNzfu5VetQ", "_blank")}
            />
            <Row
              ghost
              title="Share your feedback"
              onClick={() => toast("Thanks! Feedback is noted for this demo.", "ok")}
            />
            <Row
              ghost
              title="Help us spread the word"
              onClick={() => {
                navigator.clipboard?.writeText("https://chessbook.com").then(
                  () => toast("Link copied", "ok"),
                  () => toast("Could not copy the link", "bad")
                );
              }}
            />
          </Section>

          <div className="cb-actions" style={{ marginTop: 22 }}>
            <button type="button" className="cb-btn ghost wide" onClick={logoutNow}>
              <i className="fa fa-arrow-right-from-bracket" aria-hidden /> Sign out
            </button>
          </div>
        </Sidebar>
      </main>
    </div>
  );
}
