import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readSource(path: string) {
  return readFileSync(resolve(root, path), 'utf8');
}

describe('visual design constraints', () => {
  it('uses the approved brand source and OKLCH-derived tokens', () => {
    const tokens = readSource('styles/tokens.css');

    expect(tokens).toContain('--brand-source: #2563EB');
    expect(tokens).toContain('--brand-oklch: oklch(54.61% 0.2152 262.88)');
    expect(tokens).toMatch(/--color-state-info:\s*oklch\(var\(--brand-l\)/);
    expect(tokens).toMatch(/--color-state-danger:\s*oklch\(var\(--brand-l\)/);
  });

  it('does not use decorative conic gradients or colored card rails', () => {
    const shellCss = readSource('components/AppShell.css');
    const workbenchCss = readSource('components/workbench.css');

    expect(shellCss).not.toContain('conic-gradient');
    expect(workbenchCss).not.toContain('linear-gradient(90deg, transparent, var(--color-state-info), transparent)');
    expect(workbenchCss).not.toContain('risk-rail');
  });

  it('keeps the design system aligned with the approved brand and content rules', () => {
    const designSystem = readFileSync(resolve(root, '../../../docs/brainx/browser-design-system.md'), 'utf8');

    expect(designSystem).toContain('`#2563EB`');
    expect(designSystem).toContain('`oklch(54.61% 0.2152 262.88)`');
    expect(designSystem).toContain('One thousand no');
    expect(designSystem).toContain('Never pad a design');
    expect(designSystem).not.toContain('`state.info`: #');
    expect(designSystem).not.toContain('Daemon');
  });

  it('styles the chat timeline scrollbar without ad hoc colors', () => {
    const chatCss = readSource('pages/ChatPreviewPage.css');

    expect(chatCss).toContain('.timeline-scroll-region::-webkit-scrollbar');
    expect(chatCss).toContain('.timeline-scroll-region::-webkit-scrollbar-thumb');
    expect(chatCss).toMatch(/\.timeline-scroll-region\s*\{[^}]*scrollbar-color:/s);
    expect(chatCss).not.toContain('#7c3aed');
    expect(chatCss).not.toContain('#ec4899');
  });
});
