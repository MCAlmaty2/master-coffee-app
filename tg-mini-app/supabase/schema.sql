-- ════════════════════════════════════════════════════════════════════════
-- MASTER COFFEE CRM — СХЕМА БАЗЫ ДАННЫХ ДЛЯ SUPABASE
-- Запускать целиком в SQL Editor → "Run".
-- Можно запускать повторно: все CREATE написаны через IF NOT EXISTS.
-- ════════════════════════════════════════════════════════════════════════

-- Расширение для генерации UUID
create extension if not exists "pgcrypto";

-- ────────────────────────────────────────────────────────────────────────
-- 1. USERS (сотрудники + ожидающие подтверждения)
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.users (
  id              uuid primary key default gen_random_uuid(),
  telegram_id     text unique not null,             -- ID Telegram (главный логин)
  tg_username     text,                              -- @username (может меняться)
  first_name      text not null,                    -- из Telegram
  last_name       text default '',                  -- из Telegram
  photo_url       text,                              -- аватар из Telegram
  role            text not null default 'pending',  -- 'pending' | 'admin' | 'sales' | 'warehouse' | etc.
  active          boolean not null default false,    -- админ переключит на true после подтверждения
  created_at      timestamptz not null default now(),
  approved_at     timestamptz,
  approved_by     uuid references public.users(id) on delete set null
);
create index if not exists idx_users_telegram_id on public.users (telegram_id);
create index if not exists idx_users_role on public.users (role) where active;

-- ────────────────────────────────────────────────────────────────────────
-- 2. ROLE_DEFINITIONS (роли с правами — редактируемые)
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.role_definitions (
  key             text primary key,
  label           text not null,
  short           text,
  color           text default '#A8A8AE',
  permissions     jsonb not null default '[]'::jsonb,  -- массив permission keys
  is_system       boolean not null default false
);

-- ────────────────────────────────────────────────────────────────────────
-- 3. PRODUCTS (прайс-лист)
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.products (
  id              text primary key,                  -- '001', '002', ...
  cat             text not null,                    -- категория
  name            text not null,
  unit            text not null default 'шт',
  price           numeric(12, 2) not null default 0,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_products_cat on public.products (cat) where active;
create index if not exists idx_products_name on public.products using gin (to_tsvector('simple', name));

-- ────────────────────────────────────────────────────────────────────────
-- 4. ORDERS (заявки на закупку/отгрузку)
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  order_number    text unique not null,             -- например, 'ORD-2025-001'
  status          text not null default 'new',      -- new | in_progress | ready | shipped | archived | cancelled
  created_by      uuid not null references public.users(id),
  created_at      timestamptz not null default now(),
  -- Клиент
  client_type     text not null default 'individual', -- individual | legal
  full_name       text,
  company_name    text,
  bin             text,
  contact_person  text,
  email           text,
  phone           text,
  address         text,
  -- Доставка
  delivery_method text not null default 'pickup',   -- pickup | delivery
  pickup_code     text,                              -- 4 цифры для самовывоза
  -- Финансы и документы
  items           jsonb not null default '[]'::jsonb, -- массив позиций
  total_amount    numeric(12, 2) not null default 0,
  comment         text,
  doc_no          text,                              -- номер реализации в 1С
  realization_doc_no text,
  ship_date       date,
  pdf_file_url    text,                              -- ссылка на storage
  -- История
  status_history  jsonb not null default '[]'::jsonb -- [{ status, at, by_user_id, comment }]
);
create index if not exists idx_orders_status on public.orders (status);
create index if not exists idx_orders_created_by on public.orders (created_by);
create index if not exists idx_orders_pickup_code on public.orders (pickup_code) where pickup_code is not null;

-- ────────────────────────────────────────────────────────────────────────
-- 5. GRIND_REQUESTS (заявки на помол)
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.grind_requests (
  id              uuid primary key default gen_random_uuid(),
  number          text unique not null,             -- POM-2025-001
  status          text not null default 'new',      -- new | in_progress | ready | awaiting_pickup | completed | cancelled
  created_by      uuid not null references public.users(id),
  created_at      timestamptz not null default now(),
  -- Клиент
  client_type     text default 'individual',
  client_name     text,
  -- Кофе
  product_id      text references public.products(id) on delete set null,
  product_name    text not null,                    -- дублируем имя на случай если товар удалят/переименуют
  custom_product  boolean not null default false,
  quantity        numeric(10, 3) not null,
  unit            text not null default 'кг',
  -- Помол
  grind_type      text not null,                   -- espresso | turka | filter | v60 | french | custom
  grind_custom    text,
  machine_model   text,
  -- Получение
  delivery_method text not null,                   -- pickup | delivery
  address         text,
  phone           text,
  pickup_code     text,                              -- 4 цифры (после готовности для самовывоза)
  -- Доп.
  comment         text,
  -- Исполнение
  warehouse_user_id uuid references public.users(id) on delete set null,
  ready_at        timestamptz,
  shipped_at      timestamptz,
  completed_at    timestamptz,
  cancelled_at    timestamptz,
  log             jsonb not null default '[]'::jsonb
);
create index if not exists idx_grinds_status on public.grind_requests (status);
create index if not exists idx_grinds_created_by on public.grind_requests (created_by);

-- ────────────────────────────────────────────────────────────────────────
-- 6. TASKS (задачи / визиты бариста, техника)
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.tasks (
  id              uuid primary key default gen_random_uuid(),
  task_number     text unique not null,
  kind            text not null,                    -- visit | issue | etc.
  department      text not null,                    -- barista | technician
  status          text not null default 'new',      -- new | in_work | done
  assignee_id     uuid references public.users(id),
  created_by      uuid not null references public.users(id),
  created_at      timestamptz not null default now(),
  client_name     text,
  address         text,
  phone           text,
  problem         text,
  visit_date      date,
  visit_time      text,
  duration_min    integer default 60,
  log             jsonb not null default '[]'::jsonb
);
create index if not exists idx_tasks_assignee on public.tasks (assignee_id);
create index if not exists idx_tasks_status on public.tasks (status);

-- ────────────────────────────────────────────────────────────────────────
-- 7. WRITE_OFFS (заявки на списание)
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.write_offs (
  id              uuid primary key default gen_random_uuid(),
  number          text unique not null,             -- WO-2025-001
  doc_no          text,
  status          text not null default 'pending',  -- pending | approved | completed | rejected
  created_by      uuid not null references public.users(id),
  created_at      timestamptz not null default now(),
  items           jsonb not null default '[]'::jsonb,
  reason          text not null,
  approved_by     uuid references public.users(id),
  approved_at     timestamptz,
  approval_comment text,
  completed_by    uuid references public.users(id),
  completed_at    timestamptz,
  log             jsonb not null default '[]'::jsonb
);
create index if not exists idx_writeoffs_status on public.write_offs (status);

-- ────────────────────────────────────────────────────────────────────────
-- 8. CONTRACT_REQUESTS (заявки на договор)
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.contract_requests (
  id              uuid primary key default gen_random_uuid(),
  number          text unique not null,
  contract_type   text not null,                    -- sale | supply_prepay | etc.
  payment_terms   text,
  tax_regime      text,
  status          text not null default 'pending',  -- pending | in_progress | signed | rejected
  created_by      uuid not null references public.users(id),
  created_at      timestamptz not null default now(),
  taken_by        uuid references public.users(id),
  client_data     jsonb not null default '{}'::jsonb,
  revisions       jsonb not null default '[]'::jsonb,
  signed_at       timestamptz,
  log             jsonb not null default '[]'::jsonb
);
create index if not exists idx_contracts_status on public.contract_requests (status);

-- ────────────────────────────────────────────────────────────────────────
-- 9. NOTIFICATIONS (уведомления внутри приложения)
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.notifications (
  id              uuid primary key default gen_random_uuid(),
  recipient_id    uuid not null references public.users(id) on delete cascade,
  title           text not null,
  body            text,
  link_kind       text,                              -- order | grind | writeoff | etc.
  link_id         text,
  at              timestamptz not null default now(),
  read            boolean not null default false
);
create index if not exists idx_notifications_recipient on public.notifications (recipient_id, read, at desc);

-- ────────────────────────────────────────────────────────────────────────
-- 10. TELEGRAM_SETTINGS (синглтон — одна запись)
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.telegram_settings (
  id              integer primary key default 1 check (id = 1),
  bot_token       text default '',
  bot_username    text default '',
  group_chat_id   text default '',
  topics          jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now()
);
insert into public.telegram_settings (id) values (1) on conflict (id) do nothing;

-- ────────────────────────────────────────────────────────────────────────
-- 11. TELEGRAM_LOG (что бот реально отправил или попытался)
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.telegram_log (
  id              uuid primary key default gen_random_uuid(),
  event           text not null,
  target          text,
  configured      boolean default false,
  message         text not null,
  at              timestamptz not null default now()
);
create index if not exists idx_telegram_log_at on public.telegram_log (at desc);


-- ════════════════════════════════════════════════════════════════════════
-- НАЧАЛЬНЫЕ ДАННЫЕ
-- ════════════════════════════════════════════════════════════════════════

-- Системные роли (если ещё не были созданы)
insert into public.role_definitions (key, label, short, color, permissions, is_system) values
  ('admin',          'Администратор',   'Админ',     '#1A1814', '[]'::jsonb, true),
  ('director',       'Директор',        'Директор',  '#7C3AED', '["orders_view_all","writeoff_create","writeoff_approve","writeoff_view_all","contract_create","contract_take","contract_view_all","grind_view_all"]'::jsonb, true),
  ('senior_manager', 'Старший менеджер','Ст.менеджер','#7C3AED','["orders_view_all","writeoff_create","writeoff_approve","writeoff_view_all","contract_create","contract_take","contract_view_all","grind_view_all"]'::jsonb, true),
  ('b2b',            'B2B-менеджер',    'B2B',       '#3390EC', '["orders_view_all","orders_create","orders_create_quick","orders_change_status","orders_archive_view","orders_export","tasks_view_own","tasks_create","tasks_calendar_all","contract_create","grind_create","grind_view_all"]'::jsonb, true),
  ('sales',          'Менеджер продаж', 'Продажи',   '#3390EC', '["orders_view_own","orders_create","tasks_view_own","tasks_create","tasks_calendar_all","contract_create","grind_create"]'::jsonb, true),
  ('warehouse',      'Склад',           'Склад',     '#F59E0B', '["warehouse_pickup","grind_fulfill","grind_view_all"]'::jsonb, true),
  ('cashier',        'Кассир',          'Кассир',    '#10B981', '["writeoff_create","writeoff_finalize","writeoff_view_all"]'::jsonb, true),
  ('barista',        'Бариста-выезд',   'Бариста',   '#EC4899', '["tasks_view_own","tasks_self_assign","tasks_calendar_all","writeoff_create"]'::jsonb, true),
  ('technician',     'Техник',          'Техник',    '#EF4444', '["tasks_view_own","tasks_self_assign","tasks_calendar_all","writeoff_create"]'::jsonb, true),
  ('pending',        'Ожидает',         'Ожидает',   '#A8A8AE', '[]'::jsonb, true)
on conflict (key) do nothing;


-- ════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS)
-- Базовая политика: пока всем authenticated-юзерам разрешаем читать,
-- модификации идут через service_role (бэкенд-обвязка) или через
-- доменные правила в приложении. Тонкую настройку добавим на следующем
-- шаге, когда подключим Supabase Auth через Telegram.
-- ════════════════════════════════════════════════════════════════════════

alter table public.users             enable row level security;
alter table public.role_definitions  enable row level security;
alter table public.products          enable row level security;
alter table public.orders            enable row level security;
alter table public.grind_requests    enable row level security;
alter table public.tasks             enable row level security;
alter table public.write_offs        enable row level security;
alter table public.contract_requests enable row level security;
alter table public.notifications     enable row level security;
alter table public.telegram_settings enable row level security;
alter table public.telegram_log      enable row level security;

-- Открытые политики на чтение для роли anon (пока, на этапе разработки;
-- на следующем шаге заменим на проверку по telegram_id из JWT)
do $$ begin
  create policy "anon read users"        on public.users             for select using (true);
  create policy "anon read role_defs"    on public.role_definitions  for select using (true);
  create policy "anon read products"     on public.products          for select using (true);
  create policy "anon read orders"       on public.orders            for select using (true);
  create policy "anon read grinds"       on public.grind_requests    for select using (true);
  create policy "anon read tasks"        on public.tasks             for select using (true);
  create policy "anon read writeoffs"    on public.write_offs        for select using (true);
  create policy "anon read contracts"    on public.contract_requests for select using (true);
  create policy "anon read notifications" on public.notifications    for select using (true);
  create policy "anon read tg_settings"  on public.telegram_settings for select using (true);
  create policy "anon read tg_log"       on public.telegram_log      for select using (true);
exception when duplicate_object then null;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- ГОТОВО! Что дальше:
-- 1. Возвращайся в чат и пришли:
--      - SUPABASE_URL (вкладка Settings → API → Project URL)
--      - SUPABASE_ANON_KEY (там же — anon / public key)
-- 2. Я подключу клиент Supabase к приложению и перепишу loadDB/saveDB
--    на запросы к этой базе вместо localStorage.
-- 3. Затем настроим Telegram-only авторизацию и тонкие RLS-правила.
-- ════════════════════════════════════════════════════════════════════════
