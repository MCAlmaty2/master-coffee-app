import { supabase } from './client';

/** Маппинг полей: в БД snake_case, в коде осталось почти то же самое.
 * Совместимость: id, telegram_id, first_name, last_name, role, active, photo_url
 * Поля из старого кода, которых нет в БД: email, password — теперь не используются.
 */

export async function fetchAllUsers() {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Поиск пользователя по Telegram ID */
export async function findUserByTelegramId(telegramId) {
  const tgId = String(telegramId);
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', tgId)
    .maybeSingle();
  if (error) throw error;
  return data; // null если не найден
}

/** Создать pending-юзера при первом входе через Telegram */
export async function createPendingUserFromTelegram(tgUser) {
  const payload = {
    telegram_id: String(tgUser.id),
    tg_username: tgUser.username || null,
    first_name: tgUser.first_name || 'Без имени',
    last_name: tgUser.last_name || '',
    photo_url: tgUser.photo_url || null,
    role: 'pending',
    active: false,
  };
  const { data, error } = await supabase
    .from('users')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Админ подтверждает пользователя: назначает роль + active = true */
export async function approveUser(userId, role, approverId) {
  const { data, error } = await supabase
    .from('users')
    .update({
      role,
      active: true,
      approved_at: new Date().toISOString(),
      approved_by: approverId,
    })
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Сменить роль уже активному пользователю */
export async function updateUserRoleInDb(userId, role) {
  const { data, error } = await supabase
    .from('users')
    .update({ role })
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Отключить пользователя */
export async function deactivateUserInDb(userId) {
  const { data, error } = await supabase
    .from('users')
    .update({ active: false })
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Включить пользователя обратно */
export async function activateUserInDb(userId) {
  const { data, error } = await supabase
    .from('users')
    .update({ active: true })
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Удалить pending-заявку (если админ отклоняет вход) */
export async function deleteUserInDb(userId) {
  const { error } = await supabase
    .from('users')
    .delete()
    .eq('id', userId);
  if (error) throw error;
}

/** Найти активного пользователя по web_token (для входа в браузере) */
export async function findUserByWebToken(token) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('web_token', token)
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  return data; // null если не найден
}

/** Сохранить web_token пользователю (генерируется на клиенте как UUID) */
export async function setWebTokenInDb(userId, token) {
  const { data, error } = await supabase
    .from('users')
    .update({ web_token: token })
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Установить или сбросить PIN-хеш пользователя (null — удаляет PIN) */
export async function setPinHashInDb(userId, pinHash) {
  const { data, error } = await supabase
    .from('users')
    .update({ pin_hash: pinHash })
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}
