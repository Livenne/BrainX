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

describe('v0.3 Client management', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US');
  });

  it('renames daemons to Client and shows manageable device fields', async () => {
    renderAt('/workspaces/w_core/client-daemons');

    expect(await screen.findByRole('heading', { name: 'Client' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Client Daemons|Daemons/ })).not.toBeInTheDocument();
    expect(await screen.findByText('Livenne Workstation')).toBeInTheDocument();
    expect(screen.getByText('Ubuntu 24.04 / WSL')).toBeInTheDocument();
    expect(screen.getByText(/v0.1.0/)).toBeInTheDocument();
    expect(screen.getByText(/8s since heartbeat/)).toBeInTheDocument();
    expect(screen.getAllByText(/Primary local development client/).length).toBeGreaterThan(0);
  });

  it('shows bind-code entry and supports unbinding a listed mock client', async () => {
    const user = userEvent.setup();
    renderAt('/workspaces/w_core/client-daemons');

    expect(await screen.findByText('Bind local client')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Bind code' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bind client' })).toBeInTheDocument();

    const localDevice = screen.getByRole('article', { name: 'Livenne Workstation' });
    await user.click(within(localDevice).getByRole('button', { name: 'Delete client' }));

    expect(screen.queryByRole('article', { name: 'Livenne Workstation' })).not.toBeInTheDocument();
  });
});
