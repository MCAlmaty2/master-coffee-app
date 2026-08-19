import React, { useState, useMemo, useRef } from 'react';
import {
  Receipt, Plus, Search, ChevronRight, ChevronLeft, Check, X,
  CircleDot, CheckCircle2, XCircle, Banknote, Upload, Image, Trash2, Eye,
  User, ExternalLink, Pencil,
} from 'lucide-react';
import { AddOperationModal } from './CashScreen';

const TZ = 'Asia/Almaty';
const STATUS_META = {
  pending:  { label: 'На одобрении', short: 'Ожидает',   color: '#F59E0B', bg: '#FEF3C7', icon: CircleDot },
  approved: { label: 'Одобрена',     short: 'Одобрена',   color: '#3B82F6', bg: '#DBEAFE', icon: CheckCircle2 },
  rejected: { label: 'Отклонена',    short: 'Отклонена',  color: '#EF4444', bg: '#FEE2E2', icon: XCircle },
  paid:     { label: 'Выдано',       short: 'Выдано',     color: '#22C55E', bg: '#DCFCE7', icon: Banknote },
};

function todayISO() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TZ })).toISOString().slice(0, 10);
}

function fmtDate(iso) {
  return new Date(iso).toLocaleString('ru-KZ', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: TZ });
}
function fmtDateTime(iso) {
  return new Date(iso).toLocaleString('ru-KZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ });
}
function fmtMoney(n) { return (Number(n) || 0).toLocaleString('ru-RU') + ' ₸'; }

function matchesSearch(text, query) {
  if (!query) return true;
  const t = (text || '').toLowerCase();
  return query.toLowerCase().split(/\s+/).every(w => t.includes(w));
}

export default function ExpenseRequestsScreen({ ctx }) {
  const { route } = ctx;
  if (route.name === 'create_expense') return <CreateExpenseScreen ctx={ctx} />;
  if (route.name === 'expense_detail') return <ExpenseDetailScreen ctx={ctx} expenseId={route.expenseId} />;
  return <ExpenseListScreen ctx={ctx} />;
}

function ExpenseListScreen({ ctx }) {
  const { db, currentUser, navigate } = ctx;
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const hasPerm = (p) => ctx.hasPermission?.(p);

  const all = db.expenseRequests || [];
  const canSeeAll = hasPerm('expense_view_all') || hasPerm('expense_approve') || hasPerm('expense_pay');

  const visible = useMemo(() => {
    let list = canSeeAll ? all : all.filter(r => r.requester_id === currentUser.id);
    if (filter !== 'all') list = list.filter(r => r.status === filter);
    if (search) list = list.filter(r => matchesSearch(`${r.request_number} ${r.requester_name} ${r.description} ${r.category}`, search));
    return list.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [all, filter, search, canSeeAll, currentUser.id]);

  const counts = useMemo(() => {
    const src = canSeeAll ? all : all.filter(r => r.requester_id === currentUser.id);
    const c = { all: src.length, pending: 0, approved: 0, rejected: 0, paid: 0 };
    src.forEach(r => c[r.status]++);
    return c;
  }, [all, canSeeAll, currentUser.id]);

  const filters = [
    { key: 'all', label: 'Все', count: counts.all },
    { key: 'pending', label: 'Ожидают', count: counts.pending },
    { key: 'approved', label: 'Одобрены', count: counts.approved },
    { key: 'paid', label: 'Выданы', count: counts.paid },
  ];

  return (
    <div className="min-h-screen" style={{ background: 'var(--mc-bg)', color: 'var(--mc-text)' }}>
      <div className="sticky top-0 z-20 px-4 pt-3 pb-2" style={{ background: 'var(--mc-bg)' }}>
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => navigate({ name: 'home' })} className="flex items-center gap-1 text-sm" style={{ color: '#3390EC' }}>
            <ChevronLeft size={18} /> Назад
          </button>
          <h1 className="text-lg font-bold">Чеки расходов</h1>
          <div style={{ width: 60 }} />
        </div>

        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
            <Search size={16} style={{ color: 'var(--mc-muted)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск…"
              className="flex-1 bg-transparent outline-none text-sm" style={{ color: 'var(--mc-text)' }} />
          </div>
          {hasPerm('expense_create') && (
            <button onClick={() => navigate({ name: 'create_expense' })}
              className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: '#3390EC', color: '#fff' }}>
              <Plus size={20} />
            </button>
          )}
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {filters.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className="px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition"
              style={filter === f.key
                ? { background: '#3390EC', color: '#fff' }
                : { background: 'var(--mc-surface)', color: 'var(--mc-muted)', border: '1px solid var(--mc-border)' }}>
              {f.label}{f.count > 0 ? ` (${f.count})` : ''}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pb-6 space-y-2">
        {visible.length === 0 && (
          <div className="text-center py-12 text-sm" style={{ color: 'var(--mc-muted)' }}>
            {search ? 'Ничего не найдено' : 'Нет заявок'}
          </div>
        )}
        {visible.map(r => {
          const s = STATUS_META[r.status] || STATUS_META.pending;
          const Icon = s.icon;
          return (
            <button key={r.id} onClick={() => navigate({ name: 'expense_detail', expenseId: r.id })}
              className="w-full text-left rounded-2xl p-4 transition hover:shadow-sm"
              style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: s.bg }}>
                  <Icon size={20} style={{ color: s.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm">{r.request_number}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: s.bg, color: s.color }}>{s.short}</span>
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <User size={12} style={{ color: 'var(--mc-muted)', flexShrink: 0 }} />
                    <span className="text-xs font-semibold truncate" style={{ color: 'var(--mc-text)' }}>{r.requester_name || '—'}</span>
                  </div>
                  <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--mc-muted)' }}>{r.category} · {r.description}</div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="font-bold text-sm" style={{ color: '#3390EC' }}>{fmtMoney(r.amount)}</span>
                    <span className="text-xs" style={{ color: 'var(--mc-muted)' }}>{fmtDate(r.created_at)}</span>
                  </div>
                </div>
                <ChevronRight size={16} className="flex-shrink-0" style={{ color: 'var(--mc-muted)' }} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CreateExpenseScreen({ ctx }) {
  const { db, navigate, showToast } = ctx;
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [uploading, setUploading] = useState(false);
  const [receiptUrls, setReceiptUrls] = useState([]);
  const fileRef = useRef(null);

  const categories = useMemo(() => {
    const cats = (db.expenseCategories || []).filter(c => c.active).sort((a, b) => a.sort_order - b.sort_order);
    return cats.map(c => c.name);
  }, [db.expenseCategories]);

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    try {
      const urls = [];
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      for (const file of files) {
        const form = new FormData();
        form.append('file', file);
        form.append('requestNumber', 'draft');
        const res = await fetch(`${supabaseUrl}/functions/v1/upload-receipt`, {
          method: 'POST', body: form,
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Upload failed');
        urls.push(result.url);
      }
      setReceiptUrls(prev => [...prev, ...urls]);
    } catch (err) {
      showToast('Ошибка загрузки: ' + err.message, 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removeReceipt = (idx) => {
    setReceiptUrls(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async () => {
    const result = await ctx.createExpenseRequest({ amount, category, description: description.trim(), receipt_urls: receiptUrls });
    if (result.error) { showToast(result.error, 'error'); return; }
    showToast('Заявка создана');
    navigate({ name: 'expenses' });
  };

  return (
    <div className="min-h-screen" style={{ background: 'var(--mc-bg)', color: 'var(--mc-text)' }}>
      <div className="sticky top-0 z-20 px-4 pt-3 pb-2 flex items-center gap-3" style={{ background: 'var(--mc-bg)' }}>
        <button onClick={() => navigate({ name: 'expenses' })} className="flex items-center gap-1 text-sm" style={{ color: '#3390EC' }}>
          <ChevronLeft size={18} /> Назад
        </button>
        <h1 className="text-lg font-bold flex-1 text-center">Новая заявка</h1>
        <div style={{ width: 60 }} />
      </div>

      <div className="px-4 pb-6 space-y-4 mt-2">
        <div>
          <div className="text-xs font-semibold mb-1" style={{ color: 'var(--mc-muted)' }}>Сумма (₸) *</div>
          <input type="number" inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="0" className="w-full px-3 py-2.5 rounded-lg outline-none text-sm"
            style={{ background: 'var(--mc-surface)', color: 'var(--mc-text)', border: '1px solid var(--mc-border)' }} />
        </div>

        <div>
          <div className="text-xs font-semibold mb-1" style={{ color: 'var(--mc-muted)' }}>Категория *</div>
          <select value={category} onChange={e => setCategory(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg outline-none text-sm"
            style={{ background: 'var(--mc-surface)', color: 'var(--mc-text)', border: '1px solid var(--mc-border)' }}>
            <option value="">Выберите категорию</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div>
          <div className="text-xs font-semibold mb-1" style={{ color: 'var(--mc-muted)' }}>Описание *</div>
          <textarea value={description} onChange={e => setDescription(e.target.value)}
            placeholder="На что расход…" rows={3}
            className="w-full px-3 py-2.5 rounded-lg outline-none text-sm resize-none"
            style={{ background: 'var(--mc-surface)', color: 'var(--mc-text)', border: '1px solid var(--mc-border)' }} />
        </div>

        <div>
          <div className="text-xs font-semibold mb-1" style={{ color: 'var(--mc-muted)' }}>Чеки / фото</div>
          <input ref={fileRef} type="file" accept="image/*" multiple onChange={handleUpload} className="hidden" />
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="w-full py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2"
            style={{ background: 'var(--mc-surface)', color: '#3390EC', border: '1px dashed var(--mc-border)' }}>
            {uploading ? 'Загрузка…' : <><Upload size={16} /> Прикрепить фото чека</>}
          </button>
          {receiptUrls.length > 0 && (
            <div className="flex gap-2 mt-2 flex-wrap">
              {receiptUrls.map((url, i) => (
                <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden" style={{ border: '1px solid var(--mc-border)' }}>
                  <img src={url} alt="" className="w-full h-full object-cover" />
                  <button onClick={() => removeReceipt(i)}
                    className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full flex items-center justify-center"
                    style={{ background: 'rgba(0,0,0,0.6)' }}>
                    <X size={12} color="#fff" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <button onClick={handleSubmit}
          className="w-full py-3 rounded-xl text-sm font-bold"
          style={{ background: '#3390EC', color: '#fff' }}>
          Отправить заявку
        </button>
      </div>
    </div>
  );
}

function ExpenseDetailScreen({ ctx, expenseId }) {
  const { db, navigate, showToast } = ctx;
  const hasPerm = (p) => ctx.hasPermission?.(p);
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [showImage, setShowImage] = useState(null);
  const [showCashModal, setShowCashModal] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editAmount, setEditAmount] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editReceipts, setEditReceipts] = useState([]);
  const [uploading, setUploading] = useState(false);
  const editFileRef = useRef(null);
  const canEditCategory = hasPerm('expense_approve') || hasPerm('expense_pay');
  const categories = useMemo(() => {
    return (db.expenseCategories || []).filter(c => c.active).sort((a, b) => a.sort_order - b.sort_order).map(c => c.name);
  }, [db.expenseCategories]);

  const req = (db.expenseRequests || []).find(r => r.id === expenseId);
  if (!req) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--mc-bg)', color: 'var(--mc-muted)' }}>
      Заявка не найдена
    </div>
  );

  const s = STATUS_META[req.status] || STATUS_META.pending;
  const Icon = s.icon;
  const canApprove = hasPerm('expense_approve') && req.status === 'pending';
  const canPay = hasPerm('expense_pay') && req.status === 'approved';
  const canEditPaid = req.status === 'paid' && (hasPerm('expense_pay') || hasPerm('expense_approve'));

  const startEditing = () => {
    setEditAmount(String(req.amount));
    setEditDesc(req.description || '');
    setEditCategory(req.category || '');
    setEditReceipts([...(req.receipt_urls || [])]);
    setEditing(true);
  };

  const handleEditUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    try {
      const urls = [];
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      for (const file of files) {
        const form = new FormData();
        form.append('file', file);
        form.append('requestNumber', req.request_number || 'edit');
        const res = await fetch(`${supabaseUrl}/functions/v1/upload-receipt`, {
          method: 'POST', body: form,
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Upload failed');
        urls.push(result.url);
      }
      setEditReceipts(prev => [...prev, ...urls]);
    } catch (err) {
      showToast('Ошибка загрузки: ' + err.message, 'error');
    } finally {
      setUploading(false);
      if (editFileRef.current) editFileRef.current.value = '';
    }
  };

  const saveEdit = () => {
    if (!Number(editAmount) || Number(editAmount) <= 0) { showToast('Укажите корректную сумму', 'error'); return; }
    if (!editDesc.trim()) { showToast('Укажите описание', 'error'); return; }
    const result = ctx.updateExpense(expenseId, {
      amount: editAmount,
      description: editDesc,
      category: editCategory,
      receipt_urls: editReceipts,
    });
    if (result.error) { showToast(result.error, 'error'); return; }
    setEditing(false);
    showToast('Расход обновлён');
  };

  const handleApprove = () => {
    const result = ctx.approveExpense(expenseId);
    if (result.error) { showToast(result.error, 'error'); return; }
    showToast('Заявка одобрена');
  };

  const handleReject = () => {
    if (!rejectReason.trim()) { showToast('Укажите причину отклонения', 'error'); return; }
    const result = ctx.rejectExpense(expenseId, rejectReason.trim());
    if (result.error) { showToast(result.error, 'error'); return; }
    setShowReject(false);
    showToast('Заявка отклонена');
  };

  const handlePay = (cashOp) => {
    const result = ctx.payExpense(expenseId, cashOp);
    if (result.error) { showToast(result.error, 'error'); return; }
    setShowCashModal(false);
    showToast('Деньги выданы, расход записан в кассу');
  };

  return (
    <div className="min-h-screen" style={{ background: 'var(--mc-bg)', color: 'var(--mc-text)' }}>
      <div className="sticky top-0 z-20 px-4 pt-3 pb-2 flex items-center gap-3" style={{ background: 'var(--mc-bg)' }}>
        <button onClick={() => { if (editing) { setEditing(false); return; } navigate({ name: 'expenses' }); }} className="flex items-center gap-1 text-sm" style={{ color: '#3390EC' }}>
          <ChevronLeft size={18} /> {editing ? 'Отмена' : 'Назад'}
        </button>
        <h1 className="text-lg font-bold flex-1 text-center">{editing ? 'Редактирование' : req.request_number}</h1>
        <div style={{ width: 60 }} />
      </div>

      <div className="px-4 pb-6 space-y-4 mt-2">
        <div className="rounded-2xl p-4" style={{ background: s.bg }}>
          <div className="flex items-center gap-3">
            <Icon size={24} style={{ color: s.color }} />
            <div className="flex-1">
              <div className="font-bold" style={{ color: s.color }}>{s.label}</div>
              <div className="text-xs mt-0.5" style={{ color: s.color + 'cc' }}>{fmtDateTime(req.created_at)}</div>
            </div>
            {canEditPaid && !editing && (
              <button onClick={startEditing} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                style={{ background: 'rgba(255,255,255,0.7)', color: s.color }}>
                <Pencil size={13} /> Изменить
              </button>
            )}
          </div>
        </div>

        {editing ? (
          <>
            <div className="rounded-2xl p-4 space-y-4" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
              <div>
                <div className="text-xs font-semibold mb-1" style={{ color: 'var(--mc-muted)' }}>Сумма (₸)</div>
                <input type="number" inputMode="numeric" value={editAmount} onChange={e => setEditAmount(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg outline-none text-sm"
                  style={{ background: 'var(--mc-bg)', color: 'var(--mc-text)', border: '1px solid var(--mc-border)' }} />
              </div>
              <div>
                <div className="text-xs font-semibold mb-1" style={{ color: 'var(--mc-muted)' }}>Категория</div>
                <select value={editCategory} onChange={e => setEditCategory(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg outline-none text-sm"
                  style={{ background: 'var(--mc-bg)', color: 'var(--mc-text)', border: '1px solid var(--mc-border)' }}>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <div className="text-xs font-semibold mb-1" style={{ color: 'var(--mc-muted)' }}>Описание</div>
                <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} rows={3}
                  className="w-full px-3 py-2.5 rounded-lg outline-none text-sm resize-none"
                  style={{ background: 'var(--mc-bg)', color: 'var(--mc-text)', border: '1px solid var(--mc-border)' }} />
              </div>
              <div>
                <div className="text-xs font-semibold mb-1" style={{ color: 'var(--mc-muted)' }}>Документы</div>
                <input ref={editFileRef} type="file" accept="image/*" multiple onChange={handleEditUpload} className="hidden" />
                {editReceipts.length > 0 && (
                  <div className="flex gap-2 mb-2 flex-wrap">
                    {editReceipts.map((url, i) => (
                      <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden" style={{ border: '1px solid var(--mc-border)' }}>
                        <img src={url} alt="" className="w-full h-full object-cover" />
                        <button onClick={() => setEditReceipts(prev => prev.filter((_, j) => j !== i))}
                          className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full flex items-center justify-center"
                          style={{ background: 'rgba(0,0,0,0.6)' }}>
                          <X size={10} color="#fff" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button onClick={() => editFileRef.current?.click()} disabled={uploading}
                  className="w-full py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-2"
                  style={{ background: 'var(--mc-bg)', color: '#3390EC', border: '1px dashed var(--mc-border)' }}>
                  {uploading ? 'Загрузка…' : <><Upload size={14} /> Добавить фото</>}
                </button>
              </div>
            </div>
            <button onClick={saveEdit}
              className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
              style={{ background: '#22C55E', color: '#fff' }}>
              <Check size={18} /> Сохранить изменения
            </button>
          </>
        ) : (
          <>
            <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
              <Row label="Сумма" value={fmtMoney(req.amount)} bold />
              {canEditCategory ? (
                <div className="flex items-center justify-between py-1" style={{ borderBottom: '1px solid var(--mc-border)' }}>
                  <span className="text-xs" style={{ color: 'var(--mc-muted)' }}>Категория</span>
                  <select
                    value={req.category || ''}
                    onChange={e => {
                      const res = ctx.updateExpenseCategory(expenseId, e.target.value);
                      if (res.error) showToast(res.error, 'error');
                      else showToast('Категория изменена');
                    }}
                    className="text-sm font-semibold text-right rounded-lg px-2 py-1 outline-none"
                    style={{ color: 'var(--mc-text)', background: 'var(--mc-bg)', border: '1px solid var(--mc-border)', maxWidth: '60%' }}
                  >
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              ) : (
                <Row label="Категория" value={req.category} />
              )}
              <Row label="Описание" value={req.description} />
              <Row label="Подал(а)" value={req.requester_name} />
              <Row label="Дата" value={fmtDateTime(req.created_at)} />
              {req.approved_by_name && <Row label={req.status === 'rejected' ? 'Отклонил(а)' : 'Одобрил(а)'} value={`${req.approved_by_name} · ${fmtDateTime(req.approved_at)}`} />}
              {req.reject_reason && <Row label="Причина" value={req.reject_reason} />}
              {req.paid_by_name && <Row label="Выдал(а)" value={`${req.paid_by_name} · ${fmtDateTime(req.paid_at)}`} />}
            </div>

            {(req.receipt_urls || []).length > 0 && (
              <div className="rounded-2xl p-4" style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}>
                <div className="text-xs font-semibold mb-2" style={{ color: 'var(--mc-muted)' }}>Документы ({req.receipt_urls.length})</div>
                <div className="space-y-2">
                  {req.receipt_urls.map((url, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <button onClick={() => setShowImage(url)} className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0" style={{ border: '1px solid var(--mc-border)' }}>
                        <img src={url} alt="" className="w-full h-full object-cover" />
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs truncate" style={{ color: 'var(--mc-muted)' }}>Документ {i + 1}</div>
                        <a href={url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1.5 mt-1 text-xs font-semibold no-underline"
                          style={{ color: '#3390EC' }}
                          onClick={e => e.stopPropagation()}>
                          <ExternalLink size={14} /> Открыть документ
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {canApprove && (
              <div className="space-y-2">
                <button onClick={handleApprove}
                  className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
                  style={{ background: '#22C55E', color: '#fff' }}>
                  <Check size={18} /> Одобрить
                </button>
                <button onClick={() => setShowReject(true)}
                  className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
                  style={{ background: '#EF4444', color: '#fff' }}>
                  <XCircle size={18} /> Отклонить
                </button>
              </div>
            )}

            {canPay && (
              <button onClick={() => setShowCashModal(true)}
                className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
                style={{ background: '#3390EC', color: '#fff' }}>
                <Banknote size={18} /> Выдать деньги из кассы
              </button>
            )}
          </>
        )}

        {showCashModal && (
          <AddOperationModal
            onClose={() => setShowCashModal(false)}
            onAdd={handlePay}
            lockedType
            defaults={{
              type: 'expense',
              description: `Чек ${req.request_number}: ${req.description}`,
              category: req.category || '',
              person: req.requester_name || '',
            }}
          />
        )}
      </div>

      {showReject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-sm rounded-2xl p-5" style={{ background: 'var(--mc-surface)' }}>
            <div className="font-bold text-base mb-3">Причина отклонения</div>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)}
              placeholder="Укажите причину…" rows={3}
              className="w-full px-3 py-2.5 rounded-lg outline-none text-sm resize-none mb-3"
              style={{ background: 'var(--mc-bg)', color: 'var(--mc-text)', border: '1px solid var(--mc-border)' }} />
            <div className="flex gap-2">
              <button onClick={() => setShowReject(false)} className="flex-1 py-2.5 rounded-lg text-sm font-semibold"
                style={{ background: 'var(--mc-bg)', color: 'var(--mc-text)', border: '1px solid var(--mc-border)' }}>Отмена</button>
              <button onClick={handleReject} className="flex-1 py-2.5 rounded-lg text-sm font-bold"
                style={{ background: '#EF4444', color: '#fff' }}>Отклонить</button>
            </div>
          </div>
        </div>
      )}

      {showImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.85)' }}
          onClick={() => setShowImage(null)}>
          <img src={showImage} alt="" className="max-w-full max-h-[80vh] rounded-xl" />
          <button className="absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.2)' }}>
            <X size={24} color="#fff" />
          </button>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, bold }) {
  return (
    <div className="flex justify-between items-start gap-3">
      <span className="text-xs flex-shrink-0" style={{ color: 'var(--mc-muted)' }}>{label}</span>
      <span className={`text-sm text-right ${bold ? 'font-bold' : ''}`} style={{ color: 'var(--mc-text)' }}>{value}</span>
    </div>
  );
}
