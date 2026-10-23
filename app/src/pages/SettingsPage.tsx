import { useEffect, useState } from "react";
import { api } from "../api";
import type { Settings } from "../types";
import { Board } from "../components/Board";
import { BoardHeader, Row, Sidebar, Splash } from "../components/ui";
import { useToast } from "../components/Toast";
import { applySettingsPrefs } from "../prefs";

const RATINGS = [
  "1200-1400 Chess.com",
  "1400-1600 Chess.com",
  "1600-1800 Chess.com",
  "1800-2000 Chess.com",
  "2000-2200 Chess.com",
  "2200+ Chess.com",
];

const COVERAGE = ["1 in 50 games", "1 in 100 games", "1 in 200 games", "1 in 500 games"];
const PAUSE = ["Never", "1 second", "2 seconds"];
const ANIMATION = ["Fast", "Normal", "Off"];
const HAPTICS = ["Enabled", "Disabled"];
const PRACTICE = ["Individual moves", "Whole lines"];
const GOALS = [10, 20, 30, 40, 50];

export function SettingsPage() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rating, setRating] = useState(() => localStorage.getItem("cb_rating") ?? RATINGS[3]);
  const [cover, setCover] = useState(() => localStorage.getItem("cb_cover") ?? COVERAGE[2]);
  const [pause, setPause] = useState(() => localStorage.getItem("cb_pause") ?? PAUSE[0]);
  const [animation, setAnimation] = useState(
    () => localStorage.getItem("cb_animation") ?? ANIMATION[0]
  );
  const [haptics, setHaptics] = useState(
    () => localStorage.getItem("cb_haptics") ?? HAPTICS[0]
  );
  const [practiceMode, setPracticeMode] = useState(
    () => localStorage.getItem("cb_practice_mode") ?? PRACTICE[0]
  );

  useEffect(() => {
    api
      .get<{ settings: Settings }>("/settings")
      .then((r) => {
        setSettings(r.settings);
        applySettingsPrefs(r.settings);
      })
      .catch((e) => toast(e.message, "bad"));
  }, [toast]);

  if (!settings) return <Splash label="Loading settings…" />;

  const cycle = (
    key: string,
    values: string[],
    current: string,
    update: (value: string) => void,
    label = values[0]
  ) => {
    const index = values.indexOf(current);
    const next = values[(index + 1) % values.length];
    localStorage.setItem(key, next);
    update(next);
    toast(`${label === values[0] ? "" : ""}${next}`, "info");
  };

  const save = async (patch: Partial<Settings>) => {
    const previous = settings;
    const next = { ...settings, ...patch };
    setSettings(next);
    applySettingsPrefs(next);
    try {
      const r = await api.patch<{ settings: Settings }>("/settings", patch);
      setSettings(r.settings);
      applySettingsPrefs(r.settings);
    } catch (e: any) {
      setSettings(previous);
      applySettingsPrefs(previous);
      toast(e.message, "bad");
    }
  };

  const cycleTheme = () => {
    const order: Settings["boardTheme"][] = ["green", "blue", "brown"];
    const next = order[(order.indexOf(settings.boardTheme) + 1) % order.length];
    void save({ boardTheme: next });
    toast(next === "green" ? "Chessbook" : next === "blue" ? "Blue" : "Brown", "info");
  };

  const cycleGoal = () => {
    const index = GOALS.indexOf(settings.dailyGoal);
    const next = GOALS[(index + 1) % GOALS.length];
    void save({ dailyGoal: next });
    toast(`${next} moves`, "info");
  };

  const resetLearning = async () => {
    if (!window.confirm("Reset all learning progress in both repertoires?")) return;
    try {
      await api.post("/repertoires/white/reset");
      await api.post("/repertoires/black/reset");
      toast("Learning progress reset", "ok");
    } catch (e: any) {
      toast(e.message, "bad");
    }
  };

  const resetPreferences = () => {
    localStorage.removeItem("cb_rating");
    localStorage.removeItem("cb_cover");
    localStorage.removeItem("cb_pause");
    localStorage.removeItem("cb_animation");
    localStorage.removeItem("cb_haptics");
    localStorage.removeItem("cb_practice_mode");
    setRating(RATINGS[3]);
    setCover(COVERAGE[2]);
    setPause(PAUSE[0]);
    setAnimation(ANIMATION[0]);
    setHaptics(HAPTICS[0]);
    setPracticeMode(PRACTICE[0]);
    toast("Board and review preferences reset", "info");
  };

  const themeLabel =
    settings.boardTheme === "green"
      ? "Chessbook"
      : settings.boardTheme === "blue"
        ? "Blue"
        : "Brown";

  return (
    <div className="cb-app">
      <main className="cb-main">
        <section className="cb-board-col">
          <BoardHeader />
          <Board fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" />
        </section>

        <Sidebar backTo="/" backLabel="Back">
          <div className="cb-page-head">
            <h1 className="cb-page-title">Settings</h1>
          </div>

          <div className="cb-settings-list">
            <SettingRow
              label="Your rating"
              value={rating}
              onClick={() => cycle("cb_rating", RATINGS, rating, setRating)}
            />
            <SettingRow
              label="Cover positions seen in"
              value={cover}
              onClick={() => cycle("cb_cover", COVERAGE, cover, setCover)}
            />
            <SettingRow
              label="Connected to"
              value={
                <span className="cb-setting-connections">
                  Lichess <i className="fa fa-xmark" aria-hidden /> Chess.com{" "}
                  <i className="fa fa-xmark" aria-hidden />
                </span>
              }
              onClick={() => toast("Connections are stored on this device only.", "info")}
            />
            <SettingRow label="Model games source" value="Online and master games" onClick={() => {}} />
            <SettingRow label="Early access features" value="None enabled" onClick={() => {}} />
          </div>

          <div className="cb-settings-section">
            <div className="cb-settings-head">Review settings</div>
            <div className="cb-settings-list">
              <SettingRow
                label="Practice"
                value={practiceMode}
                onClick={() => cycle("cb_practice_mode", PRACTICE, practiceMode, setPracticeMode)}
              />
              <SettingRow label="Daily practice goal" value={`${settings.dailyGoal} moves`} onClick={cycleGoal} />
              <SettingRow
                label="Pause after playing a move"
                value={pause}
                onClick={() => cycle("cb_pause", PAUSE, pause, setPause)}
              />
            </div>
          </div>

          <div className="cb-settings-section">
            <div className="cb-settings-head">Board settings</div>
            <div className="cb-settings-list">
              <SettingRow label="Appearance" value={themeLabel} onClick={cycleTheme} />
              <SettingRow
                label="Piece animation"
                value={animation}
                onClick={() => cycle("cb_animation", ANIMATION, animation, setAnimation)}
              />
              <SettingRow
                label="Sound effects"
                value={settings.sound ? "Enabled" : "Disabled"}
                onClick={() => void save({ sound: !settings.sound })}
              />
              <SettingRow
                label="Haptics"
                value={haptics}
                onClick={() => cycle("cb_haptics", HAPTICS, haptics, setHaptics)}
              />
            </div>
          </div>

          <div className="cb-settings-section">
            <div className="cb-settings-head">Subscription</div>
            <div className="cb-settings-list">
              <SettingRow
                label="Upgrade to add unlimited moves"
                value=""
                onClick={() => toast("This local build has no subscription.", "info")}
              />
            </div>
          </div>

          <div className="cb-settings-section">
            <div className="cb-settings-head">Account</div>
            <div className="cb-settings-list">
              <SettingRow label="Reset all learning" value="" onClick={resetLearning} />
              <SettingRow label="Reset board preferences" value="" onClick={resetPreferences} />
            </div>
          </div>
        </Sidebar>
      </main>
    </div>
  );
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
