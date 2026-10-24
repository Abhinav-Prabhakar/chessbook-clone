import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  api,
  flushOfflineQueue,
  offlineSnapshot,
  onOfflineChange,
  type OfflineSnapshot,
} from "../api";
import { START_FEN } from "../chess";
import { Board } from "../components/Board";
import {
  BoardHeader,
  EmptyState,
  Row,
  Section,
  Sidebar,
  SkeletonRows,
  Splash,
  Stat,
} from "../components/ui";
import type {
  DailySummary,
  HistoryMistake,
  Repertoire,
  ReviewHistoryRow,
} from "../types";

/**
 * Review-history browser (D018/D022).
 *
 * The server records one `reviews` row per answered position and exposes it
 * through `GET /practice/reviews`. This page reads that log, groups it by day,
 * and links every row back into practice (weak mode, filtered to the same
 * line) plus an exact-position builder link for outstanding mistakes.
 *
 * Route: `/history/:key` (`white` when `/history` has no key).
 */

const MODE_LABELS: Record<string, string> = {
  due: "Due review",
  weak: "Mistakes",
  all: "All moves",
  early: "Early review",
  specific: "Specific opening",
  line: "Specific opening",
  common: "Next common moves",
  upload: "Uploaded review",
};

type ResultFilter = "all" | "correct" | "wrong";
type RangeFilter = "all" | "today" | "7d" | "30d" | "date";

const RANGE_OPTIONS: { value: RangeFilter; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "date", label: "Specific day" },
];

const tzOffset = () => new Date().getTimezoneOffset();

function localDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDay(date);
}

function reviewDay(review: ReviewHistoryRow): string {
  return review.daily || review.createdAt.slice(0, 10);
}

function formatDay(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === shiftDay(today, -1)) return "Yesterday";
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function moveLabel(side: string, ply: number, san: string): string {
  const number = Math.floor((Number(ply) - 1) / 2) + 1;
  const safe = Number.isFinite(number) && number > 0 ? number : 1;
  return `${safe}${side === "white" ? "." : "…"} ${san}`;
}

function modeLabel(mode: string): string {
  return MODE_LABELS[mode] ?? mode.charAt(0).toUpperCase() + mode.slice(1);
}

export function HistoryPage() {
  const { key = "white" } = useParams<{ key: string }>();
  const [target, setTarget] = useState<Repertoire | null>(null);
  const [reviews, setReviews] = useState<ReviewHistoryRow[]>([]);
  const [mistakes, setMistakes] = useState<HistoryMistake[]>([]);
  const [daily, setDaily] = useState<DailySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reviewsError, setReviewsError] = useState("");
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [rangeFilter, setRangeFilter] = useState<RangeFilter>("all");
  const [specificDay, setSpecificDay] = useState("");
  const [modeFilter, setModeFilter] = useState("all");
  const [offline, setOffline] = useState<OfflineSnapshot>(() => offlineSnapshot());

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setReviewsError("");
    try {
      const list = await api.get<{ repertoires: Repertoire[] }>("/repertoires");
      const requested = String(key);
      const found =
        list.repertoires.find((repertoire) => String(repertoire.id) === requested) ??
        list.repertoires.find((repertoire) => repertoire.color === requested) ??
        list.repertoires[0] ??
        null;
      setTarget(found);
      if (!found) {
        setReviews([]);
        setMistakes([]);
        setDaily(null);
        return;
      }

      const [reviewResult, dailyResult, mistakeResult] = await Promise.allSettled([
        api.get<{ reviews: ReviewHistoryRow[] }>(
          `/practice/reviews?repertoire=${found.id}&limit=500`
        ),
        api.get<{ daily: DailySummary }>(`/practice/daily?tzOffset=${tzOffset()}`),
        api.get<{ count: number; mistakes: HistoryMistake[] }>(
          `/repertoires/${found.id}/mistakes`
        ),
      ]);

      if (reviewResult.status === "fulfilled") {
        setReviews(reviewResult.value.reviews ?? []);
      } else {
        setReviews([]);
        setReviewsError(reviewResult.reason?.message || "Review history could not be loaded.");
      }
      if (dailyResult.status === "fulfilled") setDaily(dailyResult.value.daily ?? null);
      else setDaily(null);
      if (mistakeResult.status === "fulfilled") {
        setMistakes(mistakeResult.value.mistakes ?? []);
      } else {
        setMistakes([]);
      }
    } catch (e: any) {
      setError(e?.message || "The local history could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const unsubscribe = onOfflineChange(setOffline);
    return () => {
      unsubscribe();
    };
  }, []);

  const today = daily?.date ?? localDay(new Date());

  const modes = useMemo(
    () => [...new Set(reviews.map((review) => review.mode))].sort(),
    [reviews]
  );

  const summary = useMemo(() => {
    const total = reviews.length;
    const correct = reviews.filter((review) => review.correct).length;
    const wrong = total - correct;
    const accuracy = total ? Math.round((correct / total) * 100) : 0;
    return { total, correct, wrong, accuracy };
  }, [reviews]);

  const filtered = useMemo(() => {
    const from =
      rangeFilter === "7d"
        ? shiftDay(today, -6)
        : rangeFilter === "30d"
          ? shiftDay(today, -29)
          : null;
    const to = rangeFilter === "date" ? specificDay : null;
    return reviews.filter((review) => {
      if (resultFilter === "correct" && !review.correct) return false;
      if (resultFilter === "wrong" && review.correct) return false;
      if (modeFilter !== "all" && review.mode !== modeFilter) return false;
      if (from || to) {
        const day = reviewDay(review);
        if (from && day < from) return false;
        if (rangeFilter === "today" && day !== today) return false;
        if (to && day !== to) return false;
      }
      return true;
    });
  }, [reviews, resultFilter, modeFilter, rangeFilter, specificDay, today]);

  const groups = useMemo(() => {
    const map = new Map<string, ReviewHistoryRow[]>();
    for (const review of filtered) {
      const day = reviewDay(review);
      const bucket = map.get(day);
      if (bucket) bucket.push(review);
      else map.set(day, [review]);
    }
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [filtered]);

  const recentMistakes = mistakes.slice(0, 6);
  const filtersActive =
    resultFilter !== "all" || rangeFilter !== "all" || modeFilter !== "all";

  const syncQueued = async () => {
    await flushOfflineQueue();
    await load();
  };

  if (loading && !target) return <Splash label="Loading review history…" />;

  if (error && !target) {
    return (
      <div className="cb-splash">
        <p>{error}</p>
        <button type="button" className="cb-btn" onClick={() => void load()}>
          Try again
        </button>
        <Link className="cb-btn ghost" to="/repertoires">
          Repertoires
        </Link>
      </div>
    );
  }

  const practiceHref = target ? `/practice/${target.id}?mode=weak` : "/add?tab=new";

  return (
    <div className="cb-app">
      <main className="cb-main">
        <section className="cb-board-col">
          <BoardHeader
            items={[
              ...(target
                ? [{ label: target.name, to: `/repertoire/${target.id}` }]
                : []),
              { label: "History" },
            ]}
          />
          <Board
            fen={recentMistakes[0]?.fen ?? START_FEN}
            orientation={target?.color ?? "white"}
          />
          <div className="cb-board-footer">
            <span>
              {recentMistakes.length
                ? "Last outstanding mistake"
                : target
                  ? `${target.name} review history`
                  : "Review history"}
            </span>
            <Link to={target ? `/learn/${target.id}` : "/learn/white"}>
              Practice <i className="fa fa-arrow-right" aria-hidden />
            </Link>
          </div>
        </section>

        <Sidebar backTo={target ? `/repertoire/${target.id}` : "/dashboard"} backLabel="Back">
          <div className="cb-page-head">
            <h1 className="cb-page-title">Review history</h1>
            <p className="cb-page-sub">
              Every answered position recorded on this device. Reviews are saved to the local
              database; there is no account or cloud upload.
            </p>
          </div>

          {offline.pending > 0 && (
            <div className="cb-inline-note" style={{ margin: "0 18px 12px" }} data-testid="history-queue">
              <i className="fa fa-cloud-arrow-up" aria-hidden />
              <span>
                {offline.pending} queued change{offline.pending === 1 ? "" : "s"} waiting to sync.
                Queued reviews appear here after they reach the local API.
                {offline.online && (
                  <>
                    {" "}
                    <button type="button" className="cb-btn small" onClick={() => void syncQueued()}>
                      Sync now
                    </button>
                  </>
                )}
              </span>
            </div>
          )}

          {!offline.online && (
            <div className="cb-inline-note" style={{ margin: "0 18px 12px" }}>
              <i className="fa fa-plug-circle-xmark" aria-hidden />
              <span>You are offline. Showing the history already stored on this device.</span>
            </div>
          )}

          {reviewsError && (
            <div className="cb-inline-note" style={{ margin: "0 18px 12px" }}>
              <i className="fa fa-triangle-exclamation" aria-hidden />
              <span>
                {reviewsError}{" "}
                <button type="button" className="cb-btn small" onClick={() => void load()}>
                  Retry
                </button>
              </span>
            </div>
          )}

          {!target ? (
            <EmptyState
              icon="fa-chess-board"
              title="No repertoire to review yet"
              action={
                <Link className="cb-btn primary" to="/add?tab=new">
                  Add a repertoire
                </Link>
              }
            >
              Review history is recorded per repertoire. Create or add a repertoire first.
            </EmptyState>
          ) : (
            <>
              <div className="cb-stat-grid cb-history-stats" data-testid="history-summary">
                <Stat value={summary.total} label="Reviews" />
                <Stat value={summary.correct} label="Correct" />
                <Stat value={summary.wrong} label="Wrong" />
                <Stat value={`${summary.accuracy}%`} label="Accuracy" />
                <Stat
                  value={daily?.streak.current ?? 0}
                  label="Streak"
                  hint={daily?.streak.highest ? `Best ${daily.streak.highest}` : undefined}
                />
              </div>

              <div className="cb-tabs" role="tablist" aria-label="Filter by result">
                {(
                  [
                    ["all", `All ${summary.total}`],
                    ["correct", `Correct ${summary.correct}`],
                    ["wrong", `Wrong ${summary.wrong}`],
                  ] as [ResultFilter, string][]
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={resultFilter === value}
                    className={`cb-tab ${resultFilter === value ? "active" : ""}`}
                    onClick={() => setResultFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="cb-history-filters">
                <label>
                  <span className="cb-history-filters-label">Date</span>
                  <select
                    className="cb-select"
                    value={rangeFilter}
                    onChange={(event) => {
                      const value = event.target.value as RangeFilter;
                      setRangeFilter(value);
                      if (value === "date" && !specificDay) setSpecificDay(today);
                    }}
                  >
                    {RANGE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="cb-history-filters-label">Review mode</span>
                  <select
                    className="cb-select"
                    value={modeFilter}
                    onChange={(event) => setModeFilter(event.target.value)}
                  >
                    <option value="all">All modes</option>
                    {modes.map((mode) => (
                      <option key={mode} value={mode}>
                        {modeLabel(mode)}
                      </option>
                    ))}
                  </select>
                </label>
                {rangeFilter === "date" && (
                  <label>
                    <span className="cb-history-filters-label">Day</span>
                    <input
                      className="cb-input"
                      type="date"
                      value={specificDay}
                      onChange={(event) => setSpecificDay(event.target.value)}
                    />
                  </label>
                )}
              </div>

              {recentMistakes.length > 0 && (
                <div style={{ marginTop: 22 }}>
                  <Section
                    title="Recent mistakes"
                    action={
                      <Link className="cb-row-meta" to={`/learn/${target.id}`}>
                        Practice weak moves
                      </Link>
                    }
                  >
                    {recentMistakes.map((mistake) => (
                      <div
                        className="cb-history-mistake"
                        key={`${mistake.epd}-${mistake.lineId}`}
                      >
                        <div className="cb-history-mistake-copy">
                          <strong>
                            {moveLabel(mistake.side, mistake.ply, mistake.expectedSan)}
                          </strong>
                          <span>
                            {mistake.lineName} · {mistake.side === "white" ? "White" : "Black"} to
                            move · {mistake.alternatives.length} saved answer
                            {mistake.alternatives.length === 1 ? "" : "s"}
                          </span>
                        </div>
                        <div className="cb-history-mistake-actions">
                          <Link
                            className="cb-btn small"
                            to={`/practice/${target.id}?mode=weak&line=${mistake.lineId}`}
                          >
                            Practice
                          </Link>
                          <Link
                            className="cb-btn small ghost"
                            to={`/build/${target.id}?epd=${encodeURIComponent(
                              mistake.epd
                            )}&line=${mistake.lineId}`}
                          >
                            Position
                          </Link>
                        </div>
                      </div>
                    ))}
                  </Section>
                </div>
              )}

              {reviews.length === 0 ? (
                <EmptyState
                  icon="fa-clock-rotate-left"
                  title="No review history yet"
                  action={
                    <Link className="cb-btn primary" to={practiceHref}>
                      Start a review
                    </Link>
                  }
                >
                  Positions you answer in practice are logged here with the expected move, the
                  move you played and the review mode.
                </EmptyState>
              ) : filtered.length === 0 ? (
                <EmptyState
                  icon="fa-filter-circle-xmark"
                  title="No reviews match these filters"
                  action={
                    filtersActive ? (
                      <button
                        type="button"
                        className="cb-btn"
                        onClick={() => {
                          setResultFilter("all");
                          setRangeFilter("all");
                          setModeFilter("all");
                          setSpecificDay("");
                        }}
                      >
                        Clear filters
                      </button>
                    ) : undefined
                  }
                >
                  Try another date range, mode or result.
                </EmptyState>
              ) : (
                <>
                  <div className="cb-section-head" style={{ marginTop: 22 }}>
                    <span>
                      {filtered.length} review{filtered.length === 1 ? "" : "s"}
                    </span>
                    <span className="cb-row-meta">
                      {summary.total > filtered.length
                        ? `${summary.total} total`
                        : "All recorded reviews"}
                    </span>
                  </div>
                  {groups.map(([day, rows]) => (
                    <Section
                      key={day}
                      title={formatDay(day, today)}
                      action={<span className="cb-row-meta">{rows.length}</span>}
                    >
                      {rows.map((review) => (
                        <Row
                          key={review.id}
                          title={moveLabel(review.side, review.ply, review.san)}
                          meta={`${review.lineName ?? "Saved line"} · ${modeLabel(review.mode)}${
                            review.grade != null ? ` · grade ${review.grade}` : ""
                          }`}
                          to={
                            review.lineId
                              ? `/practice/${target.id}?mode=weak&line=${review.lineId}`
                              : practiceHref
                          }
                          right={
                            <span className={`cb-row-meta ${review.correct ? "strong" : ""}`}>
                              {review.correct ? "Correct" : `Played ${review.playedSan}`}{" "}
                              <i
                                className={`fa ${review.correct ? "fa-check" : "fa-xmark"}`}
                                aria-hidden
                              />
                            </span>
                          }
                        />
                      ))}
                    </Section>
                  ))}
                </>
              )}

              {loading && <SkeletonRows rows={3} />}
            </>
          )}
        </Sidebar>
      </main>
    </div>
  );
}
