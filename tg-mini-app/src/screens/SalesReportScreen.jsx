/**
 * SalesReportScreen.jsx  — Отчёт «План vs Факт ОП 2026»
 * Заполнять план и факт: admin, senior_manager, director
 * Смотреть: все сотрудники (тайл на главной + экран)
 */
import React, { useState, useMemo, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, Save, Settings, CalendarDays } from 'lucide-react';
import { supabase } from '../supabase/client';
import { dailyRevenueSum, hasDailyRevenue } from './DailyRevenueScreen';

/* ─────────────────────────────────────────────────────────────
   КОНСТАНТЫ
───────────────────────────────────────────────────────────── */
const CAN_EDIT_ROLES = ['admin', 'senior_manager', 'director'];

export const REPORT_PRODUCTS = [
  { id: 'coffee_kg',   name: 'Кофе',                unit: 'кг',  highlight: true },
  { id: 'coffee_pcs',  name: 'Кофе (шт)',            unit: 'шт'  },
  { id: 'drip',        name: 'Дрип',                 unit: 'шт'  },
  { id: 'aer2',        name: 'АЕР/2',                unit: 'шт'  },
  { id: 'sae1',        name: 'SAE/1',                unit: 'шт'  },
  { id: 'sae2',        name: 'SAE/2',                unit: 'шт'  },
  { id: 'drcoffee',    name: 'Dr.Coffee F11 Big',    unit: 'шт'  },
  { id: 'zenith',      name: 'Eureka ZENITH 65 E',   unit: 'шт'  },
  { id: 'firenze',     name: 'Eureka Firenze 75',    unit: 'шт'  },
  { id: 'syrup_mk',    name: 'Сиропы МК',            unit: 'шт'  },
  { id: 'syrup_1883',  name: 'Сироп 1883',           unit: 'шт'  },
  { id: 'acc_horeca',  name: 'Аксессуары HoReCa',    unit: 'шт'  },
  { id: 'acc_home',    name: 'Аксессуары для дома',  unit: 'шт'  },
  { id: 'revenue',     name: 'Выручка',              unit: 'тг',  isRevenue: true, highlight: true },
];

// Дефолтные планы (используются если план не задан в БД)
export const DEFAULT_PLANS = {
  coffee_kg:  [6000,  6000,  6000,  6000,  6000,  6000,  6000,  6000,  6000],
  coffee_pcs: [100,   500,   500,   500,   500,   500,   500,   500,   500],
  drip:       [600,   900,   900,   900,   900,   900,   900,   900,   900],
  aer2:       [2,     2,     2,     2,     2,     2,     2,     2,     2],
  sae1:       [6,     0,     3,     3,     3,     3,     3,     3,     3],
  sae2:       [6,     7,     7,     7,     7,     7,     7,     7,     7],
  drcoffee:   [3,     0,     6,     6,     6,     6,     6,     6,     6],
  zenith:     [6,     6,     6,     6,     6,     6,     6,     6,     6],
  firenze:    [2,     4,     4,     4,     4,     4,     4,     4,     4],
  syrup_mk:   [91,    115,   115,   115,   115,   115,   115,   115,   115],
  syrup_1883: [49,    51,    51,    51,    51,    51,    51,    51,    51],
  acc_horeca: [200,   200,   200,   200,   200,   200,   200,   200,   200],
  acc_home:   [60,    60,    60,    60,    60,    60,    60,    60,    60],
  revenue:    [95025000, 82066778, 82066778, 85000000, 85000000, 85000000, 90000000, 90000000, 90000000],
};

export const MONTHS = [
  { key: '2026-04', label: 'Апрель 2026',   short: 'Апр', idx: 0, weeks: ['01-05.04','06-12.04','13-19.04','20-26.04','27-30.04'] },
  { key: '2026-05', label: 'Май 2026',       short: 'Май', idx: 1, weeks: ['01-10.05','11-17.05','18-24.05','25-31.05'] },
  { key: '2026-06', label: 'Июнь 2026',      short: 'Июн', idx: 2, weeks: ['01-07.06','08-14.06','15-21.06','22-28.06','29-30.06'] },
  { key: '2026-07', label: 'Июль 2026',      short: 'Июл', idx: 3, weeks: ['01-07.07','08-14.07','15-21.07','22-31.07'] },
  { key: '2026-08', label: 'Август 2026',    short: 'Авг', idx: 4, weeks: ['01-07.08','08-14.08','15-21.08','22-31.08'] },
  { key: '2026-09', label: 'Сентябрь 2026', short: 'Сен', idx: 5, weeks: ['01-07.09','08-14.09','15-21.09','22-30.09'] },
  { key: '2026-10', label: 'Октябрь 2026',  short: 'Окт', idx: 6, weeks: ['01-07.10','08-14.10','15-21.10','22-31.10'] },
  { key: '2026-11', label: 'Ноябрь 2026',   short: 'Ноя', idx: 7, weeks: ['01-07.11','08-14.11','15-21.11','22-30.11'] },
  { key: '2026-12', label: 'Декабрь 2026',  short: 'Дек', idx: 8, weeks: ['01-07.12','08-14.12','15-21.12','22-31.12'] },
];

const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

function monthLabelOf(key) { const [y, m] = key.split('-'); return `${MONTH_NAMES[+m - 1]} ${y}`; }
function monthShortOf(key) { const [, m] = key.split('-'); return MONTH_NAMES[+m - 1].slice(0, 3); }

// Универсальные недельные интервалы для месяца, если из Google ещё не пришли
function genWeeks(key) {
  const [y, m] = key.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, '0');
  const out = [];
  for (let start = 1; start <= last; start += 7) {
    const end = Math.min(start + 6, last);
    out.push(`${String(start).padStart(2, '0')}-${String(end).padStart(2, '0')}.${mm}`);
  }
  return out;
}

// Список месяцев = захардкоженные ∪ синхронизированные из Google.
// Недели берём из Google (sales_reports.weeks), иначе захардкоженные/сгенерированные.
export function buildMonths(salesReports) {
  const base = MONTHS.map(m => ({ ...m }));
  const keys = new Set(base.map(m => m.key));
  (salesReports || []).forEach(r => {
    if (r.month && !keys.has(r.month)) {
      keys.add(r.month);
      base.push({ key: r.month, label: monthLabelOf(r.month), short: monthShortOf(r.month), idx: -1, weeks: genWeeks(r.month) });
    }
  });
  return base
    .map(m => {
      const rec = (salesReports || []).find(r => r.month === m.key);
      return rec?.weeks?.length ? { ...m, weeks: rec.weeks } : m;
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

/* ─────────────────────────────────────────────────────────────
   ХЕЛПЕРЫ
───────────────────────────────────────────────────────────── */
export const sumArr = arr => (arr || []).reduce((s, v) => s + (Number(v) || 0), 0);

export function getMonthFacts(salesReports, monthKey) {
  return salesReports?.find(r => r.month === monthKey)?.facts || {};
}

export function getMonthPlans(salesReports, monthKey) {
  return salesReports?.find(r => r.month === monthKey)?.plans || {};
}

// Получить план для продукта в месяце (из БД или дефолт)
export function getPlan(productId, monthIdx, dbPlans = {}) {
  const dbVal = dbPlans[productId];
  if (dbVal !== undefined && dbVal !== null && dbVal !== '') return Number(dbVal);
  return DEFAULT_PLANS[productId]?.[monthIdx] ?? 0;
}

const fmtN = (n, isRev) => {
  if (n === null || n === undefined || n === '') return '—';
  const num = Number(n);
  if (isNaN(num)) return '—';
  if (isRev) return (num / 1_000_000).toFixed(2) + ' M';
  return num.toLocaleString('ru-RU');
};

const pctColor = pct => {
  if (!pct || pct === 0) return 'var(--mc-muted)';
  if (pct >= 1) return '#16a34a';
  if (pct >= 0.8) return '#d97706';
  return '#dc2626';
};

const pctBg = pct => {
  if (!pct || pct === 0) return 'var(--mc-active-item)';
  if (pct >= 1) return '#dcfce7';
  if (pct >= 0.8) return '#fef9c3';
  return '#fee2e2';
};

const statusEmoji = pct => {
  if (!pct || pct === 0) return '⏳';
  if (pct >= 1) return '✅';
  if (pct >= 0.8) return '🟡';
  return '🔴';
};

/* ─────────────────────────────────────────────────────────────
   CLICK-TO-EDIT CELL
───────────────────────────────────────────────────────────── */
function EditableCell({ value, onSave, readOnly, isRevenue, planMode }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  const display = value !== '' && value !== null && value !== undefined && value !== 0
    ? fmtN(value, isRevenue)
    : null;

  const commit = () => {
    setEditing(false);
    onSave(draft);
  };

  if (readOnly) {
    return (
      <div style={{ textAlign: 'center', fontSize: 12, color: display ? 'var(--mc-text)' : 'var(--mc-muted)', fontWeight: display ? 600 : 400 }}>
        {display || '—'}
      </div>
    );
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        inputMode="numeric"
        value={draft}
        autoFocus
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { commit(); }
          if (e.key === 'Escape') { setEditing(false); setDraft(''); }
        }}
        style={{
          width: '100%', padding: '4px 5px', borderRadius: 6, textAlign: 'center',
          fontSize: 12, fontWeight: 700, outline: 'none', boxSizing: 'border-box',
          border: `2px solid #297b8a`,
          background: planMode ? '#fffbeb' : '#f0f9ff',
          color: 'var(--mc-text)',
        }}
      />
    );
  }

  return (
    <div
      onClick={() => { setDraft(value !== 0 && value ? String(value) : ''); setEditing(true); }}
      title="Кликни чтобы ввести"
      style={{
        textAlign: 'center', fontSize: 12, cursor: 'text', borderRadius: 6, padding: '4px 5px',
        border: `1.5px dashed ${display ? (planMode ? '#d97706' : 'var(--mc-border)') : 'var(--mc-border-light)'}`,
        background: display ? (planMode ? '#fffbeb' : 'var(--mc-active-item)') : 'transparent',
        color: display ? 'var(--mc-text)' : 'var(--mc-muted)',
        fontWeight: display ? 700 : 400,
        minWidth: 60,
        transition: 'border-color .15s, background .15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#297b8a'; e.currentTarget.style.background = planMode ? '#fef9c3' : '#f0f9ff'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = display ? (planMode ? '#d97706' : 'var(--mc-border)') : 'var(--mc-border-light)'; e.currentTarget.style.background = display ? (planMode ? '#fffbeb' : 'var(--mc-active-item)') : 'transparent'; }}
    >
      {display || <span style={{ fontSize: 11 }}>＋</span>}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   ГЛАВНЫЙ ЭКРАН
───────────────────────────────────────────────────────────── */
export function SalesReportScreen({ ctx }) {
  const { db, currentUser, goBack, setDb, showToast, can } = ctx;
  const canEdit = can ? can('report_edit') : CAN_EDIT_ROLES.includes(currentUser?.role);

  const nowKey = (() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  })();

  const monthsList = useMemo(() => buildMonths(db.salesReports), [db.salesReports]);
  const defaultMonth = monthsList.find(m => m.key === nowKey) || monthsList[0];
  const [selectedKey, setSelectedKey]   = useState(defaultMonth.key);
  const [view, setView]                 = useState('monthly');
  const [editingPlan, setEditingPlan]   = useState(false); // режим редактирования плана
  const [saving, setSaving]             = useState(false);

  const month = monthsList.find(m => m.key === selectedKey) || monthsList[0];

  // Черновик факта и плана для текущего месяца
  const [draftFacts, setDraftFacts] = useState(() =>
    JSON.parse(JSON.stringify(getMonthFacts(db.salesReports, selectedKey) || {}))
  );
  const [draftPlans, setDraftPlans] = useState(() =>
    JSON.parse(JSON.stringify(getMonthPlans(db.salesReports, selectedKey) || {}))
  );

  const handleMonthChange = key => {
    setSelectedKey(key);
    setEditingPlan(false);
    setDraftFacts(JSON.parse(JSON.stringify(getMonthFacts(db.salesReports, key) || {})));
    setDraftPlans(JSON.parse(JSON.stringify(getMonthPlans(db.salesReports, key) || {})));
  };

  const updateFact = useCallback((prodId, weekIdx, val) => {
    setDraftFacts(d => {
      const arr = [...(d[prodId] || [])];
      arr[weekIdx] = parseFloat(val) || 0;
      return { ...d, [prodId]: arr };
    });
  }, []);

  const updatePlan = useCallback((prodId, val) => {
    setDraftPlans(d => ({ ...d, [prodId]: parseFloat(val) || 0 }));
  }, []);

  const handleSave = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('sales_reports').upsert({
        month: selectedKey,
        facts: draftFacts,
        plans: draftPlans,
        updated_by: currentUser.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'month' });
      if (error) throw error;
      setDb(d => ({
        ...d,
        salesReports: (d.salesReports || []).map(r =>
          r.month === selectedKey ? { ...r, facts: draftFacts, plans: draftPlans } : r
        ),
      }));
      setEditingPlan(false);
      showToast('Отчёт сохранён');
    } catch (e) {
      showToast('Ошибка: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // KPI для текущего месяца. Выручка-факт: если есть дневная выручка — берём её сумму.
  const kpi = useMemo(() => {
    const coffFact = sumArr(draftFacts['coffee_kg']);
    const coffPlan = getPlan('coffee_kg', month.idx, draftPlans);
    const revFromDaily = hasDailyRevenue(db, selectedKey);
    const revFact  = revFromDaily ? dailyRevenueSum(db, selectedKey) : sumArr(draftFacts['revenue']);
    const revPlan  = getPlan('revenue',   month.idx, draftPlans);
    return {
      coffFact, coffPlan, coffPct: coffPlan ? coffFact / coffPlan : 0,
      revFact,  revPlan,  revPct:  revPlan  ? revFact  / revPlan  : 0,
      revFromDaily,
    };
  }, [draftFacts, draftPlans, month, db, selectedKey]);

  return (
    <div>
      {/* Шапка */}
      <div style={{ marginBottom: 16 }}>
        <button onClick={goBack}
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--mc-muted)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 8, padding: 0 }}>
          <ChevronLeft size={15} /> Назад
        </button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--mc-text)', margin: 0 }}>📊 Отчёт ОП 2026</h1>
            <div style={{ fontSize: 11, color: 'var(--mc-muted)', marginTop: 2 }}>
              {canEdit ? 'Кликни ячейку чтобы ввести' : 'Только просмотр'}
            </div>
          </div>
          {canEdit && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button onClick={() => ctx.navigate({ name: 'daily_revenue' })}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', background: 'var(--mc-active-item)', color: 'var(--mc-muted)', border: '1px solid var(--mc-border)', borderRadius: 9, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                <CalendarDays size={13} /> Выручка по дням
              </button>
              <button onClick={() => setEditingPlan(p => !p)}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', background: editingPlan ? '#fef9c3' : 'var(--mc-active-item)', color: editingPlan ? '#a16207' : 'var(--mc-muted)', border: `1px solid ${editingPlan ? '#d97706' : 'var(--mc-border)'}`, borderRadius: 9, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                <Settings size={13} /> {editingPlan ? 'Режим плана' : 'Изм. план'}
              </button>
              <button onClick={handleSave} disabled={saving}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px', background: saving ? 'var(--mc-border)' : '#297b8a', color: '#fff', border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 12, cursor: saving ? 'not-allowed' : 'pointer' }}>
                <Save size={13} /> {saving ? '...' : 'Сохранить'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Выбор месяца */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 14 }}>
        {monthsList.map(m => {
          const mFacts = getMonthFacts(db.salesReports, m.key);
          const mPlans = getMonthPlans(db.salesReports, m.key);
          const cf = sumArr(mFacts['coffee_kg']);
          const cp = getPlan('coffee_kg', m.idx, mPlans);
          const pct = cp && cf ? cf / cp : null;
          const active = m.key === selectedKey;
          return (
            <button key={m.key} onClick={() => handleMonthChange(m.key)}
              style={{ flexShrink: 0, padding: '5px 12px', borderRadius: 9, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                border: `1.5px solid ${active ? '#297b8a' : 'var(--mc-border)'}`,
                background: active ? '#297b8a' : 'var(--mc-surface)',
                color: active ? '#fff' : 'var(--mc-muted)' }}>
              {m.short}
              {pct !== null && cf > 0 && (
                <span style={{ marginLeft: 4, fontSize: 9, opacity: .9 }}>{(pct * 100).toFixed(0)}%</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Вкладки */}
      <div style={{ display: 'flex', gap: 3, background: 'var(--mc-active-item)', borderRadius: 10, padding: 3, width: 'fit-content', marginBottom: 14 }}>
        {[['monthly','📋 Месяц'], ['annual','📊 Год']].map(([k, l]) => (
          <button key={k} onClick={() => setView(k)}
            style={{ padding: '5px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
              background: view === k ? 'var(--mc-surface)' : 'none',
              color: view === k ? 'var(--mc-text)' : 'var(--mc-muted)',
              boxShadow: view === k ? '0 1px 3px rgba(0,0,0,.1)' : 'none' }}>
            {l}
          </button>
        ))}
      </div>

      {view === 'monthly' && (
        <MonthlyView
          month={month}
          draftFacts={draftFacts}
          draftPlans={draftPlans}
          canEdit={canEdit}
          editingPlan={editingPlan}
          kpi={kpi}
          onUpdateFact={updateFact}
          onUpdatePlan={updatePlan}
        />
      )}
      {view === 'annual' && (
        <AnnualView salesReports={db.salesReports} monthsList={monthsList} />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   МЕСЯЧНЫЙ ВИД
───────────────────────────────────────────────────────────── */
function MonthlyView({ month, draftFacts, draftPlans, canEdit, editingPlan, kpi, onUpdateFact, onUpdatePlan }) {
  return (
    <>
      {/* KPI */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 14 }}>
        <KpiTile label="☕ Кофе" plan={kpi.coffPlan} fact={kpi.coffFact} pct={kpi.coffPct} unit="кг" />
        <KpiTile label="💰 Выручка" plan={kpi.revPlan} fact={kpi.revFact} pct={kpi.revPct} unit="тг" isRevenue />
      </div>

      {/* Подсказка режима плана */}
      {editingPlan && (
        <div style={{ background: '#fffbeb', border: '1px solid #d97706', borderRadius: 10, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#92400e' }}>
          ✏️ <strong>Режим редактирования плана</strong> — кликните ячейку «План» чтобы изменить. Не забудьте сохранить.
        </div>
      )}

      {/* Таблица */}
      <div style={{ overflowX: 'auto', borderRadius: 14, border: '1px solid var(--mc-border)', background: 'var(--mc-surface)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={th('left')} rowSpan={2}>Товар</th>
              <th style={th('center')} rowSpan={2}>Ед.</th>
              <th style={{ ...th('center'), background: editingPlan ? '#78350f' : '#0f172a', fontSize: 10 }} colSpan={2}>
                {editingPlan ? '✏️ ПЛАН (редакт.)' : '📋 ПЛАН'}
              </th>
              <th style={{ ...th('center'), background: '#0c4a6e', fontSize: 10 }} colSpan={month.weeks.length}>📥 ФАКТ ПО НЕДЕЛЯМ</th>
              <th style={th('center')} rowSpan={2}>Итого</th>
              <th style={th('center')} rowSpan={2}>%</th>
              <th style={th('center')} rowSpan={2}>Статус</th>
            </tr>
            <tr>
              <th style={{ ...th('center'), background: editingPlan ? '#92400e' : '#1e293b', fontSize: 10, color: editingPlan ? '#fef9c3' : '#94a3b8' }}>
                Месяц {editingPlan && '✏️'}
              </th>
              <th style={{ ...th('center'), background: '#1e293b', fontSize: 10, color: '#94a3b8' }}>Нед.</th>
              {month.weeks.map(w => (
                <th key={w} style={{ ...th('center'), background: '#0c4a6e', fontSize: 9, color: '#7dd3fc', whiteSpace: 'nowrap' }}>{w}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {REPORT_PRODUCTS.map(p => {
              const plan  = getPlan(p.id, month.idx, draftPlans);
              const facts = draftFacts[p.id] || [];
              const total = sumArr(facts);
              const pct   = plan > 0 ? total / plan : 0;
              const isRev = p.isRevenue;

              return (
                <tr key={p.id} style={{ background: p.highlight ? 'var(--mc-active-item)' : 'transparent' }}>
                  <td style={{ padding: '7px 12px', fontWeight: p.highlight ? 700 : 600, color: 'var(--mc-text)', borderBottom: '1px solid var(--mc-border-light)', whiteSpace: 'nowrap', minWidth: 140 }}>
                    {p.name}
                  </td>
                  <td style={{ padding: '7px 8px', color: 'var(--mc-muted)', fontSize: 10, borderBottom: '1px solid var(--mc-border-light)', textAlign: 'center' }}>
                    {p.unit}
                  </td>

                  {/* ПЛАН — клик для редактирования если editingPlan */}
                  <td style={{ padding: '5px 6px', borderBottom: '1px solid var(--mc-border-light)', minWidth: 80 }}>
                    <EditableCell
                      value={plan}
                      onSave={val => onUpdatePlan(p.id, val)}
                      readOnly={!canEdit || !editingPlan}
                      isRevenue={isRev}
                      planMode
                    />
                  </td>
                  <td style={{ padding: '5px 6px', color: 'var(--mc-muted)', fontSize: 10, borderBottom: '1px solid var(--mc-border-light)', textAlign: 'center' }}>
                    {!isRev && plan > 0 ? (plan / month.weeks.length).toFixed(1) : '—'}
                  </td>

                  {/* ФАКТ — клик для ввода */}
                  {month.weeks.map((_, wi) => (
                    <td key={wi} style={{ padding: '5px 4px', borderBottom: '1px solid var(--mc-border-light)', minWidth: 70 }}>
                      <EditableCell
                        value={facts[wi] || 0}
                        onSave={val => onUpdateFact(p.id, wi, val)}
                        readOnly={!canEdit}
                        isRevenue={isRev}
                      />
                    </td>
                  ))}

                  <td style={{ padding: '7px 10px', fontWeight: 700, color: 'var(--mc-text)', textAlign: 'center', borderBottom: '1px solid var(--mc-border-light)', whiteSpace: 'nowrap' }}>
                    {fmtN(total, isRev)}
                  </td>
                  <td style={{ padding: '7px 8px', textAlign: 'center', borderBottom: '1px solid var(--mc-border-light)' }}>
                    {plan > 0 ? (
                      <span style={{ display: 'inline-block', padding: '3px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: pctBg(pct), color: pctColor(pct) }}>
                        {(pct * 100).toFixed(1)}%
                      </span>
                    ) : '—'}
                  </td>
                  <td style={{ padding: '7px 8px', textAlign: 'center', borderBottom: '1px solid var(--mc-border-light)', fontSize: 14 }}>
                    {plan > 0 ? statusEmoji(pct) : '⏳'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────
   ГОДОВАЯ СВОДКА
───────────────────────────────────────────────────────────── */
function AnnualView({ salesReports, monthsList }) {
  const MONTHS = monthsList;
  return (
    <div style={{ overflowX: 'auto', borderRadius: 14, border: '1px solid var(--mc-border)', background: 'var(--mc-surface)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr>
            <th style={{ ...th('left'), minWidth: 130 }}>Товар</th>
            <th style={th('center')}>Ед.</th>
            {MONTHS.map(m => (
              <th key={m.key} style={{ ...th('center'), fontSize: 10 }} colSpan={2}>{m.short}</th>
            ))}
          </tr>
          <tr>
            <th style={{ ...th('left'), background: '#0f172a' }}></th>
            <th style={{ ...th('center'), background: '#0f172a' }}></th>
            {MONTHS.map(m => (
              <React.Fragment key={m.key}>
                <th style={{ ...th('center'), background: '#1e293b', fontSize: 9, color: '#94a3b8' }}>П</th>
                <th style={{ ...th('center'), background: '#0c4a6e', fontSize: 9, color: '#7dd3fc' }}>Ф%</th>
              </React.Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {REPORT_PRODUCTS.map(p => (
            <tr key={p.id} style={{ background: p.highlight ? 'var(--mc-active-item)' : 'transparent' }}>
              <td style={{ padding: '6px 12px', fontWeight: p.highlight ? 700 : 500, color: 'var(--mc-text)', borderBottom: '1px solid var(--mc-border-light)', whiteSpace: 'nowrap' }}>
                {p.name}
              </td>
              <td style={{ padding: '6px 8px', color: 'var(--mc-muted)', fontSize: 10, textAlign: 'center', borderBottom: '1px solid var(--mc-border-light)' }}>{p.unit}</td>
              {MONTHS.map(m => {
                const mPlans = getMonthPlans(salesReports, m.key);
                const plan   = getPlan(p.id, m.idx, mPlans);
                const facts  = getMonthFacts(salesReports, m.key);
                const fact   = sumArr(facts[p.id]);
                const pct    = plan > 0 ? fact / plan : null;
                return (
                  <React.Fragment key={m.key}>
                    <td style={{ padding: '6px 8px', color: 'var(--mc-muted)', textAlign: 'center', borderBottom: '1px solid var(--mc-border-light)', fontSize: 10 }}>
                      {fmtN(plan, p.isRevenue)}
                    </td>
                    <td style={{ padding: '6px 5px', textAlign: 'center', borderBottom: '1px solid var(--mc-border-light)' }}>
                      {pct !== null && fact > 0 ? (
                        <span style={{ display: 'inline-block', padding: '2px 6px', borderRadius: 10, fontSize: 9, fontWeight: 700, background: pctBg(pct), color: pctColor(pct) }}>
                          {(pct * 100).toFixed(0)}%
                        </span>
                      ) : <span style={{ color: 'var(--mc-muted)', fontSize: 10 }}>—</span>}
                    </td>
                  </React.Fragment>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   KPI ТАЙЛ (внутри экрана)
───────────────────────────────────────────────────────────── */
export function KpiTile({ label, plan, fact, pct, unit, isRevenue }) {
  const remaining = plan - fact;
  const color = pctColor(pct);
  return (
    <div style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 14, padding: '14px 16px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .4, marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1 }}>
          {pct > 0 ? (pct * 100).toFixed(1) + '%' : '—'}
        </span>
        <span style={{ fontSize: 14 }}>{statusEmoji(pct)}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--mc-muted)', marginBottom: 8 }}>
        {fmtN(fact, isRevenue)} из {fmtN(plan, isRevenue)} {unit}
      </div>
      <div style={{ height: 5, background: 'var(--mc-active-item)', borderRadius: 3, overflow: 'hidden', marginBottom: 8 }}>
        <div style={{ height: '100%', width: Math.min(100, (pct || 0) * 100) + '%', background: color, borderRadius: 3, transition: 'width .4s' }} />
      </div>
      {remaining > 0 && pct < 1 && (
        <div style={{ fontSize: 11, color: 'var(--mc-muted)' }}>
          До плана: <strong style={{ color: 'var(--mc-text)' }}>{fmtN(remaining, isRevenue)} {unit}</strong>
        </div>
      )}
      {pct >= 1 && <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 700 }}>✅ План выполнен!</div>}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   SPLIT BAR: зелёный = сделано, жёлтый = осталось
───────────────────────────────────────────────────────────── */
function SplitBar({ pct }) {
  const done = Math.min(100, Math.max(0, (pct || 0) * 100));
  const left = Math.max(0, 100 - done);
  return (
    <div style={{ display: 'flex', height: 7, borderRadius: 4, overflow: 'hidden', marginBottom: 8, gap: 2 }}>
      {done > 0 && (
        <div style={{ width: done + '%', background: '#22c55e', borderRadius: left > 0 ? '4px 0 0 4px' : 4, transition: 'width .5s' }} />
      )}
      {left > 0 && (
        <div style={{ width: left + '%', background: '#f59e0b', borderRadius: done > 0 ? '0 4px 4px 0' : 4, opacity: .85, transition: 'width .5s' }} />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   ТАЙЛ НА ГЛАВНОЙ — акцентный, бросается в глаза
───────────────────────────────────────────────────────────── */
export function SalesReportHomeTile({ ctx }) {
  const { db, navigate } = ctx;

  const nowKey = (() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  })();
  const month  = MONTHS.find(m => m.key === nowKey) || MONTHS[2];
  const facts  = getMonthFacts(db.salesReports, nowKey);
  const plans  = getMonthPlans(db.salesReports, nowKey);

  const coffFact = sumArr(facts['coffee_kg']);
  const coffPlan = getPlan('coffee_kg', month.idx, plans);
  const coffPct  = coffPlan ? coffFact / coffPlan : 0;
  const coffRem  = Math.max(0, coffPlan - coffFact);

  const revFact  = hasDailyRevenue(db, nowKey) ? dailyRevenueSum(db, nowKey) : sumArr(facts['revenue']);
  const revPlan  = getPlan('revenue', month.idx, plans);
  const revPct   = revPlan ? revFact / revPlan : 0;
  const revRem   = Math.max(0, revPlan - revFact);

  const hasData  = coffFact > 0 || revFact > 0;

  // Цвет статуса
  const statusColor = (pct) => {
    if (!pct || pct === 0) return { text: '#94a3b8', bar: '#475569', badge: 'rgba(255,255,255,.12)' };
    if (pct >= 1)   return { text: '#4ade80', bar: '#22c55e', badge: 'rgba(74,222,128,.2)' };
    if (pct >= 0.8) return { text: '#fbbf24', bar: '#f59e0b', badge: 'rgba(251,191,36,.2)' };
    return             { text: '#f87171', bar: '#ef4444', badge: 'rgba(248,113,113,.2)' };
  };

  const coffColor = statusColor(coffPct);
  const revColor  = statusColor(revPct);

  return (
    <div
      onClick={() => navigate({ name: 'sales_report' })}
      style={{
        background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)',
        borderRadius: 18,
        padding: '18px 18px 16px',
        cursor: 'pointer',
        marginBottom: 16,
        border: '1px solid rgba(255,255,255,.08)',
        boxShadow: '0 4px 24px rgba(0,0,0,.25)',
        transition: 'transform .15s, box-shadow .15s',
        position: 'relative',
        overflow: 'hidden',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,.35)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 4px 24px rgba(0,0,0,.25)'; }}
    >
      {/* Декоративный круг фона */}
      <div style={{ position: 'absolute', top: -30, right: -30, width: 120, height: 120, borderRadius: '50%', background: 'rgba(41,123,138,.15)', pointerEvents: 'none' }} />

      {/* Шапка */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', letterSpacing: .2 }}>📊 Выполнение плана</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', marginTop: 2 }}>{month.label}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(255,255,255,.1)', borderRadius: 8, padding: '4px 10px' }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,.7)', fontWeight: 600 }}>Подробнее</span>
          <ChevronRight size={13} style={{ color: 'rgba(255,255,255,.5)' }} />
        </div>
      </div>

      {/* Метрики */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>

        {/* Кофе */}
        <div style={{ background: 'rgba(255,255,255,.07)', borderRadius: 13, padding: '12px 14px', border: '1px solid rgba(255,255,255,.06)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.5)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 8 }}>☕ Кофе</div>
          <div style={{ fontSize: 34, fontWeight: 900, color: coffColor.text, lineHeight: 1, marginBottom: 4, letterSpacing: -1 }}>
            {hasData && coffPlan > 0 ? (coffPct * 100).toFixed(1) + '%' : '—'}
          </div>
          <SplitBar pct={coffPct} />
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)' }}>
            {coffFact > 0
              ? <><strong style={{ color: '#fff' }}>{coffFact.toLocaleString('ru-RU')}</strong> / {coffPlan.toLocaleString('ru-RU')} кг</>
              : <span>план: {coffPlan.toLocaleString('ru-RU')} кг</span>}
          </div>
          {coffRem > 0 && coffPlan > 0 && coffPct < 1 && (
            <div style={{ marginTop: 6, display: 'inline-block', background: coffColor.badge, borderRadius: 6, padding: '3px 8px', fontSize: 10, color: coffColor.text, fontWeight: 700 }}>
              −{coffRem.toLocaleString('ru-RU')} кг
            </div>
          )}
          {coffPct >= 1 && <div style={{ marginTop: 6, fontSize: 12, color: '#4ade80', fontWeight: 700 }}>✅ Выполнен</div>}
        </div>

        {/* Выручка */}
        <div style={{ background: 'rgba(255,255,255,.07)', borderRadius: 13, padding: '12px 14px', border: '1px solid rgba(255,255,255,.06)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.5)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 8 }}>💰 Выручка</div>
          <div style={{ fontSize: 34, fontWeight: 900, color: revColor.text, lineHeight: 1, marginBottom: 4, letterSpacing: -1 }}>
            {hasData && revPlan > 0 ? (revPct * 100).toFixed(1) + '%' : '—'}
          </div>
          <SplitBar pct={revPct} />
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)' }}>
            {revFact > 0
              ? <><strong style={{ color: '#fff' }}>{(revFact / 1_000_000).toFixed(1)}</strong> / {(revPlan / 1_000_000).toFixed(1)} M тг</>
              : <span>план: {(revPlan / 1_000_000).toFixed(1)} M тг</span>}
          </div>
          {revRem > 0 && revPlan > 0 && revPct < 1 && (
            <div style={{ marginTop: 6, display: 'inline-block', background: revColor.badge, borderRadius: 6, padding: '3px 8px', fontSize: 10, color: revColor.text, fontWeight: 700 }}>
              −{(revRem / 1_000_000).toFixed(2)} M тг
            </div>
          )}
          {revPct >= 1 && <div style={{ marginTop: 6, fontSize: 12, color: '#4ade80', fontWeight: 700 }}>✅ Выполнен</div>}
        </div>
      </div>

      {!hasData && (
        <div style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,.35)', marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,.08)' }}>
          Данные за {month.label} ещё не внесены · нажмите чтобы открыть
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   CSS helpers
───────────────────────────────────────────────────────────── */
const th = (align = 'center') => ({
  background: '#1e293b',
  color: '#e2e8f0',
  padding: '9px 10px',
  textAlign: align,
  fontWeight: 600,
  fontSize: 11,
  whiteSpace: 'nowrap',
});
