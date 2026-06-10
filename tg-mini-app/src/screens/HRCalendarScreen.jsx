import React, { useState, useMemo } from 'react';
import {
  ChevronLeft, ChevronRight, Plus, X, Check, Trash2,
  Palmtree, Cake, Edit3, Users,
} from 'lucide-react';
import { supabase } from '../supabase/client';

const MONTH_NAMES = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь',
];
const DAY_NAMES = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function fmtDateShort(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${+d} ${MONTH_NAMES[+m - 1].slice(0, 3).toLowerCase()}`;
}

function userName(u) {
  if (!u) return '—';
  return `${u.first_name || ''} ${u.last_name || ''}`.trim() || '—';
}

function daysUntil(dateISO) {
  const today = new Date(todayISO());
  const target = new Date(dateISO);
  return Math.round((target - today) / 86400000);
}

function getMonthDays(year, month) {
  const first = new Date(year, month, 1);
  const startDow = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  return cells;
}

function dateToISO(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function isBirthdayOnDay(birthDate, y, m, d) {
  if (!birthDate) return false;
  const [, bm, bd] = birthDate.split('-');
  return +bm === m + 1 && +bd === d;
}

const VACATION_COLORS = [
  '#3b82f6', '#8b5cf6', '#ef4444', '#f59e0b', '#10b981',
  '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#14b8a6',
];

function userColor(userId) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  return VACATION_COLORS[Math.abs(hash) % VACATION_COLORS.length];
}

/* ═══════════════════════════════════════════════════════════════
   AddVacationModal
   ═══════════════════════════════════════════════════════════════ */
function AddVacationModal({ users, onSave, onClose }) {
  const [userId, setUserId] = useState('');
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState('');
  const [comment, setComment] = useState('');

  const activeUsers = users.filter(u => u.active && u.role !== 'pending');

  const save = () => {
    if (!userId || !startDate || !endDate) return;
    if (endDate < startDate) return;
    onSave({ user_id: userId, start_date: startDate, end_date: endDate, comment: comment.trim() });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)' }} onClick={onClose} />
      <div style={{
        position: 'relative', width: '100%', maxWidth: 480,
        background: 'var(--mc-card)', borderRadius: '16px 16px 0 0',
        padding: 20, maxHeight: '80vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Новый отпуск</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <X size={20} />
          </button>
        </div>

        <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--mc-muted)' }}>Сотрудник</label>
        <select value={userId} onChange={e => setUserId(e.target.value)}
          style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--mc-border)',
                   background: 'var(--mc-bg)', fontSize: 15, marginBottom: 12, marginTop: 4 }}>
          <option value="">Выберите...</option>
          {activeUsers.map(u => (
            <option key={u.id} value={u.id}>{userName(u)}</option>
          ))}
        </select>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--mc-muted)' }}>С</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--mc-border)',
                       background: 'var(--mc-bg)', fontSize: 15, marginTop: 4 }} />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--mc-muted)' }}>По</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--mc-border)',
                       background: 'var(--mc-bg)', fontSize: 15, marginTop: 4 }} />
          </div>
        </div>

        <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--mc-muted)' }}>Комментарий</label>
        <input value={comment} onChange={e => setComment(e.target.value)} placeholder="Необязательно"
          style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--mc-border)',
                   background: 'var(--mc-bg)', fontSize: 15, marginBottom: 16, marginTop: 4 }} />

        <button onClick={save} disabled={!userId || !startDate || !endDate || endDate < startDate}
          style={{
            width: '100%', padding: '12px 0', borderRadius: 12, border: 'none',
            background: '#297b8a', color: '#fff', fontSize: 15, fontWeight: 700,
            cursor: 'pointer', opacity: (!userId || !startDate || !endDate || endDate < startDate) ? 0.5 : 1,
          }}>
          Сохранить
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   EditBirthdayModal
   ═══════════════════════════════════════════════════════════════ */
function EditBirthdayModal({ user, onSave, onClose }) {
  const [date, setDate] = useState(user.birth_date || '');

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)' }} onClick={onClose} />
      <div style={{
        position: 'relative', width: '100%', maxWidth: 480,
        background: 'var(--mc-card)', borderRadius: '16px 16px 0 0', padding: 20,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Дата рождения — {userName(user)}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <X size={20} />
          </button>
        </div>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--mc-border)',
                   background: 'var(--mc-bg)', fontSize: 15, marginBottom: 16 }} />
        <button onClick={() => onSave(user.id, date || null)}
          style={{
            width: '100%', padding: '12px 0', borderRadius: 12, border: 'none',
            background: '#297b8a', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer',
          }}>
          Сохранить
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Main Screen
   ═══════════════════════════════════════════════════════════════ */
export default function HRCalendarScreen({ ctx }) {
  const { db, setDb, currentUser, setRoute, showToast } = ctx;
  const can = perm => ctx.can(perm);

  const [tab, setTab] = useState('vacations');
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth());
  const [showAddVacation, setShowAddVacation] = useState(false);
  const [editBirthdayUser, setEditBirthdayUser] = useState(null);

  const today = todayISO();
  const users = db.users.filter(u => u.active && u.role !== 'pending');
  const vacations = (db.vacations || []).filter(v => v.status === 'active');

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };
  const goToday = () => { const n = new Date(); setYear(n.getFullYear()); setMonth(n.getMonth()); };

  /* ── vacation helpers ── */
  const vacationsInMonth = useMemo(() => {
    const mStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const mEnd = `${year}-${String(month + 1).padStart(2, '0')}-${new Date(year, month + 1, 0).getDate()}`;
    return vacations.filter(v => v.start_date <= mEnd && v.end_date >= mStart);
  }, [vacations, year, month]);

  const isOnVacation = (userId, y, m, d) => {
    const iso = dateToISO(y, m, d);
    return vacationsInMonth.some(v => v.user_id === userId && v.start_date <= iso && v.end_date >= iso);
  };

  const getVacationsForDay = (y, m, d) => {
    const iso = dateToISO(y, m, d);
    return vacationsInMonth.filter(v => v.start_date <= iso && v.end_date >= iso);
  };

  const addVacation = async (data) => {
    const vacation = {
      ...data,
      id: crypto.randomUUID(),
      status: 'active',
      created_by: currentUser.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setDb(d => ({ ...d, vacations: [vacation, ...(d.vacations || [])] }));
    setShowAddVacation(false);
    const u = users.find(x => x.id === data.user_id);
    showToast(`Отпуск для ${userName(u)} сохранён`);
  };

  const cancelVacation = async (vacId) => {
    setDb(d => ({
      ...d,
      vacations: (d.vacations || []).map(v =>
        v.id === vacId ? { ...v, status: 'cancelled', updated_at: new Date().toISOString() } : v
      ),
    }));
    showToast('Отпуск отменён');
  };

  /* ── birthday helpers ── */
  const saveBirthday = async (userId, date) => {
    const { error } = await supabase.from('users').update({ birth_date: date }).eq('id', userId);
    if (error) { showToast('Ошибка: ' + error.message); return; }
    setDb(d => ({
      ...d,
      users: d.users.map(u => u.id === userId ? { ...u, birth_date: date } : u),
    }));
    setEditBirthdayUser(null);
    showToast('Дата рождения сохранена');
  };

  const birthdaysInMonth = useMemo(() => {
    return users
      .filter(u => {
        if (!u.birth_date) return false;
        const bm = +u.birth_date.split('-')[1];
        return bm === month + 1;
      })
      .sort((a, b) => +a.birth_date.split('-')[2] - +b.birth_date.split('-')[2]);
  }, [users, month]);

  const upcomingBirthdays = useMemo(() => {
    const todayStr = todayISO();
    const [ty, tm, td] = todayStr.split('-').map(Number);
    return users
      .filter(u => u.birth_date)
      .map(u => {
        const [, bm, bd] = u.birth_date.split('-').map(Number);
        let nextBd = `${ty}-${String(bm).padStart(2, '0')}-${String(bd).padStart(2, '0')}`;
        if (nextBd < todayStr) nextBd = `${ty + 1}-${String(bm).padStart(2, '0')}-${String(bd).padStart(2, '0')}`;
        return { ...u, nextBirthday: nextBd, daysUntil: daysUntil(nextBd) };
      })
      .sort((a, b) => a.daysUntil - b.daysUntil)
      .slice(0, 10);
  }, [users]);

  const currentVacations = useMemo(() => {
    return vacations
      .filter(v => v.start_date <= today && v.end_date >= today)
      .map(v => ({ ...v, user: users.find(u => u.id === v.user_id) }));
  }, [vacations, today, users]);

  const upcomingVacations = useMemo(() => {
    return vacations
      .filter(v => v.start_date > today)
      .sort((a, b) => a.start_date.localeCompare(b.start_date))
      .slice(0, 10)
      .map(v => ({ ...v, user: users.find(u => u.id === v.user_id) }));
  }, [vacations, today, users]);

  /* ── calendar grid ── */
  const cells = getMonthDays(year, month);

  const renderCalendarGrid = () => (
    <div style={{ background: 'var(--mc-card)', borderRadius: 14, padding: 16, marginBottom: 16 }}>
      {/* Month nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <button onClick={prevMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6 }}>
          <ChevronLeft size={20} />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 17, fontWeight: 700 }}>{MONTH_NAMES[month]} {year}</span>
          <button onClick={goToday}
            style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8, border: '1px solid var(--mc-border)',
                     background: 'var(--mc-bg)', cursor: 'pointer', color: '#297b8a', fontWeight: 600 }}>
            Сегодня
          </button>
        </div>
        <button onClick={nextMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6 }}>
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', marginBottom: 4 }}>
        {DAY_NAMES.map(d => (
          <div key={d} style={{ fontSize: 11, fontWeight: 600, color: 'var(--mc-muted)', padding: '4px 0' }}>{d}</div>
        ))}
      </div>

      {/* Cells */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} />;
          const iso = dateToISO(year, month, day);
          const isToday = iso === today;
          const dayVacations = getVacationsForDay(year, month, day);
          const dayBirthdays = users.filter(u => isBirthdayOnDay(u.birth_date, year, month, day));
          const hasEvents = dayVacations.length > 0 || dayBirthdays.length > 0;

          return (
            <div key={day} style={{
              minHeight: 52, padding: '2px 3px', borderRadius: 8, position: 'relative',
              border: isToday ? '2px solid #297b8a' : '1px solid transparent',
              background: isToday ? 'rgba(41,123,138,0.08)' : 'transparent',
            }}>
              <div style={{ fontSize: 12, fontWeight: isToday ? 700 : 500, textAlign: 'right',
                            color: isToday ? '#297b8a' : 'var(--mc-text)', padding: '1px 3px' }}>
                {day}
              </div>
              {/* Vacation dots */}
              {dayVacations.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, padding: '0 2px' }}>
                  {dayVacations.slice(0, 3).map(v => (
                    <div key={v.id} title={userName(users.find(u => u.id === v.user_id))}
                      style={{
                        width: '100%', height: 4, borderRadius: 2,
                        background: userColor(v.user_id), opacity: 0.8,
                      }} />
                  ))}
                </div>
              )}
              {/* Birthday icon */}
              {dayBirthdays.length > 0 && (
                <div style={{ position: 'absolute', bottom: 2, right: 3, fontSize: 12 }}
                     title={dayBirthdays.map(userName).join(', ')}>
                  🎂
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  /* ── Vacation list card ── */
  const renderVacationCard = (v, showCancel) => {
    const u = users.find(x => x.id === v.user_id);
    const d1 = daysUntil(v.start_date);
    const d2 = daysUntil(v.end_date);
    const isActive = v.start_date <= today && v.end_date >= today;
    const totalDays = Math.round((new Date(v.end_date) - new Date(v.start_date)) / 86400000) + 1;

    return (
      <div key={v.id} style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
        background: 'var(--mc-card)', borderRadius: 12, marginBottom: 8,
        borderLeft: `4px solid ${userColor(v.user_id)}`,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{userName(u)}</div>
          <div style={{ fontSize: 13, color: 'var(--mc-muted)', marginTop: 2 }}>
            {fmtDate(v.start_date)} — {fmtDate(v.end_date)}
            <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>({totalDays} дн.)</span>
          </div>
          {v.comment && <div style={{ fontSize: 12, color: 'var(--mc-muted)', marginTop: 2 }}>{v.comment}</div>}
          {isActive && (
            <span style={{
              display: 'inline-block', marginTop: 4, fontSize: 11, fontWeight: 600,
              padding: '2px 8px', borderRadius: 6, background: '#dcfce7', color: '#15803d',
            }}>
              В отпуске · осталось {daysUntil(v.end_date) + 1} дн.
            </span>
          )}
          {!isActive && d1 > 0 && (
            <span style={{
              display: 'inline-block', marginTop: 4, fontSize: 11, fontWeight: 600,
              padding: '2px 8px', borderRadius: 6, background: '#dbeafe', color: '#1d4ed8',
            }}>
              Через {d1} дн.
            </span>
          )}
        </div>
        {showCancel && can('hr_vacation_manage') && (
          <button onClick={() => cancelVacation(v.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#ef4444' }}
            title="Отменить отпуск">
            <Trash2 size={16} />
          </button>
        )}
      </div>
    );
  };

  /* ── render ── */
  return (
    <div style={{ minHeight: '100vh', background: 'var(--mc-bg)' }}>
      {/* Header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'var(--mc-card)', borderBottom: '1px solid var(--mc-border)',
        padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button onClick={() => setRoute({ name: 'home' })}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
          <ChevronLeft size={22} />
        </button>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, flex: 1 }}>HR-календарь</h2>
        {tab === 'vacations' && can('hr_vacation_manage') && (
          <button onClick={() => setShowAddVacation(true)}
            style={{
              background: '#297b8a', color: '#fff', border: 'none', borderRadius: 10,
              padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
            <Plus size={16} /> Отпуск
          </button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', padding: '12px 16px 0', gap: 8 }}>
        {[
          { key: 'vacations', label: 'Отпуска', icon: Palmtree },
          { key: 'birthdays', label: 'Дни рождения', icon: Cake },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '10px 0', borderRadius: 12, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600,
              background: tab === t.key ? '#297b8a' : 'var(--mc-card)',
              color: tab === t.key ? '#fff' : 'var(--mc-text)',
              transition: 'all .15s',
            }}>
            <t.icon size={16} />
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ padding: '12px 16px 80px' }}>
        {/* Calendar grid — shared */}
        {renderCalendarGrid()}

        {tab === 'vacations' && (
          <>
            {/* Current vacations */}
            {currentVacations.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Palmtree size={16} color="#15803d" /> Сейчас в отпуске
                </h3>
                {currentVacations.map(v => renderVacationCard(v, true))}
              </div>
            )}

            {/* Upcoming vacations */}
            {upcomingVacations.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Предстоящие отпуска</h3>
                {upcomingVacations.map(v => renderVacationCard(v, true))}
              </div>
            )}

            {currentVacations.length === 0 && upcomingVacations.length === 0 && (
              <div style={{ textAlign: 'center', padding: 32, color: 'var(--mc-muted)' }}>
                <Palmtree size={40} style={{ opacity: 0.3, marginBottom: 8 }} />
                <div style={{ fontSize: 15 }}>Нет запланированных отпусков</div>
              </div>
            )}

            {/* History (past vacations) */}
            {(() => {
              const past = vacations
                .filter(v => v.end_date < today)
                .sort((a, b) => b.end_date.localeCompare(a.end_date))
                .slice(0, 20);
              const cancelled = (db.vacations || [])
                .filter(v => v.status === 'cancelled')
                .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
                .slice(0, 10);
              const history = [...past, ...cancelled];
              if (history.length === 0) return null;
              return (
                <div style={{ marginBottom: 16 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, color: 'var(--mc-muted)' }}>
                    История
                  </h3>
                  {history.map(v => {
                    const u = users.find(x => x.id === v.user_id);
                    const totalDays = Math.round((new Date(v.end_date) - new Date(v.start_date)) / 86400000) + 1;
                    return (
                      <div key={v.id} style={{
                        padding: '8px 14px', background: 'var(--mc-card)', borderRadius: 10,
                        marginBottom: 6, opacity: 0.7,
                        borderLeft: v.status === 'cancelled' ? '4px solid #ef4444' : `4px solid ${userColor(v.user_id)}`,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{userName(u)}</span>
                          {v.status === 'cancelled' && (
                            <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 600 }}>Отменён</span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--mc-muted)' }}>
                          {fmtDate(v.start_date)} — {fmtDate(v.end_date)} ({totalDays} дн.)
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </>
        )}

        {tab === 'birthdays' && (
          <>
            {/* Upcoming birthdays */}
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Cake size={16} color="#ec4899" /> Ближайшие дни рождения
              </h3>
              {upcomingBirthdays.length === 0 && (
                <div style={{ textAlign: 'center', padding: 24, color: 'var(--mc-muted)', fontSize: 14 }}>
                  Нет сотрудников с заполненной датой рождения
                </div>
              )}
              {upcomingBirthdays.map(u => {
                const isToday_ = u.daysUntil === 0;
                const [by] = u.birth_date.split('-');
                const age = year - +by;
                return (
                  <div key={u.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                    background: isToday_ ? 'linear-gradient(135deg, #fdf2f8, #fce7f3)' : 'var(--mc-card)',
                    borderRadius: 12, marginBottom: 8,
                    border: isToday_ ? '2px solid #ec4899' : 'none',
                  }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', fontSize: 20,
                      background: isToday_ ? '#ec4899' : 'var(--mc-bg)',
                    }}>
                      {isToday_ ? '🎉' : '🎂'}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>
                        {userName(u)}
                        {isToday_ && <span style={{ marginLeft: 6, color: '#ec4899', fontWeight: 700 }}>Сегодня!</span>}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--mc-muted)' }}>
                        {fmtDateShort(u.nextBirthday)}
                        {age > 0 && age < 100 && <span style={{ marginLeft: 6 }}>· {age} лет</span>}
                        {!isToday_ && <span style={{ marginLeft: 6, opacity: 0.7 }}>· через {u.daysUntil} дн.</span>}
                      </div>
                    </div>
                    {can('hr_birthday_manage') && (
                      <button onClick={() => setEditBirthdayUser(u)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                        <Edit3 size={16} color="var(--mc-muted)" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* All employees without birthday */}
            {can('hr_birthday_manage') && (() => {
              const noBirthday = users.filter(u => !u.birth_date);
              if (noBirthday.length === 0) return null;
              return (
                <div>
                  <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, color: 'var(--mc-muted)' }}>
                    <Users size={16} style={{ verticalAlign: -3, marginRight: 4 }} />
                    Без даты рождения ({noBirthday.length})
                  </h3>
                  {noBirthday.map(u => (
                    <div key={u.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '8px 14px', background: 'var(--mc-card)', borderRadius: 10, marginBottom: 6,
                    }}>
                      <span style={{ fontSize: 14 }}>{userName(u)}</span>
                      <button onClick={() => setEditBirthdayUser(u)}
                        style={{
                          background: '#297b8a', color: '#fff', border: 'none', borderRadius: 8,
                          padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        }}>
                        Указать ДР
                      </button>
                    </div>
                  ))}
                </div>
              );
            })()}
          </>
        )}
      </div>

      {showAddVacation && (
        <AddVacationModal
          users={users}
          onSave={addVacation}
          onClose={() => setShowAddVacation(false)}
        />
      )}
      {editBirthdayUser && (
        <EditBirthdayModal
          user={editBirthdayUser}
          onSave={saveBirthday}
          onClose={() => setEditBirthdayUser(null)}
        />
      )}
    </div>
  );
}
