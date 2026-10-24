import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState } from "../components/ui";
import { useToast } from "../components/Toast";
import { ContentLayout } from "./OpeningsPage";
import {
  coachAppSlug,
  readCoachApplications,
  writeCoachApplications,
  type CoachApplication,
} from "./CoachesPage";

type Filter = "all" | "pending" | "approved" | "rejected";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

export function CoachReviewPage() {
  const { toast } = useToast();
  const [applications, setApplications] = useState<CoachApplication[]>(() => readCoachApplications());
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(() => {
    return {
      all: applications.length,
      pending: applications.filter((entry) => entry.status === "pending").length,
      approved: applications.filter((entry) => entry.status === "approved").length,
      rejected: applications.filter((entry) => entry.status === "rejected").length,
    };
  }, [applications]);

  const visible = useMemo(
    () =>
      filter === "all"
        ? applications
        : applications.filter((application) => application.status === filter),
    [applications, filter]
  );

  const update = (id: string, patch: Partial<CoachApplication>, message: string) => {
    const next = applications.map((application) =>
      application.id === id ? { ...application, ...patch } : application
    );
    setApplications(next);
    writeCoachApplications(next);
    toast(message, "ok");
  };

  const approve = (application: CoachApplication) =>
    update(
      application.id,
      { status: "approved", reviewedAt: new Date().toISOString() },
      `${application.name} approved`
    );

  const reject = (application: CoachApplication) =>
    update(
      application.id,
      { status: "rejected", reviewedAt: new Date().toISOString() },
      `${application.name} rejected`
    );

  const reopen = (application: CoachApplication) =>
    update(
      application.id,
      { status: "pending", reviewedAt: null },
      `${application.name} returned to the queue`
    );

  const remove = (application: CoachApplication) => {
    if (!window.confirm(`Delete ${application.name}'s application from this browser?`)) return;
    const next = applications.filter((entry) => entry.id !== application.id);
    setApplications(next);
    writeCoachApplications(next);
    toast("Application deleted", "ok");
  };

  const clearReviewed = () => {
    if (!window.confirm("Delete every approved and rejected application from this browser?")) return;
    const next = applications.filter((entry) => entry.status === "pending");
    setApplications(next);
    writeCoachApplications(next);
    toast("Reviewed applications cleared", "ok");
  };

  return (
    <ContentLayout
      crumbs={[{ label: "Coaches", to: "/coaches" }, { label: "Review" }]}
      narrow
    >
      <h1 className="cb-cs-title">Coach applications</h1>
      <p className="cb-cs-lede">
        The local review queue. Applications are submitted on the{" "}
        <Link to="/coaches/apply">apply page</Link> and stored in this browser only. Ratings below
        the 1900 directory standard are flagged before you approve.
      </p>

      <div className="cb-cs-toolbar">
        <div className="cb-cs-tabs" role="tablist" aria-label="Application status">
          {FILTERS.map((entry) => (
            <button
              key={entry.value}
              type="button"
              role="tab"
              aria-selected={filter === entry.value}
              className={`cb-cs-tab${filter === entry.value ? " active" : ""}`}
              onClick={() => setFilter(entry.value)}
            >
              {entry.label} ({counts[entry.value]})
            </button>
          ))}
        </div>
        <Link className="cb-btn small" to="/coaches/apply">
          New application
        </Link>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon="fa-user-check"
          title={applications.length === 0 ? "No applications yet" : `No ${filter} applications`}
          action={
            <Link className="cb-btn primary" to="/coaches/apply">
              Open the application form
            </Link>
          }
        >
          {applications.length === 0
            ? "Applications submitted from this browser will appear here for review."
            : "Choose another status tab to see the rest of the queue."}
        </EmptyState>
      ) : (
        <div className="cb-cs-apps">
          {visible.map((application) => (
            <article className="cb-cs-app" key={application.id}>
              <div className="cb-cs-app-main">
                <strong>
                  {application.name}{" "}
                  <span className={`cb-cs-status ${application.status}`}>
                    {application.status}
                  </span>
                </strong>
                <p>
                  {application.rating} · {formatDate(application.createdAt)}
                  {application.reviewedAt ? ` · reviewed ${formatDate(application.reviewedAt)}` : ""}
                </p>
                <p>
                  {application.levels.length > 0
                    ? `Teaches ${application.levels.join(", ").toLowerCase()}`
                    : "No teaching levels supplied"}
                  {application.languages.length > 0
                    ? ` · ${application.languages.join(", ")}`
                    : ""}
                  {application.price ? ` · ${application.price}` : ""}
                </p>
                <p>{application.bio}</p>
                <p>
                  Contact: {application.contact}
                  {application.firstLessonFree ? " · Free first lesson" : ""}
                </p>
                {application.ratingValue < 1900 && (
                  <p style={{ color: "var(--cb-orange)" }}>
                    <i className="fa fa-triangle-exclamation" aria-hidden /> Below the 1900
                    directory standard.
                  </p>
                )}
                {application.status === "approved" && (
                  <p>
                    Public path:{" "}
                    <Link to={`/coaches/${coachAppSlug(application)}`}>
                      /coaches/{coachAppSlug(application)}
                    </Link>
                  </p>
                )}
              </div>
              <div className="cb-cs-app-actions">
                {application.status !== "approved" && (
                  <button
                    type="button"
                    className="cb-btn primary small"
                    onClick={() => approve(application)}
                  >
                    Approve
                  </button>
                )}
                {application.status !== "rejected" && (
                  <button
                    type="button"
                    className="cb-btn small"
                    onClick={() => reject(application)}
                  >
                    Reject
                  </button>
                )}
                {application.status !== "pending" && (
                  <button
                    type="button"
                    className="cb-btn small"
                    onClick={() => reopen(application)}
                  >
                    Reopen
                  </button>
                )}
                <button
                  type="button"
                  className="cb-btn danger small"
                  onClick={() => remove(application)}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {counts.approved + counts.rejected > 0 && (
        <div className="cb-cs-actions" style={{ marginTop: 22 }}>
          <button type="button" className="cb-btn" onClick={clearReviewed}>
            Clear reviewed applications
          </button>
          <Link className="cb-link" to="/coaches">
            Back to the directory
          </Link>
        </div>
      )}
    </ContentLayout>
  );
}
