import { useParams } from "react-router-dom";
import { Crumbs, START_FEN, useBoard } from "../board/stage";
import { useApi } from "../useApi";
import type { Daily, PracticeSession, QuizGroup, RepertoireSummary } from "../types";
import { Back, ErrorNote, Icon, PageHead, Progress, Row, Section, Skeleton, relativeDue } from "../ui";
import { buildPath, practicePath, repertoirePath } from "../routes";
import { movesText } from "../chess";
import { savedSession } from "./PracticePage";

interface Counts {
  due: number;
  fresh: number;
  difficultDue: number;
  difficult: number;
  early: number;
  all: number;
  nextDue: string | null;
  batch: number;
}

function DueRight({ n }: { n: number }) {
  return (
    <span className="pill due">
      {n} due <Icon name="clock" />
    </span>
  );
}

const moves = (n: number) => <span className="setting-value">{`${n} move${n === 1 ? "" : "s"}`}</span>;

/** "What do you want to practice?" — rows appear depending on what is due, as in production. */
export function LearnPage() {
  const { id = "" } = useParams();
  const { data, error, reload } = useApi<{ repertoire: RepertoireSummary; counts: Counts; daily: Daily }>(`/practice/${id}`);
  useBoard({ fen: START_FEN, orientation: data?.repertoire.color ?? "white", peek: true });
  if (error && !data) return <ErrorNote error={error} retry={reload} />;
  if (!data) return <Skeleton rows={6} />;
  const { repertoire: rep, counts } = data;
  const crumbs = <Crumbs items={[{ label: rep.name, to: repertoirePath(rep.id) }, { label: "Learn" }]} />;

  if (rep.stats.mine === 0) {
    return (
      <>
        {crumbs}
        <Back to={repertoirePath(rep.id)} />
        <PageHead title="Nothing to practice yet" sub="Add a few moves to this repertoire first, then come back to learn them." />
        <div className="rows list spaced-sm">
          <Row title="Start building" to={buildPath(rep.id)} />
        </div>
      </>
    );
  }

  const resume = savedSession(String(rep.id));
  const recommended = counts.due > counts.batch;
  type Item = { title: string; right?: React.ReactNode; to: string; meta?: string };
  const items: Item[] = [];
  if (resume) items.push({ title: "Continue your practice session", right: <Icon name="forward" />, to: `/repertoires/${rep.id}/practice?resume=1&filter=${resume.filter}` });
  if (recommended) items.push({ title: "Recommended moves", right: <DueRight n={Math.min(counts.batch, counts.due)} />, to: practicePath(rep.id, "recommended") });
  if (counts.due > 0) items.push({ title: "Everything that's due for review", right: <DueRight n={counts.due} />, to: practicePath(rep.id, "due") });
  if (counts.difficultDue > 0) items.push({ title: "Just the moves I often get wrong", right: <DueRight n={counts.difficultDue} />, to: practicePath(rep.id, "difficult-due") });
  if (counts.due === 0) {
    if (counts.early > 0)
      items.push({
        title: "Moves that will be due soon",
        right: moves(Math.min(counts.batch, counts.early)),
        to: practicePath(rep.id, "early"),
        meta: counts.nextDue ? `Next review ${relativeDue(counts.nextDue)}` : undefined,
      });
    if (counts.difficult > 0) items.push({ title: "Just the moves I often get wrong", right: moves(counts.difficult), to: practicePath(rep.id, "difficult") });
  }
  if (counts.all > counts.due) items.push({ title: "All moves, even if they're not due", right: moves(counts.all), to: practicePath(rep.id, "all") });
  items.push({ title: "A specific opening…", to: `/repertoires/${rep.id}/learn/specific` });

  const [first, ...rest] = items;
  return (
    <>
      {crumbs}
      <Back to={repertoirePath(rep.id)} />
      <PageHead title="What do you want to practice?" />
      <div className="stat-block tight">
        <div className="stat-line">
          <strong>{rep.stats.masteredPercent.toFixed(1)}% mastered</strong>
        </div>
        <Progress value={rep.stats.masteredPercent} tone="orange" />
      </div>
      <Row variant="accent" className="block-row" title={first.title} meta={first.meta} right={first.right} to={first.to} />
      <div className="rows list spaced-sm">
        {rest.map((item) => (
          <Row key={item.title + item.to} title={item.title} meta={item.meta} right={item.right} to={item.to} />
        ))}
      </div>
    </>
  );
}

/** "A specific opening…": the lines in the repertoire, grouped by opening. */
export function SpecificOpeningPage() {
  const { id = "" } = useParams();
  const summary = useApi<{ repertoire: RepertoireSummary }>(`/repertoires/${id}`);
  const { data, error, reload } = useApi<PracticeSession>(`/practice/${id}/session?filter=all`);
  const rep = summary.data?.repertoire;
  useBoard({ fen: START_FEN, orientation: rep?.color ?? "white", peek: true });
  if (error && !data) return <ErrorNote error={error} retry={reload} />;

  // A line ends where one of your moves has no saved continuation.
  const lines: { group: QuizGroup; sans: string[] }[] = [];
  for (const group of data?.groups || []) {
    for (const move of group.moves) if (move.leaf) lines.push({ group, sans: [...group.line, move.san] });
  }
  const families = new Map<string, typeof lines>();
  for (const line of lines) {
    const family = (line.group.opening?.name || "Other lines").split(":")[0];
    if (!families.has(family)) families.set(family, []);
    families.get(family)!.push(line);
  }

  return (
    <>
      <Crumbs items={[{ label: rep?.name ?? "Repertoire", to: repertoirePath(id) }, { label: "Learn", to: `/repertoires/${id}/learn` }]} />
      <Back to={`/repertoires/${id}/learn`} />
      <PageHead title="Which opening?" sub="Practice every one of your moves along one line." />
      {!data ? (
        <Skeleton rows={6} />
      ) : (
        [...families.entries()].map(([family, items]) => (
          <Section key={family} title={family}>
            <div className="rows list">
              {items.map(({ group, sans }) => {
                const yours = sans.filter((_, i) => (i % 2 === 0) === (group.side === "white")).length;
                return (
                  <Row
                    key={sans.join(" ")}
                    title={group.opening?.name.split(":")[1]?.trim() || group.opening?.name || family}
                    meta={movesText(sans)}
                    right={moves(yours)}
                    to={practicePath(id, "line", sans)}
                  />
                );
              })}
            </div>
          </Section>
        ))
      )}
    </>
  );
}
