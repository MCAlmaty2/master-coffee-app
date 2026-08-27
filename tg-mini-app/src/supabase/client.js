import { createClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!URL || !ANON_KEY) {
  // eslint-disable-next-line no-console
  console.error('[supabase] Не заданы VITE_SUPABASE_URL и/или VITE_SUPABASE_ANON_KEY. Проверь файл .env');
}

export function setOrgIdHeader() {}

export const supabase = createClient(URL || '', ANON_KEY || '', {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

if (typeof window !== 'undefined') {
  window.__supabase = supabase;
}
