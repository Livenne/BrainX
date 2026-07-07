import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { i18n } from '../i18n/i18n';

describe('theme support', () => {
  beforeEach(async () => {
    window.history.pushState(null, '', '/workspaces/w_core');
    window.localStorage.setItem('brainx.locale', 'en-US');
    await i18n.changeLanguage('en-US');
    window.localStorage.removeItem('brainx.theme');
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    window.localStorage.removeItem('brainx.locale');
    window.localStorage.removeItem('brainx.theme');
    delete document.documentElement.dataset.theme;
  });

  it('switches between dark and light themes without changing app content', async () => {
    render(<App />);

    const main = screen.getByRole('main');
    await screen.findByRole('heading', { name: /^dashboard$/i });
    await screen.findByText('Active runs');
    const originalContent = main.textContent;

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(main).toHaveTextContent('Active runs');
    expect(screen.getByRole('switch', { name: /switch to light theme/i })).toHaveAttribute('aria-checked', 'false');

    await userEvent.click(screen.getByRole('switch', { name: /switch to light theme/i }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(main.textContent).toBe(originalContent);
    expect(screen.getByRole('switch', { name: /switch to dark theme/i })).toHaveAttribute('aria-checked', 'true');
    expect(window.localStorage.getItem('brainx.theme')).toBe('light');

    await userEvent.click(screen.getByRole('switch', { name: /switch to dark theme/i }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(main.textContent).toBe(originalContent);
    expect(screen.getByRole('switch', { name: /switch to light theme/i })).toHaveAttribute('aria-checked', 'false');
    expect(window.localStorage.getItem('brainx.theme')).toBe('dark');
  });

  it('initializes from a saved light theme preference', () => {
    window.localStorage.setItem('brainx.theme', 'light');

    render(<App />);

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(screen.getByRole('switch', { name: /switch to dark theme/i })).toHaveAttribute('aria-checked', 'true');
  });
});
