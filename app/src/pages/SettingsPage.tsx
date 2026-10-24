import { useState } from "react";
import { api } from "../api";
import { Crumbs, useBoard } from "../board/stage";
import { replay } from "../chess";
import { useSettings } from "../settings";
import type { Settings } from "../types";
import { forgetAll } from "../useApi";
import { Back, Button, Icon, Modal, PageHead, Row, Section, useToast } from "../ui";

const SAMPLE = replay(["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3"]);

const SYSTEMS: { id: Settings["ratingSystem"]; label: string }[] = [
  { id: "chesscom", label: "Chess.com" },
  { id: "lichess", label: "Lichess" },
  { id: "fide", label: "FIDE" },
];

const THEMES: { id: Settings["boardTheme"]; label: string; colors: [string, string] }[] = [
  { id: "green", label: "Green", colors: ["#6aa169", "#3f835c"] },
  { id: "blue", label: "Blue", colors: ["#8fb3cf", "#577a96"] },
  { id: "brown", label: "Brown", colors: ["#d9b48c", "#a77852"] },
  { id: "gray", label: "Gray", colors: ["#b9bec4", "#7c858d"] },
  { id: "purple", label: "Purple", colors: ["#a99bc7", "#7465a0"] },
];

const PIECES = [
  { id: "chessbook_monochrome", label: "Chessbook" },
  { id: "cburnett", label: "Classic" },
  { id: "merida", label: "Merida" },
  { id: "chessnut", label: "Chessnut" },
  { id: "shapes", label: "Shapes" },
];

type Sheet = null | "rating" | "coverage" | "daily" | "new" | "speed" | "theme" | "pieces" | "animation" | "reset";

export function SettingsPage() {
  const { settings, update, band } = useSettings();
  const toast = useToast();
  const [sheet, setSheet] = useState<Sheet>(null);
  useBoard({ fen: SAMPLE.fen, lastMove: SAMPLE.lastMove, orientation: "white", peek: false });

  const save = async (patch: Partial<Settings>) => {
    try {
      await update(patch);
      forgetAll();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const close = () => setSheet(null);
  const system = SYSTEMS.find((s) => s.id === settings.ratingSystem)?.label ?? "";
  const speedLabel = { 0: "Instant", 250: "Fast", 450: "Normal", 800: "Slow" }[settings.autoplayDelay] ?? "Normal";

  return (
    <>
      <Crumbs items={[{ label: "Settings" }]} />
      <Back to="/" />
      <PageHead title="Settings" />

      <Section title="Your level">
        <div className="rows">
          <Row
            title="Your rating"
            meta={band ? `Move statistics come from players rated ${band} on Lichess` : undefined}
            right={<span className="value">{settings.rating} {system}</span>}
            onClick={() => setSheet("rating")}
            chevron
          />
          <Row
            title="Coverage goal"
            meta="How rare a line can be before you stop preparing for it"
            right={<span className="value">1 in {settings.coverageGoal} games</span>}
            onClick={() => setSheet("coverage")}
            chevron
          />
        </div>
      </Section>

      <Section title="Practice">
        <div className="rows">
          <Row title="Daily goal" right={<span className="value">{settings.dailyGoal} moves</span>} onClick={() => setSheet("daily")} chevron />
          <Row title="New moves per session" right={<span className="value">{settings.newPerSession}</span>} onClick={() => setSheet("new")} chevron />
          <ToggleRow
            title="Practice whole lines"
            meta="Ask every one of your moves in a line, not only the ones that are due"
            value={settings.wholeLines}
            onChange={(v) => save({ wholeLines: v })}
          />
          <Row title="Opponent move speed" right={<span className="value">{speedLabel}</span>} onClick={() => setSheet("speed")} chevron />
        </div>
      </Section>

      <Section title="Board">
        <div className="rows">
          <Row
            title="Board colors"
            right={
              <span className="value">
                <Swatch colors={THEMES.find((t) => t.id === settings.boardTheme)?.colors ?? THEMES[0].colors} />
                {THEMES.find((t) => t.id === settings.boardTheme)?.label}
              </span>
            }
            onClick={() => setSheet("theme")}
            chevron
          />
          <Row
            title="Pieces"
            right={<span className="value">{PIECES.find((p) => p.id === settings.pieceSet)?.label}</span>}
            onClick={() => setSheet("pieces")}
            chevron
          />
          <Row
            title="Piece animation"
            right={<span className="value">{settings.animation[0].toUpperCase() + settings.animation.slice(1)}</span>}
            onClick={() => setSheet("animation")}
            chevron
          />
          <ToggleRow title="Coordinates" value={settings.coordinates} onChange={(v) => save({ coordinates: v })} />
          <ToggleRow title="Show legal moves" value={settings.legalMoves} onChange={(v) => save({ legalMoves: v })} />
          <ToggleRow title="Sounds" value={settings.sound} onChange={(v) => save({ sound: v })} />
        </div>
      </Section>

      <Section title="Data">
        <div className="rows plain">
          <Row variant="plain" title="Where the statistics come from" to="/about" chevron />
          <Row variant="plain" className="danger" title="Reset practice progress" meta="Keeps your repertoires, forgets what you've learned" onClick={() => setSheet("reset")} />
        </div>
      </Section>

      {sheet === "rating" && <RatingSheet onClose={close} onSave={save} settings={settings} />}
      {sheet === "coverage" && (
        <Options
          title="Coverage goal"
          intro="Chessbook asks you to prepare for every line that comes up at least this often at your level. A higher number means a bigger repertoire."
          value={settings.coverageGoal}
          options={[20, 50, 100, 200, 500].map((n) => ({ value: n, label: `1 in ${n} games`, meta: n <= 50 ? "Just the main lines" : n >= 500 ? "Very thorough" : undefined }))}
          onPick={(v) => (save({ coverageGoal: v }), close())}
          onClose={close}
        />
      )}
      {sheet === "daily" && (
        <Options
          title="Daily goal"
          value={settings.dailyGoal}
          options={[10, 20, 30, 50, 100].map((n) => ({ value: n, label: `${n} moves a day` }))}
          onPick={(v) => (save({ dailyGoal: v }), close())}
          onClose={close}
        />
      )}
      {sheet === "new" && (
        <Options
          title="New moves per session"
          intro="New moves are taught with an arrow, then asked again from memory at the end of the session."
          value={settings.newPerSession}
          options={[5, 10, 20, 50].map((n) => ({ value: n, label: `${n} new moves` }))}
          onPick={(v) => (save({ newPerSession: v }), close())}
          onClose={close}
        />
      )}
      {sheet === "speed" && (
        <Options
          title="Opponent move speed"
          value={settings.autoplayDelay}
          options={[
            { value: 0, label: "Instant" },
            { value: 250, label: "Fast" },
            { value: 450, label: "Normal" },
            { value: 800, label: "Slow" },
          ]}
          onPick={(v) => (save({ autoplayDelay: v }), close())}
          onClose={close}
        />
      )}
      {sheet === "animation" && (
        <Options
          title="Piece animation"
          value={settings.animation}
          options={(["off", "fast", "normal", "slow"] as const).map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }))}
          onPick={(v) => (save({ animation: v }), close())}
          onClose={close}
        />
      )}
      {sheet === "theme" && (
        <Options
          title="Board colors"
          value={settings.boardTheme}
          options={THEMES.map((t) => ({ value: t.id, label: t.label, icon: <Swatch colors={t.colors} /> }))}
          onPick={(v) => save({ boardTheme: v })}
          onClose={close}
        />
      )}
      {sheet === "pieces" && (
        <Options
          title="Pieces"
          value={settings.pieceSet}
          options={PIECES.map((p) => ({
            value: p.id,
            label: p.label,
            icon: (
              <span className="piece-preview">
                {["wN", "bQ"].map((k) => (
                  <img key={k} src={`/pieces/${p.id}/${k}.svg`} alt="" />
                ))}
              </span>
            ),
          }))}
          onPick={(v) => save({ pieceSet: v })}
          onClose={close}
        />
      )}
      {sheet === "reset" && (
        <Modal title="Reset practice progress?" onClose={close}>
          <p className="modal-text">Every move goes back to "new" and your review history is cleared. Your repertoires stay as they are.</p>
          <div className="modal-actions">
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                await api.post("/reset", { what: "progress" });
                forgetAll();
                close();
                toast("Practice progress reset");
              }}
            >
              Reset
            </Button>
          </div>
        </Modal>
      )}
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

function ToggleRow({ title, meta, value, onChange }: { title: string; meta?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row
      title={title}
      meta={meta}
      onClick={() => onChange(!value)}
      right={<span className={`toggle${value ? " on" : ""}`} role="switch" aria-checked={value} />}
    />
  );
}

function Options<T extends string | number>({
  title,
  intro,
  value,
  options,
  onPick,
  onClose,
}: {
  title: string;
  intro?: string;
  value: T;
  options: { value: T; label: string; meta?: string; icon?: React.ReactNode }[];
  onPick: (v: T) => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      {intro && <p className="modal-text">{intro}</p>}
      <div className="options">
        {options.map((o) => (
          <button key={String(o.value)} type="button" className={`option${o.value === value ? " selected" : ""}`} onClick={() => onPick(o.value)}>
            {o.icon}
            <span className="option-label">
              {o.label}
              {o.meta && <span className="option-meta">{o.meta}</span>}
            </span>
            {o.value === value && <Icon name="check" />}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function RatingSheet({ settings, onSave, onClose }: { settings: Settings; onSave: (p: Partial<Settings>) => Promise<void>; onClose: () => void }) {
  const [system, setSystem] = useState(settings.ratingSystem);
  const [rating, setRating] = useState(String(settings.rating));
  const valid = Number(rating) >= 400 && Number(rating) <= 3200;
  return (
    <Modal title="Your rating" onClose={onClose}>
      <p className="modal-text">Used to show the moves your opponents actually play, and how often each line comes up.</p>
      <div className="segmented">
        {SYSTEMS.map((s) => (
          <button key={s.id} type="button" className={system === s.id ? "selected" : ""} onClick={() => setSystem(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      <input className="input" inputMode="numeric" value={rating} onChange={(e) => setRating(e.target.value.replace(/\D/g, ""))} aria-label="Rating" />
      {!valid && <p className="form-error">Enter a rating between 400 and 3200.</p>}
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!valid}
          onClick={async () => {
            await onSave({ ratingSystem: system, rating: Number(rating) });
            onClose();
          }}
        >
          Save
        </Button>
      </div>
    </Modal>
  );
}
