import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';

describe('i18n support', () => {
  beforeEach(() => {
    window.history.pushState(null, '', '/workspaces/w_core');
    window.localStorage.removeItem('brainx.locale');
  });

  afterEach(() => {
    window.localStorage.removeItem('brainx.locale');
  });

  it('defaults to Chinese and switches to English without changing the route', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole('heading', { name: '总览' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '审批' })).toBeInTheDocument();
    expect(await screen.findByText('运行中任务')).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: '设置' }));
    expect(await screen.findByRole('heading', { name: '设置' })).toBeInTheDocument();
    const settingsPath = window.location.pathname;

    await user.click(screen.getByRole('button', { name: /switch language to english/i }));

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Approvals' })).toBeInTheDocument();
    expect(window.location.pathname).toBe(settingsPath);
    expect(window.localStorage.getItem('brainx.locale')).toBe('en-US');
  });

  it('initializes from a saved English preference', async () => {
    window.localStorage.setItem('brainx.locale', 'en-US');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /switch language/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /switch language to chinese/i })).toBeInTheDocument();
  });
});
