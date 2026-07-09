import {
  Activity,
  Bot,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Search,
  Settings,
  Sparkles
} from 'lucide-react';
import { createContext, useContext, useEffect, useState, type DependencyList, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSidebar } from '../state/sidebar';
import { logoutUser } from '../services/brainxApi';
import { useAuth } from '../state/auth';
import { ThemeSwitch } from './ThemeSwitch';
import './AppShell.css';

const brainxLogoUrl = new URL('../../../../logo.png', import.meta.url).href;

const TopBarSlotContext = createContext<((slot: ReactNode) => void) | null>(null);

export function useTopBarSlot(slot: ReactNode, deps: DependencyList = []) {
  const setTopBarSlot = useContext(TopBarSlotContext);
  useEffect(() => {
    if (!setTopBarSlot) return undefined;
    setTopBarSlot(slot);
    return () => setTopBarSlot(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setTopBarSlot, ...deps]);
}

function getWorkspaceId(pathname: string, routeParam?: string) {
  if (routeParam) {
    return routeParam;
  }

  return pathname.match(/^\/workspaces\/([^/]+)/)?.[1] ?? 'w_core';
}

function getNavItems(workspaceId: string, t: (key: string) => string) {
  return [
    { to: `/workspaces/${workspaceId}`, label: t('nav.dashboard'), icon: LayoutDashboard, end: true },
    { to: `/workspaces/${workspaceId}/chat`, label: t('nav.chat'), icon: MessageSquare },
    { to: `/workspaces/${workspaceId}/agents`, label: t('nav.agents'), icon: Bot },
    { to: `/workspaces/${workspaceId}/skills`, label: t('nav.skills'), icon: Sparkles },
    { to: `/workspaces/${workspaceId}/client-daemons`, label: t('nav.client'), icon: Activity },
    { to: `/workspaces/${workspaceId}/settings`, label: t('nav.settings'), icon: Settings }
  ];
}

function getPageTitle(pathname: string, workspaceId: string, t: (key: string) => string) {
  const base = `/workspaces/${workspaceId}`;

  if (pathname === '/') return t('nav.dashboard');
  if (pathname === `${base}/chat-preview`) return t('chatPreview.title');
  if (pathname === `${base}/chat`) return t('nav.chat');
  if (pathname.startsWith(`${base}/agents/`) && pathname.includes('/runs/')) return t('runDetail.title');
  if (pathname.startsWith(`${base}/agents`)) return t('nav.agents');
  if (pathname.startsWith(`${base}/skills`) || pathname.includes('/skill-drafts/')) return t('skills.title');
  if (pathname.startsWith(`${base}/client-daemons`)) return t('nav.client');
  if (pathname.startsWith(`${base}/settings`)) return t('nav.settings');
  return t('nav.dashboard');
}

export function AppShell() {
  const { t } = useTranslation();
  const { collapsed, setCollapsed } = useSidebar();
  const location = useLocation();
  const params = useParams();
  const auth = useAuth();
  const workspaceId = getWorkspaceId(location.pathname, params.workspaceId);
  const navItems = getNavItems(workspaceId, t);
  const toggleLabel = collapsed ? t('nav.expand') : t('nav.collapse');
  const pageTitle = getPageTitle(location.pathname, workspaceId, t);
  const [topBarSlot, setTopBarSlot] = useState<ReactNode>(null);

  async function handleLogout() {
    const token = auth.token;
    try {
      if (token) {
        await logoutUser(token);
      }
    } finally {
      auth.clearAuth();
    }
  }

  return (
    <div className="app-shell full-workbench" data-sidebar-collapsed={collapsed}>
      <aside className="primary-nav" aria-label={t('nav.primary')} data-align={collapsed ? 'center' : 'stretch'} data-collapsed={collapsed}>
        <div className="nav-brand-row">
          <div className="brand-mark">
            <img src={brainxLogoUrl} alt="brainx" />
          </div>
          <div className="brand-copy" aria-hidden={collapsed} data-visible={String(!collapsed)} data-testid="brand-copy">
            <strong>BrainX</strong>
          </div>
        </div>
        <nav className="nav-stack" aria-label={t('nav.primary')} data-align={collapsed ? 'center' : 'stretch'} data-collapsed={collapsed}>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className="nav-item"
                data-collapsed={collapsed}
                title={item.label}
                aria-label={item.label}
              >
                <span className="nav-icon-slot" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <span className="nav-label" aria-hidden={collapsed} data-visible={String(!collapsed)}>
                  {item.label}
                </span>
              </NavLink>
            );
          })}
        </nav>
        <button className="sidebar-toggle" type="button" aria-label={toggleLabel} title={toggleLabel} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? <ChevronRight aria-hidden="true" size={16} /> : <ChevronLeft aria-hidden="true" size={16} />}
          <span className="sidebar-toggle-label" aria-hidden={collapsed} data-visible={String(!collapsed)}>
            {toggleLabel}
          </span>
        </button>
      </aside>
      <section className="shell-region">
        <header className="top-bar" role="banner" aria-label={t('topbar.topBar')}>
          <div className="workspace-context">
            <div className="workspace-title-row">
              <h1 className="top-page-title">{pageTitle}</h1>
              {topBarSlot ? <div className="top-bar-slot">{topBarSlot}</div> : null}
            </div>
          </div>
          <div className="top-actions">
            <label className="command-search">
              <Search aria-hidden="true" size={15} />
              <input type="search" aria-label={t('topbar.commandSearch')} placeholder={t('topbar.commandPlaceholder')} />
            </label>
            <div className="connection-state" aria-label={t('common.websocketConnected')}>
              <span aria-hidden="true" />
              {t('common.websocketConnected')}
            </div>
            <ThemeSwitch />
            <button className="icon-text-button logout-button" type="button" onClick={handleLogout} aria-label={t('common.logout')} title={t('common.logout')}>
              <LogOut aria-hidden="true" size={15} />
              <span>{t('common.logout')}</span>
            </button>
          </div>
        </header>
        <TopBarSlotContext.Provider value={setTopBarSlot}>
          <main className="content-region" data-surface="transparent" key={location.pathname}>
            <Outlet />
          </main>
        </TopBarSlotContext.Provider>
      </section>
    </div>
  );
}
