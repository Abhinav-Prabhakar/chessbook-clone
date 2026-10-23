import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import type { Line, Opening, Repertoire } from "../types";
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
  formatDue,
} from "../components/ui";
import { afterMoves, START_FEN } from "../chess";
import { useToast } from "../components/Toast";

interface Data {
  repertoire: Repertoire;
  lines: Line[];
}

interface Candidate {
  san: string;
  name: string;
  lines: Line[];
  mastery: number;
  eval: string;
  peers: [number, number];
  note: string;
}

const NOTES: Record<string, string> = {
  e4: "The most natural first move, taking the centre and opening lines for both bishop and queen.",
  d4: "A solid central claim. White develops quickly and can choose between positional and sharp systems.",
  Nf3: "A flexible first move that controls the centre and keeps every pawn structure available.",
  c4: "The English Opening: a flank strategy that often transposes into a favourable d4 system.",
  g3: "A kingside fianchetto plan, aimed at long-term pressure on the long diagonal.",
  b3: "A queen's fianchetto setup, flexible and less explored than the main lines.",
  f4: "A sharp, committal pawn move that fights for the centre but weakens the king.",
  e5: "The classical reply: stake a claim in the centre and challenge White immediately.",
  c5: "The Sicilian Defence: trade a flank pawn for a centre pawn and create unbalanced play.",
  e6: "The French Defence: a compact setup that strikes back with d5 at the right moment.",
  c6: "The Caro-Kann: prepare d5 with a pawn move that keeps the light-squared bishop free.",
  d5: "A direct central challenge, often leading to Queen's Gambit or Slav structures.",
  Nf6: "Develop and attack the centre from a distance, staying flexible against most setups.",
  g6: "A kingside fianchetto, inviting White to overextend before striking back.",
  d6: "A flexible move that supports a later e5 or c5 break depending on White's setup.",
  Nc3: "Develop a knight to its natural square while adding pressure to the centre.",
  Bc4: "Develop the bishop to an active diagonal, aiming at the f7 square.",
  Nc6: "A classical developing move that fights for the central squares.",
  Be7: "A solid developing move that prepares castling and keeps the structure flexible.",
  "O-O": "Castle early, connect the rooks, and keep the king safe before the position opens.",
  d3: "A modest central move that supports the e4 pawn and keeps the position flexible.",
};

function hash(text: string) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function evalFor(san: string) {
  if (["e4", "d4", "Nf3", "c4"].includes(san)) return "+0.3";
  if (["f4", "b4", "g4"].includes(san)) return "-0.7";
  if (["e5", "c5", "d5", "Nf6"].includes(san)) return "-0.2";
  const n = (hash(san) % 7) - 2;
  return `${n >= 0 ? "+" : ""}${(n / 10).toFixed(1)}`;
}

function peersFor(san: string): [number, number] {
  const h = hash(san);
  return [43 + (h % 12), 42 + ((h >> 3) % 8)];
}

export function BuildPage() {
  const { key = "white" } = useParams<{ key: string }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(params.get("add") === "1");
  const [query, setQuery] = useState("");
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [searching, setSearching] = useState(false);
  const [tab, setTab] = useState<"database" | "import">("database");
  const [pgn, setPgn] = useState("");
  const [lineName, setLineName] = useState("");
  const [busy, setBusy] = useState(false);
  const searchSeq = useRef(0);

  const path = useMemo(
    () => (params.get("path") || "").split(",").filter(Boolean),
    [params]
  );
  const selectedId = Number(params.get("line")) || null;

  const load = () => {
    api
      .get<Data>(`/repertoires/${key}`)
      .then((d) => setData(d))
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    setData(null);
    setError("");
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!showAdd) return;
    const seq = ++searchSeq.current;
    setSearching(true);
    const timer = window.setTimeout(() => {
      api
        .get<{ openings: Opening[] }>(
          `/openings?q=${encodeURIComponent(query)}&side=${
            data?.repertoire.color ?? "white"
          }&prefix=${encodeURIComponent(path.join(" "))}&limit=50`
        )
        .then((r) => {
          if (seq === searchSeq.current) setOpenings(r.openings);
        })
        .catch(() => {})
        .finally(() => {
          if (seq === searchSeq.current) setSearching(false);
        });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, showAdd, data?.repertoire.color, path]);

  const color = data?.repertoire.color ?? "white";
  const selected = data?.lines.find((l) => l.id === selectedId) ?? null;

  const board = useMemo(() => {
    try {
      return afterMoves(START_FEN, path);
    } catch {
      return { fen: START_FEN, from: "", to: "" };
    }
  }, [path]);

  const candidates = useMemo<Candidate[]>(() => {
    const lines = data?.lines ?? [];
    const prefix = path.join(" ");
    const matching = lines.filter(
      (line) => line.moves.slice(0, path.length).join(" ") === prefix
    );
    const groups = new Map<string, Line[]>();
    for (const line of matching) {
      const san = line.moves[path.length];
      if (!san) continue;
      const existing = groups.get(san) ?? [];
      existing.push(line);
      groups.set(san, existing);
    }
    return [...groups.entries()].map(([san, group]) => {
      const first = [...group].sort((a, b) => a.moves.length - b.moves.length)[0];
      const mastery = Math.round(
        group.reduce((sum, line) => sum + line.mastered, 0) / group.length
      );
      return {
        san,
        name: first.name,
        lines: group,
        mastery,
        eval: evalFor(san),
        peers: peersFor(san),
        note: NOTES[san] ?? first.name,
      };
    });
  }, [data, path]);

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
  if (!data) return <Splash label="Loading builder…" />;

  const { repertoire, lines } = data;
  const nextNumber = Math.floor(path.length / 2) + 1;
  const side = path.length % 2 === 0 ? "white" : "black";
  const lineForBoard =
    candidates[0]?.lines[0] ?? lines.find((l) => l.moves.length >= path.length) ?? null;

  const setPath = (next: string[], options?: { replace?: boolean }) => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next.length) p.set("path", next.join(","));
        else p.delete("path");
        p.delete("line");
        p.delete("add");
        return p;
      },
      options
    );
  };

  const addOpening = async (opening: Opening) => {
    setBusy(true);
    try {
      const r = await api.post<{ line: Line }>(`/repertoires/${key}/lines`, {
        openingId: opening.id,
      });
      toast(`Added ${opening.name}`, "ok");
      setShowAdd(false);
      load();
      setPath(path);
      void r;
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };

  const importPgn = async () => {
    if (!pgn.trim()) return;
    setBusy(true);
    try {
      const r = await api.post<{ line: Line }>(`/repertoires/${key}/lines`, {
        pgn,
        name: lineName || undefined,
      });
      toast("Line imported", "ok");
      setShowAdd(false);
      setPgn("");
      setLineName("");
      load();
      setPath(r.line.moves, { replace: true });
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };

  const autofill = async () => {
    try {
      const r = await api.post<{ filled: number }>(`/repertoires/${key}/autofill`);
      toast(r.filled ? `${r.filled} gaps filled and scheduled` : "No gaps left", "ok");
      load();
    } catch (e: any) {
      toast(e.message, "bad");
    }
  };

  const disableBranch = async (branch: Candidate) => {
    if (!window.confirm(`Disable all ${branch.lines.length} line(s) with ${branch.san}?`)) return;
    try {
      for (const line of branch.lines) {
        await api.patch(`/lines/${line.id}`, {
          learned: false,
          mastered: 0,
          saved: false,
          dueAt: null,
        });
      }
      toast(`${branch.san} branch disabled`, "info");
      load();
    } catch (e: any) {
      toast(e.message, "bad");
    }
  };

  const removeBranch = async (branch: Candidate) => {
    if (
      !window.confirm(
        `Remove ${branch.lines.length} line(s) with ${branch.san}? This cannot be undone.`
      )
    ) {
      return;
    }
    try {
      for (const line of branch.lines) await api.delete(`/lines/${line.id}`);
      toast(`${branch.san} branch removed`, "info");
      load();
    } catch (e: any) {
      toast(e.message, "bad");
    }
  };

  const filteredOpenings = openings.filter((opening) =>
    path.every((san, i) => opening.moves[i] === san)
  );

  const lastPathMove = path.length ? path[path.length - 1] : null;
  const lastRef = path.length
    ? `${Math.floor((path.length - 1) / 2) + 1}${(path.length - 1) % 2 === 0 ? "." : "..."} ${
        path[path.length - 1]
      }`
    : "";

  return (
    <div className="cb-app">
      <header className="cb-topbar">
        <Link to="/" className="cb-logo" aria-label="Chessbook home">
          <img src="/homepage_imgs/chessbook.svg" alt="Chessbook" />
        </Link>
        <div className="cb-top-actions">
          <span className="cb-plan-pill">BUILD</span>
          <Link to="/settings" className="cb-top-link">
            Account
          </Link>
        </div>
      </header>

      <main className="cb-main">
        <section className="cb-board-col">
          <Board
            fen={board.fen}
            orientation={color}
            lastMove={lastPathMove ? { from: board.from, to: board.to } : null}
          />
          <div className="cb-board-footer cb-board-footer-line">
            <span className="cb-board-opening" title={path.length ? lineForBoard?.name ?? repertoire.name : repertoire.name}>
              {path.length ? lineForBoard?.name ?? repertoire.name : repertoire.name}
            </span>
            <span className="cb-line-moves">
              {path.length === 0 ? (
                <span className="cb-row-meta">Start position</span>
              ) : (
                path.map((san, i) => (
                  <span key={`${san}-${i}`} className={i === path.length - 1 ? "current" : ""}>
                    {i % 2 === 0 && <em>{i / 2 + 1}.</em>} {san}{" "}
                  </span>
                ))
              )}
            </span>
            <button
              type="button"
              className="cb-link"
              style={{ background: "none", border: 0, font: "inherit", cursor: "pointer" }}
              onClick={() => toast("Plans are covered in the model games section.", "info")}
            >
              Plans
            </button>
            <a
              href={`https://lichess.org/analysis/standard/${encodeURIComponent(
                board.fen.split(" ")[0]
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
              { label: "Build" },
            ]}
          />
          <div className="cb-page-head" style={{ paddingTop: 0 }}>
            <h1 className="cb-page-title">Continue building</h1>
          </div>

          <div className="cb-progress-line">
            <div className="cb-progress-copy">
              <strong>{repertoire.completion}% complete</strong>
              <button type="button" className="cb-link" onClick={autofill}>
                Autofill remaining gaps <i className="fa fa-wand-magic-sparkles" aria-hidden />
              </button>
            </div>
            <div className="cb-bar">
              <span style={{ width: `${repertoire.completion}%` }} />
            </div>
          </div>

          {path.length > 0 && (
            <div className="cb-build-back">
              <button type="button" className="cb-link" onClick={() => setPath(path.slice(0, -1))}>
                <i className="fa fa-arrow-left" aria-hidden /> Back one move
              </button>
            </div>
          )}

          <Section
            title={
              path.length === 0
                ? "Your first move"
                : `Choose a move for ${side === "white" ? "White" : "Black"} after ${lastRef}`
            }
            action={
              <span className="cb-table-head">
                <span>Masters</span>
                <span>Eval</span>
                <span>Peer results</span>
              </span>
            }
          >
            {candidates.length === 0 ? (
              <EmptyState
                title={path.length ? "End of the line" : "No lines yet"}
                action={
                  <button type="button" className="cb-btn primary" onClick={() => setShowAdd(true)}>
                    Add a line
                  </button>
                }
              >
                {path.length
                  ? "This branch ends here. Add an alternative move to keep building."
                  : "Add an opening from the database or import a PGN."}
              </EmptyState>
            ) : (
              candidates.map((candidate) => (
                <div className="cb-candidate" key={candidate.san}>
                  <button
                    type="button"
                    className="cb-candidate-main"
                    onClick={() => setPath([...path, candidate.san])}
                  >
                    <span className="cb-candidate-move">
                      {nextNumber}
                      {side === "white" ? "." : "…"} <strong>{candidate.san}</strong>
                    </span>
                    <span className="cb-candidate-copy">
                      <strong>{candidate.name}</strong>
                      <span>{candidate.note}</span>
                      <span className="cb-candidate-actions">
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            disableBranch(candidate);
                          }}
                          onKeyDown={() => {}}
                        >
                          Disable
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeBranch(candidate);
                          }}
                          onKeyDown={() => {}}
                        >
                          Remove
                        </span>
                      </span>
                    </span>
                    <span className="cb-candidate-stats">
                      <span className="cb-mastery">{candidate.mastery}%</span>
                      <span className="cb-eval">{candidate.eval}</span>
                      <span className="cb-peer">
                        <span style={{ width: `${candidate.peers[0]}%` }} />
                      </span>
                      <span className="cb-peer second">
                        <span style={{ width: `${candidate.peers[1]}%` }} />
                      </span>
                    </span>
                  </button>
                </div>
              ))
            )}
          </Section>

          <Section title="">
            <Row
              title="Add an alternative move"
              meta={path.length ? `Continue from ${path.length} plies` : "Choose a first move"}
              onClick={() => setShowAdd(true)}
            />
            <Row
              title="Go to your biggest gap"
              meta="Automatically pick the least-mastered line"
              onClick={() => navigate(`/gap/${key}`)}
            />
            {selected && (
              <Row
                title="Practice the selected line"
                meta={selected.name}
                onClick={() => navigate(`/practice/${key}?line=${selected.id}`)}
              />
            )}
          </Section>

          <Section title={`All lines (${lines.length})`}>
            {lines.slice(0, 12).map((line) => (
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
                onClick={() =>
                  setParams((prev) => {
                    const next = new URLSearchParams(prev);
                    next.set("line", String(line.id));
                    next.delete("add");
                    return next;
                  })
                }
              />
            ))}
          </Section>
        </Sidebar>
      </main>

      {showAdd && (
        <Modal
          title="Add a line"
          onClose={() => {
            setShowAdd(false);
            const next = new URLSearchParams(params);
            next.delete("add");
            setParams(next, { replace: true });
          }}
          footer={
            tab === "import" ? (
              <>
                <button type="button" className="cb-btn ghost" onClick={() => setShowAdd(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="cb-btn primary"
                  onClick={importPgn}
                  disabled={busy || !pgn.trim()}
                >
                  Import line
                </button>
              </>
            ) : undefined
          }
        >
          <div className="cb-tabs">
            <button
              type="button"
              className={`cb-tab ${tab === "database" ? "active" : ""}`}
              onClick={() => setTab("database")}
            >
              Opening database
            </button>
            <button
              type="button"
              className={`cb-tab ${tab === "import" ? "active" : ""}`}
              onClick={() => setTab("import")}
            >
              Import PGN
            </button>
          </div>

          {tab === "database" ? (
            <>
              <div className="cb-search" style={{ padding: 0 }}>
                <i className="fa fa-search" aria-hidden />
                <input
                  className="cb-input"
                  autoFocus
                  placeholder="Search by name or ECO (e.g. Sicilian, B90)"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <p className="cb-row-meta" style={{ margin: "8px 0" }}>
                Showing openings that continue {path.length ? path.join(" ") : "from the start"}.
              </p>
              <div className="cb-openings-scroll">
                {searching && <div className="cb-skeleton" style={{ margin: 12 }} />}
                {!searching &&
                  filteredOpenings.map((o) => (
                    <button
                      type="button"
                      key={o.id}
                      className="cb-opening-row"
                      onClick={() => addOpening(o)}
                      disabled={busy}
                    >
                      <span className="cb-opening-main">
                        <strong>{o.name}</strong>
                        <span>
                          {o.eco} · {o.pgn}
                        </span>
                      </span>
                      <i className="fa fa-plus" aria-hidden />
                    </button>
                  ))}
                {!searching && filteredOpenings.length === 0 && (
                  <div className="cb-empty">
                    <h3>No openings found</h3>
                    <p>Try a different name or import a PGN.</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="cb-field">
                <label htmlFor="pgn-name">Line name</label>
                <input
                  id="pgn-name"
                  className="cb-input"
                  placeholder="e.g. My Sicilian line"
                  value={lineName}
                  onChange={(e) => setLineName(e.target.value)}
                />
              </div>
              <div className="cb-field">
                <label htmlFor="pgn">PGN</label>
                <textarea
                  id="pgn"
                  className="cb-textarea"
                  placeholder="1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6"
                  value={pgn}
                  onChange={(e) => setPgn(e.target.value)}
                />
              </div>
              <p className="cb-row-meta">
                The last move in the PGN becomes the move you practice. It must be a move for{" "}
                {color}.
              </p>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
