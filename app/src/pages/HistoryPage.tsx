import { useSearchParams } from "react-router-dom";
import { Crumbs, START_FEN, useBoard } from "../board/stage";
import { useApi } from "../useApi";
import type { Opening } from "../types";
import { Back, Empty, ErrorNote, Icon, PageHead, Section, Skeleton } from "../ui";

interface Review {
  id: number;
  repertoire_id: number;
  san: string;
  played: string | null;
  correct: boolean;
  kind: string;
  at: string;
  day: string;
  epd: string;
  opening: Opening | null;
}

export function HistoryPage() {
  const [params] = useSearchParams();
  const repertoire = params.get("repertoire");
  const { data, error, reload } = useApi<{ reviews: Review[] }>(`/history${repertoire ? `?repertoire=${repertoire}` : ""}`);
  useBoard({ fen: START_FEN, orientation: "white", peek: true });

  if (error && !data) return <ErrorNote error={error} retry={reload} />;
  const reviews = (data?.reviews || []).filter((r) => r.kind === "review");
  const days = new Map<string, Review[]>();
  for (const r of reviews) {
    if (!days.has(r.day)) days.set(r.day, []);
    days.get(r.day)!.push(r);
  }

  return (
    <>
      <Crumbs items={[{ label: "History" }]} />
      <Back />
      <PageHead title="Review history" sub="Every move you've been asked, and what you played." />
      {!data ? (
        <Skeleton rows={6} />
      ) : reviews.length === 0 ? (
        <Empty title="Nothing reviewed yet">Practice a few moves and they'll show up here.</Empty>
      ) : (
        [...days.entries()].map(([day, rows]) => {
          const ok = rows.filter((r) => r.correct).length;
          return (
            <Section key={day} title={formatDay(day)} right={<span className="muted">{ok} of {rows.length} correct</span>}>
              <div className="history-list">
                {rows.map((r) => (
                  <div key={r.id} className="history-row">
                    <span className={r.correct ? "good-text" : "bad-text"}>
                      <Icon name={r.correct ? "check" : "x"} />
                    </span>
                    <span className="history-move">
                      {r.san}
                      {!r.correct && r.played && r.played !== r.san && <span className="muted"> · you played {r.played}</span>}
                    </span>
                    <span className="history-opening muted">{r.opening?.name ?? ""}</span>
                  </div>
                ))}
              </div>
            </Section>
          );
        })
      )}
    </>
  );
}

function formatDay(day: string) {
  const d = new Date(`${day}T12:00:00`);
  const today = new Date();
  const diff = Math.round((today.setHours(12, 0, 0, 0) - d.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}
