import React, { useState, useMemo } from 'react';
import {
  ChevronLeft, ChevronRight, Plus, Check, CheckCircle2,
  Clock, MapPin, Calendar, ListTodo, Sparkles, Trash2, X,
} from 'lucide-react';

const TZ = 'Asia/Almaty';
const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

const DAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const DAY_NAMES_FULL = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
const MONTH_NAMES_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

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
  const [editTask, setEditTask] = useState(null);

  const coffeeUsers = useMemo(() =>
    (db.users || []).filter(u => u.active && COFFEE_ROLES.includes(u.role)),
  [db.users]);

  const allAssignees = useMemo(() => {
    const isAdmin = currentUser.role === 'admin' || currentUser.role === 'director';
    if (isAdmin) return coffeeUsers;
    return coffeeUsers.filter(u => u.id === currentUser.id);
  }, [coffeeUsers, currentUser]);

  const dayTasks = useMemo(() =>
    (db.coffeeTasks || [])
      .filter(t => t.date === selectedDate)
      .sort((a, b) => (a.time_start || '99:99').localeCompare(b.time_start || '99:99')),
  [db.coffeeTasks, selectedDate]);

  const grouped = useMemo(() => {
    const map = {};
    dayTasks.forEach(t => {
      const key = t.assignee_id || '_unassigned';
      if (!map[key]) map[key] = [];
      map[key].push(t);
    });
    return map;
  }, [dayTasks]);

  const weekDays = useMemo(() => getWeekDays(selectedDate), [selectedDate]);
  const today = todayISO();
  const doneCount = dayTasks.filter(t => t.status === 'done').length;
  const totalCount = dayTasks.length;

  const toggleDone = (taskId) => {
    setDb(d => ({
      ...d,
      coffeeTasks: (d.coffeeTasks || []).map(t => {
        if (t.id !== taskId) return t;
        const isDone = t.status === 'done';
        return {
          ...t,
          status: isDone ? 'pending' : 'done',
          completed_at: isDone ? null : new Date().toISOString(),
        };
      }),
    }));
  };

  const deleteTask = (taskId) => {
    setDb(d => ({
      ...d,
      coffeeTasks: (d.coffeeTasks || []).filter(t => t.id !== taskId),
    }));
    showToast('Задача удалена');
  };

  const saveTask = (task) => {
    if (editTask) {
      setDb(d => ({
        ...d,
        coffeeTasks: (d.coffeeTasks || []).map(t =>
          t.id === editTask.id ? { ...t, ...task } : t
        ),
      }));
      showToast('Задача обновлена');
    } else {
      const newTask = {
        id: crypto.randomUUID(),
        ...task,
        status: 'pending',
        created_by: currentUser.id,
        created_at: new Date().toISOString(),
      };
      setDb(d => ({
        ...d,
        coffeeTasks: [...(d.coffeeTasks || []), newTask],
      }));
      showToast('Задача добавлена');
    }
    setShowAdd(false);
    setEditTask(null);
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
        const date = week[t.day - 1] || selectedDate;
        tasks.push({
          id: crypto.randomUUID(),
          title: t.title,
          category: t.category,
          assignee_id: assigneeId,
          date,
          status: 'pending',
          created_by: currentUser.id,
          created_at: new Date().toISOString(),
        });
      });
    } else {
      tpl.monthly.forEach(t => {
        tasks.push({
          id: crypto.randomUUID(),
          title: t.title,
          category: t.category,
          assignee_id: assigneeId,
          date: selectedDate,
          status: 'pending',
          created_by: currentUser.id,
          created_at: new Date().toISOString(),
        });
      });
    }

    setDb(d => ({
      ...d,
      coffeeTasks: [...(d.coffeeTasks || []), ...tasks],
    }));
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
    const tpl = TWI_TEMPLATES[u.role];
    return tpl?.label || u.role;
  };

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
          <button onClick={() => setSelectedDate(d => addDays(d, -1))} className="p-1.5 rounded-lg" style={{ background: 'var(--mc-active-item)' }}>
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => setSelectedDate(today)}
            className="px-3 py-1 rounded-lg text-xs font-semibold"
            style={{ background: selectedDate === today ? '#297b8a' : 'var(--mc-active-item)', color: selectedDate === today ? 'white' : 'var(--mc-text)' }}
          >
            Сегодня
          </button>
          <button onClick={() => setSelectedDate(d => addDays(d, 1))} className="p-1.5 rounded-lg" style={{ background: 'var(--mc-active-item)' }}>
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Week strip */}
        <div className="grid grid-cols-7 gap-1">
          {weekDays.map(day => {
            const d = new Date(day + 'T12:00:00');
            const isSelected = day === selectedDate;
            const isToday = day === today;
            const hasTasks = (db.coffeeTasks || []).some(t => t.date === day);
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

        {Object.entries(grouped).map(([assigneeId, tasks]) => (
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
              <div className="ml-auto text-xs font-semibold" style={{ color: tasks.every(t => t.status === 'done') ? '#22C55E' : 'var(--mc-muted)' }}>
                {tasks.filter(t => t.status === 'done').length}/{tasks.length}
              </div>
            </div>

            <div className="space-y-1.5">
              {tasks.map((task, idx) => (
                <div key={task.id} className="flex items-start gap-2 py-1.5 group">
                  <button
                    onClick={() => toggleDone(task.id)}
                    className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center"
                    style={{
                      background: task.status === 'done' ? '#22C55E' : 'transparent',
                      border: task.status === 'done' ? 'none' : '2px solid var(--mc-border)',
                    }}
                  >
                    {task.status === 'done' && <Check size={12} color="white" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-1.5">
                      <span
                        className="text-sm"
                        style={{
                          color: task.status === 'done' ? 'var(--mc-muted)' : 'var(--mc-text)',
                          textDecoration: task.status === 'done' ? 'line-through' : 'none',
                        }}
                      >
                        <span className="font-semibold mr-1" style={{ color: 'var(--mc-muted)' }}>{idx + 1}.</span>
                        {task.time_start && (
                          <span className="text-xs mr-1" style={{ color: '#297b8a' }}>
                            {task.time_start}{task.time_end ? `–${task.time_end}` : ''}
                          </span>
                        )}
                        {task.title}
                      </span>
                    </div>
                    {task.location && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <MapPin size={10} style={{ color: 'var(--mc-muted)' }} />
                        <span className="text-[11px]" style={{ color: 'var(--mc-muted)' }}>{task.location}</span>
                      </div>
                    )}
                    {task.category && (
                      <span className="inline-block text-[10px] mt-0.5 px-1.5 py-0.5 rounded-full font-medium"
                        style={{ background: (CATEGORY_COLORS[task.category] || '#64748B') + '20', color: CATEGORY_COLORS[task.category] || '#64748B' }}>
                        {task.category}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100" style={{ transition: 'opacity 0.15s' }}>
                    <button onClick={() => { setEditTask(task); setShowAdd(true); }} className="p-1 rounded" style={{ color: 'var(--mc-muted)' }}>
                      <Calendar size={12} />
                    </button>
                    <button onClick={() => deleteTask(task.id)} className="p-1 rounded" style={{ color: '#EB5757' }}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* FAB buttons */}
      <div className="fixed bottom-6 right-4 flex flex-col gap-2 z-30">
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

      {/* Add/Edit modal */}
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

      {/* TWI modal */}
      {showTwi && (
        <TwiModal
          coffeeUsers={coffeeUsers}
          onGenerate={generateTwi}
          onClose={() => setShowTwi(false)}
        />
      )}
    </div>
  );
}

function AddTaskModal({ task, selectedDate, assignees, currentUser, onSave, onClose }) {
  const [form, setForm] = useState({
    title: task?.title || '',
    time_start: task?.time_start || '',
    time_end: task?.time_end || '',
    location: task?.location || '',
    description: task?.description || '',
    category: task?.category || '',
    assignee_id: task?.assignee_id || (assignees.length === 1 ? assignees[0].id : currentUser.id),
    date: task?.date || selectedDate,
  });

  const upd = (patch) => setForm(f => ({ ...f, ...patch }));

  const submit = () => {
    if (!form.title.trim()) return;
    onSave(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="w-full max-w-lg rounded-t-2xl p-5 max-h-[85vh] overflow-y-auto" style={{ background: 'var(--mc-card)' }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold" style={{ color: 'var(--mc-text)' }}>{task ? 'Редактировать' : 'Новая задача'}</h2>
          <button onClick={onClose} className="p-1"><X size={20} style={{ color: 'var(--mc-muted)' }} /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>Задача *</label>
            <input value={form.title} onChange={e => upd({ title: e.target.value })}
              className="w-full px-3 py-2.5 rounded-lg outline-none text-sm"
              style={{ border: '1px solid var(--mc-border)', background: 'var(--mc-bg)', color: 'var(--mc-text)' }}
              placeholder="Что нужно сделать?" />
          </div>

          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>Исполнитель</label>
            <select value={form.assignee_id} onChange={e => upd({ assignee_id: e.target.value })}
              className="w-full px-3 py-2.5 rounded-lg outline-none text-sm"
              style={{ border: '1px solid var(--mc-border)', background: 'var(--mc-bg)', color: 'var(--mc-text)' }}>
              {assignees.map(u => (
                <option key={u.id} value={u.id}>{u.first_name} {u.last_name || ''}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>Дата</label>
            <input type="date" value={form.date} onChange={e => upd({ date: e.target.value })}
              className="w-full px-3 py-2.5 rounded-lg outline-none text-sm"
              style={{ border: '1px solid var(--mc-border)', background: 'var(--mc-bg)', color: 'var(--mc-text)' }} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>С</label>
              <input type="time" value={form.time_start} onChange={e => upd({ time_start: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg outline-none text-sm"
                style={{ border: '1px solid var(--mc-border)', background: 'var(--mc-bg)', color: 'var(--mc-text)' }} />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>До</label>
              <input type="time" value={form.time_end} onChange={e => upd({ time_end: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg outline-none text-sm"
                style={{ border: '1px solid var(--mc-border)', background: 'var(--mc-bg)', color: 'var(--mc-text)' }} />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>Локация</label>
            <input value={form.location} onChange={e => upd({ location: e.target.value })}
              className="w-full px-3 py-2.5 rounded-lg outline-none text-sm"
              style={{ border: '1px solid var(--mc-border)', background: 'var(--mc-bg)', color: 'var(--mc-text)' }}
              placeholder="Точка / адрес" />
          </div>
        </div>

        <button onClick={submit}
          className="w-full mt-4 py-3 rounded-xl font-semibold text-white"
          style={{ background: form.title.trim() ? '#297b8a' : '#A8A8AE' }}>
          {task ? 'Сохранить' : 'Добавить задачу'}
        </button>
      </div>
    </div>
  );
}

function TwiModal({ coffeeUsers, onGenerate, onClose }) {
  const [selectedRole, setSelectedRole] = useState('');
  const [period, setPeriod] = useState('weekly');

  const roles = Object.entries(TWI_TEMPLATES).filter(([key]) =>
    coffeeUsers.some(u => u.role === key) || true
  );

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

export default CoffeeTasksScreen;
