import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@renderer/styles/tokens.css';
import '@renderer/styles/widget.css';
import { WidgetApp } from './WidgetApp';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');

createRoot(container).render(
  <StrictMode>
    <WidgetApp />
  </StrictMode>,
);

// Follow the configured theme, falling back to the OS preference.
void window.api.settings.get().then((settings) => {
  const theme =
    settings.appearance.theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : settings.appearance.theme;
  document.documentElement.dataset.theme = theme;
});
