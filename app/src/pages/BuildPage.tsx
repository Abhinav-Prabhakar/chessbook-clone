import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, pathQuery } from "../api";
import { BoardCaption, Crumbs, useBoard } from "../board/stage";
import type { Arrow } from "../board/Board";
import { replay } from "../chess";
import { forget, useApi } from "../useApi";
import type { Candidate, EngineEval, Gap, PositionView, RepertoireSummary } from "../types";
import {
  Back,
  Button,
  EvalChip,
  ErrorNote,
  Icon,
  Modal,
  PageHead,
  Progress,
  ResultBar,
  Row,
  Section,
  Skeleton,
  moveLabel,
  pct,
  compact,
  useToast,
} from "../ui";
import { BoardStrip, MoveList } from "../ui/MoveList";
import { buildPath, parsePath, practicePath, repertoirePath } from "../routes";
import { CompletionRing } from "./Dashboard";

export function BuildPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const path = useMemo(() => parsePath(params.get("path")), [params]);
  const pathKey = path.join(",");
  const { data, error, loading, reload } = useApi<PositionView>(`/repertoires/${id}/position?path=${pathQuery(path)}`);
  const summary = useApi<{ repertoire: RepertoireSummary }>(`/repertoires/${id}`);
  const nextGap = useApi<{ gaps: Gap[] }>(`/repertoires/${id}/gaps?limit=1&from=${pathQuery(path)}`);
  const [hover, setHover] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [addingAlt, setAddingAlt] = useState(false);
  const [engine, setEngine] = useState<EngineEval | null>(null);
  const [noteFor, setNoteFor] = useState<{ san?: string; text: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const local = useMemo(() => replay(path), [pathKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const color = data?.repertoire.color ?? summary.data?.repertoire.color ?? "white";
  const current = data && data.path.join(",") === pathKey ? data : null;

  useEffect(() => {
    setShowAll(false);
    setAddingAlt(false);
    setHover(null);
    setEngine(null);
  }, [pathKey]);

  // Engine evaluations arrive after the position (Stockfish runs locally).
  useEffect(() => {
    if (!current) return;
    if (current.eval) {
      setEngine(current.eval);
      return;
    }
    let cancelled = false;
    api
      .get<EngineEval>(`/eval?fen=${encodeURIComponent(current.fen)}`)
      .then((value) => !cancelled && setEngine(value))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [current]);

  const go = useCallback((next: string[]) => navigate(buildPath(id, next)), [id, navigate]);

  const refreshAll = () => {
    forget(`/repertoires/${id}`);
    forget("/dashboard");
    void reload();
    void summary.reload();
    void nextGap.reload();
  };

  const save = async (san: string) => {
    try {
      await api.post(`/repertoires/${id}/moves`, { path, san });
      forget(`/repertoires/${id}`);
      forget("/dashboard");
      go([...path, san]);
      void summary.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const mine = current ? current.mine : (local.fen.split(" ")[1] === "w") === (color === "white");

  const onBoardMove = (move: { san: string }) => {
    if (!current) return;
    if (current.mine) {
      if (current.mySaved.includes(move.san)) go([...path, move.san]);
      else void save(move.san);
    } else {
      go([...path, move.san]);
    }
  };

  const arrows: Arrow[] = [];
  if (hover) {
    const c = current?.candidates.find((x) => x.san === hover);
    if (c) arrows.push({ from: c.from, to: c.to, color: current?.mine ? "green" : "blue" });
  } else if (current?.mine) {
    for (const c of current.candidates) if (c.saved) arrows.push({ from: c.from, to: c.to, color: "green" });
  }

  useBoard({
    fen: local.fen,
    orientation: color,
    lastMove: local.lastMove,
    interactive: Boolean(current) && !current?.gameOver,
    arrows,
    peek: false,
    onMove: onBoardMove,
  });

  // Arrow keys step through the line.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea")) return;
      if (e.key === "ArrowLeft" && path.length) {
        e.preventDefault();
        go(path.slice(0, -1));
      } else if (e.key === "ArrowRight" && current) {
        const next = current.candidates.find((c) => c.saved) || (!current.mine ? current.candidates[0] : null);
        if (next) {
          e.preventDefault();
          go([...path, next.san]);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [path, current, go]);

  const rep = summary.data?.repertoire;
  const repName = current?.repertoire.name ?? rep?.name ?? "Repertoire";

  const caption = (
    <BoardCaption>
      <BoardStrip title={current?.opening?.name ?? (path.length ? "" : "Starting position")} fen={local.fen} orientation={color}>
        {path.length > 0 && <MoveList sans={local.moves.map((m) => m.san)} onSelect={(i) => go(path.slice(0, i + 1))} />}
      </BoardStrip>
    </BoardCaption>
  );

  if (error && !data) {
    return (
      <>
        {caption}
        <Back to={repertoirePath(id)} />
        <ErrorNote error={error} retry={reload} />
      </>
    );
  }

  const lastLabel = path.length ? moveLabel(path.length - 1, path[path.length - 1]) : null;
  let title: string;
  if (!path.length) title = mine ? "Continue building" : "Prepare for your opponent";
  else if (mine) title = current && current.mySaved.length ? `Your response to ${lastLabel}` : `Choose a response to ${lastLabel}`;
  else title = `After ${lastLabel}`;

  return (
    <>
      <Crumbs
        items={[
          { label: repName, to: repertoirePath(id) },
          { label: "Build", to: buildPath(id) },
          ...(rep && rep.started ? [{ label: `${rep.completion}% complete` }] : []),
        ]}
      />
      {caption}
      <Back to={repertoirePath(id)} />
      <PageHead title={title} />

      {!path.length && rep && (
        <div className="stat-block tight">
          <div className="stat-line">
            <strong>{rep.started ? `${rep.completion}% complete` : "Not started"}</strong>
            <AutofillButton id={id} from={[]} label="Autofill remaining gaps" onDone={refreshAll} />
          </div>
          <Progress value={rep.completion} />
        </div>
      )}

      {current ? (
        <div className={`build-body${loading ? " stale" : ""}`} key={pathKey}>
          <PositionContext view={current} />
          {current.gameOver ? (
            <p className="hint-text">The game is over in this position.</p>
          ) : current.mine ? (
            <MyMove
              view={current}
              engine={engine}
              showAll={showAll}
              addingAlt={addingAlt}
              onShowAll={() => setShowAll(true)}
              onAddAlt={() => setAddingAlt(true)}
              onHover={setHover}
              onPick={(c) => (c.saved ? go([...path, c.san]) : save(c.san))}
              onRemove={(san) => setRemoving(san)}
              onNote={(san, text) => setNoteFor({ san, text: text || "" })}
            />
          ) : (
            <TheirMove
              view={current}
              showAll={showAll}
              onShowAll={() => setShowAll(true)}
              onHover={setHover}
              onPick={(c) => go([...path, c.san])}
            />
          )}

          <div className="rows actions">
            {nextGap.data?.gaps[0] && nextGap.data.gaps[0].path.join(",") !== pathKey && (
              <Row
                title={path.length ? "Go to the next gap in this line" : "Go to your biggest gap"}
                meta={`${nextGap.data.gaps[0].lastMove ? `After ${nextGap.data.gaps[0].label}` : "Your first move"} · 1 in ${nextGap.data.gaps[0].expectedIn} games`}
                to={buildPath(id, nextGap.data.gaps[0].path)}
                chevron
              />
            )}
            {nextGap.data?.gaps[0] && path.length > 0 && (
              <AutofillRow id={id} from={path} onDone={refreshAll} />
            )}
            {current.onRepertoire && path.length > 0 && (
              <Row title="Practice from here" to={practicePath(id, "line", path)} chevron />
            )}
            <Row title="Play a training game from here" to={`/training-games?path=${pathQuery(path)}&color=${color}&repertoire=${id}`} chevron />
            <Row
              title={current.positionNote ? "Edit position note" : "Add a note for this position"}
              meta={current.positionNote || undefined}
              onClick={() => setNoteFor({ text: current.positionNote || "" })}
              chevron
            />
          </div>
        </div>
      ) : (
        <Skeleton rows={6} />
      )}

      {busy && <div className="busy-overlay" />}

      {noteFor && current && (
        <NoteModal
          title={noteFor.san ? `Note for ${noteFor.san}` : "Note for this position"}
          initial={noteFor.text}
          onClose={() => setNoteFor(null)}
          onSave={async (text) => {
            setBusy(true);
            try {
              await api.put(`/repertoires/${id}/notes`, { path, san: noteFor.san, note: text });
              setNoteFor(null);
              void reload();
            } catch (e) {
              toast((e as Error).message, "error");
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      {removing && (
        <Modal title={`Remove ${removing}?`} onClose={() => setRemoving(null)}>
          <p className="modal-text">
            {removing} and every move you saved after it will be removed from {repName}. Their review history is deleted too.
          </p>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  const result = await api.del<{ removed: number }>(`/repertoires/${id}/moves`, { path, san: removing });
                  toast(`Removed ${result.removed} move${result.removed === 1 ? "" : "s"}`);
                } catch (e) {
                  toast((e as Error).message, "error");
                }
                setRemoving(null);
                refreshAll();
              }}
            >
              Remove
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

function PositionContext({ view }: { view: PositionView }) {
  if (!view.path.length) return null;
  const parts: string[] = [];
  if (view.expectedIn && view.reach > 0) {
    parts.push(
      view.expectedIn <= 1
        ? "You'll reach this position in almost every game."
        : `This position comes up in about 1 in ${view.expectedIn} of your games.`
    );
  } else if (view.reach === 0) {
    parts.push("Players at your level rarely reach this position.");
  }
  if (!view.onRepertoire) parts.push("Not in your repertoire yet.");
  if (view.positionNote) parts.push(`Note: ${view.positionNote}`);
  return parts.length ? <p className="context-line">{parts.join(" ")}</p> : null;
}

function MyMove({
  view,
  engine,
  showAll,
  addingAlt,
  onShowAll,
  onAddAlt,
  onHover,
  onPick,
  onRemove,
  onNote,
}: {
  view: PositionView;
  engine: EngineEval | null;
  showAll: boolean;
  addingAlt: boolean;
  onShowAll: () => void;
  onAddAlt: () => void;
  onHover: (san: string | null) => void;
  onPick: (c: Candidate) => void;
  onRemove: (san: string) => void;
  onNote: (san: string, text: string | null) => void;
}) {
  const saved = view.candidates.filter((c) => c.saved);
  const others = view.candidates.filter((c) => !c.saved);
  const hasSaved = saved.length > 0;
  const list = hasSaved ? (addingAlt ? others : []) : others;
  const visible = showAll ? list : list.slice(0, 6);
  const evalFor = (san: string) => engine?.moves.find((m) => m.san === san);

  return (
    <>
      {hasSaved && (
        <Section title={view.ply === 0 ? "Your first move" : "Your move"} right={<CandidateHeader />}>
          <div className="cand-list">
            {saved.map((c) => (
              <CandidateRow
                key={c.san}
                c={c}
                ply={view.ply}
                ev={evalFor(c.san)}
                engineReady={Boolean(engine)}
                onHover={onHover}
                onClick={() => onPick(c)}
                actions={
                  <>
                    <button type="button" className="mini-action" onClick={(e) => (e.stopPropagation(), onNote(c.san, c.ownNote ? c.note : null))}>
                      {c.ownNote ? "Edit note" : "Add a note"} <Icon name="note" />
                    </button>
                    <button type="button" className="mini-action" onClick={(e) => (e.stopPropagation(), onRemove(c.san))}>
                      Remove <Icon name="trash" />
                    </button>
                  </>
                }
              />
            ))}
          </div>
          {saved.length > 1 && (
            <p className="hint-text">You have {saved.length} moves here. In practice, either one counts as correct.</p>
          )}
          {!addingAlt && others.length > 0 && (
            <button type="button" className="text-action" onClick={onAddAlt}>
              Add an alternative move
            </button>
          )}
        </Section>
      )}
      {list.length > 0 && (
        <Section title={hasSaved ? "Alternatives" : view.ply === 0 ? "Choose your first move" : "Potential moves"} right={<CandidateHeader />}>
          <div className="cand-list">
            {visible.map((c) => (
              <CandidateRow
                key={c.san}
                c={c}
                ply={view.ply}
                ev={evalFor(c.san)}
                engineReady={Boolean(engine)}
                onHover={onHover}
                onClick={() => onPick(c)}
              />
            ))}
          </div>
          {list.length > visible.length && (
            <button type="button" className="text-action" onClick={onShowAll}>
              Show {list.length - visible.length} more
            </button>
          )}
          <p className="hint-text">Pick a move above or play any move on the board to add it.</p>
        </Section>
      )}
      {!hasSaved && list.length === 0 && (
        <p className="hint-text">No statistics for this position. Play your move on the board to add it.</p>
      )}
    </>
  );
}

function CandidateHeader() {
  return (
    <span className="cand-head">
      <span>Masters</span>
      <span>Eval</span>
      <span className="cand-head-peers">Your level</span>
    </span>
  );
}

function CandidateRow({
  c,
  ply,
  ev,
  engineReady,
  onHover,
  onClick,
  actions,
}: {
  c: Candidate;
  ply: number;
  ev?: { eval: number | null; mate: number | null };
  engineReady: boolean;
  onHover: (san: string | null) => void;
  onClick: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <div
      className={`cand${c.saved ? " saved" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      onMouseEnter={() => onHover(c.san)}
      onMouseLeave={() => onHover(null)}
    >
      <div className="cand-main">
        <div className="cand-top">
          <span className="cand-move">{moveLabel(ply, c.san)}</span>
          {c.name && <span className="cand-name">{c.name}</span>}
        </div>
        {c.note && <p className="cand-note">{c.note}</p>}
        {actions && <div className="cand-actions">{actions}</div>}
      </div>
      <div className="cand-stats">
        <span className="cand-masters" title={c.masters ? `${compact(c.masters.games)} master games` : "Not played in master games"}>
          {c.masters ? pct(c.masters.share) : "–"}
        </span>
        <span className="cand-eval">
          {ev ? <EvalChip value={ev.eval} mate={ev.mate} /> : engineReady ? <span className="eval-chip none">–</span> : <EvalChip value={null} />}
        </span>
        <span className="cand-peers" title={c.peers ? `${compact(c.peers.games)} games at your level` : "Not enough games at your level"}>
          {c.peers && c.peers.games >= 10 ? <ResultBar white={c.peers.white} draw={c.peers.draw} black={c.peers.black} /> : <span className="muted">–</span>}
        </span>
      </div>
    </div>
  );
}

function TheirMove({
  view,
  showAll,
  onShowAll,
  onHover,
  onPick,
}: {
  view: PositionView;
  showAll: boolean;
  onShowAll: () => void;
  onHover: (san: string | null) => void;
  onPick: (c: Candidate) => void;
}) {
  const common = view.candidates.filter((c) => !c.rare);
  const rare = view.candidates.filter((c) => c.rare);
  const list = showAll ? [...common, ...rare] : common.length ? common : rare.slice(0, 5);
  return (
    <Section
      title={view.ply === 0 ? "Your opponent's first move" : "Your opponent's likely moves"}
      right={
        <span className="cand-head two">
          <span>Expected in</span>
          <span>Covered</span>
        </span>
      }
    >
      <div className="cand-list">
        {list.map((c) => (
          <div
            key={c.san}
            className="cand reply"
            role="button"
            tabIndex={0}
            onClick={() => onPick(c)}
            onKeyDown={(e) => e.key === "Enter" && onPick(c)}
            onMouseEnter={() => onHover(c.san)}
            onMouseLeave={() => onHover(null)}
          >
            <div className="cand-main">
              <div className="cand-top">
                <span className="cand-move">{moveLabel(view.ply, c.san)}</span>
                {c.name && <span className="cand-name">{c.name}</span>}
              </div>
              {c.note && <p className="cand-note">{c.note}</p>}
            </div>
            <div className="cand-stats two">
              <span className="cand-expected">{c.expectedIn ? `1 in ${c.expectedIn}` : "rare"}</span>
              <span className="cand-coverage">
                {c.rare ? (
                  <span className="muted">Below goal</span>
                ) : c.coverage != null ? (
                  <span className={`coverage ${c.coverage >= 100 ? "full" : c.coverage === 0 ? "none" : ""}`}>
                    {c.coverage >= 100 ? (
                      <>
                        <Icon name="check" /> Done
                      </>
                    ) : (
                      <>
                        {c.coverage}% <CompletionRing value={c.coverage} />
                      </>
                    )}
                  </span>
                ) : null}
              </span>
            </div>
          </div>
        ))}
      </div>
      {!showAll && rare.length > 0 && common.length > 0 && (
        <button type="button" className="text-action" onClick={onShowAll}>
          Show {rare.length} rarer moves
        </button>
      )}
      <p className="hint-text">
        Pick a move to prepare your answer to it. Moves seen in fewer than 1 in {view.coverageGoal} games are below your coverage goal.
      </p>
    </Section>
  );
}

function AutofillButton({ id, from, label, onDone }: { id: string; from: string[]; label: string; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="head-link"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const result = await api.post<{ added: unknown[]; completion: number }>(`/repertoires/${id}/autofill`, { from, limit: 15 });
          toast(result.added.length ? `Added ${result.added.length} moves · ${result.completion}% complete` : "Nothing left to fill at your coverage goal");
          onDone();
        } catch (e) {
          toast((e as Error).message, "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Filling…" : label} <Icon name="wand" />
    </button>
  );
}

function AutofillRow({ id, from, onDone }: { id: string; from: string[]; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Row
      title={busy ? "Filling gaps…" : "Autofill the gaps after this move"}
      meta="Adds the moves masters play most, up to your coverage goal"
      right={<Icon name="wand" />}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const result = await api.post<{ added: unknown[] }>(`/repertoires/${id}/autofill`, { from, limit: 12 });
          toast(result.added.length ? `Added ${result.added.length} moves` : "Nothing left to fill here");
          onDone();
        } catch (e) {
          toast((e as Error).message, "error");
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}

function NoteModal({ title, initial, onClose, onSave }: { title: string; initial: string; onClose: () => void; onSave: (text: string) => void }) {
  const [text, setText] = useState(initial);
  return (
    <Modal title={title} onClose={onClose}>
      <textarea
        className="textarea"
        rows={5}
        autoFocus
        maxLength={1000}
        placeholder="Why do you play this? What is the plan?"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => onSave(text)}>Save note</Button>
      </div>
    </Modal>
  );
}
