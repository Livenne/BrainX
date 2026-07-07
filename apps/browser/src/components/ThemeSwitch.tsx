import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../state/theme';

export function ThemeSwitch() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const isLight = theme === 'light';
  const nextTheme = isLight ? 'dark' : 'light';
  const label = isLight ? t('common.switchToDarkTheme') : t('common.switchToLightTheme');

  return (
    <button
      className="theme-switch"
      type="button"
      role="switch"
      aria-checked={isLight}
      aria-label={label}
      title={label}
      data-theme-state={theme}
      onClick={() => setTheme(nextTheme)}
    >
      <span className="theme-switch-thumb" aria-hidden="true" />
      <span className="theme-switch-icon" data-active={String(!isLight)} aria-hidden="true">
        <Moon size={15} />
      </span>
      <span className="theme-switch-icon" data-active={String(isLight)} aria-hidden="true">
        <Sun size={15} />
      </span>
    </button>
  );
}
