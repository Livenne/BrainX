import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '../App';
import { i18n } from '../i18n/i18n';
import { resetMockApiState } from '../services/mockApi';
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
    resetMockApiState();
    await i18n.changeLanguage('en-US');
  });

  it('renders dashboard metrics', async () => {
    renderAt('/workspaces/w_core');

    expect(await screen.findByText('Active runs')).toBeInTheDocument();
    expect((await screen.findAllByText('Bound devices')).length).toBeGreaterThan(0);
    expect(await screen.findByText('Agent work status')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Open$/ })).toHaveClass('agent-work-open-button');
    expect(document.querySelector('.agent-work-context-donut')).not.toBeNull();
    expect(screen.getByRole('img', { name: 'Token usage by model' })).toBeInTheDocument();
    expect(screen.getByText('Tokens')).toBeInTheDocument();
    expect(screen.getByText('Cumulative token usage')).toBeInTheDocument();
    expect(screen.queryByText('example-chat')).not.toBeInTheDocument();
    expect(document.querySelector('.agent-work-status-grid')).not.toBeNull();
    expect(document.querySelector('.dashboard-device-section')).not.toBeNull();
    expect(document.querySelector('.dashboard-device-grid')).toHaveClass('dashboard-device-list');
    expect(screen.queryByText('/home/Livenne/code/brainx')).not.toBeInTheDocument();
    expect(screen.queryByText(/Latest event/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Agent run timeline/i)).not.toBeInTheDocument();
    expect(document.querySelector('.agent-work-status-card .status-badge')).toBeNull();
  });

  it('redirects the removed approvals route to the dashboard', async () => {
    renderAt('/workspaces/w_core/approvals');

    expect(await screen.findByRole('heading', { name: /^dashboard$/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Approvals' })).not.toBeInTheDocument();
  });

  it('redirects the removed branches page to dashboard', async () => {
    renderAt('/workspaces/w_core/branches');

    expect(await screen.findByRole('heading', { name: /^dashboard$/i })).toBeInTheDocument();
    expect(screen.queryByText('motion-v2')).not.toBeInTheDocument();
  });

  it('shows an error when a run cannot be loaded', async () => {
    renderAt('/workspaces/w_core/agents/agent_frontend/runs/missing_run');

    expect(await screen.findByText(/Run missing_run was not found/i)).toBeInTheDocument();
  });

  it('keeps legacy skill draft review routes on the skills console', async () => {
    renderAt('/workspaces/w_core/skill-drafts/unknown/review');

    expect(await screen.findByRole('heading', { name: 'Skill Review' })).toBeInTheDocument();
    expect(await screen.findByText('Pending proposals')).toBeInTheDocument();
    expect(screen.queryByText('browser-motion-review')).not.toBeInTheDocument();
  });

  it('shows global skills by device, pending work paths, and approval results', async () => {
    const user = userEvent.setup();
    renderAt('/workspaces/w_core/skills');

    const proposalPanel = await screen.findByRole('region', { name: 'Skill proposals' });
    const globalPanel = await screen.findByRole('region', { name: 'Global skills' });
    const resultsPanel = await screen.findByRole('region', { name: 'Approval results' });
    expect(screen.queryByRole('heading', { name: 'Current workspace' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Project skills' })).not.toBeInTheDocument();
    expect(within(globalPanel).getByText('Livenne Workstation')).toBeInTheDocument();
    expect(within(globalPanel).getByText('write-plan')).toBeInTheDocument();
    expect(within(proposalPanel).getByText('review-agent-output')).toBeInTheDocument();
    expect(within(proposalPanel).getByText('/home/Livenne/code/brainx')).toBeInTheDocument();
    expect(within(resultsPanel).queryByText('review-agent-output')).not.toBeInTheDocument();

    await user.click(within(proposalPanel).getAllByRole('button', { name: 'Approve' })[0]);

    await waitFor(() => {
      expect(within(proposalPanel).queryByText('review-agent-output')).not.toBeInTheDocument();
    });
    expect(await within(resultsPanel).findByText('review-agent-output')).toBeInTheDocument();
    expect(within(resultsPanel).getByLabelText('Skill review approved')).toBeInTheDocument();
    expect(resultsPanel).not.toHaveTextContent(/\bapproved\b|\brejected\b|\breview_requested\b/);
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
