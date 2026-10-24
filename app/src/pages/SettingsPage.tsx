import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { Crumbs, START_FEN, useBoard } from "../board/stage";
import { useSettings } from "../settings";
import type { Settings } from "../types";
import { forgetAll } from "../useApi";
import { Back, Icon, PageHead, Row, useToast } from "../ui";

/* ------------------------------------------------------------ choices --- */

const PLATFORMS: Choice<Settings["ratingSystem"]>[] = [
  { value: "chesscom", label: "Chess.com" },
  { value: "lichess", label: "Lichess" },
  { value: "fide", label: "FIDE" },
];
const TIME_CONTROLS: Choice<Settings["timeControl"]>[] = [
  { value: "bullet", label: "Bullet" },
  { value: "blitz", label: "Blitz" },
  { value: "rapid", label: "Rapid" },
  { value: "classical", label: "Classical" },
];
const COVERAGE: Choice<number>[] = [20, 50, 100, 200, 500].map((n) => ({ value: n, label: `1 in ${n} games` }));
const GOALS: Choice<number>[] = [10, 20, 30, 50, 100].map((n) => ({ value: n, label: `${n} moves` }));
const NEW_MOVES: Choice<number>[] = [5, 10, 20, 50].map((n) => ({ value: n, label: `${n} moves` }));
const PAUSES: Choice<number>[] = [
  { value: 0, label: "Never" },
  { value: 500, label: "Half a second" },
  { value: 1000, label: "One second" },
  { value: 2000, label: "Two seconds" },
];
const PRACTICE: Choice<boolean>[] = [
  { value: false, label: "Individual moves", meta: "Only the moves that are due" },
  { value: true, label: "Whole lines", meta: "Every one of your moves in a line, from the first move" },
];
const ANIMATIONS: Choice<Settings["animation"]>[] = [
  { value: "off", label: "None" },
  { value: "fast", label: "Fast" },
  { value: "normal", label: "Normal" },
  { value: "slow", label: "Slow" },
];
const ENABLED: Choice<boolean>[] = [
  { value: true, label: "Enabled" },
  { value: false, label: "Disabled" },
];
const THEMES: Choice<Settings["boardTheme"]>[] = [
  { value: "green", label: "Chessbook" },
  { value: "blue", label: "Blue" },
  { value: "brown", label: "Wood" },
  { value: "gray", label: "Gray" },
  { value: "purple", label: "Purple" },
];
const THEME_COLORS: Record<string, [string, string]> = {
  green: ["#6aa169", "#3f835c"],
  blue: ["#8fb3cf", "#577a96"],
  brown: ["#d9b48c", "#a77852"],
  gray: ["#b9bec4", "#7c858d"],
  purple: ["#a99bc7", "#7465a0"],
};
const PIECES: Choice<string>[] = [
  { value: "chessbook_monochrome", label: "Chessbook" },
  { value: "cburnett", label: "Classic" },
  { value: "merida", label: "Merida" },
  { value: "chessnut", label: "Chessnut" },
  { value: "shapes", label: "Shapes" },
];

interface Choice<T> {
  value: T;
  label: string;
  meta?: string;
}

const labelOf = <T,>(choices: Choice<T>[], value: T) => choices.find((c) => c.value === value)?.label ?? "";

export function ratingRange(rating: number) {
  const low = Math.max(400, Math.round(rating / 100) * 100 - 100);
  return `${low}-${low + 200}`;
}

/* ------------------------------------------------------------- router --- */

export function SettingsPage() {
  const { section = "", sub = "" } = useParams();
  useBoard({ fen: START_FEN, orientation: "white", peek: true });
  const crumbs = [{ label: "Settings", to: section ? "/settings" : undefined }];
  const page = section ? `${section}${sub ? `/${sub}` : ""}` : "";
  return (
    <>
      <Crumbs items={crumbs} />
      {page === "" && <SettingsList />}
      {page === "rating" && <RatingPage />}
      {page === "rating/platform" && <ChoicePage title="Platform" setting="ratingSystem" choices={PLATFORMS} back="/settings/rating" />}
      {page === "rating/time-control" && <ChoicePage title="Time control" setting="timeControl" choices={TIME_CONTROLS} back="/settings/rating" />}
      {page === "coverage" && (
        <ChoicePage
          title="Cover positions seen in"
          sub="Chessbook will ask you to prepare a move for every position you're likely to reach at least this often. A higher number means a bigger, more thorough repertoire."
          setting="coverageGoal"
          choices={COVERAGE}
        />
      )}
      {page === "practice" && <ChoicePage title="Practice" sub="What practice asks you to play." setting="wholeLines" choices={PRACTICE} />}
      {page === "goal" && <ChoicePage title="Daily practice goal" setting="dailyGoal" choices={GOALS} />}
      {page === "new-moves" && (
        <ChoicePage
          title="New moves per session"
          sub="New moves are shown with an arrow first, then asked again from memory at the end of the session."
          setting="newPerSession"
          choices={NEW_MOVES}
        />
      )}
      {page === "pause" && (
        <ChoicePage title="Pause after playing a move" sub="How long to wait before your opponent's reply is played." setting="autoplayDelay" choices={PAUSES} />
      )}
      {page === "appearance" && <AppearancePage />}
      {page === "appearance/board" && <ChoicePage title="Board" setting="boardTheme" choices={THEMES} back="/settings/appearance" swatches />}
      {page === "appearance/pieces" && <ChoicePage title="Pieces" setting="pieceSet" choices={PIECES} back="/settings/appearance" pieces />}
      {page === "animation" && <ChoicePage title="Piece animation" setting="animation" choices={ANIMATIONS} />}
      {page === "sound" && <ChoicePage title="Sound effects" setting="sound" choices={ENABLED} />}
      {page === "reset" && <ResetPage />}
    </>
  );
}

/* --------------------------------------------------------------- list --- */

function SettingsList() {
  const { settings } = useSettings();
  return (
    <>
      <Back to="/" />
      <PageHead title="Settings" />
      <div className="rows list settings-list">
        <Row title="Your rating" right={<Value>{`${ratingRange(settings.rating)} ${labelOf(PLATFORMS, settings.ratingSystem)}`}</Value>} to="/settings/rating" />
        <Row title="Cover positions seen in" right={<Value>{`1 in ${settings.coverageGoal} games`}</Value>} to="/settings/coverage" />
      </div>
      <SettingsGroup title="Review settings">
        <Row title="Practice" right={<Value>{labelOf(PRACTICE, settings.wholeLines)}</Value>} to="/settings/practice" />
        <Row title="Daily practice goal" right={<Value>{`${settings.dailyGoal} moves`}</Value>} to="/settings/goal" />
        <Row title="New moves per session" right={<Value>{`${settings.newPerSession} moves`}</Value>} to="/settings/new-moves" />
        <Row title="Pause after playing a move" right={<Value>{labelOf(PAUSES, settings.autoplayDelay)}</Value>} to="/settings/pause" />
      </SettingsGroup>
      <SettingsGroup title="Board settings">
        <Row title="Appearance" right={<Value>{labelOf(THEMES, settings.boardTheme)}</Value>} to="/settings/appearance" />
        <Row title="Piece animation" right={<Value>{labelOf(ANIMATIONS, settings.animation)}</Value>} to="/settings/animation" />
        <Row title="Sound effects" right={<Value>{labelOf(ENABLED, settings.sound)}</Value>} to="/settings/sound" />
      </SettingsGroup>
      <SettingsGroup title="Data">
        <Row title="Reset all learning" to="/settings/reset" />
        <Row title="How Chessbook works" to="/about" />
      </SettingsGroup>
    </>
  );
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-group">
      <div className="section-head">{title}</div>
      <div className="rows list settings-list">{children}</div>
    </section>
  );
}

function Value({ children }: { children: ReactNode }) {
  return <span className="setting-value">{children}</span>;
}

/* ------------------------------------------------------------ choices --- */

function ChoicePage<K extends keyof Settings>({
  title,
  sub,
  setting,
  choices,
  back = "/settings",
  swatches = false,
  pieces = false,
}: {
  title: string;
  sub?: string;
  setting: K;
  choices: Choice<Settings[K]>[];
  back?: string;
  swatches?: boolean;
  pieces?: boolean;
}) {
  const { settings, update } = useSettings();
  const navigate = useNavigate();
  const toast = useToast();
  const pick = async (value: Settings[K]) => {
    try {
      await update({ [setting]: value } as Partial<Settings>);
      forgetAll();
      // Appearance choices stay open so you can compare; others go back.
      if (!swatches && !pieces) navigate(back);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  return (
    <>
      <Back to={back} />
      <PageHead title={title} sub={sub} />
      <div className="rows list choice-list">
        {choices.map((choice) => {
          const selected = settings[setting] === choice.value;
          return (
            <Row
              key={String(choice.value)}
              className={selected ? "selected" : "unselected"}
              title={
                <span className="choice-title">
                  {swatches && <Swatch colors={THEME_COLORS[String(choice.value)]} />}
                  {pieces && <PiecePreview set={String(choice.value)} />}
                  {choice.label}
                </span>
              }
              meta={choice.meta}
              right={selected ? <Icon name="check" /> : null}
              onClick={() => void pick(choice.value)}
            />
          );
        })}
      </div>
    </>
  );
}

function Swatch({ colors }: { colors: [string, string] }) {
  return (
    <span className="swatch" aria-hidden>
      <span style={{ background: colors[0] }} />
      <span style={{ background: colors[1] }} />
    </span>
  );
}

function PiecePreview({ set }: { set: string }) {
  return (
    <span className="piece-preview" aria-hidden>
      {["wN", "bQ"].map((k) => (
        <img key={k} src={`/pieces/${set}/${k}.svg`} alt="" />
      ))}
    </span>
  );
}

/* --------------------------------------------------------- appearance --- */

function AppearancePage() {
  const { settings, update } = useSettings();
  const toggle = (key: "coordinates" | "legalMoves") => void update({ [key]: !settings[key] });
  return (
    <>
      <Back to="/settings" />
      <PageHead title="Appearance" />
      <div className="rows list settings-list">
        <Row title="Board" right={<Value>{labelOf(THEMES, settings.boardTheme)}</Value>} to="/settings/appearance/board" />
        <Row title="Pieces" right={<Value>{labelOf(PIECES, settings.pieceSet)}</Value>} to="/settings/appearance/pieces" />
        <Row title="Coordinates" right={<Value>{settings.coordinates ? "Shown" : "Hidden"}</Value>} onClick={() => toggle("coordinates")} />
        <Row title="Legal move dots" right={<Value>{settings.legalMoves ? "Shown" : "Hidden"}</Value>} onClick={() => toggle("legalMoves")} />
      </div>
    </>
  );
}

/* ------------------------------------------------------------- rating --- */

const MIN = 400;
const MAX = 3000;
const STEP = 50;
const TICKS = [800, 1200, 1600, 2000, 2400, 2800];

function RatingPage() {
  const { settings, update } = useSettings();
  const [value, setValue] = useState(settings.rating);
  const timer = useRef<number | null>(null);
  useEffect(() => setValue(settings.rating), [settings.rating]);

  const set = (next: number) => {
    const clamped = Math.max(MIN, Math.min(MAX, Math.round(next / STEP) * STEP));
    setValue(clamped);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void update({ rating: clamped }).then(forgetAll);
    }, 350);
  };
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const pct = ((value - MIN) / (MAX - MIN)) * 100;
  return (
    <>
      <Back to="/settings" />
      <PageHead title="Your rating" sub="This is used to determine which moves your opponents are likely to play." />
      <div className="rating-picker">
        <div className="rating-value">{value}</div>
        <div className="rating-slider">
          <div className="rating-track">
            {TICKS.map((t) => (
              <span key={t} className="rating-tick" style={{ left: `${((t - MIN) / (MAX - MIN)) * 100}%` }} />
            ))}
            <span className="rating-thumb" style={{ left: `${pct}%` }} />
          </div>
          <input
            type="range"
            min={MIN}
            max={MAX}
            step={STEP}
            value={value}
            aria-label="Your rating"
            onChange={(e) => set(Number(e.target.value))}
          />
        </div>
        <div className="rating-stepper">
          <button type="button" aria-label="Lower" onClick={() => set(value - STEP)}>
            <Icon name="chevron-left" />
          </button>
          <span className="rating-grip" aria-hidden>
            ⠿
          </span>
          <button type="button" aria-label="Higher" onClick={() => set(value + STEP)}>
            <Icon name="chevron-right" />
          </button>
        </div>
      </div>
      <div className="rows list settings-list">
        <Row title="Platform" right={<Value>{labelOf(PLATFORMS, settings.ratingSystem)}</Value>} to="/settings/rating/platform" />
        <Row title="Time control" right={<Value>{labelOf(TIME_CONTROLS, settings.timeControl)}</Value>} to="/settings/rating/time-control" />
      </div>
    </>
  );
}

/* -------------------------------------------------------------- reset --- */

function ResetPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Back to="/settings" />
      <PageHead
        title="Reset all learning?"
        sub="Every move goes back to new and your review history is cleared. Your repertoires stay exactly as they are."
      />
      <div className="rows list settings-list">
        <Row
          className="danger"
          title={busy ? "Resetting…" : "Reset all learning"}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await api.post("/reset", { what: "progress" });
            forgetAll();
            toast("Learning progress reset");
            navigate("/settings");
          }}
        />
        <Row title="Cancel" to="/settings" />
      </div>
    </>
  );
}
