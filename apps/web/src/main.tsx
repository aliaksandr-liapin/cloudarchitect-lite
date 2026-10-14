import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SetupWizard } from './SetupWizard';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>{location.pathname.startsWith('/setup') ? <SetupWizard /> : <App />}</StrictMode>,
);
