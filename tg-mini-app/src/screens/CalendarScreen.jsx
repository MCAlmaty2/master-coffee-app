/**
 * CalendarScreen.jsx
 * Компоненты календаря: WeekView, MonthView, DayView, CalendarNavBar
 * Экспортирует: FieldCalendarScreen, FieldHome
 */
import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { SalesReportHomeTile } from './SalesReportScreen';

/* ── КОНСТАНТЫ ─────────────────────────────────────────────────────────────── */
const CAL_START  = 9;
const CAL_END    = 19;
const HOUR_PX    = 56;
const HOURS      = Array.from({ length: CAL_END - CAL_START + 1 }, (_, i) => CAL_START + i);
const TOTAL_H    = HOURS.length * HOUR_PX;
const FIELD_ROLES = ['barista', 'technician'];

const DAY_SHORT  = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
const DAY_FULL   = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];
const MON_FULL   = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const MON_GEN    = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];

/* ── УТИЛИТЫ ───────────────────────────────────────────────────────────────── */
// Текущая дата в локальном времени (UTC+5 Казахстан), не UTC
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDate(iso, n) {
  const d = new Date(iso + 'T00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getMonday(iso) {
  const d = new Date(iso + 'T00:00');
  const dow = d.getDay(); // 0=Вс
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function timeToY(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return (h - CAL_START) * HOUR_PX + (m / 60) * HOUR_PX;
}

function fmtDayFull(iso) {
  const d = new Date(iso + 'T00:00');
  return `${d.getDate()} ${MON_GEN[d.getMonth()]} ${d.getFullYear()}, ${DAY_FULL[d.getDay()]}`;
}

function fmtWeekRange(mon) {
  const d1 = new Date(mon + 'T00:00');
  const d2 = new Date(mon + 'T00:00');
  d2.setDate(d2.getDate() + 6);
  if (d1.getMonth() === d2.getMonth())
    return `${d1.getDate()}–${d2.getDate()} ${MON_GEN[d1.getMonth()]} ${d1.getFullYear()}`;
  return `${d1.getDate()} ${MON_GEN[d1.getMonth()]} – ${d2.getDate()} ${MON_GEN[d2.getMonth()]} ${d1.getFullYear()}`;
}

function shiftMonth(monthISO, n) {
  const [y, m] = monthISO.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Палитра уникальных цветов для выездных сотрудников (12 цветов)
const FIELD_USER_COLORS = [
  '#297b8a', '#7C3AED', '#DB2777', '#059669',
  '#D97706', '#2563EB', '#DC2626', '#0891B2',
  '#65A30D', '#9333EA', '#C2410C', '#0369A1',
];

// Уникальный цвет задачи по исполнителю (детерминировано по порядку создания)
function getUserTaskColor(userId, db) {
  if (!userId || !db?.users) return '#297b8a';
  const fieldUsers = (db.users || [])
    .filter(u => FIELD_ROLES.includes(u.role))
    .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  const idx = fieldUsers.findIndex(u => u.id === userId);
  return FIELD_USER_COLORS[Math.max(0, idx) % FIELD_USER_COLORS.length];
}

// ── Алгоритм Google Calendar: раскладка событий без перекрытия ────────────
function timeToMin(t) {
  if (!t) return 9 * 60;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function computeEventLayout(tasks) {
  if (!tasks.length) return [];
  const sorted = [...tasks].sort((a, b) => {
    const diff = timeToMin(a.visit_time) - timeToMin(b.visit_time);
    return diff !== 0 ? diff : (b.duration_min || 60) - (a.duration_min || 60);
  });
  const placed = [];
  for (const t of sorted) {
    const start = timeToMin(t.visit_time || '09:00');
    const end   = start + (t.duration_min || 60);
    const overlapping = placed.filter(p => {
      const pS = timeToMin(p.task.visit_time || '09:00');
      return start < pS + (p.task.duration_min || 60) && end > pS;
    });
    const usedCols = new Set(overlapping.map(p => p.col));
    let col = 0;
    while (usedCols.has(col)) col++;
    placed.push({ task: t, col });
  }
  return placed.map(p => {
    const pS = timeToMin(p.task.visit_time || '09:00');
    const pE = pS + (p.task.duration_min || 60);
    const cluster = placed.filter(q => {
      const qS = timeToMin(q.task.visit_time || '09:00');
      return pS < qS + (q.task.duration_min || 60) && pE > qS;
    });
    const totalCols = Math.max(...cluster.map(q => q.col)) + 1;
    return { task: p.task, col: p.col, totalCols };
  });
}

// Проверка видимости задачи
function canSeeTask(t, currentUser, mode) {
  if (mode === 'owner') return true;
  if (mode === 'team')  return true; // полевые сотрудники видят детали друг друга
  if (mode === 'busy')  return false;
  if (!currentUser) return false;
  if (currentUser.role === 'admin') return true;
  // полевые сотрудники видят все задачи своих коллег
  if (FIELD_ROLES.includes(currentUser.role)) return true;
  return t.assignee_id === currentUser.id || t.created_by === currentUser.id;
}

/* ── ХУК: ТЕКУЩЕЕ ВРЕМЯ → Y-КООРДИНАТА ─────────────────────────────────────── */
function useNowY() {
  const calc = () => {
    const n = new Date();
    return (n.getHours() - CAL_START) * HOUR_PX + (n.getMinutes() / 60) * HOUR_PX;
  };
  const [y, setY] = useState(calc);
  useEffect(() => {
    const id = setInterval(() => setY(calc()), 60_000);
    return () => clearInterval(id);
  }, []);
  return y;
}

/* ── CALENDAR NAV BAR ───────────────────────────────────────────────────────── */
function CalendarNavBar({ view, setView, label, onPrev, onNext, onToday, onNew, hideMonth }) {
  return (
    <div className="flex items-center gap-2 mb-4 flex-wrap">
      <div className="flex items-center gap-1">
        <button onClick={onPrev}
          className="p-2 rounded-lg bg-white"
          style={{ border: '1px solid var(--mc-border)' }}>
          <ChevronLeft size={15} />
        </button>
        <button onClick={onToday}
          className="px-3 py-2 rounded-lg text-sm font-semibold"
          style={{ background: 'var(--mc-cal-today)', color: '#297b8a' }}>
          Сегодня
        </button>
        <button onClick={onNext}
          className="p-2 rounded-lg bg-white"
          style={{ border: '1px solid var(--mc-border)' }}>
          <ChevronRight size={15} />
        </button>
      </div>

      <div className="text-sm font-semibold flex-1" style={{ color: 'var(--mc-text)' }}>{label}</div>

      {onNew && (
        <button onClick={onNew}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-white"
          style={{ background: '#297b8a' }}>
          <Plus size={14} /> Задача
        </button>
      )}

      <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--mc-border)' }}>
        {[['day', 'День'], ['week', 'Неделя'], ...(!hideMonth ? [['month', 'Месяц']] : [])].map(([v, lbl]) => (
          <button key={v} onClick={() => setView(v)}
            className="px-3 py-1.5 text-xs font-semibold"
            style={{
              background: view === v ? '#297b8a' : 'var(--mc-surface)',
              color: view === v ? 'white' : 'var(--mc-muted)',
            }}>
            {lbl}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── ЧАСОВАЯ СЕТКА (переиспользуется в Day и Week) ─────────────────────────── */
function HourGrid() {
  return (
    <>
      {HOURS.map((_, i) => (
        <React.Fragment key={i}>
          <div style={{ position: 'absolute', top: i * HOUR_PX, left: 0, right: 0, borderTop: '1px solid var(--mc-border-light)' }} />
          <div style={{ position: 'absolute', top: i * HOUR_PX + HOUR_PX / 2, left: 0, right: 0, borderTop: '1px dashed var(--mc-cal-grid)' }} />
        </React.Fragment>
      ))}
    </>
  );
}

/* ── ТЕКУЩЕЕ ВРЕМЯ: КРАСНАЯ ЧЕРТА ───────────────────────────────────────────── */
function NowLine({ nowY }) {
  if (nowY < 0 || nowY > TOTAL_H) return null;
  return (
    <div style={{ position: 'absolute', top: nowY, left: 0, right: 0, display: 'flex', alignItems: 'center', zIndex: 10, pointerEvents: 'none' }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#EF4444', marginLeft: -4, flexShrink: 0 }} />
      <div style={{ flex: 1, height: 2, background: '#EF4444' }} />
    </div>
  );
}

/* ── КАРТОЧКА СОБЫТИЯ (в Day и Week) ─────────────────────────────────────────── */
function EventCard({ task: t, db, currentUser, mode, navigate, compact, colIdx = 0, totalCols = 1 }) {
  const top    = timeToY(t.visit_time || '09:00');
  const height = Math.max(compact ? 24 : 38, (t.duration_min || 60) / 60 * HOUR_PX - 2);
  const color  = getUserTaskColor(t.assignee_id, db);
  const show   = canSeeTask(t, currentUser, mode);
  const assignee = db.users?.find(u => u.id === t.assignee_id);
  const isDone = t.status === 'done';

  const colW    = 100 / totalCols;
  const leftPct = colIdx * colW;

  const kindLabel = t.kind === 'internal' ? 'Внутренняя'
    : t.kind === 'install'  ? `⚙️ ${t.client_name}`
    : t.kind === 'tasting'  ? `🍵 ${t.client_name}`
    : t.client_name;

  return (
    <div
      onClick={e => { e.stopPropagation(); show && navigate({ name: 'task_detail', taskId: t.id }); }}
      style={{
        position: 'absolute', top,
        left:   `calc(${leftPct}% + 2px)`,
        width:  `calc(${colW}% - 4px)`,
        height,
        background: show ? (isDone ? `${color}0f` : `${color}22`) : 'var(--mc-border)',
        borderLeft: `3px solid ${show ? (isDone ? '#22C55E' : color) : 'var(--mc-muted)'}`,
        borderRadius: 5, padding: compact ? '2px 4px' : '3px 6px',
        overflow: 'hidden', cursor: show ? 'pointer' : 'default', zIndex: 2,
        boxSizing: 'border-box',
        opacity: isDone ? 0.7 : 1,
      }}
    >
      <div style={{ fontSize: 9, fontWeight: 700, color: show ? (isDone ? '#22C55E' : color) : 'var(--mc-muted)', lineHeight: 1, display: 'flex', alignItems: 'center', gap: 2 }}>
        {t.visit_time}{t.visit_time_end ? `–${t.visit_time_end}` : ''}
        {isDone && <span style={{ fontSize: 8 }}>✅</span>}
      </div>
      {show ? (
        <>
          <div style={{ fontSize: compact ? 10 : 11, fontWeight: 600, color: 'var(--mc-text)', lineHeight: 1.2, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', textDecoration: isDone ? 'line-through' : 'none' }}>
            {kindLabel}
          </div>
          {!compact && height > 50 && assignee && (
            <div style={{ fontSize: 9, color: 'var(--mc-muted)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
              {assignee.first_name[0]}.{assignee.last_name[0]}.
            </div>
          )}
        </>
      ) : (
        <div style={{ fontSize: 9, color: 'var(--mc-muted)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          занят · {assignee?.first_name?.[0]}.{assignee?.last_name?.[0]}.
        </div>
      )}
    </div>
  );
}

/* ── WEEK VIEW ──────────────────────────────────────────────────────────────── */
function WeekCalendarView({ tasks, weekStart, ctx, mode, onSlotClick }) {
  const { db, currentUser, navigate } = ctx;
  const todayStr = todayISO();
  const nowY     = useNowY();
  const days     = Array.from({ length: 7 }, (_, i) => shiftDate(weekStart, i));

  const handleColClick = (e, dateStr) => {
    if (e.target !== e.currentTarget) return;
    if (!onSlotClick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const raw  = Math.floor((e.clientY - rect.top) / HOUR_PX) + CAL_START;
    const h    = Math.max(CAL_START, Math.min(CAL_END, raw));
    onSlotClick(dateStr, `${String(h).padStart(2, '0')}:00`);
  };

  return (
    <div className="bg-white rounded-xl overflow-x-auto" style={{ border: '1px solid var(--mc-border)' }}>
      {/* Шапка с днями */}
      <div style={{ display: 'grid', gridTemplateColumns: `48px repeat(7, minmax(80px, 1fr))`, borderBottom: '1px solid var(--mc-border)' }}>
        <div />
        {days.map(d => {
          const obj     = new Date(d + 'T00:00');
          const isToday = d === todayStr;
          return (
            <div key={d} style={{ padding: '8px 4px', textAlign: 'center', cursor: onSlotClick ? 'pointer' : 'default' }}
              onClick={() => onSlotClick && onSlotClick(d, null)}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--mc-muted)', letterSpacing: '.4px', textTransform: 'uppercase', marginBottom: 4 }}>
                {DAY_SHORT[obj.getDay()]}
              </div>
              <div style={{
                width: 32, height: 32, borderRadius: '50%', margin: '0 auto',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 700,
                background: isToday ? '#297b8a' : 'transparent',
                color: isToday ? 'white' : 'var(--mc-text)',
              }}>
                {obj.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Тело сетки */}
      <div style={{ display: 'grid', gridTemplateColumns: `48px repeat(7, minmax(80px, 1fr))`, height: TOTAL_H }}>
        {/* Метки часов */}
        <div style={{ position: 'relative' }}>
          {HOURS.map((h, i) => (
            <div key={h} style={{ position: 'absolute', top: i * HOUR_PX - 7, right: 6, fontSize: 10, fontWeight: 500, color: 'var(--mc-muted)', whiteSpace: 'nowrap' }}>
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>

        {/* Колонки дней */}
        {days.map(d => {
          const isToday  = d === todayStr;
          const dayTasks = tasks.filter(t => t.visit_date === d);
          const layout   = computeEventLayout(dayTasks);
          return (
            <div key={d}
              style={{ position: 'relative', borderLeft: '1px solid var(--mc-border-light)', background: isToday ? 'var(--mc-cal-today)' : 'transparent' }}
              onClick={e => handleColClick(e, d)}
            >
              <HourGrid />
              {isToday && <NowLine nowY={nowY} />}
              {layout.map(({ task: t, col, totalCols }) => (
                <EventCard key={t.id} task={t} db={db} currentUser={currentUser} mode={mode}
                  navigate={navigate} compact colIdx={col} totalCols={totalCols} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── MONTH VIEW ─────────────────────────────────────────────────────────────── */
function MonthCalendarView({ tasks, monthISO, ctx, onDayClick }) {
  const { db, navigate } = ctx;
  const todayStr  = todayISO();
  const [y, m]    = monthISO.split('-').map(Number);
  const firstDay  = new Date(y, m - 1, 1);
  const dow       = firstDay.getDay();
  const startOff  = dow === 0 ? -6 : 1 - dow;
  const gridDays  = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(y, m - 1, 1 + startOff + i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  return (
    <div className="bg-white rounded-xl overflow-hidden" style={{ border: '1px solid var(--mc-border)' }}>
      {/* Заголовки дней недели */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--mc-border)' }}>
        {['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d => (
          <div key={d} style={{ padding: '8px 4px', textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--mc-muted)' }}>{d}</div>
        ))}
      </div>

      {/* Ячейки дней */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {gridDays.map(d => {
          const inMonth  = d.startsWith(monthISO);
          const isToday  = d === todayStr;
          const dateNum  = parseInt(d.split('-')[2], 10);
          const allDayTasks  = tasks.filter(t => t.visit_date === d);
          const activeTasks  = allDayTasks.filter(t => t.status !== 'done');
          const doneTasks    = allDayTasks.filter(t => t.status === 'done');
          return (
            <div key={d}
              onClick={() => onDayClick(d)}
              className="transition-colors"
              style={{ minHeight: 80, padding: '4px 6px', borderRight: '1px solid var(--mc-border-light)', borderBottom: '1px solid var(--mc-border-light)', cursor: 'pointer', background: 'var(--mc-surface)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--mc-active-item)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--mc-surface)'; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>
                <div style={{
                  width: 24, height: 24, borderRadius: '50%',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 600, flexShrink: 0,
                  background: isToday ? '#297b8a' : 'transparent',
                  color: isToday ? 'white' : inMonth ? 'var(--mc-text)' : 'var(--mc-border)',
                }}>
                  {dateNum}
                </div>
                {doneTasks.length > 0 && (
                  <span style={{ fontSize: 10, lineHeight: 1 }} title={`${doneTasks.length} выполн.`}>✅</span>
                )}
              </div>
              {activeTasks.slice(0, 3).map(t => {
                const color = getUserTaskColor(t.assignee_id, db);
                const prefix = t.kind === 'tasting' ? '🍵' : t.kind === 'install' ? '⚙️' : '';
                return (
                  <div key={t.id}
                    onClick={e => { e.stopPropagation(); navigate({ name: 'task_detail', taskId: t.id }); }}
                    style={{
                      fontSize: 10, padding: '1px 5px', borderRadius: 3, marginBottom: 2,
                      background: color, color: 'white', overflow: 'hidden',
                      whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontWeight: 500,
                    }}>
                    {t.visit_time}{t.visit_time_end ? `–${t.visit_time_end}` : ''} {t.kind === 'internal' ? 'Внутр.' : `${prefix}${(t.client_name||'').split(' ')[0] || '—'}`}
                  </div>
                );
              })}
              {activeTasks.length > 3 && (
                <div style={{ fontSize: 10, color: 'var(--mc-muted)', padding: '0 2px' }}>+{activeTasks.length - 3} ещё</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── DAY VIEW ───────────────────────────────────────────────────────────────── */
function DayCalendarView({ tasks, date, ctx, mode, onSlotClick }) {
  const { db, currentUser, navigate } = ctx;
  const todayStr = todayISO();
  const isToday  = date === todayStr;
  const nowY     = useNowY();
  const dayTasks = tasks.filter(t => t.visit_date === date);

  const handleClick = e => {
    if (e.target !== e.currentTarget || !onSlotClick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const h = Math.max(CAL_START, Math.min(CAL_END, Math.floor((e.clientY - rect.top) / HOUR_PX) + CAL_START));
    onSlotClick(date, `${String(h).padStart(2, '0')}:00`);
  };

  return (
    <div className="bg-white rounded-xl overflow-hidden" style={{ border: '1px solid var(--mc-border)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '48px 1fr', height: TOTAL_H }}>
        {/* Метки часов */}
        <div style={{ position: 'relative' }}>
          {HOURS.map((h, i) => (
            <div key={h} style={{ position: 'absolute', top: i * HOUR_PX - 7, right: 6, fontSize: 10, fontWeight: 500, color: 'var(--mc-muted)', whiteSpace: 'nowrap' }}>
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>

        {/* Колонка событий */}
        <div style={{ position: 'relative', borderLeft: '1px solid var(--mc-border-light)' }} onClick={handleClick}>
          <HourGrid />
          {isToday && <NowLine nowY={nowY} />}
          {computeEventLayout(dayTasks).map(({ task: t, col, totalCols }) => {
            const top    = timeToY(t.visit_time || '09:00');
            const height = Math.max(40, (t.duration_min || 60) / 60 * HOUR_PX - 2);
            const color  = getUserTaskColor(t.assignee_id, db);
            const show   = canSeeTask(t, currentUser, mode);
            const assignee = db.users?.find(u => u.id === t.assignee_id);
            const colW   = 100 / totalCols;
            const leftPct = col * colW;
            const kindLabel = t.kind === 'internal' ? 'Внутренняя'
              : t.kind === 'install' ? `⚙️ ${t.client_name}`
              : t.kind === 'tasting' ? `🍵 ${t.client_name}`
              : t.client_name;
            return (
              <div key={t.id}
                onClick={e => { e.stopPropagation(); show && navigate({ name: 'task_detail', taskId: t.id }); }}
                style={{
                  position: 'absolute', top, height,
                  left:  `calc(${leftPct}% + 4px)`,
                  width: `calc(${colW}% - 8px)`,
                  background: show ? `${color}18` : 'var(--mc-border)',
                  borderLeft: `4px solid ${show ? color : 'var(--mc-muted)'}`,
                  borderRadius: 6, padding: '4px 8px', overflow: 'hidden',
                  cursor: show ? 'pointer' : 'default', zIndex: 2,
                  boxSizing: 'border-box',
                }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: show ? color : 'var(--mc-muted)' }}>
                  {t.visit_time}{t.visit_time_end ? `–${t.visit_time_end}` : ` · ${t.duration_min || 60} мин`}
                </div>
                {show ? (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--mc-text)', lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {kindLabel}
                    </div>
                    {height > 60 && (
                      <div style={{ fontSize: 11, color: 'var(--mc-muted)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                        {assignee ? `${assignee.first_name} ${assignee.last_name}` : ''}
                        {t.problem ? ` · ${t.problem.slice(0, 50)}` : ''}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--mc-muted)' }}>
                    занят · {assignee?.first_name?.[0]}.{assignee?.last_name?.[0]}.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── FIELD CALENDAR SCREEN (менеджер / calendar_all) ──────────────────────── */
export function FieldCalendarScreen({ ctx }) {
  const { db, currentUser, navigate } = ctx;
  const [view,       setView]       = useState('week');
  const [weekStart,  setWeekStart]  = useState(() => getMonday(todayISO()));
  const [selectedDay,setSelectedDay]= useState(() => todayISO());
  const [monthISO,   setMonthISO]   = useState(() => todayISO().substring(0, 7));
  const [filter,     setFilter]     = useState('all');

  const fieldUsers = db.users.filter(u => u.active && FIELD_ROLES.includes(u.role));

  const filteredTasks = (() => {
    if (filter === 'all')         return db.tasks;
    if (filter === 'barista')     return db.tasks.filter(t => db.users.find(u => u.id === t.assignee_id)?.role === 'barista');
    if (filter === 'technician')  return db.tasks.filter(t => db.users.find(u => u.id === t.assignee_id)?.role === 'technician');
    return db.tasks.filter(t => t.assignee_id === filter);
  })();

  const prev = () => {
    if (view === 'week')  setWeekStart(s => shiftDate(s, -7));
    if (view === 'month') setMonthISO(m => shiftMonth(m, -1));
    if (view === 'day')   setSelectedDay(d => shiftDate(d, -1));
  };
  const next = () => {
    if (view === 'week')  setWeekStart(s => shiftDate(s, 7));
    if (view === 'month') setMonthISO(m => shiftMonth(m, 1));
    if (view === 'day')   setSelectedDay(d => shiftDate(d, 1));
  };
  const toToday = () => {
    const t = todayISO();
    setWeekStart(getMonday(t));
    setSelectedDay(t);
    setMonthISO(t.substring(0, 7));
  };

  const navLabel = view === 'week'  ? fmtWeekRange(weekStart)
    : view === 'month' ? `${MON_FULL[parseInt(monthISO.split('-')[1], 10) - 1]} ${monthISO.split('-')[0]}`
    : fmtDayFull(selectedDay);

  // Клик по пустому слоту → создать задачу с prefill
  const handleSlotClick = (date, time) => {
    if (!time) { setSelectedDay(date); setView('day'); return; }
    ctx.setTaskDraft?.(d => ({ ...d, visit_date: date, visit_time: time }));
    navigate({ name: 'create_task' });
  };

  return (
    <div>
      <div className="mb-1">
        <h1 className="display-font text-xl font-bold" style={{ color: 'var(--mc-text)' }}>Календарь выездных</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--mc-muted)' }}>
          Свои поставленные и назначенные — с деталями. Чужие — только занятые слоты.
        </p>
      </div>

      <CalendarNavBar
        view={view} setView={setView} label={navLabel}
        onPrev={prev} onNext={next} onToday={toToday}
        onNew={() => navigate({ name: 'create_task' })}
      />

      {/* Фильтр по сотруднику — цвет чипа соответствует цвету задач исполнителя */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-4">
        {[
          { id: 'all',        label: 'Все сотрудники', color: '#297b8a' },
          { id: 'barista',    label: 'Бариста',        color: '#297b8a' },
          { id: 'technician', label: 'Техники',        color: '#297b8a' },
          ...fieldUsers.map(u => ({
            id:    u.id,
            label: `${u.first_name} ${u.last_name[0]}.`,
            color: getUserTaskColor(u.id, db),
          })),
        ].map(f => {
          const active = filter === f.id;
          return (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className="whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold"
              style={{
                background: active ? f.color : 'white',
                color:      active ? 'white' : 'var(--mc-muted)',
                border:     active ? `1px solid ${f.color}` : '1px solid var(--mc-border)',
              }}>
              {f.label}
            </button>
          );
        })}
      </div>

      {view === 'week' && (
        <WeekCalendarView tasks={filteredTasks} weekStart={weekStart} ctx={ctx} mode="auto" onSlotClick={handleSlotClick} />
      )}
      {view === 'month' && (
        <MonthCalendarView tasks={filteredTasks} monthISO={monthISO} ctx={ctx}
          onDayClick={d => { setSelectedDay(d); setView('day'); }} />
      )}
      {view === 'day' && (
        <DayCalendarView tasks={filteredTasks} date={selectedDay} ctx={ctx} mode="auto" onSlotClick={handleSlotClick} />
      )}
    </div>
  );
}

/* ── FIELD HOME (выездной сотрудник — свой календарь) ─────────────────────── */
export function FieldHome({ ctx }) {
  const { db, currentUser, navigate } = ctx;
  const [view,       setView]       = useState('week');
  const [weekStart,  setWeekStart]  = useState(() => getMonday(todayISO()));
  const [selectedDay,setSelectedDay]= useState(() => todayISO());
  const [filter,     setFilter]     = useState('all'); // 'all' | 'mine' | userId

  // Все задачи полевых сотрудников
  const fieldUserIds = new Set(
    (db.users || []).filter(u => u.active && FIELD_ROLES.includes(u.role)).map(u => u.id)
  );
  const allFieldTasks = db.tasks.filter(t => fieldUserIds.has(t.assignee_id));

  const filteredTasks = filter === 'all'  ? allFieldTasks
    : filter === 'mine' ? allFieldTasks.filter(t => t.assignee_id === currentUser.id)
    : allFieldTasks.filter(t => t.assignee_id === filter);

  const myTasks     = allFieldTasks.filter(t => t.assignee_id === currentUser.id);
  const unscheduled = myTasks.filter(t => !t.visit_date && t.status !== 'done');
  const todayCount  = myTasks.filter(t => t.visit_date === todayISO() && t.status !== 'done').length;

  // Коллеги — все активные полевые, кроме себя
  const colleagues = (db.users || [])
    .filter(u => u.active && FIELD_ROLES.includes(u.role) && u.id !== currentUser.id)
    .sort((a, b) => a.first_name.localeCompare(b.first_name));

  const prev = () => {
    if (view === 'week') setWeekStart(s => shiftDate(s, -7));
    else setSelectedDay(d => shiftDate(d, -1));
  };
  const next = () => {
    if (view === 'week') setWeekStart(s => shiftDate(s, 7));
    else setSelectedDay(d => shiftDate(d, 1));
  };
  const toToday = () => {
    const t = todayISO();
    setWeekStart(getMonday(t));
    setSelectedDay(t);
  };

  // Клик по слоту → создать задачу себе
  const handleSlotClick = (date, time) => {
    if (!time) { setSelectedDay(date); setView('day'); return; }
    ctx.setTaskDraft?.(d => ({ ...d, visit_date: date, visit_time: time, assignee_id: currentUser.id }));
    navigate({ name: 'create_task' });
  };

  const navLabel = view === 'week' ? fmtWeekRange(weekStart) : fmtDayFull(selectedDay);

  return (
    <div>
      <div className="mb-1">
        <h1 className="display-font text-xl font-bold" style={{ color: 'var(--mc-text)' }}>Мой календарь</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--mc-muted)' }}>
          {todayCount} задач сегодня
          {unscheduled.length > 0 ? ` · ${unscheduled.length} без времени` : ''}
        </p>
      </div>

      <CalendarNavBar
        view={view}
        setView={v => { if (v !== 'month') setView(v); }}
        label={navLabel}
        onPrev={prev} onNext={next} onToday={toToday}
        onNew={() => navigate({ name: 'create_task' })}
        hideMonth
      />

      {/* Фильтр по сотруднику */}
      {colleagues.length > 0 && (
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 12 }}>
          {[
            { id: 'all',  label: 'Все' },
            { id: 'mine', label: 'Мои' },
            ...colleagues.map(u => ({ id: u.id, label: `${u.first_name} ${u.last_name[0]}.`, color: getUserTaskColor(u.id, db) })),
          ].map(f => {
            const active = filter === f.id;
            const color  = f.color || '#297b8a';
            return (
              <button key={f.id} onClick={() => setFilter(f.id)}
                style={{ flexShrink: 0, padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  background: active ? color : 'var(--mc-surface)',
                  color:      active ? '#fff' : 'var(--mc-muted)',
                  border:     `1px solid ${active ? color : 'var(--mc-border)'}` }}>
                {f.label}
              </button>
            );
          })}
        </div>
      )}

      {view === 'week' && (
        <WeekCalendarView tasks={filteredTasks} weekStart={weekStart} ctx={ctx} mode="team" onSlotClick={handleSlotClick} />
      )}
      {view === 'day' && (
        <DayCalendarView tasks={filteredTasks} date={selectedDay} ctx={ctx} mode="team" onSlotClick={handleSlotClick} />
      )}

      {/* Тайл отчёта ОП */}
      <div className="mt-6">
        <SalesReportHomeTile ctx={ctx} />
      </div>

      {/* Задачи без времени */}
      {unscheduled.length > 0 && (
        <div className="mt-6">
          <h2 className="text-base font-bold mb-3" style={{ color: 'var(--mc-text)' }}>
            Без времени ({unscheduled.length})
          </h2>
          <div className="space-y-2">
            {unscheduled.map(t => (
              <button key={t.id}
                onClick={() => navigate({ name: 'task_detail', taskId: t.id })}
                className="w-full text-left bg-white rounded-xl p-3"
                style={{ border: '1px solid var(--mc-border)' }}>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-bold text-sm" style={{ color: '#3390EC' }}>{t.task_number}</span>
                  <span className="font-semibold text-sm truncate" style={{ color: 'var(--mc-text)' }}>
                    {t.kind === 'internal' ? 'Внутренняя задача' : t.kind === 'install' ? `⚙️ Установка — ${t.client_name}` : t.client_name}
                  </span>
                </div>
                {t.problem && (
                  <div className="text-xs truncate" style={{ color: 'var(--mc-muted)' }}>
                    {t.problem.slice(0, 70)}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
