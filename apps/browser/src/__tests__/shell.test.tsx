import { render, screen } from '@testing-library/react';
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
    expect(screen.getByRole('link', { name: '分支' })).toBeInTheDocument();
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
