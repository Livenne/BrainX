import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '../App';
import { i18n } from '../i18n/i18n';
import { chatPreviewToolSamples } from '../pages/ChatPreviewPage';
import { ThemeProvider } from '../state/theme';

function renderAt(path: string) {
  render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </ThemeProvider>
  );
}

async function openReviewControls(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Toggle review controls' }));
  return screen.getByRole('region', { name: 'Review controls' });
}

describe('Chat design preview', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US');
  });

  it('uses the finalized CS tool argument contract in every preview sample', () => {
    const byKind = Object.fromEntries(chatPreviewToolSamples.map((tool) => [tool.kind, tool]));

    expect(Object.keys(byKind).sort()).toEqual([
      'apply_patch',
      'ask_user',
      'background_read',
      'background_start',
      'background_stop',
      'get_environment',
      'read_files',
      'run_command',
      'search_workspace',
      'subagent_read',
      'subagent_start',
      'subagent_stop',
      'todo_update',
      'write_file'
    ]);

    expect(byKind.get_environment.arguments).toEqual({});
    expect(byKind.read_files.arguments).toEqual({
      files: [
        { path: 'apps/browser/src/pages/ChatPage.tsx', startLine: 1, endLine: 220 },
        { path: 'apps/browser/src/domain/types.ts', startLine: 1, endLine: 120 },
        { path: 'docs/brainx/browser-design-system.md', startLine: 1, endLine: 120 }
      ]
    });
    expect(byKind.search_workspace.arguments).toEqual({
      query: 'tool_call',
      mode: 'text',
      maxResults: 20
    });
    expect(byKind.apply_patch.arguments).toEqual({
      patch: expect.stringContaining('*** Update File: apps/browser/src/pages/ChatPreviewPage.tsx'),
      dryRun: true
    });
    expect(byKind.write_file.arguments).toEqual({
      path: 'apps/browser/src/pages/ChatPreviewPage.css',
      content: expect.stringContaining('.chat-preview-page'),
      overwrite: true,
      createParents: true
    });
    expect(byKind.run_command.arguments).toEqual({
      command: 'npm test -- src/__tests__/chatPreview.test.tsx',
      workingDirectory: 'apps/browser',
      timeoutSeconds: 120
    });
    expect(byKind.ask_user.arguments).toEqual({
      questions: [
        {
          id: 'direction',
          question: 'Which Chat structure should become the production direction?',
          options: [
            { id: 'timeline', label: 'Timeline canvas', description: 'Keep the main pane calm and reveal details on demand.', recommended: true },
            { id: 'workbench', label: 'Three-column workbench', description: 'Show surrounding context persistently.' }
          ],
          allowOther: true
        }
      ]
    });
    expect(byKind.todo_update.arguments).toEqual({
      items: [
        { id: 't1', title: 'Inspect schemas', status: 'completed', note: 'done' },
        { id: 't2', title: 'Implement runtime', status: 'in_progress' }
      ],
      reason: 'after schema review'
    });
    expect(byKind.background_start.arguments).toEqual({
      name: 'browser-dev-server',
      command: 'npm run dev -- --port 5173',
      workingDirectory: 'apps/browser',
      maxRuntimeSeconds: 14400,
      purpose: 'manual review'
    });
    expect(byKind.background_read.arguments).toEqual({ taskId: 'bg_1', cursor: 0, maxBytes: 12000 });
    expect(byKind.background_stop.arguments).toEqual({ taskId: 'bg_1', mode: 'terminate' });
    expect(byKind.subagent_start.arguments).toEqual({
      task: 'Review stale tool names',
      context: 'read_files is the canonical file read tool',
      allowedTools: ['get_environment', 'read_files', 'search_workspace'],
      allowedPaths: ['apps/browser/**', 'docs/brainx/**'],
      writeAccess: false,
      budget: { maxTurns: 8, maxMinutes: 10 },
      successCriteria: ['return exact file references'],
      outputSchema: 'summary_evidence_risks'
    });
    expect(byKind.subagent_read.arguments).toEqual({ subagentId: 'sub_1', includeEvents: false });
    expect(byKind.subagent_stop.arguments).toEqual({ subagentId: 'sub_1', reason: 'Parent task changed direction.' });

    const serialized = JSON.stringify(chatPreviewToolSamples.map((tool) => tool.arguments));
    expect(serialized).not.toContain('"range"');
    expect(serialized).not.toContain('"paths"');
    expect(serialized).not.toContain('"cwd"');
    expect(serialized).not.toContain('"timeout_ms"');
    expect(serialized).not.toContain('"shell"');
    expect(serialized).not.toContain('"bytes"');
  });

  it('renders a low-density default chat workspace with details hidden', async () => {
    renderAt('/workspaces/w_core/chat-preview');

    expect(await screen.findByRole('heading', { name: 'Chat Preview' })).toBeInTheDocument();
    expect(screen.getByRole('log', { name: 'Agent loop timeline' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message brainx preview' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Toggle history side rail' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Toggle run side rail' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Toggle tool catalog side rail' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'What should brainx work on?' })).not.toBeInTheDocument();
    expect(screen.queryByText('frontend-main')).not.toBeInTheDocument();

    const timeline = screen.getByRole('log', { name: 'Agent loop timeline' });
    expect(within(timeline).getByRole('heading', { name: 'Implementation plan' })).toBeInTheDocument();
    expect(within(timeline).getByText('Use structured tool renderers')).toBeInTheDocument();
    expect(within(timeline).getByText('Context snapshot')).toBeInTheDocument();
    expect(within(timeline).getByText('workspace-core')).toBeInTheDocument();
    expect(within(timeline).getByRole('button', { name: 'Read files 3 files' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(within(timeline).getByRole('button', { name: 'Run npm test -- src/__tests__/chatPreview.test.tsx' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(within(timeline).queryByText('Inspect existing Chat route')).not.toBeInTheDocument();
    expect(within(timeline).queryByText('Focused Vitest run is streaming output from the browser workspace.')).not.toBeInTheDocument();
    expect(within(timeline).queryByRole('region', { name: 'read_files details' })).not.toBeInTheDocument();
    expect(within(timeline).queryByText('function ToolCallBlock({ block, handlers }) {')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Conversation history' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Tool inspector' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Inspect / })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Dismiss drawer')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Explore workspace scenario' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Patch approval scenario' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle review controls' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Review controls' })).not.toBeInTheDocument();
  });

  it('keeps review scenario controls collapsed outside the main chat by default', async () => {
    const user = userEvent.setup();
    renderAt('/workspaces/w_core/chat-preview');

    const controls = await openReviewControls(user);
    expect(within(controls).getByRole('button', { name: 'All tools scenario' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle review controls' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(controls).getByRole('button', { name: 'Explore workspace scenario' })).toBeInTheDocument();
    expect(within(controls).getByRole('button', { name: 'Patch approval scenario' })).toBeInTheDocument();
    expect(within(controls).getByRole('button', { name: 'Run command scenario' })).toBeInTheDocument();
    expect(within(controls).getByRole('button', { name: 'Ask user scenario' })).toBeInTheDocument();
    expect(within(controls).getByRole('button', { name: 'Failure case scenario' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Toggle review controls' }));
    expect(screen.queryByRole('region', { name: 'Review controls' })).not.toBeInTheDocument();
  });

  it('supports mode switching and attachment display in the central composer', async () => {
    const user = userEvent.setup();
    renderAt('/workspaces/w_core/chat-preview');

    const modeSelect = await screen.findByRole('combobox', { name: 'Composer mode' });
    expect(screen.queryByRole('button', { name: 'Plan mode' })).not.toBeInTheDocument();
    await user.selectOptions(modeSelect, 'Plan');
    expect(modeSelect).toHaveValue('Plan');

    const attachment = new File(['preview'], 'trace.log', { type: 'text/plain' });
    await user.upload(screen.getByLabelText('Attach files'), attachment);
    expect(screen.getByText('trace.log')).toBeInTheDocument();
  });

  it('keeps the conversation scrollable while the composer stays docked', async () => {
    renderAt('/workspaces/w_core/chat-preview');

    expect(await screen.findByRole('log', { name: 'Agent loop timeline' })).toHaveClass('timeline-scroll-region');
    expect(screen.getByRole('form', { name: 'Preview message composer' })).toHaveClass('composer-dock-sticky');
  });

  it('expands ordinary tool calls inline with type-specific details', async () => {
    const user = userEvent.setup();
    renderAt('/workspaces/w_core/chat-preview');
    const timeline = await screen.findByRole('log', { name: 'Agent loop timeline' });

    const initialToolHeaders = within(timeline).getAllByTestId('tool-icon-slot');
    expect(initialToolHeaders.length).toBeGreaterThan(0);
    expect(timeline.querySelector('.tool-status-icon')).not.toBeInTheDocument();
    expect(timeline.querySelector('.tool-kind-icon')).not.toBeInTheDocument();

    await user.click(within(timeline).getByRole('button', { name: 'Read files 3 files' }));
    const readDetails = within(timeline).getByRole('region', { name: 'read_files details' });
    expect(within(readDetails).getByText('apps/browser/src/pages/ChatPage.tsx')).toBeInTheDocument();
    expect(within(readDetails).getByText('function ToolCallBlock({ block, handlers }) {')).toBeInTheDocument();

    const controls = await openReviewControls(user);

    await user.click(within(controls).getByRole('button', { name: 'Explore workspace scenario' }));
    expect(within(timeline).getByRole('button', { name: 'Environment /home/Livenne/code/brainx' })).toBeInTheDocument();
    expect(within(timeline).getAllByRole('button', { name: 'Read files 3 files' }).length).toBeGreaterThan(0);
    expect(within(timeline).getByRole('button', { name: 'Search tool_call' })).toBeInTheDocument();
    expect(within(timeline).queryByRole('region', { name: 'get_environment details' })).not.toBeInTheDocument();

    await user.click(within(timeline).getByRole('button', { name: 'Environment /home/Livenne/code/brainx' }));
    const environmentDetails = within(timeline).getByRole('region', { name: 'get_environment details' });
    expect(within(environmentDetails).getByText('Ubuntu 24.04 / WSL')).toBeInTheDocument();
    expect(within(environmentDetails).queryByText('workspace-core local client')).not.toBeInTheDocument();
    expect(within(environmentDetails).queryByText('completed')).not.toBeInTheDocument();
    expect(within(environmentDetails).queryByText('read')).not.toBeInTheDocument();
    expect(within(environmentDetails).queryByText('18ms')).not.toBeInTheDocument();

    await user.click(within(timeline).getAllByRole('button', { name: 'Read files 3 files' })[1]);
    const readManyDetails = within(timeline).getAllByRole('region', { name: 'read_files details' })[1];
    expect(within(readManyDetails).getByText('apps/browser/src/domain/types.ts')).toBeInTheDocument();
    expect(within(readManyDetails).queryByText('completed')).not.toBeInTheDocument();

    await user.click(within(controls).getByRole('button', { name: 'Patch approval scenario' }));
    const patchToggle = within(timeline).getByRole('button', { name: 'Patch apps/browser/src/pages/ChatPreviewPage.tsx' });
    expect(patchToggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(timeline).queryByText('+ <AgentLoopTimeline />')).not.toBeInTheDocument();
    await user.click(patchToggle);
    const patchDetails = within(timeline).getByRole('region', { name: 'apply_patch details' });
    expect(within(patchDetails).getByText(/apps\/browser\/src\/pages\/ChatPreviewPage\.tsx/)).toBeInTheDocument();
    expect(within(patchDetails).getByText('+ <AgentLoopTimeline />')).toBeInTheDocument();
    expect(within(patchDetails).queryByText('waiting_for_approval')).not.toBeInTheDocument();

    await user.click(within(timeline).getByRole('button', { name: 'Write apps/browser/src/pages/ChatPreviewPage.css' }));
    const writeDetails = within(timeline).getByRole('region', { name: 'write_file details' });
    expect(within(writeDetails).getByText('apps/browser/src/pages/ChatPreviewPage.css')).toBeInTheDocument();
    expect(within(writeDetails).queryByText('Mode')).not.toBeInTheDocument();
    expect(within(writeDetails).queryByText('Bytes')).not.toBeInTheDocument();

    await user.click(within(controls).getByRole('button', { name: 'Run command scenario' }));
    expect(within(timeline).queryByText('stdout')).not.toBeInTheDocument();
    await user.click(within(timeline).getByRole('button', { name: 'Run npm test -- src/__tests__/chatPreview.test.tsx' }));
    const commandDetails = within(timeline).getByRole('region', { name: 'run_command details' });
    expect(within(commandDetails).getByText('src/__tests__/chatPreview.test.tsx')).toBeInTheDocument();
    expect(within(commandDetails).queryByText('Command')).not.toBeInTheDocument();
    expect(within(commandDetails).queryByText('Cwd')).not.toBeInTheDocument();
    expect(within(commandDetails).queryByText('Status')).not.toBeInTheDocument();
    expect(within(commandDetails).queryByText('stdout')).not.toBeInTheDocument();
    expect(within(commandDetails).queryByText('stderr')).not.toBeInTheDocument();
    expect(within(commandDetails).queryByText('No stderr output')).not.toBeInTheDocument();
    expect(within(commandDetails).queryByText('completed')).not.toBeInTheDocument();

    await user.click(within(controls).getByRole('button', { name: 'Ask user scenario' }));
    expect(within(timeline).queryByText('Timeline canvas')).not.toBeInTheDocument();
    await user.click(within(timeline).getByRole('button', { name: 'Ask user Which Chat structure should become the production direction?' }));
    const askDetails = within(timeline).getByRole('region', { name: 'ask_user details' });
    expect(within(askDetails).getByText('Timeline canvas')).toBeInTheDocument();
    expect(within(askDetails).getByText('unanswered')).toBeInTheDocument();
    expect(within(askDetails).queryByText('Chat redesign direction')).not.toBeInTheDocument();
    expect(within(askDetails).queryByText('300000ms')).not.toBeInTheDocument();

    await user.click(within(controls).getByRole('button', { name: 'Failure case scenario' }));
    expect(within(timeline).queryByText('invalid_regex')).not.toBeInTheDocument();
    await user.click(within(timeline).getByRole('button', { name: 'Search tool_call(' }));
    const failureDetails = within(timeline).getByRole('region', { name: 'search_workspace details' });
    expect(within(failureDetails).getByText('invalid_regex')).toBeInTheDocument();
    expect(within(failureDetails).getByText('Unclosed group near character 10.')).toBeInTheDocument();
    expect(within(failureDetails).queryByText('failed')).not.toBeInTheDocument();
  });
});
