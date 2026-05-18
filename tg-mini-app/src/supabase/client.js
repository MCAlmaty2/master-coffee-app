import { createClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!URL || !ANON_KEY) {
  // eslint-disable-next-line no-console
  console.error('[supabase] Не заданы VITE_SUPABASE_URL и/или VITE_SUPABASE_ANON_KEY. Проверь файл .env');
}

export const supabase = createClient(URL || '', ANON_KEY || '', {
  auth: {
    // Мы не используем встроенный Supabase Auth — авторизация идёт через Telegram WebApp.
    // Поэтому отключаем сессии, чтобы не было лишних запросов.
    persistSession: false,
    autoRefreshToken: false,
  },
});

// Полезно для отладки в консоли браузера
if (typeof window !== 'undefined') {
  window.__supabase = supabase;
}
