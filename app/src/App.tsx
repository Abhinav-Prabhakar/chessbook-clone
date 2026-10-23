import { useEffect } from "react";
import {
  BrowserRouter as Router,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
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
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { LegalPage } from "./pages/LegalPage";
import { Link } from "react-router-dom";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Splash />;
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <Outlet />;
}

function HomeRoute() {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;
  if (!user) return <LandingPage />;
  return <Dashboard />;
}

function NotFound() {
  return (
    <div className="cb-auth-page">
      <div className="cb-auth-card">
        <h1>Page not found</h1>
        <p className="cb-auth-sub">That page has wandered off the board.</p>
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
      <AuthProvider>
        <ToastProvider>
          <ScrollToTop />
          <Routes>
            <Route path="/" element={<HomeRoute />} />
            <Route path="/welcome" element={<Navigate to="/" replace />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/legal/:kind" element={<LegalPage />} />
            <Route path="/legal" element={<Navigate to="/legal/privacy" replace />} />

            <Route element={<RequireAuth />}>
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
              <Route path="/openings" element={<Navigate to="/add" replace />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </Router>
  );
}
