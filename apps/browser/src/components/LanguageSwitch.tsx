import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Locale } from '../i18n/i18n';
import { writeStoredLocale } from '../i18n/i18n';

export function LanguageSwitch() {
  const { i18n, t } = useTranslation();
  const currentLanguage = i18n.language === 'en-US' ? 'en-US' : 'zh-CN';
  const nextLanguage: Locale = currentLanguage === 'zh-CN' ? 'en-US' : 'zh-CN';
  const label = nextLanguage === 'en-US' ? t('common.switchToEnglish') : t('common.switchToChinese');

  async function changeLanguage() {
    await i18n.changeLanguage(nextLanguage);
    writeStoredLocale(nextLanguage);
  }

  return (
    <button className="icon-text-button" type="button" aria-label={label} title={label} onClick={() => void changeLanguage()}>
      <Languages aria-hidden="true" size={15} />
      <span>{currentLanguage === 'zh-CN' ? '中' : 'EN'}</span>
    </button>
  );
}
