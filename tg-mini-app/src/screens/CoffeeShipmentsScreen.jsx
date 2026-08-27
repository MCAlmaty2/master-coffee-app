/**
 * CoffeeShipmentsScreen.jsx — «Реестр отгрузок кофеен»
 * Данные (кроме суммы оплаты) вносятся вручную из 1С.
 * Сумма оплаты вносится управляющим / менеджером.
 * Автоматически считается долг, фильтр по адресам.
 */
import React, { useState, useMemo } from 'react';
import {
  ChevronLeft, ChevronRight, ClipboardPaste, Trash2,
  Search, X, Edit3, Check,
} from 'lucide-react';
import { supabase } from '../supabase/client';

/* ── Хелперы ─────────────────────────────────────────────── */
const fmtMoney = n =>
  (Number(n) || 0).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const MONTH_NAMES = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь',
];

function monthLabel(key) {
  const [y, m] = key.split('-');
  return `${MONTH_NAMES[+m - 1]} ${y}`;
}

function currentMonthKey() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}

function dateSortKey(d) {
  if (!d) return '';
  const p = d.split('.');
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : d;
}

/* ── Нормализация адресов кофеен ──────────────────────────── */
const COFFEE_SHOPS = [
  { match: '597',          address: 'Сейфуллина 597В/1',  name: 'MC Seifullina' },
  { match: 'Жандосова',    address: 'Жандосова 58/1',      name: 'MC Aimanova' },
  { match: '416',          address: 'Сейфуллина 416',      name: 'MC Meredian' },
  { match: 'Розыбакиева',  address: 'Розыбакиева 247а',   name: 'MC Mega Rozybakieva' },
];

function normalizeAddress(raw) {
  const s = (raw || '').trim();
  if (!s) return s;
  for (const shop of COFFEE_SHOPS) {
    if (s.includes(shop.match)) return shop.address;
  }
  return s;
}

function shopName(address) {
  const shop = COFFEE_SHOPS.find(s => s.address === address);
  return shop ? shop.name : null;
}

function parseAmount(s) {
  if (s === null || s === undefined) return 0;
  const cleaned = String(s).replace(/[\s ]/g, '').replace(',', '.');
  return parseFloat(cleaned) || 0;
}

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
        const r = (Math.random() * 16) | 0;
        return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

/* ── Парсинг TSV из 1С (с поддержкой кавычек) ────────────── */
function parsePaste(text) {
  // Полноценный разбор TSV: 1С оборачивает многострочные ячейки в "..."
  const rawRows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"' && field === '') inQuotes = true;
      else if (ch === '\t') { row.push(field); field = ''; }
      else if (ch === '\r') { /* skip */ }
      else if (ch === '\n') { row.push(field); rawRows.push(row); row = []; field = ''; }
      else                  field += ch;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rawRows.push(row); }

  // Маппинг: Номер · Дата · Сумма · Контрагент · Адрес доставки · Организация · Номер заказа
  // Строки без номера — продолжение предыдущей (многострочные ячейки без кавычек)
  const result = [];
  for (const c of rawRows) {
    if (!c.some(x => (x || '').trim() !== '')) continue;
    const num = (c[0] || '').trim();
    const isDataRow = num && c.length >= 3;
    if (!isDataRow && result.length > 0) {
      const tail = c.map(x => (x || '').trim()).filter(Boolean).join(' ');
      if (tail) {
        const prev = result[result.length - 1];
        prev.delivery_address = (prev.delivery_address ? prev.delivery_address + ' ' : '') + tail;
      }
      continue;
    }
    if (!isDataRow) continue;
    result.push({
      number:           num,
      date:             (c[1] || '').trim(),
      amount:           parseAmount(c[2]),
      counterparty:     (c[3] || '').trim(),
      delivery_address: normalizeAddress(c[4]),
      organization:     (c[5] || '').trim(),
      site_order_number:(c[6] || '').trim(),
    });
  }
  return result;
}

/* ═══════════════════════════════════════════════════════════
   ГЛАВНЫЙ ЭКРАН
   ═══════════════════════════════════════════════════════════ */
export function CoffeeShipmentsScreen({ ctx }) {
  const { db, currentUser, goBack, setDb, showToast, can, syncSnapshotRef } = ctx;

  const canEdit = can ? can('coffee_shipments_edit') : false;
  const canPay  = can ? can('coffee_shipments_pay')  : false;
  const canView = can ? can('coffee_shipments_view') : false;

  const rows = db.coffeeShipments || [];

  /* ── Месяцы ── */
  const months = useMemo(() => {
    const set = new Set(rows.map(r => r.month));
    set.add(currentMonthKey());
    return [...set].sort().reverse();
  }, [rows]);

  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey());
  const [pasteOpen, setPasteOpen]         = useState(false);
  const [search, setSearch]               = useState('');
  const [addressFilter, setAddressFilter] = useState('all');
  const [paidFilter, setPaidFilter]       = useState('all'); // all | paid | debt
  const [editingId, setEditingId]         = useState(null);
  const [editPayment, setEditPayment]     = useState('');
  const [editRowId, setEditRowId]         = useState(null);
  const [editRowData, setEditRowData]     = useState({});

  if (!canView && !canEdit && !canPay) {
    return (
      <div>
        <button onClick={goBack} style={backBtnStyle}>
          <ChevronLeft size={15} /> Назад
        </button>
        <div style={noAccessStyle}>Нет доступа к реестру отгрузок кофеен</div>
      </div>
    );
  }

  /* ── Уникальные адреса ── */
  const allAddresses = useMemo(() => {
    const set = new Set(rows.filter(r => r.month === selectedMonth).map(r => normalizeAddress(r.delivery_address)).filter(Boolean));
    return [...set].sort();
  }, [rows, selectedMonth]);

  /* ── Фильтрованные строки ── */
  const monthRows = rows
    .filter(r => r.month === selectedMonth)
    .filter(r => addressFilter === 'all' || normalizeAddress(r.delivery_address) === addressFilter)
    .filter(r => {
      if (paidFilter === 'all') return true;
      const debt = (Number(r.amount) || 0) - (Number(r.payment_amount) || 0);
      return paidFilter === 'paid' ? debt <= 0 : debt > 0;
    })
    .filter(r => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (r.number || '').toLowerCase().includes(q)
        || (r.counterparty || '').toLowerCase().includes(q)
        || (r.delivery_address || '').toLowerCase().includes(q)
        || (r.site_order_number || '').toLowerCase().includes(q);
    })
    .sort((a, b) => dateSortKey(b.date).localeCompare(dateSortKey(a.date)) || (b.number || '').localeCompare(a.number || ''));

  /* ── Долг по адресам — ВСЕ периоды, ВСЕ отгрузки ── */
  const addressStats = useMemo(() => {
    const byAddr = {};
    for (const r of rows) {
      const addr = normalizeAddress(r.delivery_address) || 'Без адреса';
      if (!byAddr[addr]) byAddr[addr] = { amount: 0, paid: 0, count: 0, orgs: {} };
      byAddr[addr].amount += Number(r.amount) || 0;
      byAddr[addr].paid   += Number(r.payment_amount) || 0;
      byAddr[addr].count  += 1;
      const org = (r.organization || '').trim() || 'Без организации';
      if (!byAddr[addr].orgs[org]) byAddr[addr].orgs[org] = { amount: 0, paid: 0, count: 0 };
      byAddr[addr].orgs[org].amount += Number(r.amount) || 0;
      byAddr[addr].orgs[org].paid   += Number(r.payment_amount) || 0;
      byAddr[addr].orgs[org].count  += 1;
    }
    return byAddr;
  }, [rows]);

  const totalStats = useMemo(() => {
    const all = rows.filter(r => r.month === selectedMonth);
    const totalAmount = all.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const totalPaid   = all.reduce((s, r) => s + (Number(r.payment_amount) || 0), 0);
    return { count: all.length, totalAmount, totalPaid, debt: totalAmount - totalPaid };
  }, [rows, selectedMonth]);

  /* ── Операции ── */
  const addRows = async (parsed) => {
    const newRows = parsed.map(p => ({
      id: uid(),
      month: selectedMonth,
      number: p.number,
      date: p.date,
      amount: p.amount,
      counterparty: p.counterparty,
      delivery_address: p.delivery_address,
      organization: p.organization || '',
      payment_amount: 0,
      site_order_number: p.site_order_number,
      created_by: currentUser.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      org_id: ctx.currentOrgId,
    }));
    const { error } = await supabase.from('coffee_shipments').insert(newRows);
    if (error) { showToast('Ошибка: ' + error.message); return; }
    setDb(d => {
      const updated = [...(d.coffeeShipments || []), ...newRows];
      if (syncSnapshotRef) syncSnapshotRef.current.coffeeShipments = updated;
      return { ...d, coffeeShipments: updated };
    });
    showToast(`Добавлено ${newRows.length} записей`);
  };

  const deleteRow = async (id) => {
    const { error } = await supabase.from('coffee_shipments').delete().eq('id', id);
    if (error) { showToast('Ошибка удаления'); return; }
    setDb(d => {
      const updated = (d.coffeeShipments || []).filter(r => r.id !== id);
      if (syncSnapshotRef) syncSnapshotRef.current.coffeeShipments = updated;
      return { ...d, coffeeShipments: updated };
    });
    showToast('Удалено');
  };

  const savePayment = async (id) => {
    const val = parseAmount(editPayment);
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('coffee_shipments')
      .update({ payment_amount: val, updated_at: now })
      .eq('id', id);
    if (error) { showToast('Ошибка сохранения'); return; }
    setDb(d => {
      const updated = (d.coffeeShipments || []).map(r =>
        r.id === id ? { ...r, payment_amount: val, updated_at: now } : r
      );
      if (syncSnapshotRef) syncSnapshotRef.current.coffeeShipments = updated;
      return { ...d, coffeeShipments: updated };
    });
    setEditingId(null);
    setEditPayment('');
    showToast('Оплата сохранена');
  };

  const startEditRow = (r) => {
    setEditRowId(r.id);
    setEditRowData({
      number: r.number || '',
      date: r.date || '',
      amount: String(r.amount || ''),
      counterparty: r.counterparty || '',
      delivery_address: r.delivery_address || '',
      organization: r.organization || '',
      payment_amount: String(r.payment_amount || ''),
      site_order_number: r.site_order_number || '',
    });
  };

  const saveRowEdit = async (id) => {
    const now = new Date().toISOString();
    const patch = {
      number: editRowData.number,
      date: editRowData.date,
      amount: parseAmount(editRowData.amount),
      counterparty: editRowData.counterparty,
      delivery_address: editRowData.delivery_address,
      organization: editRowData.organization,
      payment_amount: parseAmount(editRowData.payment_amount),
      site_order_number: editRowData.site_order_number,
      updated_at: now,
    };
    const { error } = await supabase.from('coffee_shipments').update(patch).eq('id', id);
    if (error) { showToast('Ошибка сохранения'); return; }
    setDb(d => {
      const updated = (d.coffeeShipments || []).map(r =>
        r.id === id ? { ...r, ...patch } : r
      );
      if (syncSnapshotRef) syncSnapshotRef.current.coffeeShipments = updated;
      return { ...d, coffeeShipments: updated };
    });
    setEditRowId(null);
    setEditRowData({});
    showToast('Запись обновлена');
  };

  /* ── Переключение месяца ── */
  const mi = months.indexOf(selectedMonth);
  const prevMonth = () => mi < months.length - 1 && setSelectedMonth(months[mi + 1]);
  const nextMonth = () => mi > 0 && setSelectedMonth(months[mi - 1]);

  return (
    <div>
      {/* Шапка */}
      <button onClick={goBack} style={backBtnStyle}>
        <ChevronLeft size={15} /> Назад
      </button>
      <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 16px', color: 'var(--mc-text)' }}>
        Реестр отгрузок кофеен
      </h2>

      {/* Переключатель месяца */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 16 }}>
        <button onClick={prevMonth} style={navBtnStyle}><ChevronLeft size={18} /></button>
        <span style={{ fontWeight: 600, fontSize: 15, minWidth: 130, textAlign: 'center' }}>
          {monthLabel(selectedMonth)}
        </span>
        <button onClick={nextMonth} style={navBtnStyle}><ChevronRight size={18} /></button>
      </div>

      {/* Сводка по долгам */}
      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: 'var(--mc-text)' }}>
          Сводка за месяц
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
          <StatBox label="Всего отгрузок" value={totalStats.count} color="#3390EC" />
          <StatBox label="Сумма" value={fmtMoney(totalStats.totalAmount) + ' ₸'} color="#0891B2" />
          <StatBox label="Оплачено" value={fmtMoney(totalStats.totalPaid) + ' ₸'} color="#10B981" />
          <StatBox label="Долг" value={fmtMoney(totalStats.debt) + ' ₸'}
            color={totalStats.debt > 0 ? '#EB5757' : '#10B981'} />
        </div>
      </div>

      {/* Долг по адресам — все периоды (всегда видна) */}
      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: 'var(--mc-text)' }}>
          Долг по адресам <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--mc-muted)' }}>(все периоды)</span>
        </div>
        {Object.keys(addressStats).length === 0 ? (
          <div style={{ padding: '12px 0', textAlign: 'center', fontSize: 12, color: 'var(--mc-muted)' }}>
            Нет задолженности
          </div>
        ) : Object.entries(addressStats)
          .sort(([,a], [,b]) => (b.amount - b.paid) - (a.amount - a.paid))
          .map(([addr, s]) => {
            const debt = s.amount - s.paid;
            const orgs = Object.entries(s.orgs);
            return (
              <div key={addr} style={{ marginBottom: 6 }}>
                <div
                  onClick={() => setAddressFilter(addressFilter === addr ? 'all' : addr)}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                    background: addressFilter === addr ? '#EFF6FF' : 'transparent',
                    border: addressFilter === addr ? '1px solid #3390EC' : '1px solid transparent',
                  }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {shopName(addr) ? <span style={{ color: '#297b8a' }}>{shopName(addr)}</span> : addr}
                    </div>
                    {shopName(addr) && <div style={{ fontSize: 11, color: 'var(--mc-muted)' }}>{addr}</div>}
                    <div style={{ fontSize: 11, color: 'var(--mc-muted)' }}>{s.count} отгрузок</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: debt > 0 ? '#EB5757' : '#10B981' }}>
                      {debt > 0 ? `−${fmtMoney(debt)} ₸` : '0 ₸'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--mc-muted)' }}>
                      из {fmtMoney(s.amount)} ₸
                    </div>
                  </div>
                </div>
                {orgs.length > 1 && orgs.map(([org, o]) => {
                  const orgDebt = o.amount - o.paid;
                  return (
                    <div key={org} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '4px 10px 4px 28px', fontSize: 11,
                    }}>
                      <span style={{ color: 'var(--mc-muted)' }}>{org} · {o.count} шт</span>
                      <span style={{ fontWeight: 600, color: orgDebt > 0 ? '#EB5757' : '#10B981' }}>
                        {orgDebt > 0 ? `−${fmtMoney(orgDebt)} ₸` : '0 ₸'}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        {addressFilter !== 'all' && (
          <button onClick={() => setAddressFilter('all')}
            style={{ fontSize: 12, color: '#3390EC', background: 'none', border: 'none', cursor: 'pointer', marginTop: 4 }}>
            Сбросить фильтр
          </button>
        )}
      </div>

      {/* Фильтр оплаты */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: 'var(--mc-muted)', fontWeight: 600 }}>💰 Оплата:</span>
        <div style={{ display: 'flex', gap: 2, background: 'var(--mc-active-item, #f1f5f9)', borderRadius: 8, padding: 2 }}>
          {[['all', 'Все'], ['paid', 'Оплачено'], ['debt', 'С долгом']].map(([v, l]) => (
            <button key={v} onClick={() => setPaidFilter(v)}
              style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                cursor: 'pointer', border: 'none',
                background: paidFilter === v ? '#297b8a' : 'transparent',
                color: paidFilter === v ? '#fff' : 'var(--mc-muted)',
              }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Поиск + кнопка вставки */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--mc-muted)' }} />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Поиск: номер, контрагент, адрес..."
            style={searchInputStyle}
          />
        </div>
        {canEdit && (
          <button onClick={() => setPasteOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: '#297b8a', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <ClipboardPaste size={14} /> Вставить из 1С
          </button>
        )}
      </div>

      {/* Таблица */}
      <div style={{ overflowX: 'auto', marginBottom: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--mc-surface-2)' }}>
              <Th>№</Th>
              <Th>Дата</Th>
              <Th>Сумма</Th>
              <Th>Контрагент</Th>
              <Th>Адрес</Th>
              <Th>Организация</Th>
              <Th>Оплата</Th>
              <Th>Долг</Th>
              <Th>Заказ</Th>
              {canEdit && <Th></Th>}
            </tr>
          </thead>
          <tbody>
            {monthRows.length === 0 && (
              <tr><td colSpan={canEdit ? 10 : 9} style={{ textAlign: 'center', padding: 24, color: 'var(--mc-muted)' }}>
                Нет записей за этот месяц
              </td></tr>
            )}
            {monthRows.map(r => {
              const debt = (Number(r.amount) || 0) - (Number(r.payment_amount) || 0);
              const isEditing = editingId === r.id;
              const isRowEdit = editRowId === r.id;
              const eInput = (field, w = 70) => (
                <input
                  value={editRowData[field] || ''}
                  onChange={e => setEditRowData(d => ({ ...d, [field]: e.target.value }))}
                  style={{ width: w, padding: '2px 4px', fontSize: 11, borderRadius: 4, border: '1px solid #3390EC', background: '#fff' }}
                />
              );
              return (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--mc-border)' }}>
                  <Td>{isRowEdit ? eInput('number', 50) : r.number}</Td>
                  <Td>{isRowEdit ? eInput('date', 75) : r.date}</Td>
                  <Td style={{ whiteSpace: 'nowrap' }}>{isRowEdit ? eInput('amount', 70) : fmtMoney(r.amount)}</Td>
                  <Td>{isRowEdit ? eInput('counterparty', 90) : r.counterparty}</Td>
                  <Td>{isRowEdit ? eInput('delivery_address', 100) : r.delivery_address}</Td>
                  <Td>{isRowEdit ? eInput('organization', 80) : r.organization}</Td>
                  <Td>
                    {isRowEdit ? eInput('payment_amount', 70) : isEditing ? (
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <input
                          type="number"
                          value={editPayment}
                          onChange={e => setEditPayment(e.target.value)}
                          style={{ width: 80, padding: '2px 6px', fontSize: 12, borderRadius: 6, border: '1px solid #3390EC' }}
                          autoFocus
                          onKeyDown={e => e.key === 'Enter' && savePayment(r.id)}
                        />
                        <button onClick={() => savePayment(r.id)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#10B981', padding: 2 }}>
                          <Check size={14} />
                        </button>
                        <button onClick={() => { setEditingId(null); setEditPayment(''); }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EB5757', padding: 2 }}>
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span>{fmtMoney(r.payment_amount)}</span>
                        {(canPay || canEdit) && !isRowEdit && (
                          <button
                            onClick={() => { setEditingId(r.id); setEditPayment(String(r.payment_amount || '')); }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3390EC', padding: 2 }}>
                            <Edit3 size={12} />
                          </button>
                        )}
                      </div>
                    )}
                  </Td>
                  <Td>
                    <span style={{
                      fontWeight: 600,
                      color: debt > 0 ? '#EB5757' : '#10B981',
                    }}>
                      {debt > 0 ? fmtMoney(debt) : '0'}
                    </span>
                  </Td>
                  <Td>{isRowEdit ? eInput('site_order_number', 70) : r.site_order_number}</Td>
                  {canEdit && (
                    <Td>
                      {isRowEdit ? (
                        <div style={{ display: 'flex', gap: 2 }}>
                          <button onClick={() => saveRowEdit(r.id)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#10B981', padding: 2 }}>
                            <Check size={14} />
                          </button>
                          <button onClick={() => { setEditRowId(null); setEditRowData({}); }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EB5757', padding: 2 }}>
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 2 }}>
                          <button onClick={() => startEditRow(r)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3390EC', padding: 2 }}>
                            <Edit3 size={13} />
                          </button>
                          <button onClick={() => { if (confirm('Удалить запись?')) deleteRow(r.id); }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EB5757', padding: 2 }}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Итого по фильтру */}
      {monthRows.length > 0 && (
        <div style={{ ...cardStyle, display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span>Итого ({monthRows.length})</span>
          <div style={{ textAlign: 'right' }}>
            <div>Сумма: <b>{fmtMoney(monthRows.reduce((s, r) => s + (Number(r.amount) || 0), 0))} ₸</b></div>
            <div>Оплата: <b style={{ color: '#10B981' }}>{fmtMoney(monthRows.reduce((s, r) => s + (Number(r.payment_amount) || 0), 0))} ₸</b></div>
            <div>Долг: <b style={{ color: '#EB5757' }}>
              {fmtMoney(monthRows.reduce((s, r) => s + ((Number(r.amount) || 0) - (Number(r.payment_amount) || 0)), 0))} ₸
            </b></div>
          </div>
        </div>
      )}

      {/* Модалка вставки из 1С */}
      {pasteOpen && <PasteModal onClose={() => setPasteOpen(false)} onConfirm={(parsed) => { addRows(parsed); setPasteOpen(false); }} />}
    </div>
  );
}

/* ── Home tile для DashboardHome ── */
export function CoffeeShipmentsHomeTile({ ctx }) {
  const { db, navigate, can } = ctx;
  if (!can('coffee_shipments_view') && !can('coffee_shipments_edit')) return null;
  const all = db.coffeeShipments || [];
  const totalDebt = all.reduce((s, r) => s + Math.max(0, (Number(r.amount) || 0) - (Number(r.payment_amount) || 0)), 0);
  return {
    key: 'coffee_shipments',
    label: 'Кофейни',
    value: totalDebt > 0 ? fmtMoney(totalDebt) + ' ₸' : all.length,
    hint: totalDebt > 0 ? 'долг' : 'отгрузок',
    color: totalDebt > 0 ? '#EB5757' : '#0891B2',
    go: () => navigate({ name: 'coffee_shipments' }),
    highlight: totalDebt > 0,
  };
}

/* ── Модалка вставки из 1С ── */
function PasteModal({ onClose, onConfirm }) {
  const [text, setText] = useState('');
  const parsed = text.trim() ? parsePaste(text) : [];

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 9999, display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ background: 'var(--mc-surface)', width: '100%', borderRadius: '20px 20px 0 0', maxHeight: 'min(85vh, 85dvh)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px', borderBottom: '1px solid var(--mc-border)', flexShrink: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--mc-text)' }}>Вставить из 1С</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mc-muted)' }}><X size={20} /></button>
        </div>
        <div style={{ padding: '12px 16px', overflowY: 'auto', flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--mc-muted)', marginBottom: 8, lineHeight: 1.5 }}>
            Скопируйте строки из 1С (колонки <strong>Номер · Дата · Сумма · Контрагент · Адрес доставки · Организация · Номер заказа</strong>) и вставьте сюда. Каждая строка — отдельная отгрузка.
          </div>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            autoFocus
            placeholder={'001\t09.06.2026\t150 000\tТОО Кофемания\tул. Абая 10\tMC FOOD\tWEB-1234'}
            rows={8}
            style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--mc-border)', borderRadius: 10, fontSize: 12, fontFamily: 'monospace', resize: 'vertical', outline: 'none', background: 'var(--mc-active-item, #f8fafc)', color: 'var(--mc-text)', boxSizing: 'border-box' }}
          />
          {parsed.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mc-muted)', marginBottom: 6 }}>
                Распознано строк: {parsed.length}
              </div>
              <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--mc-border)', borderRadius: 10 }}>
                {parsed.slice(0, 30).map((p, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, padding: '6px 10px', borderBottom: '1px solid var(--mc-border)', fontSize: 11, alignItems: 'center' }}>
                    <span style={{ fontFamily: 'monospace', color: '#297b8a', flexShrink: 0, minWidth: 60 }}>{p.number || '—'}</span>
                    <span style={{ color: 'var(--mc-text)', fontWeight: 600, flexShrink: 0, minWidth: 70 }}>{fmtMoney(p.amount)} ₸</span>
                    <span style={{ color: 'var(--mc-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{p.counterparty}</span>
                    <span style={{ color: '#0891B2', fontSize: 10, flexShrink: 0 }}>{p.delivery_address}</span>
                  </div>
                ))}
                {parsed.length > 30 && <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--mc-muted)' }}>...и ещё {parsed.length - 30}</div>}
              </div>
            </div>
          )}
        </div>
        <div style={{ padding: '10px 16px 28px', borderTop: '1px solid var(--mc-border)', flexShrink: 0 }}>
          <button onClick={() => onConfirm(parsed)} disabled={parsed.length === 0}
            style={{ width: '100%', padding: 13, background: parsed.length ? '#297b8a' : 'var(--mc-border)', color: '#fff', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: parsed.length ? 'pointer' : 'not-allowed' }}>
            Добавить {parsed.length || ''} {parsed.length ? (parsed.length === 1 ? 'строку' : parsed.length < 5 ? 'строки' : 'строк') : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Мелкие компоненты ── */
function StatBox({ label, value, color }) {
  return (
    <div style={{
      background: color + '11', borderRadius: 10, padding: '8px 10px',
      border: `1px solid ${color}22`,
    }}>
      <div style={{ fontSize: 11, color: 'var(--mc-muted)' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function Th({ children }) {
  return (
    <th style={{
      padding: '8px 6px', textAlign: 'left', fontSize: 11,
      fontWeight: 600, color: 'var(--mc-muted)', borderBottom: '2px solid var(--mc-border)',
      whiteSpace: 'nowrap',
    }}>{children}</th>
  );
}

function Td({ children, style = {} }) {
  return (
    <td style={{
      padding: '7px 6px', fontSize: 12, color: 'var(--mc-text)',
      verticalAlign: 'middle', ...style,
    }}>{children}</td>
  );
}

/* ── Стили ── */
const backBtnStyle = {
  display: 'flex', alignItems: 'center', gap: 4, fontSize: 12,
  color: 'var(--mc-muted)', background: 'none', border: 'none',
  cursor: 'pointer', marginBottom: 12, padding: 0,
};

const noAccessStyle = {
  background: 'var(--mc-surface)', border: '1px solid var(--mc-border)',
  borderRadius: 14, padding: 24, textAlign: 'center', color: 'var(--mc-muted)',
};

const navBtnStyle = {
  background: 'none', border: '1px solid var(--mc-border)',
  borderRadius: 8, padding: '4px 8px', cursor: 'pointer', color: 'var(--mc-text)',
};

const cardStyle = {
  background: 'var(--mc-surface)', border: '1px solid var(--mc-border)',
  borderRadius: 14, padding: 14, marginBottom: 12,
};

const searchInputStyle = {
  width: '100%', padding: '8px 8px 8px 30px', fontSize: 13,
  border: '1px solid var(--mc-border)', borderRadius: 10,
  background: 'var(--mc-surface)', outline: 'none',
};
