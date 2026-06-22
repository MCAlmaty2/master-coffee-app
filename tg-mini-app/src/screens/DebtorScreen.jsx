import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, Search, Upload, RefreshCw, Settings, Loader2, X, FileSpreadsheet, Trash2 } from 'lucide-react';
import { supabase } from '../supabase/client';
import * as XLSX from 'xlsx';

const BU_NAMES = ['ТОО', 'MCR', 'MC', 'MCF'];

function getMonday(weeksAgo = 0) {
  const now = new Date();
  now.setHours(now.getHours() + 5);
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  now.setDate(now.getDate() - diff - weeksAgo * 7);
  return `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function fmtMoney(val) {
  const num = Number(val);
  if (!num || isNaN(num)) return '0';
  return Math.round(num).toLocaleString('ru-RU');
}

function isInvoiceLine(name) {
  if (!name) return true;
  const n = String(name).trim();
  return !n || n.startsWith('Реализация товаров') ||
    n.startsWith('Заказ клиента') ||
    n.startsWith('Возврат товаров') ||
    n.startsWith('Корректировка реализации');
}

function detectBU(sheetName) {
  for (const bu of BU_NAMES) {
    if (sheetName.startsWith(bu + ' ')) return bu;
  }
  return null;
}

function detectWeekDate(sheetName) {
  const m = sheetName.match(/(\d{2}\.\d{2})$/);
  return m ? m[1] : null;
}

function parseRows(rows) {
  if (!rows || rows.length < 2) return [];
  return rows.slice(1)
    .filter(r => r[0] && !isInvoiceLine(r[0]) && String(r[0]) !== String(rows[0]?.[0]))
    .map(r => ({
      client: String(r[0] || '').trim(),
      balance: Number(r[1]) || 0,
      reconciliation: Number(r[2]) || 0,
      paid_orders: Number(r[3]) || 0,
      paid_items: Number(r[4]) || 0,
      actual_debt: Number(r[5]) || 0,
      comment: String(r[6] || '').trim(),
    }))
    .filter(r => r.balance > 0 || r.actual_debt > 0);
}

function parseXlsxSheet(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  return parseRows(rows);
}

async function saveToSupabase(bu, wd, clients, userId) {
  await supabase.from('debtor_records')
    .delete().eq('business_unit', bu).eq('week_date', wd);
  if (!clients.length) return 0;
  const records = clients.map(c => ({
    business_unit: bu, week_date: wd, uploaded_by: userId,
    client: c.client, balance: c.balance, reconciliation: c.reconciliation,
    paid_orders: c.paid_orders, paid_items: c.paid_items,
    actual_debt: c.actual_debt, comment: c.comment,
  }));
  const { error } = await supabase.from('debtor_records').insert(records);
  if (error) throw error;
  return clients.length;
}

export default function DebtorScreen({ ctx }) {
  const { db, setDb, currentUser, setRoute, showToast } = ctx;
  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'director';

  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [data, setData] = useState({});
  const [activeBU, setActiveBU] = useState('ТОО');
  const [search, setSearch] = useState('');
  const [weekLabel, setWeekLabel] = useState('');
  const [weeks, setWeeks] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [sheetUrl, setSheetUrl] = useState(db.telegramSettings?.debtor_sheet_url || '');
  const fileRef = useRef(null);

  const savedUrl = db.telegramSettings?.debtor_sheet_url;

  const loadData = useCallback(async (targetWeek) => {
    setLoading(true);
    try {
      let query = supabase.from('debtor_records').select('*');
      if (targetWeek) {
        query = query.eq('week_date', targetWeek);
      } else {
        const { data: latest } = await supabase
          .from('debtor_records').select('week_date')
          .order('uploaded_at', { ascending: false }).limit(1);
        if (!latest?.length) { setLoading(false); return; }
        query = query.eq('week_date', latest[0].week_date);
      }
      const { data: rows, error } = await query.order('balance', { ascending: false });
      if (error) throw error;
      if (!rows?.length) { setData({}); setWeekLabel(''); setLoading(false); return; }
      const parsed = {};
      BU_NAMES.forEach(bu => { parsed[bu] = []; });
      rows.forEach(r => { if (parsed[r.business_unit]) parsed[r.business_unit].push(r); });
      setData(parsed);
      setWeekLabel(rows[0].week_date);
    } catch (e) {
      showToast('Ошибка загрузки: ' + e.message);
    }
    setLoading(false);
  }, [showToast]);

  const loadWeeks = useCallback(async () => {
    const { data: wks } = await supabase
      .from('debtor_records').select('week_date')
      .order('uploaded_at', { ascending: false });
    if (wks) setWeeks([...new Set(wks.map(w => w.week_date))]);
  }, []);

  useEffect(() => { loadData(); loadWeeks(); }, [loadData, loadWeeks]);

  async function syncFromGoogle() {
    if (!savedUrl) { showToast('Сначала укажите URL таблицы'); return; }
    setSyncing(true);
    try {
      let imported = 0;
      let weekDate = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        const monday = getMonday(attempt);
        const sheets = BU_NAMES.map(bu => `${bu} ${monday}`);
        const { data: result, error: fnErr } = await supabase.functions.invoke('fetch-google-sheet', {
          body: { url: savedUrl, sheets },
        });
        if (fnErr) throw new Error(fnErr.message || 'Ошибка запроса');
        if (!result?.ok) throw new Error(result?.error || 'Неизвестная ошибка');

        let hasAny = false;
        for (let i = 0; i < BU_NAMES.length; i++) {
          const rows = result.data[sheets[i]];
          if (rows?.error || !Array.isArray(rows) || rows.length < 2) continue;
          const clients = parseRows(rows);
          if (!clients.length) continue;
          hasAny = true;
          weekDate = monday;
          imported += await saveToSupabase(BU_NAMES[i], monday, clients, currentUser.id);
        }
        if (hasAny) break;
      }
      if (imported === 0) {
        showToast('Нет данных за последние 3 недели');
      } else {
        showToast(`Синхронизировано: ${imported} клиентов (${weekDate})`);
        loadData(weekDate);
        loadWeeks();
      }
    } catch (err) {
      showToast('Ошибка синхронизации: ' + err.message);
    }
    setSyncing(false);
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab, { type: 'array' });
      let imported = 0, weekDate = '';
      for (const name of wb.SheetNames) {
        const bu = detectBU(name);
        const wd = detectWeekDate(name);
        if (!bu || !wd) continue;
        weekDate = wd;
        const clients = parseXlsxSheet(wb.Sheets[name]);
        imported += await saveToSupabase(bu, wd, clients, currentUser.id);
      }
      if (imported === 0) {
        showToast('Не найдены листы формата "ТОО ДД.ММ"');
      } else {
        showToast(`Загружено: ${imported} клиентов (${weekDate})`);
        setShowModal(false);
        loadData(weekDate);
        loadWeeks();
      }
    } catch (err) {
      showToast('Ошибка: ' + err.message);
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  function saveSettings() {
    const url = sheetUrl.trim();
    if (url && !url.includes('docs.google.com/spreadsheets')) {
      showToast('Вставьте ссылку на Google таблицу');
      return;
    }
    setDb(d => ({
      ...d,
      telegramSettings: { ...d.telegramSettings, debtor_sheet_url: url },
    }));
    supabase.from('telegram_settings').update({ debtor_sheet_url: url }).eq('id', 1);
    showToast(url ? 'URL сохранён' : 'URL удалён');
  }

  async function deleteWeek(wd) {
    if (!confirm(`Удалить данные за ${wd}?`)) return;
    await supabase.from('debtor_records').delete().eq('week_date', wd);
    showToast(`Данные за ${wd} удалены`);
    loadData();
    loadWeeks();
  }

  const filtered = useMemo(() => {
    const items = data[activeBU] || [];
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(r => r.client.toLowerCase().includes(q));
  }, [data, activeBU, search]);

  const totalDebt = useMemo(() => filtered.reduce((s, r) => s + (Number(r.balance) || 0), 0), [filtered]);
  const hasData = Object.values(data).some(arr => arr.length > 0);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--mc-bg)' }}>
      {/* Header */}
      <div className="sticky top-0 z-30 px-4 py-3 flex items-center gap-3"
        style={{ background: 'var(--mc-surface)', borderBottom: '1px solid var(--mc-border)' }}>
        <button onClick={() => setRoute({ name: 'home' })} className="p-1">
          <ChevronLeft size={20} style={{ color: 'var(--mc-text)' }} />
        </button>
        <div className="flex-1">
          <div className="font-semibold" style={{ color: 'var(--mc-text)' }}>Дебиторка</div>
          {weekLabel && <div className="text-xs" style={{ color: '#64748B' }}>Данные на {weekLabel}</div>}
        </div>
        {isAdmin && savedUrl && (
          <button onClick={syncFromGoogle} className="p-2 rounded-lg" style={{ color: '#297B8A' }}
            disabled={syncing}>
            <RefreshCw size={18} className={syncing ? 'animate-spin' : ''} />
          </button>
        )}
        {isAdmin && (
          <button onClick={() => setShowModal(true)} className="p-2 rounded-lg" style={{ color: '#64748B' }}>
            <Settings size={18} />
          </button>
        )}
      </div>

      {/* Settings / Upload modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div className="rounded-xl p-4 w-full max-w-md" style={{ background: 'var(--mc-surface)' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold" style={{ color: 'var(--mc-text)' }}>Настройки дебиторки</div>
              <button onClick={() => setShowModal(false)}><X size={18} style={{ color: '#64748B' }} /></button>
            </div>

            {/* Google Sheets URL */}
            <div className="mb-4">
              <div className="text-xs font-medium mb-1.5" style={{ color: 'var(--mc-text)' }}>Google Sheets (авто-синк)</div>
              <div className="flex gap-2">
                <input
                  className="flex-1 px-3 py-2 rounded-lg border text-sm"
                  style={{ borderColor: 'var(--mc-border)', color: 'var(--mc-text)', background: 'var(--mc-bg)' }}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  value={sheetUrl}
                  onChange={e => setSheetUrl(e.target.value)}
                />
                <button onClick={saveSettings}
                  className="px-3 py-2 rounded-lg text-sm text-white"
                  style={{ background: '#297B8A' }}>OK</button>
              </div>
              <div className="text-xs mt-1.5 space-y-0.5" style={{ color: '#64748B' }}>
                <p>Таблица должна быть доступна по ссылке (Поделиться → Все у кого есть ссылка).</p>
                <p>Листы: <code className="px-1 rounded" style={{ background: 'var(--mc-bg)' }}>ТОО ДД.ММ</code>,{' '}
                  <code className="px-1 rounded" style={{ background: 'var(--mc-bg)' }}>MCR ДД.ММ</code> и т.д.</p>
                <p>API-ключ хранится в Supabase Secrets (GOOGLE_API_KEY).</p>
              </div>
              {savedUrl && (
                <button onClick={() => { setShowModal(false); syncFromGoogle(); }}
                  className="w-full mt-2 py-2 rounded-lg text-sm text-white flex items-center justify-center gap-2"
                  style={{ background: '#297B8A' }} disabled={syncing}>
                  <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
                  Синхронизировать из Google
                </button>
              )}
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 border-t" style={{ borderColor: 'var(--mc-border)' }} />
              <div className="text-xs" style={{ color: '#94A3B8' }}>или</div>
              <div className="flex-1 border-t" style={{ borderColor: 'var(--mc-border)' }} />
            </div>

            {/* File upload */}
            <div className="text-xs font-medium mb-1.5" style={{ color: 'var(--mc-text)' }}>Загрузить файл вручную</div>
            <label className="block rounded-xl p-5 text-center cursor-pointer border-2 border-dashed"
              style={{ borderColor: 'var(--mc-border)', color: '#64748B' }}>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleFile}
                className="hidden" disabled={uploading} />
              {uploading ? (
                <>
                  <Loader2 size={28} className="mx-auto mb-2 animate-spin" style={{ color: '#297B8A' }} />
                  <div className="text-sm">Загрузка...</div>
                </>
              ) : (
                <>
                  <FileSpreadsheet size={28} className="mx-auto mb-2 opacity-50" />
                  <div className="text-sm font-medium" style={{ color: 'var(--mc-text)' }}>
                    Нажмите для выбора .xlsx файла
                  </div>
                </>
              )}
            </label>

            {/* Loaded weeks */}
            {weeks.length > 0 && (
              <div className="mt-4">
                <div className="text-xs font-medium mb-2" style={{ color: 'var(--mc-text)' }}>Загруженные недели:</div>
                <div className="flex flex-wrap gap-1.5">
                  {weeks.map(w => (
                    <div key={w} className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs"
                      style={{ background: w === weekLabel ? '#297B8A' : 'var(--mc-bg)',
                        color: w === weekLabel ? '#fff' : 'var(--mc-text)',
                        border: '1px solid var(--mc-border)' }}>
                      <button onClick={() => { loadData(w); setShowModal(false); }}>{w}</button>
                      <button onClick={() => deleteWeek(w)} className="ml-1 opacity-60 hover:opacity-100">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="p-8 text-center">
          <Loader2 size={28} className="animate-spin mx-auto" style={{ color: '#297B8A' }} />
          <div className="text-sm mt-2" style={{ color: '#64748B' }}>Загрузка данных...</div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !hasData && (
        <div className="p-6 text-center" style={{ color: '#64748B' }}>
          <FileSpreadsheet size={40} className="mx-auto mb-3 opacity-40" />
          <div className="text-sm">Данных ещё нет</div>
          {isAdmin && (
            <button onClick={() => setShowModal(true)}
              className="mt-3 px-4 py-2 rounded-lg text-sm text-white"
              style={{ background: '#297B8A' }}>Настроить</button>
          )}
        </div>
      )}

      {/* Data view */}
      {!loading && hasData && (
        <>
          <div className="px-4 pt-3 pb-2">
            <div className="rounded-xl p-3"
              style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
              <div className="text-xs" style={{ color: '#64748B' }}>Общий долг · {activeBU}</div>
              <div className="text-xl font-bold mt-1"
                style={{ color: totalDebt > 0 ? '#DC2626' : '#16A34A' }}>
                {fmtMoney(totalDebt)} ₸
              </div>
              <div className="text-xs mt-1" style={{ color: '#64748B' }}>
                {filtered.length} {filtered.length === 1 ? 'клиент' : 'клиентов'}
              </div>
            </div>
          </div>

          <div className="px-4 flex gap-1 overflow-x-auto pb-2">
            {BU_NAMES.map(bu => (
              <button key={bu}
                className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap"
                style={{
                  background: activeBU === bu ? '#297B8A' : 'var(--mc-surface)',
                  color: activeBU === bu ? '#fff' : 'var(--mc-text)',
                  border: activeBU === bu ? 'none' : '1px solid var(--mc-border)',
                }}
                onClick={() => setActiveBU(bu)}>
                {bu}{(data[bu] || []).length > 0 ? ` (${(data[bu] || []).length})` : ''}
              </button>
            ))}
          </div>

          <div className="px-4 pb-2">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#94A3B8' }} />
              <input
                className="w-full pl-9 pr-3 py-2 rounded-lg text-sm"
                style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', color: 'var(--mc-text)' }}
                placeholder="Поиск клиента..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="px-4 pb-20">
            {filtered.length === 0 ? (
              <div className="text-center py-8 text-sm" style={{ color: '#64748B' }}>
                {search ? 'Ничего не найдено' : 'Нет данных'}
              </div>
            ) : (
              <div className="space-y-1.5">
                {filtered.map((r, i) => (
                  <div key={r.id || i} className="rounded-lg p-3"
                    style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
                    <div className="flex justify-between items-start gap-2">
                      <div className="text-sm font-medium flex-1 min-w-0 truncate"
                        style={{ color: 'var(--mc-text)' }}>{r.client}</div>
                      <div className="text-sm font-bold whitespace-nowrap" style={{ color: '#DC2626' }}>
                        {fmtMoney(r.balance)} ₸
                      </div>
                    </div>
                    {Number(r.actual_debt) > 0 && Number(r.actual_debt) !== Number(r.balance) && (
                      <div className="flex justify-between mt-1">
                        <span className="text-xs" style={{ color: '#64748B' }}>Фактическая</span>
                        <span className="text-xs font-medium" style={{ color: '#F59E0B' }}>
                          {fmtMoney(r.actual_debt)} ₸
                        </span>
                      </div>
                    )}
                    {r.comment && (
                      <div className="text-xs mt-1 truncate" style={{ color: '#64748B' }}>{r.comment}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function DebtorHomeTile({ ctx }) {
  const { navigate } = ctx;
  const [stats, setStats] = useState(null);

  useEffect(() => {
    (async () => {
      const { data: latest } = await supabase
        .from('debtor_records').select('week_date')
        .order('uploaded_at', { ascending: false }).limit(1);
      if (!latest?.length) return;
      const wd = latest[0].week_date;
      const { data: rows } = await supabase
        .from('debtor_records').select('business_unit, balance, actual_debt')
        .eq('week_date', wd);
      if (!rows?.length) return;

      const byBU = {};
      BU_NAMES.forEach(bu => { byBU[bu] = { count: 0, total: 0 }; });
      let total = 0, clients = 0;
      rows.forEach(r => {
        const b = Number(r.balance) || 0;
        total += b;
        clients++;
        if (byBU[r.business_unit]) {
          byBU[r.business_unit].count++;
          byBU[r.business_unit].total += b;
        }
      });
      setStats({ weekDate: wd, total, clients, byBU });
    })();
  }, []);

  if (!stats) return null;

  const fmt = (v) => {
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + ' M';
    if (v >= 1_000) return (v / 1_000).toFixed(0) + ' K';
    return Math.round(v).toLocaleString('ru-RU');
  };

  return (
    <div
      onClick={() => navigate({ name: 'debtors' })}
      style={{
        background: 'linear-gradient(135deg, #1a0000 0%, #4a1111 50%, #7f1d1d 100%)',
        borderRadius: 18, padding: '18px 18px 16px', cursor: 'pointer', marginBottom: 16,
        border: '1px solid rgba(255,255,255,.08)', boxShadow: '0 4px 24px rgba(0,0,0,.25)',
        transition: 'transform .15s, box-shadow .15s', position: 'relative', overflow: 'hidden',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,.35)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 4px 24px rgba(0,0,0,.25)'; }}
    >
      <div style={{ position: 'absolute', top: -30, right: -30, width: 120, height: 120, borderRadius: '50%', background: 'rgba(220,38,38,.15)', pointerEvents: 'none' }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', letterSpacing: .2 }}>💳 Дебиторка</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', marginTop: 2 }}>Данные на {stats.weekDate}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(255,255,255,.1)', borderRadius: 8, padding: '4px 10px' }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,.7)', fontWeight: 600 }}>Подробнее</span>
          <ChevronRight size={13} style={{ color: 'rgba(255,255,255,.5)' }} />
        </div>
      </div>

      <div style={{ background: 'rgba(255,255,255,.07)', borderRadius: 13, padding: '12px 14px', border: '1px solid rgba(255,255,255,.06)', marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.5)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 6 }}>Общая задолженность</div>
        <div style={{ fontSize: 30, fontWeight: 900, color: '#f87171', lineHeight: 1, letterSpacing: -1 }}>
          {fmt(stats.total)} ₸
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', marginTop: 6 }}>
          {stats.clients} {stats.clients === 1 ? 'клиент' : stats.clients < 5 ? 'клиента' : 'клиентов'}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {BU_NAMES.map(bu => {
          const s = stats.byBU[bu];
          return (
            <div key={bu} style={{ background: 'rgba(255,255,255,.07)', borderRadius: 10, padding: '8px 6px', textAlign: 'center', border: '1px solid rgba(255,255,255,.06)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.5)', marginBottom: 4 }}>{bu}</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: s.total > 0 ? '#fca5a5' : 'rgba(255,255,255,.3)' }}>
                {s.total > 0 ? fmt(s.total) : '—'}
              </div>
              {s.count > 0 && (
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,.4)', marginTop: 2 }}>{s.count} кл.</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
