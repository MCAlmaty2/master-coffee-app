/**
 * DailyRevenueScreen.jsx — Ежедневная выручка
 * Менеджер вводит выручку за каждый день. Месячная сумма автоматически
 * становится фактом «Выручка» в отчёте ОП (Выполнение плана).
 * Доступ: report_edit (admin / senior_manager / director).
 */
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { ChevronLeft } from 'lucide-react';
import { supabase } from '../supabase/client';

const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const DOW = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];

const fmtN = n => (Number(n) || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
function currentMonthKey() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(key) { const [y, m] = key.split('-'); return `${MONTH_NAMES[+m - 1]} ${y}`; }
function monthShort(key) { const [, m] = key.split('-'); return MONTH_NAMES[+m - 1].slice(0, 3); }
function daysInMonth(key) {
  const [y, m] = key.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return Array.from({ length: last }, (_, i) => `${key}-${String(i + 1).padStart(2, '0')}`);
}
function dowOf(dateStr) {
  const d = new Date(dateStr + 'T00:00');
  return DOW[d.getDay()];
}

// Хелпер: сумма дневной выручки за месяц (используется в отчёте ОП)
export function dailyRevenueSum(db, monthKey) {
  return (db.dailyRevenue || [])
    .filter(r => r.month === monthKey)
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);
}
export function hasDailyRevenue(db, monthKey) {
  return (db.dailyRevenue || []).some(r => r.month === monthKey && Number(r.amount) > 0);
}

/* ── Редактируемая ячейка ──────────────────────────────────── */
function Cell({ value, onSave, readOnly, align = 'right' }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const display = value ? fmtN(value) : '—';

  if (readOnly) return <td style={tdS(align, value ? 'var(--mc-text)' : 'var(--mc-muted)')}>{display}</td>;

  if (editing) {
    return (
      <td style={{ padding: '3px 4px', borderBottom: '1px solid var(--mc-border-light)' }}>
        <input type="number" inputMode="numeric" value={draft} autoFocus
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { setEditing(false); onSave(draft); }}
          onKeyDown={e => { if (e.key === 'Enter') { setEditing(false); onSave(draft); } if (e.key === 'Escape') setEditing(false); }}
          style={{ width: '100%', padding: '4px 6px', border: '2px solid #297b8a', borderRadius: 6, fontSize: 12, textAlign: align, outline: 'none', background: 'var(--mc-surface)', color: 'var(--mc-text)', boxSizing: 'border-box' }} />
      </td>
    );
  }
  return (
    <td onClick={() => { setDraft(value ? String(value) : ''); setEditing(true); }}
      style={{ ...tdS(align, value ? 'var(--mc-text)' : 'var(--mc-muted)'), cursor: 'text' }} title="Кликни чтобы ввести">
      {display}
    </td>
  );
}

/* ── Экран ─────────────────────────────────────────────────── */
export function DailyRevenueScreen({ ctx }) {
  const { db, currentUser, goBack, setDb, showToast, can, syncSnapshotRef } = ctx;
  const canEdit = can ? can('report_edit') : ['admin', 'senior_manager', 'director'].includes(currentUser?.role);

  const rows = db.dailyRevenue || [];
  const months = useMemo(() => {
    const set = new Set(rows.map(r => r.month));
    set.add(currentMonthKey());
    return [...set].sort().reverse();
  }, [rows]);

  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey());

  const byDate = useMemo(() => {
    const m = {};
    rows.forEach(r => { m[r.date] = r; });
    return m;
  }, [rows]);

  const days = daysInMonth(selectedMonth);

  const totals = useMemo(() => {
    const monthRows = rows.filter(r => r.month === selectedMonth);
    const amount = monthRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const sales  = monthRows.reduce((s, r) => s + (Number(r.sales_count) || 0), 0);
    const deliv  = monthRows.reduce((s, r) => s + (Number(r.delivery_count) || 0), 0);
    const pickup = monthRows.reduce((s, r) => s + (Number(r.pickup_count) || 0), 0);
    return { amount, sales, deliv, pickup, avg: sales ? amount / sales : 0 };
  }, [rows, selectedMonth]);

  // byDateRef держит самое свежее состояние синхронно (не дожидаясь ре-рендера),
  // чтобы два быстрых сохранения подряд (разные поля одного дня) не читали устаревший
  // снимок byDate из замыкания и не затирали друг друга.
  const byDateRef = useRef(byDate);
  useEffect(() => { byDateRef.current = byDate; }, [byDate]);

  const saveCell = useCallback(async (dateStr, field, rawVal) => {
    if (!canEdit) return;
    const val = parseFloat(rawVal) || 0;
    const existing = byDateRef.current[dateStr];
    const row = {
      date: dateStr,
      month: dateStr.slice(0, 7),
      amount:         existing?.amount || 0,
      sales_count:    existing?.sales_count || 0,
      delivery_count: existing?.delivery_count || 0,
      pickup_count:   existing?.pickup_count || 0,
      [field]: val,
      updated_by: currentUser.id,
      updated_at: new Date().toISOString(),
      org_id: ctx.currentOrgId,
    };
    const { error } = await supabase.from('daily_revenue').upsert(row, { onConflict: 'date' });
    if (error) { showToast('Ошибка: ' + error.message); return; }
    byDateRef.current = { ...byDateRef.current, [dateStr]: row };
    setDb(d => {
      const updated = [...(d.dailyRevenue || []).filter(r => r.date !== dateStr), row];
      if (syncSnapshotRef) syncSnapshotRef.current.dailyRevenue = updated;
      return { ...d, dailyRevenue: updated };
    });
  }, [canEdit, currentUser, setDb, showToast]);

  return (
    <div>
      {/* Шапка */}
      <div style={{ marginBottom: 16 }}>
        <button onClick={goBack} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--mc-muted)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 8, padding: 0 }}>
          <ChevronLeft size={15} /> Назад
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--mc-text)', margin: 0 }}>💵 Ежедневная выручка</h1>
        <div style={{ fontSize: 11, color: 'var(--mc-muted)', marginTop: 2 }}>
          Месячная сумма автоматически идёт в факт «Выручка» отчёта ОП
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

      {/* Итоги месяца */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 14 }}>
        <div style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 14, padding: '14px 16px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .4, marginBottom: 6 }}>💰 Выручка за {monthShort(selectedMonth)}</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#16a34a', lineHeight: 1 }}>{fmtN(totals.amount)} ₸</div>
          <div style={{ fontSize: 11, color: 'var(--mc-muted)', marginTop: 4 }}>средний чек {fmtN(totals.avg)} ₸</div>
        </div>
        <div style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 14, padding: '14px 16px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .4, marginBottom: 6 }}>📦 Продажи</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--mc-text)', lineHeight: 1 }}>{fmtN(totals.sales)}</div>
          <div style={{ fontSize: 11, color: 'var(--mc-muted)', marginTop: 4 }}>🚚 {fmtN(totals.deliv)} рейс · 🏪 {fmtN(totals.pickup)} самовывоз</div>
        </div>
      </div>

      {/* Таблица по дням */}
      <div style={{ overflowX: 'auto', borderRadius: 14, border: '1px solid var(--mc-border)', background: 'var(--mc-surface)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={thS('left')}>День</th>
              <th style={thS('right')}>Сумма</th>
              <th style={thS('right')}>Ср. чек</th>
              <th style={thS('right')}>Продаж</th>
              <th style={thS('right')}>Рейс</th>
              <th style={thS('right')}>Самовывоз</th>
            </tr>
          </thead>
          <tbody>
            {days.map(dateStr => {
              const r = byDate[dateStr] || {};
              const dayNum = +dateStr.slice(-2);
              const dow = dowOf(dateStr);
              const isWeekend = dow === 'Сб' || dow === 'Вс';
              const avg = r.sales_count ? (Number(r.amount) || 0) / r.sales_count : 0;
              return (
                <tr key={dateStr} style={{ background: isWeekend ? 'var(--mc-active-item)' : 'transparent' }}>
                  <td style={{ ...tdS('left', 'var(--mc-text)'), fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {dayNum} <span style={{ color: isWeekend ? '#dc2626' : 'var(--mc-muted)', fontSize: 10 }}>{dow}</span>
                  </td>
                  <Cell value={r.amount} readOnly={!canEdit} onSave={v => saveCell(dateStr, 'amount', v)} />
                  <td style={tdS('right', 'var(--mc-muted)')}>{avg ? fmtN(avg) : '—'}</td>
                  <Cell value={r.sales_count} readOnly={!canEdit} onSave={v => saveCell(dateStr, 'sales_count', v)} />
                  <Cell value={r.delivery_count} readOnly={!canEdit} onSave={v => saveCell(dateStr, 'delivery_count', v)} />
                  <Cell value={r.pickup_count} readOnly={!canEdit} onSave={v => saveCell(dateStr, 'pickup_count', v)} />
                </tr>
              );
            })}
            {/* Итого */}
            <tr style={{ background: 'var(--mc-active-item)', fontWeight: 700 }}>
              <td style={{ ...tdS('left', 'var(--mc-text)'), fontWeight: 800 }}>ИТОГО</td>
              <td style={tdS('right', '#16a34a')}>{fmtN(totals.amount)}</td>
              <td style={tdS('right', 'var(--mc-muted)')}>{fmtN(totals.avg)}</td>
              <td style={tdS('right', 'var(--mc-text)')}>{fmtN(totals.sales)}</td>
              <td style={tdS('right', 'var(--mc-text)')}>{fmtN(totals.deliv)}</td>
              <td style={tdS('right', 'var(--mc-text)')}>{fmtN(totals.pickup)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {!canEdit && (
        <div style={{ fontSize: 11, color: 'var(--mc-muted)', textAlign: 'center', marginTop: 12 }}>
          Ввод выручки доступен администратору, старшему менеджеру и директору
        </div>
      )}
    </div>
  );
}

/* ── CSS helpers ───────────────────────────────────────────── */
const thS = (align = 'left') => ({
  background: '#1e293b', color: 'var(--mc-border)', padding: '8px 10px',
  textAlign: align, fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap',
});
const tdS = (align = 'left', color = 'var(--mc-text)') => ({
  padding: '6px 10px', textAlign: align, color,
  borderBottom: '1px solid var(--mc-border-light)',
});
