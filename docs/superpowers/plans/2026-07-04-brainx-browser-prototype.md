# brainx Browser Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first runnable brainx B-side React/TypeScript prototype with the approved design system, mock REST/WebSocket data, core workbench pages, interaction states, loading states, route transitions, and light/dark themes.

**Architecture:** Create a new `apps/browser` Vite app. Keep domain models and mock services separate from UI components, use React Router for route shape, and build reusable workbench components before page composition. B talks only to mock S-side contracts in this milestone; no direct C-side, model, shell, or local API access is added.

**Tech Stack:** React 19, TypeScript, Vite, React Router, Vitest, Testing Library, jsdom, lucide-react, CSS variables.

---

## File Structure

- Create `apps/browser/package.json`: B-side package scripts and dependencies.
- Create `apps/browser/index.html`: Vite HTML entry.
- Create `apps/browser/vite.config.ts`: Vite + Vitest config.
- Create `apps/browser/tsconfig.json`, `apps/browser/tsconfig.node.json`: TypeScript settings.
- Create `apps/browser/src/main.tsx`: React root mount.
- Create `apps/browser/src/App.tsx`: router and providers.
- Create `apps/browser/src/test/setup.ts`: Testing Library setup.
- Create `apps/browser/src/domain/types.ts`: UI-facing domain types derived from the B/S/C specs.
- Create `apps/browser/src/data/mockData.ts`: deterministic mock workspace, runs, approvals, branches, skills, daemons, events.
- Create `apps/browser/src/services/mockApi.ts`: promise-based mock REST reads and write intents.
- Create `apps/browser/src/services/mockEvents.ts`: mock WebSocket event stream.
- Create `apps/browser/src/styles/tokens.css`: theme tokens, gradients, motion tokens.
- Create `apps/browser/src/styles/global.css`: reset, base typography, layout behavior.
- Create `apps/browser/src/components/*`: reusable design-system components.
- Create `apps/browser/src/pages/*`: Dashboard, Run Detail, Approvals, Branches, Skill Review, Daemons.
- Create `apps/browser/src/state/*`: theme preference, route transition helpers, live event subscription.
- Create `apps/browser/src/__tests__/*`: focused tests for routing, mock services, theme, loading, approval interactions.
- Modify `docs/brainx/README.md`: add browser prototype commands after the app exists.

Current workspace has an invalid `.git` directory. If `git status` fails during implementation, skip commit steps and report that commits could not be created in this workspace.

---

### Task 1: Browser App Scaffold

**Files:**
- Create: `apps/browser/package.json`
- Create: `apps/browser/index.html`
- Create: `apps/browser/vite.config.ts`
- Create: `apps/browser/tsconfig.json`
- Create: `apps/browser/tsconfig.node.json`
- Create: `apps/browser/src/main.tsx`
- Create: `apps/browser/src/App.tsx`
- Create: `apps/browser/src/test/setup.ts`

- [ ] **Step 1: Create package manifest**

Create `apps/browser/package.json`:

```json
{
  "name": "@brainx/browser",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "build": "tsc -b && vite build",
    "preview": "vite preview --host 127.0.0.1",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b"
  },
  "dependencies": {
    "@vitejs/plugin-react": "^5.0.0",
    "lucide-react": "^0.468.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.0.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.0",
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "jsdom": "^25.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:

```bash
cd apps/browser
npm install
```

Expected: `node_modules/` and `package-lock.json` are created. If network access is blocked, rerun with the required approval flow and keep the same command.

- [ ] **Step 3: Create Vite and TypeScript config**

Create `apps/browser/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>brainx</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `apps/browser/vite.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: true
  }
});
```

Create `apps/browser/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

Create `apps/browser/tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4: Create initial React entry**

Create `apps/browser/src/main.tsx`:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

Create `apps/browser/src/App.tsx`:

```tsx
export function App() {
  return <main>brainx browser prototype</main>;
}
```

Create `apps/browser/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 5: Verify scaffold**

Run:

```bash
cd apps/browser
npm run typecheck
npm run build
```

Expected: typecheck and build pass.

- [ ] **Step 6: Commit scaffold if git is valid**

Run:

```bash
git status
```

Expected in this workspace: failure because `.git` is invalid. If working in a valid git repository, run:

```bash
git add apps/browser
git commit -m "Add browser app scaffold"
```

---

### Task 2: Design Tokens, Themes, and Global Styles

**Files:**
- Create: `apps/browser/src/styles/tokens.css`
- Create: `apps/browser/src/styles/global.css`
- Create: `apps/browser/src/state/theme.tsx`
- Create: `apps/browser/src/__tests__/theme.test.tsx`
- Modify: `apps/browser/src/App.tsx`

- [ ] **Step 1: Write failing theme test**

Create `apps/browser/src/__tests__/theme.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';

describe('theme support', () => {
  it('switches between dark and light themes without changing app content', async () => {
    window.localStorage.removeItem('brainx.theme');
    render(<App />);

    expect(document.documentElement.dataset.theme).toBe('dark');
    const originalText = document.body.textContent;
    expect(originalText).toContain('brainx');

    await userEvent.click(screen.getByRole('button', { name: /light theme/i }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.body.textContent).toBe(originalText);

    await userEvent.click(screen.getByRole('button', { name: /dark theme/i }));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
cd apps/browser
npm test -- theme.test.tsx
```

Expected: FAIL because theme buttons and provider do not exist.

- [ ] **Step 3: Add theme state**

Create `apps/browser/src/state/theme.tsx`:

```tsx
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

type Theme = 'dark' | 'light';

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = window.localStorage.getItem('brainx.theme');
    return stored === 'light' ? 'light' : 'dark';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('brainx.theme', theme);
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      setTheme: setThemeState
    }),
    [theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }
  return value;
}
```

- [ ] **Step 4: Add tokens and global styles**

Create `apps/browser/src/styles/tokens.css`:

```css
:root {
  color-scheme: dark;
  --color-bg-canvas: #0f1217;
  --color-bg-surface: rgba(21, 26, 33, 0.88);
  --color-bg-elevated: rgba(27, 34, 43, 0.94);
  --color-bg-soft: rgba(255, 255, 255, 0.045);
  --color-border-subtle: rgba(255, 255, 255, 0.09);
  --color-border-strong: rgba(255, 255, 255, 0.16);
  --color-text-primary: #eef2f8;
  --color-text-secondary: #9aa6b8;
  --color-text-muted: #6f7b8d;
  --color-state-info: #5bd7f1;
  --color-state-success: #70e7b6;
  --color-state-warning: #f0bb61;
  --color-state-danger: #ff7a8a;
  --color-state-branch: #9a8cff;
  --shadow-panel: 0 24px 70px rgba(0, 0, 0, 0.34);
  --shadow-soft: 0 12px 30px rgba(0, 0, 0, 0.18);
  --radius-card: 8px;
  --radius-panel: 10px;
  --radius-shell: 18px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --motion-duration-fast: 160ms;
  --motion-duration-normal: 220ms;
  --motion-ease-standard: cubic-bezier(0.2, 0.8, 0.2, 1);
  --background-canvas-gradient:
    linear-gradient(118deg, rgba(91, 215, 241, 0.11) 0%, transparent 31%),
    linear-gradient(32deg, transparent 6%, rgba(154, 140, 255, 0.10) 52%, transparent 88%),
    linear-gradient(168deg, rgba(112, 231, 182, 0.08) 0%, transparent 42%),
    linear-gradient(180deg, #101319 0%, #11161d 46%, #15151d 100%);
}

:root[data-theme='light'] {
  color-scheme: light;
  --color-bg-canvas: #f4f7fb;
  --color-bg-surface: rgba(255, 255, 255, 0.84);
  --color-bg-elevated: rgba(247, 250, 253, 0.94);
  --color-bg-soft: rgba(18, 32, 48, 0.045);
  --color-border-subtle: rgba(20, 32, 48, 0.10);
  --color-border-strong: rgba(20, 32, 48, 0.16);
  --color-text-primary: #17202c;
  --color-text-secondary: #526070;
  --color-text-muted: #7c8998;
  --color-state-info: #168cab;
  --color-state-success: #168a66;
  --color-state-warning: #a56a14;
  --color-state-danger: #c6455d;
  --color-state-branch: #675bd6;
  --shadow-panel: 0 24px 70px rgba(25, 42, 64, 0.16);
  --shadow-soft: 0 12px 30px rgba(25, 42, 64, 0.11);
  --background-canvas-gradient:
    linear-gradient(118deg, rgba(91, 215, 241, 0.16) 0%, transparent 34%),
    linear-gradient(31deg, transparent 4%, rgba(154, 140, 255, 0.13) 51%, transparent 90%),
    linear-gradient(165deg, rgba(112, 231, 182, 0.12) 0%, transparent 45%),
    linear-gradient(180deg, #f7fbff 0%, #f2f6fb 48%, #eef3f8 100%);
}
```

Create `apps/browser/src/styles/global.css`:

```css
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
  background: var(--background-canvas-gradient);
  color: var(--color-text-primary);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  letter-spacing: 0;
}

button,
input,
textarea,
select {
  font: inherit;
}

button {
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
}

code,
pre {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

#root {
  min-height: 100vh;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.001ms !important;
  }
}
```

- [ ] **Step 5: Wire provider and theme controls**

Replace `apps/browser/src/App.tsx`:

```tsx
import { ThemeProvider, useTheme } from './state/theme';

function ThemeControls() {
  const { theme, setTheme } = useTheme();
  return (
    <div aria-label="Theme controls">
      <button aria-label="Dark theme" disabled={theme === 'dark'} onClick={() => setTheme('dark')}>
        Dark
      </button>
      <button aria-label="Light theme" disabled={theme === 'light'} onClick={() => setTheme('light')}>
        Light
      </button>
    </div>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <ThemeControls />
      <main>brainx browser prototype</main>
    </ThemeProvider>
  );
}
```

Replace `apps/browser/src/main.tsx`:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles/tokens.css';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 6: Verify theme support**

Run:

```bash
cd apps/browser
npm test -- theme.test.tsx
npm run typecheck
```

Expected: test and typecheck pass.

- [ ] **Step 7: Commit if git is valid**

Run:

```bash
git status
```

If valid:

```bash
git add apps/browser/src apps/browser/package.json
git commit -m "Add browser theme tokens"
```

---

### Task 3: Domain Types, Mock Data, and Mock API

**Files:**
- Create: `apps/browser/src/domain/types.ts`
- Create: `apps/browser/src/data/mockData.ts`
- Create: `apps/browser/src/services/mockApi.ts`
- Create: `apps/browser/src/services/mockEvents.ts`
- Create: `apps/browser/src/__tests__/mockApi.test.ts`

- [ ] **Step 1: Write failing mock API tests**

Create `apps/browser/src/__tests__/mockApi.test.ts`:

```ts
import { getDashboard, decideApproval, getRunDetail } from '../services/mockApi';

describe('mock API', () => {
  it('returns dashboard data with active runs and approvals', async () => {
    const dashboard = await getDashboard('w_core');
    expect(dashboard.workspace.id).toBe('w_core');
    expect(dashboard.activeRuns.length).toBeGreaterThan(0);
    expect(dashboard.pendingApprovals.some((approval) => approval.riskTier === 'publish')).toBe(true);
  });

  it('updates approval state through decideApproval', async () => {
    const approval = await decideApproval('ap_publish_skill', 'approved', 'Reviewed scope and evidence');
    expect(approval.status).toBe('approved');
    expect(approval.decisionReason).toBe('Reviewed scope and evidence');
  });

  it('returns run detail with ordered events', async () => {
    const run = await getRunDetail('run_8f3a');
    expect(run.events[0].sequence).toBeLessThan(run.events[run.events.length - 1].sequence);
  });
});
```

- [ ] **Step 2: Run failing mock API tests**

Run:

```bash
cd apps/browser
npm test -- mockApi.test.ts
```

Expected: FAIL because mock service files do not exist.

- [ ] **Step 3: Add domain types**

Create `apps/browser/src/domain/types.ts`:

```ts
export type RunStatus =
  | 'queued'
  | 'planning'
  | 'waiting_for_client'
  | 'running'
  | 'waiting_for_approval'
  | 'summarizing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'client_offline';

export type RiskTier = 'read' | 'write' | 'execute' | 'network' | 'publish' | 'secret';
export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled';
export type BranchStatus = 'active' | 'paused' | 'adopted' | 'archived';
export type SkillDraftStatus = 'draft' | 'review_requested' | 'approved' | 'published' | 'rejected';

export type Workspace = {
  id: string;
  name: string;
};

export type AgentRunSummary = {
  id: string;
  agentId: string;
  agentName: string;
  branchName: string;
  status: RunStatus;
  updatedAt: string;
};

export type ApprovalRequest = {
  id: string;
  title: string;
  actionSummary: string;
  riskTier: RiskTier;
  status: ApprovalStatus;
  sourceRunId: string;
  branchName: string;
  expiresInMinutes: number;
  decisionReason?: string;
};

export type ExecutionEvent = {
  id: string;
  type: string;
  sequence: number;
  occurredAt: string;
  message: string;
  riskTier?: RiskTier;
};

export type AgentRunDetail = AgentRunSummary & {
  events: ExecutionEvent[];
  output: string[];
  artifacts: string[];
};

export type AgentBranch = {
  id: string;
  name: string;
  status: BranchStatus;
  sourceAgent: string;
  pendingApprovals: number;
  adoptionReady: boolean;
};

export type SkillDraft = {
  id: string;
  name: string;
  status: SkillDraftStatus;
  sourceLearningRun: string;
  versionPreview: string;
  riskSummary: string;
};

export type ClientDaemon = {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'stale';
  version: string;
  activeTasks: number;
  lastHeartbeatSeconds: number;
};

export type DashboardData = {
  workspace: Workspace;
  activeRuns: AgentRunSummary[];
  pendingApprovals: ApprovalRequest[];
  branches: AgentBranch[];
  skillDrafts: SkillDraft[];
  daemons: ClientDaemon[];
  recentEvents: ExecutionEvent[];
};
```

- [ ] **Step 4: Add deterministic mock data**

Create `apps/browser/src/data/mockData.ts`:

```ts
import type {
  AgentBranch,
  AgentRunDetail,
  ApprovalRequest,
  ClientDaemon,
  DashboardData,
  ExecutionEvent,
  SkillDraft,
  Workspace
} from '../domain/types';

export const workspace: Workspace = {
  id: 'w_core',
  name: 'workspace-core'
};

export const events: ExecutionEvent[] = [
  {
    id: 'evt_001',
    type: 'agent.run.updated',
    sequence: 1,
    occurredAt: '2026-07-04T10:41:20Z',
    message: 'Planning branch adoption scope'
  },
  {
    id: 'evt_002',
    type: 'execution.requested',
    sequence: 2,
    occurredAt: '2026-07-04T10:42:03Z',
    message: 'Requested frontend verification through client daemon',
    riskTier: 'execute'
  },
  {
    id: 'evt_003',
    type: 'approval.requested',
    sequence: 3,
    occurredAt: '2026-07-04T10:43:16Z',
    message: 'Write patch to browser app shell requires approval',
    riskTier: 'write'
  },
  {
    id: 'evt_004',
    type: 'skill.draft.created',
    sequence: 4,
    occurredAt: '2026-07-04T10:44:02Z',
    message: 'Learning run created a reusable workflow skill draft',
    riskTier: 'publish'
  }
];

export const activeRuns: AgentRunDetail[] = [
  {
    id: 'run_8f3a',
    agentId: 'agent_frontend',
    agentName: 'frontend-main',
    branchName: 'mainline',
    status: 'waiting_for_approval',
    updatedAt: '2026-07-04T10:44:02Z',
    events,
    output: [
      'Collected route contracts from S-side mock API',
      'Prepared diff summary for approval review',
      'execution.output sequence=148 stream=run_8f3a',
      'Waiting for write approval before applying browser shell patch'
    ],
    artifacts: ['browser shell patch', 'design token map', 'approval evidence summary']
  }
];

export const approvals: ApprovalRequest[] = [
  {
    id: 'ap_publish_skill',
    title: 'Publish skill version',
    actionSummary: 'Create immutable SkillVersion from LearningRun #42',
    riskTier: 'publish',
    status: 'pending',
    sourceRunId: 'run_8f3a',
    branchName: 'mainline',
    expiresInMinutes: 2
  },
  {
    id: 'ap_execute_build',
    title: 'Execute build command',
    actionSummary: 'Run npm build through the Rust client daemon',
    riskTier: 'execute',
    status: 'pending',
    sourceRunId: 'run_8f3a',
    branchName: 'mainline',
    expiresInMinutes: 8
  },
  {
    id: 'ap_adopt_branch',
    title: 'Adopt branch artifact',
    actionSummary: 'Selectively adopt browser motion prototype output',
    riskTier: 'publish',
    status: 'pending',
    sourceRunId: 'run_8f3a',
    branchName: 'motion-v2',
    expiresInMinutes: 11
  }
];

export const branches: AgentBranch[] = [
  {
    id: 'br_motion',
    name: 'motion-v2',
    status: 'active',
    sourceAgent: 'frontend-main',
    pendingApprovals: 1,
    adoptionReady: true
  },
  {
    id: 'br_skill_review',
    name: 'skill-review-flow',
    status: 'paused',
    sourceAgent: 'frontend-main',
    pendingApprovals: 0,
    adoptionReady: false
  }
];

export const skillDrafts: SkillDraft[] = [
  {
    id: 'sd_motion',
    name: 'browser-motion-review',
    status: 'review_requested',
    sourceLearningRun: 'lr_42',
    versionPreview: 'v0.4 -> v0.5',
    riskSummary: 'Scope unchanged; adds loading and route transition guidance'
  }
];

export const daemons: ClientDaemon[] = [
  {
    id: 'cd_local',
    name: 'rust-daemon',
    status: 'online',
    version: '0.1.0',
    activeTasks: 1,
    lastHeartbeatSeconds: 8
  }
];

export function createDashboardData(): DashboardData {
  return {
    workspace,
    activeRuns,
    pendingApprovals: approvals.filter((approval) => approval.status === 'pending'),
    branches,
    skillDrafts,
    daemons,
    recentEvents: events
  };
}
```

- [ ] **Step 5: Add mock API and event stream**

Create `apps/browser/src/services/mockApi.ts`:

```ts
import { activeRuns, approvals, createDashboardData } from '../data/mockData';
import type { ApprovalRequest, ApprovalStatus, DashboardData, AgentRunDetail } from '../domain/types';

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export async function getDashboard(workspaceId: string): Promise<DashboardData> {
  await delay(120);
  const dashboard = createDashboardData();
  if (dashboard.workspace.id !== workspaceId) {
    throw new Error(`Workspace ${workspaceId} was not found`);
  }
  return dashboard;
}

export async function getRunDetail(runId: string): Promise<AgentRunDetail> {
  await delay(120);
  const run = activeRuns.find((candidate) => candidate.id === runId);
  if (!run) {
    throw new Error(`Run ${runId} was not found`);
  }
  return {
    ...run,
    events: [...run.events].sort((a, b) => a.sequence - b.sequence)
  };
}

export async function decideApproval(
  approvalId: string,
  decision: Extract<ApprovalStatus, 'approved' | 'denied'>,
  decisionReason: string
): Promise<ApprovalRequest> {
  await delay(180);
  const approval = approvals.find((candidate) => candidate.id === approvalId);
  if (!approval) {
    throw new Error(`Approval ${approvalId} was not found`);
  }
  approval.status = decision;
  approval.decisionReason = decisionReason;
  return approval;
}
```

Create `apps/browser/src/services/mockEvents.ts`:

```ts
import { events } from '../data/mockData';
import type { ExecutionEvent } from '../domain/types';

export type MockEventSubscription = {
  unsubscribe: () => void;
};

export function subscribeToWorkspaceEvents(
  onEvent: (event: ExecutionEvent) => void,
  intervalMs = 1800
): MockEventSubscription {
  let index = 0;
  const timer = window.setInterval(() => {
    onEvent(events[index % events.length]);
    index += 1;
  }, intervalMs);

  return {
    unsubscribe: () => window.clearInterval(timer)
  };
}
```

- [ ] **Step 6: Verify mock services**

Run:

```bash
cd apps/browser
npm test -- mockApi.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

---

### Task 4: App Shell, Routing, and Route Transitions

**Files:**
- Create: `apps/browser/src/components/AppShell.tsx`
- Create: `apps/browser/src/components/AppShell.css`
- Create: `apps/browser/src/components/ThemeSwitch.tsx`
- Create: `apps/browser/src/pages/DashboardPage.tsx`
- Create: `apps/browser/src/pages/RunDetailPage.tsx`
- Modify: `apps/browser/src/App.tsx`
- Create: `apps/browser/src/__tests__/routing.test.tsx`

- [ ] **Step 1: Write routing test**

Create `apps/browser/src/__tests__/routing.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
import { ThemeProvider } from '../state/theme';

describe('browser routing', () => {
  it('renders the dashboard route', async () => {
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/workspaces/w_core']}>
          <AppRoutes />
        </MemoryRouter>
      </ThemeProvider>
    );
    expect(await screen.findByRole('heading', { name: /workspace dashboard/i })).toBeInTheDocument();
  });

  it('renders the run detail route', async () => {
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/workspaces/w_core/agents/agent_frontend/runs/run_8f3a']}>
          <AppRoutes />
        </MemoryRouter>
      </ThemeProvider>
    );
    expect(await screen.findByRole('heading', { name: /agent run detail/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run failing routing test**

Run:

```bash
cd apps/browser
npm test -- routing.test.tsx
```

Expected: FAIL because `AppRoutes` and pages do not exist.

- [ ] **Step 3: Add shell components**

Create `apps/browser/src/components/ThemeSwitch.tsx`:

```tsx
import { useTheme } from '../state/theme';

export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="theme-switch" aria-label="Theme controls">
      <button
        className={theme === 'dark' ? 'active' : ''}
        aria-label="Dark theme"
        disabled={theme === 'dark'}
        onClick={() => setTheme('dark')}
      >
        Dark
      </button>
      <button
        className={theme === 'light' ? 'active' : ''}
        aria-label="Light theme"
        disabled={theme === 'light'}
        onClick={() => setTheme('light')}
      >
        Light
      </button>
    </div>
  );
}
```

Create `apps/browser/src/components/AppShell.tsx`:

```tsx
import { Activity, Bot, GitBranch, KeyRound, LayoutDashboard, Settings, Sparkles } from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { ThemeSwitch } from './ThemeSwitch';
import './AppShell.css';

const workspaceId = 'w_core';

const navItems = [
  { to: `/workspaces/${workspaceId}`, label: 'Dashboard', icon: LayoutDashboard },
  { to: `/workspaces/${workspaceId}/agents`, label: 'Agents', icon: Bot },
  { to: `/workspaces/${workspaceId}/branches`, label: 'Branches', icon: GitBranch },
  { to: `/workspaces/${workspaceId}/approvals`, label: 'Approvals', icon: KeyRound },
  { to: `/workspaces/${workspaceId}/skill-drafts/sd_motion/review`, label: 'Skills', icon: Sparkles },
  { to: `/workspaces/${workspaceId}/client-daemons`, label: 'Daemons', icon: Activity },
  { to: `/workspaces/${workspaceId}/settings`, label: 'Settings', icon: Settings }
];

export function AppShell() {
  const location = useLocation();
  return (
    <div className="app-shell">
      <aside className="primary-nav" aria-label="Primary navigation">
        <div className="brand-mark">bx</div>
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink key={item.to} to={item.to} className="nav-item" title={item.label}>
              <Icon aria-hidden="true" size={18} />
              <span className="sr-only">{item.label}</span>
            </NavLink>
          );
        })}
      </aside>
      <section className="shell-region">
        <header className="top-bar">
          <div>
            <div className="breadcrumb">brainx / workspace-core</div>
            <div className="route-path">{location.pathname}</div>
          </div>
          <div className="top-actions">
            <div className="connection-state"><span /> WebSocket connected</div>
            <ThemeSwitch />
          </div>
        </header>
        <main className="content-region" key={location.pathname}>
          <Outlet />
        </main>
      </section>
    </div>
  );
}
```

Create `apps/browser/src/components/AppShell.css`:

```css
.app-shell {
  display: grid;
  grid-template-columns: 68px minmax(0, 1fr);
  width: min(1500px, calc(100vw - 40px));
  min-height: calc(100vh - 40px);
  margin: 20px auto;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-shell);
  background: var(--color-bg-surface);
  box-shadow: var(--shadow-panel);
  overflow: hidden;
  backdrop-filter: blur(20px) saturate(1.08);
}

.primary-nav {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  align-items: center;
  padding: var(--space-3) var(--space-2);
  border-right: 1px solid var(--color-border-subtle);
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  margin-bottom: var(--space-2);
  border-radius: 12px;
  color: #061014;
  font-size: 12px;
  font-weight: 800;
  background: conic-gradient(from 160deg, var(--color-state-success), var(--color-state-info), var(--color-state-branch), var(--color-state-success));
}

.nav-item {
  display: grid;
  place-items: center;
  width: 42px;
  height: 38px;
  border-radius: var(--radius-panel);
  color: var(--color-text-muted);
  text-decoration: none;
}

.nav-item.active {
  color: var(--color-state-info);
  background: color-mix(in srgb, var(--color-state-info) 14%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-state-info) 24%, transparent);
}

.shell-region {
  display: grid;
  grid-template-rows: 56px 1fr;
  min-width: 0;
}

.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: 0 var(--space-4);
  border-bottom: 1px solid var(--color-border-subtle);
}

.breadcrumb {
  color: var(--color-text-primary);
  font-size: 13px;
}

.route-path {
  margin-top: 2px;
  color: var(--color-text-muted);
  font-size: 11px;
}

.top-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.connection-state {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--color-text-secondary);
  font-size: 12px;
}

.connection-state span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-state-success);
  box-shadow: 0 0 18px color-mix(in srgb, var(--color-state-success) 70%, transparent);
  animation: pulse 1.9s ease-in-out infinite;
}

.theme-switch {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 12px;
  background: var(--color-bg-soft);
}

.theme-switch button {
  height: 28px;
  min-width: 56px;
  border: 0;
  border-radius: var(--radius-card);
  background: transparent;
  color: var(--color-text-secondary);
}

.theme-switch button.active {
  color: var(--color-text-primary);
  background: var(--color-bg-soft);
  box-shadow: inset 0 0 0 1px var(--color-border-subtle);
}

.content-region {
  min-width: 0;
  padding: var(--space-4);
  animation: route-in var(--motion-duration-normal) var(--motion-ease-standard);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@keyframes pulse {
  0%, 100% { transform: scale(0.85); opacity: 0.74; }
  50% { transform: scale(1.25); opacity: 1; }
}

@keyframes route-in {
  from { opacity: 0; transform: translateY(8px); filter: blur(2px); }
  to { opacity: 1; transform: translateY(0); filter: blur(0); }
}
```

- [ ] **Step 4: Add minimal pages and routes**

Create `apps/browser/src/pages/DashboardPage.tsx`:

```tsx
export function DashboardPage() {
  return (
    <section>
      <h1>Workspace Dashboard</h1>
      <p>Live agent runs, approvals, branches, skill drafts, and daemon health.</p>
    </section>
  );
}
```

Create `apps/browser/src/pages/RunDetailPage.tsx`:

```tsx
export function RunDetailPage() {
  return (
    <section>
      <h1>Agent Run Detail</h1>
      <p>Timeline, streaming output, approval evidence, and execution state.</p>
    </section>
  );
}
```

Replace `apps/browser/src/App.tsx`:

```tsx
import { Navigate, Route, Routes } from 'react-router-dom';
import { BrowserRouter } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { RunDetailPage } from './pages/RunDetailPage';
import { ThemeProvider } from './state/theme';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/workspaces/:workspaceId" element={<DashboardPage />} />
        <Route path="/workspaces/:workspaceId/agents/:agentId/runs/:runId" element={<RunDetailPage />} />
        <Route path="*" element={<Navigate to="/workspaces/w_core" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ThemeProvider>
  );
}
```

- [ ] **Step 5: Verify routing**

Run:

```bash
cd apps/browser
npm test -- routing.test.tsx
npm run typecheck
```

Expected: tests and typecheck pass.

---

### Task 5: Reusable Workbench Components

**Files:**
- Create: `apps/browser/src/components/workbench.tsx`
- Create: `apps/browser/src/components/workbench.css`
- Create: `apps/browser/src/__tests__/workbench.test.tsx`
- Modify: `apps/browser/src/main.tsx`

- [ ] **Step 1: Write component tests**

Create `apps/browser/src/__tests__/workbench.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { ApprovalCard, EventTimeline, LogStream, MetricCard, RiskTierBadge, StatusBadge } from '../components/workbench';
import { approvals, events } from '../data/mockData';

describe('workbench components', () => {
  it('renders semantic risk and status badges', () => {
    render(
      <>
        <StatusBadge status="waiting_for_approval" />
        <RiskTierBadge tier="publish" />
      </>
    );

    expect(screen.getByText('waiting_for_approval')).toBeInTheDocument();
    expect(screen.getByText('publish')).toBeInTheDocument();
  });

  it('renders timeline, logs, metric, and approval card', () => {
    render(
      <>
        <MetricCard label="Active runs" value="08" hint="3 running" />
        <EventTimeline events={events} />
        <LogStream lines={['execution.output sequence=148']} />
        <ApprovalCard approval={approvals[0]} />
      </>
    );

    expect(screen.getByText('Active runs')).toBeInTheDocument();
    expect(screen.getByText(/Planning branch adoption scope/)).toBeInTheDocument();
    expect(screen.getByText(/execution.output sequence=148/)).toBeInTheDocument();
    expect(screen.getByText('Publish skill version')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run failing component tests**

Run:

```bash
cd apps/browser
npm test -- workbench.test.tsx
```

Expected: FAIL because workbench components do not exist.

- [ ] **Step 3: Implement components**

Create `apps/browser/src/components/workbench.tsx`:

```tsx
import type { ReactNode } from 'react';
import type { AgentRunDetail, ApprovalRequest, ExecutionEvent, RiskTier, RunStatus } from '../domain/types';
import './workbench.css';

export function StatusBadge({ status }: { status: RunStatus | ApprovalRequest['status'] | string }) {
  return <span className="badge">{status}</span>;
}

export function RiskTierBadge({ tier }: { tier: RiskTier }) {
  return <span className={`badge risk-${tier}`}>{tier}</span>;
}

export function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <article className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-hint">{hint}</div>
    </article>
  );
}

export function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function EventTimeline({ events }: { events: ExecutionEvent[] }) {
  return (
    <div className="timeline">
      {events.map((event) => (
        <article className="timeline-event" key={event.id}>
          <span className="event-time">{new Date(event.occurredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <span className="event-message">{event.message}</span>
          {event.riskTier ? <RiskTierBadge tier={event.riskTier} /> : <StatusBadge status={event.type} />}
        </article>
      ))}
    </div>
  );
}

export function LogStream({ lines }: { lines: string[] }) {
  return (
    <pre className="log-stream" aria-label="Execution output">
      {lines.map((line, index) => (
        <code key={`${line}-${index}`}>{line}</code>
      ))}
    </pre>
  );
}

export function ApprovalCard({ approval, onOpen }: { approval: ApprovalRequest; onOpen?: (approval: ApprovalRequest) => void }) {
  return (
    <article className="approval-card">
      <span className={`risk-rail risk-${approval.riskTier}`} />
      <div>
        <h3>{approval.title}</h3>
        <p>{approval.actionSummary}</p>
        <div className="approval-meta">
          <RiskTierBadge tier={approval.riskTier} />
          <span>{approval.expiresInMinutes}m left</span>
        </div>
      </div>
      <button className="text-button" onClick={() => onOpen?.(approval)}>
        Review
      </button>
    </article>
  );
}

export function RunSummary({ run }: { run: AgentRunDetail }) {
  return (
    <article className="run-summary">
      <h3>{run.agentName}</h3>
      <p>{run.branchName}</p>
      <StatusBadge status={run.status} />
    </article>
  );
}
```

Create `apps/browser/src/components/workbench.css`:

```css
.badge {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 999px;
  background: var(--color-bg-soft);
  color: var(--color-text-secondary);
  font-size: 11px;
  white-space: nowrap;
}

.risk-read { color: var(--color-text-secondary); }
.risk-write { color: var(--color-state-warning); }
.risk-execute { color: var(--color-state-warning); }
.risk-network { color: var(--color-state-info); }
.risk-publish { color: var(--color-state-danger); }
.risk-secret { color: var(--color-state-danger); }

.metric-card,
.panel,
.approval-card,
.run-summary {
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-panel);
  background: var(--color-bg-soft);
}

.metric-card {
  min-height: 92px;
  padding: var(--space-3);
  position: relative;
  overflow: hidden;
}

.metric-card::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--color-state-info), transparent);
  opacity: 0.72;
}

.metric-label {
  color: var(--color-text-muted);
  font-size: 11px;
  text-transform: uppercase;
}

.metric-value {
  margin-top: var(--space-2);
  color: var(--color-text-primary);
  font-size: 25px;
  font-weight: 760;
}

.metric-hint {
  margin-top: var(--space-1);
  color: var(--color-text-secondary);
  font-size: 11px;
}

.panel {
  padding: var(--space-3);
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.panel-head h2 {
  margin: 0;
  font-size: 13px;
}

.timeline {
  display: grid;
  gap: var(--space-2);
}

.timeline-event {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) auto;
  gap: var(--space-2);
  align-items: center;
  min-height: 44px;
  padding: var(--space-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-card);
  background: color-mix(in srgb, var(--color-bg-surface) 40%, transparent);
}

.event-time,
.event-message,
.approval-card p,
.run-summary p {
  color: var(--color-text-secondary);
  font-size: 12px;
}

.event-message {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-stream {
  display: grid;
  gap: 6px;
  min-height: 150px;
  margin: var(--space-3) 0 0;
  padding: var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-card);
  background: color-mix(in srgb, var(--color-bg-canvas) 72%, transparent);
  overflow: auto;
}

.log-stream code {
  color: var(--color-text-secondary);
  font-size: 11px;
}

.approval-card {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto;
  gap: var(--space-3);
  align-items: start;
  min-height: 76px;
  padding: var(--space-3);
}

.risk-rail {
  width: 8px;
  height: 40px;
  border-radius: 99px;
  background: var(--color-state-warning);
}

.risk-rail.risk-publish,
.risk-rail.risk-secret {
  background: var(--color-state-danger);
}

.approval-card h3,
.run-summary h3 {
  margin: 0 0 5px;
  color: var(--color-text-primary);
  font-size: 12px;
}

.approval-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-2);
  color: var(--color-text-muted);
  font-size: 11px;
}

.text-button {
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-card);
  background: var(--color-bg-soft);
  color: var(--color-text-primary);
  padding: 6px 10px;
  font-size: 12px;
}

.run-summary {
  padding: var(--space-3);
}
```

Modify `apps/browser/src/main.tsx` so `workbench.css` is loaded:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles/tokens.css';
import './styles/global.css';
import './components/workbench.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 4: Verify components**

Run:

```bash
cd apps/browser
npm test -- workbench.test.tsx
npm run typecheck
```

Expected: tests and typecheck pass.

---

### Task 6: Core Pages with Mock Data

**Files:**
- Modify: `apps/browser/src/pages/DashboardPage.tsx`
- Modify: `apps/browser/src/pages/RunDetailPage.tsx`
- Create: `apps/browser/src/pages/ApprovalsPage.tsx`
- Create: `apps/browser/src/pages/BranchesPage.tsx`
- Create: `apps/browser/src/pages/SkillReviewPage.tsx`
- Create: `apps/browser/src/pages/DaemonsPage.tsx`
- Create: `apps/browser/src/pages/pages.css`
- Modify: `apps/browser/src/App.tsx`
- Create: `apps/browser/src/__tests__/pages.test.tsx`

- [ ] **Step 1: Write page coverage tests**

Create `apps/browser/src/__tests__/pages.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
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

describe('core pages', () => {
  it('renders dashboard metrics', async () => {
    renderAt('/workspaces/w_core');
    expect(await screen.findByText('Active runs')).toBeInTheDocument();
    expect(await screen.findByText('Pending approvals')).toBeInTheDocument();
  });

  it('renders approvals queue', async () => {
    renderAt('/workspaces/w_core/approvals');
    expect(await screen.findByRole('heading', { name: /approvals/i })).toBeInTheDocument();
    expect(await screen.findByText('Publish skill version')).toBeInTheDocument();
  });

  it('renders daemon page without secret details', async () => {
    renderAt('/workspaces/w_core/client-daemons');
    expect(await screen.findByText('rust-daemon')).toBeInTheDocument();
    expect(screen.queryByText(/api key/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run failing page tests**

Run:

```bash
cd apps/browser
npm test -- pages.test.tsx
```

Expected: FAIL because most pages and route mappings do not exist.

- [ ] **Step 3: Implement page styles**

Create `apps/browser/src/pages/pages.css`:

```css
.page-stack {
  display: grid;
  gap: var(--space-3);
}

.page-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
}

.page-title-row h1 {
  margin: 0;
  color: var(--color-text-primary);
  font-size: 20px;
}

.page-title-row p {
  margin: 6px 0 0;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-3);
}

.work-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
  gap: var(--space-3);
}

.list-stack {
  display: grid;
  gap: var(--space-2);
}

.entity-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-panel);
  background: var(--color-bg-soft);
}

.entity-row h3 {
  margin: 0 0 4px;
  font-size: 13px;
}

.entity-row p {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 12px;
}

@media (max-width: 980px) {
  .metric-grid,
  .work-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 4: Implement pages**

Replace `apps/browser/src/pages/DashboardPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { ApprovalCard, EventTimeline, LogStream, MetricCard, Panel, RunSummary } from '../components/workbench';
import type { DashboardData } from '../domain/types';
import { getDashboard } from '../services/mockApi';
import './pages.css';

export function DashboardPage() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);

  useEffect(() => {
    void getDashboard('w_core').then(setDashboard);
  }, []);

  if (!dashboard) {
    return <section className="page-stack" aria-label="Loading dashboard">Loading workspace dashboard...</section>;
  }

  return (
    <section className="page-stack">
      <div className="page-title-row">
        <div>
          <h1>Workspace Dashboard</h1>
          <p>Live agent runs, approvals, branches, skill drafts, and daemon health.</p>
        </div>
      </div>
      <div className="metric-grid">
        <MetricCard label="Active runs" value={String(dashboard.activeRuns.length).padStart(2, '0')} hint="Runs requiring observation" />
        <MetricCard label="Pending approvals" value={String(dashboard.pendingApprovals.length).padStart(2, '0')} hint="Publish and execute risks" />
        <MetricCard label="Skill drafts" value={String(dashboard.skillDrafts.length).padStart(2, '0')} hint="Review requested" />
        <MetricCard label="Daemon health" value="OK" hint={`${dashboard.daemons[0].lastHeartbeatSeconds}s since heartbeat`} />
      </div>
      <div className="work-grid">
        <Panel title="Agent Run Timeline">
          <div className="list-stack">
            {dashboard.activeRuns.map((run) => <RunSummary key={run.id} run={run} />)}
          </div>
          <EventTimeline events={dashboard.recentEvents} />
          <LogStream lines={dashboard.activeRuns[0].output} />
        </Panel>
        <Panel title="Approval Queue">
          <div className="list-stack">
            {dashboard.pendingApprovals.map((approval) => <ApprovalCard key={approval.id} approval={approval} />)}
          </div>
        </Panel>
      </div>
    </section>
  );
}
```

Replace `apps/browser/src/pages/RunDetailPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { EventTimeline, LogStream, Panel, StatusBadge } from '../components/workbench';
import type { AgentRunDetail } from '../domain/types';
import { getRunDetail } from '../services/mockApi';
import './pages.css';

export function RunDetailPage() {
  const { runId = 'run_8f3a' } = useParams();
  const [run, setRun] = useState<AgentRunDetail | null>(null);

  useEffect(() => {
    void getRunDetail(runId).then(setRun);
  }, [runId]);

  if (!run) {
    return <section className="page-stack" aria-label="Loading run detail">Loading run detail...</section>;
  }

  return (
    <section className="page-stack">
      <div className="page-title-row">
        <div>
          <h1>Agent Run Detail</h1>
          <p>{run.agentName} on {run.branchName}</p>
        </div>
        <StatusBadge status={run.status} />
      </div>
      <div className="work-grid">
        <Panel title="Execution Timeline">
          <EventTimeline events={run.events} />
        </Panel>
        <Panel title="Live Output">
          <LogStream lines={run.output} />
        </Panel>
      </div>
    </section>
  );
}
```

Create `apps/browser/src/pages/ApprovalsPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { ApprovalCard, Panel } from '../components/workbench';
import type { DashboardData } from '../domain/types';
import { getDashboard } from '../services/mockApi';
import './pages.css';

export function ApprovalsPage() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);

  useEffect(() => {
    void getDashboard('w_core').then(setDashboard);
  }, []);

  return (
    <section className="page-stack">
      <div className="page-title-row">
        <div>
          <h1>Approvals</h1>
          <p>Review risk tier, impact, source run, and next execution step.</p>
        </div>
      </div>
      <Panel title="Pending approvals">
        <div className="list-stack">
          {(dashboard?.pendingApprovals ?? []).map((approval) => <ApprovalCard key={approval.id} approval={approval} />)}
        </div>
      </Panel>
    </section>
  );
}
```

Create `apps/browser/src/pages/BranchesPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { RiskTierBadge, StatusBadge } from '../components/workbench';
import type { DashboardData } from '../domain/types';
import { getDashboard } from '../services/mockApi';
import './pages.css';

export function BranchesPage() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);

  useEffect(() => {
    void getDashboard('w_core').then(setDashboard);
  }, []);

  return (
    <section className="page-stack">
      <div className="page-title-row">
        <div>
          <h1>Branches</h1>
          <p>Parallel exploration with selective adoption, not memory merge.</p>
        </div>
      </div>
      <div className="list-stack">
        {(dashboard?.branches ?? []).map((branch) => (
          <article className="entity-row" key={branch.id}>
            <div>
              <h3>{branch.name}</h3>
              <p>{branch.sourceAgent} · {branch.pendingApprovals} pending approvals</p>
            </div>
            <div className="list-stack">
              <StatusBadge status={branch.status} />
              {branch.adoptionReady ? <RiskTierBadge tier="publish" /> : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
```

Create `apps/browser/src/pages/SkillReviewPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { RiskTierBadge, StatusBadge } from '../components/workbench';
import type { DashboardData } from '../domain/types';
import { getDashboard } from '../services/mockApi';
import './pages.css';

export function SkillReviewPage() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);

  useEffect(() => {
    void getDashboard('w_core').then(setDashboard);
  }, []);

  const draft = dashboard?.skillDrafts[0];

  return (
    <section className="page-stack">
      <div className="page-title-row">
        <div>
          <h1>Skill Review</h1>
          <p>Review source evidence, scope changes, version preview, and publish risk.</p>
        </div>
      </div>
      {draft ? (
        <article className="entity-row">
          <div>
            <h3>{draft.name}</h3>
            <p>{draft.versionPreview} · {draft.riskSummary}</p>
          </div>
          <div className="list-stack">
            <StatusBadge status={draft.status} />
            <RiskTierBadge tier="publish" />
          </div>
        </article>
      ) : null}
    </section>
  );
}
```

Create `apps/browser/src/pages/DaemonsPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { StatusBadge } from '../components/workbench';
import type { DashboardData } from '../domain/types';
import { getDashboard } from '../services/mockApi';
import './pages.css';

export function DaemonsPage() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);

  useEffect(() => {
    void getDashboard('w_core').then(setDashboard);
  }, []);

  return (
    <section className="page-stack">
      <div className="page-title-row">
        <div>
          <h1>Client Daemons</h1>
          <p>Local capability, heartbeat, active tasks, and affected runs. Secrets stay local.</p>
        </div>
      </div>
      <div className="list-stack">
        {(dashboard?.daemons ?? []).map((daemon) => (
          <article className="entity-row" key={daemon.id}>
            <div>
              <h3>{daemon.name}</h3>
              <p>v{daemon.version} · {daemon.activeTasks} active task · heartbeat {daemon.lastHeartbeatSeconds}s ago</p>
            </div>
            <StatusBadge status={daemon.status} />
          </article>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Wire routes**

Modify `apps/browser/src/App.tsx`:

```tsx
import { Navigate, Route, Routes } from 'react-router-dom';
import { BrowserRouter } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { BranchesPage } from './pages/BranchesPage';
import { DashboardPage } from './pages/DashboardPage';
import { DaemonsPage } from './pages/DaemonsPage';
import { RunDetailPage } from './pages/RunDetailPage';
import { SkillReviewPage } from './pages/SkillReviewPage';
import { ThemeProvider } from './state/theme';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/workspaces/:workspaceId" element={<DashboardPage />} />
        <Route path="/workspaces/:workspaceId/approvals" element={<ApprovalsPage />} />
        <Route path="/workspaces/:workspaceId/branches" element={<BranchesPage />} />
        <Route path="/workspaces/:workspaceId/skill-drafts/:draftId/review" element={<SkillReviewPage />} />
        <Route path="/workspaces/:workspaceId/client-daemons" element={<DaemonsPage />} />
        <Route path="/workspaces/:workspaceId/agents/:agentId/runs/:runId" element={<RunDetailPage />} />
        <Route path="/workspaces/:workspaceId/agents" element={<DashboardPage />} />
        <Route path="/workspaces/:workspaceId/settings" element={<DashboardPage />} />
        <Route path="*" element={<Navigate to="/workspaces/w_core" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ThemeProvider>
  );
}
```

- [ ] **Step 6: Verify pages**

Run:

```bash
cd apps/browser
npm test -- pages.test.tsx routing.test.tsx
npm run typecheck
```

Expected: tests and typecheck pass.

---

### Task 7: Loading, Side Panel, Approval Interaction, and Live Events

**Files:**
- Create: `apps/browser/src/components/LoadingStates.tsx`
- Create: `apps/browser/src/components/LoadingStates.css`
- Create: `apps/browser/src/state/useWorkspaceEvents.ts`
- Modify: `apps/browser/src/pages/ApprovalsPage.tsx`
- Modify: `apps/browser/src/pages/DashboardPage.tsx`
- Create: `apps/browser/src/__tests__/interactions.test.tsx`

- [ ] **Step 1: Write interaction tests**

Create `apps/browser/src/__tests__/interactions.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
import { ThemeProvider } from '../state/theme';

describe('interaction states', () => {
  it('opens approval evidence in a side panel and submits a decision', async () => {
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/workspaces/w_core/approvals']}>
          <AppRoutes />
        </MemoryRouter>
      </ThemeProvider>
    );

    const reviewButtons = await screen.findAllByRole('button', { name: /review/i });
    await userEvent.click(reviewButtons[0]);
    expect(screen.getByRole('complementary', { name: /approval evidence/i })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/decision reason/i), 'Reviewed scope and evidence');
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => {
      expect(screen.getByText(/approved/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run failing interaction tests**

Run:

```bash
cd apps/browser
npm test -- interactions.test.tsx
```

Expected: FAIL because side panel interaction and decision form do not exist.

- [ ] **Step 3: Add loading states**

Create `apps/browser/src/components/LoadingStates.tsx`:

```tsx
import type { ReactNode } from 'react';

export function PageSkeleton({ label }: { label: string }) {
  return (
    <section className="page-skeleton" aria-label={label}>
      <div className="skeleton-title" />
      <div className="skeleton-grid">
        <div className="skeleton-card" />
        <div className="skeleton-card" />
        <div className="skeleton-card" />
        <div className="skeleton-card" />
      </div>
      <div className="skeleton-panels">
        <div className="skeleton-panel" />
        <div className="skeleton-panel" />
      </div>
    </section>
  );
}

export function PendingButton({ children, pending }: { children: ReactNode; pending: boolean }) {
  return (
    <button className={pending ? 'pending-button' : ''} disabled={pending}>
      {children}
    </button>
  );
}
```

Create `apps/browser/src/components/LoadingStates.css`:

```css
.page-skeleton {
  display: grid;
  gap: var(--space-3);
}

.skeleton-title,
.skeleton-card,
.skeleton-panel {
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-panel);
  background: color-mix(in srgb, var(--color-bg-surface) 55%, transparent);
}

.skeleton-title {
  width: 260px;
  height: 28px;
}

.skeleton-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-3);
}

.skeleton-card {
  height: 92px;
}

.skeleton-panels {
  display: grid;
  grid-template-columns: 1.15fr 0.85fr;
  gap: var(--space-3);
}

.skeleton-panel {
  min-height: 300px;
}

.skeleton-title::after,
.skeleton-card::after,
.skeleton-panel::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.12), transparent);
  transform: translateX(-100%);
  animation: skeleton-shimmer 1.7s ease-in-out infinite;
}

.pending-button {
  opacity: 0.78;
  pointer-events: none;
}

@keyframes skeleton-shimmer {
  to {
    transform: translateX(100%);
  }
}
```

Modify `apps/browser/src/main.tsx` to import loading styles:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles/tokens.css';
import './styles/global.css';
import './components/workbench.css';
import './components/LoadingStates.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 4: Add live events hook**

Create `apps/browser/src/state/useWorkspaceEvents.ts`:

```ts
import { useEffect, useState } from 'react';
import type { ExecutionEvent } from '../domain/types';
import { subscribeToWorkspaceEvents } from '../services/mockEvents';

export function useWorkspaceEvents() {
  const [latestEvent, setLatestEvent] = useState<ExecutionEvent | null>(null);

  useEffect(() => {
    const subscription = subscribeToWorkspaceEvents(setLatestEvent);
    return () => subscription.unsubscribe();
  }, []);

  return latestEvent;
}
```

- [ ] **Step 5: Add approval side panel**

Replace `apps/browser/src/pages/ApprovalsPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { ApprovalCard, Panel, RiskTierBadge, StatusBadge } from '../components/workbench';
import type { ApprovalRequest, DashboardData } from '../domain/types';
import { decideApproval, getDashboard } from '../services/mockApi';
import './pages.css';

export function ApprovalsPage() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [selected, setSelected] = useState<ApprovalRequest | null>(null);
  const [reason, setReason] = useState('');
  const [decided, setDecided] = useState<ApprovalRequest | null>(null);

  useEffect(() => {
    void getDashboard('w_core').then(setDashboard);
  }, []);

  async function approveSelected() {
    if (!selected) return;
    const result = await decideApproval(selected.id, 'approved', reason);
    setDecided(result);
  }

  return (
    <section className="page-stack">
      <div className="page-title-row">
        <div>
          <h1>Approvals</h1>
          <p>Review risk tier, impact, source run, and next execution step.</p>
        </div>
        {decided ? <StatusBadge status={decided.status} /> : null}
      </div>
      <div className="work-grid">
        <Panel title="Pending approvals">
          <div className="list-stack">
            {(dashboard?.pendingApprovals ?? []).map((approval) => (
              <ApprovalCard key={approval.id} approval={approval} onOpen={setSelected} />
            ))}
          </div>
        </Panel>
        {selected ? (
          <aside className="panel" aria-label="Approval evidence" role="complementary">
            <div className="panel-head">
              <h2>{selected.title}</h2>
              <RiskTierBadge tier={selected.riskTier} />
            </div>
            <p>{selected.actionSummary}</p>
            <label>
              Decision reason
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
            <button className="text-button" onClick={approveSelected} disabled={reason.trim().length < 6}>
              Approve
            </button>
          </aside>
        ) : (
          <aside className="panel" aria-label="Approval evidence" role="complementary">
            <h2>Select an approval</h2>
            <p>Evidence opens here without interrupting the queue.</p>
          </aside>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Show latest mock WebSocket event on Dashboard**

Modify `apps/browser/src/pages/DashboardPage.tsx` by importing `useWorkspaceEvents` and rendering `latestEvent` below the title:

```tsx
import { useEffect, useState } from 'react';
import { ApprovalCard, EventTimeline, LogStream, MetricCard, Panel, RunSummary } from '../components/workbench';
import type { DashboardData } from '../domain/types';
import { getDashboard } from '../services/mockApi';
import { useWorkspaceEvents } from '../state/useWorkspaceEvents';
import './pages.css';

export function DashboardPage() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const latestEvent = useWorkspaceEvents();

  useEffect(() => {
    void getDashboard('w_core').then(setDashboard);
  }, []);

  if (!dashboard) {
    return <section className="page-stack" aria-label="Loading dashboard">Loading workspace dashboard...</section>;
  }

  return (
    <section className="page-stack">
      <div className="page-title-row">
        <div>
          <h1>Workspace Dashboard</h1>
          <p>Live agent runs, approvals, branches, skill drafts, and daemon health.</p>
          {latestEvent ? <p>Latest event: {latestEvent.type}</p> : null}
        </div>
      </div>
      <div className="metric-grid">
        <MetricCard label="Active runs" value={String(dashboard.activeRuns.length).padStart(2, '0')} hint="Runs requiring observation" />
        <MetricCard label="Pending approvals" value={String(dashboard.pendingApprovals.length).padStart(2, '0')} hint="Publish and execute risks" />
        <MetricCard label="Skill drafts" value={String(dashboard.skillDrafts.length).padStart(2, '0')} hint="Review requested" />
        <MetricCard label="Daemon health" value="OK" hint={`${dashboard.daemons[0].lastHeartbeatSeconds}s since heartbeat`} />
      </div>
      <div className="work-grid">
        <Panel title="Agent Run Timeline">
          <div className="list-stack">
            {dashboard.activeRuns.map((run) => <RunSummary key={run.id} run={run} />)}
          </div>
          <EventTimeline events={dashboard.recentEvents} />
          <LogStream lines={dashboard.activeRuns[0].output} />
        </Panel>
        <Panel title="Approval Queue">
          <div className="list-stack">
            {dashboard.pendingApprovals.map((approval) => <ApprovalCard key={approval.id} approval={approval} />)}
          </div>
        </Panel>
      </div>
    </section>
  );
}
```

- [ ] **Step 7: Verify interactions**

Run:

```bash
cd apps/browser
npm test -- interactions.test.tsx pages.test.tsx
npm run typecheck
```

Expected: tests and typecheck pass.

---

### Task 8: Documentation, Final Verification, and Local Dev Server

**Files:**
- Modify: `docs/brainx/README.md`
- Create: `apps/browser/README.md`

- [ ] **Step 1: Document browser commands**

Create `apps/browser/README.md`:

```markdown
# brainx Browser

React/TypeScript B-side prototype for the brainx agent workbench.

## Commands

- `npm run dev`: start the local Vite development server.
- `npm test`: run Vitest tests.
- `npm run typecheck`: run TypeScript checks.
- `npm run build`: build production assets.

## Scope

This prototype uses mock REST and mock WebSocket services. It does not call model providers, local tools, the C daemon, or external APIs.
```

Modify the `docs/brainx/README.md` development section so the first item includes:

```markdown
1. 先完成 B 端设计规范和前端原型：`cd apps/browser && npm install && npm run dev`，使用 mock REST/WebSocket 数据验证主要工作流。
```

- [ ] **Step 2: Run full verification**

Run:

```bash
cd apps/browser
npm test
npm run typecheck
npm run build
```

Expected: all commands pass.

- [ ] **Step 3: Start local dev server**

Run:

```bash
cd apps/browser
npm run dev
```

Expected: Vite prints a local URL such as `http://127.0.0.1:5173/`. Keep the server running and report the URL.

- [ ] **Step 4: Manual browser checks**

Open the Vite URL and verify:

- Dark/light theme toggle changes the same UI without layout shift.
- Dashboard shows active runs, approvals, skill drafts, and daemon health.
- Run detail route renders timeline and output.
- Approvals page opens evidence in a right panel and approval requires a reason.
- Branches page states selective adoption and does not imply memory merge.
- Daemons page does not display API key names or secret values.
- 768px viewport keeps navigation usable and stacks content without overlap.

- [ ] **Step 5: Commit if git is valid**

Run:

```bash
git status
```

If valid:

```bash
git add apps/browser docs/brainx/README.md
git commit -m "Build browser prototype"
```

---

## Self-Review

Spec coverage:

- B-side only: covered by `apps/browser`, mock services, and no C/model/local API calls.
- Design tokens, light/dark themes, gradient backdrop: covered by Task 2.
- App shell, primary nav, top bar, content region, route transitions: covered by Task 4.
- Core pages from the first frontend slice: covered by Task 6.
- Approval evidence, side panel, pending state, mock write decision: covered by Task 7.
- Loading and interaction quality: covered by Task 7 and manual checks in Task 8.
- Documentation and commands: covered by Task 8.

Known constraints:

- This plan does not implement the S端 or C端. It builds the browser prototype against deterministic mock contracts only.
- Current workspace appears not to be a valid Git repository; commit steps are conditional on `git status` working.
