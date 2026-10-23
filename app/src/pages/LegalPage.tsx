import { Link, useParams } from "react-router-dom";
import { Logo } from "../components/ui";

type Kind = "privacy" | "fulfillment" | "terms";

const content: Record<Kind, { title: string; updated: string; body: React.ReactNode }> = {
  privacy: {
    title: "Privacy Policy",
    updated: "Last updated: September 28, 2023",
    body: (
      <>
        <p>
          This Privacy Policy describes how Chessbook collects, uses, and protects the information
          you provide when you use our service. By using Chessbook, you agree to the practices
          described here.
        </p>
        <h2>Interpretation and definitions</h2>
        <p>
          <strong>Account</strong> means the unique account created for you to access our service.
          <br />
          <strong>Personal Data</strong> means information that relates to an identified or
          identifiable individual.
          <br />
          <strong>Service</strong> means the Chessbook website and applications.
        </p>
        <h2>Information we collect</h2>
        <ul>
          <li>Local profile: the display name you choose in Settings.</li>
          <li>Training data: repertoires, lines, attempts, and mastery progress.</li>
          <li>Connected accounts: your public username on Lichess or Chess.com, if you connect one.</li>
        </ul>
        <h2>How we use your information</h2>
        <p>
          Everything is used locally to save your repertoire and progress, schedule practice, and
          restore your display preferences. There is no account sync and no personal data is sent
          to a Chessbook server.
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
          Questions about this policy? Email <a href="mailto:marcus@chessbook.com">marcus@chessbook.com</a>.
        </p>
      </>
    ),
  },
  fulfillment: {
    title: "Fulfillment Policy",
    updated: "Last updated: September 28, 2023",
    body: (
      <>
        <h2>Refunds</h2>
        <h3>Refund eligibility</h3>
        <ul>
          <li>
            Refunds are available within the first 14 days of your initial subscription purchase if
            you are not satisfied with the product.
          </li>
          <li>
            Refunds are not available for subsequent subscription renewals or partial periods of
            use unless there is a verified technical issue that prevents access or use.
          </li>
        </ul>
        <h3>How to request a refund</h3>
        <p>
          Contact <a href="mailto:support@chessbook.com">support@chessbook.com</a> with your account
          details and the reason for your request. Approved refunds are processed within 5–7
          business days.
        </p>
        <h3>Non-refundable circumstances</h3>
        <ul>
          <li>Refunds cannot be granted for failure to use the subscription.</li>
          <li>
            Refunds are not available for promotional or discounted subscriptions, except in cases
            of technical issues.
          </li>
        </ul>
        <h2>Cancellations</h2>
        <p>
          You may cancel your subscription at any time from Settings. Once cancelled, your
          subscription remains active until the end of the current billing period, after which it
          will not renew. No further charges are applied after cancellation.
        </p>
        <h3>Trial period cancellations</h3>
        <p>
          If you are on a trial period, you may cancel at any time before the trial ends to avoid
          being charged. Contact support if you need help cancelling.
        </p>
        <h2>Contact</h2>
        <p className="contact">
          Email <a href="mailto:support@chessbook.com">support@chessbook.com</a> for billing or
          fulfillment questions.
        </p>
      </>
    ),
  },
  terms: {
    title: "Terms of Service",
    updated: "Last updated: September 28, 2023",
    body: (
      <>
        <p>
          These Terms govern your use of Chessbook. By using the local app, you agree to these
          Terms.
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
        <h2>Subscriptions</h2>
        <p>
          Paid plans renew automatically until cancelled. Prices and features may change with
          notice. Refund and cancellation terms are described in the Fulfillment Policy.
        </p>
        <h2>Content and intellectual property</h2>
        <p>
          Chessbook and its licensors own the service, branding, and original content. Opening data
          is derived from the open-source Lichess chess-openings dataset. You retain ownership of
          the PGNs you import.
        </p>
        <h2>Disclaimer</h2>
        <p>
          The service is provided “as is” without warranties of any kind. Chessbook is a study tool;
          it does not guarantee rating improvement or tournament results.
        </p>
        <h2>Contact</h2>
        <p className="contact">
          Questions? Email <a href="mailto:marcus@chessbook.com">marcus@chessbook.com</a>.
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
