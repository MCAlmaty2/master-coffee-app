import React, { useState, useMemo } from 'react';
import {
  Plus, Trash2, Check, X, ChevronDown, Search, Clock, CheckCircle2,
  XCircle, AlertCircle, Edit3, Eye, Package, User,
} from 'lucide-react';

const COFFEE_CAT = 'Кофе зерно';
const TZ = 'Asia/Almaty';
const fmtNum = (n) => (Number(n) || 0).toLocaleString('ru-RU').replace(/\s/g, ' ');
const fmtDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-KZ', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: TZ });
};
const todayISO = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 300);
  return d.toISOString().slice(0, 10);
};

const STATUS_MAP = {
  pending:  { label: 'На согласовании', color: '#F59E0B', bg: '#FEF3C7', icon: Clock },
  approved: { label: 'Одобрена',        color: '#3B82F6', bg: '#DBEAFE', icon: CheckCircle2 },
  rejected: { label: 'Отклонена',       color: '#EB5757', bg: '#FEE2E2', icon: XCircle },
  active:   { label: 'Активна',         color: '#22C55E', bg: '#DCFCE7', icon: CheckCircle2 },
  expired:  { label: 'Истекла',         color: '#64748B', bg: '#F1F5F9', icon: AlertCircle },
};

const inputCls = 'w-full px-3 py-2 rounded-lg outline-none text-sm';
const inputStyle = { border: '1px solid var(--mc-border)', background: 'var(--mc-surface)', color: 'var(--mc-text)' };

// ═══════════════════════════════════════════════════════════
//  Прайс-лист по объёму (Админ)
// ═══════════════════════════════════════════════════════════

export function VolumePriceTiersScreen({ ctx }) {
  const { db, currentUser, showToast, currentOrgId, can } = ctx;
  const coffeeProducts = useMemo(
    () => (db.products || []).filter(p => p.cat === COFFEE_CAT && p.active && p.unit === 'кг'),
    [db.products],
  );
  const tiers = db.volumePriceTiers || [];
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ min_kg: '', max_kg: '', price: '' });
  const [editId, setEditId] = useState(null);

  const productTiers = useMemo(
    () => selectedProduct ? tiers.filter(t => t.product_id === selectedProduct).sort((a, b) => a.min_kg - b.min_kg) : [],
    [tiers, selectedProduct],
  );

  const saveTier = async () => {
    const min = Number(form.min_kg);
    const max = form.max_kg === '' ? null : Number(form.max_kg);
    const price = Number(form.price);
    if (isNaN(min) || isNaN(price) || price <= 0) {
      showToast('Заполните корректно все поля');
      return;
    }
    const row = {
      product_id: selectedProduct,
      min_kg: min,
      max_kg: max,
      price,
      org_id: currentOrgId,
      updated_at: new Date().toISOString(),
    };
    if (editId) {
      await ctx.updateVolumeTier(editId, row);
      showToast('Порог обновлён');
    } else {
      await ctx.createVolumeTier(row);
      showToast('Порог добавлен');
    }
    setForm({ min_kg: '', max_kg: '', price: '' });
    setAdding(false);
    setEditId(null);
  };

  const startEdit = (t) => {
    setEditId(t.id);
    setForm({ min_kg: String(t.min_kg), max_kg: t.max_kg != null ? String(t.max_kg) : '', price: String(t.price) });
    setAdding(true);
  };

  const productsWithTiers = useMemo(() => {
    const tierMap = {};
    tiers.forEach(t => { tierMap[t.product_id] = (tierMap[t.product_id] || 0) + 1; });
    return coffeeProducts.map(p => ({ ...p, tierCount: tierMap[p.id] || 0 }));
  }, [coffeeProducts, tiers]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold" style={{ color: 'var(--mc-text)' }}>Прайс-лист по объёму</h2>
          <div className="text-xs" style={{ color: 'var(--mc-muted)' }}>Цены на кофе зерно в зависимости от объёма закупа</div>
        </div>
      </div>

      {!selectedProduct ? (
        <div className="space-y-2">
          {productsWithTiers.map(p => (
            <button key={p.id} onClick={() => setSelectedProduct(p.id)}
              className="w-full flex items-center justify-between p-3 rounded-xl text-left"
              style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
              <div>
                <div className="text-sm font-semibold" style={{ color: 'var(--mc-text)' }}>{p.name}</div>
                <div className="text-xs" style={{ color: 'var(--mc-muted)' }}>
                  Базовая: {fmtNum(p.price)} ₸/кг
                </div>
              </div>
              <div className="flex items-center gap-2">
                {p.tierCount > 0 && (
                  <span className="text-[10px] font-semibold rounded-full px-2 py-0.5" style={{ background: '#DCFCE7', color: '#166534' }}>
                    {p.tierCount} порогов
                  </span>
                )}
                <ChevronDown size={16} style={{ color: 'var(--mc-muted)', transform: 'rotate(-90deg)' }} />
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div>
          <button onClick={() => { setSelectedProduct(null); setAdding(false); setEditId(null); }}
            className="flex items-center gap-1 text-xs font-semibold mb-3 px-2 py-1 rounded-lg"
            style={{ color: '#3B82F6' }}>
            ← Назад к товарам
          </button>

          <div className="rounded-xl p-3 mb-3" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
            <div className="text-sm font-bold" style={{ color: 'var(--mc-text)' }}>
              {coffeeProducts.find(p => p.id === selectedProduct)?.name}
            </div>
            <div className="text-xs" style={{ color: 'var(--mc-muted)' }}>
              Базовая цена: {fmtNum(coffeeProducts.find(p => p.id === selectedProduct)?.price)} ₸/кг
            </div>
          </div>

          {productTiers.length > 0 && (
            <div className="rounded-xl overflow-hidden mb-3" style={{ border: '1px solid var(--mc-border)' }}>
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ background: 'var(--mc-active-item)' }}>
                    <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--mc-muted)' }}>Объём (кг)</th>
                    <th className="text-right px-3 py-2 font-semibold" style={{ color: 'var(--mc-muted)' }}>Цена ₸/кг</th>
                    <th className="w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {productTiers.map(t => (
                    <tr key={t.id} style={{ borderTop: '1px solid var(--mc-border)' }}>
                      <td className="px-3 py-2 font-semibold" style={{ color: 'var(--mc-text)' }}>
                        {t.max_kg != null ? `${fmtNum(t.min_kg)} – ${fmtNum(t.max_kg)}` : `от ${fmtNum(t.min_kg)}`}
                      </td>
                      <td className="px-3 py-2 text-right font-bold" style={{ color: '#297b8a' }}>
                        {fmtNum(t.price)}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => startEdit(t)} className="p-1" style={{ color: '#3B82F6' }}><Edit3 size={13} /></button>
                          <button onClick={async () => {
                            await ctx.deleteVolumeTier(t.id);
                            showToast('Порог удалён');
                          }} className="p-1" style={{ color: '#EB5757' }}><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {adding ? (
            <div className="rounded-xl p-3 space-y-2" style={{ background: 'var(--mc-active-item)', border: '1px solid var(--mc-border)' }}>
              <div className="text-xs font-semibold mb-1" style={{ color: 'var(--mc-text)' }}>
                {editId ? 'Редактировать порог' : 'Новый порог'}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] font-semibold block mb-0.5" style={{ color: 'var(--mc-muted)' }}>От (кг)</label>
                  <input type="number" value={form.min_kg} onChange={e => setForm(f => ({ ...f, min_kg: e.target.value }))}
                    className={inputCls} style={inputStyle} placeholder="1" />
                </div>
                <div>
                  <label className="text-[10px] font-semibold block mb-0.5" style={{ color: 'var(--mc-muted)' }}>До (кг)</label>
                  <input type="number" value={form.max_kg} onChange={e => setForm(f => ({ ...f, max_kg: e.target.value }))}
                    className={inputCls} style={inputStyle} placeholder="пусто = ∞" />
                </div>
                <div>
                  <label className="text-[10px] font-semibold block mb-0.5" style={{ color: 'var(--mc-muted)' }}>Цена ₸</label>
                  <input type="number" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                    className={inputCls} style={inputStyle} placeholder="12990" />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => { setAdding(false); setEditId(null); setForm({ min_kg: '', max_kg: '', price: '' }); }}
                  className="flex-1 text-xs font-semibold py-2 rounded-lg"
                  style={{ background: 'var(--mc-surface)', color: 'var(--mc-muted)', border: '1px solid var(--mc-border)' }}>
                  Отмена
                </button>
                <button onClick={saveTier}
                  className="flex-1 text-xs font-semibold py-2 rounded-lg text-white"
                  style={{ background: '#297b8a' }}>
                  {editId ? 'Сохранить' : 'Добавить'}
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAdding(true)}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold"
              style={{ border: '2px dashed var(--mc-border)', color: 'var(--mc-muted)' }}>
              <Plus size={14} /> Добавить порог
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  Спец. цены клиентов (менеджер + админ)
// ═══════════════════════════════════════════════════════════

export function ClientSpecialPricesScreen({ ctx }) {
  const { db, currentUser, showToast, navigate, can } = ctx;
  const isAdmin = currentUser.role === 'admin' || currentUser.is_super_admin;
  const specialPrices = db.clientSpecialPrices || [];
  const products = useMemo(
    () => (db.products || []).filter(p => p.cat === COFFEE_CAT && p.active && p.unit === 'кг'),
    [db.products],
  );

  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    let list = specialPrices;
    if (filter !== 'all') list = list.filter(s => s.status === filter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(s => s.client_name.toLowerCase().includes(q));
    }
    return list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [specialPrices, filter, search]);

  const grouped = useMemo(() => {
    const map = {};
    filtered.forEach(sp => {
      if (!map[sp.client_name]) map[sp.client_name] = [];
      map[sp.client_name].push(sp);
    });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const filters = [
    { id: 'all', label: `Все (${specialPrices.length})` },
    { id: 'pending', label: `Ожидают (${specialPrices.filter(s => s.status === 'pending').length})` },
    { id: 'active', label: `Активные (${specialPrices.filter(s => s.status === 'active' || s.status === 'approved').length})` },
    { id: 'expired', label: `Истекшие (${specialPrices.filter(s => s.status === 'expired').length})` },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-bold" style={{ color: 'var(--mc-text)' }}>Спец. цены клиентов</h2>
          <div className="text-xs" style={{ color: 'var(--mc-muted)' }}>Индивидуальные цены с согласованием</div>
        </div>
        {!ctx.isViewer && (
          <button onClick={() => setCreating(true)}
            className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold text-white"
            style={{ background: '#297b8a' }}>
            <Plus size={14} /> Новая
          </button>
        )}
      </div>

      <div className="flex gap-1.5 mb-3 overflow-x-auto">
        {filters.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className="whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold"
            style={{ background: filter === f.id ? '#297b8a' : 'var(--mc-surface)', color: filter === f.id ? 'white' : '#64748B',
                     border: filter === f.id ? '1px solid #297b8a' : '1px solid var(--mc-border)' }}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="relative mb-3">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--mc-muted)' }} />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по имени клиента..."
          className="w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none"
          style={{ border: '1px solid var(--mc-border)', background: 'var(--mc-surface)', color: 'var(--mc-text)' }} />
      </div>

      {creating && (
        <CreateSpecialPriceForm
          ctx={ctx}
          products={products}
          onClose={() => setCreating(false)}
        />
      )}

      {grouped.length === 0 && !creating && (
        <div className="text-center py-8 text-sm" style={{ color: 'var(--mc-muted)' }}>
          {search ? 'Ничего не найдено' : 'Нет спец. цен'}
        </div>
      )}

      <div className="space-y-3">
        {grouped.map(([clientName, items]) => (
          <ClientPriceCard key={clientName} clientName={clientName} items={items} ctx={ctx} products={products} />
        ))}
      </div>
    </div>
  );
}

function ClientPriceCard({ clientName, items, ctx, products }) {
  const { db, currentUser, showToast } = ctx;
  const isAdmin = currentUser.role === 'admin' || currentUser.is_super_admin;
  const [open, setOpen] = useState(false);
  const manager = db.users.find(u => u.id === items[0]?.manager_id);

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--mc-border)', background: 'var(--mc-surface)' }}>
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center justify-between p-3 text-left">
        <div>
          <div className="text-sm font-bold" style={{ color: 'var(--mc-text)' }}>{clientName}</div>
          <div className="text-[10px] flex items-center gap-1.5" style={{ color: 'var(--mc-muted)' }}>
            <User size={10} /> {manager ? `${manager.first_name} ${manager.last_name || ''}`.trim() : '—'}
            <span>·</span>
            <span>{items.length} товар(ов)</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(() => {
            const statuses = [...new Set(items.map(i => i.status))];
            return statuses.map(s => {
              const st = STATUS_MAP[s] || STATUS_MAP.pending;
              return (
                <span key={s} className="text-[10px] font-semibold rounded-full px-2 py-0.5" style={{ background: st.bg, color: st.color }}>
                  {st.label}
                </span>
              );
            });
          })()}
          <ChevronDown size={16} style={{ color: 'var(--mc-muted)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2" style={{ borderTop: '1px solid var(--mc-border)' }}>
          {items.map(sp => {
            const product = products.find(p => p.id === sp.product_id);
            const st = STATUS_MAP[sp.status] || STATUS_MAP.pending;
            const Icon = st.icon;
            return (
              <div key={sp.id} className="flex items-center justify-between rounded-lg p-2.5" style={{ background: 'var(--mc-active-item)' }}>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold truncate" style={{ color: 'var(--mc-text)' }}>
                    {product?.name || sp.product_id}
                  </div>
                  <div className="text-[10px] flex items-center gap-2 mt-0.5" style={{ color: 'var(--mc-muted)' }}>
                    <span>Спец: <b style={{ color: '#297b8a' }}>{fmtNum(sp.special_price)} ₸</b></span>
                    {product && <span>Баз: {fmtNum(product.price)} ₸</span>}
                    <span>Срок: {sp.valid_months} мес</span>
                  </div>
                  {sp.first_shipment_date && (
                    <div className="text-[10px] mt-0.5" style={{ color: 'var(--mc-muted)' }}>
                      1-я отгрузка: {fmtDate(sp.first_shipment_date)} · до {fmtDate(sp.valid_until)}
                    </div>
                  )}
                  {sp.notes && <div className="text-[10px] italic mt-0.5" style={{ color: 'var(--mc-muted)' }}>{sp.notes}</div>}
                </div>
                <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
                  <span className="flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-0.5" style={{ background: st.bg, color: st.color }}>
                    <Icon size={10} /> {st.label}
                  </span>
                  {isAdmin && sp.status === 'pending' && !ctx.isViewer && (
                    <>
                      <button onClick={async () => {
                        await ctx.approveSpecialPrice(sp.id);
                        showToast('Спец. цена одобрена');
                      }} className="p-1 rounded" style={{ color: '#22C55E' }}>
                        <Check size={16} />
                      </button>
                      <button onClick={async () => {
                        await ctx.rejectSpecialPrice(sp.id);
                        showToast('Спец. цена отклонена');
                      }} className="p-1 rounded" style={{ color: '#EB5757' }}>
                        <X size={16} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CreateSpecialPriceForm({ ctx, products, onClose }) {
  const { db, currentUser, showToast, currentOrgId } = ctx;
  const [clientName, setClientName] = useState('');
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [validMonths, setValidMonths] = useState('3');
  const [notes, setNotes] = useState('');

  const clients = useMemo(() => {
    const names = new Set();
    (db.orders || []).forEach(o => { if (o.full_name) names.add(o.full_name); if (o.company_name) names.add(o.company_name); });
    (db.clientSpecialPrices || []).forEach(sp => names.add(sp.client_name));
    return [...names].sort();
  }, [db.orders, db.clientSpecialPrices]);

  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const filteredClients = clientName.length > 0 ? clients.filter(c => c.toLowerCase().includes(clientName.toLowerCase())) : [];

  const toggleProduct = (pid) => {
    setSelectedProducts(prev => {
      const existing = prev.find(p => p.id === pid);
      if (existing) return prev.filter(p => p.id !== pid);
      return [...prev, { id: pid, price: '' }];
    });
  };

  const setProductPrice = (pid, price) => {
    setSelectedProducts(prev => prev.map(p => p.id === pid ? { ...p, price } : p));
  };

  const submit = async () => {
    if (clientName.trim().length < 3) { showToast('Укажите имя клиента (мин. 3 символа)'); return; }
    if (selectedProducts.length === 0) { showToast('Выберите хотя бы один товар'); return; }
    const months = Number(validMonths);
    if (!months || months < 1) { showToast('Укажите срок'); return; }

    for (const sp of selectedProducts) {
      const price = Number(sp.price);
      if (!price || price <= 0) { showToast('Укажите цену для всех товаров'); return; }
    }

    for (const sp of selectedProducts) {
      await ctx.createSpecialPrice({
        client_name: clientName.trim(),
        manager_id: currentUser.id,
        product_id: sp.id,
        special_price: Number(sp.price),
        valid_months: months,
        notes: notes.trim() || null,
        org_id: currentOrgId,
      });
    }
    showToast('Запрос на спец. цену отправлен на согласование');
    onClose();
  };

  return (
    <div className="rounded-xl p-4 mb-4 space-y-3" style={{ background: 'var(--mc-active-item)', border: '1px solid var(--mc-border)' }}>
      <div className="text-sm font-bold" style={{ color: 'var(--mc-text)' }}>Новая спец. цена</div>

      <div className="relative">
        <label className="text-[10px] font-semibold block mb-0.5" style={{ color: 'var(--mc-muted)' }}>Клиент</label>
        <input value={clientName} onChange={e => { setClientName(e.target.value); setShowClientSuggestions(true); }}
          onFocus={() => setShowClientSuggestions(true)}
          className={inputCls} style={inputStyle} placeholder="Имя клиента" maxLength={21} />
        {showClientSuggestions && filteredClients.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-lg shadow-lg max-h-32 overflow-y-auto"
            style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
            {filteredClients.slice(0, 5).map(c => (
              <button key={c} onClick={() => { setClientName(c); setShowClientSuggestions(false); }}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100" style={{ color: 'var(--mc-text)' }}>
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <label className="text-[10px] font-semibold block mb-1" style={{ color: 'var(--mc-muted)' }}>Товары и спец. цены</label>
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {products.map(p => {
            const sel = selectedProducts.find(s => s.id === p.id);
            return (
              <div key={p.id} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
                style={{ background: sel ? '#E7F3FE' : 'var(--mc-surface)', border: `1px solid ${sel ? '#3B82F6' : 'var(--mc-border)'}` }}>
                <button onClick={() => toggleProduct(p.id)} className="flex-1 text-left min-w-0">
                  <div className="text-xs font-semibold truncate" style={{ color: 'var(--mc-text)' }}>{p.name}</div>
                  <div className="text-[10px]" style={{ color: 'var(--mc-muted)' }}>Базовая: {fmtNum(p.price)} ₸</div>
                </button>
                {sel && (
                  <input type="number" value={sel.price} onChange={e => setProductPrice(p.id, e.target.value)}
                    placeholder="Цена"
                    className="w-24 px-2 py-1 rounded-md text-xs text-right outline-none"
                    style={{ border: '1px solid var(--mc-border)', background: 'var(--mc-bg)' }} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] font-semibold block mb-0.5" style={{ color: 'var(--mc-muted)' }}>Срок (месяцев)</label>
          <input type="number" value={validMonths} onChange={e => setValidMonths(e.target.value)}
            className={inputCls} style={inputStyle} placeholder="3" min="1" />
        </div>
        <div>
          <label className="text-[10px] font-semibold block mb-0.5" style={{ color: 'var(--mc-muted)' }}>Примечание</label>
          <input value={notes} onChange={e => setNotes(e.target.value)}
            className={inputCls} style={inputStyle} placeholder="Опционально" />
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button onClick={onClose}
          className="flex-1 text-xs font-semibold py-2.5 rounded-lg"
          style={{ background: 'var(--mc-surface)', color: 'var(--mc-muted)', border: '1px solid var(--mc-border)' }}>
          Отмена
        </button>
        <button onClick={submit}
          className="flex-1 text-xs font-semibold py-2.5 rounded-lg text-white"
          style={{ background: '#297b8a' }}>
          Отправить на согласование
        </button>
      </div>
    </div>
  );
}
