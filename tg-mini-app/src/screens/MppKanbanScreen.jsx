import React, { useState, useMemo } from 'react';
import {
  ChevronLeft, Plus, X, Phone, Calendar, MessageSquare, Clock, Trash2,
  ChevronRight, User, Building2, ArrowRight, Package, CheckCircle2, AlertCircle, Bell,
} from 'lucide-react';

const TZ = 'Asia/Almaty';
function todayISO() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TZ })).toISOString().slice(0, 10);
}
function fmtMoney(n) { return (Number(n) || 0).toLocaleString('ru-RU') + ' ₸'; }
function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ru-KZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ });
}
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ru-KZ', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: TZ });
}

const STAGES = [
  { key: 'new_lead',      label: 'Новый лид',       color: '#94A3B8', emoji: '🆕' },
  { key: 'first_contact', label: 'Первый контакт',  color: '#3B82F6', emoji: '📞' },
  { key: 'negotiation',   label: 'Переговоры',       color: '#F59E0B', emoji: '🤝' },
  { key: 'proposal',      label: 'КП отправлено',    color: '#8B5CF6', emoji: '📄' },
  { key: 'contract',      label: 'Договор',          color: '#0EA5E9', emoji: '📑' },
  { key: 'payment',       label: 'Оплата',           color: '#10B981', emoji: '💰' },
  { key: 'won',           label: 'Выиграно',         color: '#22C55E', emoji: '✅' },
  { key: 'lost',          label: 'Отказ',            color: '#EF4444', emoji: '❌' },
];

const ACTIVITY_TYPES = [
  { key: 'call',    label: 'Звонок',   icon: Phone },
  { key: 'meeting', label: 'Встреча',  icon: Calendar },
  { key: 'message', label: 'Сообщение', icon: MessageSquare },
  { key: 'note',    label: 'Заметка',  icon: MessageSquare },
];

function PageHeader({ title, subtitle, onBack, action }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 sticky top-0 z-20" style={{ background: 'var(--mc-bg)' }}>
      {onBack && (
        <button onClick={onBack} className="w-8 h-8 flex items-center justify-center rounded-full" style={{ background: 'var(--mc-surface)' }}>
          <ChevronLeft size={18} style={{ color: 'var(--mc-text)' }} />
        </button>
      )}
      <div className="flex-1">
        <h1 className="text-xl font-bold" style={{ color: 'var(--mc-text)' }}>{title}</h1>
        {subtitle && <div className="text-xs" style={{ color: 'var(--mc-muted)' }}>{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

function Modal({ onClose, title, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl p-5 max-h-[85vh] overflow-y-auto" style={{ background: 'var(--mc-surface)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold" style={{ color: 'var(--mc-text)' }}>{title}</h3>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: 'var(--mc-bg)' }}>
            <X size={14} style={{ color: 'var(--mc-muted)' }} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Inp({ label, value, onChange, placeholder, type = 'text', inputMode, rows }) {
  const props = {
    value, onChange: e => onChange(e.target.value), placeholder,
    className: `w-full px-3 py-2.5 rounded-lg outline-none text-sm ${rows ? 'resize-none' : ''}`,
    style: { border: '1px solid var(--mc-border)', color: 'var(--mc-text)', background: 'var(--mc-bg)' },
  };
  return (
    <div>
      <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>{label}</label>
      {rows ? <textarea {...props} rows={rows} /> : <input type={type} inputMode={inputMode} {...props} />}
    </div>
  );
}

export default function MppKanbanScreen({ ctx }) {
  const { route } = ctx;
  const canManage = ctx.can('mpp_manage');

  if (route.name === 'mpp_deal' && route.dealId) {
    return <DealDetailScreen ctx={ctx} dealId={route.dealId} canManage={canManage} />;
  }
  return <MainScreen ctx={ctx} canManage={canManage} />;
}

function MainScreen({ ctx, canManage }) {
  const { db, navigate, goBack, showToast, createMppDeal, createMppTask, completeMppTask } = ctx;
  const [tab, setTab] = useState('funnel');
  const [newDealModal, setNewDealModal] = useState(false);
  const [newTaskModal, setNewTaskModal] = useState(false);
  const [filterManager, setFilterManager] = useState('all');

  const deals = useMemo(() => {
    let list = db.mppDeals || [];
    if (filterManager !== 'all') list = list.filter(d => d.manager_id === filterManager);
    return list;
  }, [db.mppDeals, filterManager]);

  const managers = useMemo(() => {
    const ids = new Set((db.mppDeals || []).map(d => d.manager_id).filter(Boolean));
    return (db.users || []).filter(u => ids.has(u.id) && u.active);
  }, [db.mppDeals, db.users]);

  const salesUsers = useMemo(() =>
    (db.users || []).filter(u => u.active && ['b2b', 'sales', 'admin', 'senior_manager', 'director'].includes(u.role)),
  [db.users]);

  const dealsByStage = useMemo(() => {
    const map = {};
    STAGES.forEach(s => { map[s.key] = []; });
    deals.forEach(d => { (map[d.stage] || map.new_lead).push(d); });
    return map;
  }, [deals]);

  const stats = useMemo(() => {
    const active = deals.filter(d => d.stage !== 'won' && d.stage !== 'lost');
    const won = deals.filter(d => d.stage === 'won');
    const totalAmount = active.reduce((s, d) => s + (Number(d.amount) || 0), 0);
    return { active: active.length, won: won.length, totalAmount };
  }, [deals]);

  const tasks = useMemo(() => (db.mppTasks || []).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')), [db.mppTasks]);

  return (
    <div>
      <PageHeader
        title="Воронка МПП" subtitle="Сделки и задачи менеджеров" onBack={goBack}
        action={canManage ? (
          <button onClick={() => tab === 'funnel' ? setNewDealModal(true) : setNewTaskModal(true)}
            className="w-9 h-9 flex items-center justify-center rounded-full" style={{ background: '#7C3AED', color: '#fff' }}>
            <Plus size={18} />
          </button>
        ) : null}
      />

      {/* Tabs */}
      <div className="flex gap-1 mx-4 mb-4 p-1 rounded-xl" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
        {[{ k: 'funnel', l: 'Воронка' }, { k: 'tasks', l: 'Задачи' }].map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className="flex-1 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={{ background: tab === t.k ? '#7C3AED' : 'transparent', color: tab === t.k ? '#fff' : 'var(--mc-muted)' }}>
            {t.l}{t.k === 'tasks' && tasks.filter(x => x.status === 'active').length > 0 ? ` (${tasks.filter(x => x.status === 'active').length})` : ''}
          </button>
        ))}
      </div>

      <div className="px-4 space-y-4 pb-6">
        {tab === 'funnel' && (
          <>
            <div className="grid grid-cols-3 gap-2">
              {[
                { v: stats.active, l: 'Активных', c: 'var(--mc-text)' },
                { v: stats.won, l: 'Выиграно', c: '#22C55E' },
                { v: fmtMoney(stats.totalAmount), l: 'В воронке', c: '#7C3AED' },
              ].map(s => (
                <div key={s.l} className="rounded-xl p-3 text-center" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
                  <div className="text-lg font-bold" style={{ color: s.c }}>{s.v}</div>
                  <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--mc-muted)' }}>{s.l}</div>
                </div>
              ))}
            </div>

            {managers.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                <FilterBtn label="Все" active={filterManager === 'all'} onClick={() => setFilterManager('all')} />
                {managers.map(m => (
                  <FilterBtn key={m.id} label={m.first_name || 'Менеджер'} active={filterManager === m.id} onClick={() => setFilterManager(m.id)} />
                ))}
              </div>
            )}

            {STAGES.filter(s => s.key !== 'won' && s.key !== 'lost').map(stage => {
              const stageDeals = dealsByStage[stage.key] || [];
              if (stageDeals.length === 0 && !canManage) return null;
              return (
                <KanbanColumn key={stage.key} stage={stage} deals={stageDeals}
                  onDealClick={d => navigate({ name: 'mpp_deal', dealId: d.id })} activities={db.mppActivities || []} />
              );
            })}

            {(dealsByStage.won?.length > 0 || dealsByStage.lost?.length > 0) && (
              <ClosedDeals deals={[...(dealsByStage.won || []), ...(dealsByStage.lost || [])]} navigate={navigate} />
            )}
          </>
        )}

        {tab === 'tasks' && (
          <TasksList tasks={tasks} deals={db.mppDeals || []} canManage={canManage}
            onComplete={id => { const r = completeMppTask(id); showToast(r?.error || 'Задача закрыта'); }}
          />
        )}
      </div>

      {newDealModal && (
        <NewDealModal ctx={ctx} onClose={() => setNewDealModal(false)}
          onSave={data => { const r = createMppDeal(data); if (r?.error) { showToast(r.error); return; } showToast('Сделка создана'); setNewDealModal(false); }} />
      )}
      {newTaskModal && (
        <NewTaskModal users={salesUsers} onClose={() => setNewTaskModal(false)}
          onSave={data => { const r = createMppTask(data); if (r?.error) { showToast(r.error); return; } showToast('Задача назначена'); setNewTaskModal(false); }} />
      )}
    </div>
  );
}

function FilterBtn({ label, active, onClick }) {
  return (
    <button onClick={onClick} className="px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap"
      style={{ background: active ? '#7C3AED' : 'var(--mc-surface)', color: active ? '#fff' : 'var(--mc-muted)', border: '1px solid var(--mc-border)' }}>
      {label}
    </button>
  );
}

function KanbanColumn({ stage, deals, onDealClick, activities }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
      <div className="flex items-center justify-between px-4 py-2.5 cursor-pointer" onClick={() => setCollapsed(!collapsed)}
        style={{ borderBottom: collapsed ? 'none' : '1px solid var(--mc-border)' }}>
        <div className="flex items-center gap-2">
          <span>{stage.emoji}</span>
          <span className="font-semibold text-sm" style={{ color: 'var(--mc-text)' }}>{stage.label}</span>
          <span className="text-xs px-1.5 py-0.5 rounded-full font-bold" style={{ background: stage.color + '20', color: stage.color }}>{deals.length}</span>
        </div>
        <ChevronRight size={14} style={{ color: 'var(--mc-muted)', transform: collapsed ? 'rotate(0)' : 'rotate(90deg)', transition: 'transform .2s' }} />
      </div>
      {!collapsed && (
        <div className="px-3 py-2 space-y-2">
          {deals.length === 0 && <div className="text-xs py-3 text-center" style={{ color: 'var(--mc-muted)' }}>Нет сделок</div>}
          {deals.map(deal => {
            const last = activities.filter(a => a.deal_id === deal.id).sort((a, b) => (b.call_date || '').localeCompare(a.call_date || ''))[0];
            return (
              <div key={deal.id} onClick={() => onDealClick(deal)} className="rounded-lg p-3 cursor-pointer"
                style={{ background: 'var(--mc-bg)', borderLeft: `3px solid ${stage.color}` }}>
                <div className="flex items-start justify-between mb-1">
                  <div className="font-semibold text-sm" style={{ color: 'var(--mc-text)' }}>{deal.title}</div>
                  {deal.amount > 0 && <span className="text-xs font-bold ml-2 whitespace-nowrap" style={{ color: stage.color }}>{fmtMoney(deal.amount)}</span>}
                </div>
                {deal.client_company && <div className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--mc-muted)' }}><Building2 size={10} /> {deal.client_company}</div>}
                <div className="flex items-center gap-1 text-[11px] mb-1" style={{ color: 'var(--mc-muted)' }}>
                  <User size={10} /> {deal.client_name || 'Не указан'}{deal.client_phone && ` · ${deal.client_phone}`}
                </div>
                <div className="flex items-center justify-between">
                  {deal.manager_name && <div className="text-[10px]" style={{ color: 'var(--mc-muted)' }}>👤 {deal.manager_name}</div>}
                  {last && <div className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--mc-muted)' }}><Clock size={9} /> {fmtDateTime(last.call_date)}</div>}
                </div>
                {deal.next_action && (
                  <div className="mt-1.5 text-[11px] px-2 py-1 rounded" style={{ background: 'var(--mc-surface)', color: '#F59E0B' }}>
                    ▸ {deal.next_action}{deal.next_action_date && <span className="ml-1" style={{ color: 'var(--mc-muted)' }}>({fmtDate(deal.next_action_date)})</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ClosedDeals({ deals, navigate }) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
      <div className="text-[10px] uppercase tracking-wider font-semibold mb-3" style={{ color: 'var(--mc-muted)' }}>Закрытые</div>
      <div className="space-y-2">
        {deals.map(d => (
          <div key={d.id} onClick={() => navigate({ name: 'mpp_deal', dealId: d.id })} className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer" style={{ background: 'var(--mc-bg)' }}>
            <span>{d.stage === 'won' ? '✅' : '❌'}</span>
            <span className="flex-1 text-sm font-medium truncate" style={{ color: 'var(--mc-text)' }}>{d.title}</span>
            {d.amount > 0 && <span className="text-xs" style={{ color: 'var(--mc-muted)' }}>{fmtMoney(d.amount)}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function TasksList({ tasks, deals, canManage, onComplete }) {
  const active = tasks.filter(t => t.status === 'active');
  const done = tasks.filter(t => t.status === 'done');

  const getLeadCount = (task) => deals.filter(d => d.manager_id === task.assigned_to && d.created_at >= task.created_at).length;

  return (
    <div className="space-y-3">
      {active.length === 0 && done.length === 0 && (
        <div className="text-center py-10 text-sm" style={{ color: 'var(--mc-muted)' }}>Нет задач. Нажмите + чтобы поставить задачу менеджеру.</div>
      )}
      {active.map(task => {
        const leads = getLeadCount(task);
        const canClose = leads >= (task.min_leads || 2);
        return (
          <div key={task.id} className="rounded-xl p-4" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="font-semibold text-sm" style={{ color: 'var(--mc-text)' }}>{task.title}</div>
                {task.description && <div className="text-xs mt-0.5" style={{ color: 'var(--mc-muted)' }}>{task.description}</div>}
              </div>
              <div className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: '#F59E0B20', color: '#F59E0B' }}>активна</div>
            </div>
            <div className="flex items-center gap-2 text-xs mb-2" style={{ color: 'var(--mc-muted)' }}>
              <User size={12} /> {task.assigned_to_name}
              {task.deadline && <><span>·</span><Calendar size={12} /> до {fmtDate(task.deadline)}</>}
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-2 w-24 rounded-full overflow-hidden" style={{ background: 'var(--mc-bg)' }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.min((leads / (task.min_leads || 2)) * 100, 100)}%`, background: canClose ? '#22C55E' : '#F59E0B' }} />
                </div>
                <span className="text-xs font-semibold" style={{ color: canClose ? '#22C55E' : '#F59E0B' }}>{leads}/{task.min_leads || 2} лидов</span>
              </div>
              {canManage && (
                <button onClick={() => onComplete(task.id)} disabled={!canClose}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
                  style={{ background: canClose ? '#22C55E' : 'var(--mc-bg)', color: canClose ? '#fff' : 'var(--mc-muted)' }}>
                  <CheckCircle2 size={13} /> Закрыть
                </button>
              )}
            </div>
            <div className="text-[10px] mt-2" style={{ color: 'var(--mc-muted)' }}>Поставил: {task.assigned_by_name} · {fmtDate(task.created_at)}</div>
          </div>
        );
      })}
      {done.length > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-wider font-semibold pt-2" style={{ color: 'var(--mc-muted)' }}>Выполненные</div>
          {done.map(task => (
            <div key={task.id} className="rounded-xl p-3 flex items-center gap-3" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', opacity: 0.6 }}>
              <CheckCircle2 size={16} style={{ color: '#22C55E' }} />
              <div className="flex-1">
                <div className="text-sm font-medium" style={{ color: 'var(--mc-text)' }}>{task.title}</div>
                <div className="text-[10px]" style={{ color: 'var(--mc-muted)' }}>{task.assigned_to_name}</div>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function DealDetailScreen({ ctx, dealId, canManage }) {
  const { db, goBack, showToast, updateMppDeal, addMppActivity, deleteMppDeal,
    addMppDealProduct, removeMppDealProduct, addMppComment } = ctx;
  const deal = (db.mppDeals || []).find(d => d.id === dealId);
  const [moveModal, setMoveModal] = useState(false);
  const [activityModal, setActivityModal] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [productModal, setProductModal] = useState(false);
  const [commentModal, setCommentModal] = useState(false);

  if (!deal) {
    return (
      <div className="p-4">
        <button onClick={goBack} className="text-xs flex items-center gap-1" style={{ color: 'var(--mc-muted)' }}><ChevronLeft size={14} /> Назад</button>
        <div className="text-center mt-10" style={{ color: 'var(--mc-muted)' }}>Сделка не найдена</div>
      </div>
    );
  }

  const stage = STAGES.find(s => s.key === deal.stage) || STAGES[0];
  const activities = (db.mppActivities || []).filter(a => a.deal_id === dealId).sort((a, b) => (b.call_date || '').localeCompare(a.call_date || ''));
  const products = (db.mppDealProducts || []).filter(p => p.deal_id === dealId);
  const comments = (db.mppComments || []).filter(c => c.deal_id === dealId).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const productsTotal = products.reduce((s, p) => s + (Number(p.price) || 0) * (Number(p.quantity) || 1), 0);

  const handleMove = (newStage) => { updateMppDeal(dealId, { stage: newStage }); showToast('Стадия изменена'); setMoveModal(false); };
  const handleDelete = () => { if (!confirm('Удалить сделку?')) return; deleteMppDeal(dealId); showToast('Удалено'); goBack(); };

  return (
    <div>
      <PageHeader title={deal.title} subtitle={`${stage.emoji} ${stage.label}`} onBack={goBack} />
      <div className="px-4 space-y-4 pb-6">
        {/* Stage */}
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: stage.color + '15', border: `1px solid ${stage.color}40` }}>
            <span className="text-lg">{stage.emoji}</span>
            <span className="font-semibold text-sm" style={{ color: stage.color }}>{stage.label}</span>
          </div>
          {canManage && <button onClick={() => setMoveModal(true)} className="px-3 py-2 rounded-xl" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', color: '#3B82F6' }}><ArrowRight size={14} /></button>}
        </div>

        {/* Client */}
        <div className="rounded-xl p-4" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
          <div className="text-[10px] uppercase tracking-wider font-semibold mb-3" style={{ color: 'var(--mc-muted)' }}>Клиент</div>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2"><User size={14} style={{ color: 'var(--mc-muted)' }} /><span style={{ color: 'var(--mc-text)' }}>{deal.client_name || '—'}</span></div>
            {deal.client_company && <div className="flex items-center gap-2"><Building2 size={14} style={{ color: 'var(--mc-muted)' }} /><span style={{ color: 'var(--mc-text)' }}>{deal.client_company}</span></div>}
            {deal.client_phone && <div className="flex items-center gap-2"><Phone size={14} style={{ color: 'var(--mc-muted)' }} /><a href={`tel:${deal.client_phone}`} style={{ color: '#3B82F6' }}>{deal.client_phone}</a></div>}
            {deal.amount > 0 && <div className="font-bold" style={{ color: '#7C3AED' }}>Сумма: {fmtMoney(deal.amount)}</div>}
          </div>
          {deal.notes && <div className="mt-3 pt-3 text-xs" style={{ borderTop: '1px solid var(--mc-border)', color: 'var(--mc-muted)' }}>{deal.notes}</div>}
        </div>

        {/* Next action */}
        {deal.next_action && (
          <div className="rounded-xl p-4" style={{ background: '#FEF3C7', border: '1px solid #F59E0B40' }}>
            <div className="text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: '#92400E' }}>Следующее действие</div>
            <div className="text-sm font-semibold" style={{ color: '#92400E' }}>{deal.next_action}</div>
            {deal.next_action_date && <div className="text-xs mt-0.5" style={{ color: '#B45309' }}>{fmtDate(deal.next_action_date)}</div>}
          </div>
        )}

        {/* Products */}
        <div className="rounded-xl p-4" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--mc-muted)' }}>Товары ({products.length})</div>
            {canManage && <button onClick={() => setProductModal(true)} className="flex items-center gap-1 text-xs font-semibold" style={{ color: '#3B82F6' }}><Plus size={12} /> Товар</button>}
          </div>
          {products.length === 0 && <div className="text-xs text-center py-2" style={{ color: 'var(--mc-muted)' }}>Нет товаров</div>}
          {products.map(p => (
            <div key={p.id} className="flex items-center justify-between px-2 py-1.5 rounded mb-1" style={{ background: 'var(--mc-bg)' }}>
              <div className="flex-1 min-w-0">
                <div className="text-sm" style={{ color: 'var(--mc-text)' }}>{p.product_name}</div>
                <div className="text-[10px]" style={{ color: 'var(--mc-muted)' }}>{p.quantity} шт × {fmtMoney(p.price)}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold" style={{ color: 'var(--mc-text)' }}>{fmtMoney(p.price * p.quantity)}</span>
                {canManage && <button onClick={() => { removeMppDealProduct(p.id); showToast('Удалено'); }} style={{ color: '#EF4444' }}><Trash2 size={12} /></button>}
              </div>
            </div>
          ))}
          {productsTotal > 0 && <div className="text-right text-xs font-bold mt-2" style={{ color: '#7C3AED' }}>Итого: {fmtMoney(productsTotal)}</div>}
        </div>

        {/* Action buttons */}
        {canManage && (
          <div className="grid grid-cols-3 gap-2">
            <button onClick={() => setActivityModal(true)} className="flex flex-col items-center gap-1 py-3 rounded-xl text-[11px] font-semibold"
              style={{ background: '#3B82F620', color: '#3B82F6', border: '1px solid #3B82F640' }}><Phone size={16} />Активность</button>
            <button onClick={() => setCommentModal(true)} className="flex flex-col items-center gap-1 py-3 rounded-xl text-[11px] font-semibold"
              style={{ background: '#F59E0B20', color: '#F59E0B', border: '1px solid #F59E0B40' }}><MessageSquare size={16} />Коммент</button>
            <button onClick={() => setEditModal(true)} className="flex flex-col items-center gap-1 py-3 rounded-xl text-[11px] font-semibold"
              style={{ background: 'var(--mc-bg)', color: 'var(--mc-muted)', border: '1px solid var(--mc-border)' }}><User size={16} />Ред.</button>
          </div>
        )}

        {/* Comments */}
        {comments.length > 0 && (
          <div className="rounded-xl p-4" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
            <div className="text-[10px] uppercase tracking-wider font-semibold mb-3" style={{ color: 'var(--mc-muted)' }}>Комментарии ({comments.length})</div>
            <div className="space-y-3">
              {comments.map(c => (
                <div key={c.id} className="flex gap-3">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: c.is_reminder ? '#F59E0B20' : '#3B82F620' }}>
                    {c.is_reminder ? <Bell size={12} style={{ color: '#F59E0B' }} /> : <MessageSquare size={12} style={{ color: '#3B82F6' }} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold" style={{ color: 'var(--mc-text)' }}>{c.author_name}</span>
                      <span className="text-[10px]" style={{ color: 'var(--mc-muted)' }}>{fmtDateTime(c.created_at)}</span>
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--mc-muted)' }}>{c.text}</div>
                    {c.is_reminder && c.reminder_date && (
                      <div className="flex items-center gap-1 mt-1 text-[10px] font-semibold" style={{ color: '#F59E0B' }}>
                        <Bell size={9} /> Напоминание: {fmtDate(c.reminder_date)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Activity history */}
        <div className="rounded-xl p-4" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
          <div className="text-[10px] uppercase tracking-wider font-semibold mb-3" style={{ color: 'var(--mc-muted)' }}>Активности ({activities.length})</div>
          {activities.length === 0 && <div className="text-xs text-center py-4" style={{ color: 'var(--mc-muted)' }}>Нет активностей</div>}
          <div className="space-y-3">
            {activities.map(act => {
              const t = ACTIVITY_TYPES.find(x => x.key === act.activity_type) || ACTIVITY_TYPES[0];
              const Icon = t.icon;
              return (
                <div key={act.id} className="flex gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: '#3B82F620' }}><Icon size={14} style={{ color: '#3B82F6' }} /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold" style={{ color: 'var(--mc-text)' }}>{t.label}</span>
                      <span className="text-[10px]" style={{ color: 'var(--mc-muted)' }}>{fmtDateTime(act.call_date)}</span>
                    </div>
                    {act.duration_minutes > 0 && <div className="text-[10px]" style={{ color: 'var(--mc-muted)' }}>{act.duration_minutes} мин</div>}
                    {act.result && <div className="text-xs mt-0.5" style={{ color: 'var(--mc-muted)' }}>{act.result}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="text-xs" style={{ color: 'var(--mc-muted)' }}>Менеджер: <strong style={{ color: 'var(--mc-text)' }}>{deal.manager_name || '—'}</strong> · Создано: {fmtDate(deal.created_at)}</div>

        {canManage && (
          <button onClick={handleDelete} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: '#FEE2E2', color: '#991B1B' }}><Trash2 size={14} /> Удалить сделку</button>
        )}
      </div>

      {moveModal && <MoveModal current={deal.stage} onClose={() => setMoveModal(false)} onMove={handleMove} />}
      {activityModal && <AddActivityModal onClose={() => setActivityModal(false)} onSave={data => { addMppActivity(dealId, data); showToast('Добавлено'); setActivityModal(false); }} />}
      {editModal && <EditDealModal deal={deal} onClose={() => setEditModal(false)} onSave={u => { updateMppDeal(dealId, u); showToast('Сохранено'); setEditModal(false); }} />}
      {productModal && <ProductPickerModal products={db.products || []} onClose={() => setProductModal(false)} onAdd={p => { addMppDealProduct(dealId, p); showToast('Товар добавлен'); setProductModal(false); }} />}
      {commentModal && <AddCommentModal onClose={() => setCommentModal(false)} onSave={data => { addMppComment(dealId, data); showToast('Комментарий добавлен'); setCommentModal(false); }} />}
    </div>
  );
}

/* ── Modals ── */

function MoveModal({ current, onClose, onMove }) {
  return (
    <Modal onClose={onClose} title="Перевести в стадию">
      <div className="space-y-2">
        {STAGES.map(s => (
          <button key={s.key} onClick={() => onMove(s.key)} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left"
            style={{ background: s.key === current ? s.color + '20' : 'var(--mc-bg)', border: s.key === current ? `2px solid ${s.color}` : '1px solid var(--mc-border)' }}>
            <span className="text-lg">{s.emoji}</span>
            <span className="font-semibold text-sm" style={{ color: s.key === current ? s.color : 'var(--mc-text)' }}>{s.label}</span>
            {s.key === current && <span className="ml-auto text-xs" style={{ color: s.color }}>текущая</span>}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function NewDealModal({ ctx, onClose, onSave }) {
  const [f, setF] = useState({ title: '', client_name: '', client_phone: '', client_company: '', amount: '', notes: '' });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  return (
    <Modal onClose={onClose} title="Новая сделка">
      <div className="space-y-3">
        <Inp label="Название сделки *" value={f.title} onChange={v => set('title', v)} placeholder="Поставка кофе в офис" />
        <Inp label="Контактное лицо" value={f.client_name} onChange={v => set('client_name', v)} placeholder="Имя клиента" />
        <Inp label="Телефон" value={f.client_phone} onChange={v => set('client_phone', v)} placeholder="+7 ..." type="tel" />
        <Inp label="Компания" value={f.client_company} onChange={v => set('client_company', v)} placeholder="ТОО ..." />
        <Inp label="Сумма (₸)" value={f.amount} onChange={v => set('amount', v)} placeholder="0" type="number" inputMode="decimal" />
        <Inp label="Заметки" value={f.notes} onChange={v => set('notes', v)} placeholder="Детали..." rows={2} />
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg font-semibold" style={{ background: 'var(--mc-bg)', color: 'var(--mc-text)' }}>Отмена</button>
          <button onClick={() => onSave(f)} disabled={f.title.trim().length < 2} className="flex-1 py-2.5 rounded-lg font-semibold text-white disabled:opacity-50" style={{ background: '#7C3AED' }}>Создать</button>
        </div>
      </div>
    </Modal>
  );
}

function EditDealModal({ deal, onClose, onSave }) {
  const [f, setF] = useState({
    title: deal.title || '', client_name: deal.client_name || '', client_phone: deal.client_phone || '',
    client_company: deal.client_company || '', amount: String(deal.amount || ''), notes: deal.notes || '',
    next_action: deal.next_action || '', next_action_date: deal.next_action_date || '',
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  return (
    <Modal onClose={onClose} title="Редактировать">
      <div className="space-y-3">
        <Inp label="Название *" value={f.title} onChange={v => set('title', v)} />
        <Inp label="Контактное лицо" value={f.client_name} onChange={v => set('client_name', v)} />
        <Inp label="Телефон" value={f.client_phone} onChange={v => set('client_phone', v)} type="tel" />
        <Inp label="Компания" value={f.client_company} onChange={v => set('client_company', v)} />
        <Inp label="Сумма (₸)" value={f.amount} onChange={v => set('amount', v)} type="number" inputMode="decimal" />
        <Inp label="Следующее действие" value={f.next_action} onChange={v => set('next_action', v)} placeholder="Перезвонить, отправить КП..." />
        <Inp label="Дата действия" value={f.next_action_date} onChange={v => set('next_action_date', v)} type="date" />
        <Inp label="Заметки" value={f.notes} onChange={v => set('notes', v)} rows={2} />
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg font-semibold" style={{ background: 'var(--mc-bg)', color: 'var(--mc-text)' }}>Отмена</button>
          <button onClick={() => onSave({ ...f, amount: Number(f.amount) || 0, next_action_date: f.next_action_date || null })}
            disabled={f.title.trim().length < 2} className="flex-1 py-2.5 rounded-lg font-semibold text-white disabled:opacity-50" style={{ background: '#22C55E' }}>Сохранить</button>
        </div>
      </div>
    </Modal>
  );
}

function NewTaskModal({ users, onClose, onSave }) {
  const [f, setF] = useState({ title: '', description: '', assigned_to: '', min_leads: '2', deadline: '' });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const valid = f.title.trim().length >= 2 && f.assigned_to;
  return (
    <Modal onClose={onClose} title="Поставить задачу">
      <div className="space-y-3">
        <Inp label="Задача *" value={f.title} onChange={v => set('title', v)} placeholder="Найти 5 новых клиентов" />
        <Inp label="Описание" value={f.description} onChange={v => set('description', v)} placeholder="Подробности..." rows={2} />
        <div>
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>Назначить менеджеру *</label>
          <select value={f.assigned_to} onChange={e => set('assigned_to', e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg outline-none text-sm"
            style={{ border: '1px solid var(--mc-border)', color: 'var(--mc-text)', background: 'var(--mc-bg)' }}>
            <option value="">Выберите...</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
          </select>
        </div>
        <Inp label="Минимум лидов для закрытия" value={f.min_leads} onChange={v => set('min_leads', v)} type="number" inputMode="numeric" />
        <Inp label="Дедлайн" value={f.deadline} onChange={v => set('deadline', v)} type="date" />
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg font-semibold" style={{ background: 'var(--mc-bg)', color: 'var(--mc-text)' }}>Отмена</button>
          <button onClick={() => onSave({ ...f, min_leads: Number(f.min_leads) || 2, deadline: f.deadline || null })}
            disabled={!valid} className="flex-1 py-2.5 rounded-lg font-semibold text-white disabled:opacity-50" style={{ background: '#7C3AED' }}>Назначить</button>
        </div>
      </div>
    </Modal>
  );
}

function AddActivityModal({ onClose, onSave }) {
  const [type, setType] = useState('call');
  const [duration, setDuration] = useState('');
  const [result, setResult] = useState('');
  return (
    <Modal onClose={onClose} title="Добавить активность">
      <div className="space-y-3">
        <div className="grid grid-cols-4 gap-2">
          {ACTIVITY_TYPES.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.key} onClick={() => setType(t.key)} className="flex flex-col items-center gap-1 py-2.5 rounded-lg text-[11px] font-semibold"
                style={{ background: type === t.key ? '#3B82F620' : 'var(--mc-bg)', border: type === t.key ? '2px solid #3B82F6' : '1px solid var(--mc-border)', color: type === t.key ? '#3B82F6' : 'var(--mc-muted)' }}>
                <Icon size={16} />{t.label}
              </button>
            );
          })}
        </div>
        {(type === 'call' || type === 'meeting') && <Inp label="Длительность (мин)" value={duration} onChange={setDuration} type="number" inputMode="numeric" />}
        <Inp label="Результат / Заметка" value={result} onChange={setResult} placeholder="Что обсудили..." rows={3} />
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg font-semibold" style={{ background: 'var(--mc-bg)', color: 'var(--mc-text)' }}>Отмена</button>
          <button onClick={() => onSave({ activity_type: type, duration_minutes: duration, result })} disabled={!result.trim()}
            className="flex-1 py-2.5 rounded-lg font-semibold text-white disabled:opacity-50" style={{ background: '#3B82F6' }}>Сохранить</button>
        </div>
      </div>
    </Modal>
  );
}

function ProductPickerModal({ products, onClose, onAdd }) {
  const [search, setSearch] = useState('');
  const [qty, setQty] = useState('1');
  const active = products.filter(p => p.active);
  const filtered = search ? active.filter(p => p.name.toLowerCase().includes(search.toLowerCase())) : active;

  return (
    <Modal onClose={onClose} title="Добавить товар">
      <div className="space-y-3">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск товара..." autoFocus
          className="w-full px-3 py-2.5 rounded-lg outline-none text-sm"
          style={{ border: '1px solid var(--mc-border)', color: 'var(--mc-text)', background: 'var(--mc-bg)' }} />
        <div className="max-h-60 overflow-y-auto space-y-1">
          {filtered.length === 0 && <div className="text-xs text-center py-4" style={{ color: 'var(--mc-muted)' }}>Нет товаров</div>}
          {filtered.slice(0, 30).map(p => (
            <div key={p.id} onClick={() => onAdd({ id: p.id, name: p.name, quantity: Number(qty) || 1, price: Number(p.price) || 0 })}
              className="flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer"
              style={{ background: 'var(--mc-bg)', border: '1px solid var(--mc-border)' }}>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate" style={{ color: 'var(--mc-text)' }}>{p.name}</div>
                {p.category && <div className="text-[10px]" style={{ color: 'var(--mc-muted)' }}>{p.category}</div>}
              </div>
              <div className="text-xs font-bold ml-2" style={{ color: '#7C3AED' }}>{fmtMoney(p.price || 0)}</div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function AddCommentModal({ onClose, onSave }) {
  const [text, setText] = useState('');
  const [isReminder, setIsReminder] = useState(false);
  const [reminderDate, setReminderDate] = useState('');

  return (
    <Modal onClose={onClose} title="Комментарий">
      <div className="space-y-3">
        <Inp label="Текст *" value={text} onChange={setText} placeholder="Заметка по клиенту..." rows={3} />
        <div className="flex items-center gap-3" onClick={() => setIsReminder(!isReminder)} style={{ cursor: 'pointer' }}>
          <div className="w-10 h-6 rounded-full relative" style={{ background: isReminder ? '#F59E0B' : 'var(--mc-border)', transition: 'background .2s' }}>
            <div style={{ position: 'absolute', top: 3, left: isReminder ? 17 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 2px rgba(0,0,0,.2)' }} />
          </div>
          <span className="text-sm" style={{ color: 'var(--mc-text)' }}>Напоминание</span>
        </div>
        {isReminder && <Inp label="Дата напоминания" value={reminderDate} onChange={setReminderDate} type="date" />}
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg font-semibold" style={{ background: 'var(--mc-bg)', color: 'var(--mc-text)' }}>Отмена</button>
          <button onClick={() => onSave({ text, is_reminder: isReminder, reminder_date: reminderDate || null })} disabled={!text.trim()}
            className="flex-1 py-2.5 rounded-lg font-semibold text-white disabled:opacity-50" style={{ background: '#F59E0B' }}>Сохранить</button>
        </div>
      </div>
    </Modal>
  );
}
