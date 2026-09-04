import React, { useState, useMemo } from 'react';
import { Plus, Edit3, Building2, Check, X, Loader2, Users, Package, CalendarClock } from 'lucide-react';
import { supabase } from '../supabase/client';
import { ALL_MODULES } from '../modules';

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'org';
}

const DEFAULT_MODULES = ['sales', 'products'];

// Дней до trial_ends_at по календарной дате Алматы (не по разнице timestamp'ов —
// иначе "истекает сегодня" из-за времени суток то и дело считалось бы "уже истёк").
function daysUntil(trialEndsAt) {
  if (!trialEndsAt) return null;
  const todayISO = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date());
  const endISO = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date(trialEndsAt));
  return Math.round((new Date(endISO) - new Date(todayISO)) / 86400000);
}

function trialBadge(trialEndsAt) {
  const days = daysUntil(trialEndsAt);
  if (days === null) return null;
  if (days < 0) return { label: `истёк ${Math.abs(days)} дн. назад`, bg: 'var(--mc-danger-bg)', color: '#EB5757' };
  if (days === 0) return { label: 'истекает сегодня', bg: 'var(--mc-danger-bg)', color: '#EB5757' };
  if (days <= 7) return { label: `истекает через ${days} дн.`, bg: 'var(--mc-warning-bg, #FEF3C7)', color: 'var(--mc-warning-text, #92400E)' };
  return { label: `до ${trialEndsAt.slice(0, 10)}`, bg: 'var(--mc-active-item)', color: 'var(--mc-muted)' };
}

export default function OrgManagementScreen({ ctx }) {
  const { organizations, currentUser, showToast, db } = ctx;
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '', company_name: '', tagline: '', accent_color: '#297b8a',
    logo_url: '', logo_hor_url: '', modules: [...DEFAULT_MODULES], disabledBlocks: [], trialEndsAt: '',
  });

  if (!currentUser?.is_super_admin) {
    return (
      <div className="p-6 text-center" style={{ color: 'var(--mc-muted)' }}>
        Доступ запрещён. Только для супер-администратора.
      </div>
    );
  }

  const userCounts = useMemo(() => {
    const counts = {};
    (db.users || []).forEach(u => {
      if (u.active !== false) {
        const oid = u.org_id || 'none';
        counts[oid] = (counts[oid] || 0) + 1;
      }
    });
    return counts;
  }, [db.users]);

  const startCreate = () => {
    setForm({
      name: '', company_name: '', tagline: 'Operations Platform', accent_color: '#297b8a',
      logo_url: '', logo_hor_url: '', modules: [...DEFAULT_MODULES], disabledBlocks: [], trialEndsAt: '',
    });
    setCreating(true);
    setEditing(null);
  };

  const startEdit = (org) => {
    const b = org.branding || {};
    setForm({
      name: org.name || '',
      company_name: b.company_name || org.name || '',
      tagline: b.tagline || '',
      accent_color: b.accent_color || '#297b8a',
      logo_url: b.logo_url || '',
      logo_hor_url: b.logo_hor_url || '',
      modules: Array.isArray(org.enabled_modules) ? [...org.enabled_modules] : ALL_MODULES.map(m => m.key),
      disabledBlocks: Array.isArray(org.disabled_blocks) ? [...org.disabled_blocks] : [],
      trialEndsAt: org.trial_ends_at ? org.trial_ends_at.slice(0, 10) : '',
    });
    setEditing(org.id);
    setCreating(false);
  };

  const cancel = () => { setEditing(null); setCreating(false); };

  const toggleModule = (key) => {
    setForm(f => ({
      ...f,
      modules: f.modules.includes(key)
        ? f.modules.filter(m => m !== key)
        : [...f.modules, key],
    }));
  };

  const toggleBlock = (key) => {
    setForm(f => ({
      ...f,
      disabledBlocks: f.disabledBlocks.includes(key)
        ? f.disabledBlocks.filter(b => b !== key)
        : [...f.disabledBlocks, key],
    }));
  };

  const saveOrg = async () => {
    if (!form.name.trim()) { showToast('Введите название организации', 'error'); return; }
    setSaving(true);
    try {
      const branding = {
        company_name: form.company_name.trim() || form.name.trim(),
        tagline: form.tagline.trim(),
        accent_color: form.accent_color || '#297b8a',
        logo_url: form.logo_url.trim() || null,
        logo_hor_url: form.logo_hor_url.trim() || null,
      };

      const trial_ends_at = form.trialEndsAt ? `${form.trialEndsAt}T23:59:59+05:00` : null;

      if (creating) {
        const newOrg = {
          id: uid(),
          name: form.name.trim(),
          slug: slugify(form.name),
          is_demo: false,
          is_active: true,
          branding,
          enabled_modules: form.modules,
          disabled_blocks: form.disabledBlocks,
          trial_ends_at,
          created_at: new Date().toISOString(),
        };
        const { error } = await supabase.from('organizations').insert(newOrg);
        if (error) throw error;
        const { data: allOrgs } = await supabase.from('organizations').select('*').order('name');
        if (allOrgs) ctx.setOrganizations?.(allOrgs);
        showToast(`Организация «${form.name.trim()}» создана`);
      } else if (editing) {
        const { error } = await supabase.from('organizations')
          .update({ name: form.name.trim(), branding, enabled_modules: form.modules, disabled_blocks: form.disabledBlocks, trial_ends_at })
          .eq('id', editing);
        if (error) throw error;
        const { data: allOrgs } = await supabase.from('organizations').select('*').order('name');
        if (allOrgs) ctx.setOrganizations?.(allOrgs);
        showToast('Организация обновлена');
      }
      cancel();
    } catch (e) {
      showToast(e.message || 'Ошибка сохранения', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (org) => {
    try {
      const { error } = await supabase.from('organizations')
        .update({ is_active: !org.is_active })
        .eq('id', org.id);
      if (error) throw error;
      const { data: allOrgs } = await supabase.from('organizations').select('*').order('name');
      if (allOrgs) ctx.setOrganizations?.(allOrgs);
      showToast(org.is_active ? 'Организация деактивирована' : 'Организация активирована');
    } catch (e) {
      showToast(e.message || 'Ошибка', 'error');
    }
  };

  const formUI = (
    <div className="rounded-xl p-5 mb-4 max-w-xl" style={{ background: 'var(--mc-bg)', border: '1px solid var(--mc-border)' }}>
      <div className="grid gap-3">
        <div>
          <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>Название организации *</label>
          <input className="w-full rounded-lg border px-3 py-2 text-sm" style={{ background: 'var(--mc-bg)', color: 'var(--mc-text)', borderColor: 'var(--mc-border)' }}
            value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="ТОО Компания" />
        </div>
        <div>
          <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>Название для брендинга</label>
          <input className="w-full rounded-lg border px-3 py-2 text-sm" style={{ background: 'var(--mc-bg)', color: 'var(--mc-text)', borderColor: 'var(--mc-border)' }}
            value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} placeholder="Brand Name" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>Слоган</label>
            <input className="w-full rounded-lg border px-3 py-2 text-sm" style={{ background: 'var(--mc-bg)', color: 'var(--mc-text)', borderColor: 'var(--mc-border)' }}
              value={form.tagline} onChange={e => setForm(f => ({ ...f, tagline: e.target.value }))} placeholder="Operations Platform" />
          </div>
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>Акцентный цвет</label>
            <div className="flex items-center gap-2">
              <input type="color" value={form.accent_color} onChange={e => setForm(f => ({ ...f, accent_color: e.target.value }))}
                className="w-10 h-10 rounded border-0 cursor-pointer" style={{ padding: 0 }} />
              <input className="flex-1 rounded-lg border px-3 py-2 text-sm mono-font" style={{ background: 'var(--mc-bg)', color: 'var(--mc-text)', borderColor: 'var(--mc-border)' }}
                value={form.accent_color} onChange={e => setForm(f => ({ ...f, accent_color: e.target.value }))} />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>URL логотипа (квадрат)</label>
            <input className="w-full rounded-lg border px-3 py-2 text-sm" style={{ background: 'var(--mc-bg)', color: 'var(--mc-text)', borderColor: 'var(--mc-border)' }}
              value={form.logo_url} onChange={e => setForm(f => ({ ...f, logo_url: e.target.value }))} placeholder="/logo-symbol.png" />
          </div>
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>URL логотипа (горизонт.)</label>
            <input className="w-full rounded-lg border px-3 py-2 text-sm" style={{ background: 'var(--mc-bg)', color: 'var(--mc-text)', borderColor: 'var(--mc-border)' }}
              value={form.logo_hor_url} onChange={e => setForm(f => ({ ...f, logo_hor_url: e.target.value }))} placeholder="/logo-hor.png" />
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--mc-muted)' }}>
            <CalendarClock size={12} className="inline mr-1" style={{ verticalAlign: 'middle' }} />
            Пилот/подписка действует до
          </label>
          <input type="date" className="w-full rounded-lg border px-3 py-2 text-sm" style={{ background: 'var(--mc-bg)', color: 'var(--mc-text)', borderColor: 'var(--mc-border)' }}
            value={form.trialEndsAt} onChange={e => setForm(f => ({ ...f, trialEndsAt: e.target.value }))} />
          <div className="text-[10px] mt-1" style={{ color: 'var(--mc-muted)' }}>
            За 7 и 3 дня и в день истечения админам организации (роль admin/director) придёт напоминание в Telegram и в приложении. Оставьте пустым, если срок не ограничен.
          </div>
        </div>
        {(form.logo_url || form.logo_hor_url) && (
          <div className="flex items-center gap-4 p-3 rounded-lg" style={{ background: 'var(--mc-active-item)' }}>
            <span className="text-xs font-semibold" style={{ color: 'var(--mc-muted)' }}>Превью:</span>
            {form.logo_url && <img src={form.logo_url} alt="logo" style={{ height: 40, objectFit: 'contain' }} onError={e => { e.target.style.display = 'none'; }} />}
            {form.logo_hor_url && <img src={form.logo_hor_url} alt="logo-hor" style={{ height: 32, objectFit: 'contain' }} onError={e => { e.target.style.display = 'none'; }} />}
          </div>
        )}

        {/* Модули / блоки */}
        <div>
          <label className="text-xs font-semibold mb-2 block" style={{ color: 'var(--mc-muted)' }}>
            <Package size={12} className="inline mr-1" style={{ verticalAlign: 'middle' }} />
            Доступные модули ({form.modules.length} из {ALL_MODULES.length})
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {ALL_MODULES.map(m => {
              const active = form.modules.includes(m.key);
              const disabledCount = m.blocks.filter(bl => form.disabledBlocks.includes(bl.key)).length;
              return (
                <div key={m.key} className="rounded-lg overflow-hidden" style={{ border: active ? '1.5px solid #297b8a' : '1.5px solid transparent' }}>
                  <button type="button" onClick={() => toggleModule(m.key)}
                    className="flex items-center gap-2 px-3 py-2 text-left transition-colors w-full"
                    style={{ background: active ? '#297b8a18' : 'var(--mc-active-item)' }}>
                    <div className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                      style={{ background: active ? '#297b8a' : 'var(--mc-border)' }}>
                      {active && <Check size={10} color="white" strokeWidth={3} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold truncate" style={{ color: active ? '#297b8a' : 'var(--mc-text)' }}>
                        {m.label}
                      </div>
                      <div className="text-[10px] truncate" style={{ color: 'var(--mc-muted)' }}>
                        {m.desc}
                      </div>
                    </div>
                    {active && m.blocks.length > 1 && disabledCount > 0 && (
                      <span className="text-[9px] font-semibold rounded-full px-1.5 py-0.5 flex-shrink-0"
                        style={{ background: 'var(--mc-warning-bg, #FEF3C7)', color: 'var(--mc-warning-text, #92400E)' }}>
                        −{disabledCount}
                      </span>
                    )}
                  </button>
                  {active && m.blocks.length > 1 && (
                    <div className="px-3 py-2 flex flex-col gap-1" style={{ background: 'var(--mc-bg)' }}>
                      {m.blocks.map(bl => {
                        const blockActive = !form.disabledBlocks.includes(bl.key);
                        return (
                          <button key={bl.key} type="button" onClick={() => toggleBlock(bl.key)}
                            className="flex items-center gap-2 text-left"
                            style={{ opacity: blockActive ? 1 : 0.55 }}>
                            <div className="w-3 h-3 rounded-sm flex items-center justify-center flex-shrink-0"
                              style={{ background: blockActive ? '#297b8a' : 'var(--mc-border)' }}>
                              {blockActive && <Check size={8} color="white" strokeWidth={3} />}
                            </div>
                            <span className="text-[11px]" style={{ color: 'var(--mc-text)' }}>{bl.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-4">
        <button onClick={saveOrg} disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white"
          style={{ background: '#297b8a', opacity: saving ? 0.6 : 1 }}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {creating ? 'Создать' : 'Сохранить'}
        </button>
        <button onClick={cancel} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold"
          style={{ color: 'var(--mc-muted)' }}>
          <X size={14} /> Отмена
        </button>
      </div>
    </div>
  );

  return (
    <div className="p-4 lg:p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--mc-text)' }}>Организации</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--mc-muted)' }}>Управление организациями, модулями и брендингом</p>
        </div>
        {!creating && !editing && (
          <button onClick={startCreate}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ background: '#297b8a' }}>
            <Plus size={16} /> Новая
          </button>
        )}
      </div>

      {creating && formUI}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {organizations.map(org => {
          const b = org.branding || {};
          const modCount = Array.isArray(org.enabled_modules) ? org.enabled_modules.length : ALL_MODULES.length;
          const uCount = userCounts[org.id] || 0;
          const trial = trialBadge(org.trial_ends_at);
          if (editing === org.id) return <React.Fragment key={org.id}>{formUI}</React.Fragment>;
          return (
            <div key={org.id} className="rounded-xl p-4"
              style={{ background: 'var(--mc-bg)', border: '1px solid var(--mc-border)' }}>
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: (b.accent_color || '#297b8a') + '18' }}>
                  {b.logo_url
                    ? <img src={b.logo_url} alt="" style={{ width: 32, height: 32, objectFit: 'contain' }} />
                    : <Building2 size={24} style={{ color: b.accent_color || '#297b8a' }} />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate" style={{ color: 'var(--mc-text)' }}>
                    {org.name}
                    {org.is_demo && <span className="ml-2 text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--mc-warning-bg)', color: 'var(--mc-warning-text)' }}>demo</span>}
                    {!org.is_active && <span className="ml-2 text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--mc-danger-bg)', color: '#EB5757' }}>неактивна</span>}
                  </div>
                  <div className="text-xs truncate" style={{ color: 'var(--mc-muted)' }}>
                    {b.company_name || org.name}{b.tagline ? ` · ${b.tagline}` : ''}
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[10px] flex items-center gap-1" style={{ color: 'var(--mc-muted)' }}>
                      <Users size={10} /> {uCount} польз.
                    </span>
                    <span className="text-[10px] flex items-center gap-1" style={{ color: 'var(--mc-muted)' }}>
                      <Package size={10} /> {modCount}/{ALL_MODULES.length} модулей
                    </span>
                    <span className="text-[10px] mono-font" style={{ color: 'var(--mc-muted)', opacity: 0.7 }}>
                      {org.id.slice(0, 8)}…
                    </span>
                    {trial && (
                      <span className="text-[10px] font-semibold rounded-full px-1.5 py-0.5 flex items-center gap-1"
                        style={{ background: trial.bg, color: trial.color }}>
                        <CalendarClock size={9} /> {trial.label}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => startEdit(org)} className="p-2 rounded-lg hover:opacity-80" title="Редактировать"
                    style={{ color: 'var(--mc-muted)' }}>
                    <Edit3 size={16} />
                  </button>
                  <button onClick={() => toggleActive(org)} className="p-2 rounded-lg hover:opacity-80"
                    title={org.is_active ? 'Деактивировать' : 'Активировать'}
                    style={{ color: org.is_active ? 'var(--mc-muted)' : '#22c55e' }}>
                    {org.is_active ? <X size={16} /> : <Check size={16} />}
                  </button>
                </div>
              </div>
              {/* Module pills */}
              <div className="flex flex-wrap gap-1 mt-2 ml-16">
                {ALL_MODULES.map(m => {
                  const on = Array.isArray(org.enabled_modules) ? org.enabled_modules.includes(m.key) : true;
                  return (
                    <span key={m.key} className="text-[9px] font-semibold rounded-full px-1.5 py-0.5"
                      style={{
                        background: on ? '#297b8a18' : 'var(--mc-active-item)',
                        color: on ? '#297b8a' : 'var(--mc-muted)',
                        opacity: on ? 1 : 0.5,
                      }}>
                      {m.label}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
