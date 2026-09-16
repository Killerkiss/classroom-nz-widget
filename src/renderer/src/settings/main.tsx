import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@renderer/styles/tokens.css';
import '@renderer/styles/settings.css';
import { SettingsApp } from './SettingsApp';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');

createRoot(container).render(
  <StrictMode>
    <SettingsApp />
  </StrictMode>,
);

void window.api.settings.get().then((settings) => {
  const theme =
    settings.appearance.theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : settings.appearance.theme;
  document.documentElement.dataset.theme = theme;
});
