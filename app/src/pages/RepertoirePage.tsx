import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import type { Line, Repertoire } from "../types";
import { Board } from "../components/Board";
import {
  Breadcrumb,
  EmptyState,
  ProgressRing,
  Row,
  Section,
  Sidebar,
  Splash,
  Stat,
  formatDue,
} from "../components/ui";
import { afterMove, START_FEN } from "../chess";
import { useToast } from "../components/Toast";

interface Data {
  repertoire: Repertoire;
  lines: Line[];
}

export function RepertoirePage() {
  const { key = "white" } = useParams<{ key: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api
      .get<Data>(`/repertoires/${key}`)
      .then((d) => {
        setData(d);
        setSelectedId((prev) => prev);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    setData(null);
    setError("");
    setSelectedId(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const selected = useMemo(
    () => (selectedId ? data?.lines.find((l) => l.id === selectedId) ?? null : null),
    [data, selectedId]
  );

  if (error) {
    return (
      <div className="cb-splash">
        <p>{error}</p>
        <Link className="cb-btn" to="/">
          Back to dashboard
        </Link>
      </div>
    );
  }
  if (!data) return <Splash label="Loading repertoire…" />;

  const { repertoire, lines } = data;
  const color = repertoire.color;
  const board = selected ? afterMove(selected.fen, selected.expectedSan) : null;

  const autofill = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ filled: number; repertoire: Repertoire }>(
        `/repertoires/${key}/autofill`
      );
      toast(
        r.filled
          ? `${r.filled} gaps filled and scheduled`
          : "No gaps left to autofill",
        r.filled ? "ok" : "info"
      );
      load();
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cb-app">
      <header className="cb-topbar">
        <Link to="/" className="cb-logo" aria-label="Chessbook home">
          <img src="/homepage_imgs/chessbook.svg" alt="Chessbook" />
        </Link>
        <div className="cb-top-actions">
          <span className="cb-plan-pill">{repertoire.color === "white" ? "WHITE" : "BLACK"}</span>
          <Link to="/settings" className="cb-top-link">
            Account
          </Link>
        </div>
      </header>

      <main className="cb-main">
        <section className="cb-board-col">
          <Board
            fen={board?.fen ?? START_FEN}
            orientation={color}
            lastMove={board ? { from: board.from, to: board.to } : null}
          />
          <div className="cb-board-footer">
            <span>{selected ? selected.name : "Start position"}</span>
            <a
              href={`https://lichess.org/analysis/standard/${encodeURIComponent(
                (board?.fen ?? START_FEN).split(" ")[0]
              )}`}
              target="_blank"
              rel="noreferrer"
            >
              Analyze <i className="fa fa-up-right-from-square" aria-hidden />
            </a>
          </div>
        </section>

        <Sidebar backTo="/" backLabel="Back">
          <Breadcrumb
            items={[
              { label: "Repertoires", to: "/" },
              { label: repertoire.name },
            ]}
          />
          <div className="cb-page-head" style={{ paddingTop: 0 }}>
            <h1 className="cb-page-title">{repertoire.name}</h1>
            <p className="cb-page-sub">
              {repertoire.completion}% complete · {repertoire.mastery}% mastered ·{" "}
              {repertoire.lineCount} of {repertoire.totalLines} lines
            </p>
          </div>

          <div className="cb-progress-line">
            <div className="cb-progress-copy">
              <strong>{repertoire.completion}% complete</strong>
              <button
                type="button"
                className="cb-link"
                onClick={autofill}
                disabled={busy || lines.length === 0}
              >
                Autofill remaining gaps <i className="fa fa-wand-magic-sparkles" aria-hidden />
              </button>
            </div>
            <div className="cb-bar">
              <span style={{ width: `${repertoire.completion}%` }} />
            </div>
          </div>

          <Row
            large
            title="Continue building"
            right={<span className="cb-row-meta strong">{repertoire.saved} Saved</span>}
            onClick={() => navigate(`/build/${key}`)}
            testId="continue-building"
          />

          <div className="cb-progress-line" style={{ marginTop: 18 }}>
            <div className="cb-progress-copy">
              <strong>{repertoire.mastery}% mastered</strong>
            </div>
            <div className="cb-bar mastery">
              <span style={{ width: `${repertoire.mastery}%` }} />
            </div>
          </div>

          <Row
            large
            title="Continue learning"
            right={
              <span className="cb-row-meta strong">
                {repertoire.due} due <i className="fa fa-clock" aria-hidden />
              </span>
            }
            onClick={() => navigate(`/learn/${key}`)}
            testId="continue-learning"
          />

          <Section
            title={
              <span className="cb-stats-title">
                Stats <i className="fa fa-circle-info" aria-hidden />
              </span>
            }
          >
            <div className="cb-metrics">
              <Metric label="Effectiveness" value={repertoire.learned} max={repertoire.totalLines} tone="green" />
              <Metric label="Soundness" value={repertoire.mastery} max={100} tone="green" />
              <Metric label="Learnability" value={Math.max(0, 100 - repertoire.mastery)} max={100} tone="orange" />
              <div className="cb-metric total">
                <span className="cb-metric-label">Total</span>
                <strong>
                  {repertoire.learned + repertoire.mastered + repertoire.saved}/
                  {repertoire.totalLines * 3}
                </strong>
              </div>
            </div>
          </Section>

          <Section title="Settings">
            <Row ghost title="Training settings" to="/settings" />
          </Section>

          <Section title={`Lines (${lines.length})`}>
            {lines.length === 0 ? (
              <EmptyState
                title="No lines yet"
                action={
                  <Link className="cb-btn primary" to={`/build/${key}?add=1`}>
                    Add your first line
                  </Link>
                }
              >
                Add a line from the opening database or import a PGN to get started.
              </EmptyState>
            ) : (
              lines.slice(0, 12).map((line) => (
                <Row
                  key={line.id}
                  title={line.name}
                  meta={line.moves.join(" ")}
                  right={
                    <span className="cb-row-right">
                      <span className="cb-row-meta">{formatDue(line.dueAt)}</span>
                      <ProgressRing value={line.mastered} size={12} />
                    </span>
                  }
                  onClick={() => setSelectedId(line.id)}
                  className={selected?.id === line.id ? "selected" : ""}
                />
              ))
            )}
          </Section>

          <Section title="Manage">
            <Row ghost title="Add lines from the opening database" to={`/build/${key}?add=1`} />
            <Row ghost title="Repertoire settings" to="/settings" />
          </Section>
        </Sidebar>
      </main>
    </div>
  );
}

function Metric({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: "green" | "orange";
}) {
  const width = max ? Math.max(2, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="cb-metric">
      <span className="cb-metric-label">{label}</span>
      <span className="cb-metric-value">{value}</span>
      <span className={`cb-metric-bar ${tone}`}>
        <span style={{ width: `${width}%` }} />
      </span>
    </div>
  );
}
