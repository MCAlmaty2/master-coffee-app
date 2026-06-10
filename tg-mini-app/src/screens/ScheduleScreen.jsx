/**
 * ScheduleScreen.jsx — «Расписание / регулярные задачи»
 * Доступ: admin, director, senior_manager.
 *
 * Задачи: ежедневные, еженедельные, ежемесячные.
 * Хранение в Supabase: schedule_tasks + schedule_completions.
 * Синхронизация через SYNC_TABLES (scheduleTasks, scheduleCompletions).
 */
import React, { useState, useMemo } from 'react';
import {
  ChevronLeft, Plus, X, ChevronRight, Check, ExternalLink,
  Calendar, Clock, Trash2, Link2, AlertTriangle, Edit3, Eye,
} from 'lucide-react';
import { supabase } from '../supabase/client';

const SCHEDULE_ROLES = ['admin', 'director', 'senior_manager']; // fallback для target_role select
const FREQ = {
  daily:   { label: 'Ежедневно',   short: 'Ежедн.' },
  weekly:  { label: 'Еженедельно', short: 'Еженед.' },
  monthly: { label: 'Ежемесячно',  short: 'Ежемес.' },
};
const DOW_NAMES  = ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const DOW_SHORT  = ['', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ'];
const MONTHS_RU  = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const TASK_TYPES = {
  custom:  { label: 'Свои задачи',  color: '#D4537E', emoji: '🩷' },
  report:  { label: 'Отчёты',       color: '#7F77DD', emoji: '🟣' },
  ship:    { label: 'Отгрузка',     color: '#378ADD', emoji: '🔵' },
  coffee:  { label: 'Кофе',         color: '#1D9E75', emoji: '🟢' },
  ask:     { label: 'Уточнение',    color: '#BA7517', emoji: '🟡' },
  debt:    { label: 'Документы',    color: '#D85A30', emoji: '🟠' },
  fuel:    { label: 'Топливо',      color: '#EF9F27', emoji: '🟤' },
  salary:  { label: 'Зарплаты',    color: '#888780', emoji: '⚪' },
  monthly: { label: 'Ежемес. отчёт', color: '#1D9E75', emoji: '📊' },
};
const ROLE_LABELS = {
  admin: 'Админ', director: 'Директор', senior_manager: 'Ст. менеджер',
  b2b: 'B2B', sales: 'Продажи', warehouse: 'Склад', cashier: 'Кассир',
  barista: 'Бариста', technician: 'Техник', courier: 'Курьер',
};
/** Роли, у которых schedule_access по умолчанию (без записи в roleDefinitions) */
const DEFAULT_SCHEDULE_ROLES = ['director', 'senior_manager'];
const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID)
  ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
      const r = Math.random() * 16 | 0; return (ch === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function currentDow() { const d = new Date().getDay(); return d === 0 ? 7 : d; }
function currentDom() { return new Date().getDate(); }
function completionKey(task) {
  if (task.frequency === 'monthly') {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  return todayISO();
}
function isTaskForToday(task) {
  if (!task.active) return false;
  if (task.frequency === 'daily') return true;
  if (task.frequency === 'weekly') return task.day_of_week === currentDow();
  if (task.frequency === 'monthly') return task.day_of_month === currentDom();
  return false;
}

function isTaskForRole(task, role) { return task.target_role === role; }

/** Проверка: задача выполнена текущим пользователем? */
function checkCompleted(completions, task, userId) {
  const key = completionKey(task);
  return completions.some(c => c.task_id === task.id && c.completion_key === key && c.completed_by === userId);
}

/** Переключить статус выполнения задачи */
async function doToggle(completions, task, userId, setDb) {
  const key = completionKey(task);
  const existing = completions.find(c => c.task_id === task.id && c.completion_key === key && c.completed_by === userId);
  if (existing) {
    await supabase.from('schedule_completions').delete().eq('id', existing.id);
    setDb(d => ({ ...d, scheduleCompletions: (d.scheduleCompletions || []).filter(c => c.id !== existing.id) }));
  } else {
    const row = { id: uid(), task_id: task.id, completion_key: key, completed_by: userId, completed_at: new Date().toISOString() };
    await supabase.from('schedule_completions').upsert([row], { onConflict: 'id' });
    setDb(d => ({ ...d, scheduleCompletions: [...(d.scheduleCompletions || []), row] }));
  }
}

export function ScheduleScreen({ ctx }) {
  const { db, setDb, currentUser, goBack, showToast } = ctx;
  const role = currentUser?.role;
  const canAccess = ctx.hasPermission?.('schedule_access');

  if (!canAccess) {
    return (
      <div className="p-6">
        <PageHeader title="Нет доступа" onBack={goBack} />
        <p style={{ color: 'var(--mc-muted)' }}>У вас нет доступа к расписанию. Обратитесь к администратору.</p>
      </div>
    );
  }

  const [tab, setTab] = useState('today');
  const [createOpen, setCreateOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [viewingTask, setViewingTask] = useState(null);
  const allTasks = db.scheduleTasks || [];
  const allCompletions = db.scheduleCompletions || [];
  const myTasks = allTasks.filter(t => t.active && isTaskForRole(t, role));
  // Роли с доступом к расписанию — для выбора target_role (только admin видит)
  const scheduleRoles = useMemo(() => {
    const rs = new Set(['admin']);
    (db.roleDefinitions || []).forEach(rd => { if (rd.permissions?.includes('schedule_access')) rs.add(rd.key); });
    DEFAULT_SCHEDULE_ROLES.forEach(r => { if (!(db.roleDefinitions || []).some(rd => rd.key === r)) rs.add(r); });
    return [...rs];
  }, [db.roleDefinitions]);
  const todayTasks = myTasks.filter(isTaskForToday);
  const isCompleted = (task) => checkCompleted(allCompletions, task, currentUser.id);
  const toggleComplete = (task) => doToggle(allCompletions, task, currentUser.id, setDb);
  const deleteTask = async (taskId) => {
    await supabase.from('schedule_tasks').delete().eq('id', taskId);
    setDb(d => ({
      ...d,
      scheduleTasks: (d.scheduleTasks || []).filter(t => t.id !== taskId),
      scheduleCompletions: (d.scheduleCompletions || []).filter(c => c.task_id !== taskId),
    }));
    showToast('Задача удалена');
  };
  const weeklyTasks = myTasks.filter(t => t.frequency === 'weekly' || t.frequency === 'daily');
  const doneToday = todayTasks.filter(isCompleted).length;
  const totalToday = todayTasks.length;
  const pctToday = totalToday > 0 ? Math.round(doneToday / totalToday * 100) : 0;

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <PageHeader
        title="Расписание"
        subtitle={`${ROLE_LABELS[role]} · ${totalToday} задач на сегодня`}
        onBack={goBack}
        action={
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-white text-sm font-semibold"
            style={{ background: '#3390EC' }}
          >
            <Plus size={16} /> Добавить
          </button>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-5 overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        {[
          { key: 'today', label: `Сегодня${totalToday ? ` (${doneToday}/${totalToday})` : ''}` },
          { key: 'weekly', label: 'Неделя' },
          { key: 'monthly', label: 'Месяц' },
          { key: 'manage', label: 'Управление' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="px-3 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition"
            style={{
              background: tab === t.key ? '#3390EC' : 'var(--mc-active-item)',
              color: tab === t.key ? '#fff' : 'var(--mc-text)',
              border: '1px solid ' + (tab === t.key ? '#3390EC' : 'var(--mc-border)'),
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Прогресс на сегодня */}
      {tab === 'today' && totalToday > 0 && (
        <div className="mb-5">
          <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--mc-muted)' }}>
            <span>Выполнено {doneToday} из {totalToday}</span>
            <span>{pctToday}%</span>
          </div>
          <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'var(--mc-active-item)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${pctToday}%`, background: pctToday === 100 ? '#22C55E' : '#3390EC' }}
            />
          </div>
          {pctToday === 100 && (
            <div className="text-xs mt-1 font-semibold" style={{ color: '#22C55E' }}>
              Все задачи на сегодня выполнены!
            </div>
          )}
        </div>
      )}

      {/* Содержимое */}
      {tab === 'today' && (
        <TodayView tasks={todayTasks} isCompleted={isCompleted} onToggle={toggleComplete} onView={setViewingTask} />
      )}
      {tab === 'weekly' && (
        <WeekView tasks={weeklyTasks} completions={allCompletions} userId={currentUser.id} onToggle={toggleComplete} isCompleted={isCompleted} />
      )}
      {tab === 'monthly' && (
        <MonthView tasks={myTasks} completions={allCompletions} userId={currentUser.id} isCompleted={isCompleted} onToggle={toggleComplete} />
      )}
      {tab === 'manage' && (
        <ManageView tasks={myTasks} allTasks={allTasks} role={role} onDelete={deleteTask} onEdit={setEditingTask} isAdmin={role === 'admin'} scheduleRoles={scheduleRoles} db={db} />
      )}

      {/* Модал создания */}
      {createOpen && (
        <TaskFormModal
          role={role}
          isAdmin={role === 'admin'}
          scheduleRoles={scheduleRoles}
          db={db}
          onClose={() => setCreateOpen(false)}
          onSave={async (task) => {
            await supabase.from('schedule_tasks').upsert([task], { onConflict: 'id' });
            setDb(d => ({
              ...d,
              scheduleTasks: [...(d.scheduleTasks || []), task],
            }));
            setCreateOpen(false);
            showToast('Задача добавлена');
          }}
          currentUserId={currentUser.id}
        />
      )}

      {/* Модал просмотра задачи */}
      {viewingTask && (
        <TaskViewModal
          task={viewingTask}
          done={isCompleted(viewingTask)}
          onClose={() => setViewingTask(null)}
          onToggle={() => { toggleComplete(viewingTask); setViewingTask(null); }}
        />
      )}

      {/* Модал редактирования */}
      {editingTask && (
        <TaskFormModal
          role={role}
          isAdmin={role === 'admin'}
          scheduleRoles={scheduleRoles}
          db={db}
          editTask={editingTask}
          onClose={() => setEditingTask(null)}
          onSave={async (updated) => {
            await supabase.from('schedule_tasks').upsert([updated], { onConflict: 'id' });
            setDb(d => ({
              ...d,
              scheduleTasks: (d.scheduleTasks || []).map(t => t.id === updated.id ? updated : t),
            }));
            setEditingTask(null);
            showToast('Задача обновлена');
          }}
          currentUserId={currentUser.id}
        />
      )}
    </div>
  );
}

function PageHeader({ title, subtitle, action, onBack }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-6 flex-wrap">
      <div className="flex items-start gap-2 min-w-0 flex-1">
        {onBack && (
          <button onClick={onBack} className="p-1 -ml-1 mt-0.5" style={{ color: 'var(--mc-muted)' }}>
            <ChevronLeft size={22} />
          </button>
        )}
        <div className="min-w-0">
          <h1 className="display-font text-2xl sm:text-3xl leading-tight" style={{ color: 'var(--mc-text)' }}>{title}</h1>
          {subtitle && <div className="text-sm mt-1" style={{ color: 'var(--mc-muted)' }}>{subtitle}</div>}
        </div>
      </div>
      {action}
    </div>
  );
}

function TaskRow({ task, done, onToggle, onView }) {
  const tt = TASK_TYPES[task.task_type] || TASK_TYPES.custom;
  return (
    <div
      onClick={() => onView ? onView(task) : onToggle(task)}
      className="flex items-start gap-3 px-4 py-3 rounded-xl mb-2 cursor-pointer transition hover:shadow-sm"
      style={{
        background: done ? 'var(--mc-active-item)' : 'white',
        border: `1px solid ${done ? 'var(--mc-border)' : tt.color + '33'}`,
        borderLeft: `4px solid ${tt.color}`,
        opacity: done ? 0.7 : 1,
      }}
    >
      {/* Checkbox */}
      <div
        onClick={e => { e.stopPropagation(); onToggle(task); }}
        className="w-5 h-5 rounded-md flex-shrink-0 flex items-center justify-center mt-0.5"
        style={{
          background: done ? tt.color : 'transparent',
          border: done ? 'none' : `2px solid ${tt.color}`,
          cursor: 'pointer',
        }}
      >
        {done && <Check size={12} color="#fff" strokeWidth={3} />}
      </div>
      {/* Content */}
      <div className="flex-1 min-w-0">
        <div
          className="text-sm font-medium"
          style={{ color: 'var(--mc-text)', textDecoration: done ? 'line-through' : 'none' }}
        >
          {task.title}
        </div>
        {task.description && (
          <div className="text-xs mt-0.5" style={{ color: 'var(--mc-muted)' }}>{task.description}</div>
        )}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {task.time_at && (
            <span className="text-[10px] flex items-center gap-0.5" style={{ color: 'var(--mc-muted)' }}>
              <Clock size={10} /> {task.time_at}
            </span>
          )}
          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: tt.color + '1A', color: tt.color, fontWeight: 600 }}>
            {tt.label}
          </span>
        </div>
      </div>
      {/* Link */}
      {task.link_url && (
        <a
          href={task.link_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="flex-shrink-0 mt-1"
          style={{ color: '#3390EC' }}
        >
          <ExternalLink size={16} />
        </a>
      )}
    </div>
  );
}

function TodayView({ tasks, isCompleted, onToggle, onView }) {
  if (tasks.length === 0) {
    return (
      <div className="text-center py-12" style={{ color: 'var(--mc-muted)' }}>
        <Calendar size={40} className="mx-auto mb-3 opacity-40" />
        <div className="text-sm font-medium">На сегодня задач нет</div>
        <div className="text-xs mt-1">Добавьте регулярные задачи через кнопку «Добавить»</div>
      </div>
    );
  }

  const pending = tasks.filter(t => !isCompleted(t));
  const completed = tasks.filter(t => isCompleted(t));
  return (
    <div>
      {pending.length > 0 && (
        <div className="mb-4">
          <div className="text-xs font-bold uppercase mb-2" style={{ color: 'var(--mc-muted)', letterSpacing: '0.08em' }}>
            К выполнению ({pending.length})
          </div>
          {pending.map(t => <TaskRow key={t.id} task={t} done={false} onToggle={onToggle} onView={onView} />)}
        </div>
      )}
      {completed.length > 0 && (
        <div>
          <div className="text-xs font-bold uppercase mb-2" style={{ color: 'var(--mc-muted)', letterSpacing: '0.08em' }}>
            Выполнено ({completed.length})
          </div>
          {completed.map(t => <TaskRow key={t.id} task={t} done={true} onToggle={onToggle} onView={onView} />)}
        </div>
      )}
    </div>
  );
}

function WeekView({ tasks, completions, userId, onToggle, isCompleted }) {
  const todayDow = currentDow();
  const mon = new Date(); mon.setDate(mon.getDate() - (todayDow - 1));
  const days = useMemo(() => Array.from({ length: 5 }, (_, i) => {
    const d = new Date(mon); d.setDate(mon.getDate() + i);
    const dow = i + 1;
    return { dow, dt: `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}`,
      isToday: dow === todayDow,
      tasks: tasks.filter(t => t.frequency === 'daily' || (t.frequency === 'weekly' && t.day_of_week === dow)) };
  }), [tasks, todayDow]);
  const usedTypes = [...new Set(tasks.map(t => t.task_type).filter(Boolean))];
  return (
    <div>
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        {days.map(({ dow, dt, isToday, tasks: dayT }) => {
          const done = isToday ? dayT.filter(isCompleted).length : 0;
          const pct = dayT.length ? Math.round(done / dayT.length * 100) : 0;
          return (
            <div key={dow} className="rounded-xl overflow-hidden" style={{ background: 'white', border: '1px solid var(--mc-border)' }}>
              <div className="flex items-center gap-1 px-2.5 py-2" style={{ background: isToday ? '#EBF5FF' : 'transparent', borderBottom: '1px solid var(--mc-border)' }}>
                <span className="text-[11px] font-bold uppercase" style={{ color: isToday ? '#3390EC' : 'var(--mc-muted)', letterSpacing: '.06em' }}>{DOW_SHORT[dow]}</span>
                <span className="text-[11px]" style={{ color: isToday ? '#3390EC' : 'var(--mc-muted)', opacity: 0.7 }}>{dt}</span>
                {isToday && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#3390EC', color: '#fff' }}>сегодня</span>}
                {dayT.length > 0 && <span className="text-[11px] ml-auto" style={{ color: 'var(--mc-muted)' }}>{isToday ? `${done}/${dayT.length}` : dayT.length}</span>}
              </div>
              {isToday && dayT.length > 0 && (
                <div className="h-[3px]" style={{ background: 'var(--mc-border)' }}><div className="h-full transition-all" style={{ width: `${pct}%`, background: '#22C55E' }} /></div>
              )}
              <div className="p-1.5">
                {dayT.length === 0
                  ? <div className="text-[12px] px-1 py-1" style={{ color: 'var(--mc-muted)' }}>Нет задач</div>
                  : dayT.map((t, idx) => {
                      const tt = TASK_TYPES[t.task_type] || TASK_TYPES.custom;
                      const d = isToday && isCompleted(t);
                      return (
                        <div key={t.id} onClick={() => isToday && onToggle(t)} className="flex items-start gap-1.5 px-2 py-1.5 rounded-lg mb-1"
                          style={{ background: tt.color + '12', color: tt.color, opacity: d ? 0.38 : 1, cursor: isToday ? 'pointer' : 'default' }}>
                          <div className="w-[15px] h-[15px] rounded-[3px] flex-shrink-0 mt-0.5 flex items-center justify-center"
                            style={{ border: '1.5px solid currentColor', background: d ? 'currentColor' : 'transparent' }}>
                            {d && <Check size={9} color="#fff" strokeWidth={3} />}
                          </div>
                          <span className="text-[10px] opacity-55 mt-0.5 flex-shrink-0">{idx+1}.</span>
                          <div className="text-[12px] leading-snug flex-1" style={{ textDecoration: d ? 'line-through' : 'none' }}>
                            {t.link_url ? <a href={t.link_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ color: 'inherit', textDecoration: 'underline dotted' }}>{t.title}</a> : t.title}
                          </div>
                        </div>
                      );
                    })
                }
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2 mt-4">
        {usedTypes.map(k => { const v = TASK_TYPES[k] || TASK_TYPES.custom; return (
          <div key={k} className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--mc-muted)' }}>
            <div className="w-[11px] h-[11px] rounded-[3px]" style={{ background: v.color + '22', border: `1.5px solid ${v.color}` }} />{v.label}
          </div>
        ); })}
      </div>
    </div>
  );
}

function MonthView({ tasks, completions, userId, isCompleted, onToggle }) {
  const [calDate, setCalDate] = useState(() => new Date());
  const y = calDate.getFullYear(), m = calDate.getMonth();
  const today = new Date();
  const cells = useMemo(() => {
    const first = new Date(y, m, 1), sd = (first.getDay() || 7) - 1;
    const dim = new Date(y, m + 1, 0).getDate(), pdim = new Date(y, m, 0).getDate();
    return Array.from({ length: Math.ceil((sd + dim) / 7) * 7 }, (_, i) => {
      const dn = i - sd + 1;
      if (dn < 1 || dn > dim) return { num: dn < 1 ? pdim + dn : dn - dim, other: true };
      const date = new Date(y, m, dn), isT = date.toDateString() === today.toDateString();
      const dw = date.getDay() || 7;
      const wd = tasks.filter(t => t.frequency === 'daily' || (t.frequency === 'weekly' && t.day_of_week === dw));
      const ml = tasks.filter(t => t.frequency === 'monthly' && t.day_of_month === dn);
      return { num: dn, other: false, isT, wd, ml, allDone: isT && wd.length > 0 && wd.every(isCompleted), hasDl: ml.length > 0 };
    });
  }, [tasks, y, m, isCompleted]);
  const navMonth = (delta) => setCalDate(d => new Date(d.getFullYear(), d.getMonth() + delta, 1));
  const usedTypes = [...new Set(tasks.map(t => t.task_type).filter(Boolean))];
  return (
    <div>
      {/* Навигация по месяцам */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => navMonth(-1)} className="px-3 py-1.5 rounded-lg text-sm"
          style={{ border: '1px solid var(--mc-border)', background: 'white', color: 'var(--mc-text)' }}>←</button>
        <span className="text-base font-semibold" style={{ color: 'var(--mc-text)' }}>{MONTHS_RU[m]} {y}</span>
        <button onClick={() => navMonth(1)} className="px-3 py-1.5 rounded-lg text-sm"
          style={{ border: '1px solid var(--mc-border)', background: 'white', color: 'var(--mc-text)' }}>→</button>
      </div>
      {/* Дни недели */}
      <div className="grid grid-cols-7 gap-[3px] mb-[3px]">
        {['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d => (
          <div key={d} className="text-center text-[10px] font-semibold uppercase py-1" style={{ color: 'var(--mc-muted)', letterSpacing: '.04em' }}>{d}</div>
        ))}
      </div>
      {/* Сетка календаря */}
      <div className="grid grid-cols-7 gap-[3px]">
        {cells.map((c, i) => {
          if (c.other) return (
            <div key={i} className="min-h-[66px] rounded-lg p-1.5 opacity-30" style={{ background: 'var(--mc-active-item)', border: '1px solid var(--mc-border)' }}>
              <div className="text-[11px] font-semibold" style={{ color: 'var(--mc-muted)' }}>{c.num}</div>
            </div>
          );
          const bc = c.isT ? '#3390EC' : c.allDone ? '#22C55E' : c.hasDl ? '#D85A30' : 'var(--mc-border)';
          return (
            <div key={i} className="min-h-[66px] rounded-lg p-1.5" style={{ background: 'white', border: `${c.isT ? 2 : 1}px solid ${bc}` }}>
              <div className="text-[11px] font-semibold mb-0.5" style={{ color: c.isT ? '#3390EC' : c.hasDl ? '#D85A30' : 'var(--mc-muted)' }}>{c.num}</div>
              <div className="flex flex-wrap gap-[2px]">
                {c.wd.map(t => {
                  const tt = TASK_TYPES[t.task_type] || TASK_TYPES.custom;
                  const dn = c.isT && isCompleted(t);
                  return <div key={t.id} className="w-[6px] h-[6px] rounded-full" style={{ background: dn ? '#22C55E' : tt.color, opacity: dn ? 0.5 : 1 }} />;
                })}
              </div>
              {c.ml.length > 0 && <div className="text-[9px] mt-0.5 leading-tight" style={{ color: '#D85A30' }}>{c.ml.map(t => t.title.split(' ')[0]).join(', ')}</div>}
              {c.allDone && <div className="text-[9px] font-semibold mt-0.5" style={{ color: '#166534' }}>✓ готово</div>}
            </div>
          );
        })}
      </div>
      {/* Легенда */}
      <div className="flex flex-wrap gap-2 mt-4">
        {usedTypes.map(k => { const v = TASK_TYPES[k] || TASK_TYPES.custom; return (
          <div key={k} className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--mc-muted)' }}>
            <div className="w-[11px] h-[11px] rounded-[3px]" style={{ background: v.color + '22', border: `1.5px solid ${v.color}` }} />{v.label}
          </div>
        ); })}
      </div>
    </div>
  );
}

function ManageView({ tasks, allTasks, role, onDelete, onEdit, isAdmin, scheduleRoles, db }) {
  const [confirmId, setConfirmId] = useState(null);
  const [viewRole, setViewRole] = useState(role);
  const displayTasks = isAdmin
    ? allTasks.filter(t => t.target_role === viewRole)
    : tasks;

  const grouped = useMemo(() => {
    const g = { daily: [], weekly: [], monthly: [] };
    displayTasks.forEach(t => {
      if (g[t.frequency]) g[t.frequency].push(t);
    });
    // Сортировка
    g.weekly.sort((a, b) => (a.day_of_week || 0) - (b.day_of_week || 0));
    g.monthly.sort((a, b) => (a.day_of_month || 0) - (b.day_of_month || 0));
    return g;
  }, [displayTasks]);

  return (
    <div>
      {/* Переключатель ролей для админа */}
      {isAdmin && (
        <div className="flex gap-1 mb-4">
          {(scheduleRoles || SCHEDULE_ROLES).map(r => {
            const rdLabel = (db?.roleDefinitions || []).find(rd => rd.key === r)?.label;
            return (
            <button
              key={r}
              onClick={() => setViewRole(r)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition"
              style={{
                background: viewRole === r ? '#3390EC' : 'var(--mc-active-item)',
                color: viewRole === r ? '#fff' : 'var(--mc-text)',
                border: '1px solid ' + (viewRole === r ? '#3390EC' : 'var(--mc-border)'),
              }}
            >
              {rdLabel || ROLE_LABELS[r] || r}
            </button>
          ); })}
        </div>
      )}

      {['daily', 'weekly', 'monthly'].map(freq => (
        <div key={freq} className="mb-5">
          <div className="text-xs font-bold uppercase mb-2" style={{ color: 'var(--mc-muted)', letterSpacing: '0.08em' }}>
            {FREQ[freq].label} ({grouped[freq].length})
          </div>
          {grouped[freq].length === 0 && (
            <div className="text-xs pl-2" style={{ color: 'var(--mc-muted)' }}>Нет задач</div>
          )}
          {grouped[freq].map(t => {
            const tt = TASK_TYPES[t.task_type] || TASK_TYPES.custom;
            return (
              <div key={t.id} className="flex items-center gap-3 px-4 py-3 rounded-xl mb-2" style={{ background: 'white', border: '1px solid var(--mc-border)', borderLeft: `4px solid ${tt.color}` }}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium" style={{ color: 'var(--mc-text)' }}>{t.title}</div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {t.frequency === 'weekly' && t.day_of_week && (
                      <span className="text-[10px]" style={{ color: 'var(--mc-muted)' }}>{DOW_NAMES[t.day_of_week]}</span>
                    )}
                    {t.frequency === 'monthly' && t.day_of_month && (
                      <span className="text-[10px]" style={{ color: 'var(--mc-muted)' }}>до {t.day_of_month}-го</span>
                    )}
                    {t.time_at && (
                      <span className="text-[10px]" style={{ color: 'var(--mc-muted)' }}>{t.time_at}</span>
                    )}
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: tt.color + '1A', color: tt.color, fontWeight: 600 }}>
                      {tt.label}
                    </span>
                    {t.link_url && (
                      <a href={t.link_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-[10px] flex items-center gap-0.5" style={{ color: '#3390EC' }}>
                        <Link2 size={10} /> ссылка
                      </a>
                    )}
                  </div>
                </div>
                {confirmId === t.id ? (
                  <div className="flex items-center gap-1">
                    <button onClick={() => { onDelete(t.id); setConfirmId(null); }} className="px-2 py-1 rounded text-xs font-semibold text-white" style={{ background: '#DC2626' }}>Да</button>
                    <button onClick={() => setConfirmId(null)} className="px-2 py-1 rounded text-xs font-semibold" style={{ background: 'var(--mc-active-item)', color: 'var(--mc-text)' }}>Нет</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <button onClick={() => onEdit(t)} className="p-1.5 rounded-lg transition hover:bg-blue-50" style={{ color: '#3390EC' }}>
                      <Edit3 size={16} />
                    </button>
                    <button onClick={() => setConfirmId(t.id)} className="p-1.5 rounded-lg transition hover:bg-red-50" style={{ color: '#DC2626' }}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function TaskViewModal({ task, done, onClose, onToggle }) {
  const tt = TASK_TYPES[task.task_type] || TASK_TYPES.custom;
  const freqLabel = FREQ[task.frequency]?.label || task.frequency;
  const remindLabel = { 0: 'Без напоминания', 15: 'За 15 минут', 30: 'За 30 минут', 60: 'За 1 час', 1440: 'За 1 день' };
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden" style={{ background: 'var(--mc-bg)' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--mc-border)', borderLeft: `4px solid ${tt.color}` }}>
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 18 }}>{tt.emoji}</span>
            <h2 className="text-lg font-bold" style={{ color: 'var(--mc-text)' }}>{task.title}</h2>
          </div>
          <button onClick={onClose} className="p-1" style={{ color: 'var(--mc-muted)' }}><X size={20} /></button>
        </div>
        <div className="p-5 space-y-3">
          {task.description && (
            <div>
              <div className="text-xs font-semibold mb-1" style={{ color: 'var(--mc-muted)' }}>Описание</div>
              <div className="text-sm" style={{ color: 'var(--mc-text)' }}>{task.description}</div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs font-semibold mb-1" style={{ color: 'var(--mc-muted)' }}>Частота</div>
              <div className="text-sm" style={{ color: 'var(--mc-text)' }}>{freqLabel}</div>
            </div>
            <div>
              <div className="text-xs font-semibold mb-1" style={{ color: 'var(--mc-muted)' }}>Время</div>
              <div className="text-sm flex items-center gap-1" style={{ color: 'var(--mc-text)' }}>
                <Clock size={12} /> {task.time_at || '—'}
              </div>
            </div>
            {task.frequency === 'weekly' && task.day_of_week && (
              <div>
                <div className="text-xs font-semibold mb-1" style={{ color: 'var(--mc-muted)' }}>День недели</div>
                <div className="text-sm" style={{ color: 'var(--mc-text)' }}>{DOW_NAMES[task.day_of_week]}</div>
              </div>
            )}
            {task.frequency === 'monthly' && task.day_of_month && (
              <div>
                <div className="text-xs font-semibold mb-1" style={{ color: 'var(--mc-muted)' }}>Срок</div>
                <div className="text-sm" style={{ color: 'var(--mc-text)' }}>до {task.day_of_month}-го</div>
              </div>
            )}
            <div>
              <div className="text-xs font-semibold mb-1" style={{ color: 'var(--mc-muted)' }}>Тип</div>
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: tt.color + '1A', color: tt.color, fontWeight: 600 }}>
                {tt.emoji} {tt.label}
              </span>
            </div>
            <div>
              <div className="text-xs font-semibold mb-1" style={{ color: 'var(--mc-muted)' }}>Напоминание</div>
              <div className="text-sm" style={{ color: 'var(--mc-text)' }}>{remindLabel[task.remind_minutes] || 'Без напоминания'}</div>
            </div>
          </div>
          {task.link_url && (
            <div>
              <div className="text-xs font-semibold mb-1" style={{ color: 'var(--mc-muted)' }}>Ссылка</div>
              <a href={task.link_url} target="_blank" rel="noopener noreferrer" className="text-sm flex items-center gap-1" style={{ color: '#3390EC' }}>
                <ExternalLink size={14} /> {task.link_label || 'Открыть'}
              </a>
            </div>
          )}
          <div className="pt-2 flex items-center justify-between" style={{ borderTop: '1px solid var(--mc-border)' }}>
            <div className="text-xs font-semibold" style={{ color: done ? '#22C55E' : '#F59E0B' }}>
              {done ? '✅ Выполнено' : '⏳ Ожидает выполнения'}
            </div>
            <button
              onClick={onToggle}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
              style={{ background: done ? '#F59E0B' : '#22C55E' }}
            >
              {done ? 'Отменить' : 'Выполнить'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputCls = 'w-full px-3 py-2.5 rounded-lg text-sm';
const inputStyle = { border: '1px solid var(--mc-border)', background: 'white', color: 'var(--mc-text)' };
function FormField({ label, children }) {
  return <div><label className="block text-xs font-semibold mb-1" style={{ color: 'var(--mc-muted)' }}>{label}</label>{children}</div>;
}

function TaskFormModal({ role, isAdmin, scheduleRoles, db, onClose, onSave, currentUserId, editTask }) {
  const isEdit = !!editTask;
  const [form, setForm] = useState({
    title: editTask?.title || '',
    description: editTask?.description || '',
    frequency: editTask?.frequency || 'weekly',
    day_of_week: editTask?.day_of_week || currentDow(),
    day_of_month: editTask?.day_of_month || 5,
    time_at: editTask?.time_at || '09:00',
    task_type: editTask?.task_type || 'custom',
    link_url: editTask?.link_url || '',
    link_label: editTask?.link_label || '',
    target_role: editTask?.target_role || role,
    remind_minutes: editTask?.remind_minutes ?? 15,
    active: editTask?.active ?? true,
  });

  const update = (patch) => setForm(f => ({ ...f, ...patch }));
  const handleSave = () => {
    if (!form.title.trim()) return;
    const task = {
      id: isEdit ? editTask.id : uid(),
      title: form.title.trim(),
      description: form.description.trim(),
      frequency: form.frequency,
      day_of_week: form.frequency === 'weekly' ? form.day_of_week : null,
      day_of_month: form.frequency === 'monthly' ? form.day_of_month : null,
      time_at: form.time_at || '09:00',
      task_type: form.task_type,
      link_url: form.link_url.trim(),
      link_label: form.link_label.trim(),
      target_role: form.target_role,
      remind_minutes: form.remind_minutes,
      active: form.active,
      sort_order: editTask?.sort_order || 0,
      created_by: editTask?.created_by || currentUserId,
      created_at: editTask?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    onSave(task);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto" style={{ background: 'var(--mc-bg)' }}>
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--mc-border)', background: 'var(--mc-bg)' }}>
          <h2 className="text-lg font-bold" style={{ color: 'var(--mc-text)' }}>{isEdit ? 'Редактирование' : 'Новая задача'}</h2>
          <button onClick={onClose} className="p-1" style={{ color: 'var(--mc-muted)' }}><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4">
          <FormField label="Название *">
            <input value={form.title} onChange={e => update({ title: e.target.value })} placeholder="Например: Оформить заказ на кофе" className={inputCls} style={inputStyle} />
          </FormField>
          <FormField label="Описание">
            <textarea value={form.description} onChange={e => update({ description: e.target.value })} placeholder="Доп. информация..." rows={2} className={inputCls + ' resize-none'} style={inputStyle} />
          </FormField>
          {/* Частота */}
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--mc-muted)' }}>Частота</label>
            <div className="flex gap-1">
              {Object.entries(FREQ).map(([k, v]) => (
                <button
                  key={k}
                  onClick={() => update({ frequency: k })}
                  className="flex-1 px-2 py-2 rounded-lg text-xs font-semibold transition"
                  style={{
                    background: form.frequency === k ? '#3390EC' : 'var(--mc-active-item)',
                    color: form.frequency === k ? '#fff' : 'var(--mc-text)',
                    border: '1px solid ' + (form.frequency === k ? '#3390EC' : 'var(--mc-border)'),
                  }}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
          {form.frequency === 'weekly' && (
            <FormField label="День недели">
              <select value={form.day_of_week} onChange={e => update({ day_of_week: +e.target.value })} className={inputCls} style={inputStyle}>
                {[1, 2, 3, 4, 5, 6, 7].map(d => <option key={d} value={d}>{DOW_NAMES[d]}</option>)}
              </select>
            </FormField>
          )}
          {form.frequency === 'monthly' && (
            <FormField label="Срок — до какого числа">
              <select value={form.day_of_month} onChange={e => update({ day_of_month: +e.target.value })} className={inputCls} style={inputStyle}>
                {[1, 3, 5, 7, 10, 12, 15, 20, 25, 28, 30].map(d => <option key={d} value={d}>{d}-го</option>)}
              </select>
            </FormField>
          )}
          <FormField label="Время">
            <input type="time" value={form.time_at} onChange={e => update({ time_at: e.target.value })} className={inputCls} style={inputStyle} />
          </FormField>
          <FormField label="Тип / цвет">
            <select value={form.task_type} onChange={e => update({ task_type: e.target.value })} className={inputCls} style={inputStyle}>
              {Object.entries(TASK_TYPES).map(([k, v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}
            </select>
          </FormField>
          {isAdmin && (
            <FormField label="Для роли">
              <select value={form.target_role} onChange={e => update({ target_role: e.target.value })} className={inputCls} style={inputStyle}>
                {(scheduleRoles || SCHEDULE_ROLES).map(r => {
                  const rdLabel = (db?.roleDefinitions || []).find(rd => rd.key === r)?.label;
                  return <option key={r} value={r}>{rdLabel || ROLE_LABELS[r] || r}</option>;
                })}
              </select>
            </FormField>
          )}
          <FormField label="Ссылка (необязательно)">
            <input value={form.link_url} onChange={e => update({ link_url: e.target.value })} placeholder="https://docs.google.com/..." className={inputCls} style={inputStyle} />
          </FormField>
          <FormField label="Напоминание">
            <select value={form.remind_minutes} onChange={e => update({ remind_minutes: +e.target.value })} className={inputCls} style={inputStyle}>
              <option value={0}>Без напоминания</option>
              <option value={15}>За 15 минут</option>
              <option value={30}>За 30 минут</option>
              <option value={60}>За 1 час</option>
              <option value={1440}>За 1 день</option>
            </select>
          </FormField>
        </div>
        {/* Активность — только при редактировании */}
        {isEdit && (
          <div className="px-5 pb-2">
            <div className="flex items-center justify-between p-3 rounded-lg" style={{ background: 'var(--mc-active-item)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--mc-text)' }}>Задача активна</span>
              <button onClick={() => update({ active: !form.active })}
                className="w-11 h-6 rounded-full flex items-center px-0.5 transition-colors"
                style={{ background: form.active ? '#22C55E' : '#CBD5E1' }}>
                <div className="w-5 h-5 rounded-full bg-white shadow transition-transform"
                  style={{ transform: form.active ? 'translateX(20px)' : 'translateX(0)' }} />
              </button>
            </div>
          </div>
        )}
        {/* Кнопка сохранения */}
        <div className="px-5 pb-5">
          <button
            onClick={handleSave}
            disabled={!form.title.trim()}
            className="w-full py-3 rounded-xl text-white font-semibold text-sm transition"
            style={{
              background: form.title.trim() ? '#3390EC' : '#94A3B8',
              cursor: form.title.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            {isEdit ? 'Сохранить изменения' : 'Добавить задачу'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ScheduleHomeBanner({ ctx }) {
  const { db, setDb, currentUser, navigate, effectiveRole } = ctx;
  const role = effectiveRole || currentUser?.role;
  const [viewingTask, setViewingTask] = useState(null);

  if (!ctx.hasPermission?.('schedule_access')) return null;

  const allTasks = db.scheduleTasks || [];
  const allCompletions = db.scheduleCompletions || [];

  const myTodayTasks = allTasks.filter(
    t => t.active && isTaskForRole(t, role) && isTaskForToday(t)
  );

  if (myTodayTasks.length === 0 && !viewingTask) return null;

  const isCompleted = (task) => checkCompleted(allCompletions, task, currentUser.id);
  const toggleComplete = (task) => doToggle(allCompletions, task, currentUser.id, setDb);
  const pending = myTodayTasks.filter(t => !isCompleted(t));
  const completed = myTodayTasks.filter(t => isCompleted(t));
  const allDone = pending.length === 0;

  return (
    <>
      <div
        className="rounded-xl mb-5 overflow-hidden"
        style={{
          border: allDone ? '1px solid #BBF7D0' : '1px solid #FDE68A',
          background: allDone ? '#F0FDF4' : '#FFFBEB',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="text-lg">{allDone ? '✅' : '🔔'}</div>
            <div>
              <div className="text-sm font-bold" style={{ color: allDone ? '#166534' : '#92400E' }}>
                {allDone ? 'ВСЕ ЗАДАЧИ ВЫПОЛНЕНЫ' : 'НЕ ЗАБУДЬ ВЫПОЛНИТЬ'}
              </div>
              <div className="text-[10px]" style={{ color: allDone ? '#15803D' : '#B45309' }}>
                {allDone
                  ? `${completed.length} задач на сегодня — молодец!`
                  : `${pending.length} из ${myTodayTasks.length} осталось`
                }
              </div>
            </div>
          </div>
          <button
            onClick={() => navigate({ name: 'schedule' })}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: allDone ? '#22C55E' : '#F59E0B', color: '#fff' }}
          >
            Открыть
          </button>
        </div>

        {/* Задачи (показываем первые 5 невыполненных) */}
        {pending.length > 0 && (
          <div className="px-4 pb-3 space-y-1.5">
            {pending.slice(0, 5).map(t => {
              const tt = TASK_TYPES[t.task_type] || TASK_TYPES.custom;
              return (
                <div
                  key={t.id}
                  onClick={() => setViewingTask(t)}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition"
                  style={{ background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(0,0,0,0.06)' }}
                >
                  <div
                    onClick={e => { e.stopPropagation(); toggleComplete(t); }}
                    className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center"
                    style={{ border: `2px solid ${tt.color}`, cursor: 'pointer' }}
                  />
                  <div className="flex-1 min-w-0 text-xs font-medium truncate" style={{ color: 'var(--mc-text)' }}>
                    {t.title}
                  </div>
                  {t.time_at && (
                    <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--mc-muted)' }}>{t.time_at}</span>
                  )}
                  {t.link_url && (
                    <a href={t.link_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="flex-shrink-0" style={{ color: '#3390EC' }}>
                      <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              );
            })}
            {pending.length > 5 && (
              <div className="text-[10px] text-center pt-1" style={{ color: '#B45309' }}>
                и ещё {pending.length - 5}...
              </div>
            )}
          </div>
        )}
      </div>

      {viewingTask && (
        <TaskViewModal
          task={viewingTask}
          done={isCompleted(viewingTask)}
          onClose={() => setViewingTask(null)}
          onToggle={() => { toggleComplete(viewingTask); setViewingTask(null); }}
        />
      )}
    </>
  );
}
