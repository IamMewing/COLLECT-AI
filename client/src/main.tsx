import React from 'react';
import ReactDOM from 'react-dom/client';
// Self-hosted so the display face is there on first paint — no third-party
// request, no flash of fallback type on the hero.
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
