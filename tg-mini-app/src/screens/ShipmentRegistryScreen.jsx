/**
 * ShipmentRegistryScreen.jsx — «Реестр отгрузок»
 * Менеджер вносит A-F (paste из 1С), ставит G (накладная вернулась).
 * Кассир ставит I (оплачено). Все с доступом видят статистику.
 */
import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Plus, ClipboardPaste, Trash2, Check, X, Banknote } from 'lucide-react';
import { supabase } from '../supabase/client';

/* ── Права ─────────────────────────────────────────────────── */
const CAN_EDIT_ROLES = ['admin', 'senior_manager', 'director', 'b2b']; // A-G
const CAN_PAY_ROLES  = ['admin', 'cashier'];                            // I
const CAN_VIEW_ROLES = ['admin', 'senior_manager', 'director', 'b2b', 'cashier', 'observer'];

const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

/* ── Хелперы ───────────────────────────────────────────────── */
const fmtMoney = n => (Number(n) || 0).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtM     = n => (Number(n) / 1_000_000).toFixed(2);

function monthLabel(key) {
  const [y, m] = key.split('-');
  return `${MONTH_NAMES[+m - 1]} ${y}`;
}
function monthShort(key) {
  const [, m] = key.split('-');
  return MONTH_NAMES[+m - 1].slice(0, 3);
}
function currentMonthKey() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}
function todayStr() {
  const n = new Date();
  return `${String(n.getDate()).padStart(2, '0')}.${String(n.getMonth() + 1).padStart(2, '0')}.${n.getFullYear()}`;
}

function parseAmount(s) {
  if (s === null || s === undefined) return 0;
  const cleaned = String(s).replace(/[\s ]/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

// Похоже ли строка на реальный заказ (а не на продолжение комментария).
// Реальный номер из 1С всегда содержит «ЦТ» (00ЦТ-017353).
// Запасной вариант — длинный номер из цифр, но только если в строке много колонок.
function looksLikeOrderRow(docNo, colCount) {
  if (!docNo) return false;
  const t = docNo.trim();
  if (/ЦТ/i.test(t)) return true;
  return /^\d{4,}/.test(t) && colCount >= 4;
}

// Полноценный разбор TSV из 1С с учётом кавычек.
// 1С оборачивает многострочные ячейки (напр. длинный комментарий) в "...",
// внутри которых могут быть переносы строк и табы — их НЕ нужно считать новой строкой.
// Порядок колонок из 1С: Номер · Дата · Партнёр · Сумма · Организация · Комментарий
function parsePaste(text) {
  const rawRows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }  // "" → экранированная кавычка
        else inQuotes = false;
      } else {
        field += ch;  // перенос/таб внутри кавычек — часть значения
      }
    } else {
      if (ch === '"' && field === '') inQuotes = true;
      else if (ch === '\t') { row.push(field); field = ''; }
      else if (ch === '\r') { /* пропускаем */ }
      else if (ch === '\n') { row.push(field); rawRows.push(row); row = []; field = ''; }
      else                  field += ch;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rawRows.push(row); }

  // Маппинг + защита: строки без номера-документа считаем продолжением комментария предыдущей
  const result = [];
  for (const c of rawRows) {
    if (!c.some(x => (x || '').trim() !== '')) continue;  // пустая строка
    const obj = {
      doc_no:       (c[0] || '').trim(),
      doc_date:     (c[1] || '').trim(),
      partner:      (c[2] || '').trim(),
      amount:       parseAmount(c[3] || ''),
      organization: (c[4] || '').trim(),
      comment:      (c[5] || '').trim(),
    };
    const isOrder = looksLikeOrderRow(obj.doc_no, c.length);
    if (!isOrder && result.length > 0) {
      // непрокавыченное продолжение — приклеиваем к комментарию предыдущего заказа
      const tail = c.map(x => (x || '').trim()).filter(Boolean).join(' ');
      if (tail) {
        const prev = result[result.length - 1];
        prev.comment = (prev.comment ? prev.comment + '\n' : '') + tail;
      }
    } else {
      result.push(obj);
    }
  }
  return result;
}

const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID)
  ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
      const r = Math.random() * 16 | 0;
      return (ch === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });

/* ─────────────────────────────────────────────────────────────
   ГЛАВНЫЙ ЭКРАН
───────────────────────────────────────────────────────────── */
export function ShipmentRegistryScreen({ ctx }) {
  const { db, currentUser, goBack, setDb, showToast, can } = ctx;

  const canEdit = can ? can('shipment_edit') : CAN_EDIT_ROLES.includes(currentUser?.role);
  const canPay  = can ? can('shipment_pay')  : CAN_PAY_ROLES.includes(currentUser?.role);
  const canView = can ? can('shipment_view') : CAN_VIEW_ROLES.includes(currentUser?.role);

  const rows = db.shipmentRegistry || [];

  // Месяцы: те что есть в данных + текущий
  const months = useMemo(() => {
    const set = new Set(rows.map(r => r.month));
    set.add(currentMonthKey());
    return [...set].sort().reverse();
  }, [rows]);

  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey());
  const [pasteOpen, setPasteOpen]         = useState(false);
  const [search, setSearch]               = useState('');
  const [fInvoice, setFInvoice]           = useState('all'); // all | yes | no — накладная вернулась
  const [fPaid, setFPaid]                 = useState('all'); // all | yes | no | partial — оплата
  const [payModal, setPayModal]           = useState(null);  // { id, amount } — модал оплаты

  if (!canView) {
    return (
      <div>
        <button onClick={goBack} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--mc-muted)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 12, padding: 0 }}>
          <ChevronLeft size={15} /> Назад
        </button>
        <div style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 14, padding: 24, textAlign: 'center', color: 'var(--mc-muted)' }}>
          Нет доступа к реестру отгрузок
        </div>
      </div>
    );
  }

  const monthRows = rows
    .filter(r => r.month === selectedMonth)
    .filter(r => fInvoice === 'all' || (fInvoice === 'yes' ? !!r.invoice_returned : !r.invoice_returned))
    .filter(r => {
      if (fPaid === 'all') return true;
      if (fPaid === 'yes') return r.paid && (r.paid_amount == null || r.paid_amount >= (Number(r.amount) || 0));
      if (fPaid === 'partial') return r.paid && r.paid_amount != null && r.paid_amount < (Number(r.amount) || 0);
      return !r.paid;
    })
    .filter(r => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (r.doc_no || '').toLowerCase().includes(q)
        || (r.partner || '').toLowerCase().includes(q)
        || (r.organization || '').toLowerCase().includes(q)
        || (r.comment || '').toLowerCase().includes(q);
    })
    .sort((a, b) => (a.seq || 0) - (b.seq || 0));

  // Статистика
  const stats = useMemo(() => {
    const all = rows.filter(r => r.month === selectedMonth);
    const paid    = all.filter(r => r.paid);
    const unpaid  = all.filter(r => !r.paid);
    const retd    = all.filter(r => r.invoice_returned);
    return {
      total: all.length,
      totalSum: all.reduce((s, r) => s + (Number(r.amount) || 0), 0),
      paidCount: paid.length,
      paidSum:   paid.reduce((s, r) => s + (Number(r.amount) || 0), 0),
      unpaidCount: unpaid.length,
      unpaidSum:   unpaid.reduce((s, r) => s + (Number(r.amount) || 0), 0),
      returnedCount: retd.length,
    };
  }, [rows, selectedMonth]);

  /* ── Операции ── */
  const addRows = async (parsed) => {
    const maxSeq = Math.max(0, ...rows.filter(r => r.month === selectedMonth).map(r => r.seq || 0));
    const newRows = parsed.map((p, i) => ({
      id: uid(),
      month: selectedMonth,
      doc_no: p.doc_no, doc_date: p.doc_date, amount: p.amount,
      partner: p.partner, organization: p.organization, comment: p.comment,
      invoice_returned: false, delivery_date: null, paid: false, paid_amount: null,
      seq: maxSeq + i + 1,
      created_by: currentUser.id, created_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from('shipment_registry').insert(newRows);
    if (error) { showToast('Ошибка: ' + error.message); return; }
    setDb(d => ({ ...d, shipmentRegistry: [...newRows, ...(d.shipmentRegistry || [])] }));
    showToast(`Добавлено ${newRows.length} ${newRows.length === 1 ? 'строка' : 'строк'}`);
  };

  const updateField = async (id, field, value) => {
    const patch = { [field]: value };
    // Авто-проставление даты доставки при отметке "накладная вернулась"
    if (field === 'invoice_returned') {
      patch.delivery_date = value ? todayStr() : null;
      patch.invoice_marked_by = value ? currentUser.id : null;
      patch.invoice_marked_at = value ? new Date().toISOString() : null;
    }
    if (field === 'paid') {
      patch.paid_by = value ? currentUser.id : null;
      patch.paid_at = value ? new Date().toISOString() : null;
      if (!value) patch.paid_amount = null;
    }
    const { error } = await supabase.from('shipment_registry').update(patch).eq('id', id);
    if (error) { showToast('Ошибка: ' + error.message); return; }
    setDb(d => ({ ...d, shipmentRegistry: (d.shipmentRegistry || []).map(r => r.id === id ? { ...r, ...patch } : r) }));
  };

  const markPaid = async (id, paidAmount) => {
    const patch = {
      paid: true,
      paid_amount: paidAmount,
      paid_by: currentUser.id,
      paid_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('shipment_registry').update(patch).eq('id', id);
    if (error) { showToast('Ошибка: ' + error.message); return; }
    setDb(d => ({ ...d, shipmentRegistry: (d.shipmentRegistry || []).map(r => r.id === id ? { ...r, ...patch } : r) }));
    showToast('Оплата подтверждена');
  };

  const deleteRow = async (id) => {
    const { error } = await supabase.from('shipment_registry').delete().eq('id', id);
    if (error) { showToast('Ошибка: ' + error.message); return; }
    setDb(d => ({ ...d, shipmentRegistry: (d.shipmentRegistry || []).filter(r => r.id !== id) }));
  };

  return (
    <div>
      {/* Шапка */}
      <div style={{ marginBottom: 16 }}>
        <button onClick={goBack} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--mc-muted)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 8, padding: 0 }}>
          <ChevronLeft size={15} /> Назад
        </button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--mc-text)', margin: 0 }}>📦 Реестр отгрузок</h1>
            <div style={{ fontSize: 11, color: 'var(--mc-muted)', marginTop: 2 }}>
              {canPay && !canEdit ? 'Отметьте оплату по заказам' : canEdit ? 'Вносите накладные, отмечайте возврат и оплату' : 'Просмотр'}
            </div>
          </div>
          {canEdit && (
            <button onClick={() => setPasteOpen(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: '#297b8a', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
              <ClipboardPaste size={14} /> Вставить
            </button>
          )}
        </div>
      </div>

      {/* Месяцы */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 14 }}>
        {months.map(mk => {
          const active = mk === selectedMonth;
          return (
            <button key={mk} onClick={() => setSelectedMonth(mk)}
              style={{ flexShrink: 0, padding: '5px 12px', borderRadius: 9, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                border: `1.5px solid ${active ? '#297b8a' : 'var(--mc-border)'}`,
                background: active ? '#297b8a' : 'var(--mc-surface)',
                color: active ? '#fff' : 'var(--mc-muted)' }}>
              {monthShort(mk)} {mk.split('-')[0]}
            </button>
          );
        })}
      </div>

      {/* Статистика */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 14 }}>
        <StatTile label="💰 Оплачено" count={stats.paidCount} sum={stats.paidSum} color="#16a34a" total={stats.total} />
        <StatTile label="⏳ Не оплачено" count={stats.unpaidCount} sum={stats.unpaidSum} color="#dc2626" total={stats.total} />
        <StatTile label="📦 Всего" count={stats.total} sum={stats.totalSum} color="#297b8a" />
        <StatTile label="📋 Накладные вернулись" count={stats.returnedCount} color="#8b5cf6" total={stats.total} noSum />
      </div>

      {/* Фильтры */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 10 }}>
        <FilterGroup label="📋 Накладная" value={fInvoice} onChange={setFInvoice} />
        <PaidFilterGroup value={fPaid} onChange={setFPaid} />
      </div>

      {/* Поиск */}
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Поиск: номер, партнёр, организация..."
          style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--mc-border)', borderRadius: 10, fontSize: 13, outline: 'none', background: 'var(--mc-surface)', color: 'var(--mc-text)', boxSizing: 'border-box' }} />
      </div>

      {/* Таблица */}
      {monthRows.length === 0 ? (
        <div style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 14, padding: '40px 20px', textAlign: 'center', color: 'var(--mc-muted)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📦</div>
          <div style={{ fontSize: 13 }}>Нет записей за {monthLabel(selectedMonth)}</div>
          {canEdit && <div style={{ fontSize: 11, marginTop: 4 }}>Нажмите «Вставить» чтобы добавить из 1С</div>}
        </div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: 14, border: '1px solid var(--mc-border)', background: 'var(--mc-surface)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={th('center')}>#</th>
                <th style={th('left')}>Номер</th>
                <th style={th('left')}>Дата</th>
                <th style={th('left')}>Партнёр</th>
                <th style={th('right')}>Сумма</th>
                <th style={th('left')}>Организация</th>
                <th style={th('left')}>Комментарий</th>
                <th style={{ ...th('center'), background: '#5b21b6' }}>Накл.&nbsp;✓</th>
                <th style={th('left')}>Доставка</th>
                <th style={{ ...th('center'), background: '#166534' }}>Оплата&nbsp;✓</th>
                {canEdit && <th style={th('center')}></th>}
              </tr>
            </thead>
            <tbody>
              {monthRows.map((r, i) => (
                <tr key={r.id} style={{ background: r.paid ? 'rgba(22,163,74,.06)' : 'transparent' }}>
                  <td style={td('center', 'var(--mc-muted)')}>{i + 1}</td>
                  <EditCell value={r.doc_no} mono readOnly={!canEdit} onSave={v => updateField(r.id, 'doc_no', v)} />
                  <EditCell value={r.doc_date} readOnly={!canEdit} onSave={v => updateField(r.id, 'doc_date', v)} width={80} />
                  <EditCell value={r.partner} readOnly={!canEdit} onSave={v => updateField(r.id, 'partner', v)} width={150} />
                  <EditCell value={r.amount} isAmount readOnly={!canEdit} onSave={v => updateField(r.id, 'amount', parseAmount(v))} align="right" />
                  <EditCell value={r.organization} readOnly={!canEdit} onSave={v => updateField(r.id, 'organization', v)} width={150} />
                  <EditCell value={r.comment} readOnly={!canEdit} onSave={v => updateField(r.id, 'comment', v)} width={160} muted />
                  {/* G: накладная вернулась */}
                  <td style={td('center')}>
                    <Toggle checked={!!r.invoice_returned} disabled={!canEdit} color="#8b5cf6"
                      onChange={v => updateField(r.id, 'invoice_returned', v)} />
                  </td>
                  <td style={td('left', 'var(--mc-muted)')}>{r.delivery_date || '—'}</td>
                  {/* I: оплачено (кассир) */}
                  <td style={td('center')}>
                    {r.paid ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        <Toggle checked color="#16a34a" disabled={!canPay}
                          onChange={() => updateField(r.id, 'paid', false)} />
                        {r.paid_amount != null && (
                          <span style={{ fontSize: 9, color: r.paid_amount < (Number(r.amount) || 0) ? '#dc2626' : '#16a34a', fontWeight: 700, whiteSpace: 'nowrap' }}>
                            {fmtMoney(r.paid_amount)} ₸
                          </span>
                        )}
                      </div>
                    ) : canPay ? (
                      <button onClick={() => setPayModal({ id: r.id, amount: Number(r.amount) || 0 })}
                        style={{ padding: '4px 10px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 7, fontSize: 10, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 3 }}>
                        <Banknote size={12} /> Оплата
                      </button>
                    ) : (
                      <Toggle checked={false} disabled color="#16a34a" onChange={() => {}} />
                    )}
                  </td>
                  {canEdit && (
                    <td style={td('center')}>
                      <button onClick={() => { if (confirm(`Удалить ${r.doc_no || 'запись'}?`)) deleteRow(r.id); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', padding: 4 }}>
                        <Trash2 size={13} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Модал вставки */}
      {pasteOpen && (
        <PasteModal
          onClose={() => setPasteOpen(false)}
          onConfirm={async (parsed) => { await addRows(parsed); setPasteOpen(false); }}
        />
      )}

      {/* Модал оплаты */}
      {payModal && (
        <PaymentModal
          amount={payModal.amount}
          onClose={() => setPayModal(null)}
          onConfirm={async (paidAmount) => {
            await markPaid(payModal.id, paidAmount);
            setPayModal(null);
          }}
        />
      )}
    </div>
  );
}

/* ── Группа фильтра (все / да / нет) ───────────────────────── */
function PaidFilterGroup({ value, onChange }) {
  const opts = [['all', 'Все'], ['yes', '100%'], ['partial', '< 100%'], ['no', 'Нет']];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 11, color: 'var(--mc-muted)', fontWeight: 600 }}>💰 Оплата:</span>
      <div style={{ display: 'flex', gap: 2, background: 'var(--mc-active-item)', borderRadius: 8, padding: 2 }}>
        {opts.map(([v, l]) => (
          <button key={v} onClick={() => onChange(v)}
            style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: 'none',
              background: value === v ? '#297b8a' : 'transparent',
              color: value === v ? '#fff' : 'var(--mc-muted)' }}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

function FilterGroup({ label, value, onChange }) {
  const opts = [['all', 'Все'], ['yes', 'Да'], ['no', 'Нет']];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 11, color: 'var(--mc-muted)', fontWeight: 600 }}>{label}:</span>
      <div style={{ display: 'flex', gap: 2, background: 'var(--mc-active-item)', borderRadius: 8, padding: 2 }}>
        {opts.map(([v, l]) => (
          <button key={v} onClick={() => onChange(v)}
            style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: 'none',
              background: value === v ? '#297b8a' : 'transparent',
              color: value === v ? '#fff' : 'var(--mc-muted)' }}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Модал подтверждения оплаты ────────────────────────────── */
function PaymentModal({ amount, onClose, onConfirm }) {
  const [isFull, setIsFull] = useState(true);
  const [partial, setPartial] = useState('');

  const paidAmount = isFull ? amount : (parseFloat(partial) || 0);
  const valid = isFull ? amount > 0 : paidAmount > 0;

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--mc-surface)', borderRadius: 18, width: '100%', maxWidth: 360, padding: '20px 20px 24px' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--mc-text)' }}>💰 Подтверждение оплаты</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mc-muted)' }}><X size={20} /></button>
        </div>

        <div style={{ fontSize: 12, color: 'var(--mc-muted)', marginBottom: 14 }}>
          Сумма по накладной: <strong style={{ color: 'var(--mc-text)' }}>{fmtMoney(amount)} ₸</strong>
        </div>

        {/* Полная оплата */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10,
          border: `2px solid ${isFull ? '#16a34a' : 'var(--mc-border)'}`, background: isFull ? 'rgba(22,163,74,.06)' : 'transparent',
          cursor: 'pointer', marginBottom: 8 }}>
          <input type="radio" checked={isFull} onChange={() => setIsFull(true)}
            style={{ accentColor: '#16a34a', width: 16, height: 16 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--mc-text)' }}>Полная оплата</div>
            <div style={{ fontSize: 11, color: 'var(--mc-muted)' }}>{fmtMoney(amount)} ₸</div>
          </div>
        </label>

        {/* Частичная оплата */}
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 10,
          border: `2px solid ${!isFull ? '#f59e0b' : 'var(--mc-border)'}`, background: !isFull ? 'rgba(245,158,11,.06)' : 'transparent',
          cursor: 'pointer', marginBottom: 16 }}>
          <input type="radio" checked={!isFull} onChange={() => setIsFull(false)}
            style={{ accentColor: '#f59e0b', width: 16, height: 16, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--mc-text)', marginBottom: 6 }}>Частичная оплата</div>
            {!isFull && (
              <input type="number" autoFocus value={partial} onChange={e => setPartial(e.target.value)}
                placeholder="Сумма оплаты"
                style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--mc-border)', borderRadius: 8,
                  fontSize: 14, fontWeight: 700, outline: 'none', background: 'var(--mc-surface)', color: 'var(--mc-text)', boxSizing: 'border-box' }} />
            )}
          </div>
        </label>

        <button onClick={() => valid && onConfirm(paidAmount)} disabled={!valid}
          style={{ width: '100%', padding: 13, background: valid ? '#16a34a' : 'var(--mc-border)', color: '#fff',
            border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: valid ? 'pointer' : 'not-allowed' }}>
          ✅ Подтвердить {valid ? `(${fmtMoney(paidAmount)} ₸)` : ''}
        </button>
      </div>
    </div>
  );
}

/* ── Статистика-плитка ─────────────────────────────────────── */
function StatTile({ label, count, sum, color, total, noSum }) {
  return (
    <div style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 14, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .4, marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1 }}>{count}</span>
        {total > 0 && <span style={{ fontSize: 11, color: 'var(--mc-muted)' }}>из {total}</span>}
      </div>
      {!noSum && (
        <div style={{ fontSize: 12, color: 'var(--mc-text)', fontWeight: 600, marginTop: 4 }}>
          {fmtMoney(sum)} ₸
        </div>
      )}
    </div>
  );
}

/* ── Чекбокс-тоггл ─────────────────────────────────────────── */
function Toggle({ checked, disabled, color, onChange }) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      style={{
        width: 26, height: 26, borderRadius: 7, cursor: disabled ? 'default' : 'pointer',
        border: `2px solid ${checked ? color : 'var(--mc-border)'}`,
        background: checked ? color : 'var(--mc-surface)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        opacity: disabled && !checked ? 0.4 : 1, transition: 'all .15s',
      }}>
      {checked && <Check size={14} color="#fff" strokeWidth={3} />}
    </button>
  );
}

/* ── Редактируемая ячейка (click-to-edit) ──────────────────── */
function EditCell({ value, onSave, readOnly, isAmount, mono, muted, align = 'left', width }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const display = isAmount
    ? (value ? fmtMoney(value) : '—')
    : (value || '—');

  if (readOnly || !onSave) {
    return <td style={{ ...td(align, muted ? 'var(--mc-muted)' : 'var(--mc-text)'), fontFamily: mono ? 'monospace' : 'inherit', maxWidth: width, whiteSpace: width ? 'pre-wrap' : 'nowrap' }}>{display}</td>;
  }

  if (editing) {
    return (
      <td style={{ padding: '4px 6px', borderBottom: '1px solid var(--mc-border-light)' }}>
        <input
          type={isAmount ? 'number' : 'text'}
          value={draft}
          autoFocus
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { setEditing(false); onSave(draft); }}
          onKeyDown={e => { if (e.key === 'Enter') { setEditing(false); onSave(draft); } if (e.key === 'Escape') setEditing(false); }}
          style={{ width: width || 90, padding: '4px 6px', border: '2px solid #297b8a', borderRadius: 6, fontSize: 12, outline: 'none', background: 'var(--mc-surface)', color: 'var(--mc-text)', textAlign: align, boxSizing: 'border-box' }}
        />
      </td>
    );
  }

  return (
    <td
      onClick={() => { setDraft(isAmount ? String(value || '') : (value || '')); setEditing(true); }}
      style={{ ...td(align, muted ? 'var(--mc-muted)' : 'var(--mc-text)'), cursor: 'text', fontFamily: mono ? 'monospace' : 'inherit', maxWidth: width, whiteSpace: width ? 'pre-wrap' : 'nowrap' }}
      title="Кликни чтобы изменить">
      {display}
    </td>
  );
}

/* ── Модал вставки из буфера ───────────────────────────────── */
function PasteModal({ onClose, onConfirm }) {
  const [text, setText] = useState('');
  const parsed = text.trim() ? parsePaste(text) : [];

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ background: 'var(--mc-surface)', width: '100%', borderRadius: '20px 20px 0 0', maxHeight: 'min(85vh, 85dvh)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px', borderBottom: '1px solid var(--mc-border-light)', flexShrink: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--mc-text)' }}>Вставить из 1С / Excel</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mc-muted)' }}><X size={20} /></button>
        </div>
        <div style={{ padding: '12px 16px', overflowY: 'auto', flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--mc-muted)', marginBottom: 8, lineHeight: 1.5 }}>
            Скопируйте строки из 1С (колонки <strong>Номер · Дата · Партнёр · Сумма · Организация · Комментарий</strong>) и вставьте сюда. Каждая строка — отдельный заказ.
          </div>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            autoFocus
            placeholder={'00ЦТ-017353\t01.05.2026\tИП Турехан\t97 430,00\tТОО MASTER COFFEE FOOD\tкомментарий'}
            rows={8}
            style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--mc-border)', borderRadius: 10, fontSize: 12, fontFamily: 'monospace', resize: 'vertical', outline: 'none', background: 'var(--mc-active-item)', color: 'var(--mc-text)', boxSizing: 'border-box' }}
          />
          {parsed.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mc-muted)', marginBottom: 6 }}>
                Распознано строк: {parsed.length}
              </div>
              <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--mc-border)', borderRadius: 10 }}>
                {parsed.slice(0, 20).map((p, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, padding: '6px 10px', borderBottom: '1px solid var(--mc-border-light)', fontSize: 11 }}>
                    <span style={{ fontFamily: 'monospace', color: '#297b8a', flexShrink: 0 }}>{p.doc_no || '—'}</span>
                    <span style={{ color: 'var(--mc-text)', fontWeight: 600, flexShrink: 0 }}>{fmtMoney(p.amount)} ₸</span>
                    <span style={{ color: 'var(--mc-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.partner}</span>
                  </div>
                ))}
                {parsed.length > 20 && <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--mc-muted)' }}>…и ещё {parsed.length - 20}</div>}
              </div>
            </div>
          )}
        </div>
        <div style={{ padding: '10px 16px 28px', borderTop: '1px solid var(--mc-border-light)', flexShrink: 0 }}>
          <button onClick={() => onConfirm(parsed)} disabled={parsed.length === 0}
            style={{ width: '100%', padding: 13, background: parsed.length ? '#297b8a' : 'var(--mc-border)', color: '#fff', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: parsed.length ? 'pointer' : 'not-allowed' }}>
            ➕ Добавить {parsed.length || ''} {parsed.length ? (parsed.length === 1 ? 'строку' : 'строк') : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   ТАЙЛ НА ГЛАВНОЙ (кассир / менеджер)
───────────────────────────────────────────────────────────── */
export function ShipmentRegistryHomeTile({ ctx }) {
  const { db, currentUser, navigate, can } = ctx;
  const canView = can ? can('shipment_view')
    : (CAN_EDIT_ROLES.includes(currentUser?.role) || CAN_PAY_ROLES.includes(currentUser?.role) || CAN_VIEW_ROLES.includes(currentUser?.role));
  if (!canView) return null;

  const mk = currentMonthKey();
  const all = (db.shipmentRegistry || []).filter(r => r.month === mk);
  if (all.length === 0) return null;

  const paid = all.filter(r => r.paid);
  const unpaid = all.filter(r => !r.paid);
  const paidSum = paid.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const unpaidSum = unpaid.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const pct = all.length ? paid.length / all.length : 0;

  return (
    <div onClick={() => navigate({ name: 'shipment_registry' })}
      style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 14, padding: '14px 16px', cursor: 'pointer', marginBottom: 12 }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--mc-active-item)'}
      onMouseLeave={e => e.currentTarget.style.background = 'var(--mc-surface)'}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--mc-text)' }}>📦 Реестр отгрузок — {monthLabel(mk)}</div>
        <ChevronRight size={14} style={{ color: 'var(--mc-muted)' }} />
      </div>
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .4, marginBottom: 2 }}>💰 Оплачено</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#16a34a' }}>{paid.length}</div>
          <div style={{ fontSize: 10, color: 'var(--mc-muted)' }}>{fmtMoney(paidSum)} ₸</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .4, marginBottom: 2 }}>⏳ Не оплачено</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#dc2626' }}>{unpaid.length}</div>
          <div style={{ fontSize: 10, color: 'var(--mc-muted)' }}>{fmtMoney(unpaidSum)} ₸</div>
        </div>
      </div>
      <div style={{ height: 5, background: 'var(--mc-active-item)', borderRadius: 3, overflow: 'hidden', marginTop: 10 }}>
        <div style={{ height: '100%', width: (pct * 100) + '%', background: '#16a34a', borderRadius: 3 }} />
      </div>
    </div>
  );
}

/* ── CSS helpers ───────────────────────────────────────────── */
const th = (align = 'left') => ({
  background: '#1e293b', color: '#e2e8f0', padding: '9px 10px',
  textAlign: align, fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap',
});
const td = (align = 'left', color = 'var(--mc-text)') => ({
  padding: '7px 10px', textAlign: align, color,
  borderBottom: '1px solid var(--mc-border-light)', verticalAlign: 'middle',
});
