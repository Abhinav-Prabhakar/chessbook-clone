import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import type { Settings } from "../types";
import { Board } from "../components/Board";
import {
  Breadcrumb,
  Modal,
  Row,
  Section,
  Sidebar,
  Splash,
  Stat,
} from "../components/ui";
import { useAuth } from "../auth";
import { useToast } from "../components/Toast";
import { applySettingsPrefs } from "../prefs";

type Tab = "overview" | "account" | "training" | "board" | "connections" | "billing";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "fa-sliders" },
  { id: "account", label: "Account", icon: "fa-user" },
  { id: "training", label: "Training", icon: "fa-brain" },
  { id: "board", label: "Board", icon: "fa-chess-board" },
  { id: "connections", label: "Connections", icon: "fa-link" },
  { id: "billing", label: "Billing", icon: "fa-credit-card" },
];

export function SettingsPage() {
  const { user, setUser, logout } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("overview");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [name, setName] = useState(user?.name ?? "");
  const [savingName, setSavingName] = useState(false);
  const [connect, setConnect] = useState<"lichess" | "chesscom" | null>(null);
  const [username, setUsername] = useState("");
  const [lichess, setLichess] = useState(() => localStorage.getItem("cb_lichess") ?? "");
  const [chesscom, setChesscom] = useState(() => localStorage.getItem("cb_chesscom") ?? "");
  const [rating, setRating] = useState(() => localStorage.getItem("cb_rating") ?? "1800-2000 Chess.com");
  const [cover, setCover] = useState(() => localStorage.getItem("cb_cover") ?? "1 in 200 games");
  const [pause, setPause] = useState(() => localStorage.getItem("cb_pause") ?? "Never");
  const [animation, setAnimation] = useState(() => localStorage.getItem("cb_animation") ?? "Fast");
  const [haptics, setHaptics] = useState(() => localStorage.getItem("cb_haptics") ?? "Enabled");
  const [practiceMode, setPracticeMode] = useState(
    () => localStorage.getItem("cb_practice_mode") ?? "Individual moves"
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

  useEffect(() => {
    if (user) setName(user.name);
  }, [user]);

  if (!settings || !user) return <Splash label="Loading settings…" />;

  const cycle = (
    key: string,
    values: string[],
    current: string,
    update: (value: string) => void
  ) => {
    const index = values.indexOf(current);
    const next = values[(index + 1) % values.length];
    localStorage.setItem(key, next);
    update(next);
    toast(`${next}`, "info");
  };

  const save = async (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      const r = await api.patch<{ settings: Settings }>("/settings", patch);
      setSettings(r.settings);
      applySettingsPrefs(r.settings);
    } catch (e: any) {
      toast(e.message, "bad");
    }
  };

  const saveName = async () => {
    if (!name.trim()) return;
    setSavingName(true);
    try {
      const r = await api.patch<{ user: typeof user }>("/user", { name });
      setUser(r.user);
      toast("Profile updated", "ok");
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setSavingName(false);
    }
  };

  const resetRepertoire = async (color: "white" | "black") => {
    if (!window.confirm(`Reset all progress in your ${color} repertoire? This cannot be undone.`)) {
      return;
    }
    try {
      await api.post(`/repertoires/${color}/reset`);
      toast(`${color === "white" ? "White" : "Black"} repertoire reset`, "info");
    } catch (e: any) {
      toast(e.message, "bad");
    }
  };

  const connectAccount = () => {
    if (!connect || !username.trim()) return;
    localStorage.setItem(`cb_${connect}`, username.trim());
    if (connect === "lichess") setLichess(username.trim());
    else setChesscom(username.trim());
    toast(`${connect === "lichess" ? "Lichess" : "Chess.com"} account connected`, "ok");
    setConnect(null);
    setUsername("");
  };

  const disconnect = (which: "lichess" | "chesscom") => {
    localStorage.removeItem(`cb_${which}`);
    if (which === "lichess") setLichess("");
    else setChesscom("");
    toast("Account disconnected", "info");
  };

  const signOut = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="cb-app">
      <header className="cb-topbar">
        <Link to="/" className="cb-logo" aria-label="Chessbook home">
          <img src="/homepage_imgs/chessbook.svg" alt="Chessbook" />
        </Link>
        <div className="cb-top-actions">
          <span className="cb-plan-pill">{user.plan.toUpperCase()}</span>
          <Link to="/" className="cb-top-link">
            Dashboard
          </Link>
        </div>
      </header>

      <main className="cb-main">
        <section className="cb-board-col">
          <Board
            fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
            theme={settings.boardTheme}
            coordinates={settings.coordinates}
          />
          <div className="cb-board-footer">
            <span>
              Board preview · {settings.boardTheme} · coordinates {settings.coordinates ? "on" : "off"}
            </span>
          </div>
        </section>

        <Sidebar backTo="/" backLabel="Back">
          <Breadcrumb items={[{ label: "Account", to: "/" }, { label: "Settings" }]} />
          <div className="cb-page-head" style={{ paddingTop: 0 }}>
            <h1 className="cb-page-title">Settings</h1>
            <p className="cb-page-sub">Tune your training, board, and connected accounts.</p>
          </div>

          <div className="cb-tabs scroll">
            {TABS.map((t) => (
              <button
                type="button"
                key={t.id}
                className={`cb-tab ${tab === t.id ? "active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                <i className={`fa ${t.icon}`} aria-hidden /> {t.label}
              </button>
            ))}
          </div>

          {tab === "overview" && (
            <>
              <Section title="Preferences">
                <SettingValueRow
                  label="Your rating"
                  value={rating}
                  onClick={() =>
                    cycle(
                      "cb_rating",
                      [
                        "1200-1400 Chess.com",
                        "1400-1600 Chess.com",
                        "1600-1800 Chess.com",
                        "1800-2000 Chess.com",
                        "2000-2200 Chess.com",
                        "2200+ Chess.com",
                      ],
                      rating,
                      setRating
                    )
                  }
                />
                <SettingValueRow
                  label="Cover positions seen in"
                  value={cover}
                  onClick={() =>
                    cycle(
                      "cb_cover",
                      ["1 in 50 games", "1 in 100 games", "1 in 200 games", "1 in 500 games"],
                      cover,
                      setCover
                    )
                  }
                />
                <SettingValueRow
                  label="Connected to"
                  value={
                    <span className="cb-setting-inline">
                      <span>
                        Lichess <i className={`fa ${lichess ? "fa-check" : "fa-xmark"}`} />
                      </span>
                      <span>
                        Chess.com <i className={`fa ${chesscom ? "fa-check" : "fa-xmark"}`} />
                      </span>
                    </span>
                  }
                  onClick={() => setTab("connections")}
                />
                <SettingValueRow
                  label="Model games source"
                  value="Online and master games"
                  onClick={() => navigate("/model")}
                />
                <SettingValueRow
                  label="Early access features"
                  value="None enabled"
                  onClick={() => toast("Early access features are not enabled.", "info")}
                />
              </Section>

              <Section title="Review settings">
                <SettingValueRow
                  label="Practice"
                  value={practiceMode}
                  onClick={() =>
                    cycle(
                      "cb_practice_mode",
                      ["Individual moves", "Full lines"],
                      practiceMode,
                      setPracticeMode
                    )
                  }
                />
                <SettingValueRow
                  label="Daily practice goal"
                  value={`${settings.dailyGoal} moves`}
                  onClick={() => setTab("training")}
                />
                <SettingValueRow
                  label="Pause after playing a move"
                  value={pause}
                  onClick={() => cycle("cb_pause", ["Never", "0.5 seconds", "1 second", "2 seconds"], pause, setPause)}
                />
              </Section>

              <Section title="Board settings">
                <SettingValueRow
                  label="Appearance"
                  value={
                    settings.boardTheme[0].toUpperCase() + settings.boardTheme.slice(1)
                  }
                  onClick={() => setTab("board")}
                />
                <SettingValueRow
                  label="Piece animation"
                  value={animation}
                  onClick={() => cycle("cb_animation", ["Fast", "Normal", "Slow", "None"], animation, setAnimation)}
                />
                <SettingValueRow
                  label="Sound effects"
                  value={settings.sound ? "Enabled" : "Disabled"}
                  onClick={() => save({ sound: !settings.sound })}
                />
                <SettingValueRow
                  label="Haptics"
                  value={haptics}
                  onClick={() => cycle("cb_haptics", ["Enabled", "Disabled"], haptics, setHaptics)}
                />
              </Section>

              <Section title="Subscription">
                <SettingValueRow
                  label="Plan"
                  value="Chessbook Pro"
                  onClick={() => setTab("billing")}
                />
                <SettingValueRow
                  label="Manage account"
                  value="Profile, reset, sign out"
                  onClick={() => setTab("account")}
                />
              </Section>
            </>
          )}

          {tab === "account" && (
            <>
              <Section title="Profile">
                <div className="cb-form" style={{ padding: 0 }}>
                  <div className="cb-field">
                    <label htmlFor="settings-name">Display name</label>
                    <input
                      id="settings-name"
                      className="cb-input"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="cb-field">
                    <label htmlFor="settings-email">Email</label>
                    <input id="settings-email" className="cb-input" value={user.email} disabled />
                  </div>
                  <button
                    type="button"
                    className="cb-btn primary"
                    onClick={saveName}
                    disabled={savingName || !name.trim() || name === user.name}
                  >
                    {savingName ? "Saving…" : "Save profile"}
                  </button>
                </div>
              </Section>

              <Section title="Plan">
                <div className="cb-plan-card">
                  <div>
                    <span className="cb-plan-kicker">Current plan</span>
                    <strong>Chessbook Pro</strong>
                    <p>Unlimited repertoires, model games, and progress tracking.</p>
                  </div>
                  <button
                    type="button"
                    className="cb-btn small"
                    onClick={() => {
                      setTab("billing");
                      toast("Billing details are in the Billing tab", "info");
                    }}
                  >
                    Manage
                  </button>
                </div>
              </Section>

              <Section title="Progress">
                <Row
                  title="Reset white repertoire progress"
                  meta="Keeps every line, clears learning history"
                  onClick={() => resetRepertoire("white")}
                />
                <Row
                  title="Reset black repertoire progress"
                  meta="Keeps every line, clears learning history"
                  onClick={() => resetRepertoire("black")}
                />
              </Section>

              <Section title="Session">
                <Row title="Sign out" onClick={signOut} />
              </Section>
            </>
          )}

          {tab === "training" && (
            <>
              <Section title="Daily goal">
                <div className="cb-form" style={{ padding: 0 }}>
                  <div className="cb-field">
                    <label htmlFor="daily-goal">Positions per day</label>
                    <input
                      id="daily-goal"
                      type="range"
                      min={5}
                      max={50}
                      step={5}
                      value={settings.dailyGoal}
                      onChange={(e) => save({ dailyGoal: Number(e.target.value) })}
                      className="cb-range"
                    />
                    <div className="cb-range-labels">
                      <span>5</span>
                      <strong>{settings.dailyGoal} positions</strong>
                      <span>50</span>
                    </div>
                  </div>
                </div>
              </Section>

              <Section title="Training options">
                <div className="cb-form" style={{ padding: 0 }}>
                  <Switch
                    label="Legal move hints"
                    hint="Show dots for the moves that are legal"
                    checked={settings.legalMoves}
                    onChange={(v) => save({ legalMoves: v })}
                  />
                  <Switch
                    label="Show hints"
                    hint="Reveal repertoire context before you answer"
                    checked={settings.showHints}
                    onChange={(v) => save({ showHints: v })}
                  />
                  <Switch
                    label="Sound effects"
                    hint="Play a short tone after each attempt"
                    checked={settings.sound}
                    onChange={(v) => save({ sound: v })}
                  />
                </div>
              </Section>

              <Section title="Training stats">
                <div className="cb-stat-grid" style={{ padding: 0 }}>
                  <Stat value={settings.dailyGoal} label="Daily goal" />
                  <Stat value="3d" label="Correct interval" />
                  <Stat value="30d" label="Mastered interval" />
                </div>
              </Section>
            </>
          )}

          {tab === "board" && (
            <>
              <Section title="Board theme">
                <div className="cb-form" style={{ padding: 0 }}>
                  <div className="cb-theme-grid">
                    {(["green", "blue", "brown"] as const).map((theme) => (
                      <button
                        type="button"
                        key={theme}
                        className={`cb-theme ${settings.boardTheme === theme ? "active" : ""}`}
                        onClick={() => save({ boardTheme: theme })}
                      >
                        <span className={`cb-theme-preview ${theme}`}>
                          <span />
                          <span />
                          <span />
                          <span />
                        </span>
                        <span>{theme[0].toUpperCase() + theme.slice(1)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </Section>

              <Section title="Board options">
                <div className="cb-form" style={{ padding: 0 }}>
                  <Switch
                    label="Coordinates"
                    hint="Show files and ranks around the board"
                    checked={settings.coordinates}
                    onChange={(v) => save({ coordinates: v })}
                  />
                  <Switch
                    label="Legal move indicators"
                    hint="Highlight legal destination squares"
                    checked={settings.legalMoves}
                    onChange={(v) => save({ legalMoves: v })}
                  />
                </div>
              </Section>

              <Section title="Preview">
                <div className="cb-panel">
                  <p>
                    The board on the left updates live. Themes affect both your dashboard and
                    training boards.
                  </p>
                </div>
              </Section>
            </>
          )}

          {tab === "connections" && (
            <>
              <Section title="Connected accounts">
                <div className="cb-connection">
                  <div className="cb-connection-icon lichess">L</div>
                  <div className="cb-connection-main">
                    <strong>Lichess</strong>
                    <span>{lichess ? `@${lichess}` : "Not connected"}</span>
                  </div>
                  {lichess ? (
                    <button type="button" className="cb-btn small ghost" onClick={() => disconnect("lichess")}>
                      Disconnect
                    </button>
                  ) : (
                    <button type="button" className="cb-btn small" onClick={() => setConnect("lichess")}>
                      Connect
                    </button>
                  )}
                </div>
                <div className="cb-connection">
                  <div className="cb-connection-icon chesscom">C</div>
                  <div className="cb-connection-main">
                    <strong>Chess.com</strong>
                    <span>{chesscom ? `@${chesscom}` : "Not connected"}</span>
                  </div>
                  {chesscom ? (
                    <button type="button" className="cb-btn small ghost" onClick={() => disconnect("chesscom")}>
                      Disconnect
                    </button>
                  ) : (
                    <button type="button" className="cb-btn small" onClick={() => setConnect("chesscom")}>
                      Connect
                    </button>
                  )}
                </div>
              </Section>

              <Section title="Why connect?">
                <div className="cb-panel">
                  <h3 className="cb-panel-title">Review your opening mistakes</h3>
                  <p>
                    Connected accounts let Chessbook find games where you left your repertoire,
                    flag the exact move, and add the correction straight to your training queue.
                  </p>
                </div>
              </Section>
            </>
          )}

          {tab === "billing" && (
            <>
              <Section title="Subscription">
                <div className="cb-plan-card">
                  <div>
                    <span className="cb-plan-kicker">Chessbook Pro · monthly</span>
                    <strong>$7.99 / month</strong>
                    <p>Renews automatically. Cancel anytime from this page.</p>
                  </div>
                  <span className="cb-status-pill">Active</span>
                </div>
              </Section>
              <Section title="Payment method">
                <Row
                  title="Visa ending in 4242"
                  meta="Expires 09/29"
                  right={<span className="cb-row-meta">Default</span>}
                  onClick={() => toast("Card management is handled by Stripe in production.", "info")}
                />
              </Section>
              <Section title="Invoices">
                <Row title="October 2026" meta="$7.99 · Paid" onClick={() => toast("Invoice download", "info")} />
                <Row title="September 2026" meta="$7.99 · Paid" onClick={() => toast("Invoice download", "info")} />
                <Row title="August 2026" meta="$7.99 · Paid" onClick={() => toast("Invoice download", "info")} />
              </Section>
              <div className="cb-actions" style={{ marginTop: 18 }}>
                <button
                  type="button"
                  className="cb-btn danger"
                  onClick={() => toast("Subscription changes are disabled in the demo.", "info")}
                >
                  Cancel subscription
                </button>
              </div>
            </>
          )}
        </Sidebar>
      </main>

      {connect && (
        <Modal
          title={`Connect ${connect === "lichess" ? "Lichess" : "Chess.com"}`}
          onClose={() => setConnect(null)}
          footer={
            <>
              <button type="button" className="cb-btn ghost" onClick={() => setConnect(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="cb-btn primary"
                onClick={connectAccount}
                disabled={!username.trim()}
              >
                Connect account
              </button>
            </>
          }
        >
          <div className="cb-field">
            <label htmlFor="connection-username">Username</label>
            <input
              id="connection-username"
              className="cb-input"
              autoFocus
              placeholder={connect === "lichess" ? "e.g. DrNykterstein" : "e.g. Hikaru"}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && connectAccount()}
            />
          </div>
          <p className="cb-row-meta">
            This demo stores the connection locally. In production, Chessbook uses the platform
            OAuth flow to import your games.
          </p>
        </Modal>
      )}
    </div>
  );
}

function SettingValueRow({
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
      onClick={onClick}
      right={<span className="cb-setting-value">{value}</span>}
    />
  );
}

function Switch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="cb-switch-row">
      <div className="cb-switch-label">
        <strong>{label}</strong>
        <span>{hint}</span>
      </div>
      <label className="cb-switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="cb-switch-track" />
      </label>
    </div>
  );
}
