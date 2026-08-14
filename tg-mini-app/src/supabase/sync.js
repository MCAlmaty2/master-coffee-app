// ═════════════════════════════════════════════════════════════════════════
// src/supabase/sync.js — универсальная синхронизация всех таблиц
// Оптимизировано: фильтр по дате, загрузка по ролям, realtime без перекачки
// ═════════════════════════════════════════════════════════════════════════

import { supabase } from './client';

function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString();
}

const CUTOFF_3M = () => monthsAgo(3);
const CUTOFF_6M = () => monthsAgo(6);

// ВАЖНО: ключи объекта должны совпадать с ключами состояния в db (camelCase),
// а поле table — с именем таблицы в Supabase (snake_case).
//
// dateFilter: { column, cutoff } — ограничить загрузку по дате
// base: 'tk' | 'coffeeshop' | null — загружать только для указанной базы
export const SYNC_TABLES = {
  orders:             { table: 'orders',            pk: 'id', dateFilter: { column: 'created_at', cutoff: CUTOFF_3M } },
  grindRequests:      { table: 'grind_requests',    pk: 'id', dateFilter: { column: 'created_at', cutoff: CUTOFF_3M } },
  tasks:              { table: 'tasks',             pk: 'id', base: 'tk' },
  writeOffs:          { table: 'write_offs',        pk: 'id', dateFilter: { column: 'created_at', cutoff: CUTOFF_3M }, base: 'tk' },
  contractRequests:   { table: 'contract_requests', pk: 'id', base: 'tk' },
  notifications:      { table: 'notifications',     pk: 'id', dateFilter: { column: 'at', cutoff: CUTOFF_3M } },
  roleDefinitions:    { table: 'role_definitions',  pk: 'key' },
  telegramLog:        { table: 'telegram_log',      pk: 'id', dateFilter: { column: 'at', cutoff: CUTOFF_3M } },
  deliveryRegistries: { table: 'delivery_registries', pk: 'id', dateFilter: { column: 'created_at', cutoff: CUTOFF_3M }, base: 'tk' },
  deliveryOrders:     { table: 'delivery_orders',     pk: 'id', dateFilter: { column: 'created_at', cutoff: CUTOFF_3M }, base: 'tk' },
  clients:            { table: 'clients',             pk: 'id', base: 'tk' },
  salesReports:       { table: 'sales_reports',       pk: 'month', base: 'tk' },
  shipmentRegistry:   { table: 'shipment_registry',   pk: 'id', dateFilter: { column: 'created_at', cutoff: CUTOFF_6M }, base: 'tk' },
  dailyRevenue:       { table: 'daily_revenue',       pk: 'date', dateFilter: { column: 'date', cutoff: CUTOFF_6M } },
  managerTasks:       { table: 'manager_tasks',       pk: 'id', base: 'tk' },
  releaseNotes:       { table: 'release_notes',       pk: 'id' },
  scheduleTasks:      { table: 'schedule_tasks',      pk: 'id', base: 'coffeeshop' },
  scheduleCompletions: { table: 'schedule_completions', pk: 'id', dateFilter: { column: 'completed_at', cutoff: CUTOFF_3M }, base: 'coffeeshop' },
  gifts:              { table: 'gifts',               pk: 'id', dateFilter: { column: 'created_at', cutoff: CUTOFF_3M } },
  coffeeShipments:    { table: 'coffee_shipments',    pk: 'id', base: 'coffeeshop' },
  coffeeTasks:        { table: 'coffee_tasks',        pk: 'id', base: 'coffeeshop' },
  vacations:          { table: 'vacations',           pk: 'id' },
  cashOperations:     { table: 'cash_operations',     pk: 'id' },
  expenseCategories:  { table: 'expense_categories',  pk: 'id' },
  budgetEntries:      { table: 'budget_entries',      pk: 'id' },
  expenseRequests:    { table: 'expense_requests',    pk: 'id', dateFilter: { column: 'created_at', cutoff: CUTOFF_6M } },
  mppDeals:           { table: 'mpp_deals',           pk: 'id' },
  mppActivities:      { table: 'mpp_activities',      pk: 'id', dateFilter: { column: 'created_at', cutoff: CUTOFF_6M } },
  mppTasks:           { table: 'mpp_tasks',           pk: 'id' },
  mppDealProducts:    { table: 'mpp_deal_products',   pk: 'id' },
  mppComments:        { table: 'mpp_comments',        pk: 'id', dateFilter: { column: 'created_at', cutoff: CUTOFF_6M } },
  deferredClients:    { table: 'deferred_clients',    pk: 'id' },
  deferredShipments:  { table: 'deferred_shipments',  pk: 'id' },
  rentalEquipment:    { table: 'rental_equipment',    pk: 'id' },
  rentalClients:      { table: 'rental_clients',      pk: 'id' },
  rentalPurchases:    { table: 'rental_purchases',    pk: 'id' },
  rentalMovements:    { table: 'rental_movements',    pk: 'id' },
  rentalRevisions:    { table: 'rental_revisions',    pk: 'id' },
};

/**
 * Какие таблицы грузить для роли пользователя.
 * 'all' = admin/director — грузит всё.
 */
const COFFEESHOP_ROLES = ['coffee_manager', 'deputy_coffee_manager', 'chef_barista', 'chef_cook'];

export function getTablesForRole(role) {
  if (role === 'admin' || role === 'director') return Object.keys(SYNC_TABLES);

  const userBase = COFFEESHOP_ROLES.includes(role) ? 'coffeeshop' : 'tk';
  return Object.keys(SYNC_TABLES).filter(k => {
    const cfg = SYNC_TABLES[k];
    if (!cfg.base) return true;
    return cfg.base === userBase;
  });
}

/**
 * Загрузить строки таблицы (с учётом dateFilter)
 */
export const fetchAllOfTable = async (stateKey) => {
  const cfg = SYNC_TABLES[stateKey];
  if (!cfg) throw new Error(`Unknown table: ${stateKey}`);
  const PAGE = 1000;
  let all = [];
  let from = 0;
  while (true) {
    let query = supabase.from(cfg.table).select('*').range(from, from + PAGE - 1);
    if (cfg.dateFilter) {
      query = query.gte(cfg.dateFilter.column, cfg.dateFilter.cutoff());
    }
    const { data, error } = await query;
    if (error) throw error;
    const rows = data || [];
    all = all.concat(rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return all;
};

/**
 * Вставить или обновить строку в таблице
 */
export const upsertRow = async (stateKey, row) => {
  const cfg = SYNC_TABLES[stateKey];
  if (!cfg) throw new Error(`Unknown table: ${stateKey}`);
  const { error } = await supabase
    .from(cfg.table)
    .upsert([row], { onConflict: cfg.pk });
  if (error) throw error;
};

/**
 * Удалить строку из таблицы
 */
export const deleteRow = async (stateKey, pkValue) => {
  const cfg = SYNC_TABLES[stateKey];
  if (!cfg) throw new Error(`Unknown table: ${stateKey}`);
  const { error } = await supabase
    .from(cfg.table)
    .delete()
    .eq(cfg.pk, pkValue);
  if (error) throw error;
};

/**
 * Подписаться на realtime с инкрементальным обновлением (без перекачки).
 * callback получает { eventType, new, old } — обновляем только затронутую строку.
 */
export const subscribeToTable = (stateKey, callback) => {
  const cfg = SYNC_TABLES[stateKey];
  if (!cfg) {
    console.warn(`[subscribeToTable] Unknown table: ${stateKey}`);
    return null;
  }
  return supabase
    .channel(`rt-${stateKey}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: cfg.table }, (payload) => {
      callback(payload);
    })
    .subscribe();
};
