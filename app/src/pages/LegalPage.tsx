import { Link, useParams } from "react-router-dom";

const PAGES: Record<string, { title: string; body: React.ReactNode }> = {
  privacy: {
    title: "Privacy",
    body: (
      <>
        <p>This app runs entirely on your computer. There is no account, no sign-in and no analytics.</p>
        <h2>What is stored</h2>
        <ul>
          <li>Your repertoires, notes and practice history, in one SQLite file next to the app (server/data/chessbook.db).</li>
          <li>Display preferences, mirrored in your browser's local storage so the board looks right while the app loads.</li>
        </ul>
        <h2>What is sent anywhere</h2>
        <p>
          Nothing. The opening statistics, master games, puzzles and the Stockfish engine are bundled with the app. The only
          outside links are ones you click yourself, such as “Analyze” (opens Lichess).
        </p>
        <h2>Deleting your data</h2>
        <p>Delete the database file, or use Settings → Reset practice progress to keep your repertoires but forget your reviews.</p>
      </>
    ),
  },
  terms: {
    title: "Terms",
    body: (
      <>
        <p>
          This is a personal, local recreation of Chessbook for study. It is not affiliated with Chessbook. There are no
          purchases, subscriptions or plan limits.
        </p>
        <h2>Data licences</h2>
        <ul>
          <li>Lichess game and puzzle databases: Creative Commons CC0.</li>
          <li>Lichess chess-openings names: CC0.</li>
          <li>Master games: PGN Mentor archives, for personal study.</li>
          <li>Stockfish: GPLv3.</li>
          <li>Piece sets: see pieces/README.md for each set's licence.</li>
        </ul>
      </>
    ),
  },
};

export function LegalPage() {
  const { kind = "privacy" } = useParams();
  const page = PAGES[kind] ?? PAGES.privacy;
  return (
    <div className="legal">
      <Link to="/" className="legal-home">
        <img src="/chessbook-mark.svg" alt="" /> Chessbook
      </Link>
      <h1>{page.title}</h1>
      <div className="prose">{page.body}</div>
      <p className="legal-links">
        <Link to="/legal/privacy">Privacy</Link> · <Link to="/legal/terms">Terms</Link> · <Link to="/">Back to the app</Link>
      </p>
    </div>
  );
}
