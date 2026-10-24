import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import type { Repertoire } from "../types";
import { Board } from "../components/Board";
import { BoardHeader, Modal, Row, Sidebar, Splash } from "../components/ui";
import { useToast } from "../components/Toast";
import { useProfile } from "../profile";
import {
  ANIMATION_OPTIONS,
  COVERAGE_OPTIONS,
  DAILY_GOAL_OPTIONS,
  PAUSE_OPTIONS,
  PLATFORMS,
  RECOMMENDED_SIZE_OPTIONS,
  SOUND_LABELS,
  TIME_CONTROLS,
  getClientPrefs,
  haptic,
  notificationsSupported,
  previewSound,
  requestNotificationPermission,
  resetClientPrefs,
  saveClientPrefs,
  type AnimationSpeed,
  type Platform,
  type PracticeMode,
  type RecommendedMovesSize,
  type ReviewStyle,
  type ServerSettings,
  type SoundName,
  type TimeControl,
} from "../prefs";

type SheetKey =
  | "rating"
  | "coverage"
  | "practice"
  | "review"
  | "goal"
  | "pause"
  | "notifications"
  | "appearance"
  | "animation"
  | "sound"
  | "recsize"
  | "modelSource"
  | null;

const PRACTICE_OPTIONS: { value: PracticeMode; label: string; detail: string }[] = [
  {
    value: "individual",
    label: "Individual moves",
    detail: "Ask each saved position on its own; the opponent's reply is auto-played.",
  },
  {
    value: "whole-lines",
    label: "Whole lines",
    detail: "Walk a complete line from the first move to the last saved move.",
  },
];

const REVIEW_OPTIONS: { value: ReviewStyle; label: string; detail: string }[] = [
  { value: "cards", label: "Cards", detail: "One position at a time, scheduled by review state." },
  {
    value: "complete-once",
    label: "Complete lines (once per session)",
    detail: "Finish each line once, then move to the next line.",
  },
  {
    value: "complete-every",
    label: "Complete lines (every time)",
    detail: "Replay the whole line whenever any move in it is due.",
  },
  {
    value: "entire-line",
    label: "Entire line",
    detail: "Show every move in the line and review it end to end.",
  },
];

const MODEL_SOURCES: { value: "historical" | "masters" | "online"; label: string; detail: string }[] =
  [
    {
      value: "historical",
      label: "Historical and master games",
      detail: "The captured historical game collection on this device.",
    },
    {
      value: "masters",
      label: "Master games only",
      detail: "Filter the local collection to master-level games.",
    },
    {
      value: "online",
      label: "Online games",
      detail: "No online account exists in this build — this shows an explicit empty state.",
    },
  ];

export function SettingsPage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { settings, saveSettings, refresh, loading } = useProfile();
  const [prefs, setPrefs] = useState(() => getClientPrefs());
  const [sheet, setSheet] = useState<SheetKey>(null);
  const [repertoires, setRepertoires] = useState<Repertoire[]>([]);
  const [rating, setRating] = useState(prefs.rating);

  useEffect(() => {
    setPrefs(getClientPrefs());
    api
      .get<{ repertoires: Repertoire[] }>("/repertoires")
      .then((r) => setRepertoires(r.repertoires))
      .catch(() => setRepertoires([]));
  }, []);

  const updatePrefs = useCallback((patch: Parameters<typeof saveClientPrefs>[0]) => {
    setPrefs(saveClientPrefs(patch));
  }, []);

  if (!settings) {
    if (loading) return <Splash label="Loading settings…" />;
    return (
      <div className="cb-splash">
        <p>Settings could not be loaded from the local database.</p>
        <button type="button" className="cb-btn" onClick={() => location.reload()}>
          Retry
        </button>
      </div>
    );
  }

  const save = async (patch: Partial<ServerSettings>) => {
    try {
      return await saveSettings(patch);
    } catch (e: any) {
      toast(e.message, "bad");
      return null;
    }
  };

  const toggle = async (key: keyof ServerSettings, value: boolean) => {
    haptic();
    await save({ [key]: value } as Partial<ServerSettings>);
  };

  const openRating = () => {
    setRating(getClientPrefs().rating);
    setSheet("rating");
  };

  const commitRating = () => {
    updatePrefs({
      rating: {
        ...rating,
        value: Math.max(400, Math.min(3000, Math.round(Number(rating.value) || 1800))),
      },
    });
    haptic(20);
    setSheet(null);
    toast("Rating saved for this profile", "ok");
  };

  const enableNotifications = async () => {
    if (!notificationsSupported()) {
      toast("This browser does not support notifications", "bad");
      return;
    }
    const permission = await requestNotificationPermission();
    if (permission === "granted") toast("Browser notifications enabled", "ok");
    else if (permission === "denied") toast("Notifications are blocked in the browser", "bad");
    else toast("Notification permission was not granted", "info");
  };

  const resetLearning = async () => {
    if (!repertoires.length) {
      toast("No repertoires to reset", "info");
      return;
    }
    if (!window.confirm("Reset all learning progress? Saved moves and notes are kept.")) return;
    try {
      for (const repertoire of repertoires) {
        await api.post(`/repertoires/${repertoire.id}/reset`);
      }
      await refresh();
      toast("Learning progress reset", "ok");
    } catch (e: any) {
      toast(e.message, "bad");
    }
  };

  const resetPreferences = () => {
    if (!window.confirm("Reset rating, coverage, review, board, sound and notification preferences?"))
      return;
    resetClientPrefs();
    setPrefs(getClientPrefs());
    setRating(getClientPrefs().rating);
    toast("Preferences reset", "ok");
  };

  const animationLabel =
    ANIMATION_OPTIONS.find((option) => option.value === prefs.animation)?.label ?? "Normal";
  const recSizeLabel =
    RECOMMENDED_SIZE_OPTIONS.find((option) => option.value === prefs.recommendedMovesSize)?.label ??
    "Comfortable";
  const pauseLabel =
    PAUSE_OPTIONS.find((option) => option.value === prefs.pauseAfterMove)?.label ?? "Never";
  const practiceLabel =
    PRACTICE_OPTIONS.find((option) => option.value === prefs.practiceMode)?.label ??
    "Individual moves";
  const reviewLabel =
    REVIEW_OPTIONS.find((option) => option.value === prefs.reviewStyle)?.label ?? "Cards";
  const modelLabel =
    MODEL_SOURCES.find((option) => option.value === (settings.modelSource ?? "historical"))?.label ??
    "Historical and master games";
  const notificationsOn = Object.values(prefs.notifications).filter(Boolean).length;
  const soundLabel = settings.sound ? `On · ${prefs.soundVolume}%` : "Off";
  const themeLabel =
    settings.boardTheme === "green"
      ? "Chessbook"
      : settings.boardTheme === "blue"
        ? "Chessbook blue"
        : "Lichess brown";

  return (
    <div className="cb-app">
      <main className="cb-main">
        <section className="cb-board-col">
          <BoardHeader items={[{ label: "Settings" }]} />
          <Board
            fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
            theme={settings.boardTheme}
            coordinates={settings.coordinates}
            showLegalMoves={settings.legalMoves}
          />
        </section>

        <Sidebar backTo="/" backLabel="Back">
          <div className="cb-page-head">
            <h1 className="cb-page-title">Settings</h1>
            <p className="cb-page-sub">
              Stored in the local database or on this device — there is no account or subscription.
            </p>
          </div>

          <div className="cb-settings-list">
            <SettingRow label="Your rating" value={ratingValueLabel(prefs.rating)} onClick={openRating} />
            <SettingRow
              label="Cover positions seen in"
              value={`1 in ${prefs.coverageGoal} games`}
              onClick={() => setSheet("coverage")}
            />
            <SettingRow label="Model games source" value={modelLabel} onClick={() => setSheet("modelSource")} />
          </div>

          <div className="cb-settings-section">
            <div className="cb-settings-head">Review settings</div>
            <div className="cb-settings-list">
              <SettingRow label="Practice" value={practiceLabel} onClick={() => setSheet("practice")} />
              <SettingRow label="Review style" value={reviewLabel} onClick={() => setSheet("review")} />
              <SettingRow
                label="Daily practice goal"
                value={`${settings.dailyGoal} moves`}
                onClick={() => setSheet("goal")}
              />
              <SettingRow
                label="Pause after playing a move"
                value={pauseLabel}
                onClick={() => setSheet("pause")}
              />
              <SwitchRow
                title="Pause on fail"
                detail="Hold the position after a wrong move"
                checked={prefs.pauseOnFail}
                onChange={(next) => updatePrefs({ pauseOnFail: next })}
              />
              <SwitchRow
                title="Pause when there's a note"
                detail="Stop before a position that has a saved note"
                checked={prefs.pauseWhenNote}
                onChange={(next) => updatePrefs({ pauseWhenNote: next })}
              />
              <SwitchRow
                title="Pause on low score"
                detail="Stop when the session accuracy drops"
                checked={prefs.pauseOnLowScore}
                onChange={(next) => updatePrefs({ pauseOnLowScore: next })}
              />
            </div>
          </div>

          <div className="cb-settings-section">
            <div className="cb-settings-head">Notifications</div>
            <div className="cb-settings-list">
              <SettingRow
                label="Practice and streak reminders"
                value={`${notificationsOn} of 4 on`}
                onClick={() => setSheet("notifications")}
              />
            </div>
          </div>

          <div className="cb-settings-section">
            <div className="cb-settings-head">Board settings</div>
            <div className="cb-settings-list">
              <SettingRow label="Appearance" value={themeLabel} onClick={() => setSheet("appearance")} />
              <SettingRow label="Piece animation" value={animationLabel} onClick={() => setSheet("animation")} />
              <SettingRow label="Sound effects" value={soundLabel} onClick={() => setSheet("sound")} />
              <SwitchRow
                title="Haptics"
                detail="Vibrate on actions when the device supports it"
                checked={prefs.haptics}
                onChange={(next) => {
                  updatePrefs({ haptics: next });
                  if (next) haptic(24);
                }}
              />
              <SettingRow
                label="Recommended moves size"
                value={recSizeLabel}
                onClick={() => setSheet("recsize")}
              />
            </div>
          </div>

          <div className="cb-settings-section">
            <div className="cb-settings-head">Games and data</div>
            <div className="cb-settings-list">
              <SettingRow
                label="Import a PGN file"
                value="Local file"
                onClick={() => navigate("/add?tab=import")}
              />
              <SettingRow label="Reset all learning" value="" onClick={resetLearning} />
              <SettingRow label="Reset preferences" value="" onClick={resetPreferences} />
            </div>
          </div>
        </Sidebar>
      </main>

      {sheet === "rating" && (
        <Sheet
          title="Your rating"
          onClose={() => setSheet(null)}
          footer={
            <>
              <button type="button" className="cb-btn" onClick={() => setSheet(null)}>
                Cancel
              </button>
              <button type="button" className="cb-btn primary" onClick={commitRating}>
                Save rating
              </button>
            </>
          }
        >
          <p className="cb-inline-note">
            Used for the rating band shown next to opening statistics. Opening data was captured
            for the 1800–2000 Chess.com band; other bands are not synthesised.
          </p>
          <div className="cb-add-label">Platform</div>
          <div className="cb-settings-list">
            {PLATFORMS.map((platform) => (
              <ChoiceRow
                key={platform}
                label={platform}
                active={rating.system === platform}
                onClick={() => setRating({ ...rating, system: platform as Platform })}
              />
            ))}
          </div>
          <div className="cb-add-label">Time control</div>
          <div className="cb-settings-list">
            {TIME_CONTROLS.map((control) => (
              <ChoiceRow
                key={control}
                label={control}
                active={rating.timeControl === control}
                onClick={() => setRating({ ...rating, timeControl: control as TimeControl })}
              />
            ))}
          </div>
          <div className="cb-add-label">Rating</div>
          <input
            className="cb-input"
            type="number"
            min={400}
            max={3000}
            step={25}
            value={rating.value}
            onChange={(e) => setRating({ ...rating, value: Number(e.target.value) })}
          />
          <div className="cb-range-labels" style={{ marginTop: 8 }}>
            <span>Band</span>
            <strong>
              {bandFor(rating.value)} {rating.system}
            </strong>
          </div>
        </Sheet>
      )}

      {sheet === "coverage" && (
        <Sheet title="Cover positions seen in" onClose={() => setSheet(null)}>
          <p className="cb-inline-note">
            Moves rarer than 1 in {prefs.coverageGoal} games are candidates for trimming. The same
            goal feeds “Trim moves past your goal” in a repertoire.
          </p>
          <div className="cb-settings-list">
            {COVERAGE_OPTIONS.map((option) => (
              <ChoiceRow
                key={option}
                label={`1 in ${option} games`}
                detail={
                  option <= 50
                    ? "Trims only very rare sidelines"
                    : option >= 500
                      ? "Keeps only common moves; aggressive trim"
                      : "Balanced breadth"
                }
                active={prefs.coverageGoal === option}
                onClick={() => {
                  haptic();
                  updatePrefs({ coverageGoal: option });
                }}
              />
            ))}
          </div>
        </Sheet>
      )}

      {sheet === "practice" && (
        <Sheet title="Practice mode" onClose={() => setSheet(null)}>
          <div className="cb-settings-list">
            {PRACTICE_OPTIONS.map((option) => (
              <ChoiceRow
                key={option.value}
                label={option.label}
                detail={option.detail}
                active={prefs.practiceMode === option.value}
                onClick={() => {
                  haptic();
                  updatePrefs({ practiceMode: option.value });
                }}
              />
            ))}
          </div>
        </Sheet>
      )}

      {sheet === "review" && (
        <Sheet title="Review style" onClose={() => setSheet(null)}>
          <div className="cb-settings-list">
            {REVIEW_OPTIONS.map((option) => (
              <ChoiceRow
                key={option.value}
                label={option.label}
                detail={option.detail}
                active={prefs.reviewStyle === option.value}
                onClick={() => {
                  haptic();
                  updatePrefs({ reviewStyle: option.value });
                }}
              />
            ))}
          </div>
        </Sheet>
      )}

      {sheet === "goal" && (
        <Sheet title="Daily practice goal" onClose={() => setSheet(null)}>
          <p className="cb-inline-note">
            Counts reviewed moves today. The dashboard progress bar and streak reminder use this
            value.
          </p>
          <div className="cb-radio-row">
            {DAILY_GOAL_OPTIONS.map((goal) => (
              <button
                type="button"
                key={goal}
                className={`cb-radio ${settings.dailyGoal === goal ? "active" : ""}`}
                onClick={() => void save({ dailyGoal: goal })}
              >
                {goal}
              </button>
            ))}
          </div>
          <div className="cb-range-labels" style={{ marginTop: 10 }}>
            <span>Current goal</span>
            <strong>{settings.dailyGoal} moves</strong>
          </div>
        </Sheet>
      )}

      {sheet === "pause" && (
        <Sheet title="Pause after playing a move" onClose={() => setSheet(null)}>
          <div className="cb-settings-list">
            {PAUSE_OPTIONS.map((option) => (
              <ChoiceRow
                key={option.value}
                label={option.label}
                active={prefs.pauseAfterMove === option.value}
                onClick={() => {
                  haptic();
                  updatePrefs({ pauseAfterMove: option.value });
                }}
              />
            ))}
          </div>
        </Sheet>
      )}

      {sheet === "notifications" && (
        <Sheet title="Notifications" onClose={() => setSheet(null)}>
          <p className="cb-inline-note">
            Local-first build: reminders use the browser notification API on this device. No email,
            no server, no account.
          </p>
          <SwitchRow
            title="Daily practice reminder"
            detail="Notify once a day when the practice goal is not met"
            checked={prefs.notifications.dailyPractice}
            onChange={(next) => updatePrefs({ notifications: { ...prefs.notifications, dailyPractice: next } })}
          />
          <SwitchRow
            title="Streak reminder"
            detail="Notify when a day with a live streak has no reviews"
            checked={prefs.notifications.streak}
            onChange={(next) => updatePrefs({ notifications: { ...prefs.notifications, streak: next } })}
          />
          <SwitchRow
            title="New model game"
            detail="Notify about the daily model game"
            checked={prefs.notifications.modelGame}
            onChange={(next) => updatePrefs({ notifications: { ...prefs.notifications, modelGame: next } })}
          />
          <SwitchRow
            title="Mistake review"
            detail="Notify when a saved move becomes due again"
            checked={prefs.notifications.mistakes}
            onChange={(next) => updatePrefs({ notifications: { ...prefs.notifications, mistakes: next } })}
          />
          <div style={{ marginTop: 14 }}>
            {!notificationsSupported() ? (
              <p className="cb-inline-note">
                This browser does not expose notifications. The switches are stored and will apply
                when supported.
              </p>
            ) : Notification.permission === "granted" ? (
              <p className="cb-inline-note">
                <i className="fa fa-check" aria-hidden /> Browser permission granted
              </p>
            ) : (
              <button type="button" className="cb-btn" onClick={() => void enableNotifications()}>
                {Notification.permission === "denied"
                  ? "Permission blocked — check browser settings"
                  : "Allow browser notifications"}
              </button>
            )}
          </div>
        </Sheet>
      )}

      {sheet === "appearance" && (
        <Sheet title="Board appearance" onClose={() => setSheet(null)}>
          <div className="cb-theme-grid">
            {(
              [
                { value: "green", label: "Chessbook" },
                { value: "blue", label: "Chessbook blue" },
                { value: "brown", label: "Lichess brown" },
              ] as const
            ).map((theme) => (
              <button
                type="button"
                key={theme.value}
                className={`cb-theme ${settings.boardTheme === theme.value ? "active" : ""}`}
                onClick={() => {
                  haptic();
                  void save({ boardTheme: theme.value });
                }}
              >
                <span className={`cb-theme-preview ${theme.value === "green" ? "" : theme.value}`}>
                  <span />
                  <span />
                  <span />
                  <span />
                </span>
                {theme.label}
              </button>
            ))}
          </div>
          <div className="cb-settings-list" style={{ marginTop: 14 }}>
            <ChoiceRow
              label="Piece set: Chessbook Monochrome"
              detail="The only piece set bundled with this local build"
              active
              onClick={() =>
                toast("Additional piece sets are not bundled in this build", "info")
              }
            />
          </div>
        </Sheet>
      )}

      {sheet === "animation" && (
        <Sheet title="Piece animation" onClose={() => setSheet(null)}>
          <div className="cb-settings-list">
            {ANIMATION_OPTIONS.map((option) => (
              <ChoiceRow
                key={option.value}
                label={option.label}
                active={prefs.animation === option.value}
                onClick={() => {
                  haptic();
                  updatePrefs({ animation: option.value as AnimationSpeed });
                }}
              />
            ))}
          </div>
        </Sheet>
      )}

      {sheet === "sound" && (
        <Sheet title="Sound effects" onClose={() => setSheet(null)}>
          <SwitchRow
            title="Sound effects"
            detail="Move, capture, check and feedback sounds"
            checked={settings.sound}
            onChange={(next) => void toggle("sound", next)}
          />
          <div className="cb-add-label">Volume</div>
          <input
            className="cb-range"
            type="range"
            min={0}
            max={100}
            step={5}
            value={prefs.soundVolume}
            onChange={(e) => {
              const value = Number(e.target.value);
              updatePrefs({ soundVolume: value });
            }}
            onMouseUp={() => previewSound("move")}
            aria-label="Sound volume"
          />
          <div className="cb-range-labels">
            <span>Quiet</span>
            <strong>{prefs.soundVolume}%</strong>
            <span>Loud</span>
          </div>
          <div className="cb-settings-list" style={{ marginTop: 12 }}>
            {SOUND_LABELS.map((sound) => (
              <SwitchRow
                key={sound.name}
                title={sound.label}
                detail={`Preview at ${prefs.soundVolume}%`}
                checked={prefs.soundEffects[sound.name]}
                onChange={(next) => {
                  updatePrefs({ soundEffects: { ...prefs.soundEffects, [sound.name]: next } });
                  if (next) previewSound(sound.name as SoundName);
                }}
              />
            ))}
          </div>
        </Sheet>
      )}

      {sheet === "recsize" && (
        <Sheet title="Recommended moves size" onClose={() => setSheet(null)}>
          <p className="cb-inline-note">
            Controls the density of the move recommendation list in the builder, gap finder and add
            flow.
          </p>
          <div className="cb-settings-list">
            {RECOMMENDED_SIZE_OPTIONS.map((option) => (
              <ChoiceRow
                key={option.value}
                label={option.label}
                active={prefs.recommendedMovesSize === option.value}
                onClick={() => {
                  haptic();
                  updatePrefs({ recommendedMovesSize: option.value as RecommendedMovesSize });
                }}
              />
            ))}
          </div>
        </Sheet>
      )}

      {sheet === "modelSource" && (
        <Sheet title="Model games source" onClose={() => setSheet(null)}>
          <div className="cb-settings-list">
            {MODEL_SOURCES.map((option) => (
              <ChoiceRow
                key={option.value}
                label={option.label}
                detail={option.detail}
                active={(settings.modelSource ?? "historical") === option.value}
                onClick={() => void save({ modelSource: option.value })}
              />
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ pieces --- */

function bandFor(value: number) {
  const low = Math.max(400, Math.floor(value / 200) * 200);
  return `${low}–${low + 200}`;
}

function ratingValueLabel(rating: { system: Platform; timeControl: TimeControl; value: number }) {
  return `${rating.value} · ${rating.system} ${rating.timeControl}`;
}

function SettingRow({
  label,
  value,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Row
      title={label}
      right={value ? <span className="cb-setting-value">{value}</span> : undefined}
      onClick={onClick}
      className="cb-settings-row"
    />
  );
}

function ChoiceRow({
  label,
  detail,
  active,
  onClick,
}: {
  label: string;
  detail?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <Row
      title={label}
      meta={detail}
      className={`cb-settings-row ${active ? "selected" : ""}`}
      right={active ? <i className="fa fa-check" aria-hidden /> : undefined}
      onClick={onClick}
    />
  );
}

function SwitchRow({
  title,
  detail,
  checked,
  onChange,
}: {
  title: string;
  detail?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="cb-switch-row">
      <span className="cb-switch-label">
        <strong>{title}</strong>
        {detail && <span>{detail}</span>}
      </span>
      <span className="cb-switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="cb-switch-track" />
      </span>
    </label>
  );
}

function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        footer ?? (
          <button type="button" className="cb-btn" onClick={onClose}>
            Done
          </button>
        )
      }
    >
      {children}
    </Modal>
  );
}
