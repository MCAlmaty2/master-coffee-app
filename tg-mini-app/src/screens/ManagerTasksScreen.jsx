/**
 * ManagerTasksScreen.jsx — «Вопросы / поручения» для руководителей.
 * Чтобы вопросы не терялись: заголовок, описание, ответственный, статус, решение.
 * Доступ: admin, director, senior_manager (+ ответственный видит свои).
 */
import React, { useState, useMemo } from 'react';
import { ChevronLeft, Plus, X, ChevronRight } from 'lucide-react';
import { supabase } from '../supabase/client';

const ACCESS_ROLES = ['admin', 'director', 'senior_manager'];
const NO_CREATE_ROLES = ['observer', 'pending'];

const MT_STATUS = {
  new:         { label: 'Новый',     color: '#3390EC', bg: '#E7F3FE' },
  in_progress: { label: 'В работе',  color: '#F59E0B', bg: '#FEF3C7' },
  done:        { label: 'Решён',     color: '#22C55E', bg: '#DCFCE7' },
  cancelled:   { label: 'Отменён',   color: '#94a3b8', bg: '#F1F5F9' },
};
const MT_STATUS_ORDER = ['new', 'in_progress', 'done', 'cancelled'];

const PRIORITY = {
  high:   { label: '🔴 Высокий', color: '#dc2626' },
  normal: { label: '🟡 Обычный', color: '#d97706' },
  low:    { label: '⚪ Низкий',  color: '#64748b' },
};

const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID)
  ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
      const r = Math.random() * 16 | 0; return (ch === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });

const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '';
const userName = (db, id) => { const u = db.users?.find(x => x.id === id); return u ? `${u.first_name} ${u.last_name}` : '—'; };

export function ManagerTasksScreen({ ctx }) {
  const { db, currentUser, goBack, setDb, showToast, notify } = ctx;
  const isManager = ACCESS_ROLES.includes(currentUser?.role);
  const canCreate = !NO_CREATE_ROLES.includes(currentUser?.role);

  const all = db.managerTasks || [];
  // руководители видят всё; остальные — только где они ответственные/постановщики
  const visible = isManager ? all : all.filter(t => t.assignee_id === currentUser.id || t.created_by === currentUser.id);

  const [filter, setFilter] = useState('open'); // open | all | done
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState(null);

  const list = useMemo(() => {
    let l = visible;
    if (filter === 'open') l = l.filter(t => t.status === 'new' || t.status === 'in_progress');
    else if (filter === 'done') l = l.filter(t => t.status === 'done');
    return [...l].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [visible, filter]);

  const openCount = visible.filter(t => t.status === 'new' || t.status === 'in_progress').length;

  if (!isManager && !canCreate && visible.length === 0) {
    return (
      <div>
        <button onClick={goBack} style={backBtn}><ChevronLeft size={15} /> Назад</button>
        <div style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 14, padding: 24, textAlign: 'center', color: 'var(--mc-muted)' }}>
          Вопросов на вас пока нет
        </div>
      </div>
    );
  }

  /* ── Операции ── */
  const createTask = async (data) => {
    const year = new Date().getFullYear();
    const lastNum = all.filter(t => t.number?.startsWith(`В${year}-`))
      .map(t => parseInt(t.number.split('-')[1], 10)).reduce((m, n) => Math.max(m, n), 0);
    const row = {
      id: uid(),
      number: `В${year}-${String(lastNum + 1).padStart(3, '0')}`,
      title: data.title.trim(),
      description: (data.description || '').trim(),
      assignee_id: data.assignee_id || null,
      created_by: currentUser.id,
      status: 'new',
      priority: data.priority || 'normal',
      due_date: data.due_date || null,
      log: [{ event: 'created', actor: currentUser.id, at: new Date().toISOString() }],
      created_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('manager_tasks').insert(row);
    if (error) { showToast('Ошибка: ' + error.message); return; }
    setDb(d => ({ ...d, managerTasks: [row, ...(d.managerTasks || [])] }));
    if (row.assignee_id && row.assignee_id !== currentUser.id && notify) {
      const n = notify({ recipient_id: row.assignee_id, title: '📌 Новый вопрос/поручение',
        body: `${row.number}: ${row.title}`, link_kind: 'manager_task', link_id: row.id });
      setDb(d => ({ ...d, notifications: [n, ...(d.notifications || [])] }));
    }
    setCreateOpen(false);
    showToast(`${row.number} создан`);
  };

  const changeStatus = async (task, status, resolution) => {
    const patch = {
      status,
      resolved_at: (status === 'done' || status === 'cancelled') ? new Date().toISOString() : null,
      log: [...(task.log || []), { event: 'status', from: task.status, to: status, actor: currentUser.id, at: new Date().toISOString(), ...(resolution ? { resolution } : {}) }],
    };
    const { error } = await supabase.from('manager_tasks').update(patch).eq('id', task.id);
    if (error) { showToast('Ошибка: ' + error.message); return; }
    const updated = { ...task, ...patch };
    setDb(d => ({ ...d, managerTasks: (d.managerTasks || []).map(t => t.id === task.id ? updated : t) }));
    setDetail(updated);
    // уведомить постановщика при решении
    if (status === 'done' && task.created_by && task.created_by !== currentUser.id && notify) {
      const n = notify({ recipient_id: task.created_by, title: '✅ Вопрос решён',
        body: `${task.number}: ${task.title}${resolution ? '\n' + resolution : ''}`, link_kind: 'manager_task', link_id: task.id });
      setDb(d => ({ ...d, notifications: [n, ...(d.notifications || [])] }));
    }
    showToast(`Статус: ${MT_STATUS[status].label}`);
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <button onClick={goBack} style={backBtn}><ChevronLeft size={15} /> Назад</button>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--mc-text)', margin: 0 }}>📌 Вопросы / поручения</h1>
          <div style={{ fontSize: 11, color: 'var(--mc-muted)', marginTop: 2 }}>{openCount} открытых</div>
        </div>
        {canCreate && (
          <button onClick={() => setCreateOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 14px', background: '#297b8a', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            <Plus size={15} /> Новый
          </button>
        )}
      </div>

      {/* Фильтр */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {[['open', 'Открытые'], ['done', 'Решённые'], ['all', 'Все']].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)}
            style={{ padding: '6px 14px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              border: `1.5px solid ${filter === k ? '#297b8a' : 'var(--mc-border)'}`,
              background: filter === k ? '#297b8a' : 'var(--mc-surface)', color: filter === k ? '#fff' : 'var(--mc-muted)' }}>
            {l}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 14, padding: '40px 20px', textAlign: 'center', color: 'var(--mc-muted)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📌</div>
          <div style={{ fontSize: 13 }}>Нет вопросов в этой категории</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {list.map(t => {
            const st = MT_STATUS[t.status] || MT_STATUS.new;
            const overdue = t.due_date && t.status !== 'done' && t.status !== 'cancelled' && new Date(t.due_date) < new Date(new Date().toDateString());
            return (
              <div key={t.id} onClick={() => setDetail(t)}
                style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 12, padding: '12px 14px', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--mc-text)', flex: 1 }}>
                    {t.priority === 'high' && '🔴 '}{t.title}
                  </div>
                  <span style={{ background: st.bg, color: st.color, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 12, whiteSpace: 'nowrap', flexShrink: 0 }}>{st.label}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--mc-muted)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <span>{t.number}</span>
                  {t.assignee_id && <span>👤 {userName(db, t.assignee_id)}</span>}
                  {t.due_date && <span style={{ color: overdue ? '#dc2626' : 'var(--mc-muted)', fontWeight: overdue ? 700 : 400 }}>📅 до {fmtDate(t.due_date)}{overdue ? ' (просрочен)' : ''}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {createOpen && <CreateMTModal ctx={ctx} onClose={() => setCreateOpen(false)} onCreate={createTask} />}
      {detail && <MTDetailModal ctx={ctx} task={detail} isManager={isManager} onClose={() => setDetail(null)} onStatus={changeStatus} />}
    </div>
  );
}

/* ── Модал создания ── */
function CreateMTModal({ ctx, onClose, onCreate }) {
  const { db } = ctx;
  const [form, setForm] = useState({ title: '', description: '', assignee_id: '', priority: 'normal', due_date: '' });
  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const candidates = (db.users || []).filter(u => u.active && u.role !== 'pending').sort((a, b) => a.first_name.localeCompare(b.first_name));
  const fld = { width: '100%', padding: '9px 11px', border: '1px solid var(--mc-border)', borderRadius: 9, fontSize: 13, outline: 'none', background: 'var(--mc-surface)', color: 'var(--mc-text)', boxSizing: 'border-box' };
  const lbl = { fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .4, marginBottom: 4, display: 'block' };

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={sheetWrap}>
      <div style={sheetBody}>
        <div style={sheetHeader}>
          <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--mc-text)' }}>Новый вопрос / поручение</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mc-muted)' }}><X size={20} /></button>
        </div>
        <div style={{ padding: '12px 16px', overflowY: 'auto', flex: 1 }}>
          <div style={{ marginBottom: 10 }}><label style={lbl}>Заголовок *</label>
            <input style={fld} value={form.title} autoFocus onChange={e => upd('title', e.target.value)} placeholder="Коротко суть вопроса" /></div>
          <div style={{ marginBottom: 10 }}><label style={lbl}>Описание</label>
            <textarea rows={3} style={{ ...fld, resize: 'vertical' }} value={form.description} onChange={e => upd('description', e.target.value)} placeholder="Детали, контекст" /></div>
          <div style={{ marginBottom: 10 }}><label style={lbl}>Ответственный</label>
            <select style={fld} value={form.assignee_id} onChange={e => upd('assignee_id', e.target.value)}>
              <option value="">— не назначен —</option>
              {candidates.map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
            </select></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
            <div><label style={lbl}>Приоритет</label>
              <select style={fld} value={form.priority} onChange={e => upd('priority', e.target.value)}>
                <option value="low">Низкий</option><option value="normal">Обычный</option><option value="high">Высокий</option>
              </select></div>
            <div><label style={lbl}>Срок</label>
              <input type="date" style={fld} value={form.due_date} onChange={e => upd('due_date', e.target.value)} /></div>
          </div>
        </div>
        <div style={{ padding: '10px 16px 28px', borderTop: '1px solid var(--mc-border-light)' }}>
          <button onClick={() => form.title.trim() ? onCreate(form) : null} disabled={!form.title.trim()}
            style={{ width: '100%', padding: 13, background: form.title.trim() ? '#297b8a' : 'var(--mc-border)', color: '#fff', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: form.title.trim() ? 'pointer' : 'not-allowed' }}>
            Создать
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Модал детали ── */
function MTDetailModal({ ctx, task, isManager, onClose, onStatus }) {
  const { db, currentUser } = ctx;
  const [resolution, setResolution] = useState('');
  const canManage = isManager || task.assignee_id === currentUser.id || task.created_by === currentUser.id;
  const st = MT_STATUS[task.status] || MT_STATUS.new;

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={sheetWrap}>
      <div style={sheetBody}>
        <div style={sheetHeader}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--mc-text)' }}>{task.title}</div>
            <div style={{ fontSize: 11, color: 'var(--mc-muted)' }}>{task.number} · {PRIORITY[task.priority]?.label}</div>
          </div>
          <span style={{ background: st.bg, color: st.color, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 12 }}>{st.label}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mc-muted)', marginLeft: 8 }}><X size={20} /></button>
        </div>
        <div style={{ padding: '12px 16px', overflowY: 'auto', flex: 1 }}>
          {task.description && <div style={{ fontSize: 13, color: 'var(--mc-text)', whiteSpace: 'pre-wrap', marginBottom: 12 }}>{task.description}</div>}
          <div style={{ fontSize: 12, color: 'var(--mc-muted)', marginBottom: 4 }}>Постановщик: {userName(db, task.created_by)}</div>
          {task.assignee_id && <div style={{ fontSize: 12, color: 'var(--mc-muted)', marginBottom: 4 }}>Ответственный: {userName(db, task.assignee_id)}</div>}
          {task.due_date && <div style={{ fontSize: 12, color: 'var(--mc-muted)', marginBottom: 12 }}>Срок: {fmtDate(task.due_date)}</div>}

          {/* История */}
          {(task.log || []).length > 0 && (
            <div style={{ marginTop: 12, borderTop: '1px solid var(--mc-border-light)', paddingTop: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', marginBottom: 6 }}>История</div>
              {task.log.map((l, i) => (
                <div key={i} style={{ fontSize: 11, color: 'var(--mc-muted)', marginBottom: 5 }}>
                  {l.event === 'created' ? 'Создан' : `${MT_STATUS[l.from]?.label || l.from} → ${MT_STATUS[l.to]?.label || l.to}`}
                  {' · '}{userName(db, l.actor)} · {new Date(l.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  {l.resolution && <div style={{ color: '#16a34a', marginTop: 2 }}>📝 {l.resolution}</div>}
                </div>
              ))}
            </div>
          )}

          {/* Управление статусом */}
          {canManage && task.status !== 'done' && task.status !== 'cancelled' && (
            <div style={{ marginTop: 14, borderTop: '1px solid var(--mc-border-light)', paddingTop: 12 }}>
              <textarea value={resolution} onChange={e => setResolution(e.target.value)} rows={2}
                placeholder="Решение / комментарий (для статуса «Решён»)"
                style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--mc-border)', borderRadius: 9, fontSize: 13, color: 'var(--mc-text)', background: 'var(--mc-surface)', resize: 'vertical', boxSizing: 'border-box', marginBottom: 8 }} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {task.status === 'new' && (
                  <button onClick={() => onStatus(task, 'in_progress')} style={btn('#F59E0B')}>В работу</button>
                )}
                <button onClick={() => { if (!resolution.trim()) return alert('Добавьте решение'); onStatus(task, 'done', resolution.trim()); }} style={btn('#22C55E')}>✓ Решён</button>
                <button onClick={() => onStatus(task, 'cancelled', resolution.trim() || undefined)} style={btn('#94a3b8')}>Отменить</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Тайл на главной ── */
export function ManagerTasksHomeTile({ ctx }) {
  const { db, currentUser, navigate } = ctx;
  const isManager = ACCESS_ROLES.includes(currentUser?.role);
  const canCreate = !NO_CREATE_ROLES.includes(currentUser?.role);
  const all = db.managerTasks || [];
  const mine = isManager ? all : all.filter(t => t.assignee_id === currentUser.id || t.created_by === currentUser.id);
  const open = mine.filter(t => t.status === 'new' || t.status === 'in_progress');
  if (!isManager && !canCreate && mine.length === 0) return null;

  return (
    <div onClick={() => navigate({ name: 'manager_tasks' })}
      style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 14, padding: '14px 16px', cursor: 'pointer', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>📌</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--mc-text)' }}>Вопросы / поручения</div>
            <div style={{ fontSize: 11, color: 'var(--mc-muted)' }}>{open.length} открытых</div>
          </div>
        </div>
        <ChevronRight size={15} style={{ color: 'var(--mc-muted)' }} />
      </div>
    </div>
  );
}

/* ── styles ── */
const backBtn = { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--mc-muted)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 8, padding: 0 };
const sheetWrap = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-end' };
const sheetBody = { background: 'var(--mc-surface)', width: '100%', borderRadius: '20px 20px 0 0', maxHeight: 'min(88vh, 88dvh)', display: 'flex', flexDirection: 'column' };
const sheetHeader = { display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px 10px', borderBottom: '1px solid var(--mc-border-light)' };
const btn = (color) => ({ padding: '8px 16px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: 'none', background: color, color: '#fff' });
