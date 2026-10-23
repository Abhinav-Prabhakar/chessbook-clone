import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { DashboardData } from "../types";
import { Board } from "../components/Board";
import {
  BoardHeader,
  RepertoireRow,
  Row,
  Section,
  Sidebar,
  Splash,
} from "../components/ui";
import { useToast } from "../components/Toast";

export function Dashboard() {
  const { toast } = useToast();
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

  const practiceTarget =
    data.repertoires.find((r) => r.due > 0) ?? data.repertoires[0] ?? null;

  return (
    <div className="cb-app">
      <main className="cb-main">
        <section className="cb-board-col">
          <BoardHeader />
          <Board fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" />
          <div className="cb-board-footer">
            <span>Start position</span>
            <a href="https://lichess.org/analysis" target="_blank" rel="noreferrer">
              Analyze <i className="fa fa-up-right-from-square" aria-hidden />
            </a>
          </div>
        </section>

        <Sidebar className="cb-sidebar-dashboard">
          <Section
            title="Repertoires"
            action={
              <Link to="/add" className="cb-link">
                Add new <i className="fa fa-plus" aria-hidden />
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
                Connect account <i className="fa fa-link" aria-hidden />
              </Link>
            }
          >
            <Row
              title="Correct your opening mistakes"
              right={<span className="cb-row-meta">Not connected</span>}
              onClick={() => toast("Connect a Lichess or Chess.com account in Settings.", "info")}
            />
            <Row
              title="View performance by opening"
              right={<span className="cb-row-meta">Not connected</span>}
              onClick={() => toast("Connect a Lichess or Chess.com account in Settings.", "info")}
            />
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

        </Sidebar>
      </main>
    </div>
  );
}
