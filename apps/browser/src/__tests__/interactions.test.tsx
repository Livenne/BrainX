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

describe('interaction states', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US');
  });

  it('opens approval evidence in a side panel and submits a decision', async () => {
    const user = userEvent.setup();
    renderAt('/workspaces/w_core/approvals');

    const reviewButtons = await screen.findAllByRole('button', { name: /review/i });
    await user.click(reviewButtons[0]);

    expect(screen.getByRole('complementary', { name: /approval evidence/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled();

    await user.type(screen.getByLabelText(/decision reason/i), 'Reviewed scope and evidence');
    await user.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => {
      expect(screen.getByText(/approved/i)).toBeInTheDocument();
    });
    expect(screen.getAllByText(/approved/i)).toHaveLength(1);
    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled();
    const pendingQueue = screen.getByRole('heading', { name: /pending queue/i }).closest('section') as HTMLElement;
    expect(within(pendingQueue).queryByText('Publish skill version')).not.toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: /review/i })[0]);

    expect(within(pendingQueue).queryByText('Publish skill version')).not.toBeInTheDocument();
  });
});
