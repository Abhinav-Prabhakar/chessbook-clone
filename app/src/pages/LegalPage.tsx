import { Link, useParams } from "react-router-dom";
import { Logo } from "../components/ui";

type Kind = "privacy" | "fulfillment" | "terms";

const content: Record<Kind, { title: string; updated: string; body: React.ReactNode }> = {
  privacy: {
    title: "Privacy Policy",
    updated: "Local build policy · October 2026",
    body: (
      <>
        <p>
          This Privacy Policy describes what this local-first Chessbook build stores and what it
          never sends anywhere. The hosted Chessbook service has its own policy; this page covers
          the clone in this repository.
        </p>
        <h2>Interpretation and definitions</h2>
        <p>
          <strong>Account</strong> means a remote login. This build does not create one.
          <br />
          <strong>Local profile</strong> means the single profile stored in the SQLite database on
          this machine.
          <br />
          <strong>Personal Data</strong> means information that relates to an identified or
          identifiable individual. No personal data leaves this device.
        </p>
        <h2>Information we store locally</h2>
        <ul>
          <li>Local profile: the display name stored in Settings.</li>
          <li>Training data: repertoires, lines, attempts, reviews, and mastery progress.</li>
          <li>Imported files: PGNs you paste or upload, kept only in the local database.</li>
          <li>Browser preferences: board theme, sound, and similar display choices.</li>
        </ul>
        <h2>How the information is used</h2>
        <p>
          Everything is used locally to save your repertoire and progress, schedule practice, and
          restore your display preferences. There is no account sync, no telemetry and no personal
          data sent to a Chessbook server.
        </p>
        <h2>Local storage and cookies</h2>
        <p>
          Your repertoire lives in a SQLite database on the machine running the app. Board theme,
          sound, and similar preferences are also stored in your browser. You can clear them at any
          time from Settings or your browser settings.
        </p>
        <h2>Security</h2>
        <p>
          The app does not create passwords or sessions. Access to the local database is controlled
          by your operating system account and file permissions.
        </p>
        <h2>Your rights</h2>
        <p>
          You can edit your display name, reset training progress, or delete the local database at
          any time. Uninstalling the app or removing its data folder deletes the stored profile.
        </p>
        <h2>Contact</h2>
        <p className="contact">
          Questions about this policy? Open an issue on the{" "}
          <a href="https://github.com/Abhinav-Prabhakar/chessbook-clone/issues/new">
            project issue tracker
          </a>
          .
        </p>
      </>
    ),
  },
  fulfillment: {
    title: "Fulfillment Policy",
    updated: "Local build policy · October 2026",
    body: (
      <>
        <h2>No purchases or subscriptions</h2>
        <p>
          This build is free and local. It has no checkout, subscription, billing, trial, plan
          limit, paywall or in-app purchase, so there is nothing to fulfill, refund or cancel. The
          only hosted link on the site is to Chessbook's public mobile-app listings, which are
          operated by Chessbook under their own terms.
        </p>
        <h2>Running and updating</h2>
        <p>
          Install and run the app from this repository with <code>npm install</code>,{" "}
          <code>npm run dev</code> or <code>npm run build &amp;&amp; npm start</code>. Updates are
          whatever revision of the repository you choose to run.
        </p>
        <h2>Data removal</h2>
        <p>
          Delete <code>server/data/chessbook.db</code> or run <code>npm run db:reset</code> to
          recreate the local profile and seed repertoires. Browser preferences can be cleared from
          Settings or the browser's site-data controls.
        </p>
        <h2>Contact</h2>
        <p className="contact">
          For problems or questions, open an issue on the{" "}
          <a href="https://github.com/Abhinav-Prabhakar/chessbook-clone/issues/new">
            project issue tracker
          </a>
          .
        </p>
      </>
    ),
  },
  terms: {
    title: "Terms of Service",
    updated: "Local build policy · October 2026",
    body: (
      <>
        <p>
          These Terms govern your use of this local recreation of Chessbook. By using the local app,
          you agree to these Terms. This project is not affiliated with or endorsed by Chessbook.
        </p>
        <h2>Your local profile</h2>
        <p>
          The app stores a single local profile on your device. You are responsible for access to
          that device and for keeping your own backups of the local database.
        </p>
        <h2>Acceptable use</h2>
        <ul>
          <li>Do not abuse, disrupt, or attempt to gain unauthorized access to the service.</li>
          <li>Do not scrape or redistribute the opening database in violation of its license.</li>
          <li>Do not use the service to infringe the rights of others.</li>
        </ul>
        <h2>No accounts or subscriptions</h2>
        <p>
          This build has no login, paid plans, automatic renewals, billing or entitlement gates.
          Features that require a subscription on the hosted product are either available here for
          free or explicitly marked unavailable. There is nothing to cancel.
        </p>
        <h2>Content and intellectual property</h2>
        <p>
          Chessbook and its licensors own the hosted service, branding, and original content.
          Opening data is derived from the open-source Lichess chess-openings dataset. You retain
          ownership of the PGNs you import. The captured production assets in this repository are
          kept as design references for a study/portfolio recreation.
        </p>
        <h2>Disclaimer</h2>
        <p>
          The service is provided “as is” without warranties of any kind. Chessbook is a study tool;
          it does not guarantee rating improvement or tournament results, and its local engine is
          not Stockfish.
        </p>
        <h2>Contact</h2>
        <p className="contact">
          Questions? Open an issue on the{" "}
          <a href="https://github.com/Abhinav-Prabhakar/chessbook-clone/issues/new">
            project issue tracker
          </a>
          .
        </p>
      </>
    ),
  },
};

export function LegalPage() {
  const { kind = "privacy" } = useParams<{ kind?: Kind }>();
  const page = content[(kind as Kind) in content ? (kind as Kind) : "privacy"];

  return (
    <div className="cb-legal-page">
      <nav className="cb-legal-nav">
        <Logo />
        <Link to="/" className="cb-link">
          ← Back to Chessbook
        </Link>
      </nav>
      <article className="cb-legal">
        <h1>{page.title}</h1>
        <p className="updated">{page.updated}</p>
        {page.body}
        <hr style={{ border: 0, borderTop: "1px solid var(--cb-border)", margin: "34px 0" }} />
        <p>
          <Link to="/legal/privacy">Privacy</Link> ·{" "}
          <Link to="/legal/fulfillment">Fulfillment</Link> ·{" "}
          <Link to="/legal/terms">Terms</Link>
        </p>
      </article>
    </div>
  );
}
