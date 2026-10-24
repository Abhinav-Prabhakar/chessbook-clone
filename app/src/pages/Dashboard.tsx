import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useBoard, START_FEN } from "../board/stage";
import { useApi } from "../useApi";
import type { Daily, Gap, RepertoireSummary } from "../types";
import { ErrorNote, Icon, Progress, Row, Section, Skeleton } from "../ui";
import { buildPath, practicePath, repertoirePath } from "../routes";

interface DashboardData {
  repertoires: RepertoireSummary[];
  daily: Daily;
  tasks: {
    due: number;
    fresh: number;
    practiceRepertoire: number | null;
    gap: (Gap & { repertoireId: number; repertoireName: string }) | null;
    model: { id: number; white: string; black: string; completed: boolean } | null;
  };
}

export function CompletionRing({ value }: { value: number }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ring" width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r={r} className="ring-track" />
      <circle
        cx="8"
        cy="8"
        r={r}
        className="ring-fill"
        strokeDasharray={`${(c * Math.max(0, Math.min(100, value))) / 100} ${c}`}
        transform="rotate(-90 8 8)"
      />
    </svg>
  );
}

export function RepertoireRows({ repertoires }: { repertoires: RepertoireSummary[] }) {
  return (
    <div className="rows">
      {repertoires.map((r) => (
        <Row
          key={r.id}
          variant="large"
          to={repertoirePath(r.id)}
          title={
            <span className="rep-title">
              <span className={`color-dot ${r.color}`} />
              {r.name}
            </span>
          }
          right={
            <span className="rep-progress">
              {r.started ? `${r.completion}% complete` : "Not started"}
              <CompletionRing value={r.started ? r.completion : 0} />
            </span>
          }
        />
      ))}
    </div>
  );
}

export function Dashboard() {
  const { data, error, reload } = useApi<DashboardData>("/dashboard");
  useBoard({ fen: START_FEN, orientation: "white", peek: true });

  if (error && !data) return <ErrorNote error={error} retry={reload} />;
  if (!data) return <Skeleton rows={7} />;

  const { repertoires, daily, tasks } = data;
  const practiceTarget = tasks.practiceRepertoire;
  let practiceRight: ReactNode;
  if (tasks.due > 0) {
    practiceRight = (
      <span className="pill due">
        {tasks.due} due <Icon name="clock" />
      </span>
    );
  } else if (tasks.fresh > 0) {
    practiceRight = <span className="pill">{tasks.fresh} new</span>;
  } else {
    practiceRight = (
      <span className="pill done">
        All caught up <Icon name="check" />
      </span>
    );
  }

  return (
    <div className="dashboard">
      <Section
        title="Repertoires"
        right={
          <Link to="/repertoires/new" className="head-link">
            Add new <Icon name="plus" />
          </Link>
        }
      >
        <RepertoireRows repertoires={repertoires} />
      </Section>

      <Section
        title="Daily tasks"
        right={
          daily.streak > 0 ? (
            <span className="streak">
              {daily.streak} day streak <Icon name="fire" />
            </span>
          ) : (
            <span className="streak muted">
              No streak <Icon name="fire" />
            </span>
          )
        }
      >
        <div className="rows">
          <Row
            title={tasks.due > 0 ? "Practice moves" : tasks.fresh > 0 ? "Learn new moves" : "Practice moves"}
            meta={
              tasks.due === 0 && tasks.fresh === 0
                ? "Nothing is due. Build your repertoire or review early."
                : undefined
            }
            right={practiceRight}
            to={practiceTarget ? practicePath(practiceTarget, tasks.due > 0 ? "due" : "new") : undefined}
            disabled={!practiceTarget}
          />
          {tasks.gap && (
            <Row
              title="Fill your biggest gap"
              meta={`${tasks.gap.repertoireName} · ${gapText(tasks.gap)}`}
              right={<span className="pill">1 in {tasks.gap.expectedIn} games</span>}
              to={buildPath(tasks.gap.repertoireId, tasks.gap.path)}
            />
          )}
          {tasks.model && (
            <Row
              title="Play through a model game"
              right={
                <span className="pill model">
                  {short(tasks.model.white)} vs. {short(tasks.model.black)}
                  <Icon name={tasks.model.completed ? "check" : "star"} />
                </span>
              }
              to={`/model-games/${tasks.model.id}`}
            />
          )}
        </div>
        <div className="daily">
          <div className="daily-head">
            <span>
              {Math.min(daily.reviewed, daily.goal)} / {daily.goal} moves today
            </span>
            {daily.bestStreak > 1 && <span className="muted">Best streak {daily.bestStreak} days</span>}
          </div>
          <Progress value={(daily.reviewed / Math.max(1, daily.goal)) * 100} tone="orange" />
        </div>
      </Section>

      <Section title="Train">
        <div className="rows">
          <Row title="Training games" meta="Play your openings against a bot that plays like people at your level" to="/training-games" chevron />
          <Row title="Opening puzzles" meta="Punish the mistakes that happen in your openings" to="/puzzles" chevron />
          <Row title="Model games" meta="Master games that follow your repertoire" to="/model-games" chevron />
          <Row title="Opening guides" meta="Explore openings and start a ready-made repertoire" to="/openings" chevron />
        </div>
      </Section>

      <Section title="More">
        <div className="rows plain">
          <Row variant="plain" title="Review history" to="/history" chevron />
          <Row variant="plain" title="How Chessbook works" to="/about" chevron />
        </div>
      </Section>
    </div>
  );
}

function short(name: string) {
  const parts = name.split(" ");
  return parts[parts.length - 1];
}

export function gapText(gap: Gap) {
  if (!gap.lastMove) return "Choose your first move";
  return `Respond to ${gap.label}${gap.opening ? ` (${gap.opening.name.split(":")[0]})` : ""}`;
}
