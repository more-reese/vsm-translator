import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css';
import './styles.css';

import { isElectron } from './lib/api';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');

// Browser mode has no traffic lights to leave room for, and no draggable chrome.
document.documentElement.dataset.platform = isElectron ? 'electron' : 'browser';

// No StrictMode: its double-invoked effects would tear down and rebuild the
// bpmn-js modeler on every mount, and could race the first-run seed creation.
createRoot(container).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
