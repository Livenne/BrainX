import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('browser routing', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US');
  });

  it('renders the dashboard route', async () => {
    renderAt('/workspaces/w_core');

    expect(await screen.findByRole('heading', { name: /^dashboard$/i })).toBeInTheDocument();
  });

  it('uses dashboard as the default app route', async () => {
    renderAt('/');

    expect(await screen.findByRole('heading', { name: /^dashboard$/i })).toBeInTheDocument();
  });

  it('renders the run detail route', async () => {
    renderAt('/workspaces/w_core/agents/agent_frontend/runs/run_8f3a');

    expect(await screen.findByRole('heading', { name: /agent run detail/i })).toBeInTheDocument();
  });

  it('keeps every visible nav link on a registered workspace route', async () => {
    const user = userEvent.setup();
    renderAt('/workspaces/w_core');

    const navExpectations = [
      ['Dashboard', /^dashboard$/i],
      ['Chat', /^chat$/i],
      ['Agents', /agents/i],
      ['Skills', /skill review/i],
      ['Client', /^client$/i],
      ['Settings', /settings/i]
    ] as const;

    for (const [label, heading] of navExpectations) {
      await user.click(screen.getByRole('link', { name: label }));
      expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    }
  });

  it('builds shell navigation from the active workspace route param', async () => {
    const user = userEvent.setup();
    renderAt('/workspaces/other');

    const statusBar = await screen.findByRole('banner', { name: 'Top bar' });
    expect(within(statusBar).getByRole('heading', { name: /^dashboard$/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Approvals' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Branches' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Chat' }));

    expect(await screen.findByRole('heading', { name: /^chat$/i })).toBeInTheDocument();
    expect(within(screen.getByRole('banner', { name: 'Top bar' })).getByRole('heading', { name: /^chat$/i })).toBeInTheDocument();
  });

  it('redirects the removed branches route to the dashboard', async () => {
    renderAt('/workspaces/w_core/branches');

    expect(await screen.findByRole('heading', { name: /^dashboard$/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Branches' })).not.toBeInTheDocument();
  });
});
