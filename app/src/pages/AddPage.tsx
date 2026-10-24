import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import type { Color, Repertoire } from "../types";
import { Board } from "../components/Board";
import { BoardHeader, EmptyState, Row, Sidebar, Splash } from "../components/ui";
import { afterMoves, START_FEN } from "../chess";
import { useToast } from "../components/Toast";
import { getRating, getRatingBand, haptic } from "../prefs";

/* ------------------------------------------------------------------- types --- */

interface Candidate {
  rank: number;
  san: string;
  sanKey: string;
  name: string;
  eco: string | null;
  epdAfter: string;
  fenAfter: string;
  masters: number | null;
  mastersAvailable?: boolean;
  eval: number | null;
  evalAvailable?: boolean;
  probability: number | null;
  incidence: number | null;
  oneIn: number | null;
  incidenceLabel?: string | null;
  annotation?: string | null;
  description?: string | null;
  saved: boolean;
  needed: boolean;
  excluded: boolean;
  lineId: number | null;
  lineName: string | null;
  branchMoves: string[];
  branchPgn: string;
}

interface CandidatesResponse {
  repertoire: Repertoire;
  position: {
    epd: string;
    fen: string;
    side: Color;
    repertoireSide: Color;
    isYourTurn: boolean;
    prefixMoves: string[];
    moveNumber: number;
    available: boolean;
    source: string | null;
    stockfish: { eval: number | null; available: boolean };
    savedMoves: { san: string; lineId: number; lineName: string }[];
    excludedMoves: string[];
    heading: { prompt: string };
    ratingBand: { band: string | null; ratingSystem: string | null; available: boolean };
    note: string | null;
  };
  candidates: Candidate[];
  total: number;
  available: boolean;
}

interface AddResponse {
  line: { id: number; name: string; pgn: string; moves: string[] };
  repertoire: Repertoire;
  created: boolean;
  transposition: boolean;
  transpositionOf: number | null;
}

interface ImportResult {
  ok: boolean;
  imported: number;
  transpositions: number;
  total: number;
  trimmed: number;
  results: { ok: boolean; lineId?: number; moves?: number; name?: string; error?: string }[];
  repertoire: Repertoire;
}

interface Course {
  id: string;
  slug: string;
  name: string;
  side: Color;
  authorName: string | null;
  description?: string;
  moveCount: number;
  coveragePercent: number | null;
  official: boolean;
}

type Tab = "add" | "new" | "import" | "manage";

const TABS: { value: Tab; label: string; icon: string }[] = [
  { value: "add", label: "Add moves", icon: "fa-plus" },
  { value: "new", label: "New repertoire", icon: "fa-folder-plus" },
  { value: "import", label: "Import", icon: "fa-file-import" },
  { value: "manage", label: "Manage", icon: "fa-gear" },
];

/* ------------------------------------------------------------------- page --- */

export function AddPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [repertoires, setRepertoires] = useState<Repertoire[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [key, setKey] = useState(() => params.get("repertoire") ?? "");
  const [path, setPath] = useState<string[]>([]);
  const [data, setData] = useState<CandidatesResponse | null>(null);
  const [lines, setLines] = useState<{ id: number; moves: string[] }[]>([]);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [manualSan, setManualSan] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [lastAdd, setLastAdd] = useState<{
    san: string;
    pgn: string;
    saved: number;
    path: string[];
    transposition: boolean;
  } | null>(null);

  const [newColor, setNewColor] = useState<Color>(
    (params.get("color") as Color) === "black" ? "black" : "white"
  );
  const [newName, setNewName] = useState("");

  const [courses, setCourses] = useState<Course[]>([]);
  const [coursesAvailable, setCoursesAvailable] = useState<boolean | null>(null);
  const [importKey, setImportKey] = useState(() => params.get("repertoire") ?? "");
  const [importText, setImportText] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [courseNote, setCourseNote] = useState("");

  const rawTab = (params.get("tab") as Tab) ?? "add";
  const tab: Tab = TABS.some((entry) => entry.value === rawTab) ? rawTab : "add";

  const setTab = (next: Tab) => {
    const updated = new URLSearchParams(params);
    updated.set("tab", next);
    if (key) updated.set("repertoire", key);
    setParams(updated, { replace: true });
  };

  const setRepertoire = (next: string) => {
    setKey(next);
    setPath([]);
    setLastAdd(null);
    const updated = new URLSearchParams(params);
    updated.set("repertoire", next);
    setParams(updated, { replace: true });
  };

  /* ------------------------------------------------------------- loaders --- */

  useEffect(() => {
    api
      .get<{ repertoires: Repertoire[] }>("/repertoires")
      .then((response) => {
        setRepertoires(response.repertoires);
        setLoadingList(false);
        if (!key) {
          const first = response.repertoires[0];
          if (first) setKey(String(first.id));
          else {
            const updated = new URLSearchParams(params);
            updated.set("tab", "new");
            setParams(updated, { replace: true });
          }
        }
      })
      .catch((e: any) => {
        setLoadingList(false);
        setError(e.message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pathKey = path.join(" ");

  useEffect(() => {
    if (!key) return;
    let alive = true;
    setLoading(true);
    const query = path.length ? `?moves=${encodeURIComponent(path.join(" "))}` : "";
    Promise.all([
      api.get<CandidatesResponse>(`/repertoires/${key}/candidates${query}`),
      api.get<{ lines: { id: number; moves: string[] }[] }>(`/repertoires/${key}`),
    ])
      .then(([response, repertoireResponse]) => {
        if (!alive) return;
        setData(response);
        setLines(repertoireResponse.lines ?? []);
        setError("");
        setLoading(false);
      })
      .catch((e: any) => {
        if (!alive) return;
        setError(e.message);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, pathKey, version]);

  useEffect(() => {
    if (tab !== "import" || coursesAvailable !== null) return;
    api
      .get<{ courses: Course[]; available: boolean }>("/courses?limit=24")
      .then((response) => {
        setCourses(response.courses);
        setCoursesAvailable(response.available);
      })
      .catch(() => {
        setCourses([]);
        setCoursesAvailable(false);
      });
  }, [tab, coursesAvailable]);

  useEffect(() => {
    if (importKey && repertoires.some((entry) => String(entry.id) === importKey)) return;
    const preferred = key || (repertoires[0] ? String(repertoires[0].id) : "");
    if (preferred) setImportKey(preferred);
  }, [importKey, key, repertoires]);

  const repertoire = useMemo(
    () => repertoires.find((entry) => String(entry.id) === key) ?? null,
    [repertoires, key]
  );

  const lastMove = useMemo(() => {
    if (!path.length) return null;
    try {
      const position = afterMoves(START_FEN, path);
      return { from: position.from, to: position.to };
    } catch {
      return null;
    }
  }, [pathKey]);

  const rating = getRating();
  const myBand = getRatingBand(rating.value);
  const capturedBand = data?.position.ratingBand?.band ?? null;

  /* ------------------------------------------------------------- actions --- */

  const openCandidate = (candidate: Candidate) => {
    if (!candidate.saved) {
      void addMove(candidate.san, candidate.name);
      return;
    }
    const line = lines.find((entry) => entry.id === candidate.lineId);
    const continues =
      line && line.moves[path.length] === candidate.san && line.moves.length > path.length + 1;
    if (line && continues) {
      // Walk through the opponent's saved reply to the next position where it
      // is the repertoire's turn.
      setPath(line.moves.slice(0, path.length + 2));
      setLastAdd(null);
      setManualSan("");
      haptic();
      return;
    }
    setLastAdd({
      san: candidate.san,
      pgn: candidate.branchPgn,
      saved: data?.repertoire.saved ?? 0,
      path: [...path, candidate.san],
      transposition: false,
    });
    toast(`${candidate.san} is saved — continue in the builder to go deeper`, "info");
  };

  const addMove = async (san: string, name?: string) => {
    if (!key || !data) return;
    const clean = san.trim();
    if (!clean) return;
    setBusy("add");
    try {
      const response = await api.post<AddResponse>(`/repertoires/${key}/moves`, {
        epd: data.position.epd,
        san: clean,
        name,
      });
      setRepertoires((current) =>
        current.map((entry) => (entry.id === response.repertoire.id ? response.repertoire : entry))
      );
      setLastAdd({
        san: clean,
        pgn: response.line.pgn,
        saved: response.repertoire.saved,
        path: [...path, clean],
        transposition: Boolean(response.transposition),
      });
      haptic(22);
      toast(
        response.created
          ? `${clean} added — ${response.repertoire.saved} saved`
          : `${clean} already saved — ${response.repertoire.saved} saved`,
        response.created ? "ok" : "info"
      );
      setVersion((current) => current + 1);
      setManualSan("");
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };

  const createRepertoire = async () => {
    if (!newName.trim()) return;
    setBusy("create");
    try {
      const response = await api.post<{ repertoire: Repertoire }>("/repertoires", {
        color: newColor,
        name: newName.trim(),
        description: "",
      });
      haptic();
      toast(`${response.repertoire.name} created`, "ok");
      setRepertoires((current) => [...current, response.repertoire]);
      setNewName("");
      setKey(String(response.repertoire.id));
      setPath([]);
      setTab("add");
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };

  const readFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast("PGN files are limited to 2 MB", "bad");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImportText(String(reader.result ?? ""));
      setImportFileName(file.name);
    };
    reader.onerror = () => toast("Could not read that file", "bad");
    reader.readAsText(file);
  };

  const runImport = async () => {
    if (!importKey || !importText.trim()) {
      toast("Choose a repertoire and paste or upload a PGN", "bad");
      return;
    }
    setBusy("import");
    try {
      const response = await api.post<ImportResult>(`/repertoires/${importKey}/import`, {
        pgn: importText,
      });
      haptic();
      setImportResult(response);
      setRepertoires((current) =>
        current.map((entry) => (entry.id === response.repertoire.id ? response.repertoire : entry))
      );
      toast(
        `${response.imported} game${response.imported === 1 ? "" : "s"} imported` +
          (response.transpositions ? `, ${response.transpositions} merged` : ""),
        response.imported ? "ok" : "info"
      );
      setImportText("");
      setImportFileName("");
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };

  const cloneCourse = async (course: Course) => {
    if (!window.confirm(`Clone “${course.name}” into a new repertoire?`)) return;
    setBusy(`course-${course.id}`);
    try {
      const response = await api.post<{
        repertoire: Repertoire;
        imported: number;
        note: string;
        chaptersAvailable: boolean;
      }>(`/courses/${course.slug}/clone`, {});
      haptic();
      setRepertoires((current) => [...current, response.repertoire]);
      setKey(String(response.repertoire.id));
      setPath([]);
      setTab("add");
      toast(
        `Cloned ${course.name} with ${response.imported} line${response.imported === 1 ? "" : "s"}`,
        "ok"
      );
      if (!response.chaptersAvailable || response.note) {
        setCourseNote(response.note);
      }
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };

  const renameRepertoire = async (entry: Repertoire) => {
    const name = window.prompt("Repertoire name", entry.name)?.trim();
    if (!name || name === entry.name) return;
    try {
      const response = await api.patch<{ repertoire: Repertoire }>(`/repertoires/${entry.id}`, {
        name,
      });
      setRepertoires((current) =>
        current.map((item) => (item.id === entry.id ? response.repertoire : item))
      );
      toast("Repertoire renamed", "ok");
    } catch (e: any) {
      toast(e.message, "bad");
    }
  };

  const cloneRepertoire = async (entry: Repertoire) => {
    setBusy(`clone-${entry.id}`);
    try {
      const response = await api.post<{ repertoire: Repertoire; cloned: { lines: number } }>(
        `/repertoires/${entry.id}/clone`,
        {}
      );
      setRepertoires((current) => [...current, response.repertoire]);
      toast(`Cloned with ${response.cloned.lines} lines`, "ok");
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };

  const deleteRepertoire = async (entry: Repertoire) => {
    if (
      !window.confirm(
        `Delete “${entry.name}” with its saved lines, notes and review history? This cannot be undone.`
      )
    )
      return;
    setBusy(`delete-${entry.id}`);
    try {
      await api.delete(`/repertoires/${entry.id}`);
      haptic(30);
      setRepertoires((current) => current.filter((item) => item.id !== entry.id));
      if (String(entry.id) === key) {
        setKey("");
        setPath([]);
        setData(null);
      }
      toast("Repertoire deleted", "ok");
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };

  /* ------------------------------------------------------------------ ui --- */

  if (loadingList && repertoires.length === 0) return <Splash label="Loading repertoires…" />;

  const boardFen = data?.position.fen ?? START_FEN;
  const orientation = repertoire?.color ?? data?.position.repertoireSide ?? "white";
  const moveNumber = data?.position.moveNumber ?? Math.floor(path.length / 2) + 1;
  const side = data?.position.side ?? (path.length % 2 === 0 ? "white" : "black");
  const label = side === "white" ? `${moveNumber}.` : `${moveNumber}…`;
  const savedCount = repertoire?.saved ?? data?.repertoire.saved ?? 0;

  return (
    <div className="cb-app">
      <main className="cb-main">
        <section className="cb-board-col">
          <BoardHeader
            items={[
              { label: "Repertoires", to: "/add?tab=manage" },
              { label: repertoire ? repertoire.name : "Add", to: repertoire ? `/repertoire/${repertoire.id}` : undefined },
              { label: "Add" },
            ]}
          />
          <Board
            fen={boardFen}
            orientation={orientation}
            lastMove={lastMove}
          />
          <div className={`cb-board-footer ${path.length ? "visible" : ""}`}>
            <span>
              {path.length
                ? path.map((san, index) => `${index % 2 === 0 ? `${index / 2 + 1}. ` : ""}${san}`).join(" ")
                : "Start position"}
            </span>
            <span className="cb-row-meta">
              {path.length ? `${path.length} plies` : "No move yet"}
            </span>
          </div>
        </section>

        <Sidebar backTo="/" backLabel="Back">
          <div className="cb-page-head">
            <h1 className="cb-page-title">{repertoire ? repertoire.name : "Add moves"}</h1>
            <p className="cb-page-sub">
              {repertoire
                ? `${savedCount} saved · ${repertoire.lineCount} lines · ${repertoire.completion}% complete`
                : "Create a repertoire or choose one below."}
            </p>
          </div>

          <div className="cb-tabs" role="tablist" aria-label="Add repertoire sections">
            {TABS.map((entry) => (
              <button
                key={entry.value}
                type="button"
                role="tab"
                aria-selected={tab === entry.value}
                className={`cb-tab ${tab === entry.value ? "active" : ""}`}
                onClick={() => setTab(entry.value)}
              >
                <i className={`fa ${entry.icon}`} aria-hidden /> {entry.label}
              </button>
            ))}
          </div>

          {error && (
            <p className="cb-inline-note" role="alert">
              {error}
            </p>
          )}

          {tab === "add" && (
            <>
              {repertoires.length === 0 ? (
                <EmptyState
                  icon="fa-folder-plus"
                  title="No repertoire yet"
                  action={
                    <button type="button" className="cb-btn primary" onClick={() => setTab("new")}>
                      Create a repertoire
                    </button>
                  }
                >
                  A repertoire is a collection of openings for one colour.
                </EmptyState>
              ) : (
                <>
                  {repertoires.length > 1 && (
                    <div style={{ padding: "0 18px 12px" }}>
                      <label className="cb-add-label" htmlFor="repertoire-picker">
                        Repertoire
                      </label>
                      <select
                        id="repertoire-picker"
                        className="cb-select"
                        value={key}
                        onChange={(event) => setRepertoire(event.target.value)}
                      >
                        {repertoires.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.name} ({entry.color})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="cb-move-list">
                    <button
                      type="button"
                      className={`cb-move-pill ${path.length === 0 ? "active" : ""}`}
                      onClick={() => {
                        setPath([]);
                        setLastAdd(null);
                      }}
                    >
                      Start
                    </button>
                    {path.map((san, index) => (
                      <button
                        key={`${san}-${index}`}
                        type="button"
                        className={`cb-move-pill ${index === path.length - 1 ? "active" : "past"}`}
                        onClick={() => {
                          setPath(path.slice(0, index + 1));
                          setLastAdd(null);
                        }}
                      >
                        <span className="cb-move-number">
                          {index % 2 === 0 ? `${index / 2 + 1}.` : `${Math.floor(index / 2) + 1}…`}
                        </span>
                        {san}
                      </button>
                    ))}
                  </div>

                  {lastAdd && (
                    <div className="cb-panel" style={{ marginTop: 12 }}>
                      <div className="cb-panel-title">
                        {lastAdd.transposition ? "Merged into an existing branch" : "New branch"}
                      </div>
                      <p>
                        {lastAdd.pgn} · Saved {lastAdd.saved}
                      </p>
                      <button
                        type="button"
                        className="cb-link"
                        onClick={() =>
                          navigate(`/build/${key}?path=${encodeURIComponent(lastAdd.path.join(","))}`)
                        }
                      >
                        Open in builder <i className="fa fa-arrow-right" aria-hidden />
                      </button>
                    </div>
                  )}

                  {loading && !data ? (
                    <Splash label="Loading candidates…" />
                  ) : (
                    <>
                      <div className="cb-section-head" style={{ padding: "14px 18px 6px" }}>
                        <span>
                          {data?.position.heading.prompt ?? `Choose a move for ${side}`}
                        </span>
                        <span className="cb-table-head">
                          <span>Masters</span>
                          <span>Eval</span>
                          <span>Played</span>
                        </span>
                      </div>

                      {data && !data.position.available && (
                        <p className="cb-inline-note" style={{ margin: "0 18px 10px" }}>
                          <i className="fa fa-circle-info" aria-hidden /> No captured candidate report
                          for this position. Type a legal move below to add it.
                        </p>
                      )}

                      <div>
                        {(data?.candidates ?? []).map((candidate) => (
                          <div className="cb-candidate" key={candidate.sanKey}>
                            <button
                              type="button"
                              className="cb-candidate-main"
                              onClick={() => openCandidate(candidate)}
                              disabled={busy === "add"}
                            >
                              <span className="cb-candidate-move">
                                {label} <strong>{candidate.san}</strong>
                              </span>
                              <span className="cb-candidate-copy">
                                <strong>
                                  {candidate.name}
                                  {candidate.eco ? ` · ${candidate.eco}` : ""}
                                </strong>
                                <span>
                                  {candidate.saved
                                    ? `Saved${candidate.lineName ? ` · ${candidate.lineName}` : ""} — open branch`
                                    : "Not saved — add this move"}
                                  {candidate.excluded ? " · excluded from autofill" : ""}
                                </span>
                                {candidate.annotation && (
                                  <span className="cb-row-meta">{candidate.annotation}</span>
                                )}
                              </span>
                              <span className="cb-candidate-stats">
                                <span className="cb-mastery">
                                  {candidate.masters == null ? "—" : `${candidate.masters}%`}
                                </span>
                                <span className="cb-eval">
                                  {candidate.eval == null
                                    ? "—"
                                    : candidate.eval > 0
                                      ? `+${candidate.eval}`
                                      : `${candidate.eval}`}
                                </span>
                                <span className="cb-mastery">
                                  {candidate.oneIn ? `1/${candidate.oneIn}` : "—"}
                                </span>
                              </span>
                            </button>
                          </div>
                        ))}
                      </div>

                      {data && data.position.available && data.candidates.length === 0 && (
                        <p className="cb-inline-note" style={{ margin: "0 18px" }}>
                          This line ends here. Add a legal move below to continue the branch.
                        </p>
                      )}

                      <div className="cb-inline-note" style={{ margin: "12px 18px" }}>
                        Captured statistics are for{" "}
                        {capturedBand ? `${capturedBand} ${data?.position.ratingBand.ratingSystem ?? ""}` : "an unavailable rating band"}.
                        Your rating is {rating.value} {rating.system} ({myBand}
                        {capturedBand && capturedBand !== myBand ? " — different band" : ""}).
                        Incidences are not reweighted because only the captured band exists.
                      </div>

                      <div style={{ padding: "6px 18px 18px" }}>
                        <label className="cb-add-label" htmlFor="manual-san">
                          Add a move by SAN
                        </label>
                        <div className="cb-setting-connections">
                          <input
                            id="manual-san"
                            className="cb-input"
                            placeholder="e.g. Nf3"
                            value={manualSan}
                            onChange={(event) => setManualSan(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") void addMove(manualSan);
                            }}
                          />
                          <button
                            type="button"
                            className="cb-btn"
                            onClick={() => void addMove(manualSan)}
                            disabled={busy === "add" || !manualSan.trim() || !data}
                          >
                            {busy === "add" ? "Adding…" : "Add move"}
                          </button>
                        </div>
                        <p className="cb-row-meta" style={{ marginTop: 6 }}>
                          The server validates legality; adding an existing move merges by position.
                        </p>
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}

          {tab === "new" && (
            <>
              <div className="cb-add-intro">
                <p>
                  Create a repertoire for a different purpose (e.g. bullet vs blitz). Adding
                  alternate moves to an existing repertoire is usually better.
                </p>
              </div>
              <div className="cb-add-form">
                <div className="cb-add-label">Color</div>
                <div className="cb-add-choices">
                  {(["white", "black"] as const).map((option) => (
                    <button
                      type="button"
                      key={option}
                      className={`cb-add-choice ${newColor === option ? "active" : ""}`}
                      onClick={() => setNewColor(option)}
                    >
                      <span>{option === "white" ? "White" : "Black"}</span>
                      {newColor === option && <i className="fa fa-check" aria-hidden />}
                    </button>
                  ))}
                </div>
                <label className="cb-add-label cb-add-name-label" htmlFor="new-repertoire-name">
                  Name
                </label>
                <input
                  id="new-repertoire-name"
                  className="cb-add-input"
                  placeholder="Blitz"
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && void createRepertoire()}
                />
                <button
                  type="button"
                  className="cb-add-submit"
                  onClick={createRepertoire}
                  disabled={busy === "create" || !newName.trim()}
                >
                  {busy === "create" ? "Creating…" : "Create repertoire"}
                </button>
              </div>
            </>
          )}

          {tab === "import" && (
            <>
              <div style={{ padding: "0 18px 12px" }}>
                <label className="cb-add-label" htmlFor="import-repertoire">
                  Import into
                </label>
                <select
                  id="import-repertoire"
                  className="cb-select"
                  value={importKey}
                  onChange={(event) => setImportKey(event.target.value)}
                  disabled={repertoires.length === 0}
                >
                  {repertoires.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name} ({entry.color})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ padding: "0 18px 12px" }}>
                <label className="cb-add-label" htmlFor="import-file">
                  PGN file
                </label>
                <input
                  id="import-file"
                  className="cb-add-input"
                  type="file"
                  accept=".pgn,application/x-chess-pgn,text/plain"
                  onChange={(event) => readFile(event.target.files?.[0])}
                />
                {importFileName && <p className="cb-row-meta">Loaded {importFileName}</p>}
                <label className="cb-add-label" htmlFor="import-text">
                  Or paste PGN (multi-game supported)
                </label>
                <textarea
                  id="import-text"
                  className="cb-textarea"
                  placeholder={'[Event "Club game"]\n\n1. e4 c5 2. Nf3 d6 *'}
                  value={importText}
                  onChange={(event) => setImportText(event.target.value)}
                />
                <button
                  type="button"
                  className="cb-add-submit"
                  onClick={runImport}
                  disabled={busy === "import" || !importText.trim() || repertoires.length === 0}
                >
                  {busy === "import" ? "Importing…" : "Import PGN"}
                </button>
                {importResult && (
                  <p className="cb-inline-note" style={{ marginTop: 10 }}>
                    {importResult.imported} imported · {importResult.transpositions} transpositions ·{" "}
                    {importResult.trimmed} trimmed.{" "}
                    <button
                      type="button"
                      className="cb-link"
                      onClick={() => {
                        setKey(String(importResult.repertoire.id));
                        setPath([]);
                        setTab("add");
                      }}
                    >
                      Add moves
                    </button>
                  </p>
                )}
              </div>

              <div className="cb-settings-head">Pre-made courses</div>
              {coursesAvailable === false ? (
                <p className="cb-inline-note" style={{ margin: "0 18px" }}>
                  No pre-made course catalogue is available in this build.
                </p>
              ) : coursesAvailable === null ? (
                <p className="cb-row-meta" style={{ margin: "0 18px" }}>
                  Loading courses…
                </p>
              ) : (
                <div className="cb-settings-list">
                  {courses.map((course) => (
                    <div className="cb-row cb-settings-row" key={course.id}>
                      <span className="cb-row-main">
                        <span className="cb-row-title">{course.name}</span>
                        <span className="cb-row-meta">
                          {course.side} · {course.moveCount} moves ·{" "}
                          {course.coveragePercent == null
                            ? "coverage unavailable"
                            : `${course.coveragePercent}% coverage`}
                        </span>
                      </span>
                      <span className="cb-row-right">
                        <button
                          type="button"
                          className="cb-link"
                          onClick={() => void cloneCourse(course)}
                          disabled={busy === `course-${course.id}`}
                        >
                          {busy === `course-${course.id}` ? "Cloning…" : "Clone"}
                        </button>
                      </span>
                    </div>
                  ))}
                  {courseNote && (
                    <p className="cb-inline-note" style={{ margin: "10px 0 0" }}>
                      {courseNote}
                    </p>
                  )}
                  <p className="cb-inline-note" style={{ marginTop: 8 }}>
                    Course metadata is captured; the full move tree was not, so a clone seeds the
                    matching opening guide line where one exists.
                  </p>
                </div>
              )}
            </>
          )}

          {tab === "manage" && (
            <>
              <div className="cb-settings-list">
                {repertoires.length === 0 && (
                  <p className="cb-row-meta" style={{ margin: "0 18px" }}>
                    No repertoires yet. Create one on the New repertoire tab.
                  </p>
                )}
                {repertoires.map((entry) => (
                  <div className="cb-row cb-settings-row" key={entry.id}>
                    <span className="cb-row-main">
                      <span className="cb-row-title">
                        <span className={`cb-color-dot ${entry.color}`} aria-hidden /> {entry.name}
                      </span>
                      <span className="cb-row-meta">
                        {entry.saved} saved · {entry.lineCount} lines · {entry.completion}% complete ·{" "}
                        {entry.due} due
                      </span>
                    </span>
                    <span className="cb-row-right cb-setting-connections">
                      <button
                        type="button"
                        className="cb-link"
                        onClick={() => navigate(`/repertoire/${entry.id}`)}
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        className="cb-link"
                        onClick={() => void renameRepertoire(entry)}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="cb-link"
                        onClick={() => void cloneRepertoire(entry)}
                        disabled={busy === `clone-${entry.id}`}
                      >
                        Clone
                      </button>
                      <button
                        type="button"
                        className="cb-link"
                        onClick={() => void deleteRepertoire(entry)}
                        disabled={busy === `delete-${entry.id}`}
                      >
                        Delete
                      </button>
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ padding: "16px 18px" }}>
                <Row
                  title="Create another repertoire"
                  onClick={() => setTab("new")}
                  right={<i className="fa fa-plus" aria-hidden />}
                />
              </div>
            </>
          )}
        </Sidebar>
      </main>
    </div>
  );
}
