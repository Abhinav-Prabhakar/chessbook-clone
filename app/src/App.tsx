import { useEffect } from "react";
import {
  BrowserRouter as Router,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { ProfileProvider, useProfile } from "./profile";
import { ToastProvider } from "./components/Toast";
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
import { Link } from "react-router-dom";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
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

function NotFound() {
  return (
    <div className="cb-notfound-page">
      <div className="cb-notfound-card">
        <h1>Page not found</h1>
        <p className="cb-notfound-sub">That page has wandered off the board.</p>
        <Link to="/" className="cb-btn primary wide">
          Back to Chessbook
        </Link>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <ProfileProvider>
        <ToastProvider>
          <ScrollToTop />
          <Routes>
            <Route path="/" element={<HomeRoute />} />
            <Route path="/legal/:kind" element={<LegalPage />} />
            <Route path="/legal" element={<Navigate to="/legal/privacy" replace />} />

            <Route element={<LocalProfile />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/repertoire/:key" element={<RepertoirePage />} />
              <Route path="/build/:key" element={<BuildPage />} />
              <Route path="/gap/:key" element={<GapPage />} />
              <Route path="/learn/:key" element={<LearnPage />} />
              <Route path="/practice/:key" element={<PracticePage />} />
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

            <Route path="*" element={<NotFound />} />
          </Routes>
        </ToastProvider>
      </ProfileProvider>
    </Router>
  );
}
