// ═══════════════════════════════════════════════════════════════════════════
// src/screens/ClientsScreen.jsx — Справочник клиентов
// Просмотр: все; Создание/редактирование: b2b, admin, director, sales, senior_manager
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState, useMemo } from 'react';
import {
  ChevronLeft, ChevronRight, Plus, Search, X,
  User, Building2, Edit2, RotateCcw, Check,
} from 'lucide-react';
import { supabase } from '../supabase/client';

// ─── Константы и хелперы ─────────────────────────────────────────────────

const TZ = 'Asia/Almaty';
const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('ru-KZ', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: TZ }) : '—';
const fmtNum = (n) => (Number(n) || 0).toLocaleString('ru-RU');
const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const MANAGE_ROLES = ['admin', 'director', 'b2b', 'sales', 'senior_manager'];
const canManage = (user) => MANAGE_ROLES.includes(user?.role);

// ─── Shared UI ───────────────────────────────────────────────────────────

function SHeader({ title, subtitle, onBack, action }) {
  return (
    <div style={{ marginBottom: 20 }}>
      {onBack && (
        <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--mc-muted)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 8, padding: 0 }}>
          <ChevronLeft size={15} /> Назад
        </button>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--mc-text)', margin: 0, lineHeight: 1.2 }}>{title}</h1>
          {subtitle && <div style={{ fontSize: 12, color: 'var(--mc-muted)', marginTop: 3 }}>{subtitle}</div>}
        </div>
        {action}
      </div>
    </div>
  );
}

function TypeBadge({ type }) {
  const legal = type === 'legal';
  return (
    <span style={{ background: legal ? '#EFF6FF' : '#F0FDF4', color: legal ? '#1D4ED8' : '#16a34a', border: `1px solid ${legal ? '#BFDBFE' : '#BBF7D0'}`, borderRadius: 8, padding: '2px 8px', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>
      {legal ? '🏢 Юр. лицо' : '👤 Физ. лицо'}
    </span>
  );
}

function FieldRow({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--mc-border-light)', fontSize: 12 }}>
      <span style={{ color: 'var(--mc-muted)', minWidth: 120, flexShrink: 0 }}>{label}</span>
      <span style={{ color: 'var(--mc-text)', fontWeight: 500, flex: 1, wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}

// Находим последние заказы клиента
function getClientOrders(client, orders) {
  return (orders || [])
    .filter(o =>
      (client.type === 'legal'
        ? (o.company_name === client.name || o.client_id === client.id)
        : (o.full_name === client.name || o.client_id === client.id))
    )
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// ═══════════════════════════════════════════════════════════════════════════
// ClientsScreen — список клиентов
// ═══════════════════════════════════════════════════════════════════════════

export function ClientsScreen({ ctx }) {
  const { db, navigate, currentUser } = ctx;
  const [search, setSearch] = useState('');
  const [tab, setTab]       = useState('all');
  const searchRef = React.useRef(null);

  const clients = db.clients || [];
  const legalN  = clients.filter(c => c.type === 'legal').length;
  const indivN  = clients.filter(c => c.type === 'individual').length;

  const filtered = useMemo(() => {
    let list = clients;
    if (tab !== 'all') list = list.filter(c => c.type === tab);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const qDigits = q.replace(/\D/g, '');
      list = list.filter(c =>
        (c.name    || '').toLowerCase().includes(q) ||
        (qDigits && (c.phone || '').replace(/\D/g, '').includes(qDigits)) ||
        (c.bin     || '').includes(q) ||
        (c.address || '').toLowerCase().includes(q) ||
        (c.addresses || []).some(a => (a.address || '').toLowerCase().includes(q)) ||
        (c.contact_person || '').toLowerCase().includes(q) ||
        (c.notes   || '').toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
  }, [clients, tab, search]);

  return (
    <div>
      <SHeader
        title="Клиенты"
        subtitle={`${clients.length} в базе · ${legalN} юр. · ${indivN} физ.`}
        action={canManage(currentUser) && (
          <button onClick={() => navigate({ name: 'client_edit', clientId: null })}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: '#297b8a', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            <Plus size={15} /> Добавить
          </button>
        )}
      />

      {/* Поиск */}
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <Search size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--mc-muted)', pointerEvents: 'none' }} />
        <input
          ref={searchRef}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск: название, телефон, БИН..."
          style={{ width: '100%', padding: '10px 36px', border: '1px solid var(--mc-border)', borderRadius: 10, fontSize: 16, outline: 'none', background: 'var(--mc-surface)', color: 'var(--mc-text)', boxSizing: 'border-box' }} />
        {search && (
          <button onClick={() => setSearch('')}
            style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mc-muted)', lineHeight: 1 }}>
            <X size={14} />
          </button>
        )}
      </div>

      {/* Табы */}
      <div style={{ display: 'flex', border: '1px solid var(--mc-border)', borderRadius: 10, marginBottom: 14, overflow: 'hidden' }}>
        {[['all', `Все (${clients.length})`], ['legal', `Юр. (${legalN})`], ['individual', `Физ. (${indivN})`]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ flex: 1, padding: '7px 4px', fontSize: 11, fontWeight: 600, cursor: 'pointer', background: tab === k ? '#297b8a' : 'var(--mc-surface)', color: tab === k ? '#fff' : 'var(--mc-muted)', border: 'none' }}>
            {l}
          </button>
        ))}
      </div>

      {/* Список */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--mc-muted)' }}>
          <Building2 size={36} style={{ margin: '0 auto 12px', opacity: .3 }} />
          <div style={{ fontSize: 14 }}>{search ? 'Ничего не найдено' : 'База клиентов пуста'}</div>
        </div>
      ) : filtered.map(c => (
        <ClientCard key={c.id} client={c} db={db}
          onClick={() => navigate({ name: 'client_detail', clientId: c.id })} />
      ))}
    </div>
  );
}

function ClientCard({ client: c, db, onClick }) {
  const orders = useMemo(() => getClientOrders(c, db.orders), [c, db.orders]);
  const last   = orders[0];
  return (
    <button onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 12, padding: '12px 14px', marginBottom: 8, textAlign: 'left', cursor: 'pointer', width: '100%' }}>
      <div style={{ width: 38, height: 38, borderRadius: '50%', background: c.type === 'legal' ? '#EFF6FF' : '#F0FDF4', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {c.type === 'legal' ? <Building2 size={17} color="#1D4ED8" /> : <User size={17} color="#16a34a" />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--mc-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
        <div style={{ fontSize: 11, color: 'var(--mc-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {c.phone || '—'}
          {c.bin && <span style={{ marginLeft: 8, color: 'var(--mc-muted)' }}>БИН: {c.bin}</span>}
        </div>
        {c.address && (
          <div style={{ fontSize: 10, color: 'var(--mc-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            📍 {c.address}
          </div>
        )}
        <div style={{ fontSize: 10, color: 'var(--mc-muted)', marginTop: 1 }}>
          {orders.length > 0 ? `${orders.length} зак. · посл. ${fmtDate(last.created_at)}` : 'Заказов пока нет'}
        </div>
      </div>
      <ChevronRight size={15} color="var(--mc-muted)" style={{ flexShrink: 0 }} />
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ClientDetailScreen — карточка клиента
// ═══════════════════════════════════════════════════════════════════════════

export function ClientDetailScreen({ ctx, clientId }) {
  const { db, navigate, currentUser, setOrderDraft, showToast } = ctx;
  const client = (db.clients || []).find(c => c.id === clientId);
  const orders = useMemo(() => client ? getClientOrders(client, db.orders) : [], [client, db.orders]);
  const [addrPickerOpen, setAddrPickerOpen] = useState(false);

  if (!client) return <div style={{ padding: 24, color: 'var(--mc-muted)', textAlign: 'center' }}>Клиент не найден</div>;

  const lastOrder = orders[0];

  const clientFields = {
    client_type:    client.type,
    company_name:   client.type === 'legal'      ? client.name : '',
    full_name:      client.type === 'individual' ? client.name : '',
    bin:            client.bin            || '',
    contact_person: client.contact_person || '',
    phone:          client.phone          || '',
    address:        client.address        || '',
    bank:           client.bank           || '',
    kbe:            client.kbe            || '',
    bik:            client.bik            || '',
    account_number: client.account_number || '',
  };

  // Предпочтительные товары → позиции заказа (с quantity: 1 если не задано)
  const preferredAsItems = (client.preferred_items || []).map(pi => ({
    ...pi,
    quantity: pi.quantity || 1,
    product_id: pi.product_id || '',
  }));

  // Все доступные адреса клиента
  const allAddresses = useMemo(() => {
    const result = [];
    if (client.address) result.push({ label: 'Основной', address: client.address });
    (client.addresses || []).forEach(a => { if (a.address?.trim()) result.push(a); });
    return result;
  }, [client]);

  const startOrder = (selectedAddress) => {
    setOrderDraft(d => ({
      ...d,
      ...clientFields,
      ...(selectedAddress !== undefined ? { address: selectedAddress } : {}),
      ...(preferredAsItems.length > 0 ? { items: preferredAsItems } : {}),
    }));
    navigate({ name: 'create_order' });
  };

  const handleCreateOrder = () => {
    if (allAddresses.length > 1) { setAddrPickerOpen(true); return; }
    startOrder();
  };

  const handleRepeatOrder = () => {
    if (!lastOrder) return;
    setOrderDraft(d => ({
      ...d,
      ...clientFields,
      items:           lastOrder.items || [],
      delivery_method: lastOrder.delivery_method || '',
      comment:         '',
    }));
    showToast('Данные прошлого заказа загружены');
    navigate({ name: 'create_order' });
  };

  return (
    <div>
      <SHeader
        title={client.name}
        onBack={() => navigate({ name: 'clients' })}
        action={canManage(currentUser) && (
          <button onClick={() => navigate({ name: 'client_edit', clientId: client.id })}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px', background: 'var(--mc-active-item)', color: 'var(--mc-text)', border: '1px solid var(--mc-border)', borderRadius: 9, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
            <Edit2 size={13} /> Изменить
          </button>
        )}
      />

      {/* Тип */}
      <div style={{ marginBottom: 14 }}><TypeBadge type={client.type} /></div>

      {/* Основные данные */}
      <div style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 8 }}>Контакты</div>
        <FieldRow label="Телефон"        value={client.phone} />
        <FieldRow label="Адрес"          value={client.address} />
        {(client.addresses || []).filter(a => a.address?.trim()).map((a, i) => (
          <FieldRow key={i} label={a.label || `Адрес ${i + 2}`} value={a.address} />
        ))}
        {client.type === 'legal' && <FieldRow label="БИН/ИИН"       value={client.bin} />}
        {client.type === 'legal' && <FieldRow label="Контактное лицо" value={client.contact_person} />}
        {client.notes && <FieldRow label="Заметки" value={client.notes} />}
      </div>

      {/* Банк */}
      {client.type === 'legal' && (client.bank || client.bik || client.account_number) && (
        <div style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 8 }}>Банковские реквизиты</div>
          <FieldRow label="Банк"         value={client.bank} />
          <FieldRow label="КБе"          value={client.kbe} />
          <FieldRow label="БИК"          value={client.bik} />
          <FieldRow label="Номер счёта"  value={client.account_number} />
        </div>
      )}

      {/* Предпочтительные товары */}
      {(client.preferred_items || []).length > 0 && (
        <div style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 8 }}>Закреплённые товары</div>
          {(client.preferred_items || []).map((pi, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--mc-border-light)', fontSize: 12 }}>
              <span style={{ color: 'var(--mc-text)', fontWeight: 500, flex: 1 }}>{pi.name}{pi.unit ? ` (${pi.unit})` : ''}</span>
              <span style={{ color: '#297b8a', fontWeight: 700, marginLeft: 12, whiteSpace: 'nowrap' }}>{fmtNum(pi.price)} тг</span>
            </div>
          ))}
        </div>
      )}

      {/* Кнопки действий */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button onClick={handleCreateOrder}
          style={{ flex: 1, padding: '11px 8px', background: '#297b8a', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
          + Новый заказ
        </button>
        {lastOrder && (
          <button onClick={handleRepeatOrder}
            style={{ flex: 1, padding: '11px 8px', background: '#F0FDF4', color: '#16a34a', border: '1px solid #BBF7D0', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <RotateCcw size={14} /> Повторить заказ
          </button>
        )}
      </div>

      {/* История заказов */}
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--mc-text)', marginBottom: 10 }}>
        История заказов ({orders.length})
      </div>
      {orders.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px', color: 'var(--mc-muted)', fontSize: 13 }}>Заказов пока нет</div>
      ) : orders.slice(0, 8).map(o => (
        <OrderHistoryRow key={o.id} order={o} onClick={() => navigate({ name: 'order_detail', orderId: o.id })} />
      ))}
      {orders.length > 8 && (
        <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--mc-muted)', marginTop: 8 }}>
          + ещё {orders.length - 8} заказов
        </div>
      )}

      {/* Выбор адреса для нового заказа */}
      {addrPickerOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 9999, display: 'flex', alignItems: 'flex-end' }}
          onClick={e => { if (e.target === e.currentTarget) setAddrPickerOpen(false); }}>
          <div style={{ background: 'var(--mc-surface)', width: '100%', borderRadius: '20px 20px 0 0', padding: '16px 16px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--mc-text)' }}>Выберите адрес доставки</div>
              <button onClick={() => setAddrPickerOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mc-muted)' }}><X size={20} /></button>
            </div>
            {allAddresses.map((a, i) => (
              <button key={i} onClick={() => { setAddrPickerOpen(false); startOrder(a.address); }}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '100%', background: 'var(--mc-active-item)', border: '1px solid var(--mc-border)', borderRadius: 10, padding: '10px 14px', marginBottom: 8, textAlign: 'left', cursor: 'pointer' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#297b8a', marginBottom: 2 }}>{a.label}</span>
                <span style={{ fontSize: 13, color: 'var(--mc-text)' }}>{a.address}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const ORDER_STATUS = {
  new:       { label: 'Новая',     bg: '#EFF6FF', color: '#1D4ED8' },
  paid:      { label: 'Оплачена',  bg: '#F0FDF4', color: '#16a34a' },
  shipped:   { label: 'Отгружена', bg: '#FEF3C7', color: '#D97706' },
  delivered: { label: 'Доставлена',bg: '#D1FAE5', color: '#065F46' },
  cancelled: { label: 'Отменена',  bg: '#FEF2F2', color: '#DC2626' },
};

function OrderHistoryRow({ order: o, onClick }) {
  const s = ORDER_STATUS[o.status] || ORDER_STATUS.new;
  const total = (o.items || []).reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.price) || 0), 0);
  return (
    <button onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--mc-surface)', border: '1px solid var(--mc-border-light)', borderRadius: 10, padding: '10px 12px', marginBottom: 6, textAlign: 'left', cursor: 'pointer', width: '100%' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--mc-text)' }}>{o.order_number}</div>
        <div style={{ fontSize: 11, color: 'var(--mc-muted)', marginTop: 1 }}>
          {fmtDate(o.created_at)} · {(o.items || []).length} поз. · {fmtNum(total)} тг
        </div>
      </div>
      <span style={{ background: s.bg, color: s.color, borderRadius: 7, padding: '2px 8px', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>{s.label}</span>
      <ChevronRight size={14} color="var(--mc-muted)" style={{ flexShrink: 0 }} />
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ClientEditScreen — создание / редактирование
// ═══════════════════════════════════════════════════════════════════════════

const emptyClient = {
  type: 'legal', name: '', bin: '', address: '', phone: '',
  contact_person: '', bank: '', kbe: '', bik: '',
  account_number: '', notes: '', preferred_items: [], addresses: [],
};

export function ClientEditScreen({ ctx, clientId }) {
  const { db, navigate, currentUser, showToast, setDb, syncSnapshotRef } = ctx;
  const existing = clientId ? (db.clients || []).find(c => c.id === clientId) : null;

  const [form, setForm]   = useState(existing ? { ...emptyClient, ...existing } : { ...emptyClient });
  const [errors, setErr]  = useState({});
  const [saving, setSaving] = useState(false);

  const upd = patch => setForm(f => ({ ...f, ...patch }));

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Укажите название';
    if (form.type === 'legal' && form.bin && !/^\d{12}$/.test(form.bin.trim())) e.bin = 'БИН/ИИН — 12 цифр';
    if (form.kbe && !/^\d{1,2}$/.test(form.kbe.trim())) e.kbe = 'КБе — 1–2 цифры';
    return e;
  };

  const handleSave = async () => {
    const e = validate();
    setErr(e);
    if (Object.keys(e).length > 0) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const row = {
        ...(existing ? { id: existing.id } : { id: uid() }),
        type:            form.type,
        name:            form.name.trim(),
        bin:             form.bin.trim()            || null,
        address:         form.address.trim()        || null,
        phone:           form.phone.trim()          || null,
        contact_person:  form.contact_person.trim() || null,
        bank:            form.bank.trim()           || null,
        kbe:             form.kbe.trim()            || null,
        bik:             form.bik.trim()            || null,
        account_number:  form.account_number.trim() || null,
        notes:           form.notes.trim()          || null,
        preferred_items: form.preferred_items || [],
        addresses:       (form.addresses || []).filter(a => a.address?.trim()),
        created_by:     currentUser.id,
        updated_at:     now,
        ...(!existing && { created_at: now }),
      };
      const { error } = await supabase.from('clients').upsert([row], { onConflict: 'id' });
      if (error) throw error;
      setDb(d => {
        const updated = existing
          ? d.clients.map(c => c.id === row.id ? row : c)
          : [row, ...d.clients];
        if (syncSnapshotRef) syncSnapshotRef.current.clients = updated;
        return { ...d, clients: updated };
      });
      showToast(existing ? 'Клиент обновлён' : 'Клиент добавлен', 'success');
      navigate(existing ? { name: 'client_detail', clientId: row.id } : { name: 'clients' });
    } catch (err) {
      showToast('Ошибка: ' + err.message, 'error');
    }
    setSaving(false);
  };

  const isLegal = form.type === 'legal';

  return (
    <div>
      <SHeader
        title={existing ? 'Редактировать клиента' : 'Новый клиент'}
        onBack={() => navigate(existing ? { name: 'client_detail', clientId: existing.id } : { name: 'clients' })}
      />

      {/* Тип */}
      <div style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 10 }}>Тип клиента</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[['legal', '🏢 Юр. лицо'], ['individual', '👤 Физ. лицо']].map(([v, l]) => (
            <button key={v} onClick={() => upd({ type: v })}
              style={{ flex: 1, padding: '9px 4px', background: form.type === v ? '#297b8a' : 'var(--mc-active-item)', color: form.type === v ? '#fff' : 'var(--mc-muted)', border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Основные поля */}
      <div style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 10 }}>Основное</div>
        <EditField label={isLegal ? 'Наименование юр. лица *' : 'ФИО *'} value={form.name} onChange={v => upd({ name: v })} error={errors.name}
          placeholder={isLegal ? 'ТОО "Coffee Boom"' : 'Иванов Иван Иванович'} />
        {isLegal && <EditField label="БИН/ИИН" value={form.bin} onChange={v => upd({ bin: v.replace(/\D/g, '').slice(0, 12) })} error={errors.bin} placeholder="180440019877" />}
        {isLegal && <EditField label="Контактное лицо" value={form.contact_person} onChange={v => upd({ contact_person: v })} placeholder="Касымов Ержан" />}
        <EditField label="Телефон" value={form.phone} onChange={v => upd({ phone: v })} placeholder="+7 777 123 45 67" type="tel" />
        <EditField label={isLegal ? 'Юр. адрес' : 'Адрес'} value={form.address} onChange={v => upd({ address: v })} placeholder="г. Алматы, ул. Абая 150" multiline />
        <EditField label="Заметки" value={form.notes} onChange={v => upd({ notes: v })} placeholder="Любая доп. информация" multiline />
      </div>

      {/* Банк */}
      {isLegal && (
        <div style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 10 }}>Банковские реквизиты</div>
          <EditField label="Банк" value={form.bank} onChange={v => upd({ bank: v })} placeholder='АО "Kaspi Bank"' />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <EditField label="КБе" value={form.kbe} onChange={v => upd({ kbe: v.replace(/\D/g, '').slice(0, 2) })} error={errors.kbe} placeholder="16" />
            <EditField label="БИК" value={form.bik} onChange={v => upd({ bik: v })} placeholder="CASPKZKA" />
          </div>
          <EditField label="Номер счёта" value={form.account_number} onChange={v => upd({ account_number: v })} placeholder="KZ24722S000044591862" />
        </div>
      )}

      {/* Закреплённые товары */}
      <div style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .5 }}>Закреплённые товары</div>
          <button onClick={() => upd({ preferred_items: [...(form.preferred_items || []), { name: '', unit: 'кг', price: '' }] })}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', background: '#F0F9FA', color: '#297b8a', border: '1px solid #b0dce5', borderRadius: 7, fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>
            <Plus size={11} /> Добавить
          </button>
        </div>
        {(form.preferred_items || []).length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--mc-muted)', textAlign: 'center', padding: '8px 0' }}>Нет закреплённых товаров</div>
        )}
        {(form.preferred_items || []).map((pi, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 6, marginBottom: 8, alignItems: 'center' }}>
            <input value={pi.name} onChange={e => {
              const items = [...form.preferred_items]; items[i] = { ...items[i], name: e.target.value }; upd({ preferred_items: items });
            }} placeholder="Название товара" style={{ padding: '7px 9px', border: '1px solid var(--mc-border)', borderRadius: 7, fontSize: 12, outline: 'none', background: 'var(--mc-surface)', color: 'var(--mc-text)', fontFamily: 'inherit' }} />
            <select value={pi.unit || 'кг'} onChange={e => {
              const items = [...form.preferred_items]; items[i] = { ...items[i], unit: e.target.value }; upd({ preferred_items: items });
            }} style={{ padding: '7px 6px', border: '1px solid var(--mc-border)', borderRadius: 7, fontSize: 12, outline: 'none', background: 'var(--mc-surface)', color: 'var(--mc-text)', cursor: 'pointer' }}>
              {['кг', 'г', 'шт', 'л', 'уп'].map(u => <option key={u} value={u}>{u}</option>)}
            </select>
            <input type="number" value={pi.price} onChange={e => {
              const items = [...form.preferred_items]; items[i] = { ...items[i], price: e.target.value }; upd({ preferred_items: items });
            }} placeholder="Цена" style={{ width: 80, padding: '7px 9px', border: '1px solid var(--mc-border)', borderRadius: 7, fontSize: 12, outline: 'none', background: 'var(--mc-surface)', color: 'var(--mc-text)', fontFamily: 'inherit' }} />
            <button onClick={() => upd({ preferred_items: form.preferred_items.filter((_, j) => j !== i) })}
              style={{ padding: 6, background: '#FEE2E2', border: 'none', borderRadius: 7, cursor: 'pointer', color: '#dc2626', display: 'flex', alignItems: 'center' }}>
              <X size={13} />
            </button>
          </div>
        ))}
        <div style={{ fontSize: 10, color: 'var(--mc-muted)', marginTop: 4 }}>Эти товары автоматически подставятся в новый заказ</div>
      </div>

      {/* Адреса доставки */}
      <div style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .5 }}>Доп. адреса</div>
          <button onClick={() => upd({ addresses: [...(form.addresses || []), { label: '', address: '' }] })}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', background: '#F0F9FA', color: '#297b8a', border: '1px solid #b0dce5', borderRadius: 7, fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>
            <Plus size={11} /> Добавить
          </button>
        </div>
        {(form.addresses || []).length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--mc-muted)', textAlign: 'center', padding: '8px 0' }}>
            {form.address ? `Основной: ${form.address}` : 'Нет дополнительных адресов'}
          </div>
        )}
        {(form.addresses || []).map((addr, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto', gap: 6, marginBottom: 8, alignItems: 'center' }}>
            <input
              value={addr.label || ''}
              onChange={e => {
                const items = [...(form.addresses || [])];
                items[i] = { ...items[i], label: e.target.value };
                upd({ addresses: items });
              }}
              placeholder="Офис, Склад…"
              style={{ padding: '7px 8px', border: '1px solid var(--mc-border)', borderRadius: 7, fontSize: 12, outline: 'none', background: 'var(--mc-surface)', color: 'var(--mc-text)', fontFamily: 'inherit' }}
            />
            <input
              value={addr.address || ''}
              onChange={e => {
                const items = [...(form.addresses || [])];
                items[i] = { ...items[i], address: e.target.value };
                upd({ addresses: items });
              }}
              placeholder="г. Алматы, ул. Абая 150"
              style={{ padding: '7px 8px', border: '1px solid var(--mc-border)', borderRadius: 7, fontSize: 12, outline: 'none', background: 'var(--mc-surface)', color: 'var(--mc-text)', fontFamily: 'inherit' }}
            />
            <button onClick={() => upd({ addresses: (form.addresses || []).filter((_, j) => j !== i) })}
              style={{ padding: 6, background: '#FEE2E2', border: 'none', borderRadius: 7, cursor: 'pointer', color: '#dc2626', display: 'flex', alignItems: 'center' }}>
              <X size={13} />
            </button>
          </div>
        ))}
        <div style={{ fontSize: 10, color: 'var(--mc-muted)', marginTop: 4 }}>Метка (Офис, Склад) + адрес. При создании заказа можно выбрать любой.</div>
      </div>

      <button onClick={handleSave} disabled={saving}
        style={{ width: '100%', padding: 13, background: saving ? 'var(--mc-border)' : '#297b8a', color: '#fff', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: saving ? 'not-allowed' : 'pointer', marginBottom: 16 }}>
        {saving ? '⏳ Сохранение...' : existing ? '✓ Сохранить изменения' : '+ Добавить клиента'}
      </button>
    </div>
  );
}

function EditField({ label, value, onChange, error, placeholder, type = 'text', multiline }) {
  const baseStyle = { width: '100%', padding: '8px 10px', border: `1px solid ${error ? '#FCA5A5' : 'var(--mc-border)'}`, borderRadius: 8, fontSize: 13, outline: 'none', background: 'var(--mc-surface)', boxSizing: 'border-box', marginBottom: 10, fontFamily: 'inherit' };
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--mc-muted)', display: 'block', marginBottom: 3 }}>{label}</label>
      {multiline
        ? <textarea value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={2} style={{ ...baseStyle, resize: 'vertical' }} />
        : <input type={type} value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={baseStyle} />
      }
      {error && <div style={{ fontSize: 11, color: '#DC2626', marginTop: -8, marginBottom: 6 }}>{error}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ClientPickerModal — модал для выбора клиента в форме заказа
// ═══════════════════════════════════════════════════════════════════════════

export function ClientPickerModal({ ctx, onSelect, onClose }) {
  const { db } = ctx;
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const clients = db.clients || [];
    if (!search.trim()) return clients.slice(0, 20);
    const q = search.trim().toLowerCase();
    return clients.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.phone || '').replace(/\D/g, '').includes(q.replace(/\D/g, '')) ||
      (c.bin || '').includes(q)
    ).slice(0, 20);
  }, [db.clients, search]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 9999, display: 'flex', alignItems: 'flex-end' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--mc-surface)', width: '100%', maxHeight: '80vh', borderRadius: '20px 20px 0 0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Шапка */}
        <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--mc-border-light)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--mc-text)' }}>Выбрать клиента</div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mc-muted)' }}><X size={20} /></button>
          </div>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--mc-muted)', pointerEvents: 'none' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} autoFocus
              placeholder="Поиск по названию, телефону, БИН..."
              style={{ width: '100%', padding: '9px 10px 9px 32px', border: '1px solid var(--mc-border)', borderRadius: 9, fontSize: 13, outline: 'none', background: 'var(--mc-surface)', color: 'var(--mc-text)', boxSizing: 'border-box' }} />
          </div>
        </div>

        {/* Список */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '8px 12px 16px' }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--mc-muted)', fontSize: 13 }}>Ничего не найдено</div>
          ) : filtered.map(c => (
            <button key={c.id} onClick={() => onSelect(c)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'var(--mc-surface)', border: '1px solid var(--mc-border-light)', borderRadius: 10, padding: '10px 12px', marginBottom: 6, textAlign: 'left', cursor: 'pointer' }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: c.type === 'legal' ? '#EFF6FF' : '#F0FDF4', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {c.type === 'legal' ? <Building2 size={15} color="#1D4ED8" /> : <User size={15} color="#16a34a" />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--mc-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                <div style={{ fontSize: 11, color: 'var(--mc-muted)' }}>{c.phone || '—'}{c.bin ? ` · БИН: ${c.bin}` : ''}{(c.preferred_items||[]).length > 0 ? ` · ${c.preferred_items.length} тов.` : ''}</div>
              </div>
              <Check size={15} color="var(--mc-muted)" style={{ flexShrink: 0 }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
