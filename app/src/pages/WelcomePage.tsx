import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { EmptyState, SkeletonRows } from "../components/ui";
import { useToast } from "../components/Toast";
import type { Color, Repertoire } from "../types";
import {
  PLATFORMS,
  TIME_CONTROLS,
  getRating,
  saveClientPrefs,
  type Platform,
  type TimeControl,
} from "../prefs";
import { ContentLayout, MiniBoard } from "./OpeningsPage";

/* ------------------------------------------------------------------ types --- */

interface Candidate {
  san: string;
  sanKey: string;
  name: string;
  eco: string | null;
  fenAfter: string;
  epdAfter: string;
  incidenceLabel?: string | null;
  oneIn?: number | null;
  masters?: number | null;
  mastersAvailable?: boolean;
  eval?: number | null;
  evalAvailable?: boolean;
  playable?: boolean;
  saved?: boolean;
}

interface CandidatesResponse {
  repertoire: Repertoire;
  position: { epd: string; fen: string; available: boolean; prefixMoves: string[] };
  candidates: Candidate[];
  available: boolean;
}

interface RepertoiresResponse {
  repertoires: Repertoire[];
}

interface AddResponse {
  line: { id: number; name: string; pgn: string };
  repertoire: Repertoire;
  created: boolean;
}

interface AutofillResponse {
  filled: number;
  considered: number;
  inserted: { san: string; name: string; rank: number }[];
  repertoire: Repertoire;
}

interface WelcomeRecord {
  completed: boolean;
  rating: { system: Platform; timeControl: TimeControl; value: number };
  style: string;
  side: Color;
  firstMove: string | null;
  repertoireKey: string | null;
  addedAt: string | null;
  autofilled: number | null;
}

const WELCOME_KEY = "cb_welcome_v1";

const STYLES: { value: string; label: string; detail: string }[] = [
  {
    value: "expected",
    label: "Main lines",
    detail: "The moves players at your level actually play. The safest default.",
  },
  {
    value: "aggressive",
    label: "Aggressive",
    detail: "Sharper, more ambitious moves with practical attacking chances.",
  },
  {
    value: "solid",
    label: "Solid",
    detail: "Sound structures and low-risk continuations you can defend.",
  },
  {
    value: "learnable",
    label: "Easy to learn",
    detail: "Fewer sharp branches and clearer plans from the first move.",
  },
  {
    value: "sharp",
    label: "Sharp",
    detail: "Forcing lines and open positions where precision matters.",
  },
];

const styleLabel = (value: string) =>
  STYLES.find((entry) => entry.value === value)?.label ?? value;

const candidateMeta = (candidate: Candidate) => {
  const parts: string[] = [];
  if (candidate.incidenceLabel) parts.push(candidate.incidenceLabel);
  else if (candidate.oneIn) parts.push(`1 in ${candidate.oneIn}`);
  if (candidate.mastersAvailable !== false && candidate.masters != null) {
    parts.push(`Masters ${Math.round(candidate.masters)}%`);
  }
  if (candidate.evalAvailable !== false && candidate.eval != null) {
    const pawns = candidate.eval / 100;
    parts.push(`${pawns > 0 ? "+" : ""}${pawns.toFixed(2)}`);
  }
  return parts.join(" · ");
};

function readWelcome(): WelcomeRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(WELCOME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as WelcomeRecord;
  } catch {
    return null;
  }
}

function writeWelcome(record: WelcomeRecord) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WELCOME_KEY, JSON.stringify(record));
  } catch {
    // The setup still works for this visit when storage is unavailable.
  }
}

const STEPS = [
  { number: 1, label: "Your rating" },
  { number: 2, label: "Playing style" },
  { number: 3, label: "First move" },
  { number: 4, label: "Fill the gaps" },
];

/* -------------------------------------------------------------------- page --- */

export function WelcomePage() {
  const { toast } = useToast();

  const [repertoires, setRepertoires] = useState<Repertoire[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [savedRecord, setSavedRecord] = useState<WelcomeRecord | null>(() => readWelcome());
  const [step, setStep] = useState(() => {
    const record = readWelcome();
    return record && !record.completed && record.firstMove ? 4 : 1;
  });

  const initialRating = savedRecord?.rating ?? getRating();
  const [ratingSystem, setRatingSystem] = useState<Platform>(initialRating.system);
  const [timeControl, setTimeControl] = useState<TimeControl>(initialRating.timeControl);
  const [ratingValue, setRatingValue] = useState(String(initialRating.value));
  const [style, setStyle] = useState(savedRecord?.style ?? "expected");

  const [side, setSide] = useState<Color>(savedRecord?.side ?? "white");
  const [key, setKey] = useState(savedRecord?.repertoireKey ?? "");
  const [opponent, setOpponent] = useState<"e4" | "d4">("e4");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [candidateError, setCandidateError] = useState("");
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [adding, setAdding] = useState(false);
  const [autoFilling, setAutoFilling] = useState(false);
  const [autoResult, setAutoResult] = useState<AutofillResponse | null>(null);
  const [created, setCreated] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get<RepertoiresResponse>("/repertoires")
      .then((response) => {
        if (!alive) return;
        setRepertoires(response.repertoires);
      })
      .catch((error: Error) => {
        if (!alive) return;
        setRepertoires([]);
        setLoadError(error.message);
      });
    return () => {
      alive = false;
    };
  }, []);

  const sideRepertoires = useMemo(
    () => (repertoires ?? []).filter((repertoire) => repertoire.color === side),
    [repertoires, side]
  );

  useEffect(() => {
    if (savedRecord?.completed) return;
    if (!sideRepertoires.length) {
      setKey("");
      return;
    }
    if (!sideRepertoires.some((repertoire) => String(repertoire.id) === key)) {
      setKey(String(sideRepertoires[0].id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideRepertoires, savedRecord?.completed]);

  useEffect(() => {
    if (!key || step !== 3 || savedRecord?.completed) return;
    let alive = true;
    setCandidates(null);
    setCandidateError("");
    setSelected(null);
    const query = side === "black" ? `?moves=${opponent}` : "";
    api
      .get<CandidatesResponse>(`/repertoires/${key}/candidates${query}`)
      .then((response) => {
        if (!alive) return;
        if (!response.available) {
          setCandidates([]);
          setCandidateError("No captured candidate list exists for that position.");
          return;
        }
        setCandidates(
          response.candidates.filter((candidate) => candidate.playable !== false).slice(0, 12)
        );
      })
      .catch((error: Error) => {
        if (!alive) return;
        setCandidates([]);
        setCandidateError(error.message);
      });
    return () => {
      alive = false;
    };
  }, [key, side, opponent, step, savedRecord?.completed]);

  const createRepertoire = async () => {
    const name = side === "white" ? "White openings" : "Black openings";
    try {
      const response = await api.post<{ repertoire: Repertoire }>("/repertoires", {
        color: side,
        name,
        description: "",
      });
      setRepertoires((current) => [...(current ?? []), response.repertoire]);
      setKey(String(response.repertoire.id));
      setCreated(true);
      toast(`${name} created`, "ok");
    } catch (error: any) {
      toast(error.message, "bad");
    }
  };

  const saveRating = () => {
    const value = Number(ratingValue);
    if (!Number.isFinite(value) || value < 400 || value > 3500) {
      toast("Enter a rating between 400 and 3500", "bad");
      return;
    }
    saveClientPrefs({
      rating: { system: ratingSystem, timeControl, value },
    });
    setStep(2);
  };

  const addFirstMove = async () => {
    if (!key || !selected) return;
    setAdding(true);
    try {
      const position = await api.get<CandidatesResponse>(
        `/repertoires/${key}/candidates${side === "black" ? `?moves=${opponent}` : ""}`
      );
      const response = await api.post<AddResponse>(`/repertoires/${key}/moves`, {
        epd: position.position.epd,
        san: selected.san,
        name: selected.name,
      });
      const record: WelcomeRecord = {
        completed: false,
        rating: { system: ratingSystem, timeControl, value: Number(ratingValue) },
        style,
        side,
        firstMove: `${side === "black" ? `${opponent} ` : ""}${selected.san}`,
        repertoireKey: key,
        addedAt: new Date().toISOString(),
        autofilled: null,
      };
      writeWelcome(record);
      setSavedRecord(record);
      setStep(4);
      toast(
        response.created
          ? `${selected.san} added to ${response.repertoire.name}`
          : `${selected.san} is already saved in ${response.repertoire.name}`,
        response.created ? "ok" : "info"
      );
    } catch (error: any) {
      toast(error.message, "bad");
    } finally {
      setAdding(false);
    }
  };

  const fillGaps = async () => {
    if (!key) return;
    setAutoFilling(true);
    try {
      const response = await api.post<AutofillResponse>(`/repertoires/${key}/autofill`, {
        style,
        maxMoves: 3,
      });
      setAutoResult(response);
      const record: WelcomeRecord = {
        completed: true,
        rating: { system: ratingSystem, timeControl, value: Number(ratingValue) },
        style,
        side,
        firstMove: savedRecord?.firstMove ?? null,
        repertoireKey: key,
        addedAt: savedRecord?.addedAt ?? new Date().toISOString(),
        autofilled: response.filled,
      };
      writeWelcome(record);
      setSavedRecord(record);
      toast(
        response.filled
          ? `${response.filled} move${response.filled === 1 ? "" : "s"} filled in`
          : "No captured gaps left to fill",
        response.filled ? "ok" : "info"
      );
    } catch (error: any) {
      toast(error.message, "bad");
    } finally {
      setAutoFilling(false);
    }
  };

  const finishWithoutFilling = () => {
    if (!key) return;
    const record: WelcomeRecord = {
      completed: true,
      rating: { system: ratingSystem, timeControl, value: Number(ratingValue) },
      style,
      side,
      firstMove: savedRecord?.firstMove ?? null,
      repertoireKey: key,
      addedAt: savedRecord?.addedAt ?? new Date().toISOString(),
      autofilled: 0,
    };
    writeWelcome(record);
    setSavedRecord(record);
    toast("Setup saved on this device", "ok");
  };

  const restart = () => {
    setSavedRecord(null);
    try {
      window.localStorage.removeItem(WELCOME_KEY);
    } catch {
      // ignore
    }
    setStep(1);
    setSelected(null);
    setAutoResult(null);
    setCreated(false);
    setStyle("expected");
  };

  const record = savedRecord;

  /* ------------------------------------------------------------- rendering --- */

  if (repertoires === null) {
    return (
      <ContentLayout crumbs={[{ label: "Get started" }]} narrow minimal>
        <SkeletonRows rows={6} />
      </ContentLayout>
    );
  }

  if (record?.completed) {
    const recordRepertoire = repertoires.find(
      (repertoire) => String(repertoire.id) === record.repertoireKey
    );
    return (
      <ContentLayout crumbs={[{ label: "Get started" }]} narrow minimal>
        <h1 className="cb-cs-title">You're set up</h1>
        <p className="cb-cs-lede">
          Chessbook has your rating, a playing style and a first move in{" "}
          {recordRepertoire?.name ?? "your repertoire"}. Everything is stored on this device; there
          is no account to create.
        </p>

        <div className="cb-cs-card" style={{ maxWidth: 640 }}>
          <div className="cb-cs-meta">
            <span>
              Rating: {record.rating.value} {record.rating.system} {record.rating.timeControl}
            </span>
            <span>Style: {styleLabel(record.style)}</span>
            <span>Side: {record.side === "white" ? "White" : "Black"}</span>
            {record.firstMove && <span>First move: {record.firstMove}</span>}
            <span>
              {record.autofilled == null
                ? "Gaps not filled yet"
                : `${record.autofilled} autofilled move${record.autofilled === 1 ? "" : "s"}`}
            </span>
          </div>
          <div className="cb-cs-card-actions">
            {record.repertoireKey && (
              <>
                <Link className="cb-btn primary" to={`/build/${record.repertoireKey}`}>
                  Open the builder
                </Link>
                <Link className="cb-btn" to={`/learn/${record.repertoireKey}`}>
                  Practice
                </Link>
                <Link className="cb-btn" to={`/repertoire/${record.repertoireKey}`}>
                  Repertoire overview
                </Link>
              </>
            )}
            <Link className="cb-btn" to="/dashboard">
              Dashboard
            </Link>
            <Link className="cb-link" to="/openings">
              Browse opening guides
            </Link>
            <button type="button" className="cb-link" onClick={restart}>
              Run setup again
            </button>
          </div>
        </div>

        <div className="cb-cs-steps" style={{ marginTop: 34 }}>
          <div className="cb-cs-step done">
            <span className="num">
              <i className="fa fa-check" aria-hidden />
            </span>
            Rating saved
          </div>
          <div className="cb-cs-step done">
            <span className="num">
              <i className="fa fa-check" aria-hidden />
            </span>
            Style saved
          </div>
          <div className="cb-cs-step done">
            <span className="num">
              <i className="fa fa-check" aria-hidden />
            </span>
            First move added
          </div>
          <div className="cb-cs-step done">
            <span className="num">
              <i className="fa fa-check" aria-hidden />
            </span>
            Gaps filled
          </div>
        </div>
      </ContentLayout>
    );
  }

  return (
    <ContentLayout crumbs={[{ label: "Get started" }]} narrow minimal>
      <h1 className="cb-cs-title">Set up your Chessbook</h1>
      <p className="cb-cs-lede">
        Four quick steps: your rating, the style you want to play, your first move, then fill in
        the gaps around it. No login. Everything below is written to this device and the local
        training database.
      </p>

      <ol className="cb-cs-steps">
        {STEPS.map((entry) => (
          <li
            className={`cb-cs-step${step === entry.number ? " active" : ""}${
              step > entry.number ? " done" : ""
            }`}
            key={entry.number}
          >
            <span className="num">
              {step > entry.number ? <i className="fa fa-check" aria-hidden /> : entry.number}
            </span>
            {entry.label}
          </li>
        ))}
      </ol>

      {loadError && (
        <p className="cb-cs-note">
          <i className="fa fa-triangle-exclamation" aria-hidden />
          <span>
            The local repertoire list could not be loaded ({loadError}). Rating and style still
            save; you can create the repertoire from the <Link to="/add?tab=new">add page</Link>.
          </span>
        </p>
      )}

      {step === 1 && (
        <div className="cb-cs-form">
          <div className="cb-cs-form-row">
            <label className="cb-field">
              <span>Rating system</span>
              <select
                className="cb-select"
                value={ratingSystem}
                onChange={(event) => setRatingSystem(event.target.value as Platform)}
              >
                {PLATFORMS.map((platform) => (
                  <option key={platform} value={platform}>
                    {platform}
                  </option>
                ))}
              </select>
            </label>
            <label className="cb-field">
              <span>Time control</span>
              <select
                className="cb-select"
                value={timeControl}
                onChange={(event) => setTimeControl(event.target.value as TimeControl)}
              >
                {TIME_CONTROLS.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="cb-field">
            <span>Your rating</span>
            <input
              className="cb-input"
              type="number"
              min={400}
              max={3500}
              step={25}
              value={ratingValue}
              onChange={(event) => setRatingValue(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && saveRating()}
            />
            <span className="cb-row-meta">
              Used for the candidate statistics the builder shows. Change it later in Settings.
            </span>
          </label>
          <div className="cb-cs-actions">
            <button type="button" className="cb-btn primary" onClick={saveRating}>
              Continue
            </button>
            <Link className="cb-btn ghost" to="/dashboard">
              Skip for now
            </Link>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="cb-cs-form">
          <div className="cb-cs-choice" style={{ flexDirection: "column", alignItems: "stretch" }}>
            {STYLES.map((entry) => (
              <button
                type="button"
                key={entry.value}
                className={style === entry.value ? "active" : ""}
                onClick={() => setStyle(entry.value)}
                aria-pressed={style === entry.value}
                style={{ textAlign: "left" }}
              >
                <strong>{entry.label}</strong>
                <span className="cb-row-meta" style={{ display: "block", marginTop: 3 }}>
                  {entry.detail}
                </span>
              </button>
            ))}
          </div>
          <p className="cb-inline-note" style={{ margin: 0 }}>
            Used for “fill in the gaps” at the end. It never removes moves you add by hand.
          </p>
          <div className="cb-cs-actions">
            <button type="button" className="cb-btn primary" onClick={() => setStep(3)}>
              Continue
            </button>
            <button type="button" className="cb-btn ghost" onClick={() => setStep(1)}>
              Back
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="cb-cs-form" style={{ maxWidth: 720 }}>
          <div className="cb-field">
            <span>Which colour do you want to start with?</span>
            <div className="cb-cs-choice">
              {(["white", "black"] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  className={side === value ? "active" : ""}
                  onClick={() => {
                    setSide(value);
                    setSelected(null);
                  }}
                  aria-pressed={side === value}
                >
                  {value === "white" ? "White" : "Black"}
                </button>
              ))}
            </div>
          </div>

          {sideRepertoires.length === 0 ? (
            <EmptyState
              icon="fa-folder-plus"
              title={`No ${side} repertoire yet`}
              action={
                <button type="button" className="cb-btn primary" onClick={() => void createRepertoire()}>
                  Create {side === "white" ? "White" : "Black"} openings
                </button>
              }
            >
              The first move needs somewhere to live. Create the local {side} repertoire, then
              pick a move.
            </EmptyState>
          ) : (
            <>
              {sideRepertoires.length > 1 && (
                <label className="cb-field">
                  <span>Repertoire</span>
                  <select
                    className="cb-select"
                    value={key}
                    onChange={(event) => {
                      setKey(event.target.value);
                      setSelected(null);
                    }}
                  >
                    {sideRepertoires.map((repertoire) => (
                      <option key={repertoire.id} value={repertoire.id}>
                        {repertoire.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {side === "black" && (
                <div className="cb-field">
                  <span>White's first move</span>
                  <div className="cb-cs-choice">
                    {(["e4", "d4"] as const).map((move) => (
                      <button
                        type="button"
                        key={move}
                        className={opponent === move ? "active" : ""}
                        onClick={() => {
                          setOpponent(move);
                          setSelected(null);
                        }}
                        aria-pressed={opponent === move}
                      >
                        {move}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="cb-field">
                <span>Pick your first move</span>
                {candidates === null ? (
                  <SkeletonRows rows={2} />
                ) : candidateError || candidates.length === 0 ? (
                  <p className="cb-cs-note" style={{ margin: 0 }}>
                    <i className="fa fa-circle-info" aria-hidden />
                    <span>
                      {candidateError ||
                        "The capture has no candidates at this position. Use the builder's candidate list instead."}
                    </span>
                  </p>
                ) : (
                  <div className="cb-cs-movechoices">
                    {candidates.map((candidate) => (
                      <button
                        type="button"
                        key={candidate.sanKey}
                        className={`cb-cs-movechoice${selected?.sanKey === candidate.sanKey ? " active" : ""}`}
                        onClick={() => setSelected(candidate)}
                        aria-pressed={selected?.sanKey === candidate.sanKey}
                      >
                        <span>
                          <b>{candidate.san}</b>
                          <span style={{ display: "block" }}>{candidate.name}</span>
                        </span>
                        <span style={{ textAlign: "right" }}>
                          {candidateMeta(candidate) || "stats unavailable"}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selected && (
                <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                  <MiniBoard
                    fen={selected.fenAfter}
                    orientation={side}
                    size={148}
                    label={`Position after ${selected.san}`}
                  />
                  <div>
                    <strong>{selected.name}</strong>
                    <p className="cb-row-meta" style={{ margin: "4px 0 0" }}>
                      {selected.san} will be saved as your first {side} move
                      {selected.saved ? " (already saved — the builder will open on it)" : ""}.
                    </p>
                  </div>
                </div>
              )}

              {created && (
                <p className="cb-inline-note" style={{ margin: 0 }}>
                  Repertoire created. Pick a move above.
                </p>
              )}

              <div className="cb-cs-actions">
                <button
                  type="button"
                  className="cb-btn primary"
                  onClick={() => void addFirstMove()}
                  disabled={!selected || adding}
                >
                  {adding ? "Adding…" : selected ? `Add ${selected.san}` : "Choose a move"}
                </button>
                <button type="button" className="cb-btn ghost" onClick={() => setStep(2)}>
                  Back
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {step === 4 && (
        <>
          <h2 className="cb-cs-section-title">You've added your first move</h2>
          <p className="cb-cs-lede" style={{ marginBottom: 20 }}>
            {record?.firstMove
              ? `${record.firstMove} is saved in ${
                  repertoires.find((repertoire) => String(repertoire.id) === record.repertoireKey)?.name ??
                  "your repertoire"
                }.`
              : "Your first move is saved."}{" "}
            Now let the builder fill in the gaps around it with the {styleLabel(style)} style, or
            open the builder and choose each move yourself.
          </p>

          {autoResult && (
            <div className="cb-cs-note" style={{ marginTop: 0 }}>
              <i className="fa fa-circle-check" aria-hidden />
              <span>
                {autoResult.filled > 0
                  ? `Added ${autoResult.inserted.map((entry) => entry.san).join(", ")} from ${autoResult.considered} ranked candidates.`
                  : "No captured gaps were left to fill at this position."}
              </span>
            </div>
          )}

          <div className="cb-cs-actions">
            {!record?.completed && (
              <button
                type="button"
                className="cb-btn primary"
                onClick={() => void fillGaps()}
                disabled={autoFilling || !key}
              >
                {autoFilling ? "Filling gaps…" : "Fill in the gaps"}
              </button>
            )}
            {record?.repertoireKey && (
              <>
                <Link className="cb-btn" to={`/build/${record.repertoireKey}`}>
                  Open the builder
                </Link>
                <Link className="cb-btn" to={`/learn/${record.repertoireKey}`}>
                  Practice
                </Link>
              </>
            )}
            {!record?.completed && (
              <button type="button" className="cb-btn ghost" onClick={finishWithoutFilling}>
                Finish without filling
              </button>
            )}
          </div>

          {record?.completed && (
            <p className="cb-cs-note">
              <i className="fa fa-circle-check" aria-hidden />
              <span>
                Setup complete. <button type="button" className="cb-link" onClick={restart}>Run it again</button>
              </span>
            </p>
          )}
        </>
      )}

      <p className="cb-cs-note">
        <i className="fa fa-circle-info" aria-hidden />
        <span>
          Local-first onboarding: the rating and style live in this browser's preferences, the
          first move is a real saved line in SQLite, and “fill in the gaps” calls the same
          autofill endpoint as the builder. There is no account, email or paywall.
        </span>
      </p>
    </ContentLayout>
  );
}
