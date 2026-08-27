import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { initGlobalErrorHandlers } from './errorMonitor';
import './index.css';

initGlobalErrorHandlers();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
