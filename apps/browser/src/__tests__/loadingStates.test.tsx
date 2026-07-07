import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageSkeleton, PendingButton } from '../components/LoadingStates';

describe('loading states', () => {
  it('renders a structured page skeleton with an accessible label', () => {
    const { container } = render(<PageSkeleton label="Loading dashboard" />);

    expect(screen.getByRole('status', { name: /loading dashboard/i })).toHaveClass('page-skeleton');
    expect(screen.getByRole('status', { name: /loading dashboard/i })).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('.skeleton-card')).toHaveLength(4);
    expect(container.querySelectorAll('.skeleton-panel')).toHaveLength(2);
  });

  it('marks pending buttons as busy and disabled', () => {
    render(<PendingButton pending>Approve</PendingButton>);

    const button = screen.getByRole('button', { name: /approve/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });
});
