import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { startAppUpdateMonitor } from './app-update';
import './styles.css';

startAppUpdateMonitor();
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
