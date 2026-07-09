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

  it('supports mock add, note edit, and delete actions', async () => {
    const user = userEvent.setup();
    renderAt('/workspaces/w_core/client-daemons');

    await user.click(await screen.findByRole('button', { name: 'Add client' }));
    expect(await screen.findByText('New Client Device')).toBeInTheDocument();

    const localDevice = screen.getByRole('article', { name: 'Livenne Workstation' });
    await user.clear(within(localDevice).getByRole('textbox', { name: 'Device note' }));
    await user.type(within(localDevice).getByRole('textbox', { name: 'Device note' }), 'Allowed for browser tests');
    await user.click(within(localDevice).getByRole('button', { name: 'Save note' }));
    expect(await within(localDevice).findByText('Allowed for browser tests')).toBeInTheDocument();
    await waitFor(() => expect(within(localDevice).getByRole('button', { name: 'Save note' })).not.toHaveAttribute('aria-busy'));

    const newDevice = screen.getByRole('article', { name: 'New Client Device' });
    await user.click(within(newDevice).getByRole('button', { name: 'Delete client' }));
    expect(screen.queryByText('New Client Device')).not.toBeInTheDocument();
  });
});
