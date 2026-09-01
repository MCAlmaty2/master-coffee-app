import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Minus, Plus, X, Trash2, Pencil, Check } from 'lucide-react';

const TZ = 'Asia/Almaty';
function fmtMoney(n) { return (Number(n) || 0).toLocaleString('ru-RU') + ' ₸'; }
function fmtDate(iso) {
  return new Date(iso).toLocaleString('ru-KZ', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: TZ });
}

function getMonthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

// Timestamps в БД — UTC ISO. Asia/Almaty = UTC+5 круглый год (без перехода на летнее
// время), поэтому месяц/день по местному времени можно получить фиксированным сдвигом —
// сравнивать сырые UTC-строки с границами месяца напрямую нельзя: запись, сделанная в
// первые ~5 часов местных суток, попадёт в предыдущий UTC-день/месяц.
function almatyMonthKey(iso) {
  if (!iso) return null;
  const d = new Date(new Date(iso).getTime() + 5 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function PageHeader({ title, subtitle, onBack }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 sticky top-0 z-20" style={{ background: 'var(--mc-bg)' }}>
      {onBack && (
        <button onClick={onBack} className="w-8 h-8 flex items-center justify-center rounded-full" style={{ background: 'var(--mc-surface)' }}>
          <ChevronLeft size={18} style={{ color: 'var(--mc-text)' }} />
        </button>
      )}
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--mc-text)' }}>{title}</h1>
        {subtitle && <div className="text-xs" style={{ color: 'var(--mc-muted)' }}>{subtitle}</div>}
      </div>
    </div>
  );
}

function Card({ title, children, className = '', action }) {
  return (
    <div className={`rounded-xl p-4 ${className}`} style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
      {(title || action) && (
        <div className="flex items-center justify-between mb-3">
          {title && <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--mc-muted)' }}>{title}</div>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

function Modal({ onClose, title, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl p-5" style={{ background: 'var(--mc-surface)' }} onClick={e => e.stopPropagation()}>
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

function buildCategories(expenseCategories) {
  const cats = (expenseCategories || [])
    .filter(c => c.active && c.budget_key)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  const catToBudget = {};
  cats.forEach(c => { catToBudget[c.name] = c.budget_key; });

  return { cats, catToBudget };
}

export default function BudgetScreen({ ctx }) {
  const { db, setDb, currentUser, goBack, showToast, updateBudgetPlan, createBudgetCategory } = ctx;

  const canEditBudget = currentUser.role === 'admin' || currentUser.role === 'director';

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [expanded, setExpanded] = useState(null);
  const [addModal, setAddModal] = useState(null);
  const [editingPlan, setEditingPlan] = useState(null);
  const [editPlanValue, setEditPlanValue] = useState('');
  const [newCatModal, setNewCatModal] = useState(false);

  const monthLabel = new Date(year, month - 1).toLocaleString('ru-RU', { month: 'long', year: 'numeric' });
  const monthKey = getMonthKey(year, month);

  const prev = () => {
    if (month === 1) { setMonth(12); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const next = () => {
    if (month === 12) { setMonth(1); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  const { cats, catToBudget } = useMemo(() => buildCategories(db.expenseCategories), [db.expenseCategories]);

  const manualByKey = useMemo(() => {
    const map = {};
    (db.budgetEntries || [])
      .filter(e => e.month === monthKey)
      .forEach(e => {
        if (!map[e.category_key]) map[e.category_key] = [];
        map[e.category_key].push(e);
      });
    Object.values(map).forEach(arr => arr.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')));
    return map;
  }, [db.budgetEntries, monthKey]);

  const data = useMemo(() => {
    const writeoffTotal = (db.writeOffs || [])
      .filter(w => w.doc_total > 0 && almatyMonthKey(w.invoiced_at) === monthKey)
      .reduce((sum, w) => sum + Number(w.doc_total), 0);

    const expenseByBudgetKey = {};
    (db.expenseRequests || [])
      .filter(e => e.status === 'paid' && almatyMonthKey(e.paid_at) === monthKey)
      .forEach(e => {
        const budgetKey = catToBudget[e.category] || 'other';
        expenseByBudgetKey[budgetKey] = (expenseByBudgetKey[budgetKey] || 0) + Number(e.amount);
      });

    const linkedCashOpIds = new Set(
      (db.expenseRequests || [])
        .filter(e => e.status === 'paid' && e.cash_operation_id)
        .map(e => e.cash_operation_id)
    );

    const cashByBudgetKey = {};
    (db.cashOperations || [])
      .filter(op =>
        (op.type === 'expense' || op.type === 'return') &&
        almatyMonthKey(op.created_at) === monthKey &&
        !linkedCashOpIds.has(op.id)
      )
      .forEach(op => {
        const budgetKey = catToBudget[op.category];
        if (!budgetKey) return;
        const amount = op.type === 'expense' ? Number(op.total) : -Number(op.total);
        cashByBudgetKey[budgetKey] = (cashByBudgetKey[budgetKey] || 0) + amount;
      });

    const rows = cats.map(cat => {
      const key = cat.budget_key;
      const plan = Number(cat.budget_plan) || 0;
      let autoFact = 0;
      if (key === 'writeoffs') autoFact = writeoffTotal;
      autoFact += (expenseByBudgetKey[key] || 0);
      autoFact += (cashByBudgetKey[key] || 0);

      const manualFact = (manualByKey[key] || []).reduce((s, e) => s + Number(e.amount), 0);
      const fact = autoFact + manualFact;
      const remaining = plan - fact;
      const pct = plan > 0 ? Math.round((fact / plan) * 100) : (fact > 0 ? 100 : 0);
      const cashFact = cashByBudgetKey[key] || 0;
      const expenseFact = expenseByBudgetKey[key] || 0;
      return {
        id: cat.id, key, label: cat.name, plan,
        auto: key === 'writeoffs' ? 'writeoffs' : undefined,
        fact, autoFact, manualFact, cashFact, expenseFact, remaining, pct,
        entries: manualByKey[key] || [],
      };
    });

    const totalPlan = rows.reduce((s, r) => s + r.plan, 0);
    const totalFact = rows.reduce((s, r) => s + r.fact, 0);
    const totalRemaining = totalPlan - totalFact;
    const totalPct = totalPlan > 0 ? Math.round((totalFact / totalPlan) * 100) : 0;

    return { rows, totalPlan, totalFact, totalRemaining, totalPct };
  }, [db.writeOffs, db.expenseRequests, db.cashOperations, manualByKey, cats, catToBudget, year, month]);

  const pctColor = (pct) => {
    if (pct > 100) return '#EF4444';
    if (pct > 80) return '#F59E0B';
    return '#22C55E';
  };

  const handleAddEntry = (categoryKey, amount, description) => {
    const id = crypto.randomUUID();
    setDb(d => ({
      ...d,
      budgetEntries: [...(d.budgetEntries || []), {
        id, category_key: categoryKey, month: monthKey,
        amount: Number(amount), description: description.trim(),
        created_by: currentUser.id, created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }],
    }));
    showToast('Запись добавлена');
  };

  const handleDeleteEntry = (entryId) => {
    setDb(d => ({
      ...d,
      budgetEntries: (d.budgetEntries || []).filter(e => e.id !== entryId),
    }));
    showToast('Запись удалена');
  };

  const startEditPlan = (row) => {
    setEditingPlan(row.id);
    setEditPlanValue(String(row.plan));
  };

  const savePlan = (row) => {
    const val = Number(editPlanValue);
    if (isNaN(val) || val < 0) { showToast('Некорректная сумма'); return; }
    const res = updateBudgetPlan(row.id, val);
    if (res?.error) { showToast(res.error); return; }
    showToast('План обновлён');
    setEditingPlan(null);
  };

  return (
    <div>
      <PageHeader title="Бюджет" subtitle="План / факт по статьям расходов" onBack={goBack} />

      <div className="px-4 space-y-4 pb-6">
        <div className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
          <button onClick={prev} className="w-8 h-8 flex items-center justify-center rounded-full" style={{ background: 'var(--mc-bg)' }}>
            <ChevronLeft size={16} style={{ color: 'var(--mc-text)' }} />
          </button>
          <span className="font-semibold capitalize" style={{ color: 'var(--mc-text)' }}>{monthLabel}</span>
          <button onClick={next} className="w-8 h-8 flex items-center justify-center rounded-full" style={{ background: 'var(--mc-bg)' }}>
            <ChevronRight size={16} style={{ color: 'var(--mc-text)' }} />
          </button>
        </div>

        <Card>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--mc-muted)' }}>План</div>
              <div className="text-lg font-bold" style={{ color: 'var(--mc-text)' }}>{fmtMoney(data.totalPlan)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--mc-muted)' }}>Факт</div>
              <div className="text-lg font-bold" style={{ color: pctColor(data.totalPct) }}>{fmtMoney(data.totalFact)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--mc-muted)' }}>Остаток</div>
              <div className="text-lg font-bold" style={{ color: data.totalRemaining >= 0 ? '#22C55E' : '#EF4444' }}>{fmtMoney(data.totalRemaining)}</div>
            </div>
          </div>
          <div className="mt-3 h-2 rounded-full overflow-hidden" style={{ background: 'var(--mc-bg)' }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(data.totalPct, 100)}%`, background: pctColor(data.totalPct) }} />
          </div>
          <div className="text-xs text-right mt-1" style={{ color: 'var(--mc-muted)' }}>{data.totalPct}% использовано</div>
        </Card>

        <Card
          title="Статьи расходов"
          action={canEditBudget ? (
            <button
              onClick={() => setNewCatModal(true)}
              className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg"
              style={{ background: 'var(--mc-bg)', color: '#3B82F6' }}
            >
              <Plus size={13} /> Категория
            </button>
          ) : null}
        >
          <div className="space-y-3">
            {data.rows.map(row => {
              const isExpanded = expanded === row.key;
              const isEditingThisPlan = editingPlan === row.id;
              return (
                <div key={row.key} className="rounded-lg p-3" style={{ background: 'var(--mc-bg)' }}>
                  <div className="flex items-center justify-between mb-1 cursor-pointer" onClick={() => setExpanded(isExpanded ? null : row.key)}>
                    <div className="font-semibold text-sm" style={{ color: 'var(--mc-text)' }}>{row.label}</div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 text-xs font-semibold" style={{ color: pctColor(row.pct) }}>
                        {row.pct > 100 ? <TrendingUp size={12} /> : row.pct > 0 ? <TrendingDown size={12} /> : <Minus size={12} />}
                        {row.pct}%
                      </div>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden mb-1.5" style={{ background: 'var(--mc-border)' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(row.pct, 100)}%`, background: pctColor(row.pct) }} />
                  </div>
                  <div className="flex justify-between text-[11px]" style={{ color: 'var(--mc-muted)' }}>
                    <span>Факт: {fmtMoney(row.fact)}</span>
                    {canEditBudget && !isEditingThisPlan ? (
                      <span className="flex items-center gap-1 cursor-pointer" onClick={e => { e.stopPropagation(); startEditPlan(row); }}>
                        План: {fmtMoney(row.plan)} <Pencil size={10} />
                      </span>
                    ) : isEditingThisPlan ? (
                      <span className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <input
                          type="number" inputMode="decimal" value={editPlanValue}
                          onChange={e => setEditPlanValue(e.target.value)}
                          autoFocus
                          className="w-24 px-1.5 py-0.5 rounded text-[11px] outline-none"
                          style={{ border: '1px solid var(--mc-border)', color: 'var(--mc-text)', background: 'var(--mc-surface)' }}
                          onKeyDown={e => { if (e.key === 'Enter') savePlan(row); if (e.key === 'Escape') setEditingPlan(null); }}
                        />
                        <button onClick={() => savePlan(row)} className="flex items-center justify-center" style={{ color: '#22C55E' }}>
                          <Check size={13} />
                        </button>
                        <button onClick={() => setEditingPlan(null)} className="flex items-center justify-center" style={{ color: '#EF4444' }}>
                          <X size={13} />
                        </button>
                      </span>
                    ) : (
                      <span>План: {fmtMoney(row.plan)}</span>
                    )}
                  </div>
                  {row.remaining < 0 && (
                    <div className="text-[11px] font-semibold mt-0.5" style={{ color: '#EF4444' }}>Перерасход: {fmtMoney(Math.abs(row.remaining))}</div>
                  )}

                  {isExpanded && (
                    <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--mc-border)' }}>
                      {row.auto === 'writeoffs' && row.autoFact > 0 && (
                        <div className="text-[11px] mb-2 px-2 py-1 rounded" style={{ background: 'var(--mc-surface)', color: 'var(--mc-muted)' }}>
                          Авто (1С документы): {fmtMoney(row.autoFact - row.cashFact - row.expenseFact)}
                        </div>
                      )}
                      {row.cashFact > 0 && (
                        <div className="text-[11px] mb-2 px-2 py-1 rounded" style={{ background: 'var(--mc-surface)', color: 'var(--mc-muted)' }}>
                          Касса / подотчёт: {fmtMoney(row.cashFact)}
                        </div>
                      )}
                      {row.expenseFact > 0 && (
                        <div className="text-[11px] mb-2 px-2 py-1 rounded" style={{ background: 'var(--mc-surface)', color: 'var(--mc-muted)' }}>
                          Чеки расходов: {fmtMoney(row.expenseFact)}
                        </div>
                      )}

                      {row.entries.length > 0 && (
                        <div className="space-y-1.5 mb-2">
                          {row.entries.map(entry => (
                            <div key={entry.id} className="flex items-center justify-between px-2 py-1.5 rounded text-sm" style={{ background: 'var(--mc-surface)' }}>
                              <div className="flex-1 min-w-0">
                                <span style={{ color: 'var(--mc-text)' }}>{fmtMoney(entry.amount)}</span>
                                {entry.description && (
                                  <span className="text-xs ml-2" style={{ color: 'var(--mc-muted)' }}>— {entry.description}</span>
                                )}
                                <div className="text-[10px]" style={{ color: 'var(--mc-muted)' }}>{fmtDate(entry.created_at)}</div>
                              </div>
                              <button
                                onClick={() => handleDeleteEntry(entry.id)}
                                className="w-6 h-6 flex items-center justify-center rounded flex-shrink-0 ml-2"
                                style={{ color: '#EF4444' }}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {row.entries.length === 0 && !row.auto && (
                        <div className="text-[11px] mb-2" style={{ color: 'var(--mc-muted)' }}>Нет записей</div>
                      )}

                      <button
                        onClick={() => setAddModal(row.key)}
                        className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
                        style={{ background: 'var(--mc-surface)', color: '#3B82F6' }}
                      >
                        <Plus size={13} /> Добавить расход
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {addModal && (
        <AddEntryModal
          categoryLabel={cats.find(c => c.budget_key === addModal)?.name || ''}
          onClose={() => setAddModal(null)}
          onSave={(amount, desc) => {
            handleAddEntry(addModal, amount, desc);
            setAddModal(null);
          }}
        />
      )}

      {newCatModal && (
        <NewCategoryModal
          onClose={() => setNewCatModal(false)}
          onSave={(name, key, plan) => {
            const res = createBudgetCategory(name, key, plan);
            if (res?.error) { showToast(res.error); return; }
            showToast('Категория создана');
            setNewCatModal(false);
          }}
        />
      )}
    </div>
  );
}

function AddEntryModal({ categoryLabel, onClose, onSave }) {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const valid = Number(amount) > 0;

  return (
    <Modal onClose={onClose} title="Добавить расход">
      <div className="space-y-3">
        <div className="text-sm" style={{ color: 'var(--mc-muted)' }}>
          Статья: <strong style={{ color: 'var(--mc-text)' }}>{categoryLabel}</strong>
        </div>
        <div>
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>Сумма (₸)</label>
          <input
            type="number" inputMode="decimal" value={amount}
            onChange={e => setAmount(e.target.value)} autoFocus placeholder="0"
            className="w-full px-3 py-2.5 rounded-lg outline-none text-lg font-bold"
            style={{ border: `1px solid ${valid || !amount ? 'var(--mc-border)' : '#EB5757'}`, color: 'var(--mc-text)', background: 'var(--mc-bg)' }}
          />
        </div>
        <div>
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>Описание (необязательно)</label>
          <input
            value={description} onChange={e => setDescription(e.target.value)}
            placeholder="Например: оплата за июнь"
            className="w-full px-3 py-2.5 rounded-lg outline-none text-sm"
            style={{ border: '1px solid var(--mc-border)', color: 'var(--mc-text)', background: 'var(--mc-bg)' }}
          />
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg font-semibold" style={{ background: 'var(--mc-bg)', color: 'var(--mc-text)' }}>Отмена</button>
          <button onClick={() => onSave(amount, description)} disabled={!valid} className="flex-1 py-2.5 rounded-lg font-semibold text-white disabled:opacity-50" style={{ background: '#22C55E' }}>
            Сохранить
          </button>
        </div>
      </div>
    </Modal>
  );
}

function NewCategoryModal({ onClose, onSave }) {
  const [name, setName] = useState('');
  const [budgetKey, setBudgetKey] = useState('');
  const [plan, setPlan] = useState('');

  const autoKey = (val) => {
    return val.toLowerCase().replace(/[^a-zа-яё0-9]/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  };

  const handleNameChange = (val) => {
    setName(val);
    if (!budgetKey || budgetKey === autoKey(name)) {
      setBudgetKey(autoKey(val));
    }
  };

  const valid = name.trim().length >= 2 && budgetKey.trim().length >= 2;

  return (
    <Modal onClose={onClose} title="Новая категория">
      <div className="space-y-3">
        <div>
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>Название</label>
          <input
            value={name} onChange={e => handleNameChange(e.target.value)}
            autoFocus placeholder="Например: Аренда"
            className="w-full px-3 py-2.5 rounded-lg outline-none text-sm"
            style={{ border: '1px solid var(--mc-border)', color: 'var(--mc-text)', background: 'var(--mc-bg)' }}
          />
        </div>
        <div>
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>Ключ (латиницей)</label>
          <input
            value={budgetKey} onChange={e => setBudgetKey(e.target.value)}
            placeholder="rent"
            className="w-full px-3 py-2.5 rounded-lg outline-none text-sm"
            style={{ border: '1px solid var(--mc-border)', color: 'var(--mc-text)', background: 'var(--mc-bg)' }}
          />
          <div className="text-[10px] mt-1" style={{ color: 'var(--mc-muted)' }}>Уникальный ключ для связи с расходами</div>
        </div>
        <div>
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--mc-muted)' }}>План (₸, необязательно)</label>
          <input
            type="number" inputMode="decimal" value={plan}
            onChange={e => setPlan(e.target.value)} placeholder="0"
            className="w-full px-3 py-2.5 rounded-lg outline-none text-sm"
            style={{ border: '1px solid var(--mc-border)', color: 'var(--mc-text)', background: 'var(--mc-bg)' }}
          />
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg font-semibold" style={{ background: 'var(--mc-bg)', color: 'var(--mc-text)' }}>Отмена</button>
          <button onClick={() => onSave(name.trim(), budgetKey.trim(), plan)} disabled={!valid} className="flex-1 py-2.5 rounded-lg font-semibold text-white disabled:opacity-50" style={{ background: '#22C55E' }}>
            Создать
          </button>
        </div>
      </div>
    </Modal>
  );
}
