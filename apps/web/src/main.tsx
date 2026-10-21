import '@fontsource/padauk/400.css';
import '@fontsource/padauk/700.css';
import './styles.css';
import './i18n';
import { registerSW } from 'virtual:pwa-register';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// Service worker: caches the app shell so the app opens without signal.
registerSW({ immediate: true });

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
