import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, FolderKanban } from 'lucide-react';
import { PageSkeleton } from '../components/LoadingStates';
import { Panel } from '../components/workbench';
import type { Workspace } from '../domain/types';
import { getWorkspaces as getRealWorkspaces } from '../services/brainxApi';
import { getWorkspaces as getMockWorkspaces } from '../services/mockApi';
import { useAuth } from '../state/auth';
import './pages.css';

const useMockWorkspaceApi = import.meta.env.MODE === 'test';

async function loadWorkspaces(token: string | null): Promise<Workspace[]> {
  if (useMockWorkspaceApi) {
    return getMockWorkspaces();
  }
  return getRealWorkspaces(token ?? '');
}

export function WorkspacesPage() {
  const auth = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadWorkspaces(auth.token)
      .then((next) => {
        if (!active) return;
        setWorkspaces(next);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : 'Failed to load workspaces');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [auth.token]);

  if (loading && !error) {
    return <PageSkeleton label="Loading workspaces" />;
  }

  return (
    <section className="page-stack spacious-page">
      {error ? <div role="alert">{error}</div> : null}
      <Panel title="Workspaces">
        <div className="workspace-entry-list">
          {workspaces.map((workspace) => (
            <Link className="workspace-entry-row" key={workspace.id} to={`/workspaces/${workspace.id}/chat`}>
              <span className="workspace-entry-icon" aria-hidden="true">
                <FolderKanban size={18} />
              </span>
              <span>
                <span className="workspace-entry-title">
                  <strong>{workspace.name}</strong>
                  {workspace.defaultWorkspace ? <em>Default</em> : null}
                </span>
                <small>{workspace.path ?? workspace.id}</small>
              </span>
              <ArrowRight aria-hidden="true" size={16} />
            </Link>
          ))}
        </div>
      </Panel>
    </section>
  );
}
