import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import type { Line, Repertoire } from "../types";
import { Board } from "../components/Board";
import {
  Breadcrumb,
  EmptyState,
  Modal,
  ProgressRing,
  Row,
  Section,
  Sidebar,
  Splash,
  Stat,
  formatDue,
} from "../components/ui";
import { afterMove } from "../chess";

interface Data {
  repertoire: Repertoire;
  queue: Line[];
}

export function LearnPage() {
  const { key = "white" } = useParams<{ key: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showSpecific, setShowSpecific] = useState(false);

  useEffect(() => {
    setData(null);
    setError("");
    api
      .get<Data>(`/repertoires/${key}/learn`)
      .then((d) => {
        setData(d);
        setSelectedId(d.queue[0]?.id ?? null);
      })
      .catch((e) => setError(e.message));
  }, [key]);

  const selected = useMemo(
    () => data?.queue.find((l) => l.id === selectedId) ?? data?.queue[0] ?? null,
    [data, selectedId]
  );

  if (error) {
    return (
      <div className="cb-splash">
        <p>{error}</p>
        <Link className="cb-btn" to={`/repertoire/${key}`}>
          Back to repertoire
        </Link>
      </div>
    );
  }
  if (!data) return <Splash label="Loading your training queue…" />;

  const { repertoire, queue } = data;
  let board: { fen: string; from: string; to: string } | null = null;
  if (selected) {
    try {
      board = afterMove(selected.fen, selected.expectedSan);
    } catch {
      board = null;
    }
  }
  const dueCount = queue.filter((l) => l.due).length;
  const weak = queue.filter((l) => (l.wrong ?? 0) > 0);
  const weakCount = weak.length;

  const start = (mode: "due" | "weak" | "all") => {
    navigate(`/practice/${key}?mode=${mode}`);
  };

  return (
    <div className="cb-app">
      <header className="cb-topbar">
        <Link to="/" className="cb-logo" aria-label="Chessbook home">
          <img src="/homepage_imgs/chessbook.svg" alt="Chessbook" />
        </Link>
        <div className="cb-top-actions">
          <span className="cb-plan-pill">LEARN</span>
          <Link to="/settings" className="cb-top-link">
            Account
          </Link>
        </div>
      </header>

      <main className="cb-main">
        <section className="cb-board-col">
          <Board
            fen={board?.fen ?? "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"}
            orientation={repertoire.color}
            lastMove={board ? { from: board.from, to: board.to } : null}
          />
          <div className="cb-board-footer">
            <span>{selected ? selected.name : "Nothing due"}</span>
            <a
              href={`https://lichess.org/analysis/standard/${encodeURIComponent(
                (board?.fen ?? "").split(" ")[0]
              )}`}
              target="_blank"
              rel="noreferrer"
            >
              Analyze <i className="fa fa-up-right-from-square" aria-hidden />
            </a>
          </div>
        </section>

        <Sidebar backTo={`/repertoire/${key}`} backLabel="Back">
          <Breadcrumb
            items={[
              { label: repertoire.name, to: `/repertoire/${key}` },
              { label: "Learn" },
            ]}
          />
          <div className="cb-page-head" style={{ paddingTop: 0 }}>
            <h1 className="cb-page-title">What do you want to practice?</h1>
          </div>

          <div className="cb-progress-line">
            <div className="cb-progress-copy">
              <strong>{repertoire.mastery.toFixed(1)}% mastered</strong>
            </div>
            <div className="cb-bar mastery">
              <span style={{ width: `${repertoire.mastery}%` }} />
            </div>
          </div>

          <div className="cb-learn-options">
            <Row
              large
              title="Everything that's due for review"
              right={
                <span className="cb-row-meta strong">
                  {dueCount} due <i className="fa fa-clock" aria-hidden />
                </span>
              }
              onClick={() => start("due")}
              disabled={dueCount === 0}
            />
            <Row
              large
              title="Just the moves I often get wrong"
              right={
                <span className="cb-row-meta strong">
                  {weakCount} due <i className="fa fa-clock" aria-hidden />
                </span>
              }
              onClick={() => start("weak")}
              disabled={weakCount === 0}
            />
            <Row
              large
              title="All moves, even if they're not due"
              right={<span className="cb-row-meta">{repertoire.lineCount} moves</span>}
              onClick={() => start("all")}
              disabled={repertoire.lineCount === 0}
            />
            <Row
              large
              title="A specific opening…"
              meta="Pick a line from your repertoire"
              onClick={() => setShowSpecific(true)}
              disabled={repertoire.lineCount === 0}
            />
          </div>

          <Section title="Up next">
            <div className="cb-stat-grid" style={{ padding: 0 }}>
              <Stat value={dueCount} label="Due" />
              <Stat value={`${repertoire.mastery}%`} label="Mastered" />
              <Stat value={queue.length} label="Queued" />
            </div>
          </Section>

          <Section title="Lines in your queue">
            {queue.length === 0 ? (
              <EmptyState
                icon="fa-circle-check"
                title="All caught up"
                action={
                  <Link className="cb-btn" to={`/build/${key}`}>
                    Add more lines
                  </Link>
                }
              >
                Nothing is due in this repertoire. Add lines or come back later.
              </EmptyState>
            ) : (
              queue.slice(0, 12).map((line) => (
                <Row
                  key={line.id}
                  title={line.name}
                  meta={`${line.moves.join(" ")} · ${formatDue(line.dueAt)}`}
                  className={selected?.id === line.id ? "selected" : ""}
                  right={
                    <span className="cb-row-right">
                      <ProgressRing value={line.mastered} size={12} />
                      <span className="cb-row-meta">{line.mastered}%</span>
                    </span>
                  }
                  onClick={() => setSelectedId(line.id)}
                />
              ))
            )}
          </Section>

          {selected && (
            <Section title="Selected line">
              <Row
                title="Practice this line"
                meta={selected.name}
                onClick={() => navigate(`/practice/${key}?line=${selected.id}`)}
              />
              <Row
                title="Open in build mode"
                meta="Inspect and edit the line"
                onClick={() => navigate(`/build/${key}?line=${selected.id}`)}
              />
            </Section>
          )}

          <Section title="Build">
            <Row
              title="Add more lines"
              meta="Search 3,865 ECO openings or import a PGN"
              onClick={() => navigate(`/build/${key}`)}
            />
          </Section>
        </Sidebar>
      </main>

      {showSpecific && (
        <Modal
          title="Pick an opening to practice"
          onClose={() => setShowSpecific(false)}
        >
          <div className="cb-openings-scroll" style={{ maxHeight: 420 }}>
            {queue.map((line) => (
              <button
                type="button"
                key={line.id}
                className="cb-opening-row"
                onClick={() => {
                  setShowSpecific(false);
                  navigate(`/practice/${key}?line=${line.id}`);
                }}
              >
                <span className="cb-opening-main">
                  <strong>{line.name}</strong>
                  <span>{line.moves.join(" ")}</span>
                </span>
                <ProgressRing value={line.mastered} size={14} />
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
