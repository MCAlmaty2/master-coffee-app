import React, { useState, useMemo } from 'react';
import {
  ChevronLeft, Plus, X, ArrowDownCircle, ArrowUpCircle,
  RotateCcw, ChevronDown, ChevronUp, Banknote, Pencil,
} from 'lucide-react';
const TZ = 'Asia/Almaty';

const DENOMINATIONS = [20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];

const CATEGORIES = [
  'Мега перевозки', 'Бензин и транспорт', 'Ком.услуги', 'Охрана',
  'Интернет', 'Списания', 'Маркетинг', 'Полиграфия',
  'Расходы офиса', 'Тех.сервис', 'Бариста', 'Ларгус', 'Прочее',
];

const TYPE_META = {
  income:  { label: 'Приход',  color: '#22C55E', icon: ArrowDownCircle },
  expense: { label: 'Расход',  color: '#EF4444', icon: ArrowUpCircle },
  return:  { label: 'Возврат', color: '#3B82F6', icon: RotateCcw },
};

function fmtMoney(n) {
  return n.toLocaleString('ru-RU') + ' ₸';
}

function fmtDateTime(iso) {
  return new Date(iso).toLocaleString('ru', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function fmtDateFull(iso) {
  return new Date(iso).toLocaleString('ru', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function calcSafeBalance(ops) {
  const bal = {};
  DENOMINATIONS.forEach(d => bal[d] = 0);
  ops.forEach(op => {
    DENOMINATIONS.forEach(d => {
      const count = op.bills[d] || 0;
      if (op.type === 'expense') bal[d] -= count;
      else bal[d] += count;
    });
  });
  return bal;
}

export default function CashScreen({ ctx }) {
  const { navigate, currentUser, db, setDb } = ctx;
  const [showAdd, setShowAdd] = useState(false);
  const [editingBalance, setEditingBalance] = useState(false);
  const [editedBills, setEditedBills] = useState({});
  const [expandedOp, setExpandedOp] = useState(null);
  const [filterType, setFilterType] = useState(null);

  const ops = useMemo(() =>
    [...(db.cashOperations || [])].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [db.cashOperations],
  );

  const handleAddOp = async (op) => {
    const userName = currentUser ? `${(currentUser.first_name || '')} ${(currentUser.last_name || '').charAt(0)}.`.trim() : '';
    const newOp = {
      ...op,
      id: crypto.randomUUID(),
      created_by: currentUser?.id || null,
      created_by_name: userName || 'Пользователь',
      created_at: new Date().toISOString(),
    };
    setDb(d => ({ ...d, cashOperations: [newOp, ...(d.cashOperations || [])] }));
    setShowAdd(false);
  };

  const filtered = filterType ? ops.filter(o => o.type === filterType) : ops;
  const safeBalance = useMemo(() => calcSafeBalance(ops), [ops]);
  const safeTotal = DENOMINATIONS.reduce((s, d) => s + d * safeBalance[d], 0);

  const startEditBalance = () => {
    const copy = {};
    DENOMINATIONS.forEach(d => copy[d] = safeBalance[d]);
    setEditedBills(copy);
    setEditingBalance(true);
  };

  const saveBalanceEdit = () => {
    const delta = {};
    let hasDiff = false;
    DENOMINATIONS.forEach(d => {
      delta[d] = (editedBills[d] || 0) - safeBalance[d];
      if (delta[d] !== 0) hasDiff = true;
    });
    if (!hasDiff) { setEditingBalance(false); return; }
    const total = DENOMINATIONS.reduce((s, d) => s + d * delta[d], 0);
    const userName = currentUser ? `${(currentUser.first_name || '')} ${(currentUser.last_name || '').charAt(0)}.`.trim() : '';
    const adj = {
      id: crypto.randomUUID(),
      type: 'income',
      bills: delta,
      total: Math.abs(total),
      description: total === 0 ? 'Размен купюр' : 'Корректировка остатка',
      category: '',
      person_name: '',
      created_by: currentUser?.id || null,
      created_by_name: userName || 'Пользователь',
      created_at: new Date().toISOString(),
    };
    setDb(d => ({ ...d, cashOperations: [adj, ...(d.cashOperations || [])] }));
    setEditingBalance(false);
  };

  const editedTotal = editingBalance
    ? DENOMINATIONS.reduce((s, d) => s + d * (editedBills[d] || 0), 0)
    : safeTotal;

  return (
    <div className="min-h-screen pb-6" style={{ background: 'var(--mc-bg)' }}>
      {/* Header */}
      <div className="sticky top-0 z-30 px-4 py-3 flex items-center gap-3" style={{ background: 'var(--mc-surface)', borderBottom: '1px solid var(--mc-border)' }}>
        <button onClick={() => navigate({ name: 'home' })} className="p-1">
          <ChevronLeft size={22} style={{ color: 'var(--mc-text)' }} />
        </button>
        <div className="flex-1">
          <h1 className="text-base font-bold" style={{ color: 'var(--mc-text)' }}>Касса / Подотчёт</h1>
          <div className="text-xs" style={{ color: 'var(--mc-muted)' }}>Учёт наличных в сейфе</div>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-white"
          style={{ background: '#297b8a' }}>
          <Plus size={20} />
        </button>
      </div>

      <div className="px-4 space-y-4 mt-4">
        {/* Safe Balance Card */}
        <div className="rounded-2xl p-4" style={{ background: 'linear-gradient(135deg, #1a3a4a 0%, #297b8a 100%)' }}>
          <div className="flex items-center gap-2 mb-3">
            <Banknote size={18} className="text-white/70" />
            <span className="text-sm font-semibold text-white/70 flex-1">Остаток в сейфе</span>
            {!editingBalance && (
              <button onClick={startEditBalance}
                className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg"
                style={{ background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.8)' }}>
                <Pencil size={12} /> Изменить
              </button>
            )}
          </div>
          <div className="text-2xl font-bold text-white mb-4">{fmtMoney(editedTotal)}</div>

          <div className="text-[10px] text-white/40 mb-1">Купюры</div>
          <div className="grid grid-cols-4 gap-1.5 mb-3">
            {DENOMINATIONS.filter(d => d >= 200).map(d => {
              const val = editingBalance ? (editedBills[d] || 0) : safeBalance[d];
              const changed = editingBalance && val !== safeBalance[d];
              return (
                <div key={d} className="rounded-lg px-2 py-1.5 text-center relative"
                  style={{ background: changed ? 'rgba(255,200,50,0.25)' : 'rgba(255,255,255,0.12)' }}>
                  <div className="text-[10px] text-white/50">{d.toLocaleString('ru')}</div>
                  {editingBalance ? (
                    <div className="flex items-center justify-center gap-1 my-0.5">
                      <button onClick={() => setEditedBills(b => ({ ...b, [d]: Math.max(0, (b[d] || 0) - 1) }))}
                        className="w-5 h-5 rounded flex items-center justify-center text-xs font-bold"
                        style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }}>−</button>
                      <span className="text-sm font-bold text-white w-6 text-center">{val}</span>
                      <button onClick={() => setEditedBills(b => ({ ...b, [d]: (b[d] || 0) + 1 }))}
                        className="w-5 h-5 rounded flex items-center justify-center text-xs font-bold"
                        style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }}>+</button>
                    </div>
                  ) : (
                    <div className="text-sm font-bold text-white">{val}</div>
                  )}
                  <div className="text-[10px] text-white/40">{fmtMoney(d * val)}</div>
                </div>
              );
            })}
          </div>
          <div className="text-[10px] text-white/40 mb-1">Монеты</div>
          <div className="grid grid-cols-7 gap-1.5">
            {DENOMINATIONS.filter(d => d < 200).map(d => {
              const val = editingBalance ? (editedBills[d] || 0) : safeBalance[d];
              const changed = editingBalance && val !== safeBalance[d];
              return (
                <div key={d} className="rounded-lg px-1.5 py-1 text-center"
                  style={{ background: changed ? 'rgba(255,200,50,0.25)' : 'rgba(255,255,255,0.08)' }}>
                  <div className="text-[9px] text-white/50">{d}</div>
                  {editingBalance ? (
                    <div className="flex items-center justify-center gap-0.5 my-0.5">
                      <button onClick={() => setEditedBills(b => ({ ...b, [d]: Math.max(0, (b[d] || 0) - 1) }))}
                        className="w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold"
                        style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }}>−</button>
                      <span className="text-xs font-bold text-white w-4 text-center">{val}</span>
                      <button onClick={() => setEditedBills(b => ({ ...b, [d]: (b[d] || 0) + 1 }))}
                        className="w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold"
                        style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }}>+</button>
                    </div>
                  ) : (
                    <div className="text-xs font-bold text-white">{val}</div>
                  )}
                </div>
              );
            })}
          </div>
          {editingBalance && (
            <div className="flex gap-2 mt-3">
              <button onClick={() => setEditingBalance(false)}
                className="flex-1 py-2 rounded-xl text-xs font-semibold"
                style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}>
                Отмена
              </button>
              <button onClick={saveBalanceEdit}
                className="flex-1 py-2 rounded-xl text-xs font-semibold"
                style={{ background: '#22C55E', color: '#fff' }}>
                Сохранить
              </button>
            </div>
          )}
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-2">
          {['income', 'expense', 'return'].map(t => {
            const meta = TYPE_META[t];
            const sum = ops.filter(o => o.type === t).reduce((s, o) => s + o.total, 0);
            return (
              <div key={t} className="rounded-xl p-3 text-center" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
                <div className="text-[11px] font-semibold mb-1" style={{ color: meta.color }}>{meta.label}</div>
                <div className="text-sm font-bold" style={{ color: 'var(--mc-text)' }}>{fmtMoney(sum)}</div>
              </div>
            );
          })}
        </div>

        {/* Filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold" style={{ color: 'var(--mc-muted)' }}>Журнал операций</span>
          <div className="flex-1" />
          {['income', 'expense', 'return'].map(t => {
            const active = filterType === t;
            const meta = TYPE_META[t];
            return (
              <button key={t}
                onClick={() => setFilterType(active ? null : t)}
                className="text-[11px] px-2.5 py-1 rounded-full font-semibold transition-colors"
                style={{
                  background: active ? meta.color + '20' : 'var(--mc-surface)',
                  color: active ? meta.color : 'var(--mc-muted)',
                  border: '1px solid ' + (active ? meta.color + '40' : 'var(--mc-border)'),
                }}>
                {meta.label}
              </button>
            );
          })}
        </div>

        {/* Operations List */}
        <div className="space-y-2">
          {filtered.map(op => {
            const meta = TYPE_META[op.type];
            const Icon = meta.icon;
            const expanded = expandedOp === op.id;
            return (
              <div key={op.id}
                className="rounded-xl overflow-hidden"
                style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
                <button
                  className="w-full px-3.5 py-3 flex items-center gap-3 text-left"
                  onClick={() => setExpandedOp(expanded ? null : op.id)}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: meta.color + '15' }}>
                    <Icon size={16} style={{ color: meta.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: 'var(--mc-text)' }}>{op.description}</div>
                    <div className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--mc-muted)' }}>
                      {fmtDateTime(op.created_at)}
                      {op.person_name && <> · {op.person_name}</>}
                      {op.category && <> · {op.category}</>}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 flex items-center gap-1.5">
                    <span className="text-sm font-bold" style={{ color: meta.color }}>
                      {op.type === 'expense' ? '−' : '+'}{fmtMoney(op.total)}
                    </span>
                    {expanded ? <ChevronUp size={14} style={{ color: 'var(--mc-muted)' }} /> : <ChevronDown size={14} style={{ color: 'var(--mc-muted)' }} />}
                  </div>
                </button>

                {expanded && (
                  <div className="px-3.5 pb-3 pt-0">
                    <div className="rounded-lg p-2.5" style={{ background: 'var(--mc-bg)' }}>
                      <div className="text-[11px] font-semibold mb-2" style={{ color: 'var(--mc-muted)' }}>Купюры</div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {DENOMINATIONS.filter(d => (op.bills[d] || 0) > 0).map(d => (
                          <div key={d} className="rounded px-2 py-1 text-center" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
                            <div className="text-[10px]" style={{ color: 'var(--mc-muted)' }}>{d.toLocaleString('ru')} ₸</div>
                            <div className="text-xs font-bold" style={{ color: 'var(--mc-text)' }}>×{op.bills[d]}</div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 text-[11px]" style={{ color: 'var(--mc-muted)' }}>
                        Провёл: {op.created_by_name} · {fmtDateFull(op.created_at)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Add Operation Modal */}
      {showAdd && <AddOperationModal onClose={() => setShowAdd(false)} onAdd={handleAddOp} />}
    </div>
  );
}

export function AddOperationModal({ onClose, onAdd, defaults, lockedType }) {
  const [type, setType] = useState(defaults?.type || 'expense');
  const [bills, setBills] = useState(() => {
    const b = {};
    DENOMINATIONS.forEach(d => b[d] = defaults?.bills?.[d] || 0);
    return b;
  });
  const [description, setDescription] = useState(defaults?.description || '');
  const [category, setCategory] = useState(defaults?.category || '');
  const [person, setPerson] = useState(defaults?.person || '');

  const total = DENOMINATIONS.reduce((s, d) => s + d * (bills[d] || 0), 0);

  const updateBill = (denom, delta) => {
    setBills(b => ({ ...b, [denom]: Math.max(0, (b[denom] || 0) + delta) }));
  };

  const meta = TYPE_META[type];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="w-full max-w-lg rounded-t-2xl p-5 max-h-[90vh] overflow-y-auto" style={{ background: 'var(--mc-surface)' }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold" style={{ color: 'var(--mc-text)' }}>Новая операция</h2>
          <button onClick={onClose} className="p-1"><X size={20} style={{ color: 'var(--mc-muted)' }} /></button>
        </div>

        {/* Type Selector */}
        {!lockedType && (
          <div className="flex gap-2 mb-4">
            {['income', 'expense', 'return'].map(t => {
              const m = TYPE_META[t];
              const active = type === t;
              return (
                <button key={t}
                  onClick={() => setType(t)}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold transition-colors"
                  style={{
                    background: active ? m.color : 'var(--mc-bg)',
                    color: active ? '#fff' : 'var(--mc-muted)',
                    border: '1px solid ' + (active ? m.color : 'var(--mc-border)'),
                  }}>
                  {m.label}
                </button>
              );
            })}
          </div>
        )}
        {lockedType && (
          <div className="mb-4 py-2 rounded-xl text-xs font-semibold text-center"
            style={{ background: meta.color + '15', color: meta.color, border: '1px solid ' + meta.color + '30' }}>
            {meta.label}
          </div>
        )}

        {/* Bills Input */}
        {[{ label: 'Купюры', items: DENOMINATIONS.filter(d => d >= 200) },
          { label: 'Монеты', items: DENOMINATIONS.filter(d => d < 200) }].map(group => (
          <div key={group.label} className="mb-4">
            <div className="text-[11px] font-semibold mb-2" style={{ color: 'var(--mc-muted)' }}>{group.label}</div>
            <div className="space-y-2">
              {group.items.map(d => (
              <div key={d} className="flex items-center gap-3 rounded-lg px-3 py-2" style={{ background: 'var(--mc-bg)', border: '1px solid var(--mc-border)' }}>
                <span className="text-sm font-medium w-20" style={{ color: 'var(--mc-text)' }}>{d.toLocaleString('ru')} ₸</span>
                <div className="flex items-center gap-2 flex-1 justify-center">
                  <button onClick={() => updateBill(d, -1)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-lg font-bold"
                    style={{ background: 'var(--mc-surface)', color: bills[d] > 0 ? 'var(--mc-text)' : 'var(--mc-muted)', border: '1px solid var(--mc-border)' }}>
                    −
                  </button>
                  <span className="text-base font-bold w-8 text-center" style={{ color: bills[d] > 0 ? 'var(--mc-text)' : 'var(--mc-muted)' }}>
                    {bills[d]}
                  </span>
                  <button onClick={() => updateBill(d, 1)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-lg font-bold"
                    style={{ background: 'var(--mc-surface)', color: 'var(--mc-text)', border: '1px solid var(--mc-border)' }}>
                    +
                  </button>
                </div>
                <span className="text-xs w-20 text-right" style={{ color: bills[d] > 0 ? meta.color : 'var(--mc-muted)' }}>
                  {bills[d] > 0 ? fmtMoney(d * bills[d]) : '—'}
                </span>
              </div>
              ))}
            </div>
          </div>
        ))}

        {/* Total */}
        <div className="rounded-xl p-3 mb-4 flex items-center justify-between" style={{ background: meta.color + '10', border: '1px solid ' + meta.color + '30' }}>
          <span className="text-sm font-semibold" style={{ color: meta.color }}>Итого:</span>
          <span className="text-lg font-bold" style={{ color: meta.color }}>{fmtMoney(total)}</span>
        </div>

        {/* Description */}
        <div className="mb-3">
          <div className="text-[11px] font-semibold mb-1" style={{ color: 'var(--mc-muted)' }}>Описание</div>
          <input value={description} onChange={e => setDescription(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg outline-none text-sm"
            style={{ background: 'var(--mc-bg)', color: 'var(--mc-text)', border: '1px solid var(--mc-border)' }}
            placeholder="На что / откуда" />
        </div>

        {/* Category */}
        {type !== 'income' && (
          <div className="mb-3">
            <div className="text-[11px] font-semibold mb-1" style={{ color: 'var(--mc-muted)' }}>Статья расходов</div>
            <select value={category} onChange={e => setCategory(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg outline-none text-sm"
              style={{ background: 'var(--mc-bg)', color: 'var(--mc-text)', border: '1px solid var(--mc-border)' }}>
              <option value="">Без категории</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}

        {/* Person */}
        {type !== 'income' && (
          <div className="mb-4">
            <div className="text-[11px] font-semibold mb-1" style={{ color: 'var(--mc-muted)' }}>Кому выдано / от кого возврат</div>
            <input value={person} onChange={e => setPerson(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg outline-none text-sm"
              style={{ background: 'var(--mc-bg)', color: 'var(--mc-text)', border: '1px solid var(--mc-border)' }}
              placeholder="Имя сотрудника" />
          </div>
        )}

        {/* Submit */}
        <button
          disabled={total <= 0}
          onClick={() => {
            if (total <= 0) return;
            onAdd({ type, bills: { ...bills }, total, description, category, person_name: person });
          }}
          className="w-full py-3 rounded-xl font-semibold text-white text-sm"
          style={{ background: total > 0 ? meta.color : 'var(--mc-muted)', opacity: total > 0 ? 1 : 0.5 }}>
          {meta.label}: {fmtMoney(total)}
        </button>
      </div>
    </div>
  );
}

export function CashHomeTile({ db, currentUser, navigate }) {
  const safeBalance = useMemo(() => calcSafeBalance(db.cashOperations || []), [db.cashOperations]);
  const safeTotal = DENOMINATIONS.reduce((s, d) => s + d * safeBalance[d], 0);
  return (
    <div onClick={() => navigate({ name: 'cash' })}
      className="rounded-xl p-3 cursor-pointer active:scale-[0.98] transition-transform"
      style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
      <div className="flex items-center gap-2 mb-1">
        <Banknote size={16} style={{ color: '#297b8a' }} />
        <span className="text-xs font-semibold" style={{ color: 'var(--mc-muted)' }}>Касса</span>
      </div>
      <div className="text-lg font-bold" style={{ color: 'var(--mc-text)' }}>{fmtMoney(safeTotal)}</div>
      <div className="text-[11px]" style={{ color: 'var(--mc-muted)' }}>в сейфе</div>
    </div>
  );
}
