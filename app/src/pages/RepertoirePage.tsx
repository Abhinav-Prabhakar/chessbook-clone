import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import type { Line, Repertoire } from "../types";
import { Board } from "../components/Board";
import {
  BoardHeader,
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
      <main className="cb-main">
        <section className="cb-board-col">
          <BoardHeader items={[{ label: repertoire.name }]} />
          <Board
            fen={board?.fen ?? START_FEN}
            orientation={color}
            lastMove={board ? { from: board.from, to: board.to } : null}
          />
          <div className={`cb-board-footer ${selected ? "visible" : ""}`}>
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
          <div className="cb-page-head">
            <h1 className="cb-page-title">{repertoire.name}</h1>
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
            title="Continue building"
            right={<span className="cb-row-meta strong">{repertoire.saved} Saved</span>}
            onClick={() => navigate(`/build/${key}`)}
            testId="continue-building"
          />

          <div className="cb-progress-line" style={{ marginTop: 36 }}>
            <div className="cb-progress-copy">
              <strong>{repertoire.mastery}% mastered</strong>
            </div>
            <div className="cb-bar mastery">
              <span style={{ width: `${repertoire.mastery}%` }} />
            </div>
          </div>

          <Row
            title="Continue learning"
            right={
              <span className="cb-row-meta strong">
                {repertoire.due} due <i className="fa fa-clock" aria-hidden />
              </span>
            }
            onClick={() => navigate(`/learn/${key}`)}
            testId="continue-learning"
          />

          <div className="cb-stats-block">
            <div className="cb-stats-head">
              <span>Stats</span>
              <a
                href="https://wiki.chessbook.com/repertoire-statistics"
                target="_blank"
                rel="noreferrer"
                aria-label="About repertoire statistics"
              >
                <i className="fa fa-circle-question" aria-hidden />
              </a>
            </div>
            <div className="cb-metrics">
              <Metric
                label="Effectiveness"
                value={repertoire.learned}
                max={Math.max(1, repertoire.totalLines * 3)}
                tone="danger"
              />
              <span className="cb-metric-divider" aria-hidden />
              <Metric
                label="Soundness"
                value={repertoire.mastery}
                max={100}
                tone="green"
              />
              <span className="cb-metric-divider" aria-hidden />
              <Metric
                label="Learnability"
                value={Math.max(0, 100 - repertoire.mastery)}
                max={100}
                tone="orange"
              />
              <span className="cb-metric-divider" aria-hidden />
              <Metric
                label="Total"
                value={repertoire.learned + repertoire.mastered + repertoire.saved}
                max={repertoire.totalLines * 3}
                total
              />
            </div>
          </div>

          <div className="cb-rep-settings-link">
            <Link to="/settings">Settings</Link>
          </div>


        </Sidebar>
      </main>
    </div>
  );
}

function Metric({
  label,
  value,
  max,
  tone = "green",
  total = false,
}: {
  label: string;
  value: number;
  max: number;
  tone?: "green" | "orange" | "danger";
  total?: boolean;
}) {
  const width = max ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="cb-metric">
      <span className="cb-metric-label">{label}</span>
      <span className="cb-metric-value">
        {!total && (
          <span className={`cb-segbar ${tone}`} aria-hidden>
            <span style={{ width: `${width}%` }} />
          </span>
        )}
        <span className="cb-metric-number">
          {value}
          {total && <span className="cb-metric-denom"> / {max}</span>}
        </span>
      </span>
    </div>
  );
}
