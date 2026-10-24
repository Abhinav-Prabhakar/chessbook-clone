import { Component } from "react";
import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { SettingsProvider } from "./settings";
import { StageProvider } from "./board/stage";
import { AppShell } from "./shell/AppShell";
import { ToastProvider } from "./ui";
import { Dashboard } from "./pages/Dashboard";
import { RepertoirePage } from "./pages/RepertoirePage";
import { BuildPage } from "./pages/BuildPage";
import { LearnPage } from "./pages/LearnPage";
import { PracticePage } from "./pages/PracticePage";
import { SettingsPage } from "./pages/SettingsPage";
import { NewRepertoirePage } from "./pages/NewRepertoirePage";
import { ModelGamesPage, ModelGamePage } from "./pages/ModelGamesPage";
import { PuzzlesPage } from "./pages/PuzzlesPage";
import { TrainingGamesPage } from "./pages/TrainingGamesPage";
import { OpeningsPage, OpeningGuidePage } from "./pages/OpeningsPage";
import { HistoryPage } from "./pages/HistoryPage";
import { AboutPage } from "./pages/AboutPage";
import { LandingPage } from "./pages/LandingPage";
import { LegalPage } from "./pages/LegalPage";
import { VisualizationPage } from "./pages/VisualizationPage";

function entered() {
  try {
    return localStorage.getItem("cb_entered") === "1";
  } catch {
    return true;
  }
}

function Home() {
  if (!entered()) return <Navigate to="/welcome" replace />;
  return <Dashboard />;
}

class PageBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error) {
      return (
        <div className="error-note">
          <span>This screen hit a problem: {this.state.error.message}</span>
          <button type="button" className="link-button" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function Guarded({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <PageBoundary resetKey={pathname}>{children}</PageBoundary>;
}

/** Old URLs from the previous version keep working. */
function Legacy({ to }: { to: (params: Record<string, string | undefined>) => string }) {
  const params = useParams();
  const { search } = useLocation();
  return <Navigate to={`${to(params)}${search}`} replace />;
}

export default function App() {
  const g = (node: ReactNode) => <Guarded>{node}</Guarded>;
  return (
    <BrowserRouter>
      <SettingsProvider>
        <ToastProvider>
          <StageProvider>
            <Routes>
              <Route path="/welcome" element={<LandingPage />} />
              <Route path="/legal/:kind" element={<LegalPage />} />
              <Route element={<AppShell />}>
                <Route index element={g(<Home />)} />
                <Route path="dashboard" element={<Navigate to="/" replace />} />
                <Route path="repertoires" element={<Navigate to="/" replace />} />
                <Route path="repertoires/new" element={g(<NewRepertoirePage />)} />
                <Route path="repertoires/:id" element={g(<RepertoirePage />)} />
                <Route path="repertoires/:id/build" element={g(<BuildPage />)} />
                <Route path="repertoires/:id/learn" element={g(<LearnPage />)} />
                <Route path="repertoires/:id/practice" element={g(<PracticePage />)} />
                <Route path="settings" element={g(<SettingsPage />)} />
                <Route path="model-games" element={g(<ModelGamesPage />)} />
                <Route path="model-games/:gameId" element={g(<ModelGamePage />)} />
                <Route path="puzzles" element={g(<PuzzlesPage />)} />
                <Route path="training-games" element={g(<TrainingGamesPage />)} />
                <Route path="training-games/:gameId" element={g(<TrainingGamesPage />)} />
                <Route path="visualization" element={g(<VisualizationPage />)} />
                <Route path="openings" element={g(<OpeningsPage />)} />
                <Route path="openings/:slug" element={g(<OpeningGuidePage />)} />
                <Route path="history" element={g(<HistoryPage />)} />
                <Route path="about" element={g(<AboutPage />)} />
                <Route path="help" element={<Navigate to="/about" replace />} />

                <Route path="repertoire/:id" element={<Legacy to={(p) => `/repertoires/${p.id}`} />} />
                <Route path="build/:id" element={<Legacy to={(p) => `/repertoires/${p.id}/build`} />} />
                <Route path="gap/:id" element={<Legacy to={(p) => `/repertoires/${p.id}`} />} />
                <Route path="learn/:id" element={<Legacy to={(p) => `/repertoires/${p.id}/learn`} />} />
                <Route path="practice/:id" element={<Legacy to={(p) => `/repertoires/${p.id}/practice`} />} />
                <Route path="model" element={<Navigate to="/model-games" replace />} />
                <Route path="blunder-puzzles" element={<Navigate to="/puzzles" replace />} />
                <Route path="add" element={<Navigate to="/repertoires/new" replace />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </StageProvider>
        </ToastProvider>
      </SettingsProvider>
    </BrowserRouter>
  );
}
