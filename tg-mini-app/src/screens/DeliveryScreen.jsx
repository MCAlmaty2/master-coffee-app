// ═══════════════════════════════════════════════════════════════════════════
// src/screens/DeliveryScreen.jsx — Модуль курьерской доставки
// Менеджер: список реестров, загрузка xlsx, детали, нерастворённые заказы
// Курьер:   пул заказов (взять себе), мои заказы, отметить доставку
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState, useRef } from 'react';
import {
  ChevronLeft, Plus, Upload, CheckCircle2, XCircle,
  Truck, Package, ChevronRight, Phone,
} from 'lucide-react';
import { supabase } from '../supabase/client';

// ─── Локальные утилиты ───────────────────────────────────────────────────

const TZ = 'Asia/Almaty';
const todayISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
const fmtDate  = (iso) => new Date(iso).toLocaleDateString('ru-KZ', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: TZ });
const fmtNum   = (n)   => (Number(n) || 0).toLocaleString('ru-RU').replace(/\s/g, ' ');
const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID)
  ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });

// ─── Константы ───────────────────────────────────────────────────────────

const SHIFT_LABEL = { morning: '☀️ Утренний', evening: '🌙 Вечерний' };

const STATUS_CFG = {
  pending:   { bg: '#FEF9EE', text: '#92400E', border: '#FDE68A', label: 'Свободен'      },
  assigned:  { bg: '#EFF6FF', text: '#1D4ED8', border: '#BFDBFE', label: 'В работе'      },
  delivered: { bg: '#D1FAE5', text: '#065F46', border: '#6EE7B7', label: '✓ Доставлен'   },
  failed:    { bg: '#FEE2E2', text: '#991B1B', border: '#FCA5A5', label: '✗ Не доставлен' },
};

// 1C column headers → DB field names
const COL_MAP = {
  '№п/п':                                        'seq_number',
  'Организация':                                 'organization',
  'Контрагент':                                  'client',
  'Документ':                                    'document',
  'Информация по оплате':                        'payment_info',
  'Город':                                       'city',
  'Адрес доставки':                              'address',
  'Контакты':                                    'contacts',
  'Дополнительная информация по доставке':       'extra_info',
  'Код заявки':                                  'request_code',
  'Способ доставки':                             'delivery_method',
  'Сумма взаиморасчетов':                        'amount',
};

// ─── Helpers ─────────────────────────────────────────────────────────────

// Нормализация заголовка: убрать BOM, свернуть пробелы, нижний регистр
const normKey = (v) => String(v).replace(/^﻿/, '').replace(/\s+/g, ' ').trim().toLowerCase();

// COL_MAP с нормализованными ключами для поиска без учёта регистра
const COL_MAP_LOWER = Object.fromEntries(
  Object.entries(COL_MAP).map(([k, v]) => [normKey(k), v])
);

// parseFile возвращает { rows, detectedHeaders, headerIdx }
async function parseFile(file) {
  const XLSX  = await import('xlsx');
  const isCsv = /\.csv$/i.test(file.name);
  let wb;
  if (isCsv) {
    const text = await file.text();
    wb = XLSX.read(text, { type: 'string' });
  } else {
    const buf = await file.arrayBuffer();
    wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
  }
  const ws = wb.Sheets[wb.SheetNames[0]];

  // Читаем всё как массивы, чтобы самостоятельно найти строку заголовков
  const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!allRows.length) return { rows: [], detectedHeaders: [], headerIdx: -1 };

  // Ищем строку заголовков: первая из первых 15 строк, где ≥ 2 совпадения с COL_MAP
  let headerIdx = 0;
  let bestScore = 0;
  for (let i = 0; i < Math.min(allRows.length, 15); i++) {
    const score = allRows[i].filter(c => COL_MAP_LOWER[normKey(c)] !== undefined).length;
    if (score > bestScore) { bestScore = score; headerIdx = i; }
    if (score >= 2) break;
  }

  // Строим массив заголовков
  const headers = allRows[headerIdx].map(c => String(c).replace(/^﻿/, '').replace(/\s+/g, ' ').trim());
  const headersLower = headers.map(normKey);

  // Данные — все строки после заголовка
  const rows = allRows.slice(headerIdx + 1)
    .map(rowArr => {
      const out = {};
      for (const [col, field] of Object.entries(COL_MAP)) {
        let idx = headers.indexOf(col);
        if (idx === -1) idx = headersLower.indexOf(normKey(col));
        out[field] = idx >= 0 ? (rowArr[idx] ?? '') : '';
      }
      out.seq_number = Number(out.seq_number) || 0;
      out.amount = Number(String(out.amount).replace(/\s/g, '').replace(',', '.')) || 0;
      return out;
    })
    .filter(r => r.client || r.address);

  return { rows, detectedHeaders: headers.filter(Boolean), headerIdx };
}

async function getNextRegNumber() {
  const year = new Date().getFullYear();
  const prefix = `РД-${year}-`;
  const { data } = await supabase
    .from('delivery_registries')
    .select('number')
    .like('number', `${prefix}%`)
    .order('number', { ascending: false })
    .limit(1);
  const last = data?.[0]?.number ? parseInt(data[0].number.slice(prefix.length)) : 0;
  return `${prefix}${String(last + 1).padStart(4, '0')}`;
}

// ─── Общие UI-блоки ──────────────────────────────────────────────────────

function ScreenHeader({ title, subtitle, onBack }) {
  return (
    <div style={{ background: '#297b8a', padding: '10px 16px 14px', flexShrink: 0 }}>
      {onBack && (
        <button onClick={onBack} style={{ color: 'rgba(255,255,255,.8)', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4, padding: 0 }}>
          <ChevronLeft size={14} /> Назад
        </button>
      )}
      <div style={{ color: '#fff', fontSize: 16, fontWeight: 700 }}>{title}</div>
      {subtitle && <div style={{ color: 'rgba(255,255,255,.7)', fontSize: 11, marginTop: 2 }}>{subtitle}</div>}
    </div>
  );
}

function Card({ children, style, onClick }) {
  return (
    <div onClick={onClick} style={{ background: '#fff', borderRadius: 14, padding: '12px 14px', marginBottom: 10, boxShadow: '0 1px 4px rgba(0,0,0,.06)', ...style }}>
      {children}
    </div>
  );
}

function StatusBadge({ status }) {
  const s = STATUS_CFG[status] || STATUS_CFG.pending;
  return (
    <span style={{ background: s.bg, color: s.text, border: `1px solid ${s.border}`, borderRadius: 8, padding: '2px 7px', fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  );
}

function ProgressBar({ done, total }) {
  const pct = total > 0 ? (done / total) * 100 : 0;
  return (
    <div style={{ height: 6, background: '#E5E7EB', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: '#297b8a', borderRadius: 3, transition: 'width .3s' }} />
    </div>
  );
}

function OrderRow({ order, action, onClick, dim, courierName }) {
  return (
    <div onClick={onClick}
      style={{ background: '#fff', borderRadius: 12, padding: '10px 12px', marginBottom: 6,
        opacity: dim ? .55 : 1, cursor: onClick ? 'pointer' : 'default',
        boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 3 }}>
        <div style={{ fontWeight: 700, fontSize: 11, color: '#1A1814', flex: 1, marginRight: 6 }}>{order.client}</div>
        {courierName
          ? <span style={{ background: '#EFF6FF', color: '#1D4ED8', borderRadius: 8, padding: '2px 7px', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>{courierName}</span>
          : <StatusBadge status={order.status} />
        }
      </div>
      <div style={{ fontSize: 9, color: '#94a3b8' }}>📍 {[order.city, order.address].filter(Boolean).join(' · ')}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 5 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#1A1814' }}>{fmtNum(order.amount)} тг</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {action}
          {onClick && !action && <ChevronRight size={14} color="#94a3b8" />}
          {dim && !action && <span style={{ fontSize: 9, color: '#94a3b8' }}>занято</span>}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// МЕНЕДЖЕРСКИЕ ЭКРАНЫ
// ═══════════════════════════════════════════════════════════════════════════

export function DeliveryRegistriesScreen({ ctx }) {
  const { db, navigate } = ctx;
  const [tab, setTab] = useState('active');

  const regs = (db.deliveryRegistries || [])
    .filter(r => tab === 'active' ? r.status === 'active' : r.status !== 'active')
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <div style={{ background: '#F5F7F8', minHeight: '100vh' }}>
      <ScreenHeader title="🚚 Доставки" subtitle={`Сегодня, ${new Date().toLocaleDateString('ru-KZ', { day: 'numeric', month: 'long', timeZone: TZ })}`} />

      <div style={{ display: 'flex', background: '#fff', borderBottom: '1px solid #F1F5F9' }}>
        {[['active', 'Активные'], ['archive', 'Архив']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ flex: 1, padding: '10px 4px', fontSize: 11, fontWeight: 600,
              color: tab === k ? '#297b8a' : '#94a3b8',
              borderBottom: `2px solid ${tab === k ? '#297b8a' : 'transparent'}`,
              background: 'none', border: 'none', cursor: 'pointer' }}>
            {l}
          </button>
        ))}
      </div>

      <div style={{ padding: 12 }}>
        {regs.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 20px', color: '#94a3b8' }}>
            <Truck size={36} style={{ margin: '0 auto 10px', opacity: .35 }} />
            <div style={{ fontSize: 13 }}>{tab === 'active' ? 'Нет активных реестров' : 'Архив пуст'}</div>
          </div>
        )}
        {regs.map(reg => <RegistryCard key={reg.id} reg={reg} db={db} onClick={() => navigate({ name: 'delivery_registry_detail', registryId: reg.id })} />)}
        {tab === 'active' && (
          <button onClick={() => navigate({ name: 'delivery_new_registry' })}
            style={{ width: '100%', padding: 12, background: '#297b8a', color: '#fff', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 4, cursor: 'pointer' }}>
            <Plus size={16} /> Новый реестр
          </button>
        )}
      </div>
    </div>
  );
}

function RegistryCard({ reg, db, onClick }) {
  const orders  = (db.deliveryOrders || []).filter(o => o.registry_id === reg.id);
  const done    = orders.filter(o => o.status === 'delivered').length;
  const failed  = orders.filter(o => o.status === 'failed' && !o.manager_decision).length;
  const cash    = orders.filter(o => o.cash_received).reduce((s, o) => s + (Number(o.cash_amount) || 0), 0);
  const couriers = [...new Set(orders.map(o => o.courier_id).filter(Boolean))]
    .map(id => db.users?.find(u => u.id === id)?.first_name).filter(Boolean);

  return (
    <Card style={{ cursor: 'pointer' }} onClick={onClick}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#1A1814' }}>{reg.number}</div>
          <div style={{ fontSize: 10, color: '#64748b' }}>{fmtDate(reg.date)} · {SHIFT_LABEL[reg.shift]}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
          {reg.status === 'active'
            ? <span style={{ background: '#D1FAE5', color: '#065F46', borderRadius: 10, padding: '2px 8px', fontSize: 9, fontWeight: 700 }}>● Активен</span>
            : <span style={{ background: '#F1F5F9', color: '#475569', borderRadius: 10, padding: '2px 8px', fontSize: 9, fontWeight: 700 }}>✓ Завершён</span>}
          {failed > 0 && <span style={{ background: '#FEE2E2', color: '#991B1B', borderRadius: 10, padding: '2px 8px', fontSize: 9, fontWeight: 700 }}>⚠ {failed} нерастр.</span>}
        </div>
      </div>
      <ProgressBar done={done} total={reg.total_orders || orders.length} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#64748b', marginTop: 4 }}>
        <span>{done} / {reg.total_orders || orders.length} доставлено</span>
        {cash > 0 && <span style={{ color: '#16a34a', fontWeight: 700 }}>💵 {fmtNum(cash)} тг нал.</span>}
      </div>
      {couriers.length > 0 && (
        <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
          {couriers.map(c => (
            <span key={c} style={{ background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 8, padding: '2px 7px', fontSize: 9, color: '#0369A1', fontWeight: 600 }}>{c}</span>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── Загрузка нового реестра ─────────────────────────────────────────────

export function DeliveryNewRegistryScreen({ ctx }) {
  const { navigate, showToast, setDb, currentUser } = ctx;
  const [shift, setShift]               = useState('morning');
  const [rows, setRows]                 = useState(null);
  const [fileName, setFileName]         = useState('');
  const [duplicates, setDupes]          = useState([]);
  const [skipDupes, setSkip]            = useState(false);
  const [loading, setLoading]           = useState(false);
  const [detectedHeaders, setDetected]  = useState([]);
  const inputRef = useRef();

  const handleFile = async (file) => {
    if (!file) return;
    setFileName(file.name);
    setLoading(true);
    setRows(null);
    setDetected([]);
    try {
      const { rows: parsed, detectedHeaders: hdrs } = await parseFile(file);
      setRows(parsed);
      setDetected(hdrs);
      const codes = parsed.map(r => r.request_code).filter(Boolean);
      if (codes.length > 0) {
        const { data } = await supabase.from('delivery_orders')
          .select('request_code, client')
          .in('request_code', codes)
          .in('status', ['pending', 'assigned', 'delivered', 'failed']);
        if (data?.length) setDupes(data);
      } else {
        setDupes([]);
      }
    } catch (e) {
      showToast('Ошибка разбора файла: ' + e.message, 'error');
    }
    setLoading(false);
  };

  const handleCreate = async () => {
    if (!rows || rows.length === 0) return;
    setLoading(true);
    try {
      const number = await getNextRegNumber();
      const dupeCodes = new Set(duplicates.map(d => d.request_code));
      const finalRows = skipDupes ? rows.filter(r => !dupeCodes.has(r.request_code)) : rows;

      const { data: reg, error: regErr } = await supabase
        .from('delivery_registries')
        .insert([{ number, date: todayISO(), shift, status: 'active', raw_file_name: fileName, total_orders: finalRows.length, created_by: currentUser.id, created_at: new Date().toISOString() }])
        .select().single();
      if (regErr) throw regErr;

      const orderRows = finalRows.map(r => ({ ...r, id: uid(), registry_id: reg.id, status: 'pending', created_at: new Date().toISOString() }));
      const { error: ordErr } = await supabase.from('delivery_orders').insert(orderRows);
      if (ordErr) throw ordErr;

      setDb(d => ({ ...d, deliveryRegistries: [reg, ...d.deliveryRegistries], deliveryOrders: [...orderRows, ...d.deliveryOrders] }));
      showToast(`Реестр ${number} создан (${finalRows.length} заказов)`, 'success');
      navigate({ name: 'delivery_registry_detail', registryId: reg.id });
    } catch (e) {
      showToast('Ошибка создания: ' + e.message, 'error');
    }
    setLoading(false);
  };

  const finalCount = rows ? (skipDupes ? rows.length - duplicates.length : rows.length) : 0;

  return (
    <div style={{ background: '#F5F7F8', minHeight: '100vh' }}>
      <ScreenHeader title="Новый реестр" onBack={() => navigate({ name: 'delivery_registries' })} />
      <div style={{ padding: 12 }}>

        <Card>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 8 }}>Смена</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['morning', '☀️ Утренняя'], ['evening', '🌙 Вечерняя']].map(([k, l]) => (
              <button key={k} onClick={() => setShift(k)}
                style={{ flex: 1, padding: 9, borderRadius: 10, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  background: shift === k ? '#297b8a' : '#F5F7F8', color: shift === k ? '#fff' : '#94a3b8',
                  border: `1.5px solid ${shift === k ? '#297b8a' : '#E5E7EB'}` }}>
                {l}
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 8 }}>Файл из 1С (.xlsx / .csv)</div>
          <div onClick={() => inputRef.current?.click()}
            style={{ border: '2px dashed #CBD5E1', borderRadius: 12, padding: '20px 16px', textAlign: 'center', cursor: 'pointer' }}>
            <Upload size={24} style={{ color: '#94a3b8', margin: '0 auto 8px' }} />
            <div style={{ fontSize: 11, color: '#64748b' }}>{fileName || 'Нажмите для выбора файла'}</div>
            {loading && <div style={{ fontSize: 10, color: '#297b8a', marginTop: 6 }}>⏳ Разбор файла...</div>}
          </div>
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
            onChange={e => handleFile(e.target.files[0])} />
        </Card>

        {/* ── Диагностика: показываем что нашли в файле, если 0 заказов ── */}
        {rows !== null && rows.length === 0 && detectedHeaders.length > 0 && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 12px', marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 11, color: '#991B1B', marginBottom: 4 }}>
              ⚠ Колонки в файле не совпали с ожидаемыми
            </div>
            <div style={{ fontSize: 9, color: '#991B1B', marginBottom: 6 }}>
              Найденные колонки в строке заголовка:
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
              {detectedHeaders.map((h, i) => (
                <span key={i} style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 6, padding: '2px 6px', fontSize: 8, color: '#7F1D1D', fontWeight: 600 }}>{h}</span>
              ))}
            </div>
            <div style={{ fontSize: 9, color: '#6B7280', marginBottom: 4 }}>Ожидаются колонки:</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {Object.keys(COL_MAP).map(k => (
                <span key={k} style={{ background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 6, padding: '2px 6px', fontSize: 8, color: '#075985', fontWeight: 600 }}>{k}</span>
              ))}
            </div>
          </div>
        )}

        {duplicates.length > 0 && (
          <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 10, padding: '10px 12px', marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 11, color: '#92400E', marginBottom: 4 }}>⚠️ Обнаружены повторы ({duplicates.length})</div>
            <div style={{ fontSize: 10, color: '#92400E', marginBottom: 6 }}>Эти заказы уже были в предыдущих реестрах:</div>
            {duplicates.slice(0, 3).map(d => <div key={d.request_code} style={{ fontSize: 10, color: '#92400E' }}>• {d.request_code} — {d.client}</div>)}
            {duplicates.length > 3 && <div style={{ fontSize: 9, color: '#d97706', marginTop: 2 }}>...ещё {duplicates.length - 3}</div>}
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button onClick={() => setSkip(false)}
                style={{ flex: 1, padding: 6, background: skipDupes ? '#F5F7F8' : '#F59E0B', color: skipDupes ? '#64748b' : '#fff', border: '1px solid #E5E7EB', borderRadius: 7, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>
                Включить все
              </button>
              <button onClick={() => setSkip(true)}
                style={{ flex: 1, padding: 6, background: skipDupes ? '#297b8a' : '#F5F7F8', color: skipDupes ? '#fff' : '#64748b', border: '1px solid #E5E7EB', borderRadius: 7, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>
                Пропустить повторы
              </button>
            </div>
          </div>
        )}

        {rows && (
          <Card>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 8 }}>
              Предпросмотр — {rows.length} заказов {skipDupes && duplicates.length > 0 ? `(${finalCount} после фильтра)` : ''}
            </div>
            <div style={{ overflowX: 'auto', marginBottom: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9 }}>
                <thead>
                  <tr>{['№', 'Клиент', 'Город', 'Адрес', 'Сумма'].map(h => (
                    <th key={h} style={{ background: '#F1F5F9', color: '#64748b', padding: '4px 6px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {rows.slice(0, 4).map((r, i) => (
                    <tr key={i}>
                      <td style={{ padding: '4px 6px', borderBottom: '1px solid #F1F5F9' }}>{r.seq_number || i + 1}</td>
                      <td style={{ padding: '4px 6px', borderBottom: '1px solid #F1F5F9', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.client}</td>
                      <td style={{ padding: '4px 6px', borderBottom: '1px solid #F1F5F9' }}>{r.city}</td>
                      <td style={{ padding: '4px 6px', borderBottom: '1px solid #F1F5F9', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.address}</td>
                      <td style={{ padding: '4px 6px', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{fmtNum(r.amount)}</td>
                    </tr>
                  ))}
                  {rows.length > 4 && (
                    <tr><td colSpan={5} style={{ textAlign: 'center', color: '#94a3b8', padding: 4, fontSize: 9, fontStyle: 'italic' }}>... ещё {rows.length - 4} строк</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <button onClick={handleCreate} disabled={loading || finalCount === 0}
              style={{ width: '100%', padding: 12, background: (loading || finalCount === 0) ? '#CBD5E1' : '#297b8a', color: '#fff', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer' }}>
              {loading ? '⏳ Создание...' : `✓ Создать реестр (${finalCount} заказов)`}
            </button>
          </Card>
        )}
      </div>
    </div>
  );
}

// ─── Детали реестра ──────────────────────────────────────────────────────

export function DeliveryRegistryDetailScreen({ ctx, registryId }) {
  const { db, navigate } = ctx;
  const reg    = (db.deliveryRegistries || []).find(r => r.id === registryId);
  const orders = (db.deliveryOrders || []).filter(o => o.registry_id === registryId);

  if (!reg) return <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>Реестр не найден</div>;

  const delivered    = orders.filter(o => o.status === 'delivered');
  const inProgress   = orders.filter(o => o.status === 'assigned');
  const failed       = orders.filter(o => o.status === 'failed');
  const failedPending = failed.filter(o => !o.manager_decision);
  const totalCash    = delivered.filter(o => o.cash_received).reduce((s, o) => s + (Number(o.cash_amount) || 0), 0);
  const totalExpected = orders.reduce((s, o) => s + (Number(o.amount) || 0), 0);

  return (
    <div style={{ background: '#F5F7F8', minHeight: '100vh' }}>
      <ScreenHeader
        title={`${reg.number} ${SHIFT_LABEL[reg.shift] || ''}`}
        subtitle={`${fmtDate(reg.date)} · ${reg.status === 'active' ? 'Активен' : 'Завершён'}`}
        onBack={() => navigate({ name: 'delivery_registries' })}
      />
      <div style={{ padding: 12 }}>

        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          {[
            { val: delivered.length,  lbl: 'Доставлено', color: '#16a34a' },
            { val: inProgress.length, lbl: 'В работе',   color: '#d97706' },
            { val: failed.length,     lbl: 'Не удалось', color: '#dc2626' },
          ].map(({ val, lbl, color }) => (
            <div key={lbl} style={{ flex: 1, background: '#fff', borderRadius: 12, padding: '8px 10px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color }}>{val}</div>
              <div style={{ fontSize: 8, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: .3, marginTop: 2 }}>{lbl}</div>
            </div>
          ))}
        </div>

        <Card>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>Наличные</div>
          {[['Ожидалось по документам', fmtNum(totalExpected) + ' тг', '#1A1814'], ['Принято наличными', fmtNum(totalCash) + ' тг', '#16a34a']].map(([l, v, c]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #F5F7F8', fontSize: 10 }}>
              <span style={{ color: '#64748b' }}>{l}</span>
              <span style={{ fontWeight: 700, color: c }}>{v}</span>
            </div>
          ))}
        </Card>

        {failedPending.length > 0 && (
          <button onClick={() => navigate({ name: 'delivery_failed_queue', registryId })}
            style={{ width: '100%', padding: 11, marginBottom: 10, background: '#FEE2E2', color: '#991B1B', border: '1px solid #FCA5A5', borderRadius: 12, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
            ⚠️ {failedPending.length} {failedPending.length === 1 ? 'заказ ждёт' : 'заказа ждут'} решения →
          </button>
        )}

        <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 6 }}>Все заказы ({orders.length})</div>
        {orders.sort((a, b) => (a.seq_number || 0) - (b.seq_number || 0)).map(order => {
          const courier = db.users?.find(u => u.id === order.courier_id);
          return (
            <div key={order.id} style={{ background: '#fff', borderRadius: 12, padding: '10px 12px', marginBottom: 6,
              borderLeft: order.status === 'failed' ? '3px solid #dc2626' : 'none', boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 3 }}>
                <div style={{ fontWeight: 700, fontSize: 11, color: '#1A1814', flex: 1, marginRight: 6 }}>{order.client}</div>
                <StatusBadge status={order.status} />
              </div>
              <div style={{ fontSize: 9, color: '#94a3b8' }}>📍 {order.city}</div>
              <div style={{ fontSize: 10, color: '#475569', marginBottom: 4 }}>{order.address}</div>
              {order.status === 'failed' && order.fail_reason && (
                <div style={{ fontSize: 9, color: '#dc2626', background: '#FEF2F2', padding: '3px 6px', borderRadius: 6, marginBottom: 4 }}>{order.fail_reason}</div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#1A1814' }}>{fmtNum(order.amount)} тг</span>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {order.cash_received && (
                    <span style={{ background: '#DCFCE7', color: '#16a34a', padding: '2px 7px', borderRadius: 8, fontSize: 9, fontWeight: 700 }}>💵 {fmtNum(order.cash_amount)} нал.</span>
                  )}
                  {courier && <span style={{ fontSize: 9, color: '#94a3b8' }}>{courier.first_name}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Нерастворённые заказы — решение менеджера ────────────────────────────

export function DeliveryFailedQueueScreen({ ctx, registryId }) {
  const { db, navigate, showToast, setDb } = ctx;
  const orders = (db.deliveryOrders || []).filter(o => o.registry_id === registryId && o.status === 'failed' && !o.manager_decision);

  const decide = async (orderId, decision) => {
    const { error } = await supabase.from('delivery_orders').update({ manager_decision: decision }).eq('id', orderId);
    if (error) { showToast('Ошибка: ' + error.message, 'error'); return; }
    setDb(d => ({ ...d, deliveryOrders: d.deliveryOrders.map(o => o.id === orderId ? { ...o, manager_decision: decision } : o) }));
    showToast(decision === 'cancelled' ? 'Заказ отменён' : 'Заказ перенесён на следующий реестр', 'success');
  };

  return (
    <div style={{ background: '#F5F7F8', minHeight: '100vh' }}>
      <ScreenHeader title="⚠️ Нужно решение" subtitle={`${orders.length} заказов ждут`} onBack={() => navigate({ name: 'delivery_registry_detail', registryId })} />
      <div style={{ padding: 12 }}>
        {orders.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 20px', color: '#94a3b8' }}>
            <CheckCircle2 size={36} style={{ margin: '0 auto 10px', color: '#16a34a', opacity: .5 }} />
            <div style={{ fontSize: 13 }}>Все решения приняты</div>
          </div>
        )}
        {orders.map(order => {
          const courier = db.users?.find(u => u.id === order.delivered_by);
          return (
            <div key={order.id} style={{ background: '#fff', borderRadius: 12, padding: 12, marginBottom: 8, borderLeft: '3px solid #dc2626', boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}>
              <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 2, color: '#1A1814' }}>{order.client}</div>
              <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6 }}>📍 {order.city} · {order.address}</div>
              {order.fail_reason && (
                <div style={{ fontSize: 10, color: '#dc2626', background: '#FEF2F2', padding: '4px 8px', borderRadius: 6, marginBottom: 8 }}>
                  ✗ «{order.fail_reason}»{courier ? <span style={{ color: '#94a3b8', fontSize: 9 }}> · {courier.first_name}</span> : ''}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => decide(order.id, 'cancelled')}
                  style={{ flex: 1, padding: 8, background: '#FEE2E2', color: '#dc2626', border: 'none', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  ✕ Отменить
                </button>
                <button onClick={() => decide(order.id, 'rescheduled')}
                  style={{ flex: 1, padding: 8, background: '#EFF6FF', color: '#1D4ED8', border: 'none', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  ↷ Перенести
                </button>
              </div>
            </div>
          );
        })}
        {orders.length > 0 && (
          <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '8px 10px', fontSize: 9, color: '#1D4ED8', marginTop: 4 }}>
            <b>«Перенести»</b> — заказ будет помечен ⚠️ при загрузке следующего реестра из 1С
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ЭКРАНЫ КУРЬЕРА
// ═══════════════════════════════════════════════════════════════════════════

export function CourierRegistryScreen({ ctx }) {
  const { db, navigate, currentUser, showToast, setDb } = ctx;
  const [tab, setTab] = useState('free');

  const activeReg = (db.deliveryRegistries || []).find(r => r.status === 'active');
  if (!activeReg) {
    return (
      <div style={{ background: '#F5F7F8', minHeight: '100vh' }}>
        <ScreenHeader title="🚚 Реестр доставок" subtitle="Нет активных реестров" />
        <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>
          <Truck size={40} style={{ margin: '0 auto 12px', opacity: .3 }} />
          <div>Активных реестров пока нет</div>
        </div>
      </div>
    );
  }

  const allOrders     = (db.deliveryOrders || []).filter(o => o.registry_id === activeReg.id);
  const freeOrders    = allOrders.filter(o => o.status === 'pending' && !o.courier_id);
  const myOrders      = allOrders.filter(o => o.courier_id === currentUser.id);
  const othersOrders  = allOrders.filter(o => o.courier_id && o.courier_id !== currentUser.id && o.status !== 'delivered');

  const takeOrder = async (orderId) => {
    const { error } = await supabase.from('delivery_orders')
      .update({ courier_id: currentUser.id, status: 'assigned' })
      .eq('id', orderId)
      .is('courier_id', null);
    if (error) { showToast('Заказ уже взят другим курьером', 'error'); return; }
    setDb(d => ({ ...d, deliveryOrders: d.deliveryOrders.map(o => o.id === orderId ? { ...o, courier_id: currentUser.id, status: 'assigned' } : o) }));
    showToast('Заказ добавлен в ваш список', 'success');
  };

  const tabs = [['free', `Свободные (${freeOrders.length})`], ['mine', `Мои (${myOrders.length})`], ['others', `Чужие (${othersOrders.length})`]];

  return (
    <div style={{ background: '#F5F7F8', minHeight: '100vh' }}>
      <ScreenHeader title={`${activeReg.number} · ${SHIFT_LABEL[activeReg.shift]}`} subtitle="Выберите заказы для доставки" />

      <div style={{ display: 'flex', background: '#fff', borderBottom: '1px solid #F1F5F9' }}>
        {tabs.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ flex: 1, padding: '9px 2px', fontSize: 10, fontWeight: 600,
              color: tab === k ? '#297b8a' : '#94a3b8',
              borderBottom: `2px solid ${tab === k ? '#297b8a' : 'transparent'}`,
              background: 'none', border: 'none', cursor: 'pointer' }}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'free' && (
        <div style={{ margin: '10px 12px 0', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '8px 10px', fontSize: 10, color: '#1D4ED8' }}>
          Нажмите <b>«Взять»</b> — заказ закрепится за вами
        </div>
      )}

      <div style={{ padding: '10px 12px 12px' }}>
        {tab === 'free' && (
          <>
            {freeOrders.length === 0 && <div style={{ textAlign: 'center', padding: '32px 20px', color: '#94a3b8', fontSize: 12 }}>Все свободные заказы разобраны</div>}
            {freeOrders.map(o => (
              <OrderRow key={o.id} order={o} action={
                <button onClick={e => { e.stopPropagation(); takeOrder(o.id); }}
                  style={{ padding: '4px 12px', background: '#297b8a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>
                  Взять
                </button>
              } />
            ))}
          </>
        )}
        {tab === 'mine' && (
          <>
            {myOrders.length === 0 && (
              <div style={{ textAlign: 'center', padding: '32px 20px', color: '#94a3b8' }}>
                <Package size={32} style={{ margin: '0 auto 8px', opacity: .4 }} />
                <div style={{ fontSize: 12 }}>Нет взятых заказов</div>
              </div>
            )}
            {myOrders.map(o => <OrderRow key={o.id} order={o} onClick={() => navigate({ name: 'courier_order', orderId: o.id })} />)}
          </>
        )}
        {tab === 'others' && othersOrders.map(o => {
          const u = db.users?.find(u => u.id === o.courier_id);
          return <OrderRow key={o.id} order={o} dim courierName={u ? u.first_name : '—'} />;
        })}
      </div>
    </div>
  );
}

// ─── Отметить доставку ────────────────────────────────────────────────────

export function CourierOrderDetailScreen({ ctx, orderId }) {
  const { db, navigate, currentUser, showToast, setDb } = ctx;
  const order = (db.deliveryOrders || []).find(o => o.id === orderId);

  const [cashOn,     setCashOn]     = useState(order?.cash_received   || false);
  const [cashAmt,    setCashAmt]    = useState(order ? String(order.cash_amount || order.amount || '') : '');
  const [note,       setNote]       = useState(order?.courier_note    || '');
  const [failMode,   setFailMode]   = useState(false);
  const [failReason, setFailReason] = useState('');
  const [saving,     setSaving]     = useState(false);

  if (!order) return <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>Заказ не найден</div>;

  const isDone = ['delivered', 'failed'].includes(order.status);

  const finishRegistry = async (regId, updatedOrderId, newStatus) => {
    const regOrders = (db.deliveryOrders || []).filter(o => o.registry_id === regId && o.id !== updatedOrderId);
    const allDone   = regOrders.every(o => ['delivered', 'failed'].includes(o.status));
    if (!allDone) return;
    const now = new Date().toISOString();
    await supabase.from('delivery_registries').update({ status: 'completed', completed_at: now }).eq('id', regId);
    setDb(d => ({ ...d, deliveryRegistries: d.deliveryRegistries.map(r => r.id === regId ? { ...r, status: 'completed', completed_at: now } : r) }));
    showToast('🎉 Реестр полностью доставлен!', 'success');
  };

  const markDelivered = async () => {
    setSaving(true);
    const upd = { status: 'delivered', cash_received: cashOn, cash_amount: cashOn ? (Number(cashAmt) || 0) : null, courier_note: note.trim() || null, delivered_at: new Date().toISOString(), delivered_by: currentUser.id };
    const { error } = await supabase.from('delivery_orders').update(upd).eq('id', orderId);
    if (error) { showToast('Ошибка: ' + error.message, 'error'); setSaving(false); return; }
    setDb(d => ({ ...d, deliveryOrders: d.deliveryOrders.map(o => o.id === orderId ? { ...o, ...upd } : o) }));
    await finishRegistry(order.registry_id, orderId, 'delivered');
    showToast('✓ Доставка отмечена', 'success');
    navigate({ name: 'courier_registry' });
    setSaving(false);
  };

  const markFailed = async () => {
    if (!failReason.trim()) { showToast('Укажите причину', 'error'); return; }
    setSaving(true);
    const upd = { status: 'failed', fail_reason: failReason.trim(), delivered_at: new Date().toISOString(), delivered_by: currentUser.id };
    const { error } = await supabase.from('delivery_orders').update(upd).eq('id', orderId);
    if (error) { showToast('Ошибка: ' + error.message, 'error'); setSaving(false); return; }
    setDb(d => ({ ...d, deliveryOrders: d.deliveryOrders.map(o => o.id === orderId ? { ...o, ...upd } : o) }));
    await finishRegistry(order.registry_id, orderId, 'failed');
    showToast('Отмечено: не удалось доставить', 'success');
    navigate({ name: 'courier_registry' });
    setSaving(false);
  };

  return (
    <div style={{ background: '#F5F7F8', minHeight: '100vh' }}>
      <ScreenHeader title={order.client} onBack={() => navigate({ name: 'courier_registry' })} />
      <div style={{ padding: 12 }}>

        <Card>
          {[['Документ', order.document], ['Сумма', fmtNum(order.amount) + ' тг']].map(([l, v]) => v && (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #F5F7F8', fontSize: 10 }}>
              <span style={{ color: '#64748b' }}>{l}</span>
              <span style={{ fontWeight: 700, color: '#1A1814' }}>{v}</span>
            </div>
          ))}
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 9, color: '#94a3b8', marginBottom: 2, textTransform: 'uppercase', letterSpacing: .3 }}>Адрес</div>
            <div style={{ fontWeight: 600, fontSize: 11, color: '#1A1814' }}>{order.address}</div>
          </div>
          {order.contacts && (
            <a href={`tel:${order.contacts}`}
              style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, padding: '8px 10px', background: '#F0F9FF', borderRadius: 8, textDecoration: 'none', color: '#297b8a', fontWeight: 700, fontSize: 11 }}>
              <Phone size={14} /> {order.contacts}
            </a>
          )}
          {order.extra_info && (
            <div style={{ marginTop: 8, fontSize: 10, color: '#64748b', background: '#F5F7F8', padding: '6px 8px', borderRadius: 8 }}>
              💬 {order.extra_info}
            </div>
          )}
        </Card>

        {isDone ? (
          <div style={{ background: '#fff', borderRadius: 12, padding: 16, textAlign: 'center' }}>
            {order.status === 'delivered'
              ? <><CheckCircle2 size={36} color="#16a34a" style={{ margin: '0 auto 8px' }} /><div style={{ fontWeight: 700, color: '#16a34a', fontSize: 14 }}>Доставлен</div></>
              : <><XCircle size={36} color="#dc2626" style={{ margin: '0 auto 8px' }} /><div style={{ fontWeight: 700, color: '#dc2626', fontSize: 14 }}>Не удалось доставить</div></>
            }
          </div>
        ) : !failMode ? (
          <Card>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 10 }}>Отметить результат</div>

            <div style={{ background: cashOn ? '#F0FDF4' : '#F5F7F8', border: `1px solid ${cashOn ? '#BBF7D0' : '#E5E7EB'}`, borderRadius: 10, padding: 10, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: cashOn ? 10 : 0 }}>
                <div onClick={() => setCashOn(v => !v)}
                  style={{ width: 36, height: 20, borderRadius: 10, background: cashOn ? '#297b8a' : '#CBD5E1', position: 'relative', cursor: 'pointer', flexShrink: 0 }}>
                  <div style={{ width: 16, height: 16, background: '#fff', borderRadius: '50%', position: 'absolute', top: 2, transition: 'transform .2s', transform: cashOn ? 'translateX(18px)' : 'translateX(2px)', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: cashOn ? '#16a34a' : '#64748b' }}>💵 Получены наличные</span>
              </div>
              {cashOn && (
                <>
                  <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>Сумма наличных (тг)</div>
                  <input value={cashAmt} onChange={e => setCashAmt(e.target.value)} type="number"
                    style={{ width: '100%', padding: '8px 10px', background: '#fff', border: '1px solid #BBF7D0', borderRadius: 10, fontSize: 14, fontWeight: 700, color: '#16a34a' }} />
                </>
              )}
            </div>

            <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>Комментарий (необязательно)</div>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Подпись получена..."
              style={{ width: '100%', padding: '8px 10px', background: '#F5F7F8', border: '1px solid #E5E7EB', borderRadius: 10, fontSize: 11, marginBottom: 10, color: '#1A1814' }} />

            <button onClick={markDelivered} disabled={saving}
              style={{ width: '100%', padding: 12, background: saving ? '#CBD5E1' : '#16a34a', color: '#fff', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer', marginBottom: 8 }}>
              {saving ? '⏳ Сохранение...' : '✓ Доставлен'}
            </button>
            <button onClick={() => setFailMode(true)}
              style={{ width: '100%', padding: 10, background: 'none', border: 'none', color: '#dc2626', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              ✗ Не удалось доставить
            </button>
          </Card>
        ) : (
          <Card>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', marginBottom: 10 }}>✗ Не удалось доставить</div>
            <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>Причина *</div>
            <input value={failReason} onChange={e => setFailReason(e.target.value)} placeholder="Дверь закрыта / неверный адрес / ..."
              style={{ width: '100%', padding: '8px 10px', background: '#F5F7F8', border: '1px solid #E5E7EB', borderRadius: 10, fontSize: 11, marginBottom: 10, color: '#1A1814' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setFailMode(false)}
                style={{ flex: 1, padding: 10, background: '#F5F7F8', color: '#64748b', border: 'none', borderRadius: 10, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                Отмена
              </button>
              <button onClick={markFailed} disabled={saving}
                style={{ flex: 1, padding: 10, background: saving ? '#CBD5E1' : '#dc2626', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 12, cursor: saving ? 'not-allowed' : 'pointer' }}>
                {saving ? '...' : 'Сохранить'}
              </button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

// ─── Виджет на главной для курьера ───────────────────────────────────────

export function CourierDeliveryWidget({ ctx }) {
  const { db, navigate, currentUser } = ctx;
  const activeReg = (db.deliveryRegistries || []).find(r => r.status === 'active');
  if (!activeReg) return null;

  const myOrders  = (db.deliveryOrders || []).filter(o => o.registry_id === activeReg.id && o.courier_id === currentUser.id);
  const done      = myOrders.filter(o => o.status === 'delivered').length;
  const cash      = myOrders.filter(o => o.cash_received).reduce((s, o) => s + (Number(o.cash_amount) || 0), 0);
  const pct       = myOrders.length > 0 ? Math.round((done / myOrders.length) * 100) : 0;
  const nextOrder = myOrders.find(o => o.status === 'assigned');

  return (
    <div style={{ margin: '12px 12px 0' }}>
      <div onClick={() => navigate({ name: 'courier_registry' })}
        style={{ background: 'linear-gradient(135deg, #297b8a 0%, #1d5a67 100%)', borderRadius: 16, padding: 16, color: '#fff', cursor: 'pointer' }}>
        <div style={{ fontSize: 10, opacity: .75, marginBottom: 2 }}>Активный реестр</div>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>{activeReg.number} {SHIFT_LABEL[activeReg.shift]}</div>
        <div style={{ height: 8, background: 'rgba(255,255,255,.2)', borderRadius: 4, marginBottom: 6, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: '#fff', borderRadius: 4 }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, opacity: .85 }}>
          <span>{done} / {myOrders.length} заказов</span>
          {cash > 0 && <span>💵 {fmtNum(cash)} тг нал.</span>}
        </div>
      </div>
      {nextOrder && (
        <div onClick={() => navigate({ name: 'courier_order', orderId: nextOrder.id })}
          style={{ background: '#fff', borderRadius: 12, padding: '10px 12px', marginTop: 8, boxShadow: '0 1px 4px rgba(0,0,0,.06)', cursor: 'pointer' }}>
          <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 3 }}>Следующий заказ</div>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#1A1814', marginBottom: 2 }}>{nextOrder.client}</div>
          <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6 }}>📍 {nextOrder.address}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: 12 }}>{fmtNum(nextOrder.amount)} тг</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#297b8a' }}>Открыть →</span>
          </div>
        </div>
      )}
    </div>
  );
}
