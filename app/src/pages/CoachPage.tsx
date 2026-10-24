import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { EmptyState, SkeletonRows } from "../components/ui";
import { ContentLayout, initials } from "./OpeningsPage";
import {
  coachAppSlug,
  readCoachApplications,
  type Coach,
  type CoachApplication,
} from "./CoachesPage";

interface CoachResponse {
  coach: Coach;
}

export function CoachPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const [coach, setCoach] = useState<Coach | null>(null);
  const [application, setApplication] = useState<CoachApplication | null>(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    setCoach(null);
    setApplication(null);
    setError("");
    setLoaded(false);
    api
      .get<CoachResponse>(`/coaches/${encodeURIComponent(slug)}`)
      .then((response) => {
        if (!alive) return;
        setCoach(response.coach);
        setLoaded(true);
      })
      .catch(() => {
        if (!alive) return;
        const approved = readCoachApplications().find(
          (entry) => entry.status === "approved" && coachAppSlug(entry) === slug
        );
        if (approved) {
          setApplication(approved);
          setError("");
        } else {
          setError("That coach is not in the directory or in the local application list.");
        }
        setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  if (!loaded) {
    return (
      <ContentLayout crumbs={[{ label: "Coaches", to: "/coaches" }, { label: "Loading…" }]}>
        <SkeletonRows rows={5} />
      </ContentLayout>
    );
  }

  if (error || (!coach && !application)) {
    return (
      <ContentLayout crumbs={[{ label: "Coaches", to: "/coaches" }, { label: "Not found" }]}>
        <EmptyState
          icon="fa-user-tie"
          title="Coach not found"
          action={
            <Link className="cb-btn primary" to="/coaches">
              Back to coaches
            </Link>
          }
        >
          {error}
        </EmptyState>
      </ContentLayout>
    );
  }

  const name = coach?.name ?? application?.name ?? "Coach";
  const rating = coach?.rating ?? application?.rating ?? "";
  const bio = coach?.bio ?? application?.bio ?? "";
  const languages = coach?.languages ?? application?.languages ?? [];
  const price = coach?.price ?? application?.price ?? "";
  const platforms = coach?.platforms ?? [];
  const firstLessonFree = coach?.firstLessonFree ?? application?.firstLessonFree ?? false;

  return (
    <ContentLayout crumbs={[{ label: "Coaches", to: "/coaches" }, { label: name }]}>
      <div className="cb-cs-detail">
        <div className="cb-cs-detail-side">
          <div className="cb-cs-card">
            <div className="cb-cs-card-head">
              <span className="cb-cs-avatar" style={{ width: 64, height: 64, fontSize: 22 }} aria-hidden>
                {initials(name)}
              </span>
              <div>
                <h1 className="cb-cs-card-title" style={{ fontSize: 28 }}>
                  {name}
                </h1>
                <p className="cb-cs-card-sub">{rating}</p>
              </div>
            </div>
            {firstLessonFree && <span className="cb-cs-badge">First lesson free</span>}
            <div className="cb-cs-meta">
              {languages.length > 0 && <span>{languages.join(", ")}</span>}
              {price && <span>{price}</span>}
              {platforms.length > 0 && <span>{platforms.join(", ")}</span>}
              {application && <span>Local application · approved</span>}
            </div>
            <div className="cb-cs-card-actions">
              <Link className="cb-btn" to="/coaches">
                All coaches
              </Link>
            </div>
          </div>
          <p className="cb-cs-note">
            <i className="fa fa-circle-info" aria-hidden />
            <span>
              {application
                ? "This profile was approved through the local review queue and is stored in this browser only."
                : "Contact details are not part of the captured directory. The captured listing only exposes the rating, languages, price and platform shown here."}
            </span>
          </p>
        </div>

        <div>
          <h2 className="cb-cs-section-title" style={{ marginTop: 0 }}>
            How {name.split(" ")[0]} coaches
          </h2>
          <div className="cb-cs-prose">
            <p>{bio || "No biography was captured for this coach."}</p>
          </div>

          {application && (
            <>
              <h2 className="cb-cs-section-title">Teaching</h2>
              <div className="cb-cs-meta">
                <span>{application.platform} · {application.timeControl}</span>
                {application.levels.length > 0 && (
                  <span>Levels: {application.levels.join(", ")}</span>
                )}
                {application.contact && <span>Contact: {application.contact}</span>}
              </div>
            </>
          )}

          {!application && platforms.length > 0 && (
            <>
              <h2 className="cb-cs-section-title">Contact</h2>
              <div className="cb-cs-prose">
                <p>
                  Listed on {platforms.join(", ")}. Chessbook does not take a cut and does not
                  broker the lesson; contact the coach directly on the platform above.
                </p>
              </div>
            </>
          )}

          <p className="cb-cs-note">
            <i className="fa fa-circle-info" aria-hidden />
            <span>
              {coach
                ? `Captured from ${coach.source}. No teaching-quality claim is made beyond the captured profile.`
                : "Local application data is stored in this browser only."}
            </span>
          </p>
        </div>
      </div>
    </ContentLayout>
  );
}
