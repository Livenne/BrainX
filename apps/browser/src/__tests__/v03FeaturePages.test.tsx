import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '../App';
import { i18n } from '../i18n/i18n';
import { resetMockApiState } from '../services/mockApi';
import { ThemeProvider } from '../state/theme';

function renderAt(path: string) {
  resetMockApiState();
  render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </ThemeProvider>
  );
}

describe('v0.3 feature page interactions', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US');
  });

  it('keeps Agents as a roadmap page without mock run controls', async () => {
    renderAt('/workspaces/w_core/agents');

    expect(await screen.findByRole('heading', { name: 'Agents' })).toBeInTheDocument();
    expect(await screen.findByText('Agent management is not open yet')).toBeInTheDocument();
    expect(screen.getByText('Branch workflows are paused')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start run' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fork branch' })).not.toBeInTheDocument();
  });

  it('redirects the removed branches page to dashboard', async () => {
    renderAt('/workspaces/w_core/branches');

    expect(await screen.findByRole('heading', { name: /^dashboard$/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Branches' })).not.toBeInTheDocument();
    expect(screen.queryByText('motion-v2')).not.toBeInTheDocument();
  });

  it('does not expose the removed approvals route', async () => {
    renderAt('/workspaces/w_core/approvals');

    expect(await screen.findByRole('heading', { name: /^dashboard$/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Approvals' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument();
  });

  it('lets users approve or reject pending skill proposals from the review page', async () => {
    const user = userEvent.setup();
    renderAt('/workspaces/w_core/skill-drafts/sd_motion/review');

    expect(await screen.findByRole('heading', { name: 'Skill Review' })).toBeInTheDocument();
    expect(await screen.findByText('review-agent-output')).toBeInTheDocument();
    expect(await screen.findByText('summarize-session')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Approve' })[0]);
    await waitFor(() => {
      expect(within(screen.getByRole('region', { name: 'Skill proposals' })).queryByText('review-agent-output')).not.toBeInTheDocument();
    });
    await user.click(screen.getAllByRole('button', { name: 'Reject' })[0]);

    expect(await screen.findByText('No pending skill proposals.')).toBeInTheDocument();
    const results = await screen.findByRole('region', { name: 'Approval results' });
    expect(within(results).getByLabelText('Skill review approved')).toBeInTheDocument();
    expect(within(results).getByLabelText('Skill review rejected')).toBeInTheDocument();
    expect(results).not.toHaveTextContent(/\bapproved\b|\brejected\b|\breview_requested\b/);
  });
});
