import { useEffect, useState } from 'react';
import type { DashboardData } from '../domain/types';
import { getDashboard } from '../services/mockApi';

type DashboardLoadState = {
  dashboard: DashboardData | null;
  error: string | null;
};

export function useDashboardData(workspaceId = 'w_core'): DashboardLoadState {
  const [state, setState] = useState<DashboardLoadState>({ dashboard: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setState({ dashboard: null, error: null });

    void getDashboard(workspaceId)
      .then((dashboard) => {
        if (!cancelled) {
          setState({ dashboard, error: null });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            dashboard: null,
            error: error instanceof Error ? error.message : 'Dashboard data could not be loaded'
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  return state;
}
