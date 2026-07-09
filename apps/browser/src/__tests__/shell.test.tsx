import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
import { ThemeProvider } from '../state/theme';

function renderAt(path: string) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </ThemeProvider>
  );
}

function okJson(value: unknown) {
  return Promise.resolve({
    ok: true,
    status: 202,
    json: () => Promise.resolve(value)
  } as Response);
}

describe('v0.2 app shell', () => {
  beforeEach(() => {
    window.localStorage.removeItem('brainx.sidebarCollapsed');
    window.localStorage.removeItem('brainx.locale');
  });

  afterEach(() => {
    window.localStorage.removeItem('brainx.sidebarCollapsed');
    window.localStorage.removeItem('brainx.locale');
    window.localStorage.removeItem('brainx.auth');
    vi.unstubAllGlobals();
  });

  it('uses a full-screen workbench shell with expanded navigation by default', async () => {
    const { container } = renderAt('/workspaces/w_core');

    expect(await screen.findByRole('heading', { name: '总览' })).toBeInTheDocument();
    expect(container.querySelector('.app-shell')).toHaveClass('full-workbench');
    expect(screen.getByRole('navigation', { name: '主导航' })).toHaveAttribute('data-collapsed', 'false');
    expect(screen.queryByRole('link', { name: '分支' })).not.toBeInTheDocument();
  });

  it('uses the repository logo image for the sidebar brand mark', async () => {
    const { container } = renderAt('/workspaces/w_core');

    expect(await screen.findByRole('heading', { name: '总览' })).toBeInTheDocument();
    const brandMark = container.querySelector('.brand-mark');
    expect(within(brandMark as HTMLElement).getByRole('img', { name: 'brainx' })).toHaveAttribute('src', expect.stringContaining('logo.png'));
    expect(brandMark).not.toHaveTextContent(/^bx$/i);
    expect(screen.getByTestId('brand-copy')).toHaveTextContent('BrainX');
    expect(screen.getByTestId('brand-copy')).not.toHaveTextContent('Session');
  });

  it('places the bound client dropdown beside the chat title with polished controls', async () => {
    const user = userEvent.setup();
    const { container } = renderAt('/workspaces/w_core/chat');

    expect(await screen.findByRole('heading', { name: 'Chat' })).toBeInTheDocument();
    const titleRow = container.querySelector('.workspace-title-row');
    expect(titleRow).not.toBeNull();
    expect(within(titleRow as HTMLElement).getByRole('heading', { name: 'Chat' })).toBeInTheDocument();
    const trigger = within(titleRow as HTMLElement).getByRole('button', { name: /Bound client device/i });
    expect(trigger).toHaveClass('top-client-trigger');
    expect(trigger).toHaveTextContent('Livenne Workstation');
    expect(trigger).not.toHaveTextContent(/^Client/i);

    await user.click(trigger);
    const listbox = await screen.findByRole('listbox', { name: 'Bound client devices' });
    expect(listbox).toHaveClass('top-client-menu');
    expect(within(listbox).getByRole('option', { name: /Livenne Workstation/ })).toBeInTheDocument();
  });

  it('collapses and persists the sidebar state', async () => {
    const user = userEvent.setup();
    const { unmount } = renderAt('/workspaces/w_core');

    await user.click(screen.getByRole('button', { name: '折叠侧边栏' }));

    expect(screen.getByRole('navigation', { name: '主导航' })).toHaveAttribute('data-collapsed', 'true');
    expect(window.localStorage.getItem('brainx.sidebarCollapsed')).toBe('true');

    unmount();
    renderAt('/workspaces/w_core');

    expect(await screen.findByRole('heading', { name: '总览' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '主导航' })).toHaveAttribute('data-collapsed', 'true');
  });

  it('logs out from the top bar and returns to the auth screen', async () => {
    const user = userEvent.setup();
    const fetch = vi.fn(() => okJson({ accepted: true }));
    vi.stubGlobal('fetch', fetch);

    renderAt('/workspaces/w_core');

    await user.click(await screen.findByRole('button', { name: '退出登录' }));

    expect(fetch).toHaveBeenCalledWith('/api/v1/auth/logout', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token'
      }
    });
    expect(await screen.findByRole('heading', { name: 'brainx' })).toBeInTheDocument();
  });
});
