import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { EmptyState, SkeletonRows } from "../components/ui";
import { useToast } from "../components/Toast";
import type { Color, Repertoire } from "../types";
import { ContentLayout, MiniBoard } from "./OpeningsPage";

interface GuideStep {
  ply: number;
  moveNumber: number;
  side: Color;
  san: string;
  epd: string;
  fen: string;
  fenAfter: string;
  annotation: string | null;
  name: string;
}

interface GuideDetail {
  id: number;
  slug: string;
  eco: string;
  name: string;
  side: Color;
  family: string;
  moves: string[];
  pgn: string;
  epd: string | null;
  steps: GuideStep[];
  notes: { id?: number; epd: string; san?: string | null; text: string; ply?: number }[];
  notesAvailable: boolean;
  plans: unknown[];
  plansAvailable: boolean;
  reportAvailable: boolean;
  coverage: number | null;
  coveragePercent: number | null;
  course: { id: string; slug: string; name: string } | null;
  source: string;
}

interface DetailResponse {
  guide: GuideDetail;
}

interface RepertoiresResponse {
  repertoires: Repertoire[];
}

interface AddResponse {
  line: { id: number; name: string; pgn: string; moves: string[] };
  repertoire: Repertoire;
  created: boolean;
  transposition: boolean;
}

const moveLabel = (step: GuideStep) =>
  `${step.moveNumber}${step.side === "white" ? "." : "…"} ${step.san}`;

const planText = (plan: unknown): string => {
  if (typeof plan === "string") return plan;
  if (plan && typeof plan === "object") {
    const record = plan as Record<string, unknown>;
    for (const key of ["text", "plan", "description", "title", "name"]) {
      if (typeof record[key] === "string") return record[key] as string;
    }
    try {
      return JSON.stringify(plan);
    } catch {
      return "";
    }
  }
  return "";
};

export function OpeningGuidePage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const { toast } = useToast();
  const [guide, setGuide] = useState<GuideDetail | null>(null);
  const [error, setError] = useState("");
  const [repertoires, setRepertoires] = useState<Repertoire[]>([]);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<{ lineId: number; created: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    setGuide(null);
    setError("");
    setAdded(null);
    api
      .get<DetailResponse>(`/openings/guides/${encodeURIComponent(slug)}`)
      .then((response) => {
        if (alive) setGuide(response.guide);
      })
      .catch((requestError: Error) => {
        if (alive) setError(requestError.message);
      });
    api
      .get<RepertoiresResponse>("/repertoires")
      .then((response) => {
        if (alive) setRepertoires(response.repertoires);
      })
      .catch(() => {
        if (alive) setRepertoires([]);
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  const sideRepertoires = useMemo(
    () => repertoires.filter((repertoire) => repertoire.color === guide?.side),
    [repertoires, guide?.side]
  );

  useEffect(() => {
    if (!sideRepertoires.length) {
      setKey("");
      return;
    }
    if (!sideRepertoires.some((repertoire) => String(repertoire.id) === key)) {
      setKey(String(sideRepertoires[0].id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideRepertoires]);

  const groups = useMemo(() => {
    const steps = guide?.steps ?? [];
    const out: { steps: GuideStep[]; fen: string }[] = [];
    for (let index = 0; index < steps.length; index += 2) {
      const chunk = steps.slice(index, index + 2);
      out.push({ steps: chunk, fen: chunk[chunk.length - 1].fenAfter });
    }
    return out;
  }, [guide]);

  const annotations = (guide?.steps ?? []).filter((step) => step.annotation);
  const finalFen =
    guide && guide.steps.length
      ? guide.steps[guide.steps.length - 1].fenAfter
      : null;

  const addLine = async () => {
    if (!guide || !key) return;
    setBusy(true);
    try {
      const response = await api.post<AddResponse>(`/repertoires/${key}/lines`, {
        pgn: guide.pgn,
        name: guide.name,
      });
      setAdded({ lineId: response.line.id, created: response.created });
      toast(
        response.created
          ? `${guide.name} added to ${response.repertoire.name}`
          : `${guide.name} is already saved at that position`,
        response.created ? "ok" : "info"
      );
    } catch (requestError: any) {
      toast(requestError.message, "bad");
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <ContentLayout crumbs={[{ label: "Openings", to: "/openings" }, { label: "Not found" }]}>
        <EmptyState
          icon="fa-book-open"
          title="Opening guide not found"
          action={
            <Link className="cb-btn primary" to="/openings">
              Back to the guide index
            </Link>
          }
        >
          {error}
        </EmptyState>
      </ContentLayout>
    );
  }

  if (!guide) {
    return (
      <ContentLayout crumbs={[{ label: "Openings", to: "/openings" }, { label: "Loading…" }]}>
        <SkeletonRows rows={8} />
      </ContentLayout>
    );
  }

  return (
    <ContentLayout
      crumbs={[{ label: "Openings", to: "/openings" }, { label: guide.name }]}
    >
      <div className="cb-cs-crumbs" style={{ marginTop: -10 }}>
        <span className="cb-cs-eco">{guide.eco}</span>
        <span className="sep">·</span>
        <span>{guide.side === "white" ? "For White" : "For Black"}</span>
        <span className="sep">·</span>
        <span>{guide.family}</span>
      </div>
      <h1 className="cb-cs-title">{guide.name}</h1>
      <p className="cb-cs-lede">{guide.pgn}</p>

      <div className="cb-cs-detail">
        <div className="cb-cs-detail-side">
          {finalFen && (
            <MiniBoard fen={finalFen} orientation={guide.side} size={320} label={`Final position of ${guide.name}`} />
          )}
          <div className="cb-cs-detail-actions">
            {sideRepertoires.length > 0 ? (
              <>
                {sideRepertoires.length > 1 && (
                  <label className="cb-field">
                    <span className="cb-row-meta">Repertoire</span>
                    <select
                      className="cb-select"
                      value={key}
                      onChange={(event) => setKey(event.target.value)}
                    >
                      {sideRepertoires.map((repertoire) => (
                        <option key={repertoire.id} value={repertoire.id}>
                          {repertoire.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <Link
                  className="cb-btn primary"
                  to={`/build/${key}?path=${encodeURIComponent(guide.moves.join(" "))}`}
                >
                  Open in builder
                </Link>
                <button type="button" className="cb-btn" onClick={() => void addLine()} disabled={busy}>
                  {busy ? "Adding…" : added?.created === false ? "Already in repertoire" : "Add line to repertoire"}
                </button>
                {added && (
                  <>
                    <Link className="cb-btn" to={`/practice/${key}?line=${added.lineId}`}>
                      Practice this line
                    </Link>
                    <Link className="cb-btn" to={`/repertoire/${key}?line=${added.lineId}`}>
                      Open in repertoire
                    </Link>
                  </>
                )}
              </>
            ) : (
              <>
                <Link className="cb-btn primary" to={`/add?tab=new&color=${guide.side}`}>
                  Create a {guide.side} repertoire
                </Link>
                <p className="cb-row-meta">
                  You have no {guide.side} repertoire yet, so this guide cannot be opened in the
                  builder or saved yet.
                </p>
              </>
            )}
            <Link className="cb-btn ghost" to="/openings">
              Back to all guides
            </Link>
          </div>
          <div className="cb-cs-meta">
            <span>{guide.moves.length} plies captured</span>
            {guide.coveragePercent != null ? (
              <span>{guide.coveragePercent}% course coverage</span>
            ) : (
              <span>Coverage unavailable</span>
            )}
            {guide.course && (
              <Link to={`/openings?tab=pre-made&q=${encodeURIComponent(guide.course.name)}`}>
                Part of {guide.course.name}
              </Link>
            )}
          </div>
          {guide.course && (
            <p className="cb-row-meta">
              Pre-made repertoire with a captured matching line.
            </p>
          )}
        </div>

        <div>
          <h2 className="cb-cs-section-title" style={{ marginTop: 0 }}>
            Moves and notes
          </h2>
          {annotations.length === 0 && (
            <p className="cb-cs-note">
              <i className="fa fa-circle-info" aria-hidden />
              <span>
                Chessbook's notes for this line were not included in the local capture. The moves
                below are the real line; no note text is invented.
              </span>
            </p>
          )}
          {groups.map((group) => (
            <div className="cb-cs-movegroup" key={`group-${group.steps[0].ply}`}>
              <MiniBoard
                fen={group.fen}
                orientation={guide.side}
                size={92}
                label={`Position after ${group.steps[group.steps.length - 1].san}`}
              />
              <div className="cb-cs-movegroup-copy">
                <div className="cb-cs-moves">
                  {group.steps.map((step) => (
                    <span key={step.ply}>
                      <b>{moveLabel(step)}</b>
                    </span>
                  ))}
                </div>
                {group.steps.map((step) =>
                  step.annotation ? (
                    <p className="cb-cs-move-note" key={`note-${step.ply}`}>
                      <strong>{moveLabel(step)}</strong> — {step.annotation}
                    </p>
                  ) : null
                )}
                <p className="cb-cs-move-note" style={{ color: "var(--cb-text-dim)" }}>
                  {group.steps[group.steps.length - 1].name}
                </p>
              </div>
            </div>
          ))}

          <div className="cb-cs-plans">
            <h2 className="cb-cs-section-title">Plans</h2>
            {guide.plansAvailable ? (
              guide.plans.map((plan, index) => (
                <p className="cb-cs-plan" key={`plan-${index}`}>
                  {planText(plan)}
                </p>
              ))
            ) : (
              <p className="cb-cs-note">
                <i className="fa fa-circle-info" aria-hidden />
                <span>
                  Plans for this position were not included in the capture. Chessbook shows plans
                  from its position report; this local build does not invent them.
                </span>
              </p>
            )}
          </div>

          <p className="cb-cs-note">
            <i className="fa fa-circle-info" aria-hidden />
            <span>
              Captured from {guide.source}. Position reports and cross-move annotations are
              available where the capture included them, and left explicit where it did not.
            </span>
          </p>
        </div>
      </div>
    </ContentLayout>
  );
}
