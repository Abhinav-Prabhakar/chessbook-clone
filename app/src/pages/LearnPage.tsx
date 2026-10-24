import { useParams } from "react-router-dom";
import { Crumbs, START_FEN, useBoard } from "../board/stage";
import { useApi } from "../useApi";
import type { Daily, Opening, RepertoireSummary } from "../types";
import { Back, ErrorNote, Icon, PageHead, Progress, Row, Section, Skeleton, relativeDue } from "../ui";
import { buildPath, practicePath, repertoirePath } from "../routes";
import { useSettings } from "../settings";

interface LearnData {
  repertoire: RepertoireSummary;
  counts: { due: number; fresh: number; difficult: number; all: number; scheduled: number; nextDue: string | null };
  daily: Daily;
  mistakes: { san: string; played: string | null; epd: string; at: string; opening: Opening | null }[];
}

export function LearnPage() {
  const { id = "" } = useParams();
  const { settings } = useSettings();
  const { data, error, reload } = useApi<LearnData>(`/practice/${id}`);
  useBoard({ fen: START_FEN, orientation: data?.repertoire.color ?? "white", peek: true });
  if (error && !data) return <ErrorNote error={error} retry={reload} />;
  if (!data) return <Skeleton rows={6} />;
  const { repertoire: rep, counts, daily } = data;
  const newInSession = Math.min(counts.fresh, settings.newPerSession);

  if (rep.stats.mine === 0) {
    return (
      <>
        <Crumbs items={[{ label: rep.name, to: repertoirePath(rep.id) }, { label: "Learn" }]} />
        <Back to={repertoirePath(rep.id)} />
        <PageHead title="Nothing to practice yet" sub="Add a few moves to this repertoire first, then come back to learn them." />
        <div className="rows actions">
          <Row title="Start building" to={buildPath(rep.id)} chevron />
        </div>
      </>
    );
  }

  return (
    <>
      <Crumbs items={[{ label: rep.name, to: repertoirePath(rep.id) }, { label: "Learn" }]} />
      <Back to={repertoirePath(rep.id)} />
      <PageHead title="What do you want to practice?" />
      <div className="stat-block tight">
        <div className="stat-line">
          <strong>{rep.stats.masteredPercent.toFixed(1)}% mastered</strong>
          <span className="muted">
            {Math.min(daily.reviewed, daily.goal)} / {daily.goal} today
            {daily.streak > 0 ? ` · ${daily.streak} day streak` : ""}
          </span>
        </div>
        <Progress value={rep.stats.masteredPercent} tone="blue" />
      </div>

      <div className="rows focus-rows">
        <Row
          variant="accent"
          title="Everything that's due"
          meta={
            counts.due + newInSession === 0
              ? counts.nextDue
                ? `Nothing due. Next review ${relativeDue(counts.nextDue)}.`
                : "Nothing due."
              : newInSession > 0
                ? `${counts.due} to review and ${newInSession} new`
                : undefined
          }
          right={
            <span className={`pill${counts.due ? " due" : ""}`}>
              {counts.due} due <Icon name="clock" />
            </span>
          }
          to={practicePath(rep.id, "due")}
          disabled={counts.due + newInSession === 0}
        />
        <Row
          variant="accent"
          title="Learn new moves"
          meta={counts.fresh ? `Up to ${settings.newPerSession} per session` : "You've learned every move"}
          right={<span className="pill">{counts.fresh} new</span>}
          to={practicePath(rep.id, "new")}
          disabled={counts.fresh === 0}
        />
        <Row
          variant="accent"
          title="Just the moves I often get wrong"
          right={<span className="pill">{counts.difficult}</span>}
          to={practicePath(rep.id, "difficult")}
          disabled={counts.difficult === 0}
        />
        <Row
          variant="accent"
          title="Review before they're due"
          meta="Doesn't change when they come up next unless you miss one"
          right={<span className="pill">{counts.scheduled}</span>}
          to={practicePath(rep.id, "early")}
          disabled={counts.scheduled === 0}
        />
        <Row
          variant="accent"
          title="Every move, line by line"
          right={<span className="pill">{counts.all} moves</span>}
          to={practicePath(rep.id, "all")}
        />
      </div>

      {data.mistakes.length > 0 && (
        <Section title="Recent mistakes">
          <div className="rows plain">
            {data.mistakes.map((m, i) => (
              <Row
                key={`${m.at}-${i}`}
                variant="plain"
                title={
                  <>
                    Played <span className="bad-text">{m.played || "?"}</span> instead of <span className="good-text">{m.san}</span>
                  </>
                }
                meta={m.opening?.name}
              />
            ))}
          </div>
        </Section>
      )}
      <div className="rows actions">
        <Row variant="plain" title="Review history" to={`/history?repertoire=${rep.id}`} chevron />
      </div>
    </>
  );
}
