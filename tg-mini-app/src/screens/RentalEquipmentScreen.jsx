import React, { useState, useMemo } from 'react';
import {
  Plus, ChevronRight, ChevronLeft, Search, Wrench, User, Truck,
  Check, AlertTriangle, Edit3, Trash2, Package, ClipboardList, ClipboardPaste,
  ArrowLeftRight, Coffee, Phone, MapPin, Link2,
} from 'lucide-react';
import { EquipmentImportModal } from './RentalImportModal';
import { ClientPickerModal } from './ClientsScreen';

const TZ = 'Asia/Almaty';
const inputCls = 'w-full px-3 py-2 rounded-lg outline-none text-sm';
const inputBorder = (e) => ({ border: `1px solid ${e ? '#EB5757' : 'var(--mc-border)'}` });
const btnCancel = { background: 'var(--mc-surface)', color: 'var(--mc-muted)', border: '1px solid var(--mc-border)' };
const fmtDate = (iso) => iso ? new Date(iso).toLocaleString('ru-KZ', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: TZ }) : '—';
const fmtNum = (n) => (Number(n) || 0).toLocaleString('ru-RU').replace(/\s/g, ' ');
const todayStr = () => { const d = new Date(); d.setMinutes(d.getMinutes() + 300); return d.toISOString().slice(0, 10); };
const monthNow = () => todayStr().slice(0, 7);

const EQ_STATUS = {
  in_office:   { label: 'В офисе',    color: '#3B82F6', bg: 'var(--mc-info-bg)' },
  rented:      { label: 'В аренде',   color: '#22C55E', bg: 'var(--mc-success-bg)' },
  in_repair:   { label: 'В ремонте',  color: '#F59E0B', bg: 'var(--mc-warning-bg)' },
  written_off: { label: 'Списано',    color: 'var(--mc-neutral-text)', bg: 'var(--mc-neutral-bg)' },
};
const MOVE_TYPES = {
  to_client:   { label: 'Передача клиенту', icon: Truck },
  from_client: { label: 'Возврат от клиента', icon: ArrowLeftRight },
  to_repair:   { label: 'В ремонт', icon: Wrench },
  from_repair: { label: 'Из ремонта', icon: Check },
  write_off:   { label: 'Списание', icon: Trash2 },
};

const Tabs = ({ items, value, onChange }) => (
  <div className="flex gap-1 mb-3 overflow-x-auto pb-1">
    {items.map(t => <button key={t.id} onClick={() => onChange(t.id)} className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold"
      style={{ background: value === t.id ? '#3B82F6' : 'var(--mc-surface)', color: value === t.id ? '#fff' : '#64748B', border: `1px solid ${value === t.id ? '#3B82F6' : 'var(--mc-border)'}` }}>{t.label}{t.count != null ? ` (${t.count})` : ''}</button>)}
  </div>
);

const StatusBadge = ({ status }) => {
  const m = EQ_STATUS[status] || EQ_STATUS.in_office;
  return <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: m.bg, color: m.color }}>{m.label}</span>;
};

export function RentalEquipmentScreen({ ctx }) {
  const { route } = ctx;
  if (route.name === 'rental_equipment_form') return <EquipmentFormScreen ctx={ctx} equipmentId={route.equipmentId} />;
  if (route.name === 'rental_equipment_detail') return <EquipmentDetailScreen ctx={ctx} equipmentId={route.equipmentId} />;
  if (route.name === 'rental_client_form') return <RentalClientFormScreen ctx={ctx} clientId={route.clientId} />;
  if (route.name === 'rental_client_detail') return <RentalClientDetailScreen ctx={ctx} clientId={route.clientId} />;
  if (route.name === 'rental_movement_form') return <MovementFormScreen ctx={ctx} equipmentId={route.equipmentId} />;
  if (route.name === 'rental_revision_form') return <RevisionFormScreen ctx={ctx} />;
  return <RentalHomeScreen ctx={ctx} />;
}

export function RentalHomeBanner({ ctx }) {
  const eq = ctx.db.rentalEquipment || [];
  const rented = eq.filter(e => e.status === 'rented').length;
  const repair = eq.filter(e => e.status === 'in_repair').length;
  const clients = (ctx.db.rentalClients || []).filter(c => c.status === 'active').length;
  if (!eq.length && !clients) return null;
  return (
    <button onClick={() => ctx.navigate({ name: 'rental_home' })} className="w-full rounded-2xl p-4 text-left" style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #A78BFA 100%)' }}>
      <div className="text-white font-bold text-sm mb-1"><Wrench size={14} className="inline mr-1" />Арендное оборудование</div>
      <div className="text-white/80 text-xs">В аренде: {rented} · Ремонт: {repair} · Клиентов: {clients}</div>
    </button>
  );
}

function RentalHomeScreen({ ctx }) {
  const [tab, setTab] = useState('equipment');
  const isAdmin = ctx.currentUser?.role === 'admin' || ctx.currentUser?.role === 'director';
  const canEquip = isAdmin || ctx.hasPermission('rental_equipment');
  const canClients = isAdmin || ctx.hasPermission('rental_clients');
  const canPurchases = isAdmin || ctx.hasPermission('rental_purchases');
  const canRevisions = isAdmin || ctx.hasPermission('rental_revisions');
  const canReport = isAdmin || ctx.hasPermission('rental_report');

  const tabs = [];
  if (canEquip) tabs.push({ id: 'equipment', label: 'Оборудование' });
  if (canClients) tabs.push({ id: 'clients', label: 'Клиенты' });
  if (canPurchases) tabs.push({ id: 'purchases', label: 'Закуп' });
  if (canRevisions) tabs.push({ id: 'revisions', label: 'Ревизии' });
  if (canReport) tabs.push({ id: 'report', label: 'Отчёт' });

  if (!tabs.length) return <div className="p-6 text-center text-sm" style={{ color: 'var(--mc-muted)' }}>Нет доступа</div>;
  if (!tabs.find(t => t.id === tab)) setTab(tabs[0].id);

  return (
    <div className="p-4">
      <Tabs items={tabs} value={tab} onChange={setTab} />
      {tab === 'equipment' && <EquipmentListTab ctx={ctx} />}
      {tab === 'clients' && <ClientsListTab ctx={ctx} />}
      {tab === 'purchases' && <PurchasesTab ctx={ctx} />}
      {tab === 'revisions' && <RevisionsTab ctx={ctx} />}
      {tab === 'report' && <ReportTab ctx={ctx} />}
    </div>
  );
}


function EquipmentListTab({ ctx }) {
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [showImport, setShowImport] = useState(false);
  const isAdmin = ctx.currentUser?.role === 'admin' || ctx.currentUser?.role === 'director';
  const canManage = isAdmin || ctx.hasPermission('rental_equipment');
  const equipment = ctx.db.rentalEquipment || [];
  const clients = ctx.db.rentalClients || [];

  const filtered = useMemo(() => {
    let list = equipment;
    if (filter !== 'all') list = list.filter(e => e.status === filter);
    if (q.trim()) {
      const s = q.toLowerCase();
      list = list.filter(e => (e.type + ' ' + (e.model || '') + ' ' + (e.serial_number || '')).toLowerCase().includes(s));
    }
    return list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }, [equipment, filter, q]);

  const counts = useMemo(() => {
    const c = { all: equipment.length };
    Object.keys(EQ_STATUS).forEach(k => { c[k] = equipment.filter(e => e.status === k).length; });
    return c;
  }, [equipment]);

  const clientName = (id) => clients.find(c => c.id === id)?.name || '';

  return (
    <>
      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-2.5" style={{ color: 'var(--mc-muted)' }} />
          <input className={inputCls + ' pl-8'} style={inputBorder()} placeholder="Поиск..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {canManage && <button onClick={() => setShowImport(true)} className="rounded-xl px-3 py-2 text-sm font-semibold" style={{ background: 'var(--mc-purple-bg)', color: 'var(--mc-purple-text)', border: '1px solid var(--mc-purple-border)' }}><ClipboardPaste size={16} /></button>}
        {canManage && <button onClick={() => ctx.navigate({ name: 'rental_equipment_form' })} className="rounded-xl px-4 py-2 text-sm font-semibold text-white" style={{ background: '#3B82F6' }}><Plus size={16} /></button>}
      </div>
      <Tabs items={[{ id: 'all', label: 'Все', count: counts.all }, ...Object.entries(EQ_STATUS).map(([k, v]) => ({ id: k, label: v.label, count: counts[k] }))]} value={filter} onChange={setFilter} />
      {!filtered.length && <div className="text-center py-8 text-sm" style={{ color: 'var(--mc-muted)' }}>Нет оборудования</div>}
      {filtered.map(eq => (
        <button key={eq.id} onClick={() => ctx.navigate({ name: 'rental_equipment_detail', equipmentId: eq.id })} className="w-full text-left rounded-xl p-3 mb-2" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
          <div className="flex justify-between items-start">
            <div>
              <div className="font-semibold text-sm">{eq.type}{eq.model ? ` · ${eq.model}` : ''}</div>
              {eq.serial_number && <div className="text-xs mt-0.5" style={{ color: 'var(--mc-muted)' }}>S/N: {eq.serial_number}</div>}
              {eq.status === 'rented' && eq.current_client_id && <div className="text-xs mt-0.5" style={{ color: '#22C55E' }}>{clientName(eq.current_client_id)}</div>}
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={eq.status} />
              <ChevronRight size={16} style={{ color: 'var(--mc-muted)' }} />
            </div>
          </div>
        </button>
      ))}
      {showImport && <EquipmentImportModal onClose={() => setShowImport(false)} onCreate={ctx.createRentalEquipment} />}
    </>
  );
}

function EquipmentFormScreen({ ctx, equipmentId }) {
  const existing = equipmentId ? (ctx.db.rentalEquipment || []).find(e => e.id === equipmentId) : null;
  const [form, setForm] = useState({
    type: existing?.type || '', model: existing?.model || '', serial_number: existing?.serial_number || '',
    residual_value: existing?.residual_value || '', status: existing?.status || 'in_office', notes: existing?.notes || '',
  });
  const [err, setErr] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = () => {
    if (!form.type.trim()) return setErr('Укажите вид оборудования');
    const result = existing ? ctx.updateRentalEquipment(equipmentId, form) : ctx.createRentalEquipment(form);
    if (result?.error) return setErr(result.error);
    ctx.navigate({ name: 'rental_home' });
  };

  return (
    <div className="p-4">
      <button onClick={() => ctx.navigate({ name: existing ? 'rental_equipment_detail' : 'rental_home', equipmentId })} className="flex items-center gap-1 mb-4 text-sm font-medium" style={{ color: '#3B82F6' }}><ChevronLeft size={16} />Назад</button>
      <h2 className="text-lg font-bold mb-4">{existing ? 'Редактировать' : 'Новое оборудование'}</h2>
      {err && <div className="mb-3 text-sm text-red-500">{err}</div>}
      <label className="block text-xs font-medium mb-1">Вид оборудования *</label>
      <input className={inputCls} style={inputBorder(!form.type.trim() && err)} value={form.type} onChange={e => set('type', e.target.value)} placeholder="Кофемашина, кофемолка..." />
      <label className="block text-xs font-medium mb-1 mt-3">Модель</label>
      <input className={inputCls} style={inputBorder()} value={form.model} onChange={e => set('model', e.target.value)} />
      <label className="block text-xs font-medium mb-1 mt-3">Серийный номер</label>
      <input className={inputCls} style={inputBorder()} value={form.serial_number} onChange={e => set('serial_number', e.target.value)} />
      <label className="block text-xs font-medium mb-1 mt-3">Остаточная стоимость (тг)</label>
      <input className={inputCls} style={inputBorder()} type="number" value={form.residual_value} onChange={e => set('residual_value', e.target.value)} />
      <label className="block text-xs font-medium mb-1 mt-3">Примечание</label>
      <textarea className={inputCls} style={inputBorder()} rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
      <div className="flex gap-2 mt-4">
        <button onClick={() => ctx.navigate({ name: 'rental_home' })} className="flex-1 py-2.5 rounded-xl text-sm font-semibold" style={btnCancel}>Отмена</button>
        <button onClick={save} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: '#3B82F6' }}>Сохранить</button>
      </div>
    </div>
  );
}

function EquipmentDetailScreen({ ctx, equipmentId }) {
  const eq = (ctx.db.rentalEquipment || []).find(e => e.id === equipmentId);
  const clients = ctx.db.rentalClients || [];
  const movements = (ctx.db.rentalMovements || []).filter(m => m.equipment_id === equipmentId).sort((a, b) => (b.moved_at || '').localeCompare(a.moved_at || ''));
  const isAdmin = ctx.currentUser?.role === 'admin' || ctx.currentUser?.role === 'director';
  const canManage = isAdmin || ctx.hasPermission('rental_equipment');
  if (!eq) return <div className="p-4 text-sm" style={{ color: 'var(--mc-muted)' }}>Оборудование не найдено</div>;
  const clientName = (id) => clients.find(c => c.id === id)?.name || '—';

  const handleDelete = async () => {
    if (!confirm('Удалить оборудование?')) return;
    const r = await ctx.deleteRentalEquipment(equipmentId);
    if (r?.error) return;
    ctx.navigate({ name: 'rental_home' });
  };

  return (
    <div className="p-4">
      <button onClick={() => ctx.navigate({ name: 'rental_home' })} className="flex items-center gap-1 mb-4 text-sm font-medium" style={{ color: '#3B82F6' }}><ChevronLeft size={16} />Назад</button>
      <div className="flex justify-between items-start mb-4">
        <div>
          <h2 className="text-lg font-bold">{eq.type}{eq.model ? ` · ${eq.model}` : ''}</h2>
          {eq.serial_number && <div className="text-xs mt-0.5" style={{ color: 'var(--mc-muted)' }}>S/N: {eq.serial_number}</div>}
        </div>
        <StatusBadge status={eq.status} />
      </div>
      <div className="rounded-xl p-3 mb-3" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
        {eq.residual_value > 0 && <div className="text-xs mb-1">Остаточная стоимость: <b>{fmtNum(eq.residual_value)} тг</b></div>}
        {eq.current_client_id && <div className="text-xs mb-1">Текущий клиент: <b>{clientName(eq.current_client_id)}</b></div>}
        {eq.current_location && <div className="text-xs">Местонахождение: {eq.current_location}</div>}
        {eq.notes && <div className="text-xs mt-1" style={{ color: 'var(--mc-muted)' }}>{eq.notes}</div>}
      </div>
      {canManage && (
        <div className="flex gap-2 mb-4">
          <button onClick={() => ctx.navigate({ name: 'rental_equipment_form', equipmentId })} className="flex-1 py-2 rounded-xl text-sm font-semibold" style={{ background: 'var(--mc-info-bg)', color: 'var(--mc-info-text)', border: '1px solid var(--mc-info-border)' }}><Edit3 size={14} className="inline mr-1" />Изменить</button>
          <button onClick={() => ctx.navigate({ name: 'rental_movement_form', equipmentId })} className="flex-1 py-2 rounded-xl text-sm font-semibold" style={{ background: 'var(--mc-success-bg)', color: '#22C55E', border: '1px solid var(--mc-success-border)' }}><ArrowLeftRight size={14} className="inline mr-1" />Перемещение</button>
          <button onClick={handleDelete} className="py-2 px-3 rounded-xl text-sm" style={{ background: 'var(--mc-danger-bg)', color: '#EF4444', border: '1px solid var(--mc-danger-border)' }}><Trash2 size={14} /></button>
        </div>
      )}
      <h3 className="font-semibold text-sm mb-2">История перемещений</h3>
      {!movements.length && <div className="text-xs py-4 text-center" style={{ color: 'var(--mc-muted)' }}>Нет перемещений</div>}
      {movements.map(m => (
        <div key={m.id} className="rounded-xl p-2.5 mb-1.5 text-xs" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
          <div className="flex justify-between">
            <span className="font-semibold">{MOVE_TYPES[m.movement_type]?.label || m.movement_type}</span>
            <span style={{ color: 'var(--mc-muted)' }}>{fmtDate(m.moved_at)}</span>
          </div>
          {m.to_location && <div className="mt-0.5">→ {m.client_id ? clientName(m.client_id) : m.to_location}</div>}
          {m.notes && <div style={{ color: 'var(--mc-muted)' }}>{m.notes}</div>}
        </div>
      ))}
    </div>
  );
}

function MovementFormScreen({ ctx, equipmentId }) {
  const eq = (ctx.db.rentalEquipment || []).find(e => e.id === equipmentId);
  const clients = (ctx.db.rentalClients || []).filter(c => c.status === 'active');
  const [form, setForm] = useState({ movement_type: 'to_client', client_id: '', to_location: '', notes: '' });
  const [err, setErr] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  if (!eq) return <div className="p-4 text-sm" style={{ color: 'var(--mc-muted)' }}>Оборудование не найдено</div>;

  const availableTypes = useMemo(() => {
    const s = eq.status;
    if (s === 'in_office') return ['to_client', 'to_repair', 'write_off'];
    if (s === 'rented') return ['from_client'];
    if (s === 'in_repair') return ['from_repair', 'write_off'];
    return [];
  }, [eq.status]);

  const save = () => {
    if (form.movement_type === 'to_client' && !form.client_id) return setErr('Выберите клиента');
    const result = ctx.createRentalMovement({ ...form, equipment_id: equipmentId });
    if (result?.error) return setErr(result.error);
    ctx.navigate({ name: 'rental_equipment_detail', equipmentId });
  };

  return (
    <div className="p-4">
      <button onClick={() => ctx.navigate({ name: 'rental_equipment_detail', equipmentId })} className="flex items-center gap-1 mb-4 text-sm font-medium" style={{ color: '#3B82F6' }}><ChevronLeft size={16} />Назад</button>
      <h2 className="text-lg font-bold mb-1">Перемещение</h2>
      <div className="text-xs mb-4" style={{ color: 'var(--mc-muted)' }}>{eq.type}{eq.model ? ` · ${eq.model}` : ''} — <StatusBadge status={eq.status} /></div>
      {err && <div className="mb-3 text-sm text-red-500">{err}</div>}
      {!availableTypes.length && <div className="text-sm py-4" style={{ color: 'var(--mc-muted)' }}>Для данного статуса нет доступных перемещений</div>}
      {availableTypes.length > 0 && <>
        <label className="block text-xs font-medium mb-1">Тип перемещения</label>
        <div className="flex gap-1.5 mb-3 flex-wrap">
          {availableTypes.map(t => <button key={t} onClick={() => set('movement_type', t)} className="rounded-full px-3 py-1.5 text-xs font-semibold"
            style={{ background: form.movement_type === t ? '#3B82F6' : 'var(--mc-surface)', color: form.movement_type === t ? '#fff' : '#64748B', border: `1px solid ${form.movement_type === t ? '#3B82F6' : 'var(--mc-border)'}` }}>{MOVE_TYPES[t]?.label}</button>)}
        </div>
        {form.movement_type === 'to_client' && <>
          <label className="block text-xs font-medium mb-1">Клиент *</label>
          <select className={inputCls} style={inputBorder()} value={form.client_id} onChange={e => set('client_id', e.target.value)}>
            <option value="">Выберите клиента</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </>}
        <label className="block text-xs font-medium mb-1 mt-3">Примечание</label>
        <textarea className={inputCls} style={inputBorder()} rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
        <div className="flex gap-2 mt-4">
          <button onClick={() => ctx.navigate({ name: 'rental_equipment_detail', equipmentId })} className="flex-1 py-2.5 rounded-xl text-sm font-semibold" style={btnCancel}>Отмена</button>
          <button onClick={save} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: '#3B82F6' }}>Подтвердить</button>
        </div>
      </>}
    </div>
  );
}

function ClientsListTab({ ctx }) {
  const [q, setQ] = useState('');
  const isAdmin = ctx.currentUser?.role === 'admin' || ctx.currentUser?.role === 'director';
  const canManage = isAdmin || ctx.hasPermission('rental_clients');
  const clients = ctx.db.rentalClients || [];
  const equipment = ctx.db.rentalEquipment || [];

  const filtered = useMemo(() => {
    let list = clients.filter(c => c.status === 'active');
    if (q.trim()) { const s = q.toLowerCase(); list = list.filter(c => (c.name + ' ' + (c.address || '')).toLowerCase().includes(s)); }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [clients, q]);

  const eqCount = (cid) => equipment.filter(e => e.current_client_id === cid && e.status === 'rented').length;

  return (
    <>
      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-2.5" style={{ color: 'var(--mc-muted)' }} />
          <input className={inputCls + ' pl-8'} style={inputBorder()} placeholder="Поиск..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {canManage && <button onClick={() => ctx.navigate({ name: 'rental_client_form' })} className="rounded-xl px-4 py-2 text-sm font-semibold text-white" style={{ background: '#3B82F6' }}><Plus size={16} /></button>}
      </div>
      {!filtered.length && <div className="text-center py-8 text-sm" style={{ color: 'var(--mc-muted)' }}>Нет клиентов</div>}
      {filtered.map(c => (
        <button key={c.id} onClick={() => ctx.navigate({ name: 'rental_client_detail', clientId: c.id })} className="w-full text-left rounded-xl p-3 mb-2" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
          <div className="flex justify-between items-center">
            <div>
              <div className="font-semibold text-sm">{c.name}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--mc-muted)' }}>
                {c.address && <><MapPin size={10} className="inline mr-0.5" />{c.address} · </>}
                План: {c.plan_kg || 0} кг/мес
              </div>
            </div>
            <div className="flex items-center gap-2">
              {eqCount(c.id) > 0 && <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: 'var(--mc-success-bg)', color: '#22C55E' }}><Package size={10} className="inline mr-0.5" />{eqCount(c.id)}</span>}
              <ChevronRight size={16} style={{ color: 'var(--mc-muted)' }} />
            </div>
          </div>
        </button>
      ))}
    </>
  );
}

function RentalClientFormScreen({ ctx, clientId }) {
  const existing = clientId ? (ctx.db.rentalClients || []).find(c => c.id === clientId) : null;
  const users = ctx.db.users || [];
  const [form, setForm] = useState({
    name: existing?.name || '', address: existing?.address || '', contact_person: existing?.contact_person || '',
    phone: existing?.phone || '', plan_kg: existing?.plan_kg || '', plan_price_per_kg: existing?.plan_price_per_kg || '',
    coffee_type: existing?.coffee_type || '', purchase_day: existing?.purchase_day || '',
    contract_link: existing?.contract_link || '', manager_id: existing?.manager_id || '', technician_id: existing?.technician_id || '',
    notes: existing?.notes || '',
  });
  const [err, setErr] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = () => {
    if (!form.name.trim()) return setErr('Укажите наименование');
    const result = existing ? ctx.updateRentalClient(clientId, form) : ctx.createRentalClient(form);
    if (result?.error) return setErr(result.error);
    ctx.navigate({ name: 'rental_home' });
  };

  return (
    <div className="p-4">
      <button onClick={() => ctx.navigate({ name: existing ? 'rental_client_detail' : 'rental_home', clientId })} className="flex items-center gap-1 mb-4 text-sm font-medium" style={{ color: '#3B82F6' }}><ChevronLeft size={16} />Назад</button>
      <h2 className="text-lg font-bold mb-4">{existing ? 'Редактировать клиента' : 'Новый клиент'}</h2>
      {err && <div className="mb-3 text-sm text-red-500">{err}</div>}
      <label className="block text-xs font-medium mb-1">Наименование *</label>
      <input className={inputCls} style={inputBorder()} value={form.name} onChange={e => set('name', e.target.value)} />
      <label className="block text-xs font-medium mb-1 mt-3">Адрес</label>
      <input className={inputCls} style={inputBorder()} value={form.address} onChange={e => set('address', e.target.value)} />
      <div className="grid grid-cols-2 gap-2 mt-3">
        <div><label className="block text-xs font-medium mb-1">Контактное лицо</label><input className={inputCls} style={inputBorder()} value={form.contact_person} onChange={e => set('contact_person', e.target.value)} /></div>
        <div><label className="block text-xs font-medium mb-1">Телефон</label><input className={inputCls} style={inputBorder()} value={form.phone} onChange={e => set('phone', e.target.value)} /></div>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3">
        <div><label className="block text-xs font-medium mb-1">План (кг/мес)</label><input className={inputCls} style={inputBorder()} type="number" value={form.plan_kg} onChange={e => set('plan_kg', e.target.value)} /></div>
        <div><label className="block text-xs font-medium mb-1">Цена за кг (тг)</label><input className={inputCls} style={inputBorder()} type="number" value={form.plan_price_per_kg} onChange={e => set('plan_price_per_kg', e.target.value)} /></div>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3">
        <div><label className="block text-xs font-medium mb-1">Вид кофе</label><input className={inputCls} style={inputBorder()} value={form.coffee_type} onChange={e => set('coffee_type', e.target.value)} /></div>
        <div><label className="block text-xs font-medium mb-1">День закупа</label><input className={inputCls} style={inputBorder()} type="number" min="1" max="31" value={form.purchase_day} onChange={e => set('purchase_day', e.target.value)} /></div>
      </div>
      <label className="block text-xs font-medium mb-1 mt-3">Ссылка на договор</label>
      <input className={inputCls} style={inputBorder()} value={form.contract_link} onChange={e => set('contract_link', e.target.value)} placeholder="https://..." />
      <label className="block text-xs font-medium mb-1 mt-3">Менеджер</label>
      <select className={inputCls} style={inputBorder()} value={form.manager_id} onChange={e => set('manager_id', e.target.value)}>
        <option value="">—</option>
        {users.filter(u => u.active !== false).map(u => <option key={u.id} value={u.id}>{u.first_name || u.username || u.id}</option>)}
      </select>
      <label className="block text-xs font-medium mb-1 mt-3">Техник</label>
      <select className={inputCls} style={inputBorder()} value={form.technician_id} onChange={e => set('technician_id', e.target.value)}>
        <option value="">—</option>
        {users.filter(u => u.active !== false).map(u => <option key={u.id} value={u.id}>{u.first_name || u.username || u.id}</option>)}
      </select>
      <label className="block text-xs font-medium mb-1 mt-3">Примечание</label>
      <textarea className={inputCls} style={inputBorder()} rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
      <div className="flex gap-2 mt-4">
        <button onClick={() => ctx.navigate({ name: 'rental_home' })} className="flex-1 py-2.5 rounded-xl text-sm font-semibold" style={btnCancel}>Отмена</button>
        <button onClick={save} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: '#3B82F6' }}>Сохранить</button>
      </div>
    </div>
  );
}

function RentalClientDetailScreen({ ctx, clientId }) {
  const client = (ctx.db.rentalClients || []).find(c => c.id === clientId);
  const equipment = (ctx.db.rentalEquipment || []).filter(e => e.current_client_id === clientId && e.status === 'rented');
  const purchases = (ctx.db.rentalPurchases || []).filter(p => p.client_id === clientId).sort((a, b) => b.month.localeCompare(a.month));
  const users = ctx.db.users || [];
  const isAdmin = ctx.currentUser?.role === 'admin' || ctx.currentUser?.role === 'director';
  const canManage = isAdmin || ctx.hasPermission('rental_clients');
  const [pickerOpen, setPickerOpen] = useState(false);
  if (!client) return <div className="p-4 text-sm" style={{ color: 'var(--mc-muted)' }}>Клиент не найден</div>;
  const userName = (id) => { const u = users.find(x => x.id === id); return u ? (u.first_name || u.username || '—') : '—'; };
  const linkedClient = client.client_id ? (ctx.db.clients || []).find(c => c.id === client.client_id) : null;

  return (
    <div className="p-4">
      <button onClick={() => ctx.navigate({ name: 'rental_home' })} className="flex items-center gap-1 mb-4 text-sm font-medium" style={{ color: '#3B82F6' }}><ChevronLeft size={16} />Назад</button>
      <div className="flex justify-between items-start mb-3">
        <h2 className="text-lg font-bold">{client.name}</h2>
        {canManage && <button onClick={() => ctx.navigate({ name: 'rental_client_form', clientId })} className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ background: 'var(--mc-info-bg)', color: 'var(--mc-info-text)' }}><Edit3 size={12} className="inline mr-1" />Изменить</button>}
      </div>
      <div className="rounded-xl p-3 mb-3 text-xs" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
        {client.address && <div className="mb-1"><MapPin size={10} className="inline mr-1" />{client.address}</div>}
        {client.phone && <div className="mb-1"><Phone size={10} className="inline mr-1" />{client.phone}</div>}
        {client.contact_person && <div className="mb-1"><User size={10} className="inline mr-1" />{client.contact_person}</div>}
        <div className="mb-1">План: <b>{client.plan_kg || 0} кг/мес</b> · Цена: <b>{fmtNum(client.plan_price_per_kg)} тг/кг</b></div>
        {client.coffee_type && <div className="mb-1">Кофе: {client.coffee_type}</div>}
        {client.purchase_day && <div className="mb-1">День закупа: {client.purchase_day}-е число</div>}
        <div>Менеджер: {userName(client.manager_id)} · Техник: {userName(client.technician_id)}</div>
        {client.contract_link && <a href={client.contract_link} target="_blank" rel="noopener noreferrer" className="text-blue-500 underline block mt-1">Договор</a>}
        <div className="mt-2 pt-2" style={{ borderTop: '1px solid var(--mc-border-light)' }}>
          {linkedClient ? (
            <div className="flex items-center justify-between gap-2">
              <button onClick={() => ctx.navigate({ name: 'client_detail', clientId: linkedClient.id })} className="font-semibold" style={{ color: '#297b8a' }}>
                <Link2 size={11} className="inline mr-1" />{linkedClient.name} →
              </button>
              {canManage && <button onClick={() => setPickerOpen(true)} style={{ color: 'var(--mc-muted)' }}>изменить</button>}
            </div>
          ) : canManage && (
            <button onClick={() => setPickerOpen(true)} className="flex items-center gap-1 font-semibold" style={{ color: '#297b8a' }}>
              <Link2 size={11} />Связать с клиентом из базы
            </button>
          )}
        </div>
      </div>
      {pickerOpen && (
        <ClientPickerModal
          ctx={ctx}
          onClose={() => setPickerOpen(false)}
          onSelect={(c) => {
            const r = ctx.updateRentalClient(client.id, { client_id: c.id });
            if (r?.error) return ctx.showToast(r.error);
            setPickerOpen(false);
            ctx.showToast(`Связано с клиентом «${c.name}»`);
          }}
        />
      )}
      <h3 className="font-semibold text-sm mb-2"><Package size={14} className="inline mr-1" />Оборудование у клиента ({equipment.length})</h3>
      {!equipment.length && <div className="text-xs py-2 mb-3" style={{ color: 'var(--mc-muted)' }}>Нет оборудования</div>}
      {equipment.map(e => (
        <button key={e.id} onClick={() => ctx.navigate({ name: 'rental_equipment_detail', equipmentId: e.id })} className="w-full text-left rounded-xl p-2.5 mb-1.5 text-xs" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
          {e.type}{e.model ? ` · ${e.model}` : ''}{e.serial_number ? ` (${e.serial_number})` : ''} <ChevronRight size={12} className="inline" />
        </button>
      ))}
      <h3 className="font-semibold text-sm mb-2 mt-3"><Coffee size={14} className="inline mr-1" />Закупки</h3>
      {!purchases.length && <div className="text-xs py-2" style={{ color: 'var(--mc-muted)' }}>Нет данных о закупках</div>}
      {purchases.slice(0, 6).map(p => {
        const planKg = Number(client.plan_kg) || 0;
        const fact = Number(p.kg_fact) || 0;
        const pct = planKg > 0 ? Math.round(fact / planKg * 100) : 0;
        const ok = pct >= 100;
        return (
          <div key={p.id} className="rounded-xl p-2.5 mb-1.5 text-xs" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
            <div className="flex justify-between"><span className="font-semibold">{p.month}</span><span style={{ color: ok ? '#22C55E' : '#F59E0B' }}>{pct}% плана</span></div>
            <div>Факт: {fact} кг · {fmtNum(p.amount_fact)} тг</div>
          </div>
        );
      })}
    </div>
  );
}

function PurchasesTab({ ctx }) {
  const [month, setMonth] = useState(monthNow());
  const clients = (ctx.db.rentalClients || []).filter(c => c.status === 'active');
  const purchases = ctx.db.rentalPurchases || [];
  const [editing, setEditing] = useState(null);
  const [kg, setKg] = useState('');
  const [amt, setAmt] = useState('');

  const monthPurchases = useMemo(() => {
    const map = {};
    purchases.filter(p => p.month === month).forEach(p => { map[p.client_id] = p; });
    return map;
  }, [purchases, month]);

  const prevMonth = () => { const d = new Date(month + '-01'); d.setMonth(d.getMonth() - 1); setMonth(d.toISOString().slice(0, 7)); };
  const nextMonth = () => { const d = new Date(month + '-01'); d.setMonth(d.getMonth() + 1); setMonth(d.toISOString().slice(0, 7)); };
  const monthLabel = new Date(month + '-01').toLocaleString('ru-RU', { month: 'long', year: 'numeric', timeZone: TZ });

  const startEdit = (cid) => {
    const p = monthPurchases[cid];
    setEditing(cid);
    setKg(p ? String(p.kg_fact || '') : '');
    setAmt(p ? String(p.amount_fact || '') : '');
  };

  const saveEdit = (cid) => {
    const existing = monthPurchases[cid];
    if (existing) {
      ctx.updateRentalPurchase(existing.id, { kg_fact: Number(kg) || 0, amount_fact: Number(amt) || 0 });
    } else {
      ctx.createRentalPurchase({ client_id: cid, month, kg_fact: Number(kg) || 0, amount_fact: Number(amt) || 0 });
    }
    setEditing(null);
  };

  return (
    <>
      <div className="flex items-center justify-center gap-4 mb-3">
        <button onClick={prevMonth}><ChevronLeft size={20} /></button>
        <span className="font-semibold text-sm capitalize">{monthLabel}</span>
        <button onClick={nextMonth}><ChevronRight size={20} /></button>
      </div>
      {!clients.length && <div className="text-center py-8 text-sm" style={{ color: 'var(--mc-muted)' }}>Нет активных клиентов</div>}
      {clients.map(c => {
        const p = monthPurchases[c.id];
        const planKg = Number(c.plan_kg) || 0;
        const fact = Number(p?.kg_fact) || 0;
        const pct = planKg > 0 ? Math.round(fact / planKg * 100) : 0;
        const ok = pct >= 100;
        const isEd = editing === c.id;
        return (
          <div key={c.id} className="rounded-xl p-3 mb-2" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
            <div className="flex justify-between items-center mb-1">
              <span className="font-semibold text-sm">{c.name}</span>
              {!isEd && <button onClick={() => startEdit(c.id)} className="text-xs font-semibold px-2 py-1 rounded-lg" style={{ background: 'var(--mc-info-bg)', color: 'var(--mc-info-text)' }}><Edit3 size={12} className="inline mr-0.5" />{p ? 'Изменить' : 'Внести'}</button>}
            </div>
            {planKg > 0 && <div className="text-xs mb-1" style={{ color: 'var(--mc-muted)' }}>План: {planKg} кг · Факт: {fact} кг ({pct}%)</div>}
            {planKg > 0 && (
              <div className="w-full h-1.5 rounded-full mb-1" style={{ background: 'var(--mc-progress-track)' }}>
                <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, background: ok ? '#22C55E' : '#F59E0B' }} />
              </div>
            )}
            {p && !isEd && <div className="text-xs">Сумма: {fmtNum(p.amount_fact)} тг</div>}
            {isEd && (
              <div className="mt-2">
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div><label className="text-xs mb-0.5 block">Кг</label><input className={inputCls} style={inputBorder()} type="number" value={kg} onChange={e => setKg(e.target.value)} /></div>
                  <div><label className="text-xs mb-0.5 block">Сумма (тг)</label><input className={inputCls} style={inputBorder()} type="number" value={amt} onChange={e => setAmt(e.target.value)} /></div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setEditing(null)} className="flex-1 py-2 rounded-xl text-xs font-semibold" style={btnCancel}>Отмена</button>
                  <button onClick={() => saveEdit(c.id)} className="flex-1 py-2 rounded-xl text-xs font-semibold text-white" style={{ background: '#3B82F6' }}>Сохранить</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function RevisionsTab({ ctx }) {
  const revisions = (ctx.db.rentalRevisions || []).sort((a, b) => b.revision_date.localeCompare(a.revision_date));
  const isAdmin = ctx.currentUser?.role === 'admin' || ctx.currentUser?.role === 'director';
  const canRevise = isAdmin || ctx.hasPermission('rental_revisions');
  const users = ctx.db.users || [];
  const userName = (id) => { const u = users.find(x => x.id === id); return u ? (u.first_name || u.username || '—') : '—'; };
  const clients = ctx.db.rentalClients || [];
  const clientName = (id) => clients.find(c => c.id === id)?.name || 'Офис';

  return (
    <>
      {canRevise && <button onClick={() => ctx.navigate({ name: 'rental_revision_form' })} className="w-full py-2.5 rounded-xl text-sm font-semibold text-white mb-3" style={{ background: '#3B82F6' }}><Plus size={14} className="inline mr-1" />Провести ревизию</button>}
      {!revisions.length && <div className="text-center py-8 text-sm" style={{ color: 'var(--mc-muted)' }}>Ревизий пока нет</div>}
      {revisions.map(r => {
        const items = Array.isArray(r.checklist) ? r.checklist : [];
        const found = items.filter(i => i.found).length;
        return (
          <div key={r.id} className="rounded-xl p-3 mb-2" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
            <div className="flex justify-between items-center">
              <span className="font-semibold text-sm">{fmtDate(r.revision_date)}</span>
              <span className="text-xs" style={{ color: found === items.length ? '#22C55E' : '#F59E0B' }}>{found}/{items.length} найдено</span>
            </div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--mc-muted)' }}>
              {r.location_type === 'client' ? clientName(r.location_id) : 'Офис'} · Провёл: {userName(r.conducted_by)}
            </div>
            {r.notes && <div className="text-xs mt-1">{r.notes}</div>}
          </div>
        );
      })}
    </>
  );
}

function RevisionFormScreen({ ctx }) {
  const clients = (ctx.db.rentalClients || []).filter(c => c.status === 'active');
  const equipment = ctx.db.rentalEquipment || [];
  const [locationType, setLocationType] = useState('office');
  const [locationId, setLocationId] = useState('');
  const [checklist, setChecklist] = useState([]);
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState('');

  const loadChecklist = () => {
    let eqs;
    if (locationType === 'office') {
      eqs = equipment.filter(e => e.status === 'in_office');
    } else if (locationId) {
      eqs = equipment.filter(e => e.current_client_id === locationId && e.status === 'rented');
    } else {
      eqs = [];
    }
    setChecklist(eqs.map(e => ({ equipment_id: e.id, label: `${e.type}${e.model ? ' · ' + e.model : ''}${e.serial_number ? ' (' + e.serial_number + ')' : ''}`, found: true, condition: 'good' })));
  };

  const toggleFound = (idx) => setChecklist(cl => cl.map((item, i) => i === idx ? { ...item, found: !item.found } : item));
  const setCondition = (idx, v) => setChecklist(cl => cl.map((item, i) => i === idx ? { ...item, condition: v } : item));

  const save = () => {
    if (locationType === 'client' && !locationId) return setErr('Выберите клиента');
    if (!checklist.length) return setErr('Нет оборудования для ревизии. Нажмите "Загрузить список"');
    const result = ctx.createRentalRevision({
      location_type: locationType, location_id: locationType === 'office' ? null : locationId,
      checklist, notes, revision_date: todayStr(),
    });
    if (result?.error) return setErr(result.error);
    ctx.navigate({ name: 'rental_home' });
  };

  return (
    <div className="p-4">
      <button onClick={() => ctx.navigate({ name: 'rental_home' })} className="flex items-center gap-1 mb-4 text-sm font-medium" style={{ color: '#3B82F6' }}><ChevronLeft size={16} />Назад</button>
      <h2 className="text-lg font-bold mb-4">Ревизия оборудования</h2>
      {err && <div className="mb-3 text-sm text-red-500">{err}</div>}
      <label className="block text-xs font-medium mb-1">Место</label>
      <div className="flex gap-1.5 mb-3">
        {[{ id: 'office', label: 'Офис' }, { id: 'client', label: 'У клиента' }].map(t => (
          <button key={t.id} onClick={() => { setLocationType(t.id); setChecklist([]); }} className="rounded-full px-3 py-1.5 text-xs font-semibold"
            style={{ background: locationType === t.id ? '#3B82F6' : 'var(--mc-surface)', color: locationType === t.id ? '#fff' : '#64748B', border: `1px solid ${locationType === t.id ? '#3B82F6' : 'var(--mc-border)'}` }}>{t.label}</button>
        ))}
      </div>
      {locationType === 'client' && <>
        <label className="block text-xs font-medium mb-1">Клиент</label>
        <select className={inputCls} style={inputBorder()} value={locationId} onChange={e => { setLocationId(e.target.value); setChecklist([]); }}>
          <option value="">Выберите клиента</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </>}
      <button onClick={loadChecklist} className="w-full py-2 rounded-xl text-xs font-semibold mt-3 mb-3" style={{ background: 'var(--mc-info-bg)', color: 'var(--mc-info-text)', border: '1px solid var(--mc-info-border)' }}><ClipboardList size={14} className="inline mr-1" />Загрузить список оборудования</button>
      {checklist.map((item, i) => (
        <div key={i} className="rounded-xl p-2.5 mb-1.5" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
          <div className="flex justify-between items-center text-xs">
            <span className="font-medium">{item.label}</span>
            <button onClick={() => toggleFound(i)} className="px-2 py-1 rounded-full text-xs font-semibold"
              style={{ background: item.found ? 'var(--mc-success-bg)' : 'var(--mc-danger-bg)', color: item.found ? '#22C55E' : '#EF4444' }}>{item.found ? 'Найдено' : 'Нет'}</button>
          </div>
          {item.found && (
            <div className="flex gap-1 mt-1">
              {['good', 'fair', 'poor'].map(c => (
                <button key={c} onClick={() => setCondition(i, c)} className="rounded-full px-2 py-0.5 text-xs"
                  style={{ background: item.condition === c ? '#3B82F6' : 'var(--mc-surface)', color: item.condition === c ? '#fff' : '#64748B', border: `1px solid ${item.condition === c ? '#3B82F6' : 'var(--mc-border)'}` }}>
                  {c === 'good' ? 'Хорошее' : c === 'fair' ? 'Среднее' : 'Плохое'}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      <label className="block text-xs font-medium mb-1 mt-3">Примечание</label>
      <textarea className={inputCls} style={inputBorder()} rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
      <div className="flex gap-2 mt-4">
        <button onClick={() => ctx.navigate({ name: 'rental_home' })} className="flex-1 py-2.5 rounded-xl text-sm font-semibold" style={btnCancel}>Отмена</button>
        <button onClick={save} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: '#3B82F6' }}>Сохранить</button>
      </div>
    </div>
  );
}

function ReportTab({ ctx }) {
  const [month, setMonth] = useState(monthNow());
  const equipment = ctx.db.rentalEquipment || [];
  const clients = (ctx.db.rentalClients || []).filter(c => c.status === 'active');
  const purchases = ctx.db.rentalPurchases || [];
  const users = ctx.db.users || [];

  const prevMonth = () => { const d = new Date(month + '-01'); d.setMonth(d.getMonth() - 1); setMonth(d.toISOString().slice(0, 7)); };
  const nextMonth = () => { const d = new Date(month + '-01'); d.setMonth(d.getMonth() + 1); setMonth(d.toISOString().slice(0, 7)); };
  const monthLabel = new Date(month + '-01').toLocaleString('ru-RU', { month: 'long', year: 'numeric', timeZone: TZ });

  const stats = useMemo(() => {
    const totalEq = equipment.length;
    const rented = equipment.filter(e => e.status === 'rented').length;
    const repair = equipment.filter(e => e.status === 'in_repair').length;
    const mp = purchases.filter(p => p.month === month);
    let totalKg = 0, totalAmt = 0, planKg = 0;
    clients.forEach(c => {
      const p = mp.find(x => x.client_id === c.id);
      totalKg += Number(p?.kg_fact) || 0;
      totalAmt += Number(p?.amount_fact) || 0;
      planKg += Number(c.plan_kg) || 0;
    });
    const fulfillPct = planKg > 0 ? Math.round(totalKg / planKg * 100) : 0;
    return { totalEq, rented, repair, totalKg, totalAmt, planKg, fulfillPct, clientCount: clients.length };
  }, [equipment, clients, purchases, month]);

  const underperformers = useMemo(() => {
    const mp = purchases.filter(p => p.month === month);
    return clients.filter(c => {
      const p = mp.find(x => x.client_id === c.id);
      const fact = Number(p?.kg_fact) || 0;
      const plan = Number(c.plan_kg) || 0;
      return plan > 0 && fact < plan;
    }).map(c => {
      const p = purchases.find(x => x.client_id === c.id && x.month === month);
      const fact = Number(p?.kg_fact) || 0;
      return { ...c, fact, pct: Math.round(fact / (Number(c.plan_kg) || 1) * 100) };
    });
  }, [clients, purchases, month]);

  return (
    <>
      <div className="flex items-center justify-center gap-4 mb-3">
        <button onClick={prevMonth}><ChevronLeft size={20} /></button>
        <span className="font-semibold text-sm capitalize">{monthLabel}</span>
        <button onClick={nextMonth}><ChevronRight size={20} /></button>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-3">
        {[
          { label: 'Всего оборудования', value: stats.totalEq, color: '#3B82F6' },
          { label: 'В аренде', value: stats.rented, color: '#22C55E' },
          { label: 'В ремонте', value: stats.repair, color: '#F59E0B' },
          { label: 'Клиентов', value: stats.clientCount, color: '#8B5CF6' },
        ].map((s, i) => (
          <div key={i} className="rounded-xl p-3 text-center" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
            <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
            <div className="text-xs" style={{ color: 'var(--mc-muted)' }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div className="rounded-xl p-3 mb-3" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
        <div className="text-xs font-medium mb-1">Закуп за месяц</div>
        <div className="text-sm">Факт: <b>{stats.totalKg} кг</b> из {stats.planKg} кг плана ({stats.fulfillPct}%)</div>
        <div className="w-full h-2 rounded-full mt-1 mb-1" style={{ background: 'var(--mc-progress-track)' }}>
          <div className="h-full rounded-full" style={{ width: `${Math.min(stats.fulfillPct, 100)}%`, background: stats.fulfillPct >= 100 ? '#22C55E' : '#F59E0B' }} />
        </div>
        <div className="text-sm">Сумма: <b>{fmtNum(stats.totalAmt)} тг</b></div>
      </div>
      {underperformers.length > 0 && <>
        <h3 className="font-semibold text-sm mb-2" style={{ color: '#F59E0B' }}><AlertTriangle size={14} className="inline mr-1" />Недовыполнение плана ({underperformers.length})</h3>
        {underperformers.map(c => (
          <div key={c.id} className="rounded-xl p-2.5 mb-1.5 text-xs" style={{ background: 'var(--mc-warning-bg)', border: '1px solid var(--mc-warning-border)' }}>
            <div className="flex justify-between"><span className="font-semibold">{c.name}</span><span>{c.pct}%</span></div>
            <div>Факт: {c.fact} кг / План: {c.plan_kg} кг</div>
          </div>
        ))}
      </>}
    </>
  );
}
