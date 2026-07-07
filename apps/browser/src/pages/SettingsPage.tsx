import { useTranslation } from 'react-i18next';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { Panel } from '../components/workbench';
import { useSidebar } from '../state/sidebar';
import './pages.css';

export function SettingsPage() {
  const { i18n, t } = useTranslation();
  const { collapsed, setCollapsed } = useSidebar();

  return (
    <section className="page-stack spacious-page">
      <div className="content-grid two-column">
        <Panel title={t('settings.language')}>
          <div className="settings-stack">
            <div className="setting-row">
              <div>
                <h3>{t('settings.language')}</h3>
                <p>{i18n.language === 'en-US' ? t('settings.english') : t('settings.chinese')}</p>
              </div>
              <LanguageSwitch />
            </div>
          </div>
        </Panel>
        <Panel title={t('settings.sidebar')}>
          <div className="settings-stack">
            <div className="setting-row">
              <div>
                <h3>{t('settings.sidebar')}</h3>
                <p>{collapsed ? t('settings.collapsed') : t('settings.expanded')}</p>
              </div>
              <button className="text-button" type="button" onClick={() => setCollapsed(!collapsed)}>
                {collapsed ? t('nav.expand') : t('nav.collapse')}
              </button>
            </div>
          </div>
        </Panel>
        <Panel title={t('settings.appearance')}>
          <div className="settings-stack">
            <div className="setting-row">
              <div>
                <h3>{t('settings.fullWorkbench')}</h3>
                <p>{t('settings.gradientSurface')}</p>
              </div>
              <ThemeSwitch />
            </div>
          </div>
        </Panel>
      </div>
    </section>
  );
}
