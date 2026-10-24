import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { BoardCaption, Crumbs, START_FEN, useBoard } from "../board/stage";
import { replay } from "../chess";
import { forgetAll, useApi } from "../useApi";
import type { Color } from "../types";
import { Back, Button, ErrorNote, PageHead, ResultBar, Row, Section, Skeleton, compact, pct, useToast } from "../ui";
import { BoardStrip, MoveList } from "../ui/MoveList";
import { repertoirePath } from "../routes";

interface Guide {
  slug: string;
  eco: string;
  name: string;
  side: Color;
  sans: string[];
  games: number;
  masterGames: number;
}

interface GuideDetail extends Guide {
  fen: string;
  moves: { san: string; from: string; to: string; fen: string }[];
  masters: { games: number; white: number; draw: number; black: number; moves: { san: string; share: number; games: number }[] } | null;
  peers: { games: number; white: number; draw: number; black: number; moves: { san: string; share: number; games: number }[] } | null;
}

export function OpeningsPage() {
  const { data, error, reload } = useApi<{ guides: Guide[] }>("/content/guides");
  const [query, setQuery] = useState("");
  const [side, setSide] = useState<Color>("white");
  const [hovered, setHovered] = useState<Guide | null>(null);
  const preview = useMemo(() => (hovered ? replay(hovered.sans) : null), [hovered]);
  useBoard({ fen: preview?.fen ?? START_FEN, lastMove: preview?.lastMove ?? null, orientation: side, peek: true });

  if (error && !data) return <ErrorNote error={error} retry={reload} />;
  const q = query.trim().toLowerCase();
  const list = (data?.guides || []).filter((g) => g.side === side && (!q || g.name.toLowerCase().includes(q) || g.eco.toLowerCase().startsWith(q)));

  return (
    <>
      <Crumbs items={[{ label: "Openings" }]} />
      <Back to="/" />
      <PageHead title="Opening guides" sub="Explore an opening, then start a repertoire with its main lines already filled in." />
      <div className="segmented small pad-x">
        {(["white", "black"] as Color[]).map((c) => (
          <button key={c} type="button" className={side === c ? "selected" : ""} onClick={() => setSide(c)}>
            For {c === "white" ? "White" : "Black"}
          </button>
        ))}
      </div>
      <div className="pad">
        <input className="input" placeholder="Search openings" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {!data ? (
        <Skeleton rows={8} />
      ) : (
        <div className="rows plain" onMouseLeave={() => setHovered(null)}>
          {list.map((g) => (
            <div key={g.slug} onMouseEnter={() => setHovered(g)}>
              <Row
                variant="plain"
                title={g.name}
                meta={`${g.eco} · ${g.sans.length > 8 ? `${g.sans.slice(0, 8).join(" ")}…` : g.sans.join(" ")}`}
                right={<span className="muted">{g.games ? `${compact(g.games)} games` : ""}</span>}
                to={`/openings/${g.slug}`}
                chevron
              />
            </div>
          ))}
          {list.length === 0 && <p className="hint-text">No openings match “{query}”.</p>}
        </div>
      )}
    </>
  );
}

export function OpeningGuidePage() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, error, reload } = useApi<{ guide: GuideDetail }>(`/content/guides/${slug}`);
  const guide = data?.guide;
  const [ply, setPly] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = guide ? (ply == null ? guide.sans.length : ply) : 0;
  const pos = useMemo(() => (guide ? replay(guide.sans.slice(0, shown)) : null), [guide, shown]);
  useBoard({ fen: pos?.fen ?? START_FEN, lastMove: pos?.lastMove ?? null, orientation: guide?.side ?? "white", peek: false });

  if (error && !guide) return <ErrorNote error={error} retry={reload} />;
  if (!guide) return <Skeleton rows={6} />;

  const create = async (color: Color) => {
    setBusy(true);
    try {
      const result = await api.post<{ repertoire: { id: number }; added: number }>(`/content/guides/${guide.slug}/repertoire`, { color });
      forgetAll();
      toast(`Created with ${result.added} moves`);
      navigate(repertoirePath(result.repertoire.id));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const stat = (label: string, s: GuideDetail["masters"]) =>
    s && s.games > 0 ? (
      <div className="guide-stat">
        <div className="guide-stat-head">
          <span>{label}</span>
          <span className="muted">{compact(s.games)} games</span>
        </div>
        <ResultBar white={s.white} draw={s.draw} black={s.black} />
        <div className="guide-next">
          {s.moves.slice(0, 5).map((m) => (
            <span key={m.san} className="chip static">
              {m.san} <span className="muted">{pct(m.share)}</span>
            </span>
          ))}
        </div>
      </div>
    ) : null;

  return (
    <>
      <Crumbs items={[{ label: "Openings", to: "/openings" }, { label: guide.name.split(":")[0] }]} />
      <BoardCaption>
        <BoardStrip title={`${guide.eco}`} fen={pos?.fen} orientation={guide.side}>
          <MoveList sans={guide.sans} current={shown - 1} onSelect={(i) => setPly(i + 1)} />
        </BoardStrip>
      </BoardCaption>
      <Back to="/openings" />
      <PageHead title={guide.name} sub={`A ${guide.side === "white" ? "White" : "Black"} opening · ${guide.eco}`} />
      <Section title="What happens next">
        {stat("Masters", guide.masters)}
        {stat("At your level", guide.peers)}
        {!guide.masters && !guide.peers && <p className="hint-text">No games reach this exact position in the bundled databases.</p>}
      </Section>
      <div className="pad">
        <Button onClick={() => create(guide.side)} disabled={busy}>
          {busy ? "Building your repertoire…" : `Start a ${guide.side} repertoire with this opening`}
        </Button>
        <p className="hint-text">Adds these moves plus the most common master continuations, up to your coverage goal. You can change anything afterwards.</p>
      </div>
      <div className="rows actions">
        <Row title="Play a training game from here" to={`/training-games?path=${encodeURIComponent(guide.sans.join(","))}&color=${guide.side}`} chevron />
      </div>
    </>
  );
}
