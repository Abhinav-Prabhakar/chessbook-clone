import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { EmptyState, SkeletonRows } from "../components/ui";
import { ContentLayout, initials, slugify } from "./OpeningsPage";

export interface Coach {
  id: number;
  slug: string;
  name: string;
  rating: string;
  headline: string | null;
  bio: string | null;
  languages: string[];
  price: string | null;
  platforms: string[];
  firstLessonFree: boolean;
  source: string;
}

export type CoachApplicationStatus = "pending" | "approved" | "rejected";

export interface CoachApplication {
  id: string;
  name: string;
  ratingValue: number;
  platform: string;
  timeControl: string;
  rating: string;
  price: string;
  languages: string[];
  levels: string[];
  bio: string;
  contact: string;
  firstLessonFree: boolean;
  createdAt: string;
  status: CoachApplicationStatus;
  reviewedAt: string | null;
}

export const COACH_APP_KEY = "cb_coach_applications_v1";

export function readCoachApplications(): CoachApplication[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(COACH_APP_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is CoachApplication => Boolean(entry) && typeof entry === "object")
      .map((entry) => ({
        ...entry,
        status: ["pending", "approved", "rejected"].includes(entry.status)
          ? entry.status
          : "pending",
        languages: Array.isArray(entry.languages) ? entry.languages : [],
        levels: Array.isArray(entry.levels) ? entry.levels : [],
      }));
  } catch {
    return [];
  }
}

export function writeCoachApplications(applications: CoachApplication[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COACH_APP_KEY, JSON.stringify(applications));
  } catch {
    // A blocked storage API leaves the form usable for this visit only.
  }
}

export const coachAppSlug = (application: CoachApplication) =>
  `local-${slugify(application.name)}`;

export function CoachCard({ coach }: { coach: Coach }) {
  return (
    <article className="cb-cs-card">
      <div className="cb-cs-card-head">
        <span className="cb-cs-avatar" aria-hidden>
          {initials(coach.name)}
        </span>
        <div style={{ minWidth: 0 }}>
          <h2 className="cb-cs-card-title">{coach.name}</h2>
          <p className="cb-cs-card-sub">{coach.rating}</p>
        </div>
      </div>
      {coach.firstLessonFree && <span className="cb-cs-badge">First lesson free</span>}
      <p className="clamp">{coach.bio || "No biography was captured for this coach."}</p>
      <div className="cb-cs-meta">
        {coach.languages.length > 0 && <span>{coach.languages.join(", ")}</span>}
        {coach.price && <span>{coach.price}</span>}
        {coach.platforms.length > 0 && <span>{coach.platforms.join(", ")}</span>}
      </div>
      <div className="cb-cs-card-actions">
        <Link className="cb-link" to={`/coaches/${coach.slug}`}>
          Read more
        </Link>
      </div>
    </article>
  );
}

export function LocalApplicationCard({
  application,
  href,
}: {
  application: CoachApplication;
  href?: string;
}) {
  return (
    <article className="cb-cs-card">
      <div className="cb-cs-card-head">
        <span className="cb-cs-avatar" aria-hidden>
          {initials(application.name)}
        </span>
        <div style={{ minWidth: 0 }}>
          <h2 className="cb-cs-card-title">{application.name}</h2>
          <p className="cb-cs-card-sub">{application.rating}</p>
        </div>
      </div>
      <span className="cb-cs-badge">Local application · approved</span>
      <p className="clamp">{application.bio}</p>
      <div className="cb-cs-meta">
        {application.languages.length > 0 && <span>{application.languages.join(", ")}</span>}
        {application.price && <span>{application.price}</span>}
        {application.contact && <span>{application.contact}</span>}
      </div>
      <div className="cb-cs-card-actions">
        {href ? (
          <Link className="cb-link" to={href}>
            Read more
          </Link>
        ) : (
          <span className="cb-row-meta">Stored in this browser</span>
        )}
      </div>
    </article>
  );
}

interface CoachesResponse {
  coaches: Coach[];
  total: number;
  available: boolean;
  source: string;
}

export function CoachesPage() {
  const [coaches, setCoaches] = useState<Coach[] | null>(null);
  const [error, setError] = useState("");
  const [applications, setApplications] = useState<CoachApplication[]>([]);

  useEffect(() => {
    let alive = true;
    api
      .get<CoachesResponse>("/coaches")
      .then((response) => {
        if (!alive) return;
        setCoaches(response.coaches);
        setError(response.available ? "" : "The captured coach directory is empty.");
      })
      .catch((requestError: Error) => {
        if (!alive) return;
        setCoaches([]);
        setError(requestError.message);
      });
    setApplications(readCoachApplications());
    return () => {
      alive = false;
    };
  }, []);

  const approved = useMemo(
    () => applications.filter((application) => application.status === "approved"),
    [applications]
  );

  return (
    <ContentLayout crumbs={[{ label: "Coaches" }]}>
      <h1 className="cb-cs-title">Chess coaches</h1>
      <p className="cb-cs-lede">
        Coaches must be rated <strong>1900+ on Lichess</strong>, or have an equivalent rating on
        FIDE, USCF or Chess.com. We check ratings before listing. Read how each coach works and
        contact them directly. Chessbook does not take a cut.
      </p>

      <div className="cb-cs-toolbar">
        <div className="cb-cs-tabs">
          <span className="cb-cs-tab active">
            {coaches == null ? "Coaches" : `${coaches.length} listed`}
          </span>
        </div>
        <Link className="cb-btn small" to="/coaches/review">
          Review applications
        </Link>
      </div>

      {coaches === null ? (
        <SkeletonRows rows={4} />
      ) : error || coaches.length === 0 ? (
        <EmptyState icon="fa-user-tie" title="Coach directory unavailable" action={
          <Link className="cb-btn" to="/coaches/apply">
            Apply to be listed
          </Link>
        }>
          {error || "The captured coach directory contains no entries."}
        </EmptyState>
      ) : (
        <div className="cb-cs-cards">
          {coaches.map((coach) => (
            <CoachCard coach={coach} key={coach.slug} />
          ))}
        </div>
      )}

      {approved.length > 0 && (
        <>
          <h2 className="cb-cs-section-title">Local applications</h2>
          <p className="cb-cs-lede" style={{ marginBottom: 18 }}>
            Approved through the local review queue. These profiles are stored in this browser and
            are not part of the captured Chessbook directory.
          </p>
          <div className="cb-cs-cards">
            {approved.map((application) => (
              <LocalApplicationCard
                application={application}
                href={`/coaches/${coachAppSlug(application)}`}
                key={application.id}
              />
            ))}
          </div>
        </>
      )}

      <div className="cb-cs-callout">
        <div>
          <h2>Are you a chess coach?</h2>
          <p>
            Listing is free. Tell us your rating, the levels you teach and how you coach; we check
            the rating and review your application. Applications in this local build are stored in
            this browser and reviewed on the review screen.
          </p>
        </div>
        <Link className="cb-btn primary" to="/coaches/apply">
          Apply to be listed
        </Link>
      </div>

      <div className="cb-cs-columns">
        <div>
          <h3>Checked ratings</h3>
          <p>
            We check each coach’s rating on Lichess, Chess.com, FIDE or USCF before listing. The
            local review screen flags applications below 1900.
          </p>
        </div>
        <div>
          <h3>No ranking</h3>
          <p>
            Coaches appear in a random order. Nobody pays for a better spot, and Chessbook takes no
            cut of lessons.
          </p>
        </div>
        <div>
          <h3>Your call</h3>
          <p>
            We do not vet teaching quality. Read the description and contact the coach directly.
          </p>
        </div>
      </div>
    </ContentLayout>
  );
}
