import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import type { Color, Repertoire } from "../types";
import { Board } from "../components/Board";
import { BoardHeader, Sidebar } from "../components/ui";
import { START_FEN } from "../chess";
import { useToast } from "../components/Toast";

export function AddPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [color, setColor] = useState<Color>((params.get("color") as Color) || "white");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await api.post<{ repertoire: Repertoire }>("/repertoires", {
        color,
        name,
        description: "",
      });
      toast(`${r.repertoire.name} created`, "ok");
      navigate(`/repertoire/${r.repertoire.id}`);
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cb-app">
      <main className="cb-main">
        <section className="cb-board-col">
          <BoardHeader />
          <Board fen={START_FEN} orientation={color} />
        </section>

        <Sidebar backTo="/" backLabel="Back">
          <div className="cb-page-head">
            <h1 className="cb-page-title">Add new repertoire</h1>
            <p className="cb-page-sub">
              A repertoire is a collection of openings for a particular color.
            </p>
          </div>

          <div className="cb-add-intro">
            <p>
              You should only create a new repertoire if you want something entirely different
              (e.g. moves for bullet vs blitz). Otherwise we recommend adding alternate moves to
              an existing one.
            </p>
          </div>

          <div className="cb-add-form">
            <div className="cb-add-label">Color</div>
            <div className="cb-add-choices">
              {(["white", "black"] as const).map((c) => (
                <button
                  type="button"
                  key={c}
                  className={`cb-add-choice ${color === c ? "active" : ""}`}
                  onClick={() => setColor(c)}
                >
                  <span>{c === "white" ? "White" : "Black"}</span>
                  {color === c && <i className="fa fa-check" aria-hidden />}
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
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
            />

            <button
              type="button"
              className="cb-add-submit"
              onClick={create}
              disabled={busy || !name.trim()}
            >
              {busy ? "Creating…" : "Create repertoire"}
            </button>
          </div>
        </Sidebar>
      </main>
    </div>
  );
}
