import { I18nextProvider } from 'react-i18next';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { i18n, readStoredLocale } from './i18n';

export function BrainxI18nProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const storedLocale = readStoredLocale();
    if (i18n.language !== storedLocale) {
      void i18n.changeLanguage(storedLocale);
    }
  }, []);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
