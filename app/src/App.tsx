import { useEffect } from "react";
import {
  BrowserRouter as Router,
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { ProfileProvider, useProfile } from "./profile";
import { ToastProvider } from "./components/Toast";
import { OfflineBanner } from "./components/OfflineBanner";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Splash } from "./components/ui";
import { Dashboard } from "./pages/Dashboard";
import { RepertoirePage } from "./pages/RepertoirePage";
import { BuildPage } from "./pages/BuildPage";
import { GapPage } from "./pages/GapPage";
import { LearnPage } from "./pages/LearnPage";
import { PracticePage } from "./pages/PracticePage";
import { SettingsPage } from "./pages/SettingsPage";
import { AddPage } from "./pages/AddPage";
import { ModelPage } from "./pages/ModelPage";
import { LandingPage } from "./pages/LandingPage";
import { LegalPage } from "./pages/LegalPage";
import { TrainingGamesPage } from "./pages/TrainingGamesPage";
import { BlunderPuzzlesPage } from "./pages/BlunderPuzzlesPage";
import { IntuitionBuilderPage } from "./pages/IntuitionBuilderPage";
import { VisualizationPage } from "./pages/VisualizationPage";
import { VisionPage } from "./pages/VisionPage";
import { OpeningsPage } from "./pages/OpeningsPage";
import { OpeningGuidePage } from "./pages/OpeningGuidePage";
import { CoachesPage } from "./pages/CoachesPage";
import { CoachPage } from "./pages/CoachPage";
import { CoachApplyPage } from "./pages/CoachApplyPage";
import { CoachReviewPage } from "./pages/CoachReviewPage";
import { BlogPage } from "./pages/BlogPage";
import { BlogPostPage } from "./pages/BlogPostPage";
import { RepertoiresPage } from "./pages/RepertoiresPage";
import { WelcomePage } from "./pages/WelcomePage";
import { HelpPage } from "./pages/HelpPage";
import { HistoryPage } from "./pages/HistoryPage";

const PLAY_STORE = "https://play.google.com/store/apps/details?id=com.chessbook.android";
const APP_STORE = "https://apps.apple.com/us/app/chessbook/id6466343415";

/**
 * Keep the browser's restoration behaviour useful with client-side routing:
 * hash links (used by the deep help anchors) scroll to their section once the
 * target has rendered; plain navigations start at the top.
 */
function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      const id = decodeURIComponent(hash.slice(1));
      const frame = window.requestAnimationFrame(() => {
        document.getElementById(id)?.scrollIntoView({ block: "start" });
      });
      return () => window.cancelAnimationFrame(frame);
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

function LocalProfile() {
  const { user, loading } = useProfile();
  if (loading) return <Splash />;
  if (!user) {
    return (
      <div className="cb-splash">
        <p>Your local profile could not be opened.</p>
        <button type="button" className="cb-btn" onClick={() => location.reload()}>
          Try again
        </button>
      </div>
    );
  }
  return <Outlet />;
}

function HomeRoute() {
  const { loading } = useProfile();
  if (loading) return <Splash />;
  let entered = false;
  try {
    entered = localStorage.getItem("cb_entered") === "1";
  } catch {
    // A blocked storage API still lets the trainer run for this visit.
  }
  if (!entered) return <LandingPage />;
  return <Dashboard />;
}

/**
 * Production `/qr` is a redirect to the Play Store listing (audit D133).
 *
 * The local build keeps the same route but renders a small honest landing page
 * with the real listing links instead of navigating off-site automatically:
 * the app must remain usable offline, and an automatic third-party redirect
 * would break the local-first promise (and the mobile back stack).
 */
function QrRoute() {
  useEffect(() => {
    document.title = "Chessbook on your phone · Chessbook";
    return () => {
      document.title = "Chessbook";
    };
  }, []);
  return (
    <div className="cb-splash" style={{ maxWidth: 460, margin: "0 auto", textAlign: "center" }}>
      <h1 style={{ fontSize: 24, lineHeight: "32px", margin: "0 0 8px" }}>
        Chessbook on your phone
      </h1>
      <p style={{ margin: "0 0 20px", color: "var(--cb-text-2)", fontSize: 13 }}>
        This route mirrors the production QR destination. The public mobile apps are published by
        Chessbook; this local build runs in your browser.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <a className="cb-btn primary" href={PLAY_STORE} target="_blank" rel="noreferrer">
          Open the Google Play listing
        </a>
        <a className="cb-btn" href={APP_STORE} target="_blank" rel="noreferrer">
          Open the App Store listing
        </a>
        <Link className="cb-btn ghost" to="/">
          Back to Chessbook
        </Link>
      </div>
    </div>
  );
}

/**
 * A render error in one screen must not blank the whole app (audit D210).
 * The boundary is keyed by pathname, so navigating away (including the
 * fallback's dashboard link) clears the error automatically.
 */
function RoutedPages() {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary key={pathname}>
      <Routes>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/legal/:kind" element={<LegalPage />} />
        <Route path="/legal" element={<Navigate to="/legal/privacy" replace />} />
        <Route path="/qr" element={<QrRoute />} />

        <Route element={<LocalProfile />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/repertoire/:key" element={<RepertoirePage />} />
          <Route path="/build/:key" element={<BuildPage />} />
          <Route path="/gap/:key" element={<GapPage />} />
          <Route path="/learn/:key" element={<LearnPage />} />
          <Route path="/practice/:key" element={<PracticePage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/history/:key" element={<HistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/add" element={<AddPage />} />
          <Route path="/model" element={<ModelPage />} />
          <Route path="/model/:id" element={<ModelPage />} />

          <Route path="/training-games" element={<TrainingGamesPage />} />
          <Route path="/blunder-puzzles" element={<BlunderPuzzlesPage />} />
          <Route path="/intuition-builder" element={<IntuitionBuilderPage />} />
          <Route path="/visualization" element={<VisualizationPage />} />
          <Route path="/vision" element={<VisionPage />} />

          <Route path="/openings" element={<OpeningsPage />} />
          <Route path="/openings/:slug" element={<OpeningGuidePage />} />
          <Route path="/coaches" element={<CoachesPage />} />
          <Route path="/coaches/apply" element={<CoachApplyPage />} />
          <Route path="/coaches/review" element={<CoachReviewPage />} />
          <Route path="/coaches/:slug" element={<CoachPage />} />
          <Route path="/blog" element={<BlogPage />} />
          <Route path="/blog/:slug" element={<BlogPostPage />} />
          <Route path="/repertoires" element={<RepertoiresPage />} />
          {/* One dynamic pattern serves both production slugs (/repertoires/white-openings)
              and local keys (/repertoires/1, /repertoires/black); RepertoiresPage resolves
              either shape and redirects to /repertoire/:id. Registering a second
              /repertoires/:key route would make the matched param ambiguous. */}
          <Route path="/repertoires/:slug" element={<RepertoiresPage />} />
          <Route path="/welcome" element={<WelcomePage />} />
          <Route path="/help" element={<HelpPage />} />
        </Route>

        {/* Production redirects unknown routes home instead of rendering a 404
            card (audit D170). Keep that behaviour. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <Router>
      <ProfileProvider>
        <ToastProvider>
          <ScrollToTop />
          <OfflineBanner />
          <RoutedPages />
        </ToastProvider>
      </ProfileProvider>
    </Router>
  );
}
