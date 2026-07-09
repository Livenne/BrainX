import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageSkeleton, PendingButton } from '../components/LoadingStates';
import { Panel, StatusBadge } from '../components/workbench';
import type { ClientDaemon } from '../domain/types';
import { completeClientBind, getClientDaemons, unbindClientDaemon } from '../services/brainxApi';
import { useAuth } from '../state/auth';
import './pages.css';
import { useDashboardData } from './useDashboardData';

const useMockClientApi = import.meta.env.MODE === 'test';

export function DaemonsPage() {
  const { t } = useTranslation();
  const auth = useAuth();
  const { workspaceId = 'w_core' } = useParams();
  const { dashboard, error } = useDashboardData(workspaceId);
  const [clients, setClients] = useState<ClientDaemon[]>([]);
  const [clientsHydrated, setClientsHydrated] = useState(false);
  const [bindCode, setBindCode] = useState('');
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!dashboard || !useMockClientApi) {
      return;
    }

    setClients(dashboard.daemons);
    setClientsHydrated(true);
  }, [dashboard]);

  useEffect(() => {
    if (useMockClientApi || !auth.token) {
      return;
    }
    setClientsHydrated(false);
    getClientDaemons(auth.token)
      .then((next) => {
        setClients(next);
      })
      .catch((caught) => setActionError(caught instanceof Error ? caught.message : 'Failed to load clients'))
      .finally(() => setClientsHydrated(true));
  }, [auth.token]);

  async function handleAddClient() {
    if (!useMockClientApi) {
      setPendingAction('bind');
      setActionError(null);
      try {
        const bound = await completeClientBind(auth.token ?? '', bindCode.trim());
        setClients((current) => [...current.filter((client) => client.id !== bound.id), bound]);
        setBindCode('');
      } catch (caught) {
        setActionError(caught instanceof Error ? caught.message : 'Failed to bind client');
      } finally {
        setPendingAction(null);
      }
      return;
    }

    setActionError('Bind local client is only available against the real server.');
  }

  async function handleDeleteClient(client: ClientDaemon) {
    if (!useMockClientApi) {
      setPendingAction(`delete:${client.id}`);
      setActionError(null);
      try {
        await unbindClientDaemon(auth.token ?? '', client.id);
        setClients((current) => current.map((candidate) => (
          candidate.id === client.id ? { ...candidate, status: 'revoked' } : candidate
        )));
      } catch (caught) {
        setActionError(caught instanceof Error ? caught.message : 'Failed to unbind client');
      } finally {
        setPendingAction(null);
      }
      return;
    }

    setClients((current) => current.filter((candidate) => candidate.id !== client.id));
  }

  if (!dashboard && !error) {
    return <PageSkeleton label={t('client.loading')} />;
  }

  const visibleClients = clientsHydrated ? clients : dashboard?.daemons ?? [];

  return (
    <section className="page-stack spacious-page">
      {error ? <div role="alert">{error}</div> : null}
      {actionError ? <div role="alert">{actionError}</div> : null}
      <Panel title="Bind local client">
        <div className="inline-form">
          <label className="field-stack">
            <span>Bind code</span>
            <input
              aria-label="Bind code"
              value={bindCode}
              onChange={(event) => setBindCode(event.target.value)}
              placeholder="BX-ABCD-2345"
            />
          </label>
          <PendingButton onClick={handleAddClient} pending={pendingAction === 'bind'}>
            Bind client
          </PendingButton>
        </div>
        <p className="panel-copy">Run <code>brainx bind</code> on the local client, then enter the 5-minute code here.</p>
      </Panel>
      <Panel title={t('client.boundDevices')}>
        <div className="client-device-grid">
          {visibleClients.map((client) => {
            const secondaryLabel = [client.name, client.id]
              .find((value) => value && value.trim() && value.trim() !== client.deviceName);
            return (
            <article aria-label={client.deviceName} className="client-card" key={client.id}>
              <header>
                <div>
                  <h3>{client.deviceName}</h3>
                  {secondaryLabel ? <p>{secondaryLabel}</p> : null}
                </div>
                <StatusBadge status={client.status} />
              </header>
              <dl className="detail-grid">
                <div>
                  <dt>{t('client.os')}</dt>
                  <dd>{client.os}</dd>
                </div>
                <div>
                  <dt>{t('client.version')}</dt>
                  <dd>v{client.version}</dd>
                </div>
                <div>
                  <dt>{t('client.heartbeat')}</dt>
                  <dd>{t('client.heartbeatValue', { seconds: client.lastHeartbeatSeconds })}</dd>
                </div>
                <div>
                  <dt>{t('client.activeTasks')}</dt>
                  <dd>{t('client.activeTask', { count: client.activeTasks })}</dd>
                </div>
              </dl>
              {client.note ? <p className="saved-note">{client.note}</p> : null}
              <p className="panel-copy">{t('common.noSecrets')}</p>
              <div className="card-actions">
                <PendingButton className="danger-button" onClick={() => handleDeleteClient(client)} pending={pendingAction === `delete:${client.id}`}>
                  {t('client.deleteClient')}
                </PendingButton>
              </div>
            </article>
            );
          })}
        </div>
      </Panel>
    </section>
  );
}
