// ═══════════════════════════════════════════════════════════════════════
// src/screens/GiftsScreen.jsx — Заявки на подарки клиентам
// Любой сотрудник → директор одобряет → админ/ст.менеджер списывает → склад
// ═══════════════════════════════════════════════════════════════════════

import React, { useState, useMemo } from 'react';
import {
  Gift, Plus, Search, ChevronRight, Trash2, Check, CheckCircle2,
  CircleDot, XCircle, Package, FileText, Truck, MapPin, Phone, User,
} from 'lucide-react';

/* ── Статусы подарков ── */
const GIFT_STATUS = {
  pending:   { label: 'На одобрении',        short: 'На одобр.',  color: '#F59E0B', bg: '#FEF3C7', icon: CircleDot },
  approved:  { label: 'Одобрен · к списанию', short: 'Одобрен',    color: '#3390EC', bg: '#E7F3FE', icon: CheckCircle2 },
  processed: { label: 'Списан · ждёт склад', short: 'Списан',     color: '#8B5CF6', bg: '#EDE9FE', icon: FileText },
  prepared:  { label: 'Готово к выдаче',      short: 'К выдаче',   color: '#6366F1', bg: '#E0E7FF', icon: Package },
  delivered: { label: 'Выдан / доставлен',    short: 'Выдан',      color: '#22C55E', bg: '#DCFCE7', icon: Check },
  rejected:  { label: 'Отклонён',             short: 'Отклонён',   color: '#EB5757', bg: '#FEE2E2', icon: XCircle },
};

const DELIVERY_LABELS = { pickup: 'Самовывоз', delivery: 'Доставка' };

/* ── helpers (дублируем минимально, т.к. App.jsx не экспортирует) ── */
const TZ = 'Asia/Almaty';
const fmtDate = (iso) => new Date(iso).toLocaleString('ru-KZ', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: TZ });
const fmtDateTime = (iso) => new Date(iso).toLocaleString('ru-KZ', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ });
const fmtNum = (n) => (Number(n) || 0).toLocaleString('ru-RU').replace(/\s/g, ' ');
const matchesSearch = (text, query) => {
  if (!query) return true;
  const t = (text || '').toLowerCase();
  return query.toLowerCase().split(/\s+/).every(w => t.includes(w));
};

/* ══════════════════════════════════════════════════════════════════════
   Роутер: GiftsScreen
   ══════════════════════════════════════════════════════════════════════ */
export function GiftsScreen({ ctx }) {
  const { route } = ctx;
  if (route.name === 'create_gift') return <CreateGiftScreen ctx={ctx} />;
  if (route.name === 'gift_detail') return <GiftDetailScreen ctx={ctx} giftId={route.giftId} />;
  return <GiftListScreen ctx={ctx} />;
}

/* ══════════════════════════════════════════════════════════════════════
   Баннер на главной: «У вас N подарков на одобрении / к списанию»
   ══════════════════════════════════════════════════════════════════════ */
export function GiftsHomeBanner({ ctx }) {
  const { db, currentUser, navigate } = ctx;
  const gifts = db.gifts || [];
  const hasPerm = (p) => ctx.hasPermission?.(p);

  const myPending = gifts.filter(g => g.status === 'pending' && g.created_by === currentUser.id).length;
  const toApprove = hasPerm('gift_approve') ? gifts.filter(g => g.status === 'pending').length : 0;
  const toProcess = hasPerm('gift_process') ? gifts.filter(g => g.status === 'approved').length : 0;
  const toWarehouse = currentUser.role === 'warehouse' ? gifts.filter(g => g.status === 'processed' || g.status === 'prepared').length : 0;

  const total = myPending + toApprove + toProcess + toWarehouse;
  if (total === 0) return null;

  const parts = [];
  if (toApprove > 0) parts.push(`на одобрении: ${toApprove}`);
  if (toProcess > 0) parts.push(`к списанию: ${toProcess}`);
  if (toWarehouse > 0) parts.push(`на складе: ${toWarehouse}`);
  if (myPending > 0 && !toApprove) parts.push(`ваших заявок: ${myPending}`);

  return (
    <button
      onClick={() => navigate({ name: 'gifts' })}
      className="w-full text-left rounded-2xl p-4 mb-3 transition hover:shadow-sm"
      style={{ background: 'linear-gradient(135deg, #fdf2f8 0%, #fce7f3 100%)', border: '1px solid #f9a8d4' }}
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: '#ec489920' }}>
          <Gift size={20} style={{ color: '#EC4899' }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm" style={{ color: '#BE185D' }}>Подарки</div>
          <div className="text-xs mt-0.5" style={{ color: '#9D174D' }}>{parts.join(' · ')}</div>
        </div>
        <ChevronRight size={18} style={{ color: '#EC4899' }} />
      </div>
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Список подарков
   ══════════════════════════════════════════════════════════════════════ */
function GiftListScreen({ ctx }) {
  const { db, currentUser, navigate } = ctx;
  const [filter, setFilter] = useState('all');
  const hasPerm = (p) => ctx.hasPermission?.(p);

  const all = db.gifts || [];
  const canSeeAll = hasPerm('gift_view_all');

  const visible = useMemo(() => {
    if (canSeeAll) return all;
    return all.filter(g => {
      if (g.created_by === currentUser.id) return true;
      if (hasPerm('gift_approve') && g.status === 'pending') return true;
      if (hasPerm('gift_process') && g.status === 'approved') return true;
      if (currentUser.role === 'warehouse' && ['processed', 'prepared'].includes(g.status)) return true;
      if (g.approved_by === currentUser.id) return true;
      if (g.processed_by === currentUser.id) return true;
      if (g.prepared_by === currentUser.id) return true;
      if (g.delivered_by === currentUser.id) return true;
      return false;
    });
  }, [all, currentUser, canSeeAll]);

  const filtered = useMemo(() => {
    let list = visible;
    if (filter !== 'all') list = list.filter(g => g.status === filter);
    return [...list].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [visible, filter]);

  const counts = {
    all: visible.length,
    pending: visible.filter(g => g.status === 'pending').length,
    approved: visible.filter(g => g.status === 'approved').length,
    processed: visible.filter(g => g.status === 'processed').length,
    prepared: visible.filter(g => g.status === 'prepared').length,
    delivered: visible.filter(g => g.status === 'delivered').length,
    rejected: visible.filter(g => g.status === 'rejected').length,
  };

  return (
    <div>
      <PageHeader
        title="Подарки клиентам"
        subtitle={canSeeAll
          ? `Все заявки · на одобр.: ${counts.pending}, к списанию: ${counts.approved}, на складе: ${counts.processed}`
          : `${counts.all} заявок`}
        action={
          hasPerm('gift_create') && (
            <button onClick={() => navigate({ name: 'create_gift' })}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-white text-sm"
              style={{ background: '#EC4899' }}>
              <Plus size={16} /> Новая заявка
            </button>
          )
        }
        onBack={() => navigate({ name: 'home' })}
      />

      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-4">
        {[
          { id: 'all', label: `Все · ${counts.all}` },
          { id: 'pending', label: `На одобр. · ${counts.pending}` },
          { id: 'approved', label: `К списанию · ${counts.approved}` },
          { id: 'processed', label: `На складе · ${counts.processed}` },
          { id: 'prepared', label: `К выдаче · ${counts.prepared}` },
          { id: 'delivered', label: `Выдано · ${counts.delivered}` },
          { id: 'rejected', label: `Отклонены · ${counts.rejected}` },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className="whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold"
            style={{
              background: filter === f.id ? '#EC4899' : 'var(--mc-surface)',
              color: filter === f.id ? 'white' : '#64748B',
              border: filter === f.id ? '1px solid #EC4899' : '1px solid var(--mc-border)',
            }}>
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Empty icon={Gift} title="Заявок не найдено" subtitle="Смените фильтр или подайте новую заявку" />
      ) : (
        <div className="space-y-2">
          {filtered.map(g => <GiftCard key={g.id} gift={g} ctx={ctx} />)}
        </div>
      )}
    </div>
  );
}

/* ── Карточка подарка в списке ── */
function GiftCard({ gift, ctx }) {
  const { db, navigate } = ctx;
  const author = db.users.find(u => u.id === gift.created_by);
  const s = GIFT_STATUS[gift.status] || GIFT_STATUS.pending;
  const Icon = s.icon;

  return (
    <button onClick={() => navigate({ name: 'gift_detail', giftId: gift.id })}
      className="w-full text-left bg-white rounded-xl p-4 transition hover:shadow-sm"
      style={{ border: '1px solid var(--mc-border)' }}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="font-bold mono-font text-sm" style={{ color: '#EC4899' }}>{gift.number}</span>
          <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
            style={{ background: gift.delivery_type === 'delivery' ? '#DBEAFE' : '#F0FDF4', color: gift.delivery_type === 'delivery' ? '#1D4ED8' : '#15803D' }}>
            {gift.delivery_type === 'delivery' ? '🚚 Доставка' : '📦 Самовывоз'}
          </span>
        </div>
        <span className="inline-flex items-center gap-1 font-semibold rounded-full px-2.5 py-1 text-xs whitespace-nowrap"
          style={{ background: s.bg, color: s.color }}>
          <Icon size={11} /> {s.short}
        </span>
      </div>
      <div className="font-semibold mb-1 truncate" style={{ color: 'var(--mc-text)' }}>
        <Gift size={14} className="inline mr-1" style={{ color: '#EC4899' }} />
        {gift.items && gift.items.length > 0
          ? (gift.items.length === 1
            ? `${gift.items[0].name} × ${gift.items[0].quantity} ${gift.items[0].unit}`
            : `${gift.items.length} поз. — ${gift.items.map(i => i.name).join(', ')}`)
          : `${gift.product_name} × ${gift.quantity} ${gift.unit}`}
      </div>
      <div className="text-sm mb-1" style={{ color: 'var(--mc-muted)' }}>
        <User size={12} className="inline mr-1" /> Клиент: {gift.client_name}
      </div>
      {gift.delivery_type === 'delivery' && gift.address && (
        <div className="text-xs mb-1 truncate" style={{ color: 'var(--mc-muted)' }}>
          <MapPin size={11} className="inline mr-1" /> {gift.address}
        </div>
      )}
      <div className="flex items-center justify-between text-xs flex-wrap gap-2 mt-2" style={{ color: '#A8A8AE' }}>
        <span>От: {author ? `${author.first_name} ${(author.last_name || '')[0] || ''}.` : '—'}</span>
        <span>{fmtDateTime(gift.created_at)}</span>
      </div>
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Создание заявки на подарок
   ══════════════════════════════════════════════════════════════════════ */
function CreateGiftScreen({ ctx }) {
  const { db, goBack, showToast } = ctx;
  const tmpId = () => Math.random().toString(36).slice(2);

  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [items, setItems] = useState([{ tempId: tmpId(), product_id: '', name: '', unit: 'шт', quantity: '1' }]);
  const [deliveryType, setDeliveryType] = useState('pickup');
  const [address, setAddress] = useState('');
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState({});
  const [pickerOpen, setPickerOpen] = useState(null);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);

  const updateItem = (idx, patch) => setItems(arr => arr.map((it, i) => i === idx ? { ...it, ...patch } : it));
  const removeItem = (idx) => setItems(arr => arr.length === 1 ? arr : arr.filter((_, i) => i !== idx));
  const addItem = () => setItems(arr => [...arr, { tempId: tmpId(), product_id: '', name: '', unit: 'шт', quantity: '' }]);

  const handleSubmit = async () => {
    const e = {};
    if (!clientName.trim()) e.client = 'Укажите клиента';
    items.forEach((it, i) => {
      if (!it.name || it.name.trim().length < 2) e[`name_${i}`] = 'Укажите наименование';
      if (!Number(it.quantity) || Number(it.quantity) <= 0) e[`qty_${i}`] = 'Больше 0';
    });
    if (deliveryType === 'delivery' && !address.trim()) e.address = 'Укажите адрес доставки';
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    const r = await ctx.createGift({
      client_name: clientName.trim(),
      client_phone: clientPhone.trim() || null,
      items,
      delivery_type: deliveryType,
      address: deliveryType === 'delivery' ? address.trim() : null,
      comment: comment.trim() || null,
    });
    if (r.error) return showToast(r.error);
    showToast(`Заявка ${r.gift.number} отправлена на одобрение`);
    goBack();
  };

  const pickProduct = (p) => {
    if (pickerOpen === null) return;
    updateItem(pickerOpen, { product_id: p.id, name: p.name, unit: p.unit });
    setPickerOpen(null);
  };

  const pickClient = (c) => {
    setClientName(c.name || c.company || '');
    setClientPhone(c.phone || '');
    setClientPickerOpen(false);
  };

  return (
    <div>
      <PageHeader title="Заявка на подарок" subtitle="Укажите клиента, позиции и способ получения" onBack={goBack} />

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {/* Клиент */}
          <Card title="Клиент">
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>Имя / компания *</label>
                {(db.clients || []).length > 0 && (
                  <button onClick={() => setClientPickerOpen(true)}
                    className="w-full px-3 py-2 mb-2 rounded-lg flex items-center justify-between text-left text-sm bg-white"
                    style={{ border: '1px solid var(--mc-border)' }}>
                    <span style={{ color: clientName ? 'var(--mc-text)' : '#A8A8AE' }}>
                      {clientName || 'Выбрать из базы клиентов…'}
                    </span>
                    <ChevronRight size={16} style={{ color: '#A8A8AE' }} />
                  </button>
                )}
                <input value={clientName} onChange={e => setClientName(e.target.value)}
                  placeholder="Введите имя клиента"
                  className="w-full px-3 py-2 rounded-lg outline-none text-sm"
                  style={{ border: `1px solid ${errors.client ? '#EB5757' : 'var(--mc-border)'}` }} />
                {errors.client && <div className="text-xs mt-1" style={{ color: '#EB5757' }}>{errors.client}</div>}
              </div>
              <div>
                <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>Телефон (необязательно)</label>
                <input value={clientPhone} onChange={e => setClientPhone(e.target.value)}
                  placeholder="+7 (XXX) XXX-XX-XX"
                  className="w-full px-3 py-2 rounded-lg outline-none text-sm"
                  style={{ border: '1px solid var(--mc-border)' }} />
              </div>
            </div>
          </Card>

          {/* Позиции */}
          <Card title="Позиции подарка">
            <div className="space-y-3">
              {items.map((it, i) => (
                <div key={it.tempId} className="rounded-lg p-3" style={{ background: 'var(--mc-active-item)', border: '1px solid var(--mc-border)' }}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="text-xs font-semibold" style={{ color: 'var(--mc-muted)' }}>Позиция {i + 1}</div>
                    {items.length > 1 && (
                      <button onClick={() => removeItem(i)} className="p-1" style={{ color: '#EB5757' }}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div>
                      <button onClick={() => setPickerOpen(i)}
                        className="w-full px-3 py-2 rounded-lg flex items-center justify-between text-left text-sm bg-white"
                        style={{ border: `1px solid ${errors[`name_${i}`] && !it.name ? '#EB5757' : 'var(--mc-border)'}` }}>
                        {it.name ? (
                          <span className="truncate" style={{ color: 'var(--mc-text)' }}>
                            {it.name} <span style={{ color: 'var(--mc-muted)' }}>({it.unit})</span>
                          </span>
                        ) : (
                          <span style={{ color: '#A8A8AE' }}>Выбрать из базы…</span>
                        )}
                        <ChevronRight size={16} style={{ color: '#A8A8AE', flexShrink: 0 }} />
                      </button>
                      <div className="text-[11px] mt-1" style={{ color: 'var(--mc-muted)' }}>или впишите вручную:</div>
                      <input value={it.name || ''} onChange={e => updateItem(i, { name: e.target.value, product_id: '' })}
                        placeholder="Название товара"
                        className="w-full px-3 py-2 mt-1 rounded-lg outline-none text-sm"
                        style={{ border: `1px solid ${errors[`name_${i}`] && !it.name ? '#EB5757' : 'var(--mc-border)'}` }} />
                      {errors[`name_${i}`] && <div className="text-xs mt-1" style={{ color: '#EB5757' }}>{errors[`name_${i}`]}</div>}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>Кол-во *</label>
                        <input value={it.quantity || ''} onChange={e => updateItem(i, { quantity: e.target.value.replace(/[^0-9.]/g, '') })}
                          placeholder="1" className="w-full px-3 py-2 rounded-lg outline-none text-sm bg-white"
                          style={{ border: `1px solid ${errors[`qty_${i}`] ? '#EB5757' : 'var(--mc-border)'}` }} />
                        {errors[`qty_${i}`] && <div className="text-xs mt-1" style={{ color: '#EB5757' }}>{errors[`qty_${i}`]}</div>}
                      </div>
                      <div>
                        <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>Ед.</label>
                        <input value={it.unit || ''} onChange={e => updateItem(i, { unit: e.target.value })}
                          placeholder="шт" className="w-full px-3 py-2 rounded-lg outline-none text-sm bg-white"
                          style={{ border: '1px solid var(--mc-border)' }} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              <button onClick={addItem} className="w-full py-2 rounded-lg font-semibold text-sm flex items-center justify-center gap-1"
                style={{ background: '#fce7f3', color: '#EC4899' }}>
                <Plus size={14} /> Ещё позиция
              </button>
            </div>
          </Card>

          {/* Доставка / самовывоз */}
          <Card title="Способ получения">
            <div className="space-y-3">
              <div className="flex gap-2">
                {['pickup', 'delivery'].map(t => (
                  <button key={t} onClick={() => setDeliveryType(t)}
                    className="flex-1 py-2.5 rounded-lg font-semibold text-sm transition"
                    style={{
                      background: deliveryType === t ? (t === 'delivery' ? '#DBEAFE' : '#F0FDF4') : 'var(--mc-surface)',
                      color: deliveryType === t ? (t === 'delivery' ? '#1D4ED8' : '#15803D') : '#64748B',
                      border: deliveryType === t ? `2px solid ${t === 'delivery' ? '#3B82F6' : '#22C55E'}` : '1px solid var(--mc-border)',
                    }}>
                    {t === 'delivery' ? '🚚 Доставка' : '📦 Самовывоз'}
                  </button>
                ))}
              </div>
              {deliveryType === 'delivery' && (
                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>Адрес доставки *</label>
                  <input value={address} onChange={e => setAddress(e.target.value)}
                    placeholder="Улица, дом, квартира"
                    className="w-full px-3 py-2 rounded-lg outline-none text-sm"
                    style={{ border: `1px solid ${errors.address ? '#EB5757' : 'var(--mc-border)'}` }} />
                  {errors.address && <div className="text-xs mt-1" style={{ color: '#EB5757' }}>{errors.address}</div>}
                </div>
              )}
            </div>
          </Card>

          {/* Комментарий */}
          <Card title="Комментарий (необязательно)">
            <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3}
              placeholder="Повод, особые пожелания…"
              className="w-full px-3 py-2.5 rounded-lg outline-none"
              style={{ border: '1px solid var(--mc-border)', fontSize: 15 }} />
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Что будет дальше">
            <div className="text-sm space-y-2" style={{ color: 'var(--mc-muted)' }}>
              <div className="flex gap-2"><span style={{ color: '#F59E0B' }}>1.</span> Заявка уйдёт директору на одобрение.</div>
              <div className="flex gap-2"><span style={{ color: '#3390EC' }}>2.</span> После одобрения — админ или ст. менеджер спишет товар.</div>
              <div className="flex gap-2"><span style={{ color: '#8B5CF6' }}>3.</span> Склад подготовит подарок.</div>
              <div className="flex gap-2"><span style={{ color: '#22C55E' }}>4.</span> {deliveryType === 'delivery' ? 'Подарок будет доставлен клиенту.' : 'Клиент заберёт подарок.'}</div>
            </div>
          </Card>

          <button onClick={handleSubmit}
            className="w-full py-3 rounded-lg font-semibold text-white"
            style={{ background: '#EC4899' }}>
            Отправить на одобрение
          </button>
        </div>
      </div>

      {pickerOpen !== null && <ProductPickerModal db={db} onPick={pickProduct} onClose={() => setPickerOpen(null)} />}
      {clientPickerOpen && <ClientPickerModal db={db} onPick={pickClient} onClose={() => setClientPickerOpen(false)} />}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Детальный просмотр подарка
   ══════════════════════════════════════════════════════════════════════ */
function GiftDetailScreen({ ctx, giftId }) {
  const { db, currentUser, goBack, showToast } = ctx;
  const gift = (db.gifts || []).find(g => g.id === giftId);
  const [actionOpen, setActionOpen] = useState(null); // 'approve' | 'reject' | 'process' | 'prepare' | 'deliver'
  const [comment, setComment] = useState('');
  const [code, setCode] = useState('');
  const [docNo, setDocNo] = useState('');

  if (!gift) {
    return (
      <div>
        <PageHeader title="Подарок" onBack={goBack} />
        <Empty icon={Gift} title="Заявка не найдена" subtitle="Возможно, она была удалена" />
      </div>
    );
  }

  const s = GIFT_STATUS[gift.status] || GIFT_STATUS.pending;
  const Icon = s.icon;
  const author = db.users.find(u => u.id === gift.created_by);
  const approver = gift.approved_by ? db.users.find(u => u.id === gift.approved_by) : null;
  const processor = gift.processed_by ? db.users.find(u => u.id === gift.processed_by) : null;
  const preparer = gift.prepared_by ? db.users.find(u => u.id === gift.prepared_by) : null;
  const deliverer = gift.delivered_by ? db.users.find(u => u.id === gift.delivered_by) : null;

  const hasPerm = (p) => ctx.hasPermission?.(p);
  const canApprove = hasPerm('gift_approve') && gift.status === 'pending';
  const canProcess = hasPerm('gift_process') && gift.status === 'approved';
  const canPrepare = (currentUser.role === 'warehouse' || currentUser.role === 'admin') && gift.status === 'processed';
  const canDeliver = (currentUser.role === 'warehouse' || currentUser.role === 'admin') && gift.status === 'prepared';
  const canCancel = gift.created_by === currentUser.id && gift.status === 'pending';

  const doAction = (action) => {
    let r;
    switch (action) {
      case 'approve':
        r = ctx.approveGift(giftId, comment.trim() || null);
        break;
      case 'reject':
        if (!comment.trim()) return showToast('Укажите причину отклонения');
        r = ctx.rejectGift(giftId, comment.trim());
        break;
      case 'process':
        if (!docNo.trim()) return showToast('Укажите номер документа 1С');
        r = ctx.processGift(giftId, docNo.trim());
        break;
      case 'prepare':
        r = ctx.prepareGift(giftId);
        break;
      case 'deliver':
        if (gift.pickup_code && code.trim() !== gift.pickup_code) return showToast('Код выдачи не совпадает');
        r = ctx.deliverGift(giftId, code.trim());
        break;
      case 'cancel':
        r = ctx.cancelGift(giftId);
        break;
      default: return;
    }
    if (r?.error) return showToast(r.error);
    setActionOpen(null);
    setComment('');
    setCode('');
    setDocNo('');
    showToast(action === 'reject' ? 'Заявка отклонена' : action === 'cancel' ? 'Заявка отменена' : 'Готово!');
  };

  return (
    <div>
      <PageHeader title={`Подарок ${gift.number}`} onBack={goBack} />

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {/* Статус */}
          <div className="flex items-center gap-3 p-4 rounded-xl" style={{ background: s.bg, border: `1px solid ${s.color}30` }}>
            <Icon size={24} style={{ color: s.color }} />
            <div>
              <div className="font-bold text-sm" style={{ color: s.color }}>{s.label}</div>
              {gift.approval_comment && <div className="text-xs mt-0.5" style={{ color: s.color }}>«{gift.approval_comment}»</div>}
            </div>
          </div>

          {/* Информация */}
          <Card title="Информация о подарке">
            <div className="space-y-3">
              {gift.items && gift.items.length > 0 ? (
                <div>
                  <div className="text-sm font-medium mb-2" style={{ color: 'var(--mc-muted)' }}>
                    Позиции ({gift.items.length})
                  </div>
                  <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--mc-border)' }}>
                    {gift.items.map((it, i) => (
                      <div key={it.id || i} className="flex items-center justify-between px-3 py-2"
                        style={{ borderBottom: i < gift.items.length - 1 ? '1px solid var(--mc-border)' : 'none', background: 'var(--mc-active-item)' }}>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate" style={{ color: 'var(--mc-text)' }}>{it.name}</div>
                        </div>
                        <div className="text-sm font-semibold ml-3 whitespace-nowrap" style={{ color: '#EC4899' }}>
                          {it.quantity} {it.unit}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <InfoRow label="Товар" value={`${gift.product_name} × ${gift.quantity} ${gift.unit}`} />
              )}
              <InfoRow label="Клиент" value={gift.client_name} />
              {gift.client_phone && <InfoRow label="Телефон" value={gift.client_phone} />}
              <InfoRow label="Получение" value={DELIVERY_LABELS[gift.delivery_type]} />
              {gift.delivery_type === 'delivery' && gift.address && <InfoRow label="Адрес" value={gift.address} />}
              {gift.comment && <InfoRow label="Комментарий" value={gift.comment} />}
              {gift.pickup_code && (
                <div className="p-3 rounded-lg text-center" style={{ background: '#F0FDF4', border: '1px solid #86EFAC' }}>
                  <div className="text-xs font-semibold mb-1" style={{ color: '#15803D' }}>Код выдачи</div>
                  <div className="text-2xl font-bold tracking-widest" style={{ color: '#15803D' }}>{gift.pickup_code}</div>
                </div>
              )}
            </div>
          </Card>

          {/* История */}
          <Card title="История">
            <div className="space-y-2 text-sm">
              <HistoryRow label="Создал" user={author} date={gift.created_at} />
              {approver && <HistoryRow label={gift.status === 'rejected' ? 'Отклонил' : 'Одобрил'} user={approver} date={gift.approved_at} />}
              {processor && <HistoryRow label="Списал" user={processor} date={gift.processed_at} />}
              {gift.doc_no && <div className="text-xs pl-6" style={{ color: 'var(--mc-muted)', marginTop: -4 }}>Документ 1С: <span className="font-mono font-semibold" style={{ color: 'var(--mc-text)' }}>{gift.doc_no}</span></div>}
              {preparer && <HistoryRow label="Подготовил" user={preparer} date={gift.prepared_at} />}
              {deliverer && <HistoryRow label="Выдал" user={deliverer} date={gift.delivered_at} />}
            </div>
          </Card>
        </div>

        {/* Действия */}
        <div className="space-y-3">
          {canApprove && (
            <>
              <ActionButton color="#22C55E" label="Одобрить" onClick={() => setActionOpen('approve')} />
              <ActionButton color="#EB5757" label="Отклонить" onClick={() => setActionOpen('reject')} />
            </>
          )}
          {canProcess && <ActionButton color="#8B5CF6" label="Списать" onClick={() => setActionOpen('process')} />}
          {canPrepare && <ActionButton color="#6366F1" label="Подготовлено" onClick={() => doAction('prepare')} />}
          {canDeliver && <ActionButton color="#22C55E" label="Выдать / доставить" onClick={() => setActionOpen('deliver')} />}
          {canCancel && <ActionButton color="#94A3B8" label="Отменить заявку" onClick={() => doAction('cancel')} />}
        </div>
      </div>

      {/* Модалки действий */}
      {actionOpen === 'approve' && (
        <ActionModal title="Одобрить подарок" onClose={() => setActionOpen(null)}
          onConfirm={() => doAction('approve')} confirmLabel="Одобрить" confirmColor="#22C55E">
          <p className="text-sm mb-3" style={{ color: 'var(--mc-muted)' }}>
            {gift.items && gift.items.length > 0
              ? `${gift.items.length} поз. для ${gift.client_name}`
              : `${gift.product_name} × ${gift.quantity} для ${gift.client_name}`}
          </p>
          <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2}
            placeholder="Комментарий (необязательно)"
            className="w-full px-3 py-2 rounded-lg outline-none text-sm"
            style={{ border: '1px solid var(--mc-border)' }} />
        </ActionModal>
      )}
      {actionOpen === 'reject' && (
        <ActionModal title="Отклонить подарок" onClose={() => setActionOpen(null)}
          onConfirm={() => doAction('reject')} confirmLabel="Отклонить" confirmColor="#EB5757">
          <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3}
            placeholder="Причина отклонения *"
            className="w-full px-3 py-2 rounded-lg outline-none text-sm"
            style={{ border: `1px solid ${!comment.trim() ? '#EB5757' : 'var(--mc-border)'}` }} />
        </ActionModal>
      )}
      {actionOpen === 'process' && (
        <ActionModal title="Списать подарок" onClose={() => setActionOpen(null)}
          onConfirm={() => doAction('process')} confirmLabel="Списать" confirmColor="#8B5CF6">
          <p className="text-sm mb-3" style={{ color: 'var(--mc-muted)' }}>
            {gift.items && gift.items.length > 0
              ? `${gift.items.length} поз. для ${gift.client_name}`
              : `${gift.product_name} × ${gift.quantity} для ${gift.client_name}`}
          </p>
          <div className="mb-1">
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>
              Номер документа 1С *
            </label>
            <input value={docNo} onChange={e => setDocNo(e.target.value)}
              placeholder="00ЦТ-012573"
              className="w-full px-3 py-2.5 rounded-lg outline-none text-sm font-mono"
              style={{ border: `1px solid ${!docNo.trim() ? '#EB5757' : 'var(--mc-border)'}`, letterSpacing: '0.05em' }} />
            <div className="text-xs mt-1" style={{ color: 'var(--mc-muted)' }}>Формат: 00ЦТ-NNNNNN (4–7 цифр)</div>
          </div>
        </ActionModal>
      )}
      {actionOpen === 'deliver' && (
        <ActionModal title="Выдать подарок" onClose={() => setActionOpen(null)}
          onConfirm={() => doAction('deliver')} confirmLabel="Выдать" confirmColor="#22C55E">
          {gift.pickup_code ? (
            <div className="space-y-3">
              <p className="text-sm" style={{ color: 'var(--mc-muted)' }}>Введите код выдачи для подтверждения:</p>
              <input value={code} onChange={e => setCode(e.target.value)}
                placeholder="4-значный код" maxLength={4}
                className="w-full px-3 py-3 rounded-lg outline-none text-center text-2xl tracking-widest font-bold"
                style={{ border: '1px solid var(--mc-border)' }} />
            </div>
          ) : (
            <p className="text-sm" style={{ color: 'var(--mc-muted)' }}>Подтвердите выдачу подарка клиенту {gift.client_name}</p>
          )}
        </ActionModal>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Вспомогательные UI-компоненты
   ══════════════════════════════════════════════════════════════════════ */

function PageHeader({ title, subtitle, action, onBack }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div className="flex items-start gap-3 min-w-0">
        {onBack && (
          <button onClick={onBack} className="mt-1 p-1 rounded-lg hover:bg-gray-100">
            <ChevronRight size={20} style={{ color: 'var(--mc-muted)', transform: 'rotate(180deg)' }} />
          </button>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-bold" style={{ color: 'var(--mc-text)' }}>{title}</h1>
          {subtitle && <p className="text-sm mt-0.5" style={{ color: 'var(--mc-muted)' }}>{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
      {title && <div className="font-bold text-sm mb-3" style={{ color: 'var(--mc-text)' }}>{title}</div>}
      {children}
    </div>
  );
}

function Empty({ icon: Ic = Gift, title, subtitle }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Ic size={48} style={{ color: '#D1D5DB', marginBottom: 12 }} />
      <div className="font-semibold mb-1" style={{ color: '#9CA3AF' }}>{title}</div>
      {subtitle && <div className="text-sm" style={{ color: '#9CA3AF' }}>{subtitle}</div>}
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-sm font-medium" style={{ color: 'var(--mc-muted)' }}>{label}</span>
      <span className="text-sm text-right font-semibold" style={{ color: 'var(--mc-text)' }}>{value}</span>
    </div>
  );
}

function HistoryRow({ label, user, date }) {
  return (
    <div className="flex items-center justify-between gap-2" style={{ color: 'var(--mc-muted)' }}>
      <span>{label}: {user ? `${user.first_name} ${(user.last_name || '')[0] || ''}.` : '—'}</span>
      {date && <span className="text-xs">{fmtDateTime(date)}</span>}
    </div>
  );
}

function ActionButton({ color, label, onClick }) {
  return (
    <button onClick={onClick}
      className="w-full py-3 rounded-lg font-semibold text-white transition"
      style={{ background: color }}>
      {label}
    </button>
  );
}

function ActionModal({ title, children, onClose, onConfirm, confirmLabel, confirmColor }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-white rounded-2xl p-5 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg" style={{ color: 'var(--mc-text)' }}>{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">✕</button>
        </div>
        {children}
        <div className="flex gap-3 mt-4">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg font-semibold text-sm"
            style={{ background: 'var(--mc-surface)', color: 'var(--mc-muted)', border: '1px solid var(--mc-border)' }}>
            Отмена
          </button>
          <button onClick={onConfirm} className="flex-1 py-2.5 rounded-lg font-semibold text-white text-sm"
            style={{ background: confirmColor }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Пикер товаров ── */
function ProductPickerModal({ db, onPick, onClose }) {
  const products = db?.products || [];
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState(null);

  const cats = useMemo(() => {
    const allCats = Array.from(new Set(products.filter(p => p.active).map(p => p.cat)));
    return allCats.sort();
  }, [products]);

  const effectiveCat = activeCat || cats[0] || '';

  const filtered = useMemo(() => products.filter(p => p.active)
    .filter(p => !effectiveCat || p.cat === effectiveCat)
    .filter(p => matchesSearch(p.name, search)), [search, effectiveCat, products]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-white rounded-2xl p-5 w-full max-w-lg shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg" style={{ color: 'var(--mc-text)' }}>Выбор товара</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">✕</button>
        </div>
        <div className="space-y-3">
          <div className="relative">
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#A8A8AE' }} />
            <input className="w-full pl-9 pr-3 py-2 rounded-lg outline-none" style={{ border: '1px solid var(--mc-border)' }}
              placeholder="Поиск…" value={search} onChange={e => setSearch(e.target.value)} autoFocus />
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {cats.map(c => (
              <button key={c} onClick={() => setActiveCat(c)} className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold"
                style={{ background: effectiveCat === c ? '#EC4899' : 'var(--mc-active-item)', color: effectiveCat === c ? 'white' : 'var(--mc-muted)' }}>
                {c}
              </button>
            ))}
          </div>
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--mc-border)', maxHeight: 360, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div className="p-6 text-center text-sm" style={{ color: 'var(--mc-muted)' }}>Ничего не найдено</div>
            ) : (
              filtered.map(p => (
                <button key={p.id} onClick={() => onPick(p)}
                  className="w-full text-left px-3 py-2 flex items-start justify-between gap-3 hover:bg-gray-50 transition"
                  style={{ borderBottom: '1px solid #F1F5F9', background: 'var(--mc-surface)' }}>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium" style={{ color: 'var(--mc-text)' }}>{p.name}</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--mc-muted)' }}>{p.cat} · {p.unit}</div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Пикер клиентов ── */
function ClientPickerModal({ db, onPick, onClose }) {
  const clients = db?.clients || [];
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => clients.filter(c =>
    matchesSearch(`${c.name || ''} ${c.company || ''} ${c.phone || ''}`, search)
  ), [search, clients]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-white rounded-2xl p-5 w-full max-w-lg shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg" style={{ color: 'var(--mc-text)' }}>Выбор клиента</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">✕</button>
        </div>
        <div className="space-y-3">
          <div className="relative">
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#A8A8AE' }} />
            <input className="w-full pl-9 pr-3 py-2 rounded-lg outline-none" style={{ border: '1px solid var(--mc-border)' }}
              placeholder="Поиск по имени, компании, телефону…" value={search} onChange={e => setSearch(e.target.value)} autoFocus />
          </div>
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--mc-border)', maxHeight: 400, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div className="p-6 text-center text-sm" style={{ color: 'var(--mc-muted)' }}>Клиенты не найдены</div>
            ) : (
              filtered.map(c => (
                <button key={c.id} onClick={() => onPick(c)}
                  className="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-gray-50 transition"
                  style={{ borderBottom: '1px solid #F1F5F9', background: 'var(--mc-surface)' }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{ background: '#fce7f3', color: '#EC4899' }}>
                    {(c.name || c.company || '?')[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium" style={{ color: 'var(--mc-text)' }}>{c.name || c.company || '—'}</div>
                    {c.phone && <div className="text-xs" style={{ color: 'var(--mc-muted)' }}>{c.phone}</div>}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
