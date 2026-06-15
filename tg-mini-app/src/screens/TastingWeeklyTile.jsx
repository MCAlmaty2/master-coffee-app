import React, { useState, useMemo } from 'react';
import { Coffee, ChevronRight } from 'lucide-react';

const PERIODS = [
  { key: '4w',  label: '4 нед.',  weeks: 4 },
  { key: '8w',  label: '8 нед.',  weeks: 8 },
  { key: '3m',  label: '3 мес.', weeks: 13 },
  { key: '6m',  label: '6 мес.', weeks: 26 },
  { key: 'all', label: 'Всё',    weeks: 0 },
];

function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function formatWeekRange(mondayStr) {
  const mon = new Date(mondayStr + 'T12:00:00');
  const sun = new Date(mon);
  sun.setDate(sun.getDate() + 6);
  const fmt = (d) => `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `${fmt(mon)} — ${fmt(sun)}`;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function TastingWeeklyTile({ ctx }) {
  const { db, currentUser, navigate } = ctx;
  const can = ctx.can || (() => false);
  const [period, setPeriod] = useState('4w');

  const canSee = can('tasks_view_own')
    || can('tasks_calendar_all')
    || currentUser.role === 'admin';

  const tastings = useMemo(() => {
    if (!canSee) return [];
    return (db.tasks || []).filter(t => t.kind === 'tasting');
  }, [db.tasks, canSee]);

  const { weeks, totals } = useMemo(() => {
    if (tastings.length === 0) return { weeks: [], totals: { total: 0, done: 0, planned: 0 } };

    const cfg = PERIODS.find(p => p.key === period) || PERIODS[0];
    const today = todayISO();
    const currentMonday = mondayOf(today);

    const slotCount = cfg.weeks || 52;
    const weekMap = {};
    for (let i = 0; i < slotCount; i++) {
      const mon = new Date(currentMonday + 'T12:00:00');
      mon.setDate(mon.getDate() - i * 7);
      const key = mon.toISOString().slice(0, 10);
      weekMap[key] = { monday: key, total: 0, done: 0, planned: 0 };
    }

    let totalAll = 0, doneAll = 0, plannedAll = 0;
    for (const t of tastings) {
      const date = t.visit_date || (t.created_at ? t.created_at.slice(0, 10) : null);
      if (!date) continue;
      const mon = mondayOf(date);
      if (!weekMap[mon]) continue;
      weekMap[mon].total++;
      totalAll++;
      if (t.status === 'done') { weekMap[mon].done++; doneAll++; }
      else { weekMap[mon].planned++; plannedAll++; }
    }

    const sorted = Object.values(weekMap)
      .sort((a, b) => b.monday.localeCompare(a.monday))
      .filter(w => w.total > 0);

    const maxCards = cfg.weeks <= 4 ? 4 : cfg.weeks <= 8 ? 4 : 4;
    return {
      weeks: sorted.slice(0, maxCards),
      totals: { total: totalAll, done: doneAll, planned: plannedAll },
    };
  }, [tastings, period]);

  if (!canSee || tastings.length === 0) return null;

  const thisWeek = weeks[0];

  return (
    <div
      style={{
        background: 'var(--mc-surface)',
        border: '1px solid var(--mc-border)',
        borderRadius: 14,
        padding: '14px 16px',
        marginBottom: 12,
      }}
    >
      <div
        onClick={() => navigate({ name: 'tasks_list' })}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, cursor: 'pointer' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Coffee size={14} style={{ color: '#8B5CF6' }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--mc-text)' }}>Дегустации понедельно</span>
        </div>
        <ChevronRight size={14} style={{ color: 'var(--mc-muted)' }} />
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        {PERIODS.map(p => (
          <button
            key={p.key}
            onClick={(e) => { e.stopPropagation(); setPeriod(p.key); }}
            style={{
              flex: 1, padding: '4px 2px', fontSize: 10, fontWeight: 600,
              border: 'none', borderRadius: 6, cursor: 'pointer',
              background: period === p.key ? '#8B5CF6' : 'var(--mc-active-item)',
              color: period === p.key ? '#fff' : 'var(--mc-muted)',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 }}>
            За период
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#8B5CF6' }}>{totals.total}</div>
          <div style={{ fontSize: 10, color: 'var(--mc-muted)' }}>
            {totals.done} выполн. · {totals.planned} план
          </div>
        </div>
        {totals.total > 0 && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{
              width: 48, height: 48, borderRadius: '50%',
              background: `conic-gradient(#16a34a ${(totals.done / totals.total) * 360}deg, #e5e7eb 0deg)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: 'var(--mc-surface)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, color: '#16a34a',
              }}>
                {Math.round((totals.done / totals.total) * 100)}%
              </div>
            </div>
          </div>
        )}
      </div>

      {weeks.length > 0 && (
        <div style={{ display: 'flex', gap: 6 }}>
          {weeks.map(w => {
            const isCurrent = thisWeek && w.monday === thisWeek.monday;
            return (
              <div key={w.monday} style={{
                flex: 1, background: isCurrent ? '#8B5CF60F' : 'var(--mc-active-item)',
                borderRadius: 8, padding: '6px 4px', textAlign: 'center',
                border: isCurrent ? '1px solid #8B5CF633' : '1px solid transparent',
              }}>
                <div style={{ fontSize: 9, color: 'var(--mc-muted)', marginBottom: 2 }}>
                  {formatWeekRange(w.monday)}
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--mc-text)' }}>{w.total}</div>
                <div style={{ fontSize: 9, color: '#16a34a' }}>{w.done} ✓</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
