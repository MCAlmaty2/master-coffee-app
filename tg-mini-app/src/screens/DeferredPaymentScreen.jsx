import React, { useState, useMemo } from 'react';
import {
  Calendar, Plus, ChevronRight, ChevronLeft, Search, User, Phone,
  Check, AlertTriangle, Clock, Ban, Trash2, Edit3, CheckCircle2, ClipboardPaste,
} from 'lucide-react';

const TZ = 'Asia/Almaty';
const inputCls = 'w-full px-3 py-2 rounded-lg outline-none text-sm';
const inputBorder = (err) => ({ border: `1px solid ${err ? '#EB5757' : 'var(--mc-border)'}` });
const btnCancel = { background: 'var(--mc-surface)', color: 'var(--mc-muted)', border: '1px solid var(--mc-border)' };
const Chips = ({ items, value, onChange }) => (
  <div className="flex gap-1.5 mb-3 overflow-x-auto">
    {items.map(f => <button key={f.id} onClick={() => onChange(f.id)} className="whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold"
      style={{ background: value === f.id ? '#3B82F6' : 'var(--mc-surface)', color: value === f.id ? 'white' : '#64748B', border: value === f.id ? '1px solid #3B82F6' : '1px solid var(--mc-border)' }}>{f.label}</button>)}
  </div>
);
const fmtDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-KZ', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: TZ });
};
const fmtNum = (n) => (Number(n) || 0).toLocaleString('ru-RU').replace(/\s/g, ' ');
const todayStr = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 300);
  return d.toISOString().slice(0, 10);
};
const addDays = (dateStr, days) => {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const daysDiff = (a, b) => Math.round((new Date(a) - new Date(b)) / 86400000);

function getShipmentStatus(s) {
  if (s.paid_at) return 'paid';
  const paidAmt = Number(s.paid_amount) || 0;
  if (paidAmt > 0 && paidAmt < Number(s.amount)) return 'partial';
  const today = todayStr();
  if (today < s.due_date) return 'not_due';
  if (today === s.due_date) return 'due';
  return 'overdue';
}

const STATUS_META = {
  not_due:  { label: 'Срок не наступил', short: 'Ожидание', color: '#3390EC', bg: '#E7F3FE', icon: Clock },
  due:      { label: 'Срок наступил',    short: 'Сегодня',  color: '#F59E0B', bg: '#FEF3C7', icon: AlertTriangle },
  overdue:  { label: 'Просрочено',       short: 'Просроч.', color: '#EB5757', bg: '#FEE2E2', icon: Ban },
  partial:  { label: 'Частично оплач.',  short: 'Частично', color: '#8B5CF6', bg: '#EDE9FE', icon: Clock },
  paid:     { label: 'Оплачено',         short: 'Оплачено', color: '#22C55E', bg: '#DCFCE7', icon: Check },
};

export function DeferredPaymentScreen({ ctx }) {
  const { route } = ctx;
  if (route.name === 'deferred_client_detail') return <ClientDetailScreen ctx={ctx} clientId={route.clientId} />;
  if (route.name === 'deferred_client_create') return <ClientFormScreen ctx={ctx} />;
  if (route.name === 'deferred_client_edit') return <ClientFormScreen ctx={ctx} clientId={route.clientId} />;
  if (route.name === 'deferred_shipment_create') return <ShipmentFormScreen ctx={ctx} clientId={route.clientId} />;
  return <ClientListScreen ctx={ctx} />;
}

export function DeferredPaymentHomeBanner({ ctx }) {
  const { db, currentUser, navigate } = ctx;
  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'director';
  const myIds = new Set((db.deferredClients || []).filter(c => c.active && (isAdmin || c.manager_id === currentUser.id)).map(c => c.id));
  const open = (db.deferredShipments || []).filter(s => myIds.has(s.client_id) && !s.paid_at);
  const today = todayStr();
  const ov = open.filter(s => s.due_date < today).length;
  const due = open.filter(s => s.due_date === today).length;
  const soon = open.filter(s => { const d = daysDiff(s.due_date, today); return d > 0 && d <= 3; }).length;
  if (ov + due + soon === 0) return null;
  const parts = [ov > 0 && `просрочено: ${ov}`, due > 0 && `сегодня: ${due}`, soon > 0 && `ближайшие: ${soon}`].filter(Boolean).join(' · ');
  const bad = ov > 0;
  const c1 = bad ? '#EF4444' : '#3B82F6';
  return (
    <button onClick={() => navigate({ name: 'deferred_payments' })} className="w-full text-left rounded-2xl p-4 mb-3 transition hover:shadow-sm"
      style={{ background: bad ? 'linear-gradient(135deg,#fef2f2,#fee2e2)' : 'linear-gradient(135deg,#eff6ff,#dbeafe)', border: `1px solid ${bad ? '#fca5a5' : '#93c5fd'}` }}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: c1 + '20' }}><Calendar size={20} style={{ color: c1 }} /></div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm" style={{ color: bad ? '#991B1B' : '#1E40AF' }}>Отсрочки платежей</div>
          <div className="text-xs mt-0.5" style={{ color: bad ? '#B91C1C' : '#1D4ED8' }}>{parts}</div>
        </div>
        <ChevronRight size={18} style={{ color: c1 }} />
      </div>
    </button>
  );
}

/* ═══ Список клиентов ═══ */
function ClientListScreen({ ctx }) {
  const { db, currentUser, navigate } = ctx;
  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'director';
  const canManageClients = isAdmin || ctx.hasPermission('deferred_manage');
  const canViewAll = isAdmin || ctx.hasPermission('deferred_view_all');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('active');

  const clients = useMemo(() => {
    let list = db.deferredClients || [];
    if (!canViewAll) list = list.filter(c => c.manager_id === currentUser.id);
    if (filter === 'active') list = list.filter(c => c.active);
    else if (filter === 'inactive') list = list.filter(c => !c.active);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c => (c.name || '').toLowerCase().includes(q));
    }
    return list.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [db.deferredClients, currentUser, canViewAll, filter, search]);

  const shipments = db.deferredShipments || [];
  const today = todayStr();

  const getClientStats = (clientId) => {
    const cs = shipments.filter(s => s.client_id === clientId && !s.paid_at);
    return {
      total: cs.length,
      overdue: cs.filter(s => s.due_date < today).length,
      totalAmount: cs.reduce((sum, s) => sum + Number(s.amount) - (Number(s.paid_amount) || 0), 0),
    };
  };

  return (
    <div>
      <PageHeader
        title="Отсрочки платежей"
        subtitle={canViewAll ? 'Все клиенты' : 'Ваши клиенты'}
        action={canManageClients && (
          <button onClick={() => navigate({ name: 'deferred_client_create' })}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-white text-sm"
            style={{ background: '#3B82F6' }}>
            <Plus size={16} /> Добавить клиента
          </button>
        )}
        onBack={() => navigate({ name: 'home' })}
      />

      <div className="relative mb-4">
        <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#A8A8AE' }} />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Поиск клиента…"
          className="w-full pl-9 pr-3 py-2.5 rounded-lg outline-none text-sm"
          style={{ border: '1px solid var(--mc-border)', background: 'var(--mc-surface)' }} />
      </div>

      <Chips items={[{ id: 'active', label: 'Активные' }, { id: 'all', label: 'Все' }, { id: 'inactive', label: 'Неактивные' }]} value={filter} onChange={setFilter} />

      {clients.length === 0 ? (
        <Empty title="Клиентов не найдено" subtitle={isAdmin ? 'Добавьте клиента с отсрочкой' : 'У вас нет клиентов с отсрочкой'} />
      ) : (
        <div className="space-y-2">
          {clients.map(c => {
            const stats = getClientStats(c.id);
            const manager = (db.users || []).find(u => u.id === c.manager_id);
            return (
              <button key={c.id} onClick={() => navigate({ name: 'deferred_client_detail', clientId: c.id })}
                className="w-full text-left rounded-xl p-4 transition hover:shadow-sm"
                style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
                <div className="flex items-start justify-between gap-3 mb-1">
                  <div className="font-bold text-sm" style={{ color: 'var(--mc-text)' }}>{c.name}</div>
                  {stats.overdue > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: '#FEE2E2', color: '#EB5757' }}>
                      {stats.overdue} просроч.
                    </span>
                  )}
                </div>
                <div className="text-xs" style={{ color: 'var(--mc-muted)' }}>
                  Отсрочка: {c.default_days} дн. · Неоплач.: {stats.total} ({fmtNum(stats.totalAmount)} ₸)
                </div>
                {canViewAll && manager && (
                  <div className="text-xs mt-1" style={{ color: '#A8A8AE' }}>
                    <User size={11} className="inline mr-1" />
                    {manager.first_name} {(manager.last_name || '')[0] || ''}.
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══ Детальная карточка клиента + календарь отгрузок ═══ */
function ClientDetailScreen({ ctx, clientId }) {
  const { db, currentUser, navigate, goBack, showToast } = ctx;
  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'director';
  const canManageClients = isAdmin || ctx.hasPermission('deferred_manage');
  const canShipment = isAdmin || ctx.hasPermission('deferred_shipment');
  const client = (db.deferredClients || []).find(c => c.id === clientId);
  const [filter, setFilter] = useState('unpaid');
  const [showPayModal, setShowPayModal] = useState(null);
  const [payDate, setPayDate] = useState(todayStr());
  const [payAmount, setPayAmount] = useState('');
  const [showBulkImport, setShowBulkImport] = useState(false);

  if (!client) return (
    <div>
      <PageHeader title="Клиент" onBack={goBack} />
      <Empty title="Клиент не найден" />
    </div>
  );

  const manager = (db.users || []).find(u => u.id === client.manager_id);
  const isMyClient = client.manager_id === currentUser.id;
  const canManage = isAdmin || isMyClient || canShipment;
  const today = todayStr();

  const shipments = useMemo(() => {
    let list = (db.deferredShipments || []).filter(s => s.client_id === clientId);
    if (filter === 'unpaid') list = list.filter(s => !s.paid_at);
    else if (filter === 'partial') list = list.filter(s => !s.paid_at && (Number(s.paid_amount) || 0) > 0);
    else if (filter === 'overdue') list = list.filter(s => !s.paid_at && s.due_date < today);
    else if (filter === 'paid') list = list.filter(s => s.paid_at);
    return list.sort((a, b) => new Date(b.shipment_date) - new Date(a.shipment_date));
  }, [db.deferredShipments, clientId, filter, today]);

  const totalUnpaid = (db.deferredShipments || [])
    .filter(s => s.client_id === clientId && !s.paid_at)
    .reduce((sum, s) => sum + Number(s.amount) - (Number(s.paid_amount) || 0), 0);
  const overdueCount = (db.deferredShipments || [])
    .filter(s => s.client_id === clientId && !s.paid_at && s.due_date < today).length;

  const handlePay = () => {
    if (!showPayModal) return;
    const amt = Number(payAmount) || 0;
    if (amt <= 0) return showToast('Укажите сумму оплаты');
    const r = ctx.markDeferredShipmentPaid(showPayModal, payDate, amt);
    if (r?.error) return showToast(r.error);
    showToast(r.fullyPaid ? 'Полностью оплачено' : 'Частичная оплата внесена');
    setShowPayModal(null);
    setPayDate(todayStr());
    setPayAmount('');
  };

  const handleDelete = async (shipmentId) => {
    if (!confirm('Удалить отгрузку?')) return;
    const r = await ctx.deleteDeferredShipment(shipmentId);
    if (r?.error) return showToast(r.error);
    showToast('Отгрузка удалена');
  };

  return (
    <div>
      <PageHeader
        title={client.name}
        subtitle={`Отсрочка: ${client.default_days} дн. · Неоплач.: ${fmtNum(totalUnpaid)} ₸`}
        action={canManage && (
          <div className="flex gap-2">
            {canManageClients && (
              <button onClick={() => navigate({ name: 'deferred_client_edit', clientId })}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold"
                style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', color: 'var(--mc-text)' }}>
                <Edit3 size={14} /> Ред.
              </button>
            )}
            <button onClick={() => setShowBulkImport(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold"
              style={{ background: '#EDE9FE', color: '#7C3AED', border: '1px solid #C4B5FD' }}>
              <ClipboardPaste size={14} /> Импорт
            </button>
            <button onClick={() => navigate({ name: 'deferred_shipment_create', clientId })}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-white"
              style={{ background: '#3B82F6' }}>
              <Plus size={14} /> Отгрузка
            </button>
          </div>
        )}
        onBack={goBack}
      />

      {/* Инфо */}
      <Card>
        <div className="space-y-2 text-sm">
          <InfoRow label="Менеджер" value={manager ? `${manager.first_name} ${manager.last_name || ''}` : '—'} />
          <InfoRow label="Срок отсрочки" value={`${client.default_days} дней`} />
          <InfoRow label="Уведомление за" value={`${client.notify_days_before || 3} дн.`} />
          {client.phone && <InfoRow label="Телефон" value={client.phone} />}
          {client.contact_info && <InfoRow label="Контакт" value={client.contact_info} />}
          <InfoRow label="Статус" value={client.active ? 'Активен' : 'Неактивен'} />
        </div>
      </Card>

      {/* Сводка */}
      {overdueCount > 0 && (
        <div className="mt-3 p-3 rounded-xl flex items-center gap-3" style={{ background: '#FEE2E2', border: '1px solid #FECACA' }}>
          <AlertTriangle size={20} style={{ color: '#EB5757' }} />
          <div className="text-sm font-semibold" style={{ color: '#991B1B' }}>
            Просрочено: {overdueCount} отгрузок
          </div>
        </div>
      )}

      {/* Фильтры */}
      <div className="mt-4" />
      <Chips items={[{ id: 'unpaid', label: 'Неоплаченные' }, { id: 'partial', label: 'Частично' }, { id: 'overdue', label: 'Просроченные' }, { id: 'paid', label: 'Оплаченные' }, { id: 'all', label: 'Все' }]} value={filter} onChange={setFilter} />

      {/* Отгрузки */}
      {shipments.length === 0 ? (
        <Empty title="Нет отгрузок" subtitle="Добавьте первую отгрузку" />
      ) : (
        <div className="space-y-2">
          {shipments.map(s => {
            const status = getShipmentStatus(s);
            const meta = STATUS_META[status];
            const Icon = meta.icon;
            const overdueDays = status === 'overdue' ? daysDiff(today, s.due_date) : 0;
            const daysLeft = status === 'not_due' ? daysDiff(s.due_date, today) : 0;
            const paidAmt = Number(s.paid_amount) || 0;
            const remaining = Number(s.amount) - paidAmt;
            return (
              <div key={s.id} className="rounded-xl p-4"
                style={{ background: 'var(--mc-surface)', border: `1px solid ${status === 'overdue' ? '#FECACA' : status === 'partial' ? '#C4B5FD' : 'var(--mc-border)'}` }}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <div className="font-bold text-base" style={{ color: 'var(--mc-text)' }}>
                      {fmtNum(s.amount)} ₸
                    </div>
                    {s.invoice_no && (
                      <div className="text-xs mt-0.5" style={{ color: 'var(--mc-muted)' }}>№ {s.invoice_no}</div>
                    )}
                  </div>
                  <span className="inline-flex items-center gap-1 font-semibold rounded-full px-2.5 py-1 text-xs whitespace-nowrap"
                    style={{ background: meta.bg, color: meta.color }}>
                    <Icon size={11} /> {meta.short}
                    {status === 'overdue' && ` ${overdueDays} дн.`}
                    {status === 'not_due' && daysLeft <= 7 && ` ${daysLeft} дн.`}
                  </span>
                </div>
                {paidAmt > 0 && status !== 'paid' && (
                  <div className="mb-2 p-2 rounded-lg text-xs" style={{ background: '#EDE9FE', border: '1px solid #C4B5FD' }}>
                    <div className="flex justify-between">
                      <span style={{ color: '#6D28D9' }}>Оплачено: <b>{fmtNum(paidAmt)} ₸</b></span>
                      <span style={{ color: '#EB5757' }}>Остаток: <b>{fmtNum(remaining)} ₸</b></span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#DDD6FE' }}>
                      <div className="h-full rounded-full" style={{ background: '#8B5CF6', width: `${Math.min(100, (paidAmt / Number(s.amount)) * 100)}%` }} />
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--mc-muted)' }}>
                  <div>Отгрузка: <span style={{ color: 'var(--mc-text)' }}>{fmtDate(s.shipment_date)}</span></div>
                  <div>Оплата до: <span style={{ color: status === 'overdue' ? '#EB5757' : 'var(--mc-text)', fontWeight: status === 'overdue' ? 700 : 400 }}>{fmtDate(s.due_date)}</span></div>
                  <div>Отсрочка: {s.deferral_days} дн.</div>
                  {s.paid_at && <div>Оплачено: <span style={{ color: '#22C55E' }}>{fmtDate(s.paid_at)} ({fmtNum(s.amount)} ₸)</span></div>}
                </div>
                {s.comment && <div className="text-xs mt-1.5 italic" style={{ color: 'var(--mc-muted)' }}>{s.comment}</div>}
                {canManage && !s.paid_at && (
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => { setShowPayModal(s.id); setPayDate(todayStr()); setPayAmount(String(remaining)); }}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold text-white"
                      style={{ background: '#22C55E' }}>
                      <CheckCircle2 size={14} /> {paidAmt > 0 ? 'Доплатить' : 'Оплата'}
                    </button>
                    {canManageClients && (
                      <button onClick={() => handleDelete(s.id)}
                        className="px-3 py-2 rounded-lg" style={{ color: '#EB5757', background: '#FEE2E2' }}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Модалка оплаты */}
      {showPayModal && (() => {
        const modalShipment = (db.deferredShipments || []).find(s => s.id === showPayModal);
        const modalPaid = Number(modalShipment?.paid_amount) || 0;
        const modalRemaining = modalShipment ? Number(modalShipment.amount) - modalPaid : 0;
        return (
          <Modal title="Внести оплату" onClose={() => setShowPayModal(null)}>
            <div className="space-y-3">
              {modalShipment && (
                <div className="p-3 rounded-lg text-sm" style={{ background: '#F3F4F6' }}>
                  <div className="flex justify-between mb-1">
                    <span style={{ color: 'var(--mc-muted)' }}>Сумма отгрузки:</span>
                    <b>{fmtNum(modalShipment.amount)} ₸</b>
                  </div>
                  {modalPaid > 0 && (
                    <div className="flex justify-between mb-1">
                      <span style={{ color: 'var(--mc-muted)' }}>Уже оплачено:</span>
                      <span style={{ color: '#8B5CF6' }}><b>{fmtNum(modalPaid)} ₸</b></span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--mc-muted)' }}>Остаток:</span>
                    <span style={{ color: '#EB5757' }}><b>{fmtNum(modalRemaining)} ₸</b></span>
                  </div>
                </div>
              )}
              <div>
                <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>Сумма оплаты (₸) *</label>
                <input value={payAmount} onChange={e => setPayAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder={String(modalRemaining)}
                  className={inputCls} style={inputBorder()} />
                {Number(payAmount) > 0 && Number(payAmount) < modalRemaining && (
                  <div className="text-xs mt-1" style={{ color: '#8B5CF6' }}>Частичная оплата — останется {fmtNum(modalRemaining - Number(payAmount))} ₸</div>
                )}
              </div>
              <div>
                <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>Дата оплаты</label>
                <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)}
                  className={inputCls} style={inputBorder()} />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowPayModal(null)} className="flex-1 py-2.5 rounded-lg font-semibold text-sm"
                  style={{ background: 'var(--mc-surface)', color: 'var(--mc-muted)', border: '1px solid var(--mc-border)' }}>
                  Отмена
                </button>
                <button onClick={handlePay} className="flex-1 py-2.5 rounded-lg font-semibold text-white text-sm"
                  style={{ background: '#22C55E' }}>
                  {Number(payAmount) >= modalRemaining ? 'Оплатить полностью' : 'Внести оплату'}
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}

      {/* Модалка массового импорта */}
      {showBulkImport && (
        <BulkImportModal
          client={client}
          onClose={() => setShowBulkImport(false)}
          onCreate={ctx.createDeferredShipment}
          showToast={showToast}
        />
      )}
    </div>
  );
}

/* ═══ Парсер массового импорта ═══ */

const parseAmt = (s) => { if (s == null) return 0; const n = parseFloat(String(s).replace(/[\s ]/g, '').replace(',', '.')); return isNaN(n) ? 0 : n; };

function parseDate(s) {
  if (!s) return null;
  const t = s.trim();
  const m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

function parseBulkText(text) {
  const results = [];
  for (const line of text.split('\n').map(l => l.trim()).filter(Boolean)) {
    const cols = line.split('\t').length >= 3 ? line.split('\t') : line.split(/[;,]/);
    if (cols.length >= 3) {
      const row = { doc_no: (cols[0] || '').trim(), doc_date: parseDate(cols[1]) || (cols[1] || '').trim(), amount: parseAmt(cols[2]), comment: (cols[3] || '').trim() };
      if (row.doc_no && row.amount > 0) results.push(row);
    }
  }
  return results;
}

function BulkImportModal({ client, onClose, onCreate, showToast }) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState([]);
  const [step, setStep] = useState('input');

  const handleParse = () => {
    const rows = parseBulkText(text);
    if (rows.length === 0) return showToast('Не удалось разобрать строки. Формат: Номер TAB Дата TAB Сумма');
    setParsed(rows);
    setStep('preview');
  };

  const handleImport = () => {
    let ok = 0;
    const errors = [];
    for (let i = 0; i < parsed.length; i++) {
      const row = parsed[i];
      const dateStr = parseDate(row.doc_date) || row.doc_date;
      const dueDate = dateStr ? addDays(dateStr, client.default_days) : null;
      const r = onCreate({
        client_id: client.id,
        shipment_date: dateStr,
        amount: row.amount,
        invoice_no: row.doc_no,
        deferral_days: client.default_days,
        due_date: dueDate,
        comment: row.comment || null,
      });
      if (r?.ok) ok++;
      else errors.push(`№${row.doc_no}: ${r?.error || 'Ошибка'}`);
    }
    if (errors.length > 0) {
      showToast(`Ошибка: ${errors[0]}`);
      setParsed(p => p.filter((_, i) => i >= ok));
      return;
    }
    showToast(`Импортировано: ${ok}`);
    onClose();
  };

  const removeRow = (idx) => setParsed(p => p.filter((_, i) => i !== idx));

  const totalSum = parsed.reduce((s, r) => s + r.amount, 0);

  const Btn = ({ onClick, bg, disabled, children }) => (
    <button onClick={onClick} disabled={disabled} className="flex-1 py-2.5 rounded-lg font-semibold text-sm"
      style={bg ? { background: bg, color: 'white' } : btnCancel}>{children}</button>
  );

  return (
    <Modal title="Массовый импорт отгрузок" onClose={onClose}>
      {step === 'input' ? (
        <div className="space-y-3">
          <div className="p-3 rounded-lg text-xs" style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1E40AF' }}>
            <b>Клиент:</b> {client.name} (отсрочка {client.default_days} дн.)
            <div className="mt-1">Вставьте из 1С / Excel. Формат: <b>Номер</b> TAB <b>Дата</b> TAB <b>Сумма</b> [TAB Комментарий]</div>
          </div>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={8}
            placeholder={"00ЦТ-017353\t05.08.2026\t125 000\n00ЦТ-017410\t07.08.2026\t89 500"}
            className="w-full px-3 py-2.5 rounded-lg outline-none text-sm font-mono"
            style={{ border: '1px solid var(--mc-border)', resize: 'vertical' }} />
          <div className="flex gap-3">
            <Btn onClick={onClose}>Отмена</Btn>
            <Btn onClick={handleParse} bg="#7C3AED" disabled={!text.trim()}>Разобрать</Btn>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="p-3 rounded-lg text-sm flex justify-between" style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', color: '#166534' }}>
            <span>Отгрузок: <b>{parsed.length}</b></span>
            <span>Итого: <b>{fmtNum(totalSum)} ₸</b></span>
          </div>
          <div className="max-h-60 overflow-y-auto space-y-1.5">
            {parsed.map((row, i) => (
              <div key={i} className="flex items-center gap-2 p-2 rounded-lg text-xs" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
                <div className="flex-1 min-w-0">
                  <b style={{ color: 'var(--mc-text)' }}>№ {row.doc_no} — {fmtNum(row.amount)} ₸</b>
                  <div style={{ color: 'var(--mc-muted)' }}>{row.doc_date}{row.comment ? ` · ${row.comment}` : ''}</div>
                </div>
                <button onClick={() => removeRow(i)} className="p-1 rounded" style={{ color: '#EB5757' }}><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <Btn onClick={() => setStep('input')}>Назад</Btn>
            <Btn onClick={handleImport} bg="#22C55E" disabled={!parsed.length}>Импортировать ({parsed.length})</Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ═══ Форма создания/редактирования клиента (admin) ═══ */
function ClientFormScreen({ ctx, clientId }) {
  const { db, goBack, showToast } = ctx;
  const existing = clientId ? (db.deferredClients || []).find(c => c.id === clientId) : null;

  const [name, setName] = useState(existing?.name || '');
  const [managerId, setManagerId] = useState(existing?.manager_id || '');
  const [defaultDays, setDefaultDays] = useState(String(existing?.default_days || 14));
  const [notifyDays, setNotifyDays] = useState(String(existing?.notify_days_before || 3));
  const [phone, setPhone] = useState(existing?.phone || '');
  const [contactInfo, setContactInfo] = useState(existing?.contact_info || '');
  const [active, setActive] = useState(existing?.active !== false);
  const [errors, setErrors] = useState({});

  const managers = useMemo(() =>
    (db.users || []).filter(u => u.active && ['admin', 'director', 'senior_manager', 'manager', 'b2b'].includes(u.role))
      .sort((a, b) => `${a.first_name}`.localeCompare(`${b.first_name}`, 'ru')),
    [db.users]);

  const handleSubmit = () => {
    const e = {};
    if (!name.trim()) e.name = 'Укажите наименование';
    if (!managerId) e.manager = 'Выберите менеджера';
    if (!Number(defaultDays) || Number(defaultDays) < 1) e.days = 'Мин. 1 день';
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    const data = {
      name: name.trim(),
      manager_id: managerId,
      default_days: Number(defaultDays),
      notify_days_before: Number(notifyDays) || 3,
      phone: phone.trim() || null,
      contact_info: contactInfo.trim() || null,
      active,
    };

    let r;
    if (existing) {
      r = ctx.updateDeferredClient(clientId, data);
    } else {
      r = ctx.createDeferredClient(data);
    }
    if (r?.error) return showToast(r.error);
    showToast(existing ? 'Клиент обновлён' : 'Клиент добавлен');
    goBack();
  };

  return (
    <div>
      <PageHeader title={existing ? 'Редактировать клиента' : 'Новый клиент с отсрочкой'} onBack={goBack} />
      <div className="space-y-4 max-w-lg">
        <Card>
          <div className="space-y-3">
            <Field label="Наименование клиента *" error={errors.name}>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="ТОО Компания"
                className={inputCls} style={inputBorder(errors.name)} />
            </Field>
            <Field label="Ответственный менеджер *" error={errors.manager}>
              <select value={managerId} onChange={e => setManagerId(e.target.value)}
                className={inputCls + ' bg-white'} style={inputBorder(errors.manager)}>
                <option value="">Выберите…</option>
                {managers.map(u => (
                  <option key={u.id} value={u.id}>{u.first_name} {u.last_name || ''} ({u.role})</option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Дней отсрочки *" error={errors.days}>
                <input value={defaultDays} onChange={e => setDefaultDays(e.target.value.replace(/\D/g, ''))}
                  placeholder="14" className={inputCls} style={inputBorder(errors.days)} />
              </Field>
              <Field label="Уведомл. за (дн.)">
                <input value={notifyDays} onChange={e => setNotifyDays(e.target.value.replace(/\D/g, ''))}
                  placeholder="3" className={inputCls} style={inputBorder()} />
              </Field>
            </div>
            <Field label="Телефон">
              <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+7 ..."
                className={inputCls} style={inputBorder()} />
            </Field>
            <Field label="Контактные данные">
              <input value={contactInfo} onChange={e => setContactInfo(e.target.value)} placeholder="Email, доп. информация"
                className={inputCls} style={inputBorder()} />
            </Field>
            {existing && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
                <span className="text-sm" style={{ color: 'var(--mc-text)' }}>Активен</span>
              </label>
            )}
          </div>
        </Card>
        <button onClick={handleSubmit} className="w-full py-3 rounded-lg font-semibold text-white"
          style={{ background: '#3B82F6' }}>
          {existing ? 'Сохранить' : 'Добавить клиента'}
        </button>
      </div>
    </div>
  );
}

/* ═══ Форма добавления отгрузки ═══ */
function ShipmentFormScreen({ ctx, clientId }) {
  const { db, goBack, showToast } = ctx;
  const client = (db.deferredClients || []).find(c => c.id === clientId);

  const [shipmentDate, setShipmentDate] = useState(todayStr());
  const [amount, setAmount] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [deferralDays, setDeferralDays] = useState(String(client?.default_days || 14));
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState({});

  if (!client) return (
    <div>
      <PageHeader title="Отгрузка" onBack={goBack} />
      <Empty title="Клиент не найден" />
    </div>
  );

  const dueDate = shipmentDate && Number(deferralDays)
    ? addDays(shipmentDate, Number(deferralDays))
    : null;

  const handleSubmit = () => {
    const e = {};
    if (!shipmentDate) e.date = 'Укажите дату';
    if (!Number(amount) || Number(amount) <= 0) e.amount = 'Сумма > 0';
    if (!Number(deferralDays) || Number(deferralDays) < 1) e.days = 'Мин. 1 день';
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    const r = ctx.createDeferredShipment({
      client_id: clientId,
      shipment_date: shipmentDate,
      amount: Number(amount),
      invoice_no: invoiceNo.trim() || null,
      deferral_days: Number(deferralDays),
      due_date: dueDate,
      comment: comment.trim() || null,
    });
    if (r?.error) return showToast(r.error);
    showToast('Отгрузка добавлена');
    goBack();
  };

  return (
    <div>
      <PageHeader title="Новая отгрузка" subtitle={client.name} onBack={goBack} />
      <div className="space-y-4 max-w-lg">
        <Card>
          <div className="space-y-3">
            <Field label="Дата отгрузки *" error={errors.date}>
              <input type="date" value={shipmentDate} onChange={e => setShipmentDate(e.target.value)}
                className={inputCls} style={inputBorder(errors.date)} />
            </Field>
            <Field label="Сумма (₸) *" error={errors.amount}>
              <input value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="0" className={inputCls} style={inputBorder(errors.amount)} />
            </Field>
            <Field label="Номер накладной (необязательно)">
              <input value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)}
                placeholder="ТТН-001234"
                className={inputCls} style={inputBorder()} />
            </Field>
            <Field label="Дней отсрочки *" error={errors.days}>
              <input value={deferralDays} onChange={e => setDeferralDays(e.target.value.replace(/\D/g, ''))}
                className={inputCls} style={inputBorder(errors.days)} />
            </Field>
            {dueDate && (
              <div className="p-3 rounded-lg text-center" style={{ background: '#EFF6FF', border: '1px solid #BFDBFE' }}>
                <div className="text-xs font-semibold mb-0.5" style={{ color: '#1D4ED8' }}>Расчётная дата оплаты</div>
                <div className="text-lg font-bold" style={{ color: '#1E40AF' }}>{fmtDate(dueDate)}</div>
              </div>
            )}
            <Field label="Комментарий (необязательно)">
              <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2}
                placeholder="Примечание к отгрузке…"
                className={inputCls} style={inputBorder()} />
            </Field>
          </div>
        </Card>
        <button onClick={handleSubmit} className="w-full py-3 rounded-lg font-semibold text-white"
          style={{ background: '#3B82F6' }}>
          Добавить отгрузку
        </button>
      </div>
    </div>
  );
}

/* ═══ UI-компоненты ═══ */

const PageHeader = ({ title, subtitle, action, onBack }) => (
  <div className="flex items-start justify-between gap-4 mb-6">
    <div className="flex items-start gap-3 min-w-0">
      {onBack && <button onClick={onBack} className="mt-1 p-1 rounded-lg hover:bg-gray-100"><ChevronLeft size={20} style={{ color: 'var(--mc-muted)' }} /></button>}
      <div className="min-w-0">
        <h1 className="text-xl font-bold" style={{ color: 'var(--mc-text)' }}>{title}</h1>
        {subtitle && <p className="text-sm mt-0.5" style={{ color: 'var(--mc-muted)' }}>{subtitle}</p>}
      </div>
    </div>
    {action}
  </div>
);

const Card = ({ title, children }) => (
  <div className="rounded-xl p-4" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
    {title && <div className="font-bold text-sm mb-3" style={{ color: 'var(--mc-text)' }}>{title}</div>}
    {children}
  </div>
);

const Empty = ({ title, subtitle }) => (
  <div className="flex flex-col items-center justify-center py-16 text-center">
    <Calendar size={48} style={{ color: '#D1D5DB', marginBottom: 12 }} />
    <div className="font-semibold mb-1" style={{ color: '#9CA3AF' }}>{title}</div>
    {subtitle && <div className="text-sm" style={{ color: '#9CA3AF' }}>{subtitle}</div>}
  </div>
);

const InfoRow = ({ label, value }) => (
  <div className="flex justify-between gap-4">
    <span className="text-sm" style={{ color: 'var(--mc-muted)' }}>{label}</span>
    <span className="text-sm text-right font-semibold" style={{ color: 'var(--mc-text)' }}>{value}</span>
  </div>
);

const Field = ({ label, error, children }) => (
  <div>
    <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>{label}</label>
    {children}
    {error && <div className="text-xs mt-1" style={{ color: '#EB5757' }}>{error}</div>}
  </div>
);

const Modal = ({ title, children, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
    <div className="bg-white rounded-2xl p-5 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-lg" style={{ color: 'var(--mc-text)' }}>{title}</h3>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">&times;</button>
      </div>
      {children}
    </div>
  </div>
);
