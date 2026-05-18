// ═════════════════════════════════════════════════════════════════════════
// src/supabase/sync.js — универсальная синхронизация всех таблиц
// ═════════════════════════════════════════════════════════════════════════

import { supabase } from './client';

// Конфиг всех синхронизируемых таблиц
export const SYNC_TABLES = {
  orders:              { table: 'orders', pk: 'id' },
  grind_requests:      { table: 'grind_requests', pk: 'id' },
  tasks:               { table: 'tasks', pk: 'id' },
  write_offs:          { table: 'write_offs', pk: 'id' },
  contract_requests:   { table: 'contract_requests', pk: 'id' },
  notifications:       { table: 'notifications', pk: 'id' },
  role_definitions:    { table: 'role_definitions', pk: 'key' },
  telegram_settings:   { table: 'telegram_settings', pk: 'id' },
  telegram_log:        { table: 'telegram_log', pk: 'id' },
  feedback_messages:   { table: 'feedback_messages', pk: 'id' },
  error_reports:       { table: 'error_reports', pk: 'id' },
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
