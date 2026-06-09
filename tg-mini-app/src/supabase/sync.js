// ═════════════════════════════════════════════════════════════════════════
// src/supabase/sync.js — универсальная синхронизация всех таблиц
// ═════════════════════════════════════════════════════════════════════════

import { supabase } from './client';

// Конфиг всех синхронизируемых таблиц.
// ВАЖНО: ключи объекта должны совпадать с ключами состояния в db (camelCase),
// а поле table — с именем таблицы в Supabase (snake_case).
export const SYNC_TABLES = {
  orders:             { table: 'orders',            pk: 'id' },
  grindRequests:      { table: 'grind_requests',    pk: 'id' },
  tasks:              { table: 'tasks',             pk: 'id' },
  writeOffs:          { table: 'write_offs',        pk: 'id' },
  contractRequests:   { table: 'contract_requests', pk: 'id' },
  notifications:      { table: 'notifications',     pk: 'id' },
  roleDefinitions:      { table: 'role_definitions',    pk: 'key' },
  telegramLog:          { table: 'telegram_log',        pk: 'id'  },
  deliveryRegistries:   { table: 'delivery_registries', pk: 'id'  },
  deliveryOrders:       { table: 'delivery_orders',     pk: 'id'  },
  clients:              { table: 'clients',             pk: 'id'  },
  salesReports:         { table: 'sales_reports',       pk: 'month' },
  shipmentRegistry:     { table: 'shipment_registry',   pk: 'id' },
  dailyRevenue:         { table: 'daily_revenue',        pk: 'date' },
  managerTasks:         { table: 'manager_tasks',         pk: 'id' },
  releaseNotes:         { table: 'release_notes',          pk: 'id' },
  scheduleTasks:        { table: 'schedule_tasks',         pk: 'id' },
  scheduleCompletions:  { table: 'schedule_completions',   pk: 'id' },
  // feedback_messages и error_reports пишутся напрямую через supabase.from(),
  // поэтому их не включаем в автосинхронизацию.
};

/**
 * Загрузить все строки таблицы из Supabase
 */
export const fetchAllOfTable = async (stateKey) => {
  const cfg = SYNC_TABLES[stateKey];
  if (!cfg) throw new Error(`Unknown table: ${stateKey}`);
  const { data, error } = await supabase.from(cfg.table).select('*');
  if (error) throw error;
  return data || [];
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
 * Подписаться на realtime обновления таблицы
 */
export const subscribeToTable = (stateKey, callback) => {
  const cfg = SYNC_TABLES[stateKey];
  if (!cfg) {
    console.warn(`[subscribeToTable] Unknown table: ${stateKey}`);
    return null;
  }
  return supabase
    .channel(`rt-${stateKey}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: cfg.table }, callback)
    .subscribe();
};
