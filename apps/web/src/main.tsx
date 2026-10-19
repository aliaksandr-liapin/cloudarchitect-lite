import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SetupWizard } from './SetupWizard';
import { readTheme } from './prefs';
import './styles.css';

// Before first render, so a stored dark choice does not flash light.
document.documentElement.dataset.theme = readTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>{location.pathname.startsWith('/setup') ? <SetupWizard /> : <App />}</StrictMode>,
);
