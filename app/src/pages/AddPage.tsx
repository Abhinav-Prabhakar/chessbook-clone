import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import type { Color, Repertoire } from "../types";
import { Board } from "../components/Board";
import { Breadcrumb, Row, Section, Sidebar, Splash } from "../components/ui";
import { START_FEN } from "../chess";
import { useToast } from "../components/Toast";

export function AddPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [color, setColor] = useState<Color>((params.get("color") as Color) || "white");
  const [repertoires, setRepertoires] = useState<Repertoire[] | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ repertoires: Repertoire[] }>("/repertoires")
      .then((r) => setRepertoires(r.repertoires))
      .catch((e) => toast(e.message, "bad"));
  }, [toast]);

  if (!repertoires) return <Splash label="Loading your repertoires…" />;

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await api.post<{ repertoire: Repertoire }>("/repertoires", {
        color,
        name,
        description,
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
      <header className="cb-topbar">
        <Link to="/" className="cb-logo" aria-label="Chessbook home">
          <img src="/homepage_imgs/chessbook.svg" alt="Chessbook" />
        </Link>
        <div className="cb-top-actions">
          <span className="cb-plan-pill">ADD</span>
          <Link to="/" className="cb-top-link">
            Dashboard
          </Link>
        </div>
      </header>

      <main className="cb-main">
        <section className="cb-board-col">
          <Board fen={START_FEN} orientation={color} />
          <div className="cb-board-footer">
            <span>New repertoire</span>
          </div>
        </section>

        <Sidebar backTo="/" backLabel="Back">
          <Breadcrumb items={[{ label: "Repertoires", to: "/" }, { label: "Add new" }]} />
          <div className="cb-page-head" style={{ paddingTop: 0 }}>
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

          <div className="cb-form">
            <div className="cb-field">
              <span className="cb-label">Color</span>
              <div className="cb-choice-list">
                {(["white", "black"] as const).map((c) => (
                  <button
                    type="button"
                    key={c}
                    className={`cb-choice ${color === c ? "active" : ""}`}
                    onClick={() => setColor(c)}
                  >
                    <span className={`cb-color-dot ${c}`} />
                    <span>{c === "white" ? "White" : "Black"}</span>
                    {color === c && <i className="fa fa-check" aria-hidden />}
                  </button>
                ))}
              </div>
            </div>
            <div className="cb-field">
              <label htmlFor="new-repertoire-name">Name</label>
              <input
                id="new-repertoire-name"
                className="cb-input"
                placeholder={color === "white" ? "e.g. White main" : "e.g. Black main"}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && create()}
              />
            </div>
            <div className="cb-field">
              <label htmlFor="new-repertoire-description">Description (optional)</label>
              <input
                id="new-repertoire-description"
                className="cb-input"
                placeholder="What is this repertoire for?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="cb-btn primary wide"
              onClick={create}
              disabled={busy || !name.trim()}
            >
              <i className="fa fa-plus" aria-hidden /> {busy ? "Creating…" : "Create repertoire"}
            </button>
          </div>

          <Section title="Your repertoires">
            {repertoires.length === 0 ? (
              <p className="cb-inline-note" style={{ margin: "0 18px" }}>
                <i className="fa fa-circle-info" aria-hidden /> Your first repertoire will appear
                here.
              </p>
            ) : (
              repertoires.map((r) => (
                <Row
                  key={r.id}
                  title={
                    <span className="cb-rep-title">
                      <span className={`cb-color-dot ${r.color}`} />
                      <span>{r.name}</span>
                    </span>
                  }
                  meta={`${r.lineCount} lines · ${r.completion}% complete`}
                  right={<span className="cb-row-meta">{r.color === "white" ? "White" : "Black"}</span>}
                  onClick={() => navigate(`/repertoire/${r.id}`)}
                />
              ))
            )}
          </Section>
        </Sidebar>
      </main>
    </div>
  );
}
