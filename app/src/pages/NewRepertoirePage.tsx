import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { Crumbs, START_FEN, useBoard } from "../board/stage";
import type { Color, RepertoireSummary } from "../types";
import { forgetAll } from "../useApi";
import { Back, Icon, PageHead, Row, useToast } from "../ui";
import { buildPath } from "../routes";

export function NewRepertoirePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [color, setColor] = useState<Color>("white");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useBoard({ fen: START_FEN, orientation: color, peek: true });

  const create = async () => {
    setBusy(true);
    try {
      const { repertoire } = await api.post<{ repertoire: RepertoireSummary }>("/repertoires", {
        color,
        name: name.trim() || (color === "white" ? "White openings" : "Black openings"),
      });
      forgetAll();
      navigate(buildPath(repertoire.id));
    } catch (e) {
      toast((e as Error).message, "error");
      setBusy(false);
    }
  };

  return (
    <>
      <Crumbs items={[{ label: "Add new repertoire" }]} />
      <Back to="/" />
      <PageHead title="Add new repertoire" />
      <div className="game-text tight">
        <p>A repertoire holds the openings you play with one color.</p>
        <p>
          Only start another one if you want something completely separate, such as different openings for bullet and for
          classical games. Otherwise, add alternative moves to the repertoire you already have.
        </p>
      </div>

      <div className="field-label">Color</div>
      <div className="rows list choice-list">
        {(["white", "black"] as Color[]).map((c) => (
          <Row
            key={c}
            className={color === c ? "selected" : "unselected"}
            title={c === "white" ? "White" : "Black"}
            right={color === c ? <Icon name="check" /> : null}
            onClick={() => setColor(c)}
          />
        ))}
      </div>

      <div className="field-label spaced">Name</div>
      <div className="pad">
        <input
          className="input light"
          placeholder={color === "white" ? "White openings" : "Black openings"}
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && void create()}
        />
      </div>

      <Row variant="accent" className="block-row" title={busy ? "Creating…" : "Create repertoire"} onClick={create} disabled={busy} />

      <div className="rows list spaced">
        <Row title="Start from an opening guide instead" to="/openings" />
      </div>
    </>
  );
}
