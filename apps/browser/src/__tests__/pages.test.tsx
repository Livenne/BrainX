import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '../App';
import { i18n } from '../i18n/i18n';
import { ThemeProvider } from '../state/theme';

function renderAt(path: string) {
  render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </ThemeProvider>
  );
}

describe('core pages', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US');
  });

  it('renders dashboard metrics', async () => {
    renderAt('/workspaces/w_core');

    expect(await screen.findByText('Active runs')).toBeInTheDocument();
    expect(await screen.findByText('Pending approvals')).toBeInTheDocument();
  });

  it('renders approvals queue', async () => {
    renderAt('/workspaces/w_core/approvals');

    expect(await screen.findByRole('heading', { name: /approvals/i })).toBeInTheDocument();
    expect(await screen.findByText('Publish skill version')).toBeInTheDocument();
  });

  it('renders branch adoption risk explicitly', async () => {
    renderAt('/workspaces/w_core/branches');

    expect(await screen.findByText('motion-v2')).toBeInTheDocument();
    expect(screen.getAllByText(/Selective adoption only/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/No memory merge/i).length).toBeGreaterThan(0);
  });

  it('shows an error when a run cannot be loaded', async () => {
    renderAt('/workspaces/w_core/agents/agent_frontend/runs/missing_run');

    expect(await screen.findByText(/Run missing_run was not found/i)).toBeInTheDocument();
  });

  it('does not render an unrelated skill draft for an unknown draft route', async () => {
    renderAt('/workspaces/w_core/skill-drafts/unknown/review');

    expect(await screen.findByText(/Skill draft unknown was not found/i)).toBeInTheDocument();
    expect(screen.queryByText('browser-motion-review')).not.toBeInTheDocument();
  });

  it('renders daemon page without secret details', async () => {
    renderAt('/workspaces/w_core/client-daemons');

    expect(await screen.findByText('Livenne Workstation')).toBeInTheDocument();
    expect(screen.queryByText(/api key/i)).not.toBeInTheDocument();
  });

  it('shows an error when a workspace cannot be loaded', async () => {
    renderAt('/workspaces/missing');

    expect(await screen.findByText(/Workspace missing was not found/i)).toBeInTheDocument();
  });
});
