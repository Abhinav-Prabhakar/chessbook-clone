import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { api } from "../api";
import { EmptyState, SkeletonRows } from "../components/ui";
import type { Repertoire } from "../types";
import { ContentLayout, slugify } from "./OpeningsPage";

interface RepertoiresResponse {
  repertoires: Repertoire[];
}

const pct = (value: number | null | undefined) => Math.max(0, Math.min(100, value ?? 0));

export function RepertoiresPage() {
  const { slug } = useParams<{ slug?: string }>();
  const [repertoires, setRepertoires] = useState<Repertoire[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api
      .get<RepertoiresResponse>("/repertoires")
      .then((response) => {
        if (alive) setRepertoires(response.repertoires);
      })
      .catch((requestError: Error) => {
        if (!alive) return;
        setRepertoires([]);
        setError(requestError.message);
      });
    return () => {
      alive = false;
    };
  }, []);

  /* Production uses /repertoires/:slug; the local trainer keys repertoires by
     id/colour at /repertoire/:key. Alias the captured production shapes. */
  if (slug) {
    if (repertoires === null) {
      return (
        <ContentLayout crumbs={[{ label: "Repertoires" }]}>
          <SkeletonRows rows={4} />
        </ContentLayout>
      );
    }
    const needle = slug.toLowerCase();
    const match = repertoires.find(
      (repertoire) =>
        String(repertoire.id) === needle ||
        (repertoire.slug ?? "").toLowerCase() === needle ||
        repertoire.color === needle ||
        slugify(repertoire.name) === needle
    );
    if (match) return <Navigate to={`/repertoire/${match.id}`} replace />;
    return (
      <ContentLayout crumbs={[{ label: "Repertoires" }, { label: "Not found" }]}>
        <EmptyState
          icon="fa-folder-open"
          title="Repertoire not found"
          action={
            <Link className="cb-btn primary" to="/repertoires">
              All repertoires
            </Link>
          }
        >
          No local repertoire matches “{slug}”. Production URLs such as{" "}
          <code>/repertoires/white-openings</code> are aliased to the local repertoire key when one
          matches.
        </EmptyState>
      </ContentLayout>
    );
  }

  return (
    <ContentLayout crumbs={[{ label: "Repertoires" }]}>
      <h1 className="cb-cs-title">Your repertoires</h1>
      <p className="cb-cs-lede">
        A repertoire is a collection of openings for one colour. Build the moves you want to play,
        then practise them move by move. Counts below come from the local training database.
      </p>

      <div className="cb-cs-toolbar">
        <Link className="cb-btn primary small" to="/add?tab=new">
          <i className="fa fa-plus" aria-hidden /> New repertoire
        </Link>
        <Link className="cb-btn small" to="/openings?tab=pre-made">
          Pre-made repertoires
        </Link>
        <Link className="cb-link" to="/openings">
          Browse opening guides
        </Link>
      </div>

      {repertoires === null ? (
        <SkeletonRows rows={4} />
      ) : error || repertoires.length === 0 ? (
        <EmptyState
          icon="fa-folder-open"
          title={error ? "Repertoires unavailable" : "No repertoires yet"}
          action={
            <Link className="cb-btn primary" to="/add?tab=new">
              Create your first repertoire
            </Link>
          }
        >
          {error ||
            "Start with a colour and a name, then add moves from the captured candidate list."}
        </EmptyState>
      ) : (
        <div className="cb-cs-cards">
          {repertoires.map((repertoire) => {
            const key = String(repertoire.id);
            const completion = pct(repertoire.completion);
            return (
              <article className="cb-cs-card" key={repertoire.id}>
                <div className="cb-cs-card-head">
                  <span className={`cb-color-dot ${repertoire.color}`} aria-hidden />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <h2 className="cb-cs-card-title">{repertoire.name}</h2>
                    <p className="cb-cs-card-sub">
                      {repertoire.color === "white" ? "White" : "Black"} repertoire ·{" "}
                      {repertoire.lineCount} line{repertoire.lineCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span className="cb-row-meta strong">{Math.round(completion)}%</span>
                </div>

                {repertoire.description && (
                  <p className="clamp">{repertoire.description}</p>
                )}

                <div>
                  <div className="cb-progress-copy" style={{ marginBottom: 6 }}>
                    <strong>{Math.round(completion)}% complete</strong>
                    <span className="cb-row-meta">{Math.round(pct(repertoire.mastery))}% mastered</span>
                  </div>
                  <div className="cb-bar">
                    <span style={{ width: `${completion}%` }} />
                  </div>
                </div>

                <div className="cb-cs-meta">
                  <span>{repertoire.saved} saved</span>
                  <span>{repertoire.moveCount ?? 0} moves</span>
                  <span>{repertoire.positionCount ?? 0} positions</span>
                  <span>{repertoire.due} due</span>
                </div>

                <div className="cb-cs-card-actions">
                  <Link className="cb-btn primary small" to={`/repertoire/${key}`}>
                    Open
                  </Link>
                  <Link className="cb-btn small" to={`/build/${key}`}>
                    Build
                  </Link>
                  <Link className="cb-btn small" to={`/learn/${key}`}>
                    Practice
                  </Link>
                  <Link className="cb-link" to={`/add?tab=add&repertoire=${key}`}>
                    Add moves
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {repertoires && repertoires.length > 0 && (
        <div className="cb-cs-callout">
          <div>
            <h2>Need a starting point?</h2>
            <p>
              Clone a captured pre-made repertoire into your library, or read a guide and add its
              line to a repertoire you already own.
            </p>
          </div>
          <Link className="cb-btn primary" to="/openings?tab=pre-made">
            Browse pre-made repertoires
          </Link>
        </div>
      )}

      <p className="cb-cs-note">
        <i className="fa fa-circle-info" aria-hidden />
        <span>
          Production links such as <code>/repertoires/:slug</code> are handled here: the slug is
          matched by name, colour or id and redirected to the local{" "}
          <code>/repertoire/:key</code> view.
        </span>
      </p>
    </ContentLayout>
  );
}
