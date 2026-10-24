import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { Crumbs, START_FEN, useBoard } from "../board/stage";
import type { Color, RepertoireSummary } from "../types";
import { forgetAll } from "../useApi";
import { Back, Button, PageHead, Row, Section, useToast } from "../ui";
import { buildPath } from "../routes";

export function NewRepertoirePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [color, setColor] = useState<Color>("white");
  const [name, setName] = useState("");
  const [pgn, setPgn] = useState("");
  const [busy, setBusy] = useState(false);
  useBoard({ fen: START_FEN, orientation: color, peek: true });

  const create = async () => {
    setBusy(true);
    try {
      const { repertoire } = await api.post<{ repertoire: RepertoireSummary }>("/repertoires", {
        color,
        name: name.trim() || (color === "white" ? "White openings" : "Black openings"),
      });
      if (pgn.trim()) {
        const result = await api.post<{ added: number }>(`/repertoires/${repertoire.id}/import`, { pgn });
        toast(`Imported ${result.added} moves`);
      }
      forgetAll();
      navigate(buildPath(repertoire.id));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Crumbs items={[{ label: "New repertoire" }]} />
      <Back to="/" />
      <PageHead title="Add a repertoire" sub="A repertoire is the set of moves you play with one color." />

      <Section title="Side">
        <div className="segmented big">
          {(["white", "black"] as Color[]).map((c) => (
            <button key={c} type="button" className={color === c ? "selected" : ""} onClick={() => setColor(c)}>
              <span className={`color-dot ${c}`} /> {c === "white" ? "White" : "Black"}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Name">
        <div className="pad">
          <input
            className="input"
            placeholder={color === "white" ? "White openings" : "Black openings"}
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      </Section>

      <Section title="Start from a PGN (optional)">
        <div className="pad">
          <textarea
            className="textarea"
            rows={5}
            placeholder="Paste moves or a study, e.g. 1. d4 d5 2. c4 e6 3. Nc3 Nf6"
            value={pgn}
            onChange={(e) => setPgn(e.target.value)}
          />
          <label className="file-pick">
            <input
              type="file"
              accept=".pgn,text/plain"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) setPgn(await file.text());
              }}
            />
            Or choose a .pgn file
          </label>
        </div>
      </Section>

      <div className="pad">
        <Button onClick={create} disabled={busy}>
          {busy ? "Creating…" : "Create repertoire"}
        </Button>
      </div>

      <Section title="Or">
        <div className="rows">
          <Row title="Start from an opening guide" meta="Pick an opening and get its main lines filled in for you" to="/openings" chevron />
        </div>
      </Section>
    </>
  );
}
