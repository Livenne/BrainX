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
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </ThemeProvider>
  );
}

describe('v0.3 app shell', () => {
  beforeEach(async () => {
    window.localStorage.removeItem('brainx.sidebarCollapsed');
    await i18n.changeLanguage('en-US');
  });

  it('uses a full-screen workbench shell and exposes Chat as a primary route', async () => {
    const { container } = renderAt('/workspaces/w_core/chat');

    expect(await screen.findByRole('heading', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Chat' })).toBeInTheDocument();
    expect(container.querySelector('.app-shell')).toHaveClass('full-workbench');
    expect(container.querySelector('.content-region')).toHaveAttribute('data-surface', 'transparent');
  });

  it('centers collapsed sidebar affordances without label layout bleed', async () => {
    const user = userEvent.setup();
    renderAt('/workspaces/w_core/chat');

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(nav).toHaveAttribute('data-collapsed', 'true');
    expect(nav).toHaveAttribute('data-align', 'center');
    const chatLink = within(nav).getByRole('link', { name: 'Chat' });
    expect(chatLink).toHaveAttribute('data-collapsed', 'true');
    expect(chatLink.querySelector('.nav-icon-slot')).toBeInTheDocument();
    expect(chatLink.querySelector('.nav-label')).toHaveAttribute('data-visible', 'false');
    expect(screen.getByTestId('brand-copy')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('brand-copy')).toHaveAttribute('data-visible', 'false');
  });

  it('shows the current page name instead of brand and status tag clutter in the top bar', async () => {
    renderAt('/workspaces/w_core/chat');

    const statusBar = await screen.findByRole('banner', { name: 'Top bar' });
    expect(within(statusBar).getByRole('heading', { name: 'Chat' })).toBeInTheDocument();
    const clientSelector = within(statusBar).getByRole('button', { name: 'Bound client device' });
    expect(clientSelector).toBeInTheDocument();
    expect(clientSelector).toHaveClass('top-client-trigger');
    expect(within(statusBar).getByText('Livenne Workstation')).toBeInTheDocument();
    expect(within(statusBar).queryByText(/^Client$/)).not.toBeInTheDocument();
    expect(within(statusBar).queryByText('brainx')).not.toBeInTheDocument();
    expect(within(statusBar).queryByText('workspace-core')).not.toBeInTheDocument();
    expect(within(statusBar).queryByText(/frontend-main/)).not.toBeInTheDocument();
    expect(within(statusBar).queryByText(/mainline/)).not.toBeInTheDocument();
    expect(within(statusBar).queryByText(/Pending approvals: 3/)).not.toBeInTheDocument();
    expect(within(statusBar).getByRole('searchbox', { name: 'Command search' })).toBeInTheDocument();
    expect(within(statusBar).queryByRole('button', { name: /switch language/i })).not.toBeInTheDocument();
    expect(within(statusBar).queryByText('/workspaces/w_core/chat')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Bound client selector' })).not.toBeInTheDocument();
  });

  it('keeps page titles in the top bar instead of duplicating them inside content', async () => {
    renderAt('/workspaces/w_core/agents');

    const statusBar = await screen.findByRole('banner', { name: 'Top bar' });
    const main = screen.getByRole('main');

    expect(await within(main).findByText('Agent management is not open yet')).toBeInTheDocument();
    expect(within(statusBar).getByRole('heading', { name: 'Agents' })).toBeInTheDocument();
    expect(within(main).queryByRole('heading', { name: 'Agents' })).not.toBeInTheDocument();
    expect(within(main).queryByText('Manage forkable workers, memory policy, and run launch context.')).not.toBeInTheDocument();
  });
});
