import { supabase } from './supabase/client';

const DEDUP_WINDOW_MS = 10 * 60 * 1000;
const _recentErrors = new Map();

function isDuplicate(message) {
  const now = Date.now();
  const last = _recentErrors.get(message);
  if (last && now - last < DEDUP_WINDOW_MS) return true;
  _recentErrors.set(message, now);
  if (_recentErrors.size > 100) {
    const oldest = [..._recentErrors.entries()]
      .sort((a, b) => a[1] - b[1])[0];
    if (oldest) _recentErrors.delete(oldest[0]);
  }
  return false;
}

function sendToDb(kind, message, details) {
  if (!message || isDuplicate(message)) return;
  if (String(message).includes('Failed to fetch')) return;
  supabase.from('error_reports').insert({
    reporter_id: null,
    reporter_name: 'Global handler',
    kind,
    source: 'window',
    message: String(message).slice(0, 2000),
    details: details ? JSON.parse(JSON.stringify(details, null, 0).slice(0, 4000)) : null,
    route_name: window.location.hash || null,
    at: new Date().toISOString(),
  }).then(({ error }) => {
    if (error) console.warn('[errorMonitor] failed to write:', error.message);
  }).catch(() => {});
}

export function initGlobalErrorHandlers() {
  window.onerror = (msg, source, line, col, error) => {
    sendToDb('window.onerror', String(msg), {
      source, line, col,
      stack: error?.stack?.slice(0, 800) || null,
    });
  };

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const msg = reason instanceof Error ? reason.message : String(reason);
    sendToDb('unhandledrejection', msg, {
      stack: reason?.stack?.slice(0, 800) || null,
    });
  });
}

export { isDuplicate };
