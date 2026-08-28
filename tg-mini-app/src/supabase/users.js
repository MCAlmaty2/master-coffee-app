import { supabase } from './client';

const SAFE_SELECT = 'id, telegram_id, tg_username, first_name, last_name, photo_url, role, active, created_at, approved_at, approved_by, tg_notif_enabled, tg_notif_prefs, home_prefs, birth_date, org_id, is_super_admin';

export async function fetchAllUsers(orgId) {
  let query = supabase
    .from('users_safe')
    .select('*')
    .order('created_at', { ascending: false });
  if (orgId) query = query.eq('org_id', orgId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function findUserByTelegramId(telegramId) {
  const tgId = String(telegramId);
  const { data, error } = await supabase
    .from('users_safe')
    .select('*')
    .eq('telegram_id', tgId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createPendingUserFromTelegram(tgUser, orgId) {
  const payload = {
    telegram_id: String(tgUser.id),
    tg_username: tgUser.username || null,
    first_name: tgUser.first_name || 'Без имени',
    last_name: tgUser.last_name || '',
    photo_url: tgUser.photo_url || null,
    role: 'pending',
    active: false,
    ...(orgId ? { org_id: orgId } : {}),
  };
  const { data, error } = await supabase
    .from('users')
    .insert(payload)
    .select(SAFE_SELECT)
    .single();
  if (error) throw error;
  return data;
}

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
    .select(SAFE_SELECT)
    .single();
  if (error) throw error;
  return data;
}

export async function updateUserRoleInDb(userId, role) {
  const { data, error } = await supabase
    .from('users')
    .update({ role })
    .eq('id', userId)
    .select(SAFE_SELECT)
    .single();
  if (error) throw error;
  return data;
}

export async function deactivateUserInDb(userId) {
  const { data, error } = await supabase
    .from('users')
    .update({ active: false })
    .eq('id', userId)
    .select(SAFE_SELECT)
    .single();
  if (error) throw error;
  return data;
}

export async function activateUserInDb(userId) {
  const { data, error } = await supabase
    .from('users')
    .update({ active: true })
    .eq('id', userId)
    .select(SAFE_SELECT)
    .single();
  if (error) throw error;
  return data;
}

export async function deleteUserInDb(userId) {
  const { error } = await supabase
    .from('users')
    .delete()
    .eq('id', userId);
  if (error) throw error;
}

export async function findUserByWebToken(token) {
  const { data, error } = await supabase.functions.invoke('verify-web-token', {
    body: { token },
  });
  if (error) throw error;
  return data?.user || null;
}

export async function verifyPin(pin) {
  const { data, error } = await supabase.functions.invoke('verify-pin', {
    body: { pin },
  });
  if (error) throw error;
  return data;
}

export async function setWebTokenInDb(userId, token) {
  const { error } = await supabase
    .from('users')
    .update({ web_token: token })
    .eq('id', userId);
  if (error) throw error;
}

export async function setPinHashInDb(userId, pinHash) {
  const { error } = await supabase
    .from('users')
    .update({ pin_hash: pinHash })
    .eq('id', userId);
  if (error) throw error;
}
