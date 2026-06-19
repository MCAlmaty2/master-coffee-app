import React, { useState, useMemo } from 'react';
import {
  ChevronLeft, ChevronRight, Plus, Check,
  MapPin, ListTodo, Sparkles, Trash2, X,
  Repeat, Clock, Link, ExternalLink,
} from 'lucide-react';
import { deleteRow } from '../supabase/sync';
import { supabase } from '../supabase/client';

const TZ = 'Asia/Almaty';
const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

const DAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const DAY_NAMES_FULL = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
const DOW_NAMES = ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const MONTH_NAMES_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

const FREQ = {
  daily:   { label: 'Ежедневно',   short: 'Ежедн.' },
  weekly:  { label: 'Еженедельно', short: 'Еженед.' },
  monthly: { label: 'Ежемесячно',  short: 'Ежемес.' },
};

function fmtDateRu(iso) {
  const d = new Date(iso + 'T00:00:00');
  return `${DAY_NAMES_FULL[d.getDay()]}, ${d.getDate()} ${MONTH_NAMES_GEN[d.getMonth()]} ${d.getFullYear()}`;
}

function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function getWeekDays(iso) {
  const d = new Date(iso + 'T12:00:00');
  const dow = d.getDay();
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((dow + 6) % 7));
  const days = [];
  for (let i = 0; i < 7; i++) {
    const cur = new Date(mon);
    cur.setDate(mon.getDate() + i);
    days.push(cur.toISOString().slice(0, 10));
  }
  return days;
}

function uid() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
        const r = Math.random() * 16 | 0;
        return (ch === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
}

function isScheduleForDate(task, iso) {
  if (!task.active) return false;
  const d = new Date(iso + 'T12:00:00');
  const dow = d.getDay() === 0 ? 7 : d.getDay();
  const dom = d.getDate();
  if (task.frequency === 'daily') return true;
  if (task.frequency === 'weekly') return task.day_of_week === dow;
  if (task.frequency === 'monthly') return task.day_of_month === dom;
  return false;
}

function scheduleCompletionKey(task, iso) {
  if (task.frequency === 'monthly') return iso.slice(0, 7);
  return iso;
}

const COFFEE_ROLES = ['coffee_manager', 'deputy_coffee_manager', 'chef_barista', 'chef_cook'];

const TWI_TEMPLATES = {
  coffee_manager: {
    label: 'Управляющий кофейнями',
    weekly: [
      { title: 'Обход точек: проверка открытия/закрытия', category: 'operations', day: 1 },
      { title: 'Контроль выручки и план/факт по точкам', category: 'finance', day: 1 },
      { title: 'Проверка чистоты и порядка на точках', category: 'quality', day: 2 },
      { title: 'Встреча с управляющими точек', category: 'management', day: 3 },
      { title: 'Контроль графиков персонала', category: 'hr', day: 3 },
      { title: 'Проверка запасов и инвентаризация', category: 'supply', day: 4 },
      { title: 'Анализ отзывов клиентов', category: 'quality', day: 5 },
    ],
    monthly: [
      { title: 'Отчёт по финансовым показателям', category: 'finance' },
      { title: 'Оценка персонала / аттестация', category: 'hr' },
      { title: 'План развития на следующий месяц', category: 'planning' },
      { title: 'Анализ себестоимости', category: 'finance' },
    ],
  },
  deputy_coffee_manager: {
    label: 'Зам. управляющего кофеен',
    weekly: [
      { title: 'Обход точек: контроль работы персонала', category: 'operations', day: 1 },
      { title: 'Контроль чистоты и санитарных норм', category: 'quality', day: 2 },
      { title: 'Сверка кассы и отчётность по точкам', category: 'finance', day: 2 },
      { title: 'Контроль наличия расходников', category: 'supply', day: 3 },
      { title: 'Координация ремонтных работ', category: 'equipment', day: 4 },
      { title: 'Обратная связь от персонала', category: 'hr', day: 5 },
    ],
    monthly: [
      { title: 'Инвентаризация по точкам', category: 'supply' },
      { title: 'Отчёт управляющему по итогам месяца', category: 'reporting' },
      { title: 'Проверка трудовой дисциплины', category: 'hr' },
    ],
  },
  chef_barista: {
    label: 'Шеф-Бариста Алматы',
    weekly: [
      { title: 'Контроль качества кофе на точках', category: 'quality', day: 1 },
      { title: 'Проверка настройки кофемашин и помола', category: 'equipment', day: 1 },
      { title: 'Обучение / наставничество бариста', category: 'training', day: 2 },
      { title: 'Дегустация, калибровка вкуса', category: 'quality', day: 3 },
      { title: 'Проверка стандартов приготовления напитков', category: 'standards', day: 4 },
    ],
    monthly: [
      { title: 'Аттестация бариста', category: 'hr' },
      { title: 'Разработка сезонного меню напитков', category: 'menu' },
      { title: 'Тех. обслуживание оборудования', category: 'equipment' },
      { title: 'Отчёт по качеству и стандартам', category: 'reporting' },
    ],
  },
  chef_cook: {
    label: 'Шеф-повар',
    weekly: [
      { title: 'Контроль качества блюд на точках', category: 'quality', day: 1 },
      { title: 'Проверка стандартов производства', category: 'standards', day: 2 },
      { title: 'Обучение поваров', category: 'training', day: 3 },
      { title: 'Контроль себестоимости блюд', category: 'finance', day: 4 },
      { title: 'Проверка условий хранения', category: 'quality', day: 5 },
    ],
    monthly: [
      { title: 'Ревизия меню', category: 'menu' },
      { title: 'Аттестация поваров', category: 'hr' },
      { title: 'Калькуляция новых позиций', category: 'menu' },
      { title: 'Отчёт по себестоимости и потерям', category: 'reporting' },
    ],
  },
};

const CATEGORY_COLORS = {
  operations: '#3390EC', finance: '#10B981', quality: '#F59E0B', management: '#8B5CF6',
  hr: '#EC4899', supply: '#0891B2', training: '#6366F1', equipment: '#D97706',
  standards: '#0EA5E9', menu: '#A855F7', reporting: '#64748B', planning: '#14B8A6',
};

function CoffeeTasksScreen({ ctx }) {
  const { db, setDb, currentUser, goBack, showToast } = ctx;
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [showAdd, setShowAdd] = useState(false);
  const [showTwi, setShowTwi] = useState(false);
  const [showScheduleAdd, setShowScheduleAdd] = useState(false);
  const [showScheduleManage, setShowScheduleManage] = useState(false);
  const [editTask, setEditTask] = useState(null);

  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'director';

  const coffeeUsers = useMemo(() =>
    (db.users || []).filter(u => u.active && COFFEE_ROLES.includes(u.role)),
  [db.users]);

  const allAssignees = useMemo(() => {
    if (isAdmin) return coffeeUsers;
    return coffeeUsers.filter(u => u.id === currentUser.id);
  }, [coffeeUsers, currentUser, isAdmin]);

  // --- Одноразовые задачи ---
  const dayTasks = useMemo(() =>
    (db.coffeeTasks || [])
      .filter(t => t.date === selectedDate)
      .sort((a, b) => (a.time_start || '99:99').localeCompare(b.time_start || '99:99')),
  [db.coffeeTasks, selectedDate]);

  // --- Регулярные задачи (из scheduleTasks для кофейных ролей) ---
  const coffeeScheduleTasks = useMemo(() =>
    (db.scheduleTasks || []).filter(t =>
      t.active && COFFEE_ROLES.includes(t.target_role) && isScheduleForDate(t, selectedDate)
    ),
  [db.scheduleTasks, selectedDate]);

  const allCoffeeSchedule = useMemo(() =>
    (db.scheduleTasks || []).filter(t => COFFEE_ROLES.includes(t.target_role)),
  [db.scheduleTasks]);

  const scheduleCompletions = db.scheduleCompletions || [];

  const isScheduleDone = (task) => {
    const key = scheduleCompletionKey(task, selectedDate);
    return scheduleCompletions.some(c =>
      c.task_id === task.id && c.completion_key === key
    );
  };

  const toggleScheduleDone = async (task) => {
    const key = scheduleCompletionKey(task, selectedDate);
    const existing = scheduleCompletions.find(c =>
      c.task_id === task.id && c.completion_key === key
    );
    if (existing) {
      await supabase.from('schedule_completions').delete().eq('id', existing.id);
      setDb(d => ({ ...d, scheduleCompletions: (d.scheduleCompletions || []).filter(c => c.id !== existing.id) }));
    } else {
      const row = {
        id: uid(), task_id: task.id, completion_key: key,
        completed_by: currentUser.id, completed_at: new Date().toISOString(),
      };
      await supabase.from('schedule_completions').upsert([row], { onConflict: 'id' });
      setDb(d => ({ ...d, scheduleCompletions: [...(d.scheduleCompletions || []), row] }));
    }
  };

  // --- Объединённый список для подсчёта ---
  const combinedItems = useMemo(() => {
    const items = [];
    dayTasks.forEach(t => items.push({ type: 'once', task: t, done: t.status === 'done', assigneeId: t.assignee_id }));
    coffeeScheduleTasks.forEach(t => {
      if (t.target_user_id) {
        items.push({ type: 'schedule', task: t, done: isScheduleDone(t), assigneeId: t.target_user_id });
      } else {
        const matchingUsers = coffeeUsers.filter(u => u.role === t.target_role);
        if (matchingUsers.length > 0) {
          matchingUsers.forEach(u => {
            items.push({ type: 'schedule', task: t, done: isScheduleDone(t), assigneeId: u.id });
          });
        } else {
          items.push({ type: 'schedule', task: t, done: isScheduleDone(t), assigneeId: '_schedule' });
        }
      }
    });
    return items;
  }, [dayTasks, coffeeScheduleTasks, scheduleCompletions, coffeeUsers]);

  const grouped = useMemo(() => {
    const map = {};
    combinedItems.forEach(item => {
      const key = item.assigneeId || '_unassigned';
      if (!map[key]) map[key] = [];
      map[key].push(item);
    });
    return map;
  }, [combinedItems]);

  const weekDays = useMemo(() => getWeekDays(selectedDate), [selectedDate]);
  const today = todayISO();
  const doneCount = combinedItems.filter(i => i.done).length;
  const totalCount = combinedItems.length;

  const toggleDone = (taskId) => {
    setDb(d => ({
      ...d,
      coffeeTasks: (d.coffeeTasks || []).map(t => {
        if (t.id !== taskId) return t;
        const isDone = t.status === 'done';
        return { ...t, status: isDone ? 'pending' : 'done', completed_at: isDone ? null : new Date().toISOString() };
      }),
    }));
  };

  const deleteTask = (taskId) => {
    deleteRow('coffeeTasks', taskId).catch(() => {});
    setDb(d => ({ ...d, coffeeTasks: (d.coffeeTasks || []).filter(t => t.id !== taskId) }));
    showToast('Задача удалена');
  };

  const deleteScheduleTask = async (taskId) => {
    await supabase.from('schedule_tasks').delete().eq('id', taskId);
    setDb(d => ({
      ...d,
      scheduleTasks: (d.scheduleTasks || []).filter(t => t.id !== taskId),
      scheduleCompletions: (d.scheduleCompletions || []).filter(c => c.task_id !== taskId),
    }));
    showToast('Регулярная задача удалена');
  };

  const saveTask = (task) => {
    if (editTask) {
      setDb(d => ({
        ...d,
        coffeeTasks: (d.coffeeTasks || []).map(t => t.id === editTask.id ? { ...t, ...task } : t),
      }));
      showToast('Задача обновлена');
    } else {
      const newTask = { id: uid(), ...task, status: 'pending', created_by: currentUser.id, created_at: new Date().toISOString() };
      setDb(d => ({ ...d, coffeeTasks: [...(d.coffeeTasks || []), newTask] }));
      showToast('Задача добавлена');
    }
    setShowAdd(false);
    setEditTask(null);
  };

  const saveScheduleTask = async (form) => {
    const task = {
      id: uid(),
      title: form.title.trim(),
      description: form.description?.trim() || '',
      frequency: form.frequency,
      day_of_week: form.frequency === 'weekly' ? form.day_of_week : null,
      day_of_month: form.frequency === 'monthly' ? form.day_of_month : null,
      once_date: null,
      time_at: form.time_at || null,
      task_type: 'custom',
      link_url: form.link_url?.trim() || '',
      link_label: form.link_label?.trim() || '',
      target_role: form.target_role,
      target_user_id: form.target_user_id || null,
      remind_minutes: 0,
      active: true,
      sort_order: 0,
      created_by: currentUser.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await supabase.from('schedule_tasks').upsert([task], { onConflict: 'id' });
    setDb(d => ({ ...d, scheduleTasks: [...(d.scheduleTasks || []), task] }));
    setShowScheduleAdd(false);
    showToast('Регулярная задача создана');
  };

  const generateTwi = (roleKey, period) => {
    const tpl = TWI_TEMPLATES[roleKey];
    if (!tpl) return;
    const assignee = coffeeUsers.find(u => u.role === roleKey);
    const assigneeId = assignee?.id || currentUser.id;
    const tasks = [];
    if (period === 'weekly') {
      const week = getWeekDays(selectedDate);
      tpl.weekly.forEach(t => {
        tasks.push({
          id: uid(), title: t.title, category: t.category,
          assignee_id: assigneeId, date: week[t.day - 1] || selectedDate,
          status: 'pending', created_by: currentUser.id, created_at: new Date().toISOString(),
        });
      });
    } else {
      tpl.monthly.forEach(t => {
        tasks.push({
          id: uid(), title: t.title, category: t.category,
          assignee_id: assigneeId, date: selectedDate,
          status: 'pending', created_by: currentUser.id, created_at: new Date().toISOString(),
        });
      });
    }
    setDb(d => ({ ...d, coffeeTasks: [...(d.coffeeTasks || []), ...tasks] }));
    setShowTwi(false);
    showToast(`Создано ${tasks.length} задач из TWI-шаблона`);
  };

  const userName = (id) => {
    const u = (db.users || []).find(x => x.id === id);
    return u ? `${u.first_name} ${u.last_name || ''}`.trim() : 'Без назначения';
  };

  const userRole = (id) => {
    const u = (db.users || []).find(x => x.id === id);
    if (!u) return '';
    return TWI_TEMPLATES[u.role]?.label || u.role;
  };

  const hasScheduleTasks = (day) =>
    (db.scheduleTasks || []).some(t => COFFEE_ROLES.includes(t.target_role) && isScheduleForDate(t, day));

  return (
    <div className="min-h-screen" style={{ background: 'var(--mc-bg)' }}>
      {/* Header */}
      <div className="sticky top-0 z-20 px-4 pt-4 pb-2" style={{ background: 'var(--mc-bg)' }}>
        <div className="flex items-center gap-3 mb-3">
          <button onClick={goBack} className="p-1.5 rounded-lg" style={{ background: 'var(--mc-active-item)' }}>
            <ChevronLeft size={20} style={{ color: 'var(--mc-text)' }} />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold" style={{ color: 'var(--mc-text)' }}>Задачник кофеен</h1>
            <div className="text-xs" style={{ color: 'var(--mc-muted)' }}>{fmtDateRu(selectedDate)}</div>
          </div>
          {totalCount > 0 && (
            <div className="text-right">
              <div className="text-lg font-bold" style={{ color: doneCount === totalCount ? '#22C55E' : 'var(--mc-text)' }}>
                {doneCount}/{totalCount}
              </div>
              <div className="text-[10px]" style={{ color: 'var(--mc-muted)' }}>выполнено</div>
            </div>
          )}
        </div>

        {/* Date nav */}
        <div className="flex items-center gap-2 mb-2">
          <button onClick={() => setSelectedDate(d => addDays(d, -7))} className="p-1.5 rounded-lg" style={{ background: 'var(--mc-active-item)' }}>
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => setSelectedDate(today)}
            className="px-3 py-1 rounded-lg text-xs font-semibold"
            style={{ background: selectedDate === today ? '#297b8a' : 'var(--mc-active-item)', color: selectedDate === today ? 'white' : 'var(--mc-text)' }}
          >
            Сегодня
          </button>
          <button onClick={() => setSelectedDate(d => addDays(d, 7))} className="p-1.5 rounded-lg" style={{ background: 'var(--mc-active-item)' }}>
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Week strip */}
        <div className="grid grid-cols-7 gap-1">
          {weekDays.map(day => {
            const d = new Date(day + 'T12:00:00');
            const isSelected = day === selectedDate;
            const isToday = day === today;
            const hasTasks = (db.coffeeTasks || []).some(t => t.date === day) || hasScheduleTasks(day);
            return (
              <button
                key={day}
                onClick={() => setSelectedDate(day)}
                className="flex flex-col items-center py-1.5 rounded-lg text-xs"
                style={{
                  background: isSelected ? '#297b8a' : isToday ? 'var(--mc-active-item)' : 'transparent',
                  color: isSelected ? 'white' : 'var(--mc-text)',
                }}
              >
                <span className="font-semibold">{DAY_NAMES[d.getDay()]}</span>
                <span className={isSelected ? 'font-bold' : ''}>{d.getDate()}</span>
                {hasTasks && !isSelected && <div className="w-1 h-1 rounded-full mt-0.5" style={{ background: '#297b8a' }} />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Task list */}
      <div className="px-4 pb-24 space-y-4 mt-2">
        {totalCount === 0 && (
          <div className="text-center py-12" style={{ color: 'var(--mc-muted)' }}>
            <ListTodo size={40} className="mx-auto mb-3 opacity-30" />
            <div className="text-sm font-semibold">Нет задач на этот день</div>
            <div className="text-xs mt-1">Добавьте задачу или сгенерируйте из TWI-шаблона</div>
          </div>
        )}

        {Object.entries(grouped).map(([assigneeId, items]) => (
          <div key={assigneeId} className="rounded-xl p-3" style={{ background: 'var(--mc-card)', border: '1px solid var(--mc-border)' }}>
            <div className="flex items-center gap-2 mb-2 pb-2" style={{ borderBottom: '1px solid var(--mc-border)' }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white"
                style={{ background: '#297b8a' }}>
                {userName(assigneeId).charAt(0)}
              </div>
              <div>
                <div className="text-sm font-bold" style={{ color: 'var(--mc-text)' }}>{userName(assigneeId)}</div>
                <div className="text-[10px]" style={{ color: 'var(--mc-muted)' }}>{userRole(assigneeId)}</div>
              </div>
              <div className="ml-auto text-xs font-semibold" style={{ color: items.every(i => i.done) ? '#22C55E' : 'var(--mc-muted)' }}>
                {items.filter(i => i.done).length}/{items.length}
              </div>
            </div>

            <div className="space-y-1.5">
              {items.map((item, idx) => (
                <TaskRow
                  key={item.task.id + (item.type === 'schedule' ? '_s' : '')}
                  item={item}
                  idx={idx}
                  onToggle={item.type === 'once' ? () => toggleDone(item.task.id) : () => toggleScheduleDone(item.task)}
                  onEdit={item.type === 'once' ? () => { setEditTask(item.task); setShowAdd(true); } : null}
                  onDelete={item.type === 'once' ? () => deleteTask(item.task.id) : null}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* FAB buttons */}
      <div className="fixed bottom-6 right-4 flex flex-col gap-2 z-30">
        {isAdmin && (
          <button
            onClick={() => setShowScheduleManage(true)}
            className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg"
            style={{ background: '#0891B2', color: 'white' }}
            title="Регулярные задачи"
          >
            <Repeat size={18} />
          </button>
        )}
        <button
          onClick={() => setShowTwi(true)}
          className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg"
          style={{ background: '#8B5CF6', color: 'white' }}
        >
          <Sparkles size={20} />
        </button>
        <button
          onClick={() => { setEditTask(null); setShowAdd(true); }}
          className="w-14 h-14 rounded-full flex items-center justify-center shadow-lg"
          style={{ background: '#297b8a', color: 'white' }}
        >
          <Plus size={24} />
        </button>
      </div>

      {showAdd && (
        <AddTaskModal
          task={editTask}
          selectedDate={selectedDate}
          assignees={allAssignees.length > 0 ? allAssignees : coffeeUsers}
          currentUser={currentUser}
          onSave={saveTask}
          onClose={() => { setShowAdd(false); setEditTask(null); }}
        />
      )}

      {showTwi && (
        <TwiModal coffeeUsers={coffeeUsers} onGenerate={generateTwi} onClose={() => setShowTwi(false)} />
      )}

      {showScheduleAdd && (
        <ScheduleTaskModal
          coffeeUsers={coffeeUsers}
          onSave={saveScheduleTask}
          onClose={() => setShowScheduleAdd(false)}
        />
      )}

      {showScheduleManage && (
        <ScheduleManageModal
          tasks={allCoffeeSchedule}
          db={db}
          onDelete={deleteScheduleTask}
          onAdd={() => { setShowScheduleManage(false); setShowScheduleAdd(true); }}
          onClose={() => setShowScheduleManage(false)}
        />
      )}
    </div>
  );
}

/* ── Строка задачи ── */
function TaskRow({ item, idx, onToggle, onEdit, onDelete }) {
  const { task, done, type } = item;
  return (
    <div className="flex items-start gap-2 py-1.5 group">
      <button
        onClick={onToggle}
        className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center"
        style={{
          background: done ? '#22C55E' : 'transparent',
          border: done ? 'none' : '2px solid var(--mc-border)',
        }}
      >
        {done && <Check size={12} color="white" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-1.5">
          <span
            className="text-sm"
            style={{
              color: done ? 'var(--mc-muted)' : 'var(--mc-text)',
              textDecoration: done ? 'line-through' : 'none',
            }}
          >
            <span className="font-semibold mr-1" style={{ color: 'var(--mc-muted)' }}>{idx + 1}.</span>
            {type === 'once' && task.time_start && (
              <span className="text-xs mr-1" style={{ color: '#297b8a' }}>
                {task.time_start}{task.time_end ? `–${task.time_end}` : ''}
              </span>
            )}
            {type === 'schedule' && task.time_at && (
              <span className="text-xs mr-1" style={{ color: '#0891B2' }}>{task.time_at}</span>
            )}
            {task.title}
          </span>
        </div>
        {task.description && (
          <div className="text-xs mt-0.5" style={{ color: 'var(--mc-muted)' }}>{task.description}</div>
        )}
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {task.location && (
            <span className="flex items-center gap-0.5 text-[11px]" style={{ color: 'var(--mc-muted)' }}>
              <MapPin size={10} /> {task.location}
            </span>
          )}
          {task.link_url && (
            <a href={task.link_url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-[11px]"
              style={{ color: '#0891B2' }}
              onClick={e => e.stopPropagation()}>
              <ExternalLink size={10} /> {task.link_label || 'Ссылка'}
            </a>
          )}
          {type === 'schedule' && (
            <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ background: '#0891B220', color: '#0891B2' }}>
              <Repeat size={8} /> {FREQ[task.frequency]?.short || task.frequency}
            </span>
          )}
          {task.category && (
            <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ background: (CATEGORY_COLORS[task.category] || '#64748B') + '20', color: CATEGORY_COLORS[task.category] || '#64748B' }}>
              {task.category}
            </span>
          )}
        </div>
      </div>
      {(onEdit || onDelete) && (
        <div className="flex gap-1 flex-shrink-0">
          {onEdit && (
            <button onClick={onEdit} className="p-1 rounded" style={{ color: 'var(--mc-muted)' }}>
              <Clock size={12} />
            </button>
          )}
          {onDelete && (
            <button onClick={onDelete} className="p-1 rounded" style={{ color: '#EB5757' }}>
              <Trash2 size={12} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Модалка добавления одноразовой задачи ── */
function AddTaskModal({ task, selectedDate, assignees, currentUser, onSave, onClose }) {
  const [form, setForm] = useState({
    title: task?.title || '',
    time_start: task?.time_start || '',
    time_end: task?.time_end || '',
    location: task?.location || '',
    category: task?.category || '',
    assignee_id: task?.assignee_id || (assignees.length === 1 ? assignees[0].id : currentUser.id),
    date: task?.date || selectedDate,
  });

  const upd = (patch) => setForm(f => ({ ...f, ...patch }));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="w-full max-w-lg rounded-t-2xl p-5 max-h-[85vh] overflow-y-auto" style={{ background: 'var(--mc-card)' }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold" style={{ color: 'var(--mc-text)' }}>{task ? 'Редактировать' : 'Новая задача'}</h2>
          <button onClick={onClose} className="p-1"><X size={20} style={{ color: 'var(--mc-muted)' }} /></button>
        </div>
        <div className="space-y-3">
          <Field label="Задача *">
            <input value={form.title} onChange={e => upd({ title: e.target.value })}
              className="w-full px-3 py-2.5 rounded-lg outline-none text-sm"
              style={inputStyle} placeholder="Что нужно сделать?" />
          </Field>
          <Field label="Исполнитель">
            <select value={form.assignee_id} onChange={e => upd({ assignee_id: e.target.value })}
              className="w-full px-3 py-2.5 rounded-lg outline-none text-sm" style={inputStyle}>
              {assignees.map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name || ''}</option>)}
            </select>
          </Field>
          <Field label="Дата">
            <input type="date" value={form.date} onChange={e => upd({ date: e.target.value })}
              className="w-full px-3 py-2.5 rounded-lg outline-none text-sm" style={inputStyle} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="С">
              <input type="time" value={form.time_start} onChange={e => upd({ time_start: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg outline-none text-sm" style={inputStyle} />
            </Field>
            <Field label="До">
              <input type="time" value={form.time_end} onChange={e => upd({ time_end: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg outline-none text-sm" style={inputStyle} />
            </Field>
          </div>
          <Field label="Локация">
            <input value={form.location} onChange={e => upd({ location: e.target.value })}
              className="w-full px-3 py-2.5 rounded-lg outline-none text-sm"
              style={inputStyle} placeholder="Точка / адрес" />
          </Field>
        </div>
        <button onClick={() => form.title.trim() && onSave(form)}
          className="w-full mt-4 py-3 rounded-xl font-semibold text-white"
          style={{ background: form.title.trim() ? '#297b8a' : '#A8A8AE' }}>
          {task ? 'Сохранить' : 'Добавить задачу'}
        </button>
      </div>
    </div>
  );
}

/* ── Модалка создания регулярной задачи ── */
function ScheduleTaskModal({ coffeeUsers, onSave, onClose }) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    frequency: 'daily',
    day_of_week: 1,
    day_of_month: 1,
    time_at: '09:00',
    target_role: coffeeUsers[0]?.role || 'coffee_manager',
    target_user_id: '',
    link_url: '',
    link_label: '',
  });
  const upd = (patch) => setForm(f => ({ ...f, ...patch }));

  const usersForRole = coffeeUsers.filter(u => u.role === form.target_role);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="w-full max-w-lg rounded-t-2xl p-5 max-h-[85vh] overflow-y-auto" style={{ background: 'var(--mc-card)' }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Repeat size={18} style={{ color: '#0891B2' }} />
            <h2 className="text-base font-bold" style={{ color: 'var(--mc-text)' }}>Новая регулярная задача</h2>
          </div>
          <button onClick={onClose} className="p-1"><X size={20} style={{ color: 'var(--mc-muted)' }} /></button>
        </div>
        <div className="space-y-3">
          <Field label="Задача *">
            <input value={form.title} onChange={e => upd({ title: e.target.value })}
              className="w-full px-3 py-2.5 rounded-lg outline-none text-sm"
              style={inputStyle} placeholder="Название задачи" />
          </Field>
          <Field label="Описание">
            <textarea value={form.description} onChange={e => upd({ description: e.target.value })}
              className="w-full px-3 py-2.5 rounded-lg outline-none text-sm resize-none"
              style={inputStyle} placeholder="Подробности задачи (необязательно)" rows={2} />
          </Field>
          <Field label="Для роли">
            <select value={form.target_role}
              onChange={e => upd({ target_role: e.target.value, target_user_id: '' })}
              className="w-full px-3 py-2.5 rounded-lg outline-none text-sm" style={inputStyle}>
              {COFFEE_ROLES.map(r => (
                <option key={r} value={r}>{TWI_TEMPLATES[r]?.label || r}</option>
              ))}
            </select>
          </Field>
          {usersForRole.length > 0 && (
            <Field label="Конкретный сотрудник">
              <select value={form.target_user_id}
                onChange={e => upd({ target_user_id: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg outline-none text-sm" style={inputStyle}>
                <option value="">Все с этой ролью</option>
                {usersForRole.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </Field>
          )}
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>Частота</label>
            <div className="grid grid-cols-3 gap-1">
              {Object.entries(FREQ).map(([k, v]) => (
                <button key={k} onClick={() => upd({ frequency: k })}
                  className="px-2 py-2 rounded-lg text-xs font-semibold"
                  style={{
                    background: form.frequency === k ? '#0891B2' : 'var(--mc-active-item)',
                    color: form.frequency === k ? 'white' : 'var(--mc-text)',
                  }}>
                  {v.label}
                </button>
              ))}
            </div>
          </div>
          {form.frequency === 'weekly' && (
            <Field label="День недели">
              <select value={form.day_of_week} onChange={e => upd({ day_of_week: +e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg outline-none text-sm" style={inputStyle}>
                {[1, 2, 3, 4, 5, 6, 7].map(d => <option key={d} value={d}>{DOW_NAMES[d]}</option>)}
              </select>
            </Field>
          )}
          {form.frequency === 'monthly' && (
            <Field label="Число месяца">
              <select value={form.day_of_month} onChange={e => upd({ day_of_month: +e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg outline-none text-sm" style={inputStyle}>
                {Array.from({ length: 28 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
          )}
          <Field label="Время">
            <input type="time" value={form.time_at} onChange={e => upd({ time_at: e.target.value })}
              className="w-full px-3 py-2.5 rounded-lg outline-none text-sm" style={inputStyle} />
          </Field>
          <Field label="Ссылка (необязательно)">
            <div className="flex gap-2">
              <input value={form.link_url} onChange={e => upd({ link_url: e.target.value })}
                className="flex-1 px-3 py-2.5 rounded-lg outline-none text-sm"
                style={inputStyle} placeholder="https://..." />
              <input value={form.link_label} onChange={e => upd({ link_label: e.target.value })}
                className="w-24 px-3 py-2.5 rounded-lg outline-none text-sm"
                style={inputStyle} placeholder="Текст" />
            </div>
          </Field>
        </div>
        <button onClick={() => form.title.trim() && onSave(form)}
          className="w-full mt-4 py-3 rounded-xl font-semibold text-white"
          style={{ background: form.title.trim() ? '#0891B2' : '#A8A8AE' }}>
          Создать
        </button>
      </div>
    </div>
  );
}

/* ── Управление регулярными задачами ── */
function ScheduleManageModal({ tasks, db, onDelete, onAdd, onClose }) {
  const roleLabel = (role) => TWI_TEMPLATES[role]?.label || role;
  const freqLabel = (f) => FREQ[f]?.short || f;
  const dayLabel = (task) => {
    if (task.frequency === 'weekly') return DOW_NAMES[task.day_of_week] || '';
    if (task.frequency === 'monthly') return `${task.day_of_month}-го`;
    return '';
  };
  const userName = (userId) => {
    const u = (db.users || []).find(u => u.id === userId);
    return u ? (u.name || u.username || 'Без имени') : null;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="w-full max-w-lg rounded-t-2xl p-5 max-h-[85vh] overflow-y-auto" style={{ background: 'var(--mc-card)' }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Repeat size={18} style={{ color: '#0891B2' }} />
            <h2 className="text-base font-bold" style={{ color: 'var(--mc-text)' }}>Регулярные задачи</h2>
          </div>
          <button onClick={onClose} className="p-1"><X size={20} style={{ color: 'var(--mc-muted)' }} /></button>
        </div>

        {tasks.length === 0 && (
          <div className="text-center py-8" style={{ color: 'var(--mc-muted)' }}>
            <Repeat size={32} className="mx-auto mb-2 opacity-30" />
            <div className="text-sm">Нет регулярных задач</div>
          </div>
        )}

        <div className="space-y-2 mb-4">
          {tasks.map(t => (
            <div key={t.id} className="flex items-start gap-2 p-2.5 rounded-lg" style={{ background: 'var(--mc-bg)', border: '1px solid var(--mc-border)' }}>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate" style={{ color: 'var(--mc-text)' }}>{t.title}</div>
                {t.description && (
                  <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--mc-muted)' }}>{t.description}</div>
                )}
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                    style={{ background: '#0891B220', color: '#0891B2' }}>
                    {freqLabel(t.frequency)} {dayLabel(t)}
                  </span>
                  {t.time_at && <span className="text-[10px]" style={{ color: 'var(--mc-muted)' }}>{t.time_at}</span>}
                  <span className="text-[10px]" style={{ color: 'var(--mc-muted)' }}>
                    {t.target_user_id ? (userName(t.target_user_id) || roleLabel(t.target_role)) : roleLabel(t.target_role)}
                  </span>
                  {t.link_url && (
                    <a href={t.link_url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 text-[10px]"
                      style={{ color: '#0891B2' }}
                      onClick={e => e.stopPropagation()}>
                      <ExternalLink size={9} /> {t.link_label || 'Ссылка'}
                    </a>
                  )}
                </div>
              </div>
              <button onClick={() => onDelete(t.id)} className="p-1.5 rounded flex-shrink-0" style={{ color: '#EB5757' }}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <button onClick={onAdd}
          className="w-full py-3 rounded-xl font-semibold text-white flex items-center justify-center gap-2"
          style={{ background: '#0891B2' }}>
          <Plus size={16} /> Добавить регулярную задачу
        </button>
      </div>
    </div>
  );
}

/* ── TWI модалка ── */
function TwiModal({ coffeeUsers, onGenerate, onClose }) {
  const [selectedRole, setSelectedRole] = useState('');
  const [period, setPeriod] = useState('weekly');
  const roles = Object.entries(TWI_TEMPLATES);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="w-full max-w-lg rounded-t-2xl p-5" style={{ background: 'var(--mc-card)' }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles size={18} style={{ color: '#8B5CF6' }} />
            <h2 className="text-base font-bold" style={{ color: 'var(--mc-text)' }}>TWI-шаблоны</h2>
          </div>
          <button onClick={onClose} className="p-1"><X size={20} style={{ color: 'var(--mc-muted)' }} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>Роль</label>
            <div className="space-y-2">
              {roles.map(([key, tpl]) => (
                <button key={key} onClick={() => setSelectedRole(key)}
                  className="w-full text-left px-3 py-2.5 rounded-lg text-sm font-semibold"
                  style={{
                    background: selectedRole === key ? '#297b8a' : 'var(--mc-active-item)',
                    color: selectedRole === key ? 'white' : 'var(--mc-text)',
                  }}>
                  {tpl.label}
                </button>
              ))}
            </div>
          </div>
          {selectedRole && (
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>Период</label>
              <div className="grid grid-cols-2 gap-2">
                {[{ v: 'weekly', l: 'На неделю' }, { v: 'monthly', l: 'На месяц' }].map(o => (
                  <button key={o.v} onClick={() => setPeriod(o.v)}
                    className="px-3 py-2.5 rounded-lg text-sm font-semibold"
                    style={{
                      background: period === o.v ? '#297b8a' : 'var(--mc-active-item)',
                      color: period === o.v ? 'white' : 'var(--mc-text)',
                    }}>
                    {o.l}
                  </button>
                ))}
              </div>
              <div className="mt-2 text-xs" style={{ color: 'var(--mc-muted)' }}>
                {period === 'weekly'
                  ? `${TWI_TEMPLATES[selectedRole].weekly.length} задач будут распределены по дням текущей недели`
                  : `${TWI_TEMPLATES[selectedRole].monthly.length} задач будут добавлены на выбранную дату`
                }
              </div>
            </div>
          )}
        </div>
        <button
          onClick={() => selectedRole && onGenerate(selectedRole, period)}
          className="w-full mt-4 py-3 rounded-xl font-semibold text-white"
          style={{ background: selectedRole ? '#8B5CF6' : '#A8A8AE' }}>
          Сгенерировать задачи
        </button>
      </div>
    </div>
  );
}

/* ── Утилиты UI ── */
const inputStyle = { border: '1px solid var(--mc-border)', background: 'var(--mc-bg)', color: 'var(--mc-text)' };

function Field({ label, children }) {
  return (
    <div>
      <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>{label}</label>
      {children}
    </div>
  );
}

export default CoffeeTasksScreen;
