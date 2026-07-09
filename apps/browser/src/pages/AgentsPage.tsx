import { useTranslation } from 'react-i18next';
import { Bot, GitBranch, MessageSquareText, Sparkles } from 'lucide-react';
import { Panel } from '../components/workbench';
import './pages.css';

export function AgentsPage() {
  const { t } = useTranslation();

  return (
    <section className="page-stack spacious-page">
      <Panel title={t('agents.roadmapTitle')}>
        <div className="agent-roadmap">
          <div className="agent-roadmap-mark" aria-hidden="true">
            <Bot size={28} />
          </div>
          <div className="agent-roadmap-copy">
            <h2>{t('agents.roadmapHeading')}</h2>
            <p>{t('agents.roadmapBody')}</p>
          </div>
        </div>
        <div className="agent-roadmap-grid" aria-label={t('agents.currentFocus')}>
          <article>
            <MessageSquareText size={18} />
            <span>{t('agents.focusChat')}</span>
          </article>
          <article>
            <Sparkles size={18} />
            <span>{t('agents.focusSkills')}</span>
          </article>
          <article>
            <GitBranch size={18} />
            <span>{t('agents.focusBranches')}</span>
          </article>
        </div>
      </Panel>
    </section>
  );
}
