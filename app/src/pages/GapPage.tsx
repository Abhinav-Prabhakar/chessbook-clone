import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import type { Line, Repertoire } from "../types";
import { Board } from "../components/Board";
import {
  BoardHeader,
  EmptyState,
  Row,
  Section,
  Sidebar,
  Splash,
} from "../components/ui";
import { afterMoves, START_FEN } from "../chess";
import { useToast } from "../components/Toast";

/*
 * Gap contract:
 *
 *   /gap/:key                 the server's ranked biggest gap
 *   /gap/:key?epd=<epd>       an exact gap position (Build from here, next gap)
 *   /gap/:key?path=e4,e5      a prefix
 *   /gap/:key?after=<epd>     the next ranked gap after a position
 *
 * Candidates, masters, peers, eval and incidence are the captured server
 * values. Nothing is hashed or derived from local mastery.
 */

const PAGE_SIZE = 8;
const STYLE_OPTIONS = ["expected", "aggressive", "solid", "learnable", "sharp"] as const;
type AutofillStyle = (typeof STYLE_OPTIONS)[number];
const STYLE_LABELS: Record<AutofillStyle, string> = {
  expected: "Expected",
  aggressive: "Aggressive",
  solid: "Solid",
  learnable: "Learnable",
  sharp: "Sharp",
};

interface RepStats extends Repertoire {
  positionCount?: number;
  moveCount?: number;
  learnedPositions?: number;
  coverage?: number | null;
  coveragePercent?: number | null;
}

interface MasterResults {
  white: number;
  draw: number;
  black: number;
  games: number;
  share: number;
}

interface PeerSplit {
  white: number;
  draw: number;
  black: number;
}

interface PeerResults extends PeerSplit {
  games: number;
}

interface Candidate {
  rank: number;
  san: string;
  sanKey: string;
  epd: string;
  epdAfter: string | null;
  fenAfter: string | null;
  name: string | null;
  eco: string | null;
  openingId: number | null;
  friendlyName: string | null;
  mastery: number | null;
  lineCount: number;
  inRepertoire: boolean;
  annotation: string | null;
  description: string | null;
  masters: number | null;
  masterResults: MasterResults | null;
  mastersAvailable: boolean;
  peers: PeerSplit | null;
  peerResults: PeerResults | null;
  peersAvailable: boolean;
  eval: number | null;
  evalPawn: number | null;
  mate: number | null;
  evalAvailable: boolean;
  probability: number | null;
  incidence: number | null;
  incidenceAvailable: boolean;
  oneIn: number | null;
  incidenceLabel: string | null;
  realIncidenceAvailable: boolean;
  needed: boolean;
  saved: boolean;
  excluded: boolean;
  playable: boolean;
  lineId: number | null;
  lineName: string | null;
  branchMoves: string[];
  branchPgn: string;
  pgn: string;
  statsAvailable?: boolean;
  source: string | null;
}

interface Note {
  id: number;
  epd: string;
  san: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
}

interface Annotation {
  id?: number;
  epd: string;
  san: string | null;
  text: string;
  mine: boolean;
  source: string | null;
}

interface HeadingMove {
  san?: string;
  ply?: number;
  moveNumber: number;
  side: "white" | "black";
  label: string;
}

interface PositionHeading {
  prompt: string;
  moveNumber: number;
  side: "white" | "black";
  label: string;
  lastMove: HeadingMove | null;
  nextMove: HeadingMove;
}

interface BestMissing {
  san: string;
  name: string | null;
  probability: number | null;
  incidence: number | null;
  oneIn: number | null;
  eval: number | null;
  masters: number | null;
  annotation: string | null;
  epdAfter?: string | null;
}

interface GapPosition {
  epd: string;
  fen: string;
  side: "white" | "black";
  ply: number | null;
  moveNumber: number;
  prefixMoves: string[];
  pathPgn: string;
  heading: PositionHeading;
  note: Note | null;
  annotations: Annotation[];
  incidence: number | null;
  oneIn: number | null;
  candidateCount: number | null;
  savedCount: number | null;
  missingCount: number | null;
  coverage: number | null;
  bestMissing: BestMissing | null;
  capturedMiss: boolean;
}

interface CandidatePosition {
  epd: string;
  fen: string;
  side: "white" | "black";
  repertoireSide: "white" | "black" | null;
  isYourTurn: boolean | null;
  prefixMoves: string[];
  available: boolean;
  stockfish: { eval: number | null; mate: number | null; pawns: number | null; available: boolean };
  excludedMoves: string[];
}

interface GapSummary {
  epd: string;
  fen: string;
  side: "white" | "black";
  ply: number;
  moveNumber: number;
  path: string[];
  pathPgn: string;
  lastMove: HeadingMove | null;
  lineId: number | null;
  lineName: string | null;
  incidence: number | null;
  oneIn: number | null;
  weight: number;
  candidateCount: number;
  savedCount: number;
  missingCount: number;
  coverage: number | null;
  capturedMiss: boolean;
}

interface GapData {
  repertoire: RepStats;
  gap: Line | null;
  line: Line | null;
  position: GapPosition | null;
  candidates: Candidate[];
  candidatePosition: CandidatePosition | null;
  available: boolean;
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
  gaps: GapSummary[];
  stats: RepStats;
}

interface RepoData {
  repertoire: RepStats;
  lines: Line[];
}

interface AutofillInserted {
  epd: string;
  san: string;
  lineId: number;
  created: boolean;
}

interface AutofillResponse {
  filled: number;
  inserted: AutofillInserted[];
  skipped: { reason?: string; san?: string }[];
  style: AutofillStyle;
}

function percent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded}%`;
}

function compactNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return String(value);
}

function evalLabel(candidate: Candidate): string {
  if (candidate.mate != null) {
    if (candidate.mate === 0) return "#";
    return `${candidate.mate > 0 ? "+" : "-"}M${Math.abs(candidate.mate)}`;
  }
  if (candidate.evalPawn != null) {
    const value = candidate.evalPawn;
    if (value === 0) return "0.00";
    return `${value > 0 ? "+" : "-"}${Math.abs(value).toFixed(2)}`;
  }
  if (candidate.eval != null) {
    const pawns = candidate.eval / 100;
    return `${pawns > 0 ? "+" : "-"}${Math.abs(pawns).toFixed(2)}`;
  }
  return "—";
}

function expectedLabel(candidate: Candidate): string {
  if (candidate.realIncidenceAvailable && candidate.oneIn) {
    return `Expected in 1 in ${candidate.oneIn} games`;
  }
  if (candidate.probability != null) {
    return `Played in ${Math.round(candidate.probability * 100)}% of games at this level`;
  }
  return "Expected in: not available";
}

function pgnFromPath(path: string[]): string {
  return path
    .map((san, index) => `${index % 2 === 0 ? `${index / 2 + 1}. ` : ""}${san}`)
    .join(" ");
}

function CandidateStats({ candidate }: { candidate: Candidate }) {
  const masters = candidate.masterResults;
  const peers = candidate.peers;
  return (
    <span
      className="cb-candidate-stats"
      style={{ gridTemplateColumns: "54px 44px 96px", gap: 8 }}
    >
      <span
        className="cb-mastery"
        style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}
        title={
          candidate.mastersAvailable
            ? `Played in ${percent(candidate.masters)} of captured master games`
            : "Masters data is not available for this move"
        }
      >
        <span>{percent(candidate.masters)}</span>
        <span className="cb-row-meta" style={{ fontSize: 9, lineHeight: "11px" }}>
          {masters ? `${compactNumber(masters.games)} games` : "Not available"}
        </span>
      </span>
      <span
        className="cb-eval"
        title={
          candidate.evalAvailable
            ? `${candidate.eval} centipawns${candidate.mate != null ? `, mate in ${candidate.mate}` : ""}`
            : "Engine eval is not available for this move"
        }
      >
        {evalLabel(candidate)}
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        {peers ? (
          <>
            <span
              className="cb-peer"
              style={{
                display: "flex",
                width: "100%",
                height: 14,
                borderRadius: 2,
                overflow: "hidden",
                background: "#3a3e3f",
              }}
              title={`Peer results — White ${percent(peers.white)}, draw ${percent(
                peers.draw
              )}, Black ${percent(peers.black)}`}
            >
              <span
                style={{
                  width: `${peers.white}%`,
                  background: "#e8e8e8",
                  color: "#171b1c",
                  fontSize: 9,
                  fontWeight: 700,
                  lineHeight: "14px",
                  paddingLeft: 3,
                }}
              >
                {Math.round(peers.white)}
              </span>
              <span style={{ width: `${peers.draw}%`, background: "#8b9092" }} />
              <span
                style={{
                  width: `${peers.black}%`,
                  background: "#2f3334",
                  color: "#f2f2f2",
                  fontSize: 9,
                  fontWeight: 700,
                  lineHeight: "14px",
                  textAlign: "right",
                  paddingRight: 3,
                }}
              >
                {Math.round(peers.black)}
              </span>
            </span>
            <span
              className="cb-row-meta"
              style={{ fontSize: 9, lineHeight: "11px", textAlign: "right" }}
            >
              {Math.round(peers.white)}% / {Math.round(peers.draw)}% / {Math.round(peers.black)}%
            </span>
          </>
        ) : (
          <span className="cb-row-meta" style={{ fontSize: 9 }}>
            Not available
          </span>
        )}
      </span>
    </span>
  );
}

const actionStyle: React.CSSProperties = {
  background: "none",
  border: 0,
  padding: 0,
  color: "var(--cb-text-dim)",
  font: "inherit",
  fontSize: 10,
  fontWeight: 600,
  cursor: "pointer",
};

async function putNote(path: string, body: unknown) {
  const res = await fetch(`/api${path}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export function GapPage() {
  const { key = "white" } = useParams<{ key: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [data, setData] = useState<GapData | null>(null);
  const [repo, setRepo] = useState<RepoData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);

  const [extra, setExtra] = useState<Candidate[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [style, setStyle] = useState<AutofillStyle>("expected");
  const [autofillUndo, setAutofillUndo] = useState<{ ids: number[]; label: string } | null>(
    null
  );
  const [removed, setRemoved] = useState<
    { label: string; lines: { moves: string[]; name: string; openingId: number | null }[] } | null
  >(null);

  const [notes, setNotes] = useState<Record<string, string>>({});
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [positionNoteOpen, setPositionNoteOpen] = useState(false);
  const [positionNoteDraft, setPositionNoteDraft] = useState("");

  const epdParam = params.get("epd") || "";
  const pathParam = params.get("path") || "";
  const lineParam = params.get("line") || "";
  const afterParam = params.get("after") || "";
  const search = params.toString();

  useEffect(() => {
    setData(null);
    setError("");
    setExtra([]);
    setNextOffset(null);
    setHasMore(false);
    setAutofillUndo(null);
    setRemoved(null);
    setNoteFor(null);
    setPositionNoteOpen(false);
  }, [key]);

  useEffect(() => {
    let alive = true;
    const query = new URLSearchParams();
    if (epdParam) query.set("epd", epdParam);
    else if (pathParam) query.set("path", pathParam.split(/[,\s]+/).filter(Boolean).join(" "));
    else if (lineParam) query.set("line", lineParam);
    else if (afterParam) query.set("after", afterParam);
    query.set("limit", String(PAGE_SIZE));
    api
      .get<GapData>(`/repertoires/${key}/gap?${query.toString()}`)
      .then((result) => {
        if (!alive) return;
        setData(result);
        setExtra([]);
        setNextOffset(result.nextOffset ?? null);
        setHasMore(Boolean(result.hasMore));
        setError("");
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [key, epdParam, pathParam, lineParam, afterParam, search, nonce]);

  useEffect(() => {
    let alive = true;
    api
      .get<RepoData>(`/repertoires/${key}`)
      .then((result) => {
        if (alive) setRepo(result);
      })
      .catch(() => {
        if (alive) setRepo(null);
      });
    return () => {
      alive = false;
    };
  }, [key, nonce]);

  const position = data?.position ?? null;
  const prefix = position?.prefixMoves ?? [];
  const epd = position?.epd ?? "";
  const detail = data?.candidatePosition ?? null;

  useEffect(() => {
    if (!epd) return;
    let alive = true;
    api
      .get<{ notes: Note[] }>(`/repertoires/${key}/notes?epd=${encodeURIComponent(epd)}`)
      .then((result) => {
        if (!alive) return;
        const map: Record<string, string> = {};
        for (const note of result.notes ?? []) {
          if (note.san) map[note.san] = note.note;
        }
        setNotes(map);
      })
      .catch(() => {
        if (alive) setNotes({});
      });
    return () => {
      alive = false;
    };
  }, [key, epd, nonce]);

  const refresh = () => setNonce((value) => value + 1);

  const board = useMemo(() => {
    try {
      return afterMoves(START_FEN, prefix);
    } catch {
      return { fen: position?.fen ?? START_FEN, from: "", to: "" };
    }
  }, [prefix, position?.fen]);

  const loadMore = async () => {
    if (!data || nextOffset == null || loadingMore) return;
    setLoadingMore(true);
    try {
      const query = new URLSearchParams();
      query.set("epd", data.position?.epd ?? epd);
      query.set("limit", String(PAGE_SIZE));
      query.set("offset", String(nextOffset));
      const result = await api.get<GapData>(
        `/repertoires/${key}/gap?${query.toString()}`
      );
      setExtra((current) => [...current, ...(result.candidates ?? [])]);
      setNextOffset(result.nextOffset ?? null);
      setHasMore(Boolean(result.hasMore));
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setLoadingMore(false);
    }
  };

  const branchLines = (san: string) =>
    (repo?.lines ?? []).filter(
      (line) =>
        line.moves.length > prefix.length &&
        prefix.every((move, index) => line.moves[index] === move) &&
        line.moves[prefix.length] === san
    );

  const openCandidate = async (candidate: Candidate) => {
    if (busy || !position) return;
    if (!candidate.playable) {
      toast("This move is excluded. Re-enable it first.", "info");
      return;
    }
    const lines = branchLines(candidate.san);
    if (candidate.saved || lines.length) {
      const moves = lines[0]?.moves ?? [...prefix, candidate.san];
      navigate(`/build/${key}?path=${moves.slice(0, prefix.length + 1).join(",")}`);
      return;
    }
    setBusy(true);
    try {
      const result = await api.post<{ line: Line }>(`/repertoires/${key}/moves`, {
        epd: position.epd,
        san: candidate.san,
      });
      toast(`Added ${candidate.san}${candidate.name ? ` (${candidate.name})` : ""}`, "ok");
      const moves = result.line?.moves?.length ? result.line.moves : [...prefix, candidate.san];
      navigate(`/build/${key}?path=${moves.join(",")}`);
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };

  const removeBranch = async (candidate: Candidate) => {
    const lines = branchLines(candidate.san);
    if (!lines.length) {
      toast("No saved lines contain this move.", "info");
      return;
    }
    if (
      !window.confirm(
        `Remove ${candidate.san} from this position? This deletes ${lines.length} saved line${
          lines.length === 1 ? "" : "s"
        } that contain the move (review state is not restored by undo).`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const snapshot = lines.map((line) => ({
        moves: [...line.moves],
        name: line.name,
        openingId: line.openingId,
      }));
      await Promise.all(lines.map((line) => api.delete(`/lines/${line.id}`)));
      setRemoved({ label: `${candidate.san} branch`, lines: snapshot });
      toast(`Removed ${lines.length} line${lines.length === 1 ? "" : "s"}`, "info");
      refresh();
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };

  const undoRemove = async () => {
    if (!removed) return;
    setBusy(true);
    try {
      for (const line of removed.lines) {
        await api.post(`/repertoires/${key}/lines`, {
          moves: line.moves,
          name: line.name,
        });
      }
      toast("Branch restored", "ok");
      setRemoved(null);
      refresh();
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };

  const exclude = async (san: string) => {
    if (!position) return;
    setBusy(true);
    try {
      await api.post(`/repertoires/${key}/exclusions`, { epd: position.epd, san });
      toast(`${san} excluded from autofill and suggestions`, "info");
      refresh();
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };

  const reenable = async (san: string) => {
    if (!position) return;
    setBusy(true);
    try {
      await api.delete(
        `/repertoires/${key}/exclusions?epd=${encodeURIComponent(
          position.epd
        )}&san=${encodeURIComponent(san)}`
      );
      toast(`${san} re-enabled`, "ok");
      refresh();
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };

  const autofill = async () => {
    if (!position) return;
    setBusy(true);
    try {
      const result = await api.post<AutofillResponse>(
        `/repertoires/${key}/autofill`,
        { epd: position.epd, style, maxMoves: 1 }
      );
      const created = result.inserted.filter((item) => item.created !== false);
      if (created.length) {
        setAutofillUndo({
          ids: created.map((item) => item.lineId),
          label: `${created.length} autofilled move${created.length === 1 ? "" : "s"}`,
        });
        toast(
          `${created.length} move${created.length === 1 ? "" : "s"} added to this gap (${STYLE_LABELS[style]})`,
          "ok"
        );
      } else {
        const reason = result.skipped?.[0]?.reason;
        toast(
          reason === "no-captured-report"
            ? "No captured candidate data is available for this position."
            : reason === "not-your-turn"
              ? "Autofill only adds moves at positions where it is your turn."
              : "No missing moves to fill at this gap.",
          "info"
        );
      }
      refresh();
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };

  const undoAutofill = async () => {
    if (!autofillUndo) return;
    setBusy(true);
    try {
      await Promise.all(autofillUndo.ids.map((id) => api.delete(`/lines/${id}`)));
      toast("Autofill undone", "ok");
      setAutofillUndo(null);
      refresh();
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };

  const nextGapInLine = async () => {
    if (!data?.gap?.id || !position) return;
    setBusy(true);
    try {
      const result = await api.get<{ gaps: GapSummary[] }>(
        `/repertoires/${key}/gaps?lineId=${data.gap.id}&limit=200`
      );
      const gaps = result.gaps ?? [];
      const index = gaps.findIndex((gap) => gap.epd === position.epd);
      if (gaps.length <= 1 || index === -1) {
        toast("This line has no other gap.", "info");
        return;
      }
      const next = gaps[(index + 1) % gaps.length];
      if (!next || next.epd === position.epd) {
        toast("This line has no other gap.", "info");
        return;
      }
      navigate(`/gap/${key}?epd=${encodeURIComponent(next.epd)}`);
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };

  const saveNote = async (san: string | null, text: string) => {
    if (!position) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { epd: position.epd, note: text.trim() };
      if (san) body.san = san;
      await putNote(`/repertoires/${key}/notes`, body);
      toast(text.trim() ? "Note saved" : "Note cleared", "ok");
      setNoteFor(null);
      setPositionNoteOpen(false);
      refresh();
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className="cb-splash">
        <p>{error}</p>
        <Link className="cb-btn" to={`/build/${key}`}>
          Back to build
        </Link>
      </div>
    );
  }
  if (!data) return <Splash label="Finding your biggest gap…" />;

  const { repertoire, gap } = data;
  const candidates = [...(data.candidates ?? []), ...extra];
  const heading = position?.heading ?? null;
  const lastMove = prefix.length ? { from: board.from, to: board.to } : null;
  const isYourTurn = detail?.isYourTurn ?? position?.side === repertoire.color;
  const moveLabel =
    heading?.nextMove?.label ??
    `${position?.moveNumber ?? 1}${(position?.side ?? repertoire.color) === "white" ? "." : "…"}`;
  const lineName = gap?.name ?? (prefix.length ? pgnFromPath(prefix) : repertoire.name);
  const coverage = position?.coverage;
  const positionNote = position?.note;
  const annotations = position?.annotations ?? [];
  const bestMissing = position?.bestMissing;
  const currentEpd = position?.epd ?? "";

  return (
    <div className="cb-app">
      <main className="cb-main">
        <section className="cb-board-col">
          <BoardHeader
            items={[
              { label: repertoire.name, to: `/repertoire/${key}` },
              { label: "Build", to: `/build/${key}` },
              { label: `${repertoire.completion}% complete` },
            ]}
          />
          <Board
            fen={position?.fen ?? board.fen}
            orientation={repertoire.color}
            lastMove={lastMove}
          />
          <div className="cb-board-footer cb-board-footer-line">
            <span className="cb-board-opening" title={lineName ?? ""}>
              {lineName ?? "No gaps"}
            </span>
            <span className="cb-line-moves">
              {prefix.length === 0 ? (
                <span className="cb-row-meta">Start position</span>
              ) : (
                prefix.map((san, index) => (
                  <span key={`${san}-${index}`} className={index === prefix.length - 1 ? "current" : ""}>
                    {index % 2 === 0 && <em>{index / 2 + 1}.</em>} {san}{" "}
                  </span>
                ))
              )}
            </span>
            <a
              href={`https://lichess.org/analysis/standard/${encodeURIComponent(
                (position?.fen ?? board.fen).split(" ")[0]
              )}`}
              target="_blank"
              rel="noreferrer"
            >
              Analyze <i className="fa fa-up-right-from-square" aria-hidden />
            </a>
          </div>
        </section>

        <Sidebar backTo={`/build/${key}`} backLabel="Back">
          {!position ? (
            <EmptyState
              icon="fa-circle-check"
              title="No gaps left"
              action={
                <Link className="cb-btn primary" to={`/practice/${key}`}>
                  Practice this repertoire
                </Link>
              }
            >
              Every saved position has its captured candidates covered. Keep practising to raise
              mastery.
            </EmptyState>
          ) : (
            <>
              <div className="cb-page-head">
                <h1 className="cb-page-title">
                  {heading?.prompt ?? (prefix.length ? `Choose a response to ${pgnFromPath(prefix)}` : "Choose your first move")}
                </h1>
              </div>

              <p className="cb-row-meta" style={{ padding: "0 18px 10px", whiteSpace: "normal" }}>
                {position.incidence != null && position.oneIn
                  ? `This position occurs in 1 in ${position.oneIn} games`
                  : "Position incidence: not available"}
                {coverage != null
                  ? ` · Coverage ${coverage}% (${position.savedCount ?? 0} of ${
                      position.candidateCount ?? candidates.length
                    } moves)`
                  : " · Coverage: not available"}
                {bestMissing?.san
                  ? ` · Best missing: ${bestMissing.san}${
                      bestMissing.oneIn ? ` (1 in ${bestMissing.oneIn})` : ""
                    }`
                  : ""}
                {position.capturedMiss ? " · Captured biggest miss" : ""}
              </p>

              {!detail?.available && (
                <p className="cb-row-meta" style={{ padding: "0 18px 10px" }}>
                  Captured candidate data is not available for this position. Add a move from the
                  builder instead.
                </p>
              )}

              <Section
                title="Potential moves"
                action={
                  <span
                    className="cb-table-head"
                    style={{ gridTemplateColumns: "54px 44px 96px" }}
                  >
                    <span>Masters</span>
                    <span>Eval</span>
                    <span>Peer results</span>
                  </span>
                }
              >
                {candidates.map((candidate) => {
                  const lines = branchLines(candidate.san);
                  const isCovered = candidate.saved || lines.length > 0;
                  return (
                    <div className="cb-candidate" key={candidate.sanKey}>
                      <div
                        className="cb-candidate-main"
                        role="button"
                        tabIndex={0}
                        aria-disabled={!candidate.playable}
                        onClick={() => void openCandidate(candidate)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            void openCandidate(candidate);
                          }
                        }}
                        style={{
                          gridTemplateColumns: "68px minmax(0, 1fr) auto",
                          ...(candidate.excluded ? { opacity: 0.55 } : {}),
                        }}
                      >
                        <span className="cb-candidate-move">
                          {moveLabel} <strong>{candidate.san}</strong>
                        </span>
                        <span className="cb-candidate-copy">
                          <strong>
                            {candidate.name ?? candidate.friendlyName ?? "Unnamed move"}
                            {candidate.eco ? ` · ${candidate.eco}` : ""}
                          </strong>
                          <span>
                            {candidate.annotation ??
                              "No description available for this move in the capture."}
                          </span>
                          <span className="cb-row-meta" style={{ fontSize: 10 }}>
                            {expectedLabel(candidate)} ·{" "}
                            {isCovered ? "Completion: in your repertoire" : "Completion: not saved"}
                            {candidate.excluded ? " · Excluded" : ""}
                          </span>
                        </span>
                        <CandidateStats candidate={candidate} />
                      </div>

                      <div
                        className="cb-candidate-actions"
                        style={{ marginTop: 0, padding: "0 18px 10px 86px" }}
                      >
                        <button
                          type="button"
                          style={actionStyle}
                          onClick={() => {
                            setNoteFor(candidate.san);
                            setNoteDraft(notes[candidate.san] ?? "");
                          }}
                        >
                          {notes[candidate.san] ? "Edit note" : "Add a note to explain this move"}
                        </button>
                        {isCovered && (
                          <button
                            type="button"
                            style={actionStyle}
                            onClick={() => void removeBranch(candidate)}
                            disabled={busy || lines.length === 0}
                          >
                            Remove branch
                          </button>
                        )}
                        {candidate.excluded ? (
                          <button
                            type="button"
                            style={actionStyle}
                            onClick={() => void reenable(candidate.san)}
                            disabled={busy}
                          >
                            Re-enable
                          </button>
                        ) : (
                          <button
                            type="button"
                            style={actionStyle}
                            onClick={() => void exclude(candidate.san)}
                            disabled={busy}
                          >
                            Exclude from autofill
                          </button>
                        )}
                        {!isCovered && isYourTurn && (
                          <button
                            type="button"
                            style={actionStyle}
                            onClick={() => void openCandidate(candidate)}
                            disabled={busy}
                          >
                            Add to repertoire
                          </button>
                        )}
                      </div>

                      {noteFor === candidate.san && (
                        <div style={{ padding: "0 18px 12px 86px" }}>
                          <textarea
                            className="cb-textarea"
                            rows={2}
                            placeholder="Add a note to explain this move"
                            value={noteDraft}
                            onChange={(event) => setNoteDraft(event.target.value)}
                          />
                          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                            <button
                              type="button"
                              className="cb-btn primary"
                              onClick={() => void saveNote(candidate.san, noteDraft)}
                              disabled={busy}
                            >
                              Save note
                            </button>
                            <button
                              type="button"
                              className="cb-btn ghost"
                              onClick={() => setNoteFor(null)}
                            >
                              Cancel
                            </button>
                            {notes[candidate.san] && (
                              <button
                                type="button"
                                className="cb-btn ghost"
                                onClick={() => void saveNote(candidate.san, "")}
                                disabled={busy}
                              >
                                Clear
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {!candidates.length && (
                  <EmptyState title="No candidate moves">
                    No captured candidates are available for this position.
                  </EmptyState>
                )}

                <div style={{ display: "flex", gap: 16, padding: "10px 18px 0" }}>
                  {hasMore && (
                    <button
                      type="button"
                      style={actionStyle}
                      onClick={() => void loadMore()}
                      disabled={loadingMore}
                    >
                      {loadingMore ? "Loading…" : "Show more"}
                    </button>
                  )}
                  <button
                    type="button"
                    style={actionStyle}
                    onClick={() => {
                      setPositionNoteDraft(positionNote?.note ?? "");
                      setPositionNoteOpen((value) => !value);
                    }}
                  >
                    {positionNote ? "Edit notes" : "Add / edit notes"}
                  </button>
                </div>
              </Section>

              {positionNoteOpen && (
                <div style={{ padding: "0 18px 12px" }}>
                  <textarea
                    className="cb-textarea"
                    rows={3}
                    placeholder="Add / edit notes for this position"
                    value={positionNoteDraft}
                    onChange={(event) => setPositionNoteDraft(event.target.value)}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <button
                      type="button"
                      className="cb-btn primary"
                      onClick={() => void saveNote(null, positionNoteDraft)}
                      disabled={busy}
                    >
                      Save note
                    </button>
                    <button
                      type="button"
                      className="cb-btn ghost"
                      onClick={() => setPositionNoteOpen(false)}
                    >
                      Cancel
                    </button>
                    {positionNote && (
                      <button
                        type="button"
                        className="cb-btn ghost"
                        onClick={() => void saveNote(null, "")}
                        disabled={busy}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              )}

              {positionNote && !positionNoteOpen && (
                <p
                  className="cb-row-meta"
                  style={{ padding: "0 18px 10px", whiteSpace: "pre-wrap" }}
                >
                  {positionNote.note}
                </p>
              )}

              {annotations.length > 0 && (
                <Section title="Captured annotations">
                  {annotations.map((annotation, index) => (
                    <p
                      key={annotation.id ?? index}
                      className="cb-row-meta"
                      style={{ padding: "0 18px 8px", whiteSpace: "pre-wrap" }}
                    >
                      {annotation.san ? `${annotation.san}: ` : ""}
                      {annotation.text}
                    </p>
                  ))}
                </Section>
              )}

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "12px 18px 8px" }}>
                {STYLE_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`cb-tab ${style === option ? "active" : ""}`}
                    onClick={() => setStyle(option)}
                  >
                    {STYLE_LABELS[option]}
                  </button>
                ))}
              </div>

              <Section>
                <Row
                  title="Autofill this gap"
                  meta={`Pick a style, undo anytime · ${STYLE_LABELS[style]}`}
                  onClick={() => void autofill()}
                  right={<i className="fa fa-wand-magic-sparkles" aria-hidden />}
                  disabled={busy}
                />
                {autofillUndo && (
                  <Row
                    title={`Undo autofill (${autofillUndo.label})`}
                    meta="Removes the lines that were just added"
                    onClick={() => void undoAutofill()}
                    disabled={busy}
                  />
                )}
                {removed && (
                  <Row
                    title={`Undo remove (${removed.label})`}
                    meta="Recreates the deleted line moves; review state is not restored"
                    onClick={() => void undoRemove()}
                    disabled={busy}
                  />
                )}
                <Row
                  title="Build from here"
                  meta={
                    prefix.length ? `Open this exact gap position (${pgnFromPath(prefix)})` : "Open this gap in the builder"
                  }
                  onClick={() => navigate(`/build/${key}?epd=${encodeURIComponent(currentEpd)}`)}
                />
                <Row
                  title="Practice this line"
                  meta={
                    gap?.name
                      ? `Practice the saved line: ${gap.name}`
                      : "No saved line reaches this gap yet"
                  }
                  onClick={() =>
                    gap?.id &&
                    navigate(
                      `/practice/${key}?mode=line&line=${gap.id}&epd=${encodeURIComponent(currentEpd)}`
                    )
                  }
                  disabled={!gap?.id}
                />
                <Row
                  title="Go to the next gap in this line"
                  meta="Follow the ranked gaps for this saved line"
                  onClick={() => void nextGapInLine()}
                  disabled={busy || !gap?.id}
                />
              </Section>
            </>
          )}
        </Sidebar>
      </main>
    </div>
  );
}
