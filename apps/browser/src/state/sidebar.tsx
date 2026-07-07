import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

type SidebarContextValue = {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
};

const SIDEBAR_STORAGE_KEY = 'brainx.sidebarCollapsed';
const SidebarContext = createContext<SidebarContextValue | null>(null);

function readStoredSidebarState() {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeStoredSidebarState(collapsed: boolean) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(readStoredSidebarState);

  useEffect(() => {
    writeStoredSidebarState(collapsed);
  }, [collapsed]);

  const value = useMemo(() => ({ collapsed, setCollapsed }), [collapsed]);

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
  const value = useContext(SidebarContext);
  if (!value) {
    throw new Error('useSidebar must be used inside SidebarProvider');
  }
  return value;
}
