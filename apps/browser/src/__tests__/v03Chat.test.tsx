import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { i18n } from '../i18n/i18n';
import { diffLineKind, isUsableChatClient, sanitizeChatError, takeTypewriterSlice } from '../pages/ChatPage';
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

async function openBrowserWorkbenchRun(user: ReturnType<typeof userEvent.setup>) {
  await chooseChatSession(user, 'Browser workbench run');
  return screen.findByRole('log', { name: 'Agent loop timeline' });
}

async function chooseChatSession(user: ReturnType<typeof userEvent.setup>, name: string) {
  const selector = await screen.findByRole('combobox', { name: 'Chat sessions' });
  if (selector.tagName === 'SELECT') {
    await user.selectOptions(selector, 'chat_main');
    return;
  }
  await user.click(selector);
  await user.click(await screen.findByRole('option', { name }));
}

describe('v0.3 Chat workspace', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US');
  });

  it('renders Chat with the finalized low-density preview structure', async () => {
    renderAt('/workspaces/w_core/chat');

    expect(await screen.findByRole('heading', { name: 'Chat' })).toBeInTheDocument();
    expect(await screen.findByRole('log', { name: 'Agent loop timeline' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'What should brainx work on?' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Empty chat' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('combobox', { name: 'Chat sessions' }));
    expect(screen.getByRole('option', { name: 'New chat' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Chat sessions' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message brainx' })).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Message composer' })).toHaveClass('composer-dock-sticky');
    expect(screen.queryByRole('combobox', { name: 'Composer mode' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attach files' })).toHaveClass('composer-icon-button');
    expect(screen.getByRole('button', { name: 'Send message' })).toHaveClass('composer-send-button');
    expect(screen.getByRole('progressbar', { name: 'Context budget' })).toBeInTheDocument();
    expect(within(screen.getByRole('form', { name: 'Message composer' })).queryByText('Working')).not.toBeInTheDocument();
    expect(screen.queryByText('workspace ~/.brainx/workspace')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Agent context' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Execution state' })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Todo list' })).not.toBeInTheDocument();
    expect(screen.queryByRole('log', { name: 'Background terminal' })).not.toBeInTheDocument();
  });

  it('keeps New chat as an empty page with the session list open', async () => {
    renderAt('/workspaces/w_core/chat?sessionId=new');

    expect(await screen.findByRole('heading', { name: 'What should brainx work on?' })).toBeInTheDocument();
    const selector = await screen.findByRole('combobox', { name: 'Chat sessions' });
    expect(selector).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox', { name: 'Chat sessions' })).toBeInTheDocument();
  });

  it('renders structured agent message blocks as collapsed timeline disclosures', async () => {
    const user = userEvent.setup();
    renderAt('/workspaces/w_core/chat');

    const stream = await openBrowserWorkbenchRun(user);
    expect(within(stream).getByText('Plan')).toBeInTheDocument();
    expect(within(stream).getByRole('list')).toBeInTheDocument();
    expect(within(stream).getByText('Inspect current AppShell and Chat files').tagName).toBe('LI');
    expect(within(stream).queryByText('User')).not.toBeInTheDocument();
    expect(within(stream).queryByText('brainx')).not.toBeInTheDocument();
    const readTool = within(stream).getByRole('button', { name: 'Read 1 file' });
    expect(readTool).toHaveAttribute('aria-expanded', 'false');
    expect(within(stream).queryByRole('button', { name: /Tool result/i })).not.toBeInTheDocument();
    expect(within(stream).queryByRole('region', { name: 'read_files details' })).not.toBeInTheDocument();
    await user.click(readTool);
    const readDetails = within(stream).getByRole('region', { name: 'read_files details' });
    expect(within(readDetails).getByText('apps/browser/src/components/AppShell.tsx')).toBeInTheDocument();
    expect(within(readDetails).getByText(/Located title bar/)).toBeInTheDocument();
    expect(within(stream).queryByText(/placeholder/i)).not.toBeInTheDocument();
    expect(within(stream).queryByText(/dummy/i)).not.toBeInTheDocument();
  });

  it('sends a message and appends a mock agent response', async () => {
    const user = userEvent.setup();
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: scrollTo
    });
    renderAt('/workspaces/w_core/chat');

    const composer = await screen.findByRole('textbox', { name: 'Message brainx' });
    await user.type(composer, 'Draft a client binding flow');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    const stream = await screen.findByRole('log', { name: 'Agent loop timeline' });
    expect(within(stream).getByText('Draft a client binding flow')).toBeInTheDocument();
    expect(await within(stream).findByText(/Queued for frontend-main on mainline/)).toBeInTheDocument();
    expect(composer).toHaveValue('');
    expect(scrollTo).toHaveBeenCalled();
  });

  it('offers shell-only slash commands and supports keyboard selection', async () => {
    const user = userEvent.setup();
    renderAt('/workspaces/w_core/chat');

    const composer = await screen.findByRole('textbox', { name: 'Message brainx' });
    await user.type(composer, '/');

    const listbox = screen.getByRole('listbox', { name: 'Chat commands' });
    expect(within(listbox).getByRole('option', { name: /新建会话/ })).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: /切换模型/ })).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: /切换会话/ })).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: /克隆会话/ })).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: /初始化项目/ })).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: /切换工作目录/ })).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: /压缩上下文/ })).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: /清空上下文/ })).toBeInTheDocument();
    expect(within(listbox).queryByText('/new')).not.toBeInTheDocument();

    await user.clear(composer);
    await user.type(composer, '/新建');
    expect(screen.getByRole('option', { name: /新建会话/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /切换模型/ })).not.toBeInTheDocument();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(composer).toHaveValue(''));
    expect(screen.queryByRole('listbox', { name: 'Chat commands' })).not.toBeInTheDocument();
  });

  it('opens attachment actions before invoking the native file picker', async () => {
    const user = userEvent.setup();
    renderAt('/workspaces/w_core/chat');

    await screen.findByRole('textbox', { name: 'Message brainx' });
    await user.click(screen.getByRole('button', { name: 'Attach files' }));

    const menu = screen.getByRole('menu', { name: 'Attachment actions' });
    expect(within(menu).getByRole('menuitem', { name: /添加照片和文件 从电脑上传/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /新建会话/ })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: /切换模型/ })).not.toBeInTheDocument();
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(2);
  });

  it('renders thinking and queued user inputs in the timeline shell', async () => {
    const user = userEvent.setup();
    renderAt('/workspaces/w_core/chat');

    const stream = await openBrowserWorkbenchRun(user);

    expect(within(stream).getByText('Thinking')).toBeInTheDocument();
    expect(within(stream).getByText(/Need to inspect current UI structure/)).toBeInTheDocument();
    expect(within(stream).getByText('Queued')).toBeInTheDocument();
    expect(within(stream).getByText('插话：继续测试附件')).toBeInTheDocument();
  });

  it('shows multiple attachment cards, supports removal, and clears them after send', async () => {
    const user = userEvent.setup();
    renderAt('/workspaces/w_core/chat');

    const textFile = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const imageFile = new File(['png'], 'screen.png', { type: 'image/png' });
    await user.upload(await screen.findByLabelText('Native file picker'), [textFile, imageFile]);

    const attachments = screen.getByLabelText('Attached files');
    expect(within(attachments).getByText('notes.txt')).toBeInTheDocument();
    expect(within(attachments).getByText('screen.png')).toBeInTheDocument();

    await user.click(within(attachments).getByRole('button', { name: 'Remove notes.txt' }));
    expect(within(attachments).queryByText('notes.txt')).not.toBeInTheDocument();
    expect(within(attachments).getByText('screen.png')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Message brainx' }), 'Use this image');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(screen.queryByLabelText('Attached files')).not.toBeInTheDocument());
  });

  it('classifies diff rows, drains stream text, and sanitizes provider errors', () => {
    expect(diffLineKind('+++ b/apps/browser/src/pages/ChatPage.tsx')).toBe('meta');
    expect(diffLineKind('--- a/apps/browser/src/pages/ChatPage.tsx')).toBe('meta');
    expect(diffLineKind('@@ -1,2 +1,3 @@')).toBe('hunk');
    expect(diffLineKind('+added line')).toBe('add');
    expect(diffLineKind('-removed line')).toBe('remove');
    expect(diffLineKind(' unchanged line')).toBe('context');

    expect(takeTypewriterSlice('abcdef', 3)).toEqual({ visible: 'abc', rest: 'def' });
    expect(takeTypewriterSlice('ok', 6)).toEqual({ visible: 'ok', rest: '' });
    expect(takeTypewriterSlice('thinking-stream', 4)).toEqual({ visible: 'thin', rest: 'king-stream' });
    expect(sanitizeChatError('model.invoke failed: model provider returned HTTP 429: {"status":429,"title":"Too Many Requests"}')).toBe(
      'HTTP 429: Too Many Requests'
    );
  });

  it('only treats active or online clients as usable chat targets', () => {
    expect(isUsableChatClient({ status: 'active' })).toBe(true);
    expect(isUsableChatClient({ status: 'online' })).toBe(true);
    expect(isUsableChatClient({ status: 'revoked' })).toBe(false);
    expect(isUsableChatClient({ status: 'offline' })).toBe(false);
    expect(isUsableChatClient({ status: 'stale' })).toBe(false);
  });
});
