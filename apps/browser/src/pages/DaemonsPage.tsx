import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageSkeleton, PendingButton } from '../components/LoadingStates';
import { Panel, StatusBadge } from '../components/workbench';
import type { ApprovalPolicy } from '../domain/types';
import type { ClientDaemon } from '../domain/types';
import { completeClientBind, getClientDaemons, unbindClientDaemon, updateApprovalPolicy } from '../services/brainxApi';
import { addClientDevice, removeClientDevice, updateClientDeviceNote } from '../services/mockApi';
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
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [bindCode, setBindCode] = useState('');
  const [policyMode, setPolicyMode] = useState<ApprovalPolicy['mode']>('default');
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!dashboard || !useMockClientApi) {
      return;
    }

    setClients(dashboard.daemons);
    setNoteDrafts(Object.fromEntries(dashboard.daemons.map((client) => [client.id, client.note])));
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
        setNoteDrafts(Object.fromEntries(next.map((client) => [client.id, client.note])));
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

    setPendingAction('add');
    setActionError(null);
    try {
      const next = await addClientDevice();
      setClients((current) => [...current, next]);
      setNoteDrafts((current) => ({ ...current, [next.id]: next.note }));
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Failed to add client');
    } finally {
      setPendingAction(null);
    }
  }

  async function handleSaveNote(client: ClientDaemon) {
    setPendingAction(`note:${client.id}`);
    setActionError(null);
    try {
      const updated = await updateClientDeviceNote(client.id, noteDrafts[client.id] ?? '');
      setClients((current) => current.map((candidate) => (candidate.id === updated.id ? updated : candidate)));
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Failed to save note');
    } finally {
      setPendingAction(null);
    }
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

    const previousClients = clients;
    const previousNoteDrafts = noteDrafts;

    setClients((current) => current.filter((candidate) => candidate.id !== client.id));
    setNoteDrafts((current) => {
      const next = { ...current };
      delete next[client.id];
      return next;
    });
    setPendingAction(`delete:${client.id}`);
    setActionError(null);
    try {
      await removeClientDevice(client.id);
    } catch (caught) {
      setClients(previousClients);
      setNoteDrafts(previousNoteDrafts);
      setActionError(caught instanceof Error ? caught.message : 'Failed to delete client');
    } finally {
      setPendingAction(null);
    }
  }

  async function handleSavePolicy() {
    setPendingAction('policy');
    setActionError(null);
    try {
      await updateApprovalPolicy(auth.token ?? '', workspaceId, policyMode);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Failed to update approval policy');
    } finally {
      setPendingAction(null);
    }
  }

  if (!dashboard && !error) {
    return <PageSkeleton label={t('client.loading')} />;
  }

  const visibleClients = clientsHydrated ? clients : dashboard?.daemons ?? [];

  return (
    <section className="page-stack spacious-page">
      <div className="page-toolbar">
        {useMockClientApi ? (
          <PendingButton onClick={handleAddClient} pending={pendingAction === 'add'}>
            {t('client.addClient')}
          </PendingButton>
        ) : null}
      </div>
      {error ? <div role="alert">{error}</div> : null}
      {actionError ? <div role="alert">{actionError}</div> : null}
      {!useMockClientApi ? (
        <Panel title="Bind local client">
          <div className="inline-form">
            <label className="field-stack">
              <span>Bind code</span>
              <input value={bindCode} onChange={(event) => setBindCode(event.target.value)} placeholder="BX-ABCD-2345" />
            </label>
            <PendingButton onClick={handleAddClient} pending={pendingAction === 'bind'}>
              Bind client
            </PendingButton>
          </div>
          <p className="panel-copy">Run <code>brainx bind</code> on the local client, then enter the 5-minute code here.</p>
        </Panel>
      ) : null}
      {!useMockClientApi ? (
        <Panel title="Tool approval policy">
          <div className="inline-form">
            <label className="field-stack">
              <span>Approval mode</span>
              <select value={policyMode} onChange={(event) => setPolicyMode(event.target.value as ApprovalPolicy['mode'])}>
                <option value="default">Default</option>
                <option value="full_accept">Full accept</option>
              </select>
            </label>
            <PendingButton onClick={handleSavePolicy} pending={pendingAction === 'policy'}>
              Save policy
            </PendingButton>
          </div>
        </Panel>
      ) : null}
      <Panel title={t('client.boundDevices')}>
        <div className="client-device-grid">
          {visibleClients.map((client) => (
            <article aria-label={client.deviceName} className="client-card" key={client.id}>
              <header>
                <div>
                  <h3>{client.deviceName}</h3>
                  <p>{client.name}</p>
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
                <div>
                  <dt>{t('client.workspacePath')}</dt>
                  <dd>{client.workspacePath}</dd>
                </div>
              </dl>
              <label className="field-stack">
                <span>{t('client.deviceNote')}</span>
                <textarea
                  aria-label={t('client.deviceNote')}
                  value={noteDrafts[client.id] ?? client.note}
                  onChange={(event) => setNoteDrafts((current) => ({ ...current, [client.id]: event.target.value }))}
                />
              </label>
              <p className="saved-note">{client.note}</p>
              <p className="panel-copy">{t('common.noSecrets')}</p>
              <div className="card-actions">
                <PendingButton onClick={() => handleSaveNote(client)} pending={pendingAction === `note:${client.id}`}>
                  {t('client.saveNote')}
                </PendingButton>
                <PendingButton className="danger-button" onClick={() => handleDeleteClient(client)} pending={pendingAction === `delete:${client.id}`}>
                  {t('client.deleteClient')}
                </PendingButton>
              </div>
            </article>
          ))}
        </div>
      </Panel>
    </section>
  );
}
