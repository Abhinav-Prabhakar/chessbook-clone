import { Crumbs, START_FEN, useBoard } from "../board/stage";
import { useApi } from "../useApi";
import { Back, PageHead, Section, compact } from "../ui";

interface About {
  data: { masters: { positions: number; games: number | null }; lichess: { positions: number; games: number | null } };
  modelGames: number;
  puzzles: number;
  openings: number;
}

export function AboutPage() {
  const { data } = useApi<About>("/about");
  useBoard({ fen: START_FEN, orientation: "white", peek: true });
  return (
    <>
      <Crumbs items={[{ label: "How it works" }]} />
      <Back />
      <PageHead title="How Chessbook works" />
      <Section title="Build">
        <div className="prose">
          <p>
            A repertoire is the set of moves you play with one color. On your turn you choose one move; on your opponent's turn
            you prepare an answer to each move they are likely to play.
          </p>
          <p>
            <strong>Completion</strong> is the share of your games where your repertoire still has an answer. It follows every
            opponent reply that players at your rating actually play, until a line becomes rarer than your coverage goal (set in
            Settings). Your <strong>biggest gap</strong> is the position you'll reach most often without a prepared move.
          </p>
        </div>
      </Section>
      <Section title="Learn">
        <div className="prose">
          <p>
            Practice walks through your lines from the start. Your opponent's moves are played for you; you play yours. New moves
            are shown with an arrow first, then asked again from memory at the end of the session.
          </p>
          <p>
            Every one of your moves has its own review schedule (the FSRS spaced-repetition algorithm). Moves you know well come
            back after longer and longer gaps; a move you miss comes back soon. A move counts as mastered when you're expected to
            remember it for three weeks.
          </p>
        </div>
      </Section>
      <Section title="Where the numbers come from">
        <div className="prose">
          <ul>
            <li>
              <strong>Your level</strong>: {data ? compact(data.data.lichess.games) : "…"} rated blitz, rapid and classical games
              from the Lichess open database (September 2026), split by rating. Covers{" "}
              {data ? compact(data.data.lichess.positions) : "…"} opening positions.
            </li>
            <li>
              <strong>Masters</strong>: {data ? compact(data.data.masters.games) : "…"} games by 250 strong players from the PGN
              Mentor archives, covering {data ? compact(data.data.masters.positions) : "…"} positions.
            </li>
            <li>
              <strong>Eval</strong>: Stockfish 19, running on this computer.
            </li>
            <li>
              <strong>Model games</strong>: {data ? compact(data.modelGames) : "…"} complete games between strong players, matched to
              your repertoire.
            </li>
            <li>
              <strong>Puzzles</strong>: {data ? compact(data.puzzles) : "…"} puzzles from the Lichess puzzle database, tagged by
              opening.
            </li>
            <li>
              <strong>Opening names</strong>: {data ? compact(data.openings) : "…"} named lines from the Lichess chess-openings
              project.
            </li>
          </ul>
          <p>
            Everything runs locally and is stored in one file on this computer. There is no account and nothing is uploaded.
          </p>
        </div>
      </Section>
    </>
  );
}
