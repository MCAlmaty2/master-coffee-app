// ═══════════════════════════════════════════════════════════════════════════
// src/screens/RoundPointsScreen.jsx — Точки обхода (бариста/техник)
// Список кофеен/точек, которые обходят бариста и техники: партнёры и новые
// (ещё не клиенты) точки, привлечённые в поле. Визиты — задачи kind='round'.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState, useMemo } from 'react';
import {
  ChevronLeft, ChevronRight, Plus, Search, X, MapPin, Phone, User,
  Building2, CheckCircle2, Circle, Edit2, Footprints, Handshake, Link2, XCircle, RotateCcw,
} from 'lucide-react';
import { ClientPickerModal } from './ClientsScreen';

const TZ = 'Asia/Almaty';
const fmtDate = (iso) =>
  iso ? new Date(iso + 'T00:00:00').toLocaleDateString('ru-KZ', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';
const fmtDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('ru-KZ', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '—';
const todayISO = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 300); // Asia/Almaty ~UTC+5, грубый сдвиг для дефолта поля
  return d.toISOString().slice(0, 10);
};

const FIELD_ROLES = ['barista', 'technician'];
const MANAGE_ROLES = ['admin', 'director', 'b2b', 'senior_manager'];

const STATUS_META = {
  partner:      { label: 'Партнёр',            color: '#16a34a', bg: '#F0FDF4', border: 'var(--mc-success-border)' },
  prospect:     { label: 'Новая точка',        color: '#F59E0B', bg: '#FEF3C7', border: '#FDE68A' },
  closed:       { label: 'Точка закрылась',    color: '#64748B', bg: '#F1F5F9', border: 'var(--mc-border)' },
  partner_left: { label: 'Партнёр не работает', color: '#EB5757', bg: '#FEE2E2', border: '#FCA5A5' },
};
const INACTIVE_STATUSES = ['closed', 'partner_left'];

function userName(db, id) {
  const u = (db.users || []).find(x => x.id === id);
  return u ? `${u.first_name} ${u.last_name || ''}`.trim() : null;
}

function lastVisitFor(db, pointId, department) {
  const rows = (db.tasks || [])
    .filter(t => t.kind === 'round' && t.meta?.round_point_id === pointId && t.department === department && t.visit_date)
    .sort((a, b) => (b.visit_date || '').localeCompare(a.visit_date || ''));
  return rows[0] || null;
}

// Задача-обход, заведённая СЕГОДНЯ этим сотрудником на эту точку (для быстрых галочек в списке).
function todayTaskFor(db, pointId, userId) {
  const today = todayISO();
  return (db.tasks || []).find(t => t.kind === 'round' && t.meta?.round_point_id === pointId && t.assignee_id === userId && t.visit_date === today) || null;
}

// ─── Shared UI (локальные копии стиля ClientsScreen) ───────────────────────

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

function FieldRow({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--mc-border-light)', fontSize: 12 }}>
      <span style={{ color: 'var(--mc-muted)', minWidth: 130, flexShrink: 0 }}>{label}</span>
      <span style={{ color: 'var(--mc-text)', fontWeight: 500, flex: 1, wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// RoundPointsScreen — список точек
// ═══════════════════════════════════════════════════════════════════════════

export function RoundPointsScreen({ ctx }) {
  const { db, navigate, currentUser } = ctx;
  const [search, setSearch] = useState('');
  const [statusTab, setStatusTab] = useState('all');
  const [mineOnly, setMineOnly] = useState(false);

  const points = db.roundPoints || [];
  const isField = FIELD_ROLES.includes(currentUser.role);
  const canManage = MANAGE_ROLES.includes(currentUser.role) || isField;

  const partnerN = points.filter(p => p.status === 'partner').length;
  const prospectN = points.filter(p => p.status === 'prospect').length;
  const inactiveN = points.filter(p => INACTIVE_STATUSES.includes(p.status)).length;

  const filtered = useMemo(() => {
    let list = points;
    if (statusTab === 'inactive') list = list.filter(p => INACTIVE_STATUSES.includes(p.status));
    else if (statusTab !== 'all') list = list.filter(p => p.status === statusTab);
    else list = list.filter(p => !INACTIVE_STATUSES.includes(p.status));
    if (mineOnly) {
      list = list.filter(p => p.responsible_barista_id === currentUser.id || p.responsible_technician_id === currentUser.id || p.recruited_by === currentUser.id);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(p =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.address || '').toLowerCase().includes(q) ||
        (p.phone || '').toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
  }, [points, statusTab, mineOnly, search, currentUser.id]);

  return (
    <div>
      <SHeader
        title="Точки обхода"
        subtitle={`${points.length} точек · ${partnerN} партнёров · ${prospectN} новых${inactiveN ? ` · ${inactiveN} неактивных` : ''}`}
        action={canManage && (
          <button onClick={() => navigate({ name: 'round_point_form', pointId: null })}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: '#297b8a', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            <Plus size={15} /> Точка
          </button>
        )}
      />

      <div style={{ position: 'relative', marginBottom: 10 }}>
        <Search size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--mc-muted)', pointerEvents: 'none' }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск: название, адрес..."
          style={{ width: '100%', padding: '10px 36px', border: '1px solid var(--mc-border)', borderRadius: 10, fontSize: 16, outline: 'none', background: 'var(--mc-surface)', color: 'var(--mc-text)', boxSizing: 'border-box' }} />
        {search && (
          <button onClick={() => setSearch('')}
            style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mc-muted)', lineHeight: 1 }}>
            <X size={14} />
          </button>
        )}
      </div>

      <div style={{ display: 'flex', border: '1px solid var(--mc-border)', borderRadius: 10, marginBottom: 10, overflow: 'hidden' }}>
        {[['all', `Все (${points.length - inactiveN})`], ['partner', `Партнёры (${partnerN})`], ['prospect', `Новые (${prospectN})`], ['inactive', `Неактивные (${inactiveN})`]].map(([k, l]) => (
          <button key={k} onClick={() => setStatusTab(k)}
            style={{ flex: 1, padding: '7px 4px', fontSize: 10.5, fontWeight: 600, cursor: 'pointer', background: statusTab === k ? '#297b8a' : 'var(--mc-surface)', color: statusTab === k ? '#fff' : 'var(--mc-muted)', border: 'none' }}>
            {l}
          </button>
        ))}
      </div>

      {isField && (
        <button onClick={() => setMineOnly(m => !m)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14, padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: mineOnly ? '#EFF6FF' : 'var(--mc-surface)', color: mineOnly ? '#1D4ED8' : 'var(--mc-muted)', border: `1px solid ${mineOnly ? 'var(--mc-info-border)' : 'var(--mc-border)'}` }}>
          {mineOnly ? <CheckCircle2 size={13} /> : null} Только мои точки
        </button>
      )}

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--mc-muted)' }}>
          <MapPin size={36} style={{ margin: '0 auto 12px', opacity: .3 }} />
          <div style={{ fontSize: 14 }}>{search ? 'Ничего не найдено' : 'Точек обхода пока нет'}</div>
        </div>
      ) : filtered.map(p => (
        <RoundPointCard key={p.id} point={p} ctx={ctx}
          onClick={() => navigate({ name: 'round_point_detail', pointId: p.id })} />
      ))}
    </div>
  );
}

function RoundPointCard({ point: p, ctx, onClick }) {
  const { db, currentUser, startRoundVisit, logRoundVisitDone, showToast } = ctx;
  const meta = STATUS_META[p.status] || STATUS_META.prospect;
  const baristaName = userName(db, p.responsible_barista_id);
  const techName = userName(db, p.responsible_technician_id);
  const linkedClient = p.client_id ? (db.clients || []).find(c => c.id === p.client_id) : null;
  const isField = FIELD_ROLES.includes(currentUser.role);
  const todayTask = isField ? todayTaskFor(db, p.id, currentUser.id) : null;
  const [busy, setBusy] = useState(false);

  const handleVisitToggle = async (e) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    if (!todayTask) {
      const r = await startRoundVisit(p.id, { visit_date: todayISO() });
      if (r?.error) showToast(r.error);
    } else if (todayTask.status !== 'done') {
      const r = await logRoundVisitDone(todayTask.id);
      if (r?.error) showToast(r.error);
      else showToast('Отмечено: обход выполнен');
    }
    setBusy(false);
  };

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 12, padding: '12px 14px', marginBottom: 8 }}>
      <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
        <div style={{ width: 38, height: 38, borderRadius: '50%', background: meta.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {p.status === 'partner' ? <Handshake size={17} color={meta.color} /> : p.status === 'prospect' ? <Footprints size={17} color={meta.color} /> : <XCircle size={17} color={meta.color} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--mc-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
            <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 700, borderRadius: 6, padding: '1px 6px', background: meta.bg, color: meta.color, border: `1px solid ${meta.border}` }}>{meta.label}</span>
          </div>
          {p.address && (
            <div style={{ fontSize: 10, color: 'var(--mc-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              📍 {p.address}
            </div>
          )}
          {linkedClient && (
            <div style={{ fontSize: 10, color: '#297b8a', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              🏢 {linkedClient.name}
            </div>
          )}
          <div style={{ fontSize: 10, color: 'var(--mc-muted)', marginTop: 1 }}>
            {baristaName ? `☕ ${baristaName}` : '☕ не закреплён'}{' · '}{techName ? `🔧 ${techName}` : '🔧 не закреплён'}
          </div>
        </div>
      </button>
      {isField && !INACTIVE_STATUSES.includes(p.status) && (
        <button onClick={handleVisitToggle} disabled={busy || todayTask?.status === 'done'}
          title={!todayTask ? 'Иду сегодня' : todayTask.status !== 'done' ? 'Отметить: зашёл' : 'Обход выполнен сегодня'}
          style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '6px 8px', borderRadius: 8, border: `1px solid ${todayTask?.status === 'done' ? 'var(--mc-success-border)' : 'var(--mc-border)'}`, background: todayTask?.status === 'done' ? '#F0FDF4' : todayTask ? '#FEF3C7' : 'var(--mc-active-item)', cursor: busy ? 'default' : 'pointer' }}>
          {todayTask?.status === 'done' ? <CheckCircle2 size={16} color="#16a34a" /> : <Circle size={16} color={todayTask ? '#F59E0B' : 'var(--mc-muted)'} />}
          <span style={{ fontSize: 8, fontWeight: 700, color: todayTask?.status === 'done' ? '#16a34a' : todayTask ? '#F59E0B' : 'var(--mc-muted)', whiteSpace: 'nowrap' }}>
            {todayTask?.status === 'done' ? 'Зашёл' : todayTask ? 'Отметить' : 'Иду'}
          </span>
        </button>
      )}
      <button onClick={onClick} style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
        <ChevronRight size={15} color="var(--mc-muted)" />
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// RoundPointDetailScreen — карточка точки
// ═══════════════════════════════════════════════════════════════════════════

export function RoundPointDetailScreen({ ctx, pointId }) {
  const { db, navigate, goBack, currentUser, canEditRoundPoint, startRoundVisit, markRoundPointReadyForPartner,
    closeRoundPoint, linkRoundPointToClient, updateRoundPoint, showToast } = ctx;
  const point = (db.roundPoints || []).find(p => p.id === pointId);
  const [visitModalOpen, setVisitModalOpen] = useState(false);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [closeMenuOpen, setCloseMenuOpen] = useState(false);

  const visits = useMemo(() => (db.tasks || [])
    .filter(t => t.kind === 'round' && t.meta?.round_point_id === pointId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)), [db.tasks, pointId]);

  if (!point) return <div style={{ padding: 24, color: 'var(--mc-muted)', textAlign: 'center' }}>Точка не найдена</div>;

  const meta = STATUS_META[point.status] || STATUS_META.prospect;
  const isField = FIELD_ROLES.includes(currentUser.role);
  const canEdit = canEditRoundPoint(point);
  const canClose = isField || canEdit;
  const isInactive = INACTIVE_STATUSES.includes(point.status);
  const client = point.client_id ? (db.clients || []).find(c => c.id === point.client_id) : null;
  const creator = userName(db, point.created_by);
  const recruiter = userName(db, point.recruited_by);

  const lastBarista = lastVisitFor(db, pointId, 'barista');
  const lastTech = lastVisitFor(db, pointId, 'technician');

  return (
    <div>
      <SHeader
        title={point.name}
        subtitle={point.address || 'Адрес не указан'}
        onBack={goBack}
        action={canEdit && (
          <button onClick={() => navigate({ name: 'round_point_form', pointId: point.id })}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'var(--mc-active-item)', color: 'var(--mc-text)', border: '1px solid var(--mc-border)', borderRadius: 10, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
            <Edit2 size={13} /> Изменить
          </button>
        )}
      />

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 8, padding: '3px 10px', background: meta.bg, color: meta.color, border: `1px solid ${meta.border}` }}>{meta.label}</span>
        <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 8, padding: '3px 10px', background: 'var(--mc-active-item)', color: 'var(--mc-muted)' }}>
          {point.city === 'region' ? 'Регион' : 'Алматы'}
        </span>
        {point.ready_for_partner && point.status === 'prospect' && (
          <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 8, padding: '3px 10px', background: '#EFF6FF', color: '#1D4ED8' }}>Готова стать партнёром</span>
        )}
      </div>

      <div style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
        <FieldRow label="Телефон" value={point.phone} />
        <FieldRow label="Заметки" value={point.notes} />
        <FieldRow label="Закреплён бариста" value={userName(db, point.responsible_barista_id) || '—'} />
        <FieldRow label="Закреплён техник" value={userName(db, point.responsible_technician_id) || '—'} />
        <FieldRow label="Привёл" value={recruiter} />
        <FieldRow label="Создана" value={creator} />
        {client ? (
          <div style={{ paddingTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <button onClick={() => navigate({ name: 'client_detail', clientId: client.id })}
              style={{ fontSize: 12, fontWeight: 600, color: '#297b8a', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              Открыть карточку клиента →
            </button>
            {canEdit && (
              <button onClick={() => setClientPickerOpen(true)}
                style={{ fontSize: 11, fontWeight: 600, color: 'var(--mc-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                изменить
              </button>
            )}
          </div>
        ) : canEdit && (
          <div style={{ paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button onClick={() => setClientPickerOpen(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#297b8a', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              <Link2 size={13} /> Связать с существующим клиентом
            </button>
            <button onClick={() => navigate({
              name: 'client_edit', clientId: null,
              prefill: { name: point.name, address: point.address || '', phone: point.phone || '' },
              returnTo: { name: 'round_point_detail', pointId: point.id },
            })}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#297b8a', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              <Plus size={13} /> Создать нового клиента
            </button>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <div style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 12, padding: '10px 12px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', marginBottom: 4 }}>☕ Посл. визит бариста</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--mc-text)' }}>{lastBarista ? fmtDate(lastBarista.visit_date) : '—'}</div>
        </div>
        <div style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 12, padding: '10px 12px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', marginBottom: 4 }}>🔧 Посл. визит техника</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--mc-text)' }}>{lastTech ? fmtDate(lastTech.visit_date) : '—'}</div>
        </div>
      </div>

      {isField && !isInactive && (
        <button onClick={() => setVisitModalOpen(true)}
          style={{ width: '100%', padding: '13px', borderRadius: 10, fontWeight: 700, color: '#fff', background: '#297b8a', border: 'none', cursor: 'pointer', marginBottom: 10 }}>
          <Footprints size={15} style={{ display: 'inline', marginRight: 6, marginBottom: -2 }} /> Начать обход
        </button>
      )}

      {point.status === 'prospect' && !point.ready_for_partner && (canEdit || isField) && (
        <button onClick={async () => {
          const r = await markRoundPointReadyForPartner(point.id);
          if (r?.error) return showToast(r.error);
          showToast('Менеджеры уведомлены — точка готова стать партнёром');
        }}
          style={{ width: '100%', padding: '12px', borderRadius: 10, fontWeight: 700, color: '#1D4ED8', background: '#EFF6FF', border: '1px solid var(--mc-info-border)', cursor: 'pointer', marginBottom: 10 }}>
          <Handshake size={15} style={{ display: 'inline', marginRight: 6, marginBottom: -2 }} /> Оформить как партнёра
        </button>
      )}

      {canClose && !isInactive && !closeMenuOpen && (
        <button onClick={() => setCloseMenuOpen(true)}
          style={{ width: '100%', padding: '11px', borderRadius: 10, fontWeight: 700, fontSize: 13, color: '#EB5757', background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', cursor: 'pointer', marginBottom: 14 }}>
          <XCircle size={14} style={{ display: 'inline', marginRight: 6, marginBottom: -2 }} /> Точка больше не активна
        </button>
      )}
      {canClose && !isInactive && closeMenuOpen && (
        <div style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 12, padding: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--mc-text)', marginBottom: 10 }}>Что случилось с точкой?</div>
          <button onClick={async () => {
            const r = await closeRoundPoint(point.id, 'closed');
            if (r?.error) return showToast(r.error);
            setCloseMenuOpen(false);
            showToast('Точка отмечена закрытой');
          }} style={{ width: '100%', padding: '10px', borderRadius: 8, fontWeight: 600, fontSize: 12, color: '#64748B', background: '#F1F5F9', border: 'none', cursor: 'pointer', marginBottom: 6 }}>
            Точка закрылась (заведение больше не работает)
          </button>
          <button onClick={async () => {
            const r = await closeRoundPoint(point.id, 'partner_left');
            if (r?.error) return showToast(r.error);
            setCloseMenuOpen(false);
            showToast('Отмечено: партнёр не работает с нами');
          }} style={{ width: '100%', padding: '10px', borderRadius: 8, fontWeight: 600, fontSize: 12, color: '#EB5757', background: '#FEE2E2', border: 'none', cursor: 'pointer', marginBottom: 6 }}>
            Партнёр не работает с нами (точка жива)
          </button>
          <button onClick={() => setCloseMenuOpen(false)} style={{ width: '100%', padding: '8px', borderRadius: 8, fontWeight: 600, fontSize: 12, color: 'var(--mc-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
            Отмена
          </button>
        </div>
      )}
      {isInactive && canClose && (
        <button onClick={async () => {
          const r = await updateRoundPoint(point.id, { status: point.client_id ? 'partner' : 'prospect' });
          if (r?.error) return showToast(r.error);
          showToast('Точка возвращена в работу');
        }}
          style={{ width: '100%', padding: '12px', borderRadius: 10, fontWeight: 700, fontSize: 13, color: '#297b8a', background: 'var(--mc-surface)', border: '1px solid #297b8a', cursor: 'pointer', marginBottom: 14 }}>
          <RotateCcw size={14} style={{ display: 'inline', marginRight: 6, marginBottom: -2 }} /> Вернуть в работу
        </button>
      )}

      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--mc-text)', marginBottom: 8 }}>История визитов</div>
      {visits.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--mc-muted)', padding: '12px 0' }}>Визитов пока не было</div>
      ) : visits.map(v => (
        <button key={v.id} onClick={() => navigate({ name: 'task_detail', taskId: v.id })}
          style={{ display: 'block', width: '100%', textAlign: 'left', background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 10, padding: '10px 12px', marginBottom: 6, cursor: 'pointer' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ fontWeight: 700, color: 'var(--mc-text)' }}>{v.department === 'barista' ? '☕ Бариста' : '🔧 Техник'} · {userName(db, v.assignee_id) || '—'}</span>
            <span style={{ color: 'var(--mc-muted)' }}>{fmtDate(v.visit_date)}</span>
          </div>
          {v.done_summary && <div style={{ fontSize: 11, color: 'var(--mc-muted)', marginTop: 4 }}>{v.done_summary}</div>}
        </button>
      ))}

      {visitModalOpen && (
        <StartVisitModal
          onClose={() => setVisitModalOpen(false)}
          onStart={async (date, time) => {
            const r = await startRoundVisit(point.id, { visit_date: date, visit_time: time });
            if (r?.error) return showToast(r.error);
            setVisitModalOpen(false);
            showToast('Обход добавлен в календарь');
          }}
        />
      )}

      {clientPickerOpen && (
        <ClientPickerModal
          ctx={ctx}
          onClose={() => setClientPickerOpen(false)}
          onSelect={async (c) => {
            const r = await linkRoundPointToClient(point.id, c.id);
            if (r?.error) return showToast(r.error);
            setClientPickerOpen(false);
            showToast(`Точка связана с клиентом «${c.name}»`);
          }}
        />
      )}
    </div>
  );
}

function StartVisitModal({ onClose, onStart }) {
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState('');
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50 }} onClick={onClose}>
      <div style={{ background: 'var(--mc-surface)', borderRadius: '16px 16px 0 0', padding: 20, width: '100%', maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--mc-text)', marginBottom: 14 }}>Начать обход</div>
        <EditField label="Дата визита" value={date} onChange={setDate} type="date" />
        <EditField label="Время (необязательно)" value={time} onChange={setTime} type="time" />
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '11px', borderRadius: 10, fontWeight: 700, background: 'var(--mc-active-item)', color: 'var(--mc-text)', border: 'none', cursor: 'pointer' }}>Отмена</button>
          <button onClick={() => onStart(date, time)} disabled={!date}
            style={{ flex: 1, padding: '11px', borderRadius: 10, fontWeight: 700, background: '#297b8a', color: '#fff', border: 'none', cursor: 'pointer' }}>Начать</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// RoundPointFormScreen — создание / редактирование точки
// ═══════════════════════════════════════════════════════════════════════════

const emptyPoint = { name: '', address: '', phone: '', status: 'prospect', city: 'almaty', notes: '', responsible_barista_id: '', responsible_technician_id: '' };

export function RoundPointFormScreen({ ctx, pointId }) {
  const { db, navigate, goBack, currentUser, createRoundPoint, updateRoundPoint, showToast } = ctx;
  const existing = pointId ? (db.roundPoints || []).find(p => p.id === pointId) : null;
  const [form, setForm] = useState(existing ? { ...emptyPoint, ...existing } : { ...emptyPoint });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const upd = patch => setForm(f => ({ ...f, ...patch }));
  const canManage = MANAGE_ROLES.includes(currentUser.role);

  const baristas = (db.users || []).filter(u => u.role === 'barista');
  const technicians = (db.users || []).filter(u => u.role === 'technician');

  const handleSave = async () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Укажите название точки';
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setSaving(true);
    const data = {
      name: form.name,
      address: form.address,
      phone: form.phone,
      status: form.status,
      city: form.city,
      notes: form.notes,
      responsible_barista_id: form.responsible_barista_id || null,
      responsible_technician_id: form.responsible_technician_id || null,
    };
    const r = existing ? await updateRoundPoint(existing.id, data) : await createRoundPoint(data);
    setSaving(false);
    if (r?.error) return showToast(r.error);
    showToast(existing ? 'Точка обновлена' : 'Точка добавлена');
    navigate(existing ? { name: 'round_point_detail', pointId: existing.id } : { name: 'round_points' });
  };

  return (
    <div>
      <SHeader title={existing ? 'Изменить точку' : 'Новая точка обхода'} onBack={goBack} />

      <div style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
        <EditField label="Название точки *" value={form.name} onChange={v => upd({ name: v })} error={errors.name} placeholder="Название кофейни / заведения" />
        <EditField label="Адрес" value={form.address} onChange={v => upd({ address: v })} placeholder="Улица, дом" multiline />
        <EditField label="Телефон / контакт" value={form.phone} onChange={v => upd({ phone: v })} placeholder="+7 777 123 45 67" />

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--mc-muted)', marginBottom: 6 }}>Город</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['almaty', 'Алматы'], ['region', 'Регион']].map(([v, l]) => (
              <button key={v} onClick={() => upd({ city: v })}
                style={{ flex: 1, padding: '8px 4px', background: form.city === v ? '#297b8a' : 'var(--mc-active-item)', color: form.city === v ? '#fff' : 'var(--mc-muted)', border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                {l}
              </button>
            ))}
          </div>
        </div>

        {canManage && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--mc-muted)', marginBottom: 6 }}>Статус</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[['prospect', 'Новая точка'], ['partner', 'Партнёр']].map(([v, l]) => (
                <button key={v} onClick={() => upd({ status: v })}
                  style={{ flex: 1, padding: '8px 4px', background: form.status === v ? '#297b8a' : 'var(--mc-active-item)', color: form.status === v ? '#fff' : 'var(--mc-muted)', border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        )}

        <EditField label="Заметки" value={form.notes} onChange={v => upd({ notes: v })} placeholder="Любая доп. информация" multiline />
      </div>

      {canManage && (
        <div style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 10 }}>Закрепление</div>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--mc-muted)', display: 'block', marginBottom: 3 }}>Бариста</label>
          <select value={form.responsible_barista_id || ''} onChange={e => upd({ responsible_barista_id: e.target.value })}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--mc-border)', borderRadius: 8, fontSize: 13, marginBottom: 10, background: 'var(--mc-surface)', color: 'var(--mc-text)' }}>
            <option value="">— не закреплён —</option>
            {baristas.map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
          </select>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--mc-muted)', display: 'block', marginBottom: 3 }}>Техник</label>
          <select value={form.responsible_technician_id || ''} onChange={e => upd({ responsible_technician_id: e.target.value })}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--mc-border)', borderRadius: 8, fontSize: 13, background: 'var(--mc-surface)', color: 'var(--mc-text)' }}>
            <option value="">— не закреплён —</option>
            {technicians.map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
          </select>
        </div>
      )}

      <button onClick={handleSave} disabled={saving}
        style={{ width: '100%', padding: '13px', borderRadius: 10, fontWeight: 700, color: '#fff', background: '#297b8a', border: 'none', cursor: saving ? 'default' : 'pointer', opacity: saving ? .6 : 1 }}>
        {saving ? 'Сохранение...' : 'Сохранить'}
      </button>
    </div>
  );
}
