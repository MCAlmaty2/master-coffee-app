import React, { useState, useMemo } from 'react';
import {
  ChevronLeft, Plus, Search, X, Check, Edit3, Trash2, FileCheck2, Building2,
} from 'lucide-react';
import { ClientPickerModal } from './ClientsScreen';

const TZ = 'Asia/Almaty';
const inputCls = 'w-full px-3 py-2 rounded-lg outline-none text-sm';
const inputBorder = (err) => ({ border: `1px solid ${err ? '#EB5757' : 'var(--mc-border)'}` });
const btnCancel = { background: 'var(--mc-surface)', color: 'var(--mc-muted)', border: '1px solid var(--mc-border)' };
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('ru-KZ', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ }) : '—';
const todayStr = () => { const d = new Date(); d.setMinutes(d.getMinutes() + 300); return d.toISOString().slice(0, 10); };
const currentQuarter = () => Math.ceil((new Date().getMonth() + 1) / 3);

// Те же "наши" юр. лица, что и в налоговом режиме клиента (App.jsx TAX_REGIME/OUR_REQUISITES) —
// Акт сверки выпускается от имени одного из них.
const ORG_ENTITY = {
  OUR: { label: 'ОУР', company: 'ТОО "Мастер Кофе"' },
  SNR: { label: 'СНР', company: 'ТОО "MASTER COFFEE FOOD"' },
};

const isManage = (user, ctx) => user?.role === 'admin' || user?.role === 'director' || ctx.hasPermission('recon_acts_edit');

export function ReconciliationActsScreen({ ctx }) {
  const { route } = ctx;
  if (route.name === 'reconciliation_act_create') return <ActFormScreen ctx={ctx} />;
  if (route.name === 'reconciliation_act_edit') return <ActFormScreen ctx={ctx} actId={route.actId} />;
  return <ActListScreen ctx={ctx} />;
}

function ActListScreen({ ctx }) {
  const { db, currentUser, navigate, showToast } = ctx;
  const canManage = isManage(currentUser, ctx);
  const acts = db.reconciliationActs || [];

  const [year, setYear] = useState(new Date().getFullYear());
  const [quarter, setQuarter] = useState(0); // 0 = все кварталы
  const [search, setSearch] = useState('');

  const years = useMemo(() => {
    const set = new Set(acts.map(a => a.year));
    set.add(new Date().getFullYear());
    return [...set].sort((a, b) => b - a);
  }, [acts]);

  const filtered = useMemo(() => {
    let list = acts.filter(a => a.year === year);
    if (quarter) list = list.filter(a => a.quarter === quarter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(a => (a.counterparty || '').toLowerCase().includes(q) || (a.number || '').toLowerCase().includes(q));
    }
    return list.sort((a, b) => (b.act_date || '').localeCompare(a.act_date || ''));
  }, [acts, year, quarter, search]);

  const signedCount = filtered.filter(a => a.signed).length;

  const handleDelete = async (id) => {
    if (!confirm('Удалить акт сверки?')) return;
    const r = await ctx.deleteReconciliationAct(id);
    if (r?.error) return showToast(r.error);
    showToast('Акт сверки удалён');
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 19, fontWeight: 800, color: 'var(--mc-text)', margin: 0 }}>Акт сверки</h1>
            <div style={{ fontSize: 12, color: 'var(--mc-muted)', marginTop: 2 }}>
              {filtered.length} за квартал · подписано {signedCount} из {filtered.length}
            </div>
          </div>
          {canManage && (
            <button onClick={() => navigate({ name: 'reconciliation_act_create' })}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-white"
              style={{ background: '#3B82F6', flexShrink: 0 }}>
              <Plus size={14} /> Акт
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10, overflowX: 'auto' }}>
        {years.map(y => (
          <button key={y} onClick={() => setYear(y)}
            style={{ flexShrink: 0, padding: '7px 14px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer',
              background: year === y ? '#297b8a' : 'var(--mc-surface)', color: year === y ? '#fff' : 'var(--mc-muted)', border: `1px solid ${year === y ? '#297b8a' : 'var(--mc-border)'}` }}>
            {y}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, overflowX: 'auto' }}>
        {[0, 1, 2, 3, 4].map(q => (
          <button key={q} onClick={() => setQuarter(q)}
            style={{ flexShrink: 0, padding: '7px 14px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer',
              background: quarter === q ? '#3B82F6' : 'var(--mc-surface)', color: quarter === q ? '#fff' : 'var(--mc-muted)', border: `1px solid ${quarter === q ? '#3B82F6' : 'var(--mc-border)'}` }}>
            {q === 0 ? 'Все кварталы' : `${q} кв.`}
          </button>
        ))}
      </div>

      <div style={{ position: 'relative', marginBottom: 14 }}>
        <Search size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--mc-muted)', pointerEvents: 'none' }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по контрагенту, номеру..."
          style={{ width: '100%', padding: '10px 36px', border: '1px solid var(--mc-border)', borderRadius: 10, fontSize: 15, outline: 'none', background: 'var(--mc-surface)', color: 'var(--mc-text)', boxSizing: 'border-box' }} />
        {search && (
          <button onClick={() => setSearch('')}
            style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mc-muted)' }}>
            <X size={14} />
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--mc-muted)' }}>
          <FileCheck2 size={32} style={{ opacity: .4, marginBottom: 8 }} />
          <div style={{ fontSize: 13 }}>Актов сверки пока нет</div>
        </div>
      ) : filtered.map(a => (
        <div key={a.id} style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 12, padding: '12px 14px', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--mc-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.counterparty}
              </div>
              <div style={{ fontSize: 12, color: 'var(--mc-muted)', marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span>{ORG_ENTITY[a.org_entity]?.label || a.org_entity}</span>
                {a.number && <span>№ {a.number}</span>}
                <span>{fmtDate(a.act_date)}</span>
                <span>{a.quarter} кв. {a.year}</span>
              </div>
            </div>
            <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, borderRadius: 8, padding: '4px 9px',
              background: a.signed ? '#DCFCE7' : '#FEE2E2', color: a.signed ? '#16a34a' : '#B91C1C' }}>
              {a.signed ? <Check size={12} /> : <X size={12} />}
              {a.signed ? 'Подписан' : 'Не получен'}
            </span>
          </div>
          {a.comment && <div style={{ fontSize: 12, color: 'var(--mc-muted)', marginTop: 6 }}>{a.comment}</div>}
          {canManage && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button onClick={() => navigate({ name: 'reconciliation_act_edit', actId: a.id })}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', background: 'var(--mc-info-bg)', color: 'var(--mc-info-text)', border: 'none', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                <Edit3 size={11} /> Изменить
              </button>
              <button onClick={() => handleDelete(a.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', background: 'none', color: '#EB5757', border: 'none', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                <Trash2 size={11} /> Удалить
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ActFormScreen({ ctx, actId }) {
  const { db, navigate, goBack, showToast } = ctx;
  const existing = actId ? (db.reconciliationActs || []).find(a => a.id === actId) : null;

  const [form, setForm] = useState(() => ({
    org_entity: existing?.org_entity || 'OUR',
    number: existing?.number || '',
    act_date: existing?.act_date || todayStr(),
    counterparty: existing?.counterparty || '',
    client_id: existing?.client_id || null,
    signed: existing?.signed || false,
    year: existing?.year || new Date().getFullYear(),
    quarter: existing?.quarter || currentQuarter(),
    comment: existing?.comment || '',
  }));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const upd = patch => setForm(f => ({ ...f, ...patch }));

  const handleSave = async () => {
    const e = {};
    if (!form.counterparty.trim()) e.counterparty = 'Укажите контрагента';
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setSaving(true);
    const data = {
      org_entity: form.org_entity,
      number: form.number.trim(),
      act_date: form.act_date || null,
      counterparty: form.counterparty.trim(),
      client_id: form.client_id,
      signed: form.signed,
      year: Number(form.year),
      quarter: Number(form.quarter),
      comment: form.comment.trim(),
    };
    const r = existing
      ? ctx.updateReconciliationAct(existing.id, data)
      : ctx.createReconciliationAct(data);
    setSaving(false);
    if (r?.error) return showToast(r.error);
    showToast(existing ? 'Акт сверки обновлён' : 'Акт сверки добавлен');
    navigate({ name: 'reconciliation_acts' });
  };

  return (
    <div>
      <button onClick={() => navigate(existing ? { name: 'reconciliation_acts' } : { name: 'reconciliation_acts' })}
        style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--mc-muted)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 12, padding: 0 }}>
        <ChevronLeft size={15} /> Назад
      </button>
      <h1 style={{ fontSize: 18, fontWeight: 800, color: 'var(--mc-text)', marginBottom: 16 }}>
        {existing ? 'Редактировать акт сверки' : 'Новый акт сверки'}
      </h1>

      <div style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 10 }}>Организация</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {Object.entries(ORG_ENTITY).map(([k, v]) => (
            <button key={k} onClick={() => upd({ org_entity: k })}
              style={{ flex: 1, padding: '9px 6px', background: form.org_entity === k ? '#297b8a' : 'var(--mc-active-item)', color: form.org_entity === k ? '#fff' : 'var(--mc-muted)', border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
              {v.label} — {v.company}
            </button>
          ))}
        </div>
      </div>

      <div style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 10 }}>Документ</div>
        <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--mc-muted)' }}>Номер</label>
        <input className={inputCls} style={{ ...inputBorder(), marginBottom: 10 }} value={form.number} onChange={e => upd({ number: e.target.value })} placeholder="12" />
        <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--mc-muted)' }}>Дата</label>
        <input className={inputCls} style={inputBorder()} type="date" value={form.act_date} onChange={e => upd({ act_date: e.target.value })} />
      </div>

      <div style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 10 }}>Контрагент</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input className={inputCls} style={inputBorder(errors.counterparty)} value={form.counterparty}
            onChange={e => upd({ counterparty: e.target.value, client_id: null })} placeholder='ТОО "Coffee Boom"' />
          <button onClick={() => setPickerOpen(true)}
            style={{ flexShrink: 0, padding: '8px 12px', background: 'var(--mc-info-bg)', color: 'var(--mc-info-text)', border: 'none', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
            <Building2 size={13} /> Из базы
          </button>
        </div>
        {errors.counterparty && <div style={{ fontSize: 11, color: '#EB5757', marginBottom: 6 }}>{errors.counterparty}</div>}
        {form.client_id && <div style={{ fontSize: 11, color: '#16a34a' }}>Связан с клиентом из базы ✓</div>}
      </div>

      <div style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 10 }}>Квартал</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          {[1, 2, 3, 4].map(q => (
            <button key={q} onClick={() => upd({ quarter: q })}
              style={{ flex: 1, padding: '9px 4px', background: form.quarter === q ? '#3B82F6' : 'var(--mc-active-item)', color: form.quarter === q ? '#fff' : 'var(--mc-muted)', border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
              {q} кв.
            </button>
          ))}
        </div>
        <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--mc-muted)' }}>Год</label>
        <input className={inputCls} style={{ ...inputBorder(), maxWidth: 140 }} type="number" value={form.year} onChange={e => upd({ year: e.target.value })} />
      </div>

      <button onClick={() => upd({ signed: !form.signed })}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 12, padding: '12px 14px', marginBottom: 12, cursor: 'pointer', textAlign: 'left' }}>
        <div style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: form.signed ? '#16a34a' : 'var(--mc-active-item)', border: form.signed ? 'none' : '1px solid var(--mc-border)' }}>
          {form.signed && <Check size={14} color="#fff" />}
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--mc-text)' }}>Акт подписан и получен</div>
          <div style={{ fontSize: 11, color: 'var(--mc-muted)' }}>Отметьте, когда оригинал/скан вернулся от контрагента</div>
        </div>
      </button>

      <div style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 12, padding: '12px 14px', marginBottom: 16 }}>
        <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--mc-muted)' }}>Комментарий</label>
        <textarea className={inputCls} style={inputBorder()} rows={2} value={form.comment} onChange={e => upd({ comment: e.target.value })} />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={goBack} className="flex-1 py-2.5 rounded-xl text-sm font-semibold" style={btnCancel}>Отмена</button>
        <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: '#3B82F6', opacity: saving ? .6 : 1 }}>
          {saving ? 'Сохранение...' : 'Сохранить'}
        </button>
      </div>

      {pickerOpen && (
        <ClientPickerModal
          ctx={ctx}
          onClose={() => setPickerOpen(false)}
          onSelect={(c) => {
            upd({ counterparty: c.name, client_id: c.id });
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}
