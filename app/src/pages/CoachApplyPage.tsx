import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useToast } from "../components/Toast";
import { ContentLayout } from "./OpeningsPage";
import {
  readCoachApplications,
  writeCoachApplications,
  type CoachApplication,
} from "./CoachesPage";

const PLATFORMS = ["Lichess", "Chess.com", "FIDE", "USCF"] as const;
const TIME_CONTROLS = ["Bullet", "Blitz", "Rapid", "Classical"] as const;
const LEVELS = ["Beginner", "Intermediate", "Advanced"] as const;

const makeId = () => {
  try {
    return crypto.randomUUID();
  } catch {
    return `app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
};

export function CoachApplyPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [ratingValue, setRatingValue] = useState("2000");
  const [platform, setPlatform] = useState<(typeof PLATFORMS)[number]>("Lichess");
  const [timeControl, setTimeControl] = useState<(typeof TIME_CONTROLS)[number]>("Rapid");
  const [price, setPrice] = useState("");
  const [languages, setLanguages] = useState("English");
  const [levels, setLevels] = useState<string[]>(["Beginner", "Intermediate"]);
  const [bio, setBio] = useState("");
  const [contact, setContact] = useState("");
  const [firstLessonFree, setFirstLessonFree] = useState(false);
  const [error, setError] = useState("");

  const toggleLevel = (level: string) => {
    setLevels((current) =>
      current.includes(level) ? current.filter((entry) => entry !== level) : [...current, level]
    );
  };

  const submit = () => {
    const rating = Number(ratingValue);
    if (name.trim().length < 2) {
      setError("Enter the name you want listed.");
      return;
    }
    if (!Number.isFinite(rating) || rating < 400 || rating > 3500) {
      setError("Enter a rating between 400 and 3500.");
      return;
    }
    if (bio.trim().length < 40) {
      setError("Write at least 40 characters about how you coach.");
      return;
    }
    if (!contact.trim()) {
      setError("Add an email or platform username so students can reach you.");
      return;
    }
    setError("");
    const application: CoachApplication = {
      id: makeId(),
      name: name.trim(),
      ratingValue: rating,
      platform,
      timeControl,
      rating: `${rating} ${platform} ${timeControl}`,
      price: price.trim(),
      languages: languages
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
      levels,
      bio: bio.trim(),
      contact: contact.trim(),
      firstLessonFree,
      createdAt: new Date().toISOString(),
      status: "pending",
      reviewedAt: null,
    };
    const existing = readCoachApplications();
    writeCoachApplications([application, ...existing]);
    toast("Application saved locally — it is now in the review queue", "ok");
    navigate("/coaches/review");
  };

  return (
    <ContentLayout
      crumbs={[{ label: "Coaches", to: "/coaches" }, { label: "Apply" }]}
      narrow
    >
      <h1 className="cb-cs-title">Apply to be listed</h1>
      <p className="cb-cs-lede">
        Listing is free. Tell us your rating, the levels you teach and how you coach; we check the
        rating and review your application. In this local build the application stays in this
        browser and appears on the review screen — no account, email or server submission is
        involved.
      </p>

      <div className="cb-cs-form">
        <div className="cb-cs-form-row">
          <label className="cb-field">
            <span>Name</span>
            <input
              className="cb-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name or coach handle"
            />
          </label>
          <label className="cb-field">
            <span>Price</span>
            <input
              className="cb-input"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              placeholder="$40/hour (optional)"
            />
          </label>
        </div>

        <div className="cb-cs-form-row">
          <label className="cb-field">
            <span>Rating</span>
            <input
              className="cb-input"
              type="number"
              min={400}
              max={3500}
              value={ratingValue}
              onChange={(event) => setRatingValue(event.target.value)}
            />
          </label>
          <label className="cb-field">
            <span>Platform</span>
            <select
              className="cb-select"
              value={platform}
              onChange={(event) => setPlatform(event.target.value as (typeof PLATFORMS)[number])}
            >
              {PLATFORMS.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="cb-cs-form-row">
          <label className="cb-field">
            <span>Time control</span>
            <select
              className="cb-select"
              value={timeControl}
              onChange={(event) =>
                setTimeControl(event.target.value as (typeof TIME_CONTROLS)[number])
              }
            >
              {TIME_CONTROLS.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
          <label className="cb-field">
            <span>Languages (comma separated)</span>
            <input
              className="cb-input"
              value={languages}
              onChange={(event) => setLanguages(event.target.value)}
              placeholder="English, Russian"
            />
          </label>
        </div>

        <div className="cb-field">
          <span>Levels you teach</span>
          <div className="cb-cs-choice">
            {LEVELS.map((level) => (
              <button
                type="button"
                key={level}
                className={levels.includes(level) ? "active" : ""}
                onClick={() => toggleLevel(level)}
                aria-pressed={levels.includes(level)}
              >
                {level}
              </button>
            ))}
          </div>
        </div>

        <label className="cb-field">
          <span>How you coach</span>
          <textarea
            className="cb-textarea"
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            placeholder="Describe your lessons, how you review games, and what students should expect."
          />
        </label>

        <label className="cb-field">
          <span>Contact (email or platform username)</span>
          <input
            className="cb-input"
            value={contact}
            onChange={(event) => setContact(event.target.value)}
            placeholder="you@example.com or your Chess.com handle"
          />
        </label>

        <label className="cb-cs-check">
          <input
            type="checkbox"
            checked={firstLessonFree}
            onChange={(event) => setFirstLessonFree(event.target.checked)}
          />
          I offer a free first lesson
        </label>

        {Number(ratingValue) < 1900 && Number(ratingValue) > 0 && (
          <p className="cb-cs-note" style={{ margin: 0 }}>
            <i className="fa fa-triangle-exclamation" aria-hidden />
            <span>
              The directory standard is 1900+ on Lichess or an equivalent FIDE, USCF or Chess.com
              rating. You can still submit; the review screen will flag this application.
            </span>
          </p>
        )}

        {error && <p className="cb-cs-error">{error}</p>}

        <div className="cb-cs-actions">
          <button type="button" className="cb-btn primary" onClick={submit}>
            Submit application
          </button>
          <Link className="cb-btn" to="/coaches">
            Cancel
          </Link>
          <Link className="cb-link" to="/coaches/review">
            Review queue
          </Link>
        </div>
      </div>

      <p className="cb-cs-note">
        <i className="fa fa-circle-info" aria-hidden />
        <span>
          Applications are stored in <code>localStorage</code> under{" "}
          <code>cb_coach_applications_v1</code>. They survive a reload in this browser and are
          removed if you clear site data.
        </span>
      </p>
    </ContentLayout>
  );
}
