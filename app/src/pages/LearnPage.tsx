import { useParams } from "react-router-dom";
import { Crumbs, START_FEN, useBoard } from "../board/stage";
import { useApi } from "../useApi";
import type { Daily, Opening, PracticeLine, PracticeSession, RepertoireSummary } from "../types";
import { movesText } from "../chess";
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
        <Progress value={rep.stats.masteredPercent} tone="orange" />
      </div>

      <Row
        variant="accent"
        className="block-row"
        title="Everything that's due for review"
        meta={
          counts.due + newInSession === 0
            ? counts.nextDue
              ? `Nothing is due. Next review ${relativeDue(counts.nextDue)}.`
              : "Nothing is due."
            : newInSession > 0
              ? `Includes ${newInSession} new move${newInSession === 1 ? "" : "s"}`
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
      <div className="rows list spaced-sm">
        <Row
          title="Learn new moves"
          right={<span className="setting-value">{counts.fresh} new</span>}
          to={practicePath(rep.id, "new")}
          disabled={counts.fresh === 0}
        />
        <Row
          title="Just the moves I often get wrong"
          right={
            <span className="pill due">
              {counts.difficult} due <Icon name="clock" />
            </span>
          }
          to={practicePath(rep.id, "difficult")}
          disabled={counts.difficult === 0}
        />
        <Row
          title="All moves, even if they're not due"
          right={<span className="setting-value">{counts.all} moves</span>}
          to={practicePath(rep.id, "all")}
        />
        <Row title="A specific opening…" to={`/repertoires/${rep.id}/learn/specific`} />
      </div>

      {data.mistakes.length > 0 && (
        <Section title="Recent mistakes">
          <div className="rows list">
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
      <div className="rows list spaced">
        <Row title="Review history" to={`/history?repertoire=${rep.id}`} />
      </div>
    </>
  );
}

/** "A specific opening…": every line in the repertoire, grouped by opening. */
export function SpecificOpeningPage() {
  const { id = "" } = useParams();
  const summary = useApi<{ repertoire: RepertoireSummary }>(`/repertoires/${id}`);
  const { data, error, reload } = useApi<PracticeSession>(`/practice/${id}/session?mode=all`);
  const rep = summary.data?.repertoire;
  useBoard({ fen: START_FEN, orientation: rep?.color ?? "white", peek: true });
  if (error && !data) return <ErrorNote error={error} retry={reload} />;
  const groups = new Map<string, PracticeLine[]>();
  for (const line of data?.lines || []) {
    const family = (line.opening?.name || "Other lines").split(":")[0];
    if (!groups.has(family)) groups.set(family, []);
    groups.get(family)!.push(line);
  }
  return (
    <>
      <Crumbs items={[{ label: rep?.name ?? "Repertoire", to: repertoirePath(id) }, { label: "Learn", to: `/repertoires/${id}/learn` }]} />
      <Back to={`/repertoires/${id}/learn`} />
      <PageHead title="Which opening?" sub="Practice every one of your moves in one line." />
      {!data ? (
        <Skeleton rows={6} />
      ) : (
        [...groups.entries()].map(([family, lines]) => (
          <Section key={family} title={family}>
            <div className="rows list">
              {lines.map((line) => (
                <Row
                  key={line.sans.join(" ")}
                  title={line.opening?.name.split(":")[1]?.trim() || line.opening?.name || family}
                  meta={movesText(line.sans)}
                  right={
                    <span className="setting-value">
                      {(() => {
                        const n = line.plies.filter((p) => p.side === line.color).length;
                        return `${n} move${n === 1 ? "" : "s"}`;
                      })()}
                    </span>
                  }
                  to={practicePath(id, "line", line.sans)}
                />
              ))}
            </div>
          </Section>
        ))
      )}
    </>
  );
}
