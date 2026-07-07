import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from '../App';
import { resetMockApiState } from '../services/mockApi';
import { ThemeProvider } from '../state/theme';

function renderAt(path: string) {
  window.localStorage.removeItem('brainx.locale');
  resetMockApiState();
  render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </ThemeProvider>
  );
}

describe('v0.2 page content depth', () => {
  it('renders a real agents page instead of a placeholder', async () => {
    renderAt('/workspaces/w_core/agents');

    expect(await screen.findByRole('heading', { name: 'Agents' })).toBeInTheDocument();
    expect(await screen.findByText('frontend-main')).toBeInTheDocument();
    expect(screen.getAllByText('运行中任务').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Agent list and run launch controls/i)).not.toBeInTheDocument();
  });

  it('renders a settings page with language and sidebar preferences', async () => {
    renderAt('/workspaces/w_core/settings');

    expect(await screen.findByRole('heading', { name: '设置' })).toBeInTheDocument();
    expect(screen.getAllByText('语言').length).toBeGreaterThan(0);
    expect(screen.getAllByText('侧边栏').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Workspace interface preferences/i)).not.toBeInTheDocument();
  });

  it('shows richer skill review evidence and diff sections', async () => {
    renderAt('/workspaces/w_core/skill-drafts/sd_motion/review');

    expect(await screen.findByRole('heading', { name: 'Skill Review' })).toBeInTheDocument();
    expect(await screen.findByText('证据')).toBeInTheDocument();
    expect(await screen.findByText('版本 Diff')).toBeInTheDocument();
  });
});
