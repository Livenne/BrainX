import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { AuthPage } from './pages/AuthPage';
import { ChatPage } from './pages/ChatPage';
import { ChatPreviewPage } from './pages/ChatPreviewPage';
import { DashboardPage } from './pages/DashboardPage';
import { DaemonsPage } from './pages/DaemonsPage';
import { AgentsPage } from './pages/AgentsPage';
import { RunDetailPage } from './pages/RunDetailPage';
import { SettingsPage } from './pages/SettingsPage';
import { SkillReviewPage } from './pages/SkillReviewPage';
import { BrainxI18nProvider } from './i18n/I18nProvider';
import './i18n/i18n';
import { SidebarProvider } from './state/sidebar';
import { AuthProvider, useAuth } from './state/auth';
import { ThemeProvider } from './state/theme';

export function AppRoutes() {
  return (
    <AuthProvider>
      <AuthenticatedRoutes />
    </AuthProvider>
  );
}

function AuthenticatedRoutes() {
  const { token } = useAuth();
  if (!token) {
    return <AuthPage />;
  }

  return (
    <SidebarProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/chat" element={<Navigate to="/workspaces/w_core/chat" replace />} />
          <Route path="/workspaces/:workspaceId" element={<DashboardPage />} />
          <Route path="/workspaces/:workspaceId/chat" element={<ChatPage />} />
          <Route path="/workspaces/:workspaceId/chat-preview" element={<ChatPreviewPage />} />
          <Route path="/workspaces/:workspaceId/branches" element={<WorkspaceDashboardRedirect />} />
          <Route path="/workspaces/:workspaceId/skills" element={<SkillReviewPage />} />
          <Route path="/workspaces/:workspaceId/skill-drafts/:draftId/review" element={<SkillReviewPage />} />
          <Route path="/workspaces/:workspaceId/client-daemons" element={<DaemonsPage />} />
          <Route path="/workspaces/:workspaceId/agents/:agentId/runs/:runId" element={<RunDetailPage />} />
          <Route path="/workspaces/:workspaceId/agents" element={<AgentsPage />} />
          <Route path="/workspaces/:workspaceId/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </SidebarProvider>
  );
}

function WorkspaceDashboardRedirect() {
  const { workspaceId = 'w_core' } = useParams();
  return <Navigate to={`/workspaces/${workspaceId}`} replace />;
}

export function App() {
  return (
    <BrainxI18nProvider>
      <ThemeProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </ThemeProvider>
    </BrainxI18nProvider>
  );
}
