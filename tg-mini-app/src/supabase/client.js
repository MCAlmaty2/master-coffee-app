import { createClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!URL || !ANON_KEY) {
  // eslint-disable-next-line no-console
  console.error('[supabase] Не заданы VITE_SUPABASE_URL и/или VITE_SUPABASE_ANON_KEY. Проверь файл .env');
}

// Текущая организация запроса — читается в БД функцией get_request_org_id()
// (SQL: current_setting('request.headers')::json->>'x-org-id') и используется
// в RLS-политиках org_isolation на большинстве таблиц. Пока orgId не известен
// (до входа/восстановления сессии), заголовок не шлём — политики org_isolation
// в этом случае откатываются к "разрешено всё", что нужно для поиска
// пользователя по telegram_id/PIN до того как известна его организация.
let _orgId = null;
export function setOrgIdHeader(orgId) { _orgId = orgId || null; }

const orgScopedFetch = (input, init = {}) => {
  if (!_orgId) return fetch(input, init);
  const headers = new Headers(init.headers || {});
  headers.set('x-org-id', _orgId);
  return fetch(input, { ...init, headers });
};

export const supabase = createClient(URL || '', ANON_KEY || '', {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  global: {
    fetch: orgScopedFetch,
  },
});

if (typeof window !== 'undefined') {
  window.__supabase = supabase;
}
