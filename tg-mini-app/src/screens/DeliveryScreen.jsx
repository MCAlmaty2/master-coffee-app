// ═══════════════════════════════════════════════════════════════════════════
// src/screens/DeliveryScreen.jsx — Модуль курьерской доставки
// Менеджер: список реестров, загрузка xlsx, детали, нерастворённые заказы
// Курьер:   пул заказов (взять себе), мои заказы, отметить доставку
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState, useRef, useEffect } from 'react';
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
  '№ п/п':                                       'seq_number',
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

  // Ищем строку с наибольшим числом совпадений из первых 15 строк
  // (без раннего выхода — в 1С-отчётах строка заголовков не всегда первая)
  let headerIdx = 0;
  let bestScore = 0;
  for (let i = 0; i < Math.min(allRows.length, 15); i++) {
    const score = allRows[i].filter(c => COL_MAP_LOWER[normKey(c)] !== undefined).length;
    if (score > bestScore) { bestScore = score; headerIdx = i; }
  }

  // Строим массив заголовков из найденной строки
  const headers = allRows[headerIdx].map(c => String(c).replace(/^﻿/, '').replace(/\s+/g, ' ').trim());

  // Дополняем ПУСТЫЕ ячейки из строк выше (1С использует двухстрочные заголовки:
  // напр. «Сумма взаиморасчетов» стоит строкой выше основного заголовка)
  for (let prev = headerIdx - 1; prev >= Math.max(0, headerIdx - 3); prev--) {
    allRows[prev].forEach((cell, idx) => {
      const val = String(cell).replace(/^﻿/, '').replace(/\s+/g, ' ').trim();
      if (val && !headers[idx]) headers[idx] = val;
    });
  }

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

function ScreenHeader({ title, subtitle, onBack, action }) {
  return (
    <div style={{ marginBottom: 20 }}>
      {onBack && (
        <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--mc-muted)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 8, padding: 0 }}>
          <ChevronLeft size={15} /> Назад
        </button>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--mc-text)', margin: 0, lineHeight: 1.2 }}>{title}</h1>
          {subtitle && <div style={{ fontSize: 12, color: 'var(--mc-muted)', marginTop: 3 }}>{subtitle}</div>}
        </div>
        {action}
      </div>
    </div>
  );
}

function Card({ children, style, onClick }) {
  return (
    <div onClick={onClick} style={{ background: 'var(--mc-surface)', borderRadius: 14, padding: '12px 14px', marginBottom: 10, border: '1px solid var(--mc-border)', ...style }}>
      {children}
    </div>
  );
}

function StatusBadge({ status, managerDecision }) {
  if (managerDecision === 'admin_closed') {
    return (
      <span style={{ background: 'var(--mc-active-item)', color: 'var(--mc-muted)', border: '1px solid var(--mc-border)', borderRadius: 8, padding: '2px 7px', fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap' }}>
        🔒 Закрыто
      </span>
    );
  }
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
    <div style={{ height: 6, background: 'var(--mc-border)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: '#297b8a', borderRadius: 3, transition: 'width .3s' }} />
    </div>
  );
}

function OrderRow({ order, action, onClick, dim, courierName }) {
  return (
    <div onClick={onClick}
      style={{ background: 'var(--mc-surface)', borderRadius: 12, padding: '10px 12px', marginBottom: 6,
        border: '1px solid var(--mc-border-light)',
        opacity: dim ? .55 : 1, cursor: onClick ? 'pointer' : 'default' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 3 }}>
        <div style={{ fontWeight: 700, fontSize: 11, color: 'var(--mc-text)', flex: 1, marginRight: 6 }}>{order.client}</div>
        {courierName
          ? <span style={{ background: '#EFF6FF', color: '#1D4ED8', borderRadius: 8, padding: '2px 7px', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>{courierName}</span>
          : <StatusBadge status={order.status} />
        }
      </div>
      <div style={{ fontSize: 9, color: 'var(--mc-muted)' }}>📍 {[order.city, order.address].filter(Boolean).join(' · ')}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 5 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--mc-text)' }}>{fmtNum(order.amount)} тг</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {action}
          {onClick && !action && <ChevronRight size={14} style={{ color: 'var(--mc-muted)' }} />}
          {dim && !action && <span style={{ fontSize: 9, color: 'var(--mc-muted)' }}>занято</span>}
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
    <div style={{ background: 'var(--mc-bg)' }}>
      <ScreenHeader title="🚚 Доставки" subtitle={`Сегодня, ${new Date().toLocaleDateString('ru-KZ', { day: 'numeric', month: 'long', timeZone: TZ })}`} />

      <div style={{ display: 'flex', background: 'var(--mc-surface)', borderBottom: '1px solid var(--mc-border-light)' }}>
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
          <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--mc-muted)' }}>
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
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--mc-text)' }}>{reg.number}</div>
          <div style={{ fontSize: 10, color: 'var(--mc-muted)' }}>{fmtDate(reg.date)} · {SHIFT_LABEL[reg.shift]}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
          {reg.status === 'active'
            ? <span style={{ background: '#D1FAE5', color: '#065F46', borderRadius: 10, padding: '2px 8px', fontSize: 9, fontWeight: 700 }}>● Активен</span>
            : <span style={{ background: '#F1F5F9', color: 'var(--mc-muted)', borderRadius: 10, padding: '2px 8px', fontSize: 9, fontWeight: 700 }}>✓ Завершён</span>}
          {failed > 0 && <span style={{ background: '#FEE2E2', color: '#991B1B', borderRadius: 10, padding: '2px 8px', fontSize: 9, fontWeight: 700 }}>⚠ {failed} нерастр.</span>}
        </div>
      </div>
      <ProgressBar done={done} total={reg.total_orders || orders.length} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--mc-muted)', marginTop: 4 }}>
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
    <div style={{ background: 'var(--mc-bg)' }}>
      <ScreenHeader title="Новый реестр" onBack={() => navigate({ name: 'delivery_registries' })} />
      <div style={{ padding: 12 }}>

        <Card>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 8 }}>Смена</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['morning', '☀️ Утренняя'], ['evening', '🌙 Вечерняя']].map(([k, l]) => (
              <button key={k} onClick={() => setShift(k)}
                style={{ flex: 1, padding: 9, borderRadius: 10, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  background: shift === k ? '#297b8a' : '#F5F7F8', color: shift === k ? '#fff' : '#94a3b8',
                  border: `1.5px solid ${shift === k ? '#297b8a' : 'var(--mc-border)'}` }}>
                {l}
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 8 }}>Файл из 1С (.xlsx / .csv)</div>
          <div onClick={() => inputRef.current?.click()}
            style={{ border: '2px dashed #CBD5E1', borderRadius: 12, padding: '20px 16px', textAlign: 'center', cursor: 'pointer' }}>
            <Upload size={24} style={{ color: 'var(--mc-muted)', margin: '0 auto 8px' }} />
            <div style={{ fontSize: 11, color: 'var(--mc-muted)' }}>{fileName || 'Нажмите для выбора файла'}</div>
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
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 8 }}>
              Предпросмотр — {rows.length} заказов {skipDupes && duplicates.length > 0 ? `(${finalCount} после фильтра)` : ''}
            </div>
            <div style={{ overflowX: 'auto', marginBottom: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9 }}>
                <thead>
                  <tr>{['№', 'Клиент', 'Город', 'Адрес', 'Сумма'].map(h => (
                    <th key={h} style={{ background: '#F1F5F9', color: 'var(--mc-muted)', padding: '4px 6px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {rows.slice(0, 4).map((r, i) => (
                    <tr key={i}>
                      <td style={{ padding: '4px 6px', borderBottom: '1px solid var(--mc-border-light)' }}>{r.seq_number || i + 1}</td>
                      <td style={{ padding: '4px 6px', borderBottom: '1px solid var(--mc-border-light)', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.client}</td>
                      <td style={{ padding: '4px 6px', borderBottom: '1px solid var(--mc-border-light)' }}>{r.city}</td>
                      <td style={{ padding: '4px 6px', borderBottom: '1px solid var(--mc-border-light)', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.address}</td>
                      <td style={{ padding: '4px 6px', borderBottom: '1px solid var(--mc-border-light)', whiteSpace: 'nowrap' }}>{fmtNum(r.amount)}</td>
                    </tr>
                  ))}
                  {rows.length > 4 && (
                    <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--mc-muted)', padding: 4, fontSize: 9, fontStyle: 'italic' }}>... ещё {rows.length - 4} строк</td></tr>
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
  const { db, navigate, currentUser, showToast, setDb } = ctx;
  const [closingId,       setClosingId]       = useState(null);
  const [closeComment,    setCloseComment]    = useState('');
  const [closingSaving,   setClosingSaving]   = useState(false);
  const [confirmDelete,   setConfirmDelete]   = useState(false);
  const [deleting,        setDeleting]        = useState(false);
  const [confirmArchive,  setConfirmArchive]  = useState(false);
  const [archiving,       setArchiving]       = useState(false);
  const [showAddModal,    setShowAddModal]    = useState(false);
  const [detailOrder,     setDetailOrder]     = useState(null); // заявка в модале деталей

  const isAdmin    = currentUser?.role === 'admin';
  const isManager  = ['manager', 'senior_manager', 'b2b', 'b2c'].includes(currentUser?.role);
  const canArchive = isAdmin || currentUser?.role === 'director';
  const canAdd     = isAdmin || isManager;
  // Детали заявки + смена адреса (как у админа) — менеджеры, включая B2B и B2C
  const canDetail  = isAdmin || isManager;

  const handleDeleteRegistry = async () => {
    setDeleting(true);
    // 1. Удаляем все заказы реестра
    const { error: ordErr } = await supabase
      .from('delivery_orders')
      .delete()
      .eq('registry_id', registryId);
    if (ordErr) { showToast('Ошибка удаления заказов: ' + ordErr.message); setDeleting(false); return; }
    // 2. Удаляем сам реестр
    const { error: regErr } = await supabase
      .from('delivery_registries')
      .delete()
      .eq('id', registryId);
    if (regErr) { showToast('Ошибка удаления реестра: ' + regErr.message); setDeleting(false); return; }
    // 3. Обновляем локальный стейт
    setDb(d => ({
      ...d,
      deliveryRegistries: d.deliveryRegistries.filter(r => r.id !== registryId),
      deliveryOrders:     d.deliveryOrders.filter(o => o.registry_id !== registryId),
    }));
    showToast('Реестр удалён');
    navigate({ name: 'delivery_registries' });
  };

  const handleClose = async (orderId) => {
    if (!closeComment.trim()) { showToast('Укажите причину закрытия'); return; }
    setClosingSaving(true);
    const upd = {
      status:           'failed',
      manager_decision: 'admin_closed',
      fail_reason:      closeComment.trim(),
      delivered_at:     new Date().toISOString(),
    };
    const { error } = await supabase.from('delivery_orders').update(upd).eq('id', orderId);
    if (error) { showToast('Ошибка: ' + error.message); setClosingSaving(false); return; }
    setDb(d => ({ ...d, deliveryOrders: d.deliveryOrders.map(o => o.id === orderId ? { ...o, ...upd } : o) }));
    setClosingId(null);
    setCloseComment('');
    setClosingSaving(false);
    showToast('Заказ закрыт');
  };

  const handleArchiveRegistry = async () => {
    setArchiving(true);
    const { error } = await supabase
      .from('delivery_registries')
      .update({ status: 'archived' })
      .eq('id', registryId);
    if (error) { showToast('Ошибка архивации: ' + error.message); setArchiving(false); return; }
    setDb(d => ({
      ...d,
      deliveryRegistries: d.deliveryRegistries.map(r =>
        r.id === registryId ? { ...r, status: 'archived' } : r
      ),
    }));
    showToast('Реестр перемещён в архив');
    navigate({ name: 'delivery_registries' });
  };

  const reg    = (db.deliveryRegistries || []).find(r => r.id === registryId);
  const orders = (db.deliveryOrders || []).filter(o => o.registry_id === registryId);

  if (!reg) return <div style={{ padding: 24, textAlign: 'center', color: 'var(--mc-muted)' }}>Реестр не найден</div>;

  const delivered    = orders.filter(o => o.status === 'delivered');
  const inProgress   = orders.filter(o => o.status === 'assigned');
  const failed       = orders.filter(o => o.status === 'failed');
  const failedPending = failed.filter(o => !o.manager_decision);
  const totalCash    = delivered.filter(o => o.cash_received).reduce((s, o) => s + (Number(o.cash_amount) || 0), 0);
  const totalExpected = orders.reduce((s, o) => s + (Number(o.amount) || 0), 0);

  return (
    <div style={{ background: 'var(--mc-bg)' }}>
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
            <div key={lbl} style={{ flex: 1, background: 'var(--mc-surface)', borderRadius: 12, padding: '8px 10px', textAlign: 'center', border: '1px solid var(--mc-border)' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color }}>{val}</div>
              <div style={{ fontSize: 8, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .3, marginTop: 2 }}>{lbl}</div>
            </div>
          ))}
        </div>

        <Card>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Наличные</div>
          {[['Ожидалось по документам', fmtNum(totalExpected) + ' тг', '#1A1814'], ['Принято наличными', fmtNum(totalCash) + ' тг', '#16a34a']].map(([l, v, c]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--mc-border-light)', fontSize: 10 }}>
              <span style={{ color: 'var(--mc-muted)' }}>{l}</span>
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

        {/* ── Добавить заявку в реестр (admin / manager, только активный) ── */}
        {canAdd && reg.status === 'active' && (
          <button
            onClick={() => setShowAddModal(true)}
            style={{ width: '100%', padding: 11, marginBottom: 10, background: '#297b8a', color: '#fff',
              border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 12, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              boxShadow: '0 4px 12px rgba(41,123,138,.25)' }}>
            <Plus size={15} /> Добавить заявку в реестр
          </button>
        )}

        {showAddModal && (
          <AddOrderModal ctx={ctx} registryId={registryId} onClose={() => setShowAddModal(false)} />
        )}
        {detailOrder && (
          <OrderDetailModal
            order={detailOrder}
            db={db}
            currentUser={currentUser}
            canEdit={canDetail}
            onClose={() => setDetailOrder(null)}
            onAddressChange={async (newAddress) => {
              const oldAddress = detailOrder.address;
              const logEntry = { event: 'address_change', from: oldAddress, to: newAddress, actor: currentUser.id, at: new Date().toISOString() };
              const newLog = [...(detailOrder.log || []), logEntry];
              const { error } = await supabase.from('delivery_orders').update({ address: newAddress, log: newLog }).eq('id', detailOrder.id);
              if (error) { showToast('Ошибка: ' + error.message, 'error'); return; }
              const updated = { ...detailOrder, address: newAddress, log: newLog };
              setDb(d => ({ ...d, deliveryOrders: d.deliveryOrders.map(o => o.id === detailOrder.id ? updated : o) }));
              setDetailOrder(updated);
              showToast('Адрес обновлён');
            }}
          />
        )}

        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 6 }}>Все заказы ({orders.length})</div>

        {/* ── Архивировать реестр (admin / director, только активный) ── */}
        {canArchive && reg.status === 'active' && (
          <div style={{ marginBottom: 10 }}>
            {!confirmArchive ? (
              <button
                onClick={() => setConfirmArchive(true)}
                style={{ width: '100%', padding: 11, background: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A', borderRadius: 12, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                📦 Архивировать реестр
              </button>
            ) : (
              <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 12, padding: '12px 14px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#92400E', marginBottom: 4 }}>Архивировать {reg.number}?</div>
                <div style={{ fontSize: 11, color: '#78350F', marginBottom: 12 }}>
                  Реестр будет перемещён в архив. Заказы останутся в базе.
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => setConfirmArchive(false)}
                    style={{ flex: 1, padding: 9, background: '#fff', color: 'var(--mc-muted)', border: '1px solid #E5E7EB', borderRadius: 9, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                    Отмена
                  </button>
                  <button
                    onClick={handleArchiveRegistry}
                    disabled={archiving}
                    style={{ flex: 1, padding: 9, background: archiving ? '#CBD5E1' : '#D97706', color: '#fff', border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 12, cursor: archiving ? 'not-allowed' : 'pointer' }}>
                    {archiving ? '⏳ Архивация...' : '📦 Да, в архив'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Удалить реестр (только admin) ── */}
        {isAdmin && (
          <div style={{ marginBottom: 10 }}>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                style={{ width: '100%', padding: 11, background: '#FEF2F2', color: '#dc2626', border: '1px solid #FECACA', borderRadius: 12, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                🗑 Удалить реестр
              </button>
            ) : (
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12, padding: '12px 14px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', marginBottom: 4 }}>Удалить реестр {reg.number}?</div>
                <div style={{ fontSize: 11, color: '#991B1B', marginBottom: 12 }}>
                  Будут удалены реестр и все {orders.length} заказов. Действие необратимо.
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    style={{ flex: 1, padding: 9, background: '#fff', color: 'var(--mc-muted)', border: '1px solid #E5E7EB', borderRadius: 9, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                    Отмена
                  </button>
                  <button
                    onClick={handleDeleteRegistry}
                    disabled={deleting}
                    style={{ flex: 1, padding: 9, background: deleting ? '#CBD5E1' : '#dc2626', color: '#fff', border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 12, cursor: deleting ? 'not-allowed' : 'pointer' }}>
                    {deleting ? '⏳ Удаление...' : '🗑 Да, удалить'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {orders.sort((a, b) => (a.seq_number || 0) - (b.seq_number || 0)).map(order => {
          const courier      = db.users?.find(u => u.id === order.courier_id);
          const isAdminClosed = order.manager_decision === 'admin_closed';
          const canClose      = isAdmin && ['pending', 'assigned'].includes(order.status) && !isAdminClosed;
          const isClosingThis = closingId === order.id;

          return (
            <div key={order.id} style={{ background: 'var(--mc-surface)', borderRadius: 12, padding: '10px 12px', marginBottom: 6,
              borderLeft: isAdminClosed ? '3px solid #9CA3AF' : order.status === 'failed' ? '3px solid #dc2626' : 'none',
              boxShadow: '0 1px 3px rgba(0,0,0,.05)', opacity: isAdminClosed ? 0.75 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 3 }}>
                <div style={{ fontWeight: 700, fontSize: 11, color: 'var(--mc-text)', flex: 1, marginRight: 6 }}>{order.client}</div>
                <StatusBadge status={order.status} managerDecision={order.manager_decision} />
              </div>
              <div style={{ fontSize: 9, color: 'var(--mc-muted)' }}>📍 {order.city}</div>
              <div style={{ fontSize: 10, color: 'var(--mc-muted)', marginBottom: order.payment_info ? 3 : 4 }}>{order.address}</div>
              {order.payment_info && (
                <div style={{ fontSize: 9, color: '#C2410C', background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 6, padding: '2px 6px', display: 'inline-block', marginBottom: 4 }}>
                  💳 {order.payment_info}
                </div>
              )}
              {isAdminClosed && order.fail_reason && (
                <div style={{ fontSize: 9, color: '#6B7280', background: '#F3F4F6', padding: '3px 6px', borderRadius: 6, marginBottom: 4 }}>
                  🔒 {order.fail_reason}
                </div>
              )}
              {!isAdminClosed && order.status === 'failed' && order.fail_reason && (
                <div style={{ fontSize: 9, color: '#dc2626', background: '#FEF2F2', padding: '3px 6px', borderRadius: 6, marginBottom: 4 }}>{order.fail_reason}</div>
              )}
              {order.status === 'delivered' && order.delivered_at && (
                <div style={{ fontSize: 9, color: '#065F46', background: '#D1FAE5', padding: '2px 6px', borderRadius: 6, marginBottom: 4, display: 'inline-block' }}>
                  ✓ Доставлен {new Date(order.delivered_at).toLocaleTimeString('ru-KZ', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' })}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-text)' }}>{fmtNum(order.amount)} тг</span>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {order.cash_received && (
                    <span style={{ background: '#DCFCE7', color: '#16a34a', padding: '2px 7px', borderRadius: 8, fontSize: 9, fontWeight: 700 }}>💵 {fmtNum(order.cash_amount)} нал.</span>
                  )}
                  {courier && <span style={{ fontSize: 9, color: 'var(--mc-muted)' }}>{courier.first_name}</span>}
                  {canDetail && (
                    <button
                      onClick={() => setDetailOrder(order)}
                      style={{ padding: '3px 9px', background: 'var(--mc-active-item)', color: 'var(--mc-muted)', border: '1px solid var(--mc-border)', borderRadius: 7, fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>
                      Детали
                    </button>
                  )}
                  {canClose && !isClosingThis && (
                    <button
                      onClick={() => { setClosingId(order.id); setCloseComment(''); }}
                      style={{ padding: '3px 9px', background: '#FEF2F2', color: '#dc2626', border: '1px solid #FECACA', borderRadius: 7, fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>
                      Закрыть
                    </button>
                  )}
                </div>
              </div>

              {/* ── Inline-форма закрытия ── */}
              {isClosingThis && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--mc-border-light)' }}>
                  <div style={{ fontSize: 9, color: 'var(--mc-muted)', marginBottom: 4, fontWeight: 600 }}>Причина закрытия *</div>
                  <textarea
                    value={closeComment}
                    onChange={e => setCloseComment(e.target.value)}
                    placeholder="Укажите причину (обязательно)..."
                    rows={2}
                    style={{ width: '100%', padding: '7px 10px', background: 'var(--mc-active-item)', border: '1px solid #E5E7EB', borderRadius: 9, fontSize: 11, resize: 'none', color: 'var(--mc-text)', marginBottom: 8 }}
                  />
                  <div style={{ display: 'flex', gap: 7 }}>
                    <button
                      onClick={() => { setClosingId(null); setCloseComment(''); }}
                      style={{ flex: 1, padding: 8, background: 'var(--mc-active-item)', color: 'var(--mc-muted)', border: 'none', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                      Отмена
                    </button>
                    <button
                      onClick={() => handleClose(order.id)}
                      disabled={closingSaving || !closeComment.trim()}
                      style={{ flex: 1, padding: 8, background: closingSaving || !closeComment.trim() ? '#CBD5E1' : '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: closingSaving || !closeComment.trim() ? 'not-allowed' : 'pointer' }}>
                      {closingSaving ? '...' : '🔒 Закрыть заказ'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Модал: добавить заявку в реестр (admin / manager) ──────────────────

function AddOrderModal({ ctx, registryId, onClose }) {
  const { db, showToast, setDb } = ctx;
  const [tab,     setTab]     = useState('existing');
  const [search,  setSearch]  = useState('');
  const [selected, setSelected] = useState(new Set());
  const [saving,  setSaving]  = useState(false);
  const [qForm,   setQForm]   = useState({
    client: '', phone: '', address: '', city: 'Алматы', amount: '', comment: '',
  });

  // Заявки, уже привязанные к любому реестру (по source_order_id)
  const alreadyLinked = new Set(
    (db.deliveryOrders || []).filter(o => o.source_order_id).map(o => o.source_order_id)
  );

  // Подходящие заявки: delivery + shipped + ещё не в реестре
  const eligible = (db.orders || [])
    .filter(o =>
      o.delivery_method === 'delivery' &&
      o.status === 'shipped' &&
      !alreadyLinked.has(o.id)
    )
    .filter(o => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      const name = o.client_type === 'individual' ? (o.full_name || '') : (o.company_name || '');
      return name.toLowerCase().includes(q) || (o.address || '').toLowerCase().includes(q);
    });

  const toggleSelect = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const handleAddExisting = async () => {
    if (selected.size === 0 || saving) return;
    setSaving(true);
    const now = new Date().toISOString();
    const toAdd = (db.orders || []).filter(o => selected.has(o.id));
    const rows = toAdd.map(o => ({
      id:              uid(),
      registry_id:     registryId,
      source_order_id: o.id,
      client:          o.client_type === 'individual' ? (o.full_name || '') : (o.company_name || ''),
      contacts:        o.phone || '',
      address:         o.delivery_address || o.address || '',
      city:            '',
      amount:          Number(o.total_amount) || 0,
      status:          'pending',
      created_at:      now,
    }));
    const { error } = await supabase.from('delivery_orders').insert(rows);
    if (error) { showToast('Ошибка: ' + error.message, 'error'); setSaving(false); return; }
    setDb(d => ({ ...d, deliveryOrders: [...rows, ...d.deliveryOrders] }));
    const n = rows.length;
    showToast(`${n} ${n === 1 ? 'заявка добавлена' : n < 5 ? 'заявки добавлены' : 'заявок добавлено'} в реестр`, 'success');
    onClose();
  };

  const handleAddQuick = async () => {
    if (!qForm.client.trim() || !qForm.address.trim()) {
      showToast('Заполните клиента и адрес', 'error');
      return;
    }
    if (saving) return;
    setSaving(true);
    const now = new Date().toISOString();
    const row = {
      id:          uid(),
      registry_id: registryId,
      client:      qForm.client.trim(),
      contacts:    qForm.phone.trim(),
      address:     qForm.address.trim(),
      city:        qForm.city.trim(),
      amount:      Number(qForm.amount) || 0,
      extra_info:  qForm.comment.trim(),
      status:      'pending',
      created_at:  now,
    };
    const { error } = await supabase.from('delivery_orders').insert([row]);
    if (error) { showToast('Ошибка: ' + error.message, 'error'); setSaving(false); return; }
    setDb(d => ({ ...d, deliveryOrders: [row, ...d.deliveryOrders] }));
    showToast('Заявка добавлена в реестр', 'success');
    onClose();
  };

  const regNumber = (db.deliveryRegistries || []).find(r => r.id === registryId)?.number || '';

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,25,35,.5)',
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div style={{ background: 'var(--mc-surface)', borderRadius: '20px 20px 0 0', maxHeight: '88vh',
        display: 'flex', flexDirection: 'column' }}>

        {/* Handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px' }}>
          <div style={{ width: 36, height: 4, background: 'var(--mc-border)', borderRadius: 2 }} />
        </div>

        {/* Заголовок */}
        <div style={{ padding: '0 16px 10px', borderBottom: '1px solid var(--mc-border-light)' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--mc-text)' }}>Добавить заявку</div>
          <div style={{ fontSize: 10, color: 'var(--mc-muted)' }}>в {regNumber}</div>
        </div>

        {/* Вкладки */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--mc-border-light)', flexShrink: 0 }}>
          {[['existing', '📋 Из заявок'], ['quick', '✍️ Быстрая']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              style={{ flex: 1, padding: '10px 4px', fontSize: 12, fontWeight: 700,
                background: 'none', border: 'none', cursor: 'pointer',
                color: tab === k ? '#297b8a' : '#94a3b8',
                borderBottom: `2px solid ${tab === k ? '#297b8a' : 'transparent'}` }}>
              {l}
            </button>
          ))}
        </div>

        {tab === 'existing' ? (
          <>
            {/* Поиск */}
            <div style={{ padding: '10px 12px 6px', flexShrink: 0 }}>
              <div style={{ background: 'var(--mc-active-item)', borderRadius: 10, padding: '8px 12px',
                display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 13 }}>🔍</span>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Поиск по клиенту или адресу…"
                  style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 11,
                    color: 'var(--mc-text)', outline: 'none' }}
                />
              </div>
            </div>

            {/* Список заявок */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px' }}>
              {eligible.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 20px', color: 'var(--mc-muted)', fontSize: 12 }}>
                  {search.trim() ? 'Ничего не найдено' : 'Нет заявок готовых к доставке'}
                </div>
              ) : eligible.map(o => {
                const name = o.client_type === 'individual' ? (o.full_name || '') : (o.company_name || '');
                const isSel = selected.has(o.id);
                return (
                  <div key={o.id} onClick={() => toggleSelect(o.id)}
                    style={{ padding: '9px 10px', marginBottom: 5, cursor: 'pointer', borderRadius: 10,
                      background: isSel ? '#e8f4f6' : 'var(--mc-surface)',
                      border: `1.5px solid ${isSel ? '#297b8a' : 'var(--mc-border)'}`,
                      display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, marginTop: 1,
                      background: isSel ? '#297b8a' : '#fff',
                      border: `1.5px solid ${isSel ? '#297b8a' : '#D1D5DB'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {isSel && <span style={{ color: '#fff', fontSize: 10, fontWeight: 900 }}>✓</span>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mc-text)' }}>{name}</div>
                      <div style={{ fontSize: 9, color: 'var(--mc-muted)' }}>📍 {o.address}</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#297b8a', marginTop: 2 }}>
                        {fmtNum(o.total_amount)} тг
                      </div>
                    </div>
                    <span style={{ background: '#D1FAE5', color: '#065F46', fontSize: 8,
                      fontWeight: 700, padding: '2px 6px', borderRadius: 5, flexShrink: 0 }}>
                      К отгрузке
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Кнопка */}
            <div style={{ padding: '10px 12px 28px', borderTop: '1px solid var(--mc-border-light)', flexShrink: 0 }}>
              <button onClick={handleAddExisting}
                disabled={selected.size === 0 || saving}
                style={{ width: '100%', padding: 12, borderRadius: 12, border: 'none',
                  fontSize: 13, fontWeight: 700, cursor: selected.size === 0 || saving ? 'not-allowed' : 'pointer',
                  background: selected.size === 0 || saving ? '#CBD5E1' : '#297b8a', color: '#fff' }}>
                {saving ? '⏳ Добавляем…'
                  : selected.size === 0 ? 'Выберите заявки'
                  : `✅ Добавить ${selected.size} ${selected.size === 1 ? 'заявку' : 'заявки'} в реестр`}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Быстрая форма */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px 0' }}>
              {[
                ['client',  'Клиент *',           'text', 'ТОО / ИП / ФИО'],
                ['phone',   'Телефон',             'tel',  '+7 ___ ___ __ __'],
                ['address', 'Адрес доставки *',    'text', 'ул. Абая 25, оф. 3'],
              ].map(([field, label, type, ph]) => (
                <div key={field} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--mc-muted)',
                    textTransform: 'uppercase', letterSpacing: .5, marginBottom: 4 }}>{label}</div>
                  <input
                    type={type}
                    value={qForm[field]}
                    onChange={e => setQForm(f => ({ ...f, [field]: e.target.value }))}
                    placeholder={ph}
                    style={{ width: '100%', padding: '9px 11px', borderRadius: 10, boxSizing: 'border-box',
                      border: `1.5px solid ${qForm[field] ? '#297b8a' : 'var(--mc-border)'}`,
                      fontSize: 12, color: 'var(--mc-text)', background: 'var(--mc-surface)', outline: 'none' }}
                  />
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                {[['city', 'Город'], ['amount', 'Сумма, тг']].map(([field, label]) => (
                  <div key={field} style={{ flex: 1 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--mc-muted)',
                      textTransform: 'uppercase', letterSpacing: .5, marginBottom: 4 }}>{label}</div>
                    <input
                      type={field === 'amount' ? 'number' : 'text'}
                      value={qForm[field]}
                      onChange={e => setQForm(f => ({ ...f, [field]: e.target.value }))}
                      placeholder={field === 'amount' ? '0' : ''}
                      style={{ width: '100%', padding: '9px 11px', borderRadius: 10, boxSizing: 'border-box',
                        border: '1.5px solid #E2EAF0', fontSize: 12, color: 'var(--mc-text)',
                        background: 'var(--mc-surface)', outline: 'none' }}
                    />
                  </div>
                ))}
              </div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--mc-muted)',
                  textTransform: 'uppercase', letterSpacing: .5, marginBottom: 4 }}>Комментарий</div>
                <textarea
                  value={qForm.comment}
                  onChange={e => setQForm(f => ({ ...f, comment: e.target.value }))}
                  placeholder="Позвонить за 30 мин…"
                  rows={2}
                  style={{ width: '100%', padding: '9px 11px', borderRadius: 10, boxSizing: 'border-box',
                    border: '1.5px solid #E2EAF0', fontSize: 12, color: 'var(--mc-text)',
                    background: '#fff', outline: 'none', resize: 'none' }}
                />
              </div>
            </div>

            {/* Кнопка */}
            <div style={{ padding: '10px 12px 28px', borderTop: '1px solid var(--mc-border-light)', flexShrink: 0 }}>
              <button onClick={handleAddQuick}
                disabled={saving}
                style={{ width: '100%', padding: 12, borderRadius: 12, border: 'none',
                  fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer',
                  background: saving ? '#CBD5E1' : '#297b8a', color: '#fff' }}>
                {saving ? '⏳ Создаём…' : '➕ Создать и добавить в реестр'}
              </button>
            </div>
          </>
        )}
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
    <div style={{ background: 'var(--mc-bg)' }}>
      <ScreenHeader title="⚠️ Нужно решение" subtitle={`${orders.length} заказов ждут`} onBack={() => navigate({ name: 'delivery_registry_detail', registryId })} />
      <div style={{ padding: 12 }}>
        {orders.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--mc-muted)' }}>
            <CheckCircle2 size={36} style={{ margin: '0 auto 10px', color: '#16a34a', opacity: .5 }} />
            <div style={{ fontSize: 13 }}>Все решения приняты</div>
          </div>
        )}
        {orders.map(order => {
          const courier = db.users?.find(u => u.id === order.delivered_by);
          return (
            <div key={order.id} style={{ background: 'var(--mc-surface)', borderRadius: 12, padding: 12, marginBottom: 8, borderLeft: '3px solid #dc2626', boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}>
              <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 2, color: 'var(--mc-text)' }}>{order.client}</div>
              <div style={{ fontSize: 10, color: 'var(--mc-muted)', marginBottom: 6 }}>📍 {order.city} · {order.address}</div>
              {order.fail_reason && (
                <div style={{ fontSize: 10, color: '#dc2626', background: '#FEF2F2', padding: '4px 8px', borderRadius: 6, marginBottom: 8 }}>
                  ✗ «{order.fail_reason}»{courier ? <span style={{ color: 'var(--mc-muted)', fontSize: 9 }}> · {courier.first_name}</span> : ''}
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
  const [tab, setTab]               = useState('free');
  const [selectedRegId, setSelectedRegId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // Fetch fresh data on mount — courier may have app open before registry upload
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ data: regs }, { data: orders }] = await Promise.all([
          supabase.from('delivery_registries').select('*'),
          supabase.from('delivery_orders').select('*'),
        ]);
        if (cancelled) return;
        if (regs)   setDb(d => ({ ...d, deliveryRegistries: regs }));
        if (orders) setDb(d => ({ ...d, deliveryOrders: orders }));
      } catch (_) { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const [{ data: regs }, { data: orders }] = await Promise.all([
        supabase.from('delivery_registries').select('*'),
        supabase.from('delivery_orders').select('*'),
      ]);
      if (regs)   setDb(d => ({ ...d, deliveryRegistries: regs }));
      if (orders) setDb(d => ({ ...d, deliveryOrders: orders }));
      showToast('Данные обновлены', 'success');
    } catch (_) { showToast('Ошибка обновления', 'error'); }
    setRefreshing(false);
  };

  // All active registries newest-first
  const activeRegs = (db.deliveryRegistries || [])
    .filter(r => r.status === 'active')
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  if (activeRegs.length === 0) {
    return (
      <div style={{ background: 'var(--mc-bg)' }}>
        <ScreenHeader title="🚚 Реестр доставок" subtitle="Нет активных реестров" />
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--mc-muted)' }}>
          <Truck size={40} style={{ margin: '0 auto 12px', opacity: .3 }} />
          <div style={{ marginBottom: 16 }}>Активных реестров пока нет</div>
          <button onClick={handleRefresh} disabled={refreshing}
            style={{ padding: '8px 20px', background: '#297b8a', color: '#fff', border: 'none', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: refreshing ? .6 : 1 }}>
            {refreshing ? 'Обновление...' : '🔄 Обновить'}
          </button>
        </div>
      </div>
    );
  }

  // Selected registry — default to newest
  const reg = activeRegs.find(r => r.id === selectedRegId) || activeRegs[0];

  const allOrders    = (db.deliveryOrders || []).filter(o => o.registry_id === reg.id);
  const freeOrders   = allOrders.filter(o => o.status === 'pending' && !o.courier_id);
  const myOrders     = allOrders.filter(o => o.courier_id === currentUser.id);
  const othersOrders = allOrders.filter(o => o.courier_id && o.courier_id !== currentUser.id && o.status !== 'delivered');

  const takeOrder = async (orderId) => {
    const { error } = await supabase.from('delivery_orders')
      .update({ courier_id: currentUser.id, status: 'assigned' })
      .eq('id', orderId)
      .is('courier_id', null);
    if (error) { showToast('Заказ уже взят другим курьером', 'error'); return; }
    setDb(d => ({ ...d, deliveryOrders: d.deliveryOrders.map(o => o.id === orderId ? { ...o, courier_id: currentUser.id, status: 'assigned' } : o) }));
    showToast('Заказ добавлен в ваш список', 'success');
  };

  const tabs = [
    ['free',   `Свободные (${freeOrders.length})`],
    ['mine',   `Мои (${myOrders.length})`],
    ['others', `Чужие (${othersOrders.length})`],
  ];

  return (
    <div style={{ background: 'var(--mc-bg)' }}>
      <ScreenHeader
        title="🚚 Реестры доставок"
        subtitle={activeRegs.length > 1 ? `${activeRegs.length} активных реестра` : `${reg.number} · ${SHIFT_LABEL[reg.shift]}`}
      />

      {/* Registry selector pills — shown only when multiple active registries exist */}
      {activeRegs.length > 1 && (
        <div style={{ background: 'var(--mc-surface)', borderBottom: '1px solid var(--mc-border-light)', padding: '8px 12px', display: 'flex', gap: 8, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {activeRegs.map(r => {
            const isActive = reg.id === r.id;
            const regOrders = (db.deliveryOrders || []).filter(o => o.registry_id === r.id);
            const freeCnt   = regOrders.filter(o => o.status === 'pending' && !o.courier_id).length;
            return (
              <button key={r.id}
                onClick={() => { setSelectedRegId(r.id); setTab('free'); }}
                style={{ flexShrink: 0, padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  border: `2px solid ${isActive ? '#297b8a' : 'var(--mc-border)'}`,
                  background: isActive ? '#297b8a' : 'var(--mc-active-item)',
                  color: isActive ? '#fff' : 'var(--mc-muted)' }}>
                {r.number} · {SHIFT_LABEL[r.shift]}
                {freeCnt > 0 && <span style={{ marginLeft: 6, background: isActive ? 'rgba(255,255,255,.25)' : '#FEF9EE', color: isActive ? '#fff' : '#92400E', borderRadius: 8, padding: '1px 5px', fontSize: 9 }}>{freeCnt}</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* Tab bar */}
      <div style={{ display: 'flex', background: 'var(--mc-surface)', borderBottom: '1px solid var(--mc-border-light)', alignItems: 'center' }}>
        {tabs.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ flex: 1, padding: '9px 2px', fontSize: 10, fontWeight: 600,
              color: tab === k ? '#297b8a' : '#94a3b8',
              borderBottom: `2px solid ${tab === k ? '#297b8a' : 'transparent'}`,
              background: 'none', border: 'none', cursor: 'pointer' }}>
            {l}
          </button>
        ))}
        <button onClick={handleRefresh} disabled={refreshing}
          style={{ flexShrink: 0, padding: '6px 10px', fontSize: 10, color: '#297b8a', background: 'none', border: 'none', cursor: 'pointer', opacity: refreshing ? .4 : 1 }}
          title="Обновить данные">
          🔄
        </button>
      </div>

      {tab === 'free' && (
        <div style={{ margin: '10px 12px 0', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '8px 10px', fontSize: 10, color: '#1D4ED8' }}>
          Нажмите <b>«Взять»</b> — заказ закрепится за вами
        </div>
      )}

      <div style={{ padding: '10px 12px 12px' }}>
        {tab === 'free' && (
          <>
            {freeOrders.length === 0 && <div style={{ textAlign: 'center', padding: '32px 20px', color: 'var(--mc-muted)', fontSize: 12 }}>Все свободные заказы разобраны</div>}
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
              <div style={{ textAlign: 'center', padding: '32px 20px', color: 'var(--mc-muted)' }}>
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
  const { db, navigate, currentUser, showToast, setDb, notify } = ctx;
  const order = (db.deliveryOrders || []).find(o => o.id === orderId);

  const [cashOn,     setCashOn]     = useState(order?.cash_received   || false);
  const [cashAmt,    setCashAmt]    = useState(order ? String(order.cash_amount || order.amount || '') : '');
  const [note,       setNote]       = useState(order?.courier_note    || '');
  const [failMode,   setFailMode]   = useState(false);
  const [failReason, setFailReason] = useState('');
  const [saving,     setSaving]     = useState(false);

  if (!order) return <div style={{ padding: 24, textAlign: 'center', color: 'var(--mc-muted)' }}>Заказ не найден</div>;

  const isDone = ['delivered', 'failed'].includes(order.status);

  const finishRegistry = async (regId, updatedOrderId) => {
    // Bug fix: query Supabase directly — local db.deliveryOrders may be stale
    // or incomplete (vacuous truth: [].every() === true → registry closed prematurely).
    const { data: remoteOrders, error: fetchErr } = await supabase
      .from('delivery_orders')
      .select('id, status')
      .eq('registry_id', regId)
      .neq('id', updatedOrderId);
    if (fetchErr) return; // can't confirm, leave registry open
    if (!remoteOrders || remoteOrders.length === 0) return; // no other orders → nothing to check
    const allDone = remoteOrders.every(o => ['delivered', 'failed'].includes(o.status));
    if (!allDone) return;
    const now = new Date().toISOString();
    await supabase.from('delivery_registries').update({ status: 'completed', completed_at: now }).eq('id', regId);
    setDb(d => ({ ...d, deliveryRegistries: (d.deliveryRegistries || []).map(r => r.id === regId ? { ...r, status: 'completed', completed_at: now } : r) }));
    showToast('🎉 Реестр полностью доставлен!', 'success');
  };

  const markDelivered = async () => {
    setSaving(true);
    const now = new Date().toISOString();
    const upd = { status: 'delivered', cash_received: cashOn, cash_amount: cashOn ? (Number(cashAmt) || 0) : null, courier_note: note.trim() || null, delivered_at: now, delivered_by: currentUser.id };
    const { error } = await supabase.from('delivery_orders').update(upd).eq('id', orderId);
    if (error) { showToast('Ошибка: ' + error.message, 'error'); setSaving(false); return; }
    setDb(d => ({ ...d, deliveryOrders: d.deliveryOrders.map(o => o.id === orderId ? { ...o, ...upd } : o) }));

    // Авто-архив связанной заявки (если эта строка реестра привязана к заявке)
    if (order.source_order_id) {
      const src = (db.orders || []).find(o => o.id === order.source_order_id);
      if (src && src.status !== 'archived' && src.status !== 'cancelled') {
        const newLog = [...(src.log || []), { event: 'delivered', actor: currentUser.id, at: now }];
        const srcUpd = { status: 'archived', delivered_at: now, log: newLog };
        await supabase.from('orders').update(srcUpd).eq('id', src.id);
        setDb(d => ({ ...d, orders: (d.orders || []).map(o => o.id === src.id ? { ...o, ...srcUpd } : o) }));
        // Уведомить менеджера-автора заявки
        if (notify && src.created_by && src.created_by !== currentUser.id) {
          const clientName = src.client_type === 'individual' ? src.full_name : src.company_name;
          const notifObj = notify({
            recipient_id: src.created_by,
            title: '✅ Доставка подтверждена',
            body: `${src.order_number} · ${clientName || ''} — доставлен и архивирован`,
            link_kind: 'order', link_id: src.id,
          });
          setDb(d => ({ ...d, notifications: [notifObj, ...(d.notifications || [])] }));
        }
      }
    }

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
    <div style={{ background: 'var(--mc-bg)' }}>
      <ScreenHeader title={order.client} onBack={() => navigate({ name: 'courier_registry' })} />
      <div style={{ padding: 12 }}>

        <Card>
          {order.payment_info && (
            <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 8, padding: '6px 10px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13 }}>💳</span>
              <span style={{ fontWeight: 700, fontSize: 12, color: '#C2410C' }}>{order.payment_info}</span>
            </div>
          )}
          {[['Документ', order.document], ['Сумма', fmtNum(order.amount) + ' тг']].map(([l, v]) => v && (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--mc-border-light)', fontSize: 10 }}>
              <span style={{ color: 'var(--mc-muted)' }}>{l}</span>
              <span style={{ fontWeight: 700, color: 'var(--mc-text)' }}>{v}</span>
            </div>
          ))}
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 9, color: 'var(--mc-muted)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: .3 }}>Адрес</div>
            <div style={{ fontWeight: 600, fontSize: 11, color: 'var(--mc-text)' }}>{order.address}</div>
          </div>
          {order.contacts && (
            <a href={`tel:${order.contacts}`}
              style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, padding: '8px 10px', background: '#F0F9FF', borderRadius: 8, textDecoration: 'none', color: '#297b8a', fontWeight: 700, fontSize: 11 }}>
              <Phone size={14} /> {order.contacts}
            </a>
          )}
          {order.extra_info && (
            <div style={{ marginTop: 8, fontSize: 10, color: 'var(--mc-muted)', background: 'var(--mc-active-item)', padding: '6px 8px', borderRadius: 8 }}>
              💬 {order.extra_info}
            </div>
          )}
        </Card>

        {isDone ? (
          <div style={{ background: 'var(--mc-surface)', borderRadius: 12, padding: 16, textAlign: 'center', border: '1px solid var(--mc-border)' }}>
            {order.status === 'delivered'
              ? <><CheckCircle2 size={36} color="#16a34a" style={{ margin: '0 auto 8px' }} /><div style={{ fontWeight: 700, color: '#16a34a', fontSize: 14 }}>Доставлен</div></>
              : <><XCircle size={36} color="#dc2626" style={{ margin: '0 auto 8px' }} /><div style={{ fontWeight: 700, color: '#dc2626', fontSize: 14 }}>Не удалось доставить</div></>
            }
          </div>
        ) : !failMode ? (
          <Card>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 10 }}>Отметить результат</div>

            <div style={{ background: cashOn ? '#F0FDF4' : '#F5F7F8', border: `1px solid ${cashOn ? '#BBF7D0' : 'var(--mc-border)'}`, borderRadius: 10, padding: 10, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: cashOn ? 10 : 0 }}>
                <div onClick={() => setCashOn(v => !v)}
                  style={{ width: 36, height: 20, borderRadius: 10, background: cashOn ? '#297b8a' : '#CBD5E1', position: 'relative', cursor: 'pointer', flexShrink: 0 }}>
                  <div style={{ width: 16, height: 16, background: '#fff', borderRadius: '50%', position: 'absolute', top: 2, transition: 'transform .2s', transform: cashOn ? 'translateX(18px)' : 'translateX(2px)', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: cashOn ? '#16a34a' : '#64748b' }}>💵 Получены наличные</span>
              </div>
              {cashOn && (
                <>
                  <div style={{ fontSize: 10, color: 'var(--mc-muted)', marginBottom: 4 }}>Сумма наличных (тг)</div>
                  <input value={cashAmt} onChange={e => setCashAmt(e.target.value)} type="number"
                    style={{ width: '100%', padding: '8px 10px', background: 'var(--mc-surface)', border: '1px solid #BBF7D0', borderRadius: 10, fontSize: 14, fontWeight: 700, color: '#16a34a' }} />
                </>
              )}
            </div>

            <div style={{ fontSize: 10, color: 'var(--mc-muted)', marginBottom: 4 }}>Комментарий (необязательно)</div>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Подпись получена..."
              style={{ width: '100%', padding: '8px 10px', background: 'var(--mc-active-item)', border: '1px solid #E5E7EB', borderRadius: 10, fontSize: 11, marginBottom: 10, color: 'var(--mc-text)' }} />

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
            <div style={{ fontSize: 10, color: 'var(--mc-muted)', marginBottom: 4 }}>Причина *</div>
            <input value={failReason} onChange={e => setFailReason(e.target.value)} placeholder="Дверь закрыта / неверный адрес / ..."
              style={{ width: '100%', padding: '8px 10px', background: 'var(--mc-active-item)', border: '1px solid #E5E7EB', borderRadius: 10, fontSize: 11, marginBottom: 10, color: 'var(--mc-text)' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setFailMode(false)}
                style={{ flex: 1, padding: 10, background: 'var(--mc-active-item)', color: 'var(--mc-muted)', border: 'none', borderRadius: 10, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
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

  // All active registries — support multiple simultaneously
  const activeRegs = (db.deliveryRegistries || [])
    .filter(r => r.status === 'active')
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  if (activeRegs.length === 0) return null;

  const activeRegIds = new Set(activeRegs.map(r => r.id));
  // Aggregate my orders across ALL active registries
  const myOrders  = (db.deliveryOrders || []).filter(o => activeRegIds.has(o.registry_id) && o.courier_id === currentUser.id);
  const done      = myOrders.filter(o => o.status === 'delivered').length;
  const cash      = myOrders.filter(o => o.cash_received).reduce((s, o) => s + (Number(o.cash_amount) || 0), 0);
  const pct       = myOrders.length > 0 ? Math.round((done / myOrders.length) * 100) : 0;
  const nextOrder = myOrders.find(o => o.status === 'assigned');

  const widgetTitle = activeRegs.length > 1
    ? `${activeRegs.length} активных реестра`
    : 'Активный реестр';
  const widgetSubtitle = activeRegs.length > 1
    ? activeRegs.map(r => r.number).join(' · ')
    : `${activeRegs[0].number} ${SHIFT_LABEL[activeRegs[0].shift]}`;

  return (
    <div style={{ margin: '12px 12px 0' }}>
      <div onClick={() => navigate({ name: 'courier_registry' })}
        style={{ background: 'linear-gradient(135deg, #297b8a 0%, #1d5a67 100%)', borderRadius: 16, padding: 16, color: '#fff', cursor: 'pointer' }}>
        <div style={{ fontSize: 10, opacity: .75, marginBottom: 2 }}>{widgetTitle}</div>
        <div style={{ fontSize: activeRegs.length > 1 ? 14 : 18, fontWeight: 800, marginBottom: 6 }}>{widgetSubtitle}</div>
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
          style={{ background: 'var(--mc-surface)', borderRadius: 12, padding: '10px 12px', marginTop: 8, border: '1px solid var(--mc-border)', cursor: 'pointer' }}>
          <div style={{ fontSize: 9, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 3 }}>Следующий заказ</div>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--mc-text)', marginBottom: 2 }}>{nextOrder.client}</div>
          <div style={{ fontSize: 10, color: 'var(--mc-muted)', marginBottom: 6 }}>📍 {nextOrder.address}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: 12 }}>{fmtNum(nextOrder.amount)} тг</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#297b8a' }}>Открыть →</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Детали заявки реестра + смена адреса ────────────────────────────────
function OrderDetailModal({ order, db, currentUser, canEdit, onClose, onAddressChange }) {
  const [editingAddress, setEditingAddress] = useState(false);
  const [newAddress,     setNewAddress]     = useState(order.address || '');
  const [saving,         setSaving]         = useState(false);

  const handleSave = async () => {
    if (!newAddress.trim() || newAddress.trim() === order.address) { setEditingAddress(false); return; }
    setSaving(true);
    await onAddressChange(newAddress.trim());
    setSaving(false);
    setEditingAddress(false);
  };

  const addressLog = (order.log || []).filter(e => e.event === 'address_change');
  const courier    = db.users?.find(u => u.id === order.courier_id);

  const Field = ({ label, value }) => value ? (
    <div style={{ display: 'flex', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--mc-border-light)' }}>
      <span style={{ fontSize: 10, color: 'var(--mc-muted)', minWidth: 90, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 11, color: 'var(--mc-text)', wordBreak: 'break-word' }}>{value}</span>
    </div>
  ) : null;

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ background: 'var(--mc-surface)', width: '100%', borderRadius: '20px 20px 0 0', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>

        {/* Шапка */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px', borderBottom: '1px solid var(--mc-border-light)', flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--mc-text)' }}>{order.client}</div>
            <div style={{ fontSize: 10, color: 'var(--mc-muted)', marginTop: 2 }}>
              <StatusBadge status={order.status} managerDecision={order.manager_decision} />
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mc-muted)', fontSize: 20, padding: 4, lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '12px 16px 28px' }}>

          {/* Адрес с историей изменений */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .4 }}>Адрес доставки</span>
              {canEdit && !editingAddress && (
                <button onClick={() => { setNewAddress(order.address || ''); setEditingAddress(true); }}
                  style={{ fontSize: 10, fontWeight: 700, color: '#297b8a', background: '#F0F9FA', border: '1px solid #b0dce5', borderRadius: 7, padding: '3px 10px', cursor: 'pointer' }}>
                  ✏️ Изменить
                </button>
              )}
            </div>

            {editingAddress ? (
              <div>
                <textarea value={newAddress} onChange={e => setNewAddress(e.target.value)} rows={2} autoFocus
                  style={{ width: '100%', padding: '8px 10px', border: '1.5px solid #297b8a', borderRadius: 9, fontSize: 12, resize: 'none', color: 'var(--mc-text)', background: 'var(--mc-surface)', boxSizing: 'border-box', outline: 'none', marginBottom: 6 }} />
                <div style={{ display: 'flex', gap: 7 }}>
                  <button onClick={() => setEditingAddress(false)}
                    style={{ flex: 1, padding: 8, background: 'var(--mc-active-item)', color: 'var(--mc-muted)', border: 'none', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                    Отмена
                  </button>
                  <button onClick={handleSave} disabled={saving}
                    style={{ flex: 1, padding: 8, background: saving ? '#CBD5E1' : '#297b8a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}>
                    {saving ? '...' : '💾 Сохранить'}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--mc-text)', padding: '6px 10px', background: 'var(--mc-active-item)', borderRadius: 9 }}>
                📍 {order.address || '—'}
              </div>
            )}

            {/* История изменений адреса */}
            {addressLog.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 9, color: 'var(--mc-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .4, marginBottom: 4 }}>История изменений адреса</div>
                {addressLog.map((e, i) => {
                  const actor = db.users?.find(u => u.id === e.actor);
                  return (
                    <div key={i} style={{ fontSize: 10, color: 'var(--mc-muted)', marginBottom: 6, paddingLeft: 8, borderLeft: '2px solid var(--mc-border)' }}>
                      <span style={{ color: '#dc2626', textDecoration: 'line-through' }}>{e.from}</span>
                      {' → '}
                      <span style={{ color: '#16a34a', fontWeight: 600 }}>{e.to}</span>
                      <div style={{ fontSize: 9, marginTop: 2 }}>
                        {actor ? `${actor.first_name} ${actor.last_name}` : '—'} · {new Date(e.at).toLocaleString('ru-KZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Контакты и данные */}
          <div style={{ background: 'var(--mc-active-item)', borderRadius: 12, padding: '10px 12px', marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .4, marginBottom: 6 }}>Контакты и данные</div>
            <Field label="Телефон"     value={order.contacts} />
            <Field label="Организация" value={order.organization} />
            <Field label="Документ"    value={order.document} />
            <Field label="Оплата"      value={order.payment_info} />
            <Field label="Код заявки"  value={order.request_code} />
            <Field label="Доставка"    value={order.delivery_method} />
            <Field label="Город"       value={order.city} />
            <Field label="№ п/п"       value={order.seq_number} />
          </div>

          {/* Комментарии */}
          {(order.extra_info || order.courier_note || order.manager_note) && (
            <div style={{ background: 'var(--mc-active-item)', borderRadius: 12, padding: '10px 12px', marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .4, marginBottom: 6 }}>Комментарии</div>
              <Field label="Примечание" value={order.extra_info} />
              <Field label="Курьер"     value={order.courier_note} />
              <Field label="Менеджер"   value={order.manager_note} />
            </div>
          )}

          {/* Доставлено */}
          {order.status === 'delivered' && (
            <div style={{ background: '#D1FAE5', borderRadius: 12, padding: '10px 12px', marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#065F46', textTransform: 'uppercase', letterSpacing: .4, marginBottom: 6 }}>✓ Доставлено</div>
              <Field label="Курьер"    value={courier ? `${courier.first_name} ${courier.last_name}` : '—'} />
              <Field label="Наличные"  value={order.cash_received ? `${fmtNum(order.cash_amount)} тг` : null} />
              <Field label="Время"     value={order.delivered_at ? new Date(order.delivered_at).toLocaleString('ru-KZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' }) : null} />
            </div>
          )}

          {/* Не доставлено */}
          {order.status === 'failed' && order.fail_reason && (
            <div style={{ background: '#FEF2F2', borderRadius: 12, padding: '10px 12px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: .4, marginBottom: 4 }}>Причина неудачи</div>
              <div style={{ fontSize: 12, color: 'var(--mc-text)' }}>{order.fail_reason}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
