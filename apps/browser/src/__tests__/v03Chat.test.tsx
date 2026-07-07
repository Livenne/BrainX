import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('v0.3 Chat workspace', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US');
  });

  it('renders Chat with the finalized low-density preview structure', async () => {
    renderAt('/workspaces/w_core/chat');

    expect(await screen.findByRole('heading', { name: 'Chat' })).toBeInTheDocument();
    expect(await screen.findByRole('log', { name: 'Agent loop timeline' })).toHaveClass('timeline-scroll-region');
    expect(screen.getByRole('textbox', { name: 'Message brainx' })).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Message composer' })).toHaveClass('composer-dock-sticky');
    expect(screen.queryByRole('combobox', { name: 'Composer mode' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Attach files')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Agent context' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Execution state' })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Todo list' })).not.toBeInTheDocument();
    expect(screen.queryByRole('log', { name: 'Background terminal' })).not.toBeInTheDocument();
  });

  it('renders structured agent message blocks as collapsed timeline disclosures', async () => {
    const user = userEvent.setup();
    renderAt('/workspaces/w_core/chat');

    const stream = await screen.findByRole('log', { name: 'Agent loop timeline' });
    expect(within(stream).getByText('Plan')).toBeInTheDocument();
    expect(within(stream).getByRole('list')).toBeInTheDocument();
    expect(within(stream).getByText('Inspect current AppShell and Chat files').tagName).toBe('LI');
    expect(within(stream).queryByText('User')).not.toBeInTheDocument();
    expect(within(stream).queryByText('brainx')).not.toBeInTheDocument();
    const readTool = within(stream).getByRole('button', { name: 'Read 1 file' });
    expect(readTool).toHaveAttribute('aria-expanded', 'false');
    expect(within(stream).queryByRole('button', { name: /Tool result/i })).not.toBeInTheDocument();
    expect(within(stream).queryByRole('region', { name: 'read_files details' })).not.toBeInTheDocument();
    await user.click(readTool);
    const readDetails = within(stream).getByRole('region', { name: 'read_files details' });
    expect(within(readDetails).getByText('apps/browser/src/components/AppShell.tsx')).toBeInTheDocument();
    expect(within(readDetails).getByText(/Located title bar/)).toBeInTheDocument();
    expect(within(stream).queryByText(/placeholder/i)).not.toBeInTheDocument();
    expect(within(stream).queryByText(/dummy/i)).not.toBeInTheDocument();
  });

  it('sends a message and appends a mock agent response', async () => {
    const user = userEvent.setup();
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: scrollTo
    });
    renderAt('/workspaces/w_core/chat');

    const composer = await screen.findByRole('textbox', { name: 'Message brainx' });
    await user.type(composer, 'Draft a client binding flow');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    const stream = screen.getByRole('log', { name: 'Agent loop timeline' });
    expect(within(stream).getByText('Draft a client binding flow')).toBeInTheDocument();
    expect(await within(stream).findByText(/Queued for frontend-main on mainline/)).toBeInTheDocument();
    expect(composer).toHaveValue('');
    expect(scrollTo).toHaveBeenCalled();
  });
});
