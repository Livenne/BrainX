import { useEffect, useState } from 'react';
import type { DashboardData } from '../domain/types';
import { getDashboard } from '../services/brainxApi';
import { getDashboard as getMockDashboard } from '../services/mockApi';
import { useAuth } from '../state/auth';

type DashboardLoadState = {
  dashboard: DashboardData | null;
  error: string | null;
};

export function useDashboardData(workspaceId = 'w_core'): DashboardLoadState {
  const [state, setState] = useState<DashboardLoadState>({ dashboard: null, error: null });
  const { token } = useAuth();

  useEffect(() => {
    let cancelled = false;
    setState({ dashboard: null, error: null });

    if (import.meta.env.MODE === 'test') {
      void getMockDashboard(workspaceId)
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
    }

    if (!token) {
      setState({ dashboard: null, error: 'Authentication is required' });
      return () => {
        cancelled = true;
      };
    }

    void getDashboard(token, workspaceId)
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
  }, [token, workspaceId]);

  return state;
}
