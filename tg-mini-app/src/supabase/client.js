import { createClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!URL || !ANON_KEY) {
  // eslint-disable-next-line no-console
  console.error('[supabase] Не заданы VITE_SUPABASE_URL и/или VITE_SUPABASE_ANON_KEY. Проверь файл .env');
}

let _orgIdForHeaders = null;
export function setOrgIdHeader(orgId) { _orgIdForHeaders = orgId; }

const _nativeFetch = globalThis.fetch.bind(globalThis);

export const supabase = createClient(URL || '', ANON_KEY || '', {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  global: {
    fetch: (url, options) => {
      if (_orgIdForHeaders) {
        const headers = new Headers(options?.headers);
        headers.set('x-org-id', _orgIdForHeaders);
        options = { ...(options || {}), headers };
      }
      return _nativeFetch(url, options);
    },
  },
});

// Полезно для отладки в консоли браузера
if (typeof window !== 'undefined') {
  window.__supabase = supabase;
}
