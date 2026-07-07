import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { resources } from './resources';

export type Locale = keyof typeof resources;

export const LOCALE_STORAGE_KEY = 'brainx.locale';
export const DEFAULT_LOCALE: Locale = 'zh-CN';

function isLocale(value: string | null): value is Locale {
  return value === 'zh-CN' || value === 'en-US';
}

export function readStoredLocale(): Locale {
  if (typeof window === 'undefined') {
    return DEFAULT_LOCALE;
  }

  try {
    const locale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(locale) ? locale : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function writeStoredLocale(locale: Locale) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: readStoredLocale(),
    fallbackLng: DEFAULT_LOCALE,
    interpolation: {
      escapeValue: false
    }
  });
}

export { i18n };
