import { render, screen, within } from '@testing-library/react';
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

  it('lets users start an agent run and fork a branch from Agents', async () => {
    const user = userEvent.setup();
    renderAt('/workspaces/w_core/agents');

    expect(await screen.findByRole('heading', { name: 'Agents' })).toBeInTheDocument();
    const startRunButtons = await screen.findAllByRole('button', { name: 'Start run' });
    await user.click(startRunButtons[0]);
    expect(await screen.findByText('Run queued for frontend-main')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Fork branch' })[0]);
    expect(await screen.findByText('Branch fork prepared from frontend-main')).toBeInTheDocument();
  });

  it('shows branch adoption as a selected review instead of passive text', async () => {
    const user = userEvent.setup();
    renderAt('/workspaces/w_core/branches');

    expect(await screen.findByRole('heading', { name: 'Branches' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Review motion-v2' }));

    const review = screen.getByRole('complementary', { name: 'Adoption review' });
    expect(within(review).getByText('Adoption target: motion-v2')).toBeInTheDocument();
    expect(within(review).getByText(/No memory, context, or task history is merged automatically/)).toBeInTheDocument();
    expect(within(review).getByRole('button', { name: 'Adopt selected changes' })).toBeInTheDocument();
  });

  it('supports approving and denying approval requests with a reason', async () => {
    const user = userEvent.setup();
    renderAt('/workspaces/w_core/approvals');

    const reviewButtons = await screen.findAllByRole('button', { name: 'Review' });
    await user.click(reviewButtons[0]);
    const reason = screen.getByRole('textbox', { name: 'Decision reason' });
    await user.type(reason, 'Evidence reviewed and risk accepted');
    await user.click(screen.getByRole('button', { name: 'Deny' }));

    expect(await screen.findByText('Denied')).toBeInTheDocument();
    expect(screen.getAllByText('Evidence reviewed and risk accepted').length).toBeGreaterThan(0);
  });

  it('lets users publish or reject skill drafts from the review page', async () => {
    const user = userEvent.setup();
    renderAt('/workspaces/w_core/skill-drafts/sd_motion/review');

    expect(await screen.findByRole('heading', { name: 'Skill Review' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Publish skill' }));
    expect(await screen.findByText('Published as v0.5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject draft' })).toBeInTheDocument();
  });
});
