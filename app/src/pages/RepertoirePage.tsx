import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import type { Line, Repertoire } from "../types";
import { Board } from "../components/Board";
import {
  BoardHeader,
  EmptyState,
  Modal,
  Row,
  Section,
  Sidebar,
  Splash,
} from "../components/ui";
import { afterMoves, START_FEN } from "../chess";
import { useToast } from "../components/Toast";
import {
  coverageFraction,
  coverageThreshold,
  getCoverageGoal,
  haptic,
} from "../prefs";

/* ------------------------------------------------------------------- types --- */

interface RepLine extends Line {
  moveCount?: number;
  movesLearned?: number;
  movesDue?: number;
  chapterId?: number | null;
  origin?: string | null;
  epdAfter?: string | null;
}

interface Chapter {
  id: number;
  name: string;
  description: string;
  sortOrder: number;
  lineCount: number;
}

interface RepertoireData {
  repertoire: Repertoire;
  lines: RepLine[];
  chapters: Chapter[];
  chaptersAvailable: boolean;
  characteristicsSource: string | null;
  coverageSource: string | null;
}

interface CoverageData {
  available: boolean;
  coverage: number | null;
  capturedCoverage: number | null;
  source: string | null;
  positionsWithReport: number;
  positionsWithoutReport: number;
  positions: { epd: string; available: boolean; coverage: number | null }[];
}

interface TrimResult {
  removed: { lineId: number; reason: string }[];
  removedCount: number;
  remaining: number;
  repertoire: Repertoire;
}

interface ImportResult {
  ok: boolean;
  imported: number;
  transpositions: number;
  total: number;
  trimmed: number;
  results: {
    ok: boolean;
    lineId?: number;
    created?: boolean;
    moves?: number;
    name?: string;
    error?: string;
    trimmed?: boolean;
  }[];
  repertoire: Repertoire;
}

type SheetKey = "rename" | "clone" | "delete" | "import" | "trim" | "chapters" | "lines" | null;

type TrimMode = "pastGoal" | "rare" | "sidelines" | "autofilled";

const TRIM_MODES: { value: TrimMode; label: string; detail: string }[] = [
  {
    value: "pastGoal",
    label: "Trim moves past your goal",
    detail: "Remove the least common branches while keeping your coverage goal.",
  },
  {
    value: "rare",
    label: "Trim rare sidelines below your coverage goal",
    detail: "Remove saved moves rarer than the coverage goal, and duplicate transpositions.",
  },
  {
    value: "sidelines",
    label: "Trim sideline transpositions",
    detail: "Keep one line for each final position; remove the duplicate routes.",
  },
  {
    value: "autofilled",
    label: "Remove autofilled moves",
    detail: "Remove every branch that was inserted by autofill.",
  },
];

const pct = (value: number | null | undefined) =>
  value == null ? null : Math.round(value * 1000) / 10;

/* ------------------------------------------------------------------- page --- */

export function RepertoirePage() {
  const { key = "white" } = useParams<{ key: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<RepertoireData | null>(null);
  const [coverage, setCoverage] = useState<CoverageData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [cloneValue, setCloneValue] = useState("");
  const [chapterName, setChapterName] = useState("");
  const [importText, setImportText] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [trimMode, setTrimMode] = useState<TrimMode>("pastGoal");
  const [trimPreview, setTrimPreview] = useState<TrimResult | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const sheet = (params.get("sheet") as SheetKey) ?? null;
  const selectedId = Number(params.get("line")) || null;
  const coverageGoal = getCoverageGoal();

  const setSheet = (next: SheetKey) => {
    const updated = new URLSearchParams(params);
    if (next) updated.set("sheet", next);
    else updated.delete("sheet");
    setParams(updated, { replace: true });
    setTrimPreview(null);
  };

  const selectLine = (id: number | null) => {
    const updated = new URLSearchParams(params);
    if (id) updated.set("line", String(id));
    else updated.delete("line");
    setParams(updated, { replace: true });
  };

  const load = useCallback(async () => {
    try {
      const response = await api.get<RepertoireData>(`/repertoires/${key}`);
      setData(response);
      setRenameValue(response.repertoire.name);
      setCloneValue(`${response.repertoire.name} copy`);
      setError("");
      try {
        const coverageResponse = await api.get<CoverageData>(`/repertoires/${key}/coverage`);
        setCoverage(coverageResponse);
      } catch {
        setCoverage(null);
      }
    } catch (e: any) {
      setError(e.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    setData(null);
    setCoverage(null);
    setError("");
    void load();
  }, [load]);

  useEffect(() => {
    const mode = params.get("mode");
    if (mode && TRIM_MODES.some((entry) => entry.value === mode)) {
      setTrimMode(mode as TrimMode);
    }
  }, [params]);

  const selected = useMemo(
    () => (selectedId ? data?.lines.find((line) => line.id === selectedId) ?? null : null),
    [data, selectedId]
  );

  if (error) {
    return (
      <div className="cb-splash">
        <p>{error}</p>
        <Link className="cb-btn" to="/add?tab=manage">
          Back to repertoires
        </Link>
      </div>
    );
  }
  if (!data) return <Splash label="Loading repertoire…" />;

  const { repertoire, lines, chapters } = data;
  const color = repertoire.color;
  const board = selected ? afterMoves(START_FEN, selected.moves) : null;
  const characteristics = repertoire.characteristics;
  const statsAvailable = Boolean(characteristics?.available);
  const lineName = (id: number) => lines.find((line) => line.id === id)?.name ?? `Line ${id}`;
  const coveragePercent = coverage?.available ? coverage.coverage : null;

  const autofill = async () => {
    setBusy("autofill");
    try {
      const response = await api.post<{
        filled: number;
        inserted: { san: string; name: string }[];
        repertoire: Repertoire;
      }>(`/repertoires/${key}/autofill`, {});
      haptic();
      if (response.filled) {
        const names = response.inserted.map((entry) => entry.san).join(", ");
        toast(`${response.filled} move${response.filled === 1 ? "" : "s"} added: ${names}`, "ok");
      } else {
        toast("No gaps left to autofill", "info");
      }
      await load();
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };

  const rename = async () => {
    const name = renameValue.trim();
    if (!name) return;
    setBusy("rename");
    try {
      await api.patch(`/repertoires/${key}`, { name });
      haptic();
      setSheet(null);
      await load();
      toast("Repertoire renamed", "ok");
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };

  const clone = async () => {
    setBusy("clone");
    try {
      const response = await api.post<{ repertoire: Repertoire; cloned: { lines: number } }>(
        `/repertoires/${key}/clone`,
        { name: cloneValue.trim() || `${repertoire.name} copy` }
      );
      haptic();
      toast(`Cloned with ${response.cloned.lines} lines`, "ok");
      navigate(`/repertoire/${response.repertoire.id}`);
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("delete");
    try {
      await api.delete(`/repertoires/${key}`);
      haptic(30);
      toast("Repertoire deleted", "ok");
      navigate("/add?tab=manage");
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };

  const runImport = async () => {
    if (!importText.trim()) {
      toast("Paste a PGN or choose a .pgn file", "bad");
      return;
    }
    setBusy("import");
    try {
      const response = await api.post<ImportResult>(`/repertoires/${key}/import`, {
        pgn: importText,
      });
      haptic();
      toast(
        `${response.imported} game${response.imported === 1 ? "" : "s"} imported` +
          (response.transpositions ? `, ${response.transpositions} transpositions` : ""),
        response.imported ? "ok" : "info"
      );
      setImportText("");
      setImportFileName("");
      if (fileInput.current) fileInput.current.value = "";
      await load();
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };

  const onFile = (file: File | undefined) => {
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

  const trimBody = (dryRun: boolean) => ({
    mode: trimMode,
    dryRun,
    threshold: coverageThreshold(coverageGoal),
    coverageGoal: coverageFraction(coverageGoal),
  });

  const previewTrim = async () => {
    setBusy("trim-preview");
    try {
      const response = await api.post<TrimResult>(`/repertoires/${key}/trim`, trimBody(true));
      setTrimPreview(response);
      haptic();
      toast(
        response.removedCount
          ? `${response.removedCount} move${response.removedCount === 1 ? "" : "s"} would be removed`
          : "Nothing to remove with this tool",
        response.removedCount ? "info" : "ok"
      );
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };

  const applyTrim = async () => {
    setBusy("trim");
    try {
      const response = await api.post<TrimResult>(`/repertoires/${key}/trim`, trimBody(false));
      haptic(24);
      toast(
        `${response.removedCount} move${response.removedCount === 1 ? "" : "s"} removed`,
        response.removedCount ? "ok" : "info"
      );
      setTrimPreview(null);
      setSheet(null);
      await load();
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };

  const addChapter = async () => {
    const name = chapterName.trim();
    if (!name) return;
    setBusy("chapter");
    try {
      await api.post(`/repertoires/${key}/chapters`, { name });
      setChapterName("");
      haptic();
      await load();
      toast("Section added", "ok");
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };

  const renameChapter = async (chapter: Chapter) => {
    const name = window.prompt("Section name", chapter.name)?.trim();
    if (!name || name === chapter.name) return;
    try {
      await api.patch(`/chapters/${chapter.id}`, { name });
      await load();
      toast("Section renamed", "ok");
    } catch (e: any) {
      toast(e.message, "bad");
    }
  };

  const deleteChapter = async (chapter: Chapter) => {
    if (!window.confirm(`Delete the section “${chapter.name}”? Its lines stay saved.`)) return;
    try {
      await api.delete(`/chapters/${chapter.id}`);
      await load();
      toast("Section deleted", "ok");
    } catch (e: any) {
      toast(e.message, "bad");
    }
  };

  const assignChapter = async (line: RepLine, chapterId: number | null) => {
    try {
      await api.patch(`/lines/${line.id}`, { chapterId });
      setData((current) =>
        current
          ? {
              ...current,
              lines: current.lines.map((entry) =>
                entry.id === line.id ? { ...entry, chapterId } : entry
              ),
            }
          : current
      );
      toast("Section updated", "ok");
    } catch (e: any) {
      toast(e.message, "bad");
    }
  };

  const exportRepertoire = (format: "pgn" | "json") => {
    haptic();
    window.location.assign(`/api/repertoires/${key}/export?format=${format}&download=1`);
  };

  return (
    <div className="cb-app">
      <main className="cb-main">
        <section className="cb-board-col">
          <BoardHeader
            items={[
              { label: "Repertoires", to: "/add?tab=manage" },
              { label: repertoire.name },
            ]}
          />
          <Board
            fen={board?.fen ?? START_FEN}
            orientation={color}
            lastMove={board ? { from: board.from, to: board.to } : null}
          />
          <div className={`cb-board-footer ${selected ? "visible" : ""}`}>
            <span>
              {selected
                ? `${selected.name} · ${selected.pgn}`
                : `${repertoire.name} · ${repertoire.color === "white" ? "White" : "Black"}`}
            </span>
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
            <p className="cb-page-sub">
              {repertoire.description || "A repertoire is a collection of openings for one colour."}
            </p>
          </div>

          <div className="cb-progress-line">
            <div className="cb-progress-copy">
              <strong>{repertoire.completion}% complete</strong>
              <button
                type="button"
                className="cb-link"
                onClick={autofill}
                disabled={busy === "autofill"}
              >
                Autofill remaining gaps <i className="fa fa-wand-magic-sparkles" aria-hidden />
              </button>
            </div>
            <div className="cb-bar">
              <span style={{ width: `${repertoire.completion}%` }} />
            </div>
          </div>

          <div className="cb-progress-line" style={{ marginTop: 36 }}>
            <div className="cb-progress-copy">
              <strong>{repertoire.mastery}% mastered</strong>
              <span className="cb-row-meta">
                {repertoire.saved} saved · {repertoire.moveCount ?? 0} moves ·{" "}
                {repertoire.positionCount ?? 0} positions · {repertoire.lineCount} lines
              </span>
            </div>
            <div className="cb-bar mastery">
              <span style={{ width: `${repertoire.mastery}%` }} />
            </div>
          </div>

          <Row
            title="Continue building"
            right={<span className="cb-row-meta strong">{repertoire.saved} Saved</span>}
            to={`/build/${key}`}
            testId="continue-building"
          />
          <Row
            title="Add moves from the candidate list"
            right={<span className="cb-row-meta">Recommended</span>}
            to={`/add?tab=add&repertoire=${repertoire.id}`}
            testId="add-moves"
          />
          <Row
            title="Continue learning"
            right={
              <span className="cb-row-meta strong">
                {repertoire.due} due <i className="fa fa-clock" aria-hidden />
              </span>
            }
            to={`/learn/${key}`}
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
            {statsAvailable ? (
              <>
                <div className="cb-metrics">
                  <Metric label="Effectiveness" value={pct(characteristics?.effectiveness)} />
                  <span className="cb-metric-divider" aria-hidden />
                  <Metric label="Soundness" value={pct(characteristics?.soundness)} tone="green" />
                  <span className="cb-metric-divider" aria-hidden />
                  <Metric label="Learnability" value={pct(characteristics?.learnability)} tone="orange" />
                </div>
                <div className="cb-metrics" style={{ marginTop: 18 }}>
                  <Metric label="Expected results" value={pct(characteristics?.expectedResults)} />
                  <span className="cb-metric-divider" aria-hidden />
                  <Metric label="Sharpness" value={pct(characteristics?.sharpness)} tone="danger" />
                </div>
                <p className="cb-inline-note" style={{ marginTop: 14 }}>
                  Captured position report for the reference repertoire.
                  {characteristics?.avgCpLoss != null
                    ? ` Average centipawn loss ${(characteristics.avgCpLoss * 100).toFixed(1)}.`
                    : ""}
                </p>
              </>
            ) : (
              <>
                <div className="cb-metrics">
                  <Metric label="Effectiveness" value={null} />
                  <span className="cb-metric-divider" aria-hidden />
                  <Metric label="Soundness" value={null} tone="green" />
                  <span className="cb-metric-divider" aria-hidden />
                  <Metric label="Learnability" value={null} tone="orange" />
                </div>
                <p className="cb-inline-note" style={{ marginTop: 14 }}>
                  <i className="fa fa-circle-info" aria-hidden /> Unavailable: this repertoire has no
                  captured position report. These values are never derived from learned/mastered
                  counts.
                </p>
              </>
            )}
            <div className="cb-progress-line" style={{ marginTop: 18 }}>
              <div className="cb-progress-copy">
                <strong>
                  {coveragePercent == null
                    ? "Coverage unavailable"
                    : `Coverage ${coveragePercent.toFixed(1)}%`}
                </strong>
                <span className="cb-row-meta">
                  {coverage?.available
                    ? `${coverage.positionsWithReport} of ${
                        coverage.positionsWithReport + coverage.positionsWithoutReport
                      } positions have a captured report`
                    : "No captured candidate data for this repertoire"}
                </span>
              </div>
              <div className="cb-bar">
                <span style={{ width: `${coveragePercent ?? 0}%` }} />
              </div>
            </div>
          </div>

          <Section
            title="Sections"
            action={
              <button type="button" className="cb-link" onClick={() => setSheet("chapters")}>
                Manage <i className="fa fa-gear" aria-hidden />
              </button>
            }
          >
            {chapters.length === 0 ? (
              <Row
                ghost
                title="No sections yet"
                meta="Group saved lines into chapters"
                onClick={() => setSheet("chapters")}
                right={<i className="fa fa-plus" aria-hidden />}
              />
            ) : (
              chapters.map((chapter) => (
                <Row
                  key={chapter.id}
                  title={chapter.name}
                  meta={`${chapter.lineCount} line${chapter.lineCount === 1 ? "" : "s"}`}
                  onClick={() => setSheet("lines")}
                  right={<i className="fa fa-folder" aria-hidden />}
                />
              ))
            )}
          </Section>

          <Section
            title="Saved lines"
            action={<span className="cb-row-meta">{lines.length}</span>}
          >
            {lines.length === 0 ? (
              <EmptyState
                icon="fa-seedling"
                title="No saved moves yet"
                action={
                  <Link className="cb-btn primary" to={`/add?tab=add&repertoire=${repertoire.id}`}>
                    Add your first move
                  </Link>
                }
              >
                Pick a move from the candidate list to start this repertoire.
              </EmptyState>
            ) : (
              lines.slice(0, 6).map((line) => (
                <Row
                  key={line.id}
                  title={line.name}
                  meta={`${line.moveCount ?? line.moves.length} moves${
                    line.chapterId
                      ? ` · ${chapters.find((chapter) => chapter.id === line.chapterId)?.name ?? ""}`
                      : ""
                  }`}
                  onClick={() => selectLine(selectedId === line.id ? null : line.id)}
                  className={selectedId === line.id ? "selected" : ""}
                  right={
                    <span className="cb-row-meta">
                      {line.due ? "Due" : line.mastered > 0 ? `${line.mastered}%` : "New"}
                    </span>
                  }
                />
              ))
            )}
            {lines.length > 6 && (
              <Row
                ghost
                title={`Show all ${lines.length} saved lines`}
                onClick={() => setSheet("lines")}
                right={<i className="fa fa-arrow-right" aria-hidden />}
              />
            )}
          </Section>

          <Section title="Import and export">
            <Row
              title="Import PGN"
              meta="Paste PGN or upload a .pgn file (multi-game supported)"
              onClick={() => setSheet("import")}
              right={<i className="fa fa-file-import" aria-hidden />}
            />
            <Row
              title="Export PGN"
              meta="All saved lines as one PGN"
              onClick={() => exportRepertoire("pgn")}
              right={<i className="fa fa-download" aria-hidden />}
            />
            <Row
              title="Export JSON"
              meta="Repertoire, chapters, lines and notes"
              onClick={() => exportRepertoire("json")}
              right={<i className="fa fa-download" aria-hidden />}
            />
            <Row
              title="Trim moves"
              meta={`Coverage goal: 1 in ${coverageGoal} games`}
              onClick={() => setSheet("trim")}
              right={<i className="fa fa-filter" aria-hidden />}
            />
          </Section>

          <Section title="Manage">
            <Row title="Rename repertoire" onClick={() => setSheet("rename")} />
            <Row title="Clone repertoire" onClick={() => setSheet("clone")} />
            <Row title="Delete repertoire" onClick={() => setSheet("delete")} />
          </Section>

          <div className="cb-rep-settings-link">
            <Link to="/settings">Settings</Link>
          </div>
        </Sidebar>
      </main>

      {sheet === "rename" && (
        <Overlay title="Rename repertoire" onClose={() => setSheet(null)}>
          <label className="cb-add-label" htmlFor="rep-rename">
            Name
          </label>
          <input
            id="rep-rename"
            className="cb-add-input"
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && void rename()}
          />
          <div className="cb-modal-footer">
            <button type="button" className="cb-btn" onClick={() => setSheet(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="cb-btn primary"
              onClick={rename}
              disabled={busy === "rename" || !renameValue.trim()}
            >
              Save
            </button>
          </div>
        </Overlay>
      )}

      {sheet === "clone" && (
        <Overlay title="Clone repertoire" onClose={() => setSheet(null)}>
          <p className="cb-inline-note">
            Copies saved lines, chapters and notes. Review history and scheduling start fresh.
          </p>
          <label className="cb-add-label" htmlFor="rep-clone">
            New name
          </label>
          <input
            id="rep-clone"
            className="cb-add-input"
            value={cloneValue}
            onChange={(event) => setCloneValue(event.target.value)}
          />
          <div className="cb-modal-footer">
            <button type="button" className="cb-btn" onClick={() => setSheet(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="cb-btn primary"
              onClick={clone}
              disabled={busy === "clone" || !cloneValue.trim()}
            >
              Clone
            </button>
          </div>
        </Overlay>
      )}

      {sheet === "delete" && (
        <Overlay title="Delete repertoire" onClose={() => setSheet(null)}>
          <p className="cb-inline-note">
            <i className="fa fa-triangle-exclamation" aria-hidden /> This removes “{repertoire.name}”
            with its saved lines, notes and review history. This cannot be undone.
          </p>
          <div className="cb-modal-footer">
            <button type="button" className="cb-btn" onClick={() => setSheet(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="cb-btn primary"
              onClick={remove}
              disabled={busy === "delete"}
            >
              Delete permanently
            </button>
          </div>
        </Overlay>
      )}

      {sheet === "import" && (
        <Overlay title="Import PGN" onClose={() => setSheet(null)}>
          <p className="cb-inline-note">
            Import into <strong>{repertoire.name}</strong> ({repertoire.color}). Lines that end on the
            wrong colour or duplicate an existing final position are skipped or merged.
          </p>
          <label className="cb-add-label" htmlFor="pgn-file">
            PGN file
          </label>
          <input
            id="pgn-file"
            className="cb-add-input"
            type="file"
            accept=".pgn,application/x-chess-pgn,text/plain"
            ref={fileInput}
            onChange={(event) => onFile(event.target.files?.[0])}
          />
          {importFileName && <p className="cb-row-meta">Loaded {importFileName}</p>}
          <label className="cb-add-label" htmlFor="pgn-text">
            Or paste PGN
          </label>
          <textarea
            id="pgn-text"
            className="cb-textarea"
            placeholder='[Event "Club game"]&#10;&#10;1. e4 c5 2. Nf3 d6 *'
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
          />
          <div className="cb-modal-footer">
            <button type="button" className="cb-btn" onClick={() => setSheet(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="cb-btn primary"
              onClick={runImport}
              disabled={busy === "import" || !importText.trim()}
            >
              {busy === "import" ? "Importing…" : "Import"}
            </button>
          </div>
        </Overlay>
      )}

      {sheet === "trim" && (
        <Overlay title="Trim moves" onClose={() => setSheet(null)}>
          <p className="cb-inline-note">
            Coverage goal: positions seen in <strong>1 in {coverageGoal} games</strong>. Change it in
            Settings. Preview first — nothing is removed until you confirm.
          </p>
          <div className="cb-settings-list">
            {TRIM_MODES.map((mode) => (
              <Row
                key={mode.value}
                title={mode.label}
                meta={mode.detail}
                className={`cb-settings-row ${trimMode === mode.value ? "selected" : ""}`}
                onClick={() => {
                  setTrimMode(mode.value);
                  setTrimPreview(null);
                }}
                right={
                  trimMode === mode.value ? <i className="fa fa-check" aria-hidden /> : undefined
                }
              />
            ))}
          </div>
          {trimPreview && (
            <div style={{ marginTop: 14 }}>
              <p className="cb-inline-note">
                {trimPreview.removedCount
                  ? `${trimPreview.removedCount} of ${trimPreview.remaining + trimPreview.removedCount} lines would be removed, leaving ${trimPreview.remaining}.`
                  : "Nothing to remove with this tool."}
              </p>
              {trimPreview.removed.length > 0 && (
                <ul className="cb-row-meta" style={{ margin: "8px 0 0 16px" }}>
                  {trimPreview.removed.slice(0, 8).map((entry) => (
                    <li key={`${entry.lineId}-${entry.reason}`}>
                      {lineName(entry.lineId)} — {entry.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="cb-modal-footer">
            <button
              type="button"
              className="cb-btn"
              onClick={previewTrim}
              disabled={busy === "trim-preview"}
            >
              {busy === "trim-preview" ? "Checking…" : "Preview"}
            </button>
            <button
              type="button"
              className="cb-btn primary"
              onClick={applyTrim}
              disabled={busy === "trim" || !trimPreview?.removedCount}
            >
              {busy === "trim"
                ? "Trimming…"
                : trimPreview?.removedCount
                  ? `Remove ${trimPreview.removedCount}`
                  : "Remove"}
            </button>
          </div>
        </Overlay>
      )}

      {sheet === "chapters" && (
        <Overlay title="Sections" onClose={() => setSheet(null)}>
          <p className="cb-inline-note">
            Chapters group saved lines. Deleting a section keeps its lines saved.
          </p>
          <div className="cb-settings-list">
            {chapters.length === 0 ? (
              <p className="cb-row-meta">No sections yet.</p>
            ) : (
              chapters.map((chapter) => (
                <div className="cb-row cb-settings-row" key={chapter.id}>
                  <span className="cb-row-main">
                    <span className="cb-row-title">{chapter.name}</span>
                    <span className="cb-row-meta">
                      {chapter.lineCount} line{chapter.lineCount === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="cb-row-right cb-setting-connections">
                    <button
                      type="button"
                      className="cb-link"
                      onClick={() => void renameChapter(chapter)}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="cb-link"
                      onClick={() => void deleteChapter(chapter)}
                    >
                      Delete
                    </button>
                  </span>
                </div>
              ))
            )}
          </div>
          <label className="cb-add-label" htmlFor="chapter-name">
            New section
          </label>
          <div className="cb-setting-connections">
            <input
              id="chapter-name"
              className="cb-input"
              value={chapterName}
              onChange={(event) => setChapterName(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && void addChapter()}
            />
            <button
              type="button"
              className="cb-btn"
              onClick={addChapter}
              disabled={busy === "chapter" || !chapterName.trim()}
            >
              Add
            </button>
          </div>
          <div className="cb-modal-footer">
            <button type="button" className="cb-btn" onClick={() => setSheet("lines")}>
              Assign lines
            </button>
            <button type="button" className="cb-btn primary" onClick={() => setSheet(null)}>
              Done
            </button>
          </div>
        </Overlay>
      )}

      {sheet === "lines" && (
        <Overlay title="Saved lines and sections" onClose={() => setSheet(null)}>
          <p className="cb-inline-note">
            {lines.length} saved lines; {repertoire.positionCount ?? 0} positions. Assign a line to a
            section or select it to show on the board.
          </p>
          <div className="cb-settings-list">
            {lines.length === 0 ? (
              <p className="cb-row-meta">No saved lines yet.</p>
            ) : (
              lines.map((line) => (
                <div
                  className={`cb-row cb-settings-row ${selectedId === line.id ? "selected" : ""}`}
                  key={line.id}
                >
                  <span className="cb-row-main">
                    <span className="cb-row-title">{line.name}</span>
                    <span className="cb-row-meta">
                      {line.pgn} · {line.moveCount ?? line.moves.length} moves
                    </span>
                  </span>
                  <span className="cb-row-right cb-setting-connections">
                    <button
                      type="button"
                      className="cb-link"
                      onClick={() => selectLine(line.id)}
                    >
                      Show
                    </button>
                    <select
                      className="cb-select"
                      style={{ width: 130 }}
                      value={line.chapterId ?? ""}
                      onChange={(event) =>
                        void assignChapter(
                          line,
                          event.target.value ? Number(event.target.value) : null
                        )
                      }
                      aria-label={`Section for ${line.name}`}
                    >
                      <option value="">No section</option>
                      {chapters.map((chapter) => (
                        <option key={chapter.id} value={chapter.id}>
                          {chapter.name}
                        </option>
                      ))}
                    </select>
                  </span>
                </div>
              ))
            )}
          </div>
          <div className="cb-modal-footer">
            <button type="button" className="cb-btn primary" onClick={() => setSheet(null)}>
              Done
            </button>
          </div>
        </Overlay>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ pieces --- */

function Metric({
  label,
  value,
  tone = "green",
}: {
  label: string;
  value: number | null;
  tone?: "green" | "orange" | "danger";
}) {
  const width = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="cb-metric">
      <span className="cb-metric-label">{label}</span>
      <span className="cb-metric-value">
        {value != null && (
          <span className={`cb-segbar ${tone}`} aria-hidden>
            <span style={{ width: `${width}%` }} />
          </span>
        )}
        <span className="cb-metric-number">
          {value == null ? "—" : `${value.toFixed(1)}%`}
        </span>
      </span>
    </div>
  );
}

function Overlay({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      {children}
    </Modal>
  );
}
