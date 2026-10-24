import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import type { Line, Opening, Repertoire } from "../types";
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
 * Builder contract (D023/D060/D067):
 *
 *   /build/:key?line=<id>       open the position before the line's last move
 *   /build/:key?path=e4,c5      open the position after those moves
 *   /build/:key?epd=<epd>       open an exact captured/known position
 *
 * `?line=` is what the practice screen links to ("View in build mode"); it is
 * resolved by the server so the board opens on the position being quizzed.
 */

const START_EPD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";
const PAGE_STYLES = ["expected", "aggressive", "solid", "learnable", "sharp"] as const;
type AutofillStyle = (typeof PAGE_STYLES)[number];

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
  duePositions?: number;
  coverage?: number | null;
  coveragePercent?: number | null;
}

interface RepoData {
  repertoire: RepStats;
  lines: Line[];
}

interface MasterResults {
  white: number;
  draw: number;
  black: number;
  games: number;
  share: number;
  whiteWins?: number;
  draws?: number;
  blackWins?: number;
}

interface PeerSplit {
  white: number;
  draw: number;
  black: number;
}

interface PeerResults extends PeerSplit {
  games: number;
  whiteWins?: number;
  draws?: number;
  blackWins?: number;
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

interface SavedMove {
  san: string;
  lineId: number;
  lineMoveId: number;
  lineName: string;
  ply: number;
  learned: boolean;
  dueAt: string | null;
  reps: number;
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

interface PositionDetail {
  epd: string;
  fen: string;
  side: "white" | "black";
  repertoireSide: "white" | "black" | null;
  isYourTurn: boolean | null;
  prefixMoves: string[];
  moveNumber: number;
  parentLineId: number | null;
  parentLineName: string | null;
  available: boolean;
  complete: boolean | null;
  source: string | null;
  stockfish: { eval: number | null; mate: number | null; pawns: number | null; available: boolean };
  savedMoves: SavedMove[];
  excludedMoves: string[];
  heading: PositionHeading;
  note: Note | null;
  annotations: Annotation[];
  total?: number;
  hasMore?: boolean;
  nextOffset?: number | null;
}

interface CandidatesResponse {
  repertoire: RepStats;
  position: PositionDetail;
  line: Line | null;
  candidates: Candidate[];
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
  available: boolean;
  stats: RepStats;
}

interface AutofillInserted {
  epd: string;
  san: string;
  name: string | null;
  lineId: number;
  created: boolean;
  rank?: number;
}

interface AutofillResponse {
  filled: number;
  considered: number;
  inserted: AutofillInserted[];
  skipped: { san?: string; epd?: string; reason?: string }[];
  style: AutofillStyle;
  styleSource?: string;
  dryRun?: boolean;
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

/** Notes use PUT, which the tiny api helper does not expose. */
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

export function BuildPage() {
  const { key = "white" } = useParams<{ key: string }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [repo, setRepo] = useState<RepoData | null>(null);
  const [candidateData, setCandidateData] = useState<CandidatesResponse | null>(null);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState(false);

  const [showAlt, setShowAlt] = useState(false);
  const [query, setQuery] = useState("");
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [searching, setSearching] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [pgn, setPgn] = useState("");
  const [lineName, setLineName] = useState("");

  const [style, setStyle] = useState<AutofillStyle>("expected");
  const [autofillUndo, setAutofillUndo] = useState<
    { ids: number[]; label: string } | null
  >(null);
  const [removed, setRemoved] = useState<
    { label: string; lines: { moves: string[]; name: string; openingId: number | null }[] } | null
  >(null);

  const [notes, setNotes] = useState<Record<string, string>>({});
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [positionNoteOpen, setPositionNoteOpen] = useState(false);
  const [positionNoteDraft, setPositionNoteDraft] = useState("");

  const [plansOpen, setPlansOpen] = useState(false);
  const [plans, setPlans] = useState<{
    available: boolean;
    position?: {
      annotations: Annotation[];
      plans: string[];
      plansAvailable: boolean;
      fullName: string | null;
      name: string | null;
    };
  } | null>(null);
  const [plansError, setPlansError] = useState("");

  const pathParam = params.get("path") || "";
  const hasPathParam = params.has("path");
  const epdParam = params.get("epd") || "";
  const lineParam = params.get("line") || "";
  const plyParam = params.get("ply") || "";
  const search = params.toString();

  const path = useMemo(
    () => pathParam.split(/[,\s]+/).map((move) => move.trim()).filter(Boolean),
    [pathParam]
  );

  useEffect(() => {
    setRepo(null);
    setCandidateData(null);
    setError("");
    setRemoved(null);
    setAutofillUndo(null);
    setPlansOpen(false);
    setNoteFor(null);
    setPositionNoteOpen(false);
  }, [key]);

  useEffect(() => {
    let alive = true;
    api
      .get<RepoData>(`/repertoires/${key}`)
      .then((data) => {
        if (alive) {
          setRepo(data);
          setError("");
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [key, nonce]);

  useEffect(() => {
    let alive = true;
    const searchParams = new URLSearchParams();
    if (epdParam) {
      searchParams.set("epd", epdParam);
    } else if (hasPathParam) {
      // An explicit empty `path` is the start position. Practice sends
      // ?path=&line=<id> for a task at the root, so `path` must win over `line`.
      if (path.length) searchParams.set("path", path.join(" "));
    } else if (lineParam) {
      searchParams.set("line", lineParam);
      if (plyParam) searchParams.set("ply", plyParam);
    }
    const url = `/repertoires/${key}/candidates${
      searchParams.toString() ? `?${searchParams.toString()}` : ""
    }`;
    api
      .get<CandidatesResponse>(url)
      .then((data) => {
        if (!alive) return;
        setCandidateData(data);
        setError("");
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [key, epdParam, pathParam, hasPathParam, lineParam, plyParam, search, nonce, path]);

  const position = candidateData?.position ?? null;
  const prefix = position?.prefixMoves ?? path;
  const epd = position?.epd ?? "";

  useEffect(() => {
    if (!epd) return;
    let alive = true;
    api
      .get<{ notes: Note[] }>(`/repertoires/${key}/notes?epd=${encodeURIComponent(epd)}`)
      .then((data) => {
        if (!alive) return;
        const map: Record<string, string> = {};
        for (const note of data.notes ?? []) {
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

  useEffect(() => {
    if (!showAlt || !query.trim()) {
      setOpenings([]);
      return;
    }
    let alive = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      api
        .get<{ openings: Opening[] }>(
          `/openings?q=${encodeURIComponent(query.trim())}&side=${
            repo?.repertoire.color ?? "white"
          }&prefix=${encodeURIComponent(prefix.join(" "))}&limit=50`
        )
        .then((r) => {
          if (alive) setOpenings(r.openings ?? []);
        })
        .catch(() => {
          if (alive) setOpenings([]);
        })
        .finally(() => {
          if (alive) setSearching(false);
        });
    }, 200);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query, showAlt, repo?.repertoire.color, prefix]);

  useEffect(() => {
    if (!plansOpen || !epd) return;
    let alive = true;
    setPlansError("");
    api
      .get<{
        available: boolean;
        position?: {
          annotations: Annotation[];
          plans: string[];
          plansAvailable: boolean;
          fullName: string | null;
          name: string | null;
        };
      }>(`/openings/position?epd=${encodeURIComponent(epd)}`)
      .then((data) => {
        if (alive) setPlans(data);
      })
      .catch((e) => {
        if (alive) setPlansError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [plansOpen, epd]);

  useEffect(() => {
    if (!plansOpen) return;
    document.getElementById("cb-build-plans")?.scrollIntoView({ block: "nearest" });
  }, [plansOpen]);

  const refresh = () => setNonce((value) => value + 1);

  const board = useMemo(() => {
    try {
      return afterMoves(START_FEN, prefix);
    } catch {
      return { fen: position?.fen ?? START_FEN, from: "", to: "" };
    }
  }, [prefix, position?.fen]);

  const branchLines = (san: string) =>
    (repo?.lines ?? []).filter(
      (line) =>
        line.moves.length > prefix.length &&
        prefix.every((move, index) => line.moves[index] === move) &&
        line.moves[prefix.length] === san
    );

  const coveredSan = (san: string) => branchLines(san).length > 0;
  const covered = (candidate: Candidate) => candidate.saved || coveredSan(candidate.san);

  const practiceTarget = useMemo(() => {
    if (!repo || !position) return null;
    const withSavedMove = candidateData?.candidates.find((candidate) => candidate.lineId);
    if (withSavedMove?.lineId) {
      return { id: withSavedMove.lineId, name: withSavedMove.lineName ?? "saved line" };
    }
    const through = repo.lines.find(
      (line) =>
        line.moves.length >= prefix.length &&
        prefix.every((move, index) => line.moves[index] === move)
    );
    return through ? { id: through.id, name: through.name } : null;
  }, [repo, position, candidateData?.candidates, prefix]);

  const forwardSan = useMemo(() => {
    if (!repo) return null;
    for (const line of repo.lines) {
      if (
        line.moves.length > prefix.length &&
        prefix.every((move, index) => line.moves[index] === move)
      ) {
        return line.moves[prefix.length];
      }
    }
    return null;
  }, [repo, prefix]);

  const setPath = (next: string[]) => {
    const paramsNext = new URLSearchParams(params);
    if (next.length) paramsNext.set("path", next.join(","));
    else paramsNext.delete("path");
    paramsNext.delete("line");
    paramsNext.delete("ply");
    paramsNext.delete("epd");
    paramsNext.delete("add");
    setParams(paramsNext, { replace: true });
  };

  const positionQuery = () =>
    epd ? `epd=${encodeURIComponent(epd)}` : `path=${prefix.join(",")}`;

  const addCandidate = async (candidate: Candidate) => {
    setBusy(true);
    try {
      let moves: string[] = [...prefix, candidate.san];
      try {
        const result = await api.post<{ line: Line }>(`/repertoires/${key}/moves`, {
          epd: position?.epd,
          san: candidate.san,
        });
        if (result.line?.moves?.length) moves = result.line.moves;
        toast(`Added ${candidate.san}${candidate.name ? ` (${candidate.name})` : ""}`, "ok");
      } catch {
        // The position is not inside a saved line yet (a previewed opponent
        // move, or a move beyond the current branches). Saving the whole path
        // as a line is the server-supported fallback.
        const result = await api.post<{ line: Line }>(`/repertoires/${key}/lines`, {
          moves: [...prefix, candidate.san],
        });
        if (result.line?.moves?.length) moves = result.line.moves;
        toast(`Added ${candidate.san}`, "ok");
      }
      refresh();
      setPath(moves);
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };

  const openCandidate = async (candidate: Candidate) => {
    if (busy) return;
    if (!candidate.playable) {
      toast("This move is excluded. Re-enable it first.", "info");
      return;
    }
    const isCovered = covered(candidate);
    if (isCovered || !position?.isYourTurn) {
      setPath([...prefix, candidate.san]);
      return;
    }
    await addCandidate(candidate);
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

  const runAutofill = async (options: {
    fromStart?: boolean;
    allFromHere?: boolean;
    maxMoves?: number;
  }) => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        style,
        maxMoves: options.maxMoves ?? 1,
      };
      if (options.allFromHere) body.allFromHere = true;
      body.epd = options.fromStart ? START_EPD : position?.epd;
      const result = await api.post<AutofillResponse>(
        `/repertoires/${key}/autofill`,
        body
      );
      const created = result.inserted.filter((item) => item.created !== false);
      if (created.length) {
        setAutofillUndo({
          ids: created.map((item) => item.lineId),
          label: `${created.length} autofilled move${created.length === 1 ? "" : "s"}`,
        });
        toast(
          `${created.length} move${created.length === 1 ? "" : "s"} added (${STYLE_LABELS[style]})`,
          "ok"
        );
      } else {
        const reason = result.skipped?.[0]?.reason;
        const message =
          reason === "not-your-turn"
            ? "Autofill only adds moves at positions where it is your turn."
            : reason === "no-captured-report"
              ? "No captured candidate data is available for this position."
              : "No missing moves to fill at this position.";
        toast(message, "info");
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

  const addOpening = async (opening: Opening) => {
    setBusy(true);
    try {
      const result = await api.post<{ line: Line; created: boolean }>(
        `/repertoires/${key}/lines`,
        { openingId: opening.id }
      );
      toast(
        result.created
          ? `Added ${opening.name}`
          : `${opening.name} is already in this repertoire`,
        result.created ? "ok" : "info"
      );
      setShowAlt(false);
      setQuery("");
      setOpenings([]);
      refresh();
      if (result.line?.moves?.length) setPath(result.line.moves);
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
      const result = await api.post<{ line: Line; created: boolean }>(
        `/repertoires/${key}/lines`,
        { pgn, name: lineName || undefined }
      );
      toast(result.created ? "Line imported" : "Line already exists", result.created ? "ok" : "info");
      setShowImport(false);
      setPgn("");
      setLineName("");
      refresh();
      if (result.line?.moves?.length) setPath(result.line.moves);
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
        <Link className="cb-btn" to={`/repertoire/${key}`}>
          Back to repertoire
        </Link>
      </div>
    );
  }
  if (!repo || !candidateData || !position) return <Splash label="Loading builder…" />;

  const { repertoire, lines } = repo;
  const candidates = candidateData.candidates ?? [];
  const heading = position.heading;
  const moveLabel = heading?.nextMove?.label ?? `${position.moveNumber}${position.side === "white" ? "." : "…"}`;
  const lastMove = prefix.length ? { from: board.from, to: board.to } : null;
  const savedCount = candidates.filter((candidate) => covered(candidate)).length;
  const coverage =
    candidates.length > 0 ? Math.round((savedCount / candidates.length) * 100) : null;
  const positionNote = position.note;
  const lineForBoard =
    candidateData.line ??
    lines.find(
      (line) =>
        line.moves.length >= prefix.length &&
        prefix.every((move, index) => line.moves[index] === move)
    ) ??
    null;

  const altResults = openings.filter((opening) => {
    if (!prefix.every((move, index) => opening.moves[index] === move)) return false;
    const san = opening.moves[prefix.length];
    if (!san) return false;
    if (coveredSan(san)) return false;
    if (candidates.some((candidate) => candidate.san === san)) return false;
    return true;
  });
  const uniqueAlt = [...new Map(altResults.map((opening) => [opening.moves[prefix.length], opening])).values()];

  return (
    <div className="cb-app">
      <main className="cb-main">
        <section className="cb-board-col">
          <BoardHeader
            items={[
              { label: repertoire.name, to: `/repertoire/${key}` },
              { label: "Build" },
              { label: `${repertoire.completion}% complete` },
            ]}
          />
          <Board fen={position.fen || board.fen} orientation={repertoire.color} lastMove={lastMove} />
          <div className={`cb-board-footer cb-board-footer-line ${prefix.length ? "visible" : ""}`}>
            <span
              className="cb-board-opening"
              title={position.parentLineName ?? lineForBoard?.name ?? repertoire.name}
            >
              {position.parentLineName ?? lineForBoard?.name ?? repertoire.name}
            </span>
            <span className="cb-line-moves">
              {prefix.length === 0 ? (
                <span className="cb-row-meta">Start position</span>
              ) : (
                prefix.map((san, index) => (
                  <button
                    key={`${san}-${index}`}
                    type="button"
                    className={index === prefix.length - 1 ? "current" : ""}
                    onClick={() => setPath(prefix.slice(0, index + 1))}
                    style={{
                      background: "none",
                      border: 0,
                      padding: 0,
                      color: "inherit",
                      font: "inherit",
                      cursor: "pointer",
                    }}
                  >
                    {index % 2 === 0 && <em>{index / 2 + 1}.</em>} {san}{" "}
                  </button>
                ))
              )}
            </span>
            <button
              type="button"
              className="cb-link"
              onClick={() => setPlansOpen((value) => !value)}
            >
              Plans
            </button>
            <a
              href={`https://lichess.org/analysis/standard/${encodeURIComponent(
                (position.fen || board.fen).split(" ")[0]
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
            <h1 className="cb-page-title">Continue building</h1>
          </div>

          <div className="cb-progress-line">
            <div className="cb-progress-copy">
              <strong>{repertoire.completion}% complete</strong>
              <button
                type="button"
                className="cb-link"
                onClick={() => runAutofill({ fromStart: true, allFromHere: true })}
                disabled={busy}
              >
                Autofill remaining gaps <i className="fa fa-wand-magic-sparkles" aria-hidden />
              </button>
            </div>
            <div className="cb-bar">
              <span style={{ width: `${repertoire.completion}%` }} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "0 18px 8px" }}>
            {PAGE_STYLES.map((option) => (
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
          <p
            className="cb-row-meta"
            style={{ padding: "0 18px 10px", whiteSpace: "normal" }}
          >
            Style scores are heuristics over the captured play rate, eval, master/peer results
            and annotations. Undo is available after each autofill.
          </p>

          <div className="cb-build-back" style={{ display: "flex", gap: 16 }}>
            <button
              type="button"
              className="cb-link"
              onClick={() => setPath(prefix.slice(0, -1))}
              disabled={prefix.length === 0}
              style={{ opacity: prefix.length ? 1 : 0.5 }}
            >
              <i className="fa fa-arrow-left" aria-hidden /> Back
            </button>
            <button
              type="button"
              className="cb-link"
              onClick={() => {
                const candidate = candidates.find((item) => item.san === forwardSan);
                if (candidate) void openCandidate(candidate);
                else if (forwardSan) setPath([...prefix, forwardSan]);
              }}
              disabled={!forwardSan}
              style={{ opacity: forwardSan ? 1 : 0.5 }}
            >
              Forward <i className="fa fa-arrow-right" aria-hidden />
            </button>
          </div>

          <Section
            title={heading?.prompt ?? (prefix.length ? "Potential moves" : "Your first move")}
            action={
              <span className="cb-table-head" style={{ gridTemplateColumns: "54px 44px 96px" }}>
                <span>Masters</span>
                <span>Eval</span>
                <span>Peer results</span>
              </span>
            }
          >
            {!position.available && (
              <p className="cb-row-meta" style={{ padding: "0 18px 10px" }}>
                Captured candidate data is not available for this position. Search the opening
                database below to add a move.
              </p>
            )}

            {candidates.map((candidate) => {
              const isCovered = covered(candidate);
              const lineIds = branchLines(candidate.san).map((line) => line.id);
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
                        {isCovered
                          ? "In your repertoire"
                          : position.isYourTurn
                            ? "Not saved yet"
                            : "Preview only"}
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
                        disabled={busy || lineIds.length === 0}
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
                    {!isCovered && position.isYourTurn && (
                      <button
                        type="button"
                        style={actionStyle}
                        onClick={() => void addCandidate(candidate)}
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

            {!candidates.length && position.available && (
              <EmptyState title="No candidates for this position">
                The captured list is empty. Add an alternative move below.
              </EmptyState>
            )}

            <Row
              title="Add an alternative move"
              meta="Shows the ranked candidates and a prefix-filtered database search"
              onClick={() => setShowAlt((value) => !value)}
              className="cb-build-alt-row"
            />
            <Row
              title="Go to your biggest gap"
              onClick={() => navigate(`/gap/${key}`)}
              className="cb-build-gap-row"
            />
          </Section>

          {showAlt && (
            <Section title="Add an alternative move">
              <p className="cb-row-meta" style={{ padding: "0 18px 10px" }}>
                Every captured candidate for this position is listed above. Use the search only
                for a move that is missing from the capture; results are limited to lines that
                continue {prefix.length ? pgnFromPath(prefix) : "the start position"}.
              </p>
              <div className="cb-search" style={{ padding: "0 18px 10px" }}>
                <i className="fa fa-search" aria-hidden />
                <input
                  className="cb-input"
                  placeholder="Search an opening or ECO (e.g. Sicilian, B90)"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              {searching && <div className="cb-skeleton" style={{ margin: 12 }} />}
              {!query.trim() && (
                <p className="cb-row-meta" style={{ padding: "0 18px 10px" }}>
                  Type at least part of an opening name to search the database.
                </p>
              )}
              {!searching && query.trim() && uniqueAlt.length === 0 && (
                <p className="cb-row-meta" style={{ padding: "0 18px 10px" }}>
                  No database line continues this position with an unsaved move.
                </p>
              )}
              <div className="cb-openings-scroll" style={{ maxHeight: 240 }}>
                {uniqueAlt.map((opening) => (
                  <button
                    type="button"
                    key={opening.id}
                    className="cb-opening-row"
                    onClick={() => void addOpening(opening)}
                    disabled={busy}
                  >
                    <span className="cb-opening-main">
                      <strong>
                        {opening.moves[prefix.length]} — {opening.name}
                      </strong>
                      <span>
                        {opening.eco} · {opening.pgn}
                      </span>
                    </span>
                    <i className="fa fa-plus" aria-hidden />
                  </button>
                ))}
              </div>
              <Row
                title="Import a line as PGN"
                meta="Paste a game or a single line"
                onClick={() => setShowImport((value) => !value)}
              />
              {showImport && (
                <div style={{ padding: "0 18px 12px" }}>
                  <div className="cb-field">
                    <label htmlFor="build-pgn-name">Line name</label>
                    <input
                      id="build-pgn-name"
                      className="cb-input"
                      placeholder="e.g. My Sicilian line"
                      value={lineName}
                      onChange={(event) => setLineName(event.target.value)}
                    />
                  </div>
                  <div className="cb-field">
                    <label htmlFor="build-pgn">PGN</label>
                    <textarea
                      id="build-pgn"
                      className="cb-textarea"
                      placeholder="1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6"
                      value={pgn}
                      onChange={(event) => setPgn(event.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    className="cb-btn primary"
                    onClick={() => void importPgn()}
                    disabled={busy || !pgn.trim()}
                  >
                    Import line
                  </button>
                </div>
              )}
            </Section>
          )}

          <Section>
            <Row
              title="Autofill remaining gaps"
              meta={`Style: ${STYLE_LABELS[style]} — from this repertoire's biggest gaps`}
              onClick={() => runAutofill({ fromStart: true, allFromHere: true })}
              right={<i className="fa fa-wand-magic-sparkles" aria-hidden />}
              disabled={busy}
            />
            <Row
              title="Autofill all moves from here"
              meta={
                position.isYourTurn
                  ? `Add up to five ${STYLE_LABELS[style].toLowerCase()} moves from this position`
                  : "Only available where it is your move"
              }
              onClick={() => runAutofill({ allFromHere: true, maxMoves: 5 })}
              disabled={busy || !position.isYourTurn}
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
                prefix.length
                  ? `Open this exact position (${pgnFromPath(prefix)})`
                  : "This is the start position"
              }
              onClick={() => navigate(`/build/${key}?${positionQuery()}`)}
            />
            <Row
              title="Practice from here"
              meta={
                practiceTarget
                  ? `Practice the saved line: ${practiceTarget.name}`
                  : "No saved line reaches this position yet"
              }
              onClick={() =>
                practiceTarget &&
                navigate(
                  `/practice/${key}?mode=line&line=${practiceTarget.id}&epd=${encodeURIComponent(epd)}`
                )
              }
              disabled={!practiceTarget}
            />
          </Section>

          <Section
            title="Position note"
            action={
              <button
                type="button"
                className="cb-link"
                onClick={() => {
                  setPositionNoteDraft(positionNote?.note ?? "");
                  setPositionNoteOpen((value) => !value);
                }}
              >
                {positionNote ? "Edit" : "Add note"}
              </button>
            }
          >
            {!positionNoteOpen && (
              <p
                className="cb-row-meta"
                style={{ padding: "0 18px 12px", whiteSpace: "pre-wrap" }}
              >
                {positionNote?.note ?? "No notes added for this position."}
              </p>
            )}
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
          </Section>

          <Section title="Coverage">
            <div className="cb-stat-grid" style={{ padding: "0 18px 12px" }}>
              <div className="cb-stat">
                <div className="cb-stat-value">{coverage == null ? "—" : `${coverage}%`}</div>
                <div className="cb-stat-label">Moves covered</div>
                <div className="cb-stat-hint">
                  {position.available
                    ? `${savedCount} of ${candidates.length} captured candidates`
                    : "Not available for this position"}
                </div>
              </div>
              <div className="cb-stat">
                <div className="cb-stat-value">{position.available ? candidates.length : "—"}</div>
                <div className="cb-stat-label">Candidates</div>
                <div className="cb-stat-hint">Ranked by captured play rate</div>
              </div>
            </div>
          </Section>

          {plansOpen && (
            <div id="cb-build-plans">
              <Section
                title="Plans"
                action={
                  <button type="button" className="cb-link" onClick={() => setPlansOpen(false)}>
                    Hide
                  </button>
                }
              >
              {plansError && (
                <p className="cb-row-meta" style={{ padding: "0 18px 12px" }}>
                  Plans could not be loaded: {plansError}
                </p>
              )}
              {!plansError && !plans && (
                <p className="cb-row-meta" style={{ padding: "0 18px 12px" }}>
                  Loading captured plans…
                </p>
              )}
              {!plansError && plans && (
                <>
                  {plans.position?.plansAvailable && plans.position.plans.length > 0 ? (
                    <ul style={{ padding: "0 18px 12px 34px", margin: 0 }}>
                      {plans.position.plans.map((plan, index) => (
                        <li key={index} className="cb-row-meta">
                          {plan}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="cb-row-meta" style={{ padding: "0 18px 12px" }}>
                      No plans are captured for this position.
                    </p>
                  )}
                  {plans.position?.annotations?.length ? (
                    plans.position.annotations.map((annotation, index) => (
                      <p
                        key={annotation.id ?? index}
                        className="cb-row-meta"
                        style={{ padding: "0 18px 8px", whiteSpace: "pre-wrap" }}
                      >
                        {annotation.san ? `${annotation.san}: ` : ""}
                        {annotation.text}
                      </p>
                    ))
                  ) : (
                    <p className="cb-row-meta" style={{ padding: "0 18px 12px" }}>
                      No captured annotations for this position.
                    </p>
                  )}
                </>
              )}
              <Row
                title="Study plans in model games"
                meta="Kamsky–Anand and the model-game library"
                to="/model"
              />
              </Section>
            </div>
          )}
        </Sidebar>
      </main>
    </div>
  );
}
