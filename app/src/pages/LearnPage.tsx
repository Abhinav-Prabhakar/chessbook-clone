import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import type { Line, Repertoire } from "../types";
import { Board } from "../components/Board";
import {
  BoardHeader,
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
        setSelectedId(null);
      })
      .catch((e) => setError(e.message));
  }, [key]);

  const selected = useMemo(
    () => data?.queue.find((l) => l.id === selectedId) ?? null,
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
      <main className="cb-main">
        <section className="cb-board-col">
          <BoardHeader
            items={[
              { label: repertoire.name, to: `/repertoire/${key}` },
              { label: "Learn" },
            ]}
          />
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
          <div className="cb-page-head">
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
              title="All moves, even if they're not due"
              right={<span className="cb-row-meta">{repertoire.lineCount} moves</span>}
              onClick={() => start("all")}
              disabled={repertoire.lineCount === 0}
            />
            <Row
              title="A specific opening…"
              onClick={() => setShowSpecific(true)}
              disabled={repertoire.lineCount === 0}
            />
          </div>
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
