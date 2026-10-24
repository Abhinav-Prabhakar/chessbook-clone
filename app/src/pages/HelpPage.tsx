import { Link } from "react-router-dom";
import { ContentLayout } from "./OpeningsPage";

const WIKI = "https://wiki.chessbook.com";
const WIKI_STATS = "https://wiki.chessbook.com/repertoire-statistics";
const ISSUES = "https://github.com/Abhinav-Prabhakar/chessbook-clone/issues/new";

const QUICK_LINKS: { title: string; detail: string; to: string }[] = [
  {
    title: "Set up your Chessbook",
    detail: "Rating, playing style, first move and filling the gaps.",
    to: "/welcome",
  },
  {
    title: "Your repertoires",
    detail: "Open, build, practise or create a repertoire.",
    to: "/repertoires",
  },
  {
    title: "Add moves and candidates",
    detail: "Pick moves from the captured candidate list or import PGN.",
    to: "/add?tab=add",
  },
  {
    title: "Opening guides",
    detail: "Real Chessbook guide lines, two moves at a time.",
    to: "/openings",
  },
  {
    title: "Coaches",
    detail: "Captured directory profiles and the local application queue.",
    to: "/coaches",
  },
  {
    title: "Settings",
    detail: "Board, review style, rating, coverage and notifications.",
    to: "/settings",
  },
];

/**
 * Deep-anchor targets for the play screens and the builder/practice rows
 * (audit D169). Each id is rendered on the link itself so `/help#training-games`
 * (and the shared PlayLayout) lands on the matching card, not the page top.
 */
const DRILL_LINKS: { id: string; title: string; detail: string; to: string }[] = [
  {
    id: "training-games",
    title: "Training games",
    detail: "Play the deterministic local bot from any studied position.",
    to: "/training-games",
  },
  {
    id: "blunder-puzzles",
    title: "Blunder puzzles",
    detail: "Find the best move in captured model-game eval swings.",
    to: "/blunder-puzzles",
  },
  {
    id: "intuition-builder",
    title: "Intuition builder",
    detail: "Choose moves from captured positions and see the real play rates.",
    to: "/intuition-builder",
  },
  {
    id: "visualization",
    title: "Visualization",
    detail: "Watch hidden moves, then reconstruct them or answer position questions.",
    to: "/visualization",
  },
  {
    id: "vision",
    title: "Vision",
    detail: "Spot hanging pieces, undefended pawns, checks and king-zone squares.",
    to: "/vision",
  },
  {
    id: "practice",
    title: "Practice",
    detail: "The move-by-move review loop, scheduling, hints, skips and resume.",
    to: "/learn/white",
  },
  {
    id: "builder",
    title: "Repertoire builder",
    detail: "Captured candidates, notes, autofill, branch remove/disable and PGN import.",
    to: "/build/white",
  },
];

const FAQ: { question: string; answer: React.ReactNode }[] = [
  {
    question: "Where is my data stored?",
    answer: (
      <>
        Your repertoires, lines and review history live in a SQLite database on this machine. Board
        and review preferences live in this browser. There is no account, cloud sync or telemetry.
        Clearing site data removes the browser preferences; the SQLite database is separate.
      </>
    ),
  },
  {
    question: "How does practice scheduling work?",
    answer: (
      <>
        Chessbook schedules each position/move with an FSRS-style review state, not one flat
        interval per line. <Link to="/repertoires">Open a repertoire</Link> and choose Practice to
        review what is due, or use the learn screen to review everything.
      </>
    ),
  },
  {
    question: "Why do some statistics say “unavailable”?",
    answer: (
      <>
        The local build only shows numbers that were captured from Chessbook or computed from your
        real review history. When a position report, course tree or eval was not part of the
        capture, the page says so rather than inventing a value. The repertoire statistics
        explanation is on the <a href={WIKI_STATS} target="_blank" rel="noreferrer">Chessbook wiki</a>.
      </>
    ),
  },
  {
    question: "Do I need an account or a subscription?",
    answer: (
      <>
        No. This build has no login, billing or premium gates. Features that are premium on the
        hosted product are available here without an account, subject only to the captured local
        data.
      </>
    ),
  },
  {
    question: "Can I import my own games or repertoire?",
    answer: (
      <>
        Yes. Open a repertoire and use <strong>Import PGN</strong> to paste or upload a .pgn file;
        multi-game files, transpositions and exports are supported. You can also create a new
        repertoire from <Link to="/add?tab=new">Add repertoire</Link>.
      </>
    ),
  },
  {
    question: "How do coach applications work here?",
    answer: (
      <>
        The coach directory is the captured public listing. Applications submitted through{" "}
        <Link to="/coaches/apply">Apply to be listed</Link> are stored in this browser and reviewed
        on the <Link to="/coaches/review">review screen</Link>; they never leave the device.
      </>
    ),
  },
];

function HelpLink({
  title,
  detail,
  to,
  id,
}: {
  title: string;
  detail: string;
  to: string;
  id?: string;
}) {
  return (
    <Link className="cb-cs-guide" to={to} id={id}>
      <span className="cb-cs-guide-main">
        <span className="cb-cs-guide-name">{title}</span>
        <span className="cb-cs-guide-moves">{detail}</span>
      </span>
      <i className="fa fa-angle-right cb-row-chevron" aria-hidden />
    </Link>
  );
}

export function HelpPage() {
  return (
    <ContentLayout crumbs={[{ label: "Help" }]} narrow>
      <h1 className="cb-cs-title" id="top">
        Help
      </h1>
      <p className="cb-cs-lede">
        Short answers and links for the local Chessbook trainer. Everything here resolves to a
        working local screen or the public Chessbook wiki — there are no placeholder routes.
      </p>

      <h2 className="cb-cs-section-title" id="start-here" style={{ marginTop: 8 }}>
        Start here
      </h2>
      <div className="cb-cs-grid">
        {QUICK_LINKS.map((entry) => (
          <HelpLink key={entry.to} {...entry} />
        ))}
      </div>

      <h2 className="cb-cs-section-title" id="drills">
        Play drills and training
      </h2>
      <div className="cb-cs-grid">
        {DRILL_LINKS.map((entry) => (
          <HelpLink key={entry.id} {...entry} />
        ))}
      </div>

      <h2 className="cb-cs-section-title" id="guides">
        Guides and reference
      </h2>
      <div className="cb-cs-grid">
        <a className="cb-cs-guide" href={WIKI} target="_blank" rel="noreferrer">
          <span className="cb-cs-guide-main">
            <span className="cb-cs-guide-name">Chessbook wiki</span>
            <span className="cb-cs-guide-moves">
              The public documentation site for the hosted Chessbook app.
            </span>
          </span>
          <i className="fa fa-up-right-from-square cb-row-chevron" aria-hidden />
        </a>
        <a className="cb-cs-guide" href={WIKI_STATS} target="_blank" rel="noreferrer">
          <span className="cb-cs-guide-main">
            <span className="cb-cs-guide-name">Repertoire statistics explained</span>
            <span className="cb-cs-guide-moves">
              What effectiveness, soundness, learnability and coverage mean.
            </span>
          </span>
          <i className="fa fa-up-right-from-square cb-row-chevron" aria-hidden />
        </a>
        <HelpLink
          title="Chessbook blog"
          detail="Captured posts on the engine, data and building Chessbook."
          to="/blog"
        />
        <Link className="cb-cs-guide" to="/qr" id="mobile-apps">
          <span className="cb-cs-guide-main">
            <span className="cb-cs-guide-name">Chessbook on Google Play</span>
            <span className="cb-cs-guide-moves">
              The public Android listing behind the production /qr route.
            </span>
          </span>
          <i className="fa fa-angle-right cb-row-chevron" aria-hidden />
        </Link>
        <Link className="cb-cs-guide" to="/legal/fulfillment">
          <span className="cb-cs-guide-main">
            <span className="cb-cs-guide-name">Fulfillment and privacy</span>
            <span className="cb-cs-guide-moves">
              The local policies for this build, plus contact details.
            </span>
          </span>
          <i className="fa fa-angle-right cb-row-chevron" aria-hidden />
        </Link>
      </div>

      <h2 className="cb-cs-section-title" id="faq">
        Frequently asked
      </h2>
      <div className="cb-cs-faq">
        {FAQ.map((entry) => (
          <details key={entry.question}>
            <summary>{entry.question}</summary>
            <p>{entry.answer}</p>
          </details>
        ))}
      </div>

      <div className="cb-cs-callout" id="still-stuck">
        <div>
          <h2>Still stuck?</h2>
          <p>
            Report a bug or ask a question on the project's issue tracker. Include the screen you
            were on and what you expected; the report never needs an account.
          </p>
        </div>
        <a className="cb-btn primary" href={ISSUES} target="_blank" rel="noreferrer">
          Open an issue
        </a>
      </div>

      <p className="cb-cs-note">
        <i className="fa fa-circle-info" aria-hidden />
        <span>
          This Help page is part of the local-first clone. The wiki links go to the real public
          Chessbook wiki; the in-app links stay inside this build.
        </span>
      </p>
    </ContentLayout>
  );
}
