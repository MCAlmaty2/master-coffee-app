import { supabase } from './client';

export async function fetchAllProducts(orgId) {
  let query = supabase
    .from('products')
    .select('*')
    .order('cat', { ascending: true })
    .order('name', { ascending: true });
  if (orgId) query = query.eq('org_id', orgId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function createProductInDb(product) {
  const { data, error } = await supabase
    .from('products')
    .insert({
      id: product.id,
      cat: product.cat,
      name: product.name,
      unit: product.unit,
      price: product.price,
      active: product.active ?? true,
      ...(product.ntin ? { ntin: product.ntin } : {}),
      ...(product.org_id ? { org_id: product.org_id } : {}),
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateProductInDb(productId, patch) {
  const { data, error } = await supabase
    .from('products')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', productId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteProductInDb(productId) {
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', productId);
  if (error) throw error;
}

/** Залить начальный прайс-лист в БД (если products пустая). Использует upsert,
 * чтобы повторный запуск не падал на duplicate key, если предыдущая попытка
 * прервалась посередине. */
export async function seedProductsIfEmpty(seedList, orgId) {
  const { count, error: cntErr } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true });
  if (cntErr) throw cntErr;
  if ((count || 0) > 0) return { seeded: false, existing: count };
  const rows = seedList.map(p => ({
    id: p.id, cat: p.cat, name: p.name, unit: p.unit, price: p.price, active: p.active ?? true,
    ...(orgId ? { org_id: orgId } : {}),
  }));
  const { error } = await supabase.from('products').upsert(rows, { onConflict: 'id' });
  if (error) throw error;
  return { seeded: true, count: rows.length };
}
