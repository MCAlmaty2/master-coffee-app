import React, { useState, useMemo } from 'react';
import { Users, Building2, ChevronDown, Search, Filter, Shield, ShieldCheck } from 'lucide-react';
import { supabase } from '../supabase/client';

export default function PlatformUsersScreen({ ctx }) {
  const { db, organizations, currentUser, showToast, updateUserOrg, updateUserRole } = ctx;
  const [filterOrg, setFilterOrg] = useState('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmAdmin, setConfirmAdmin] = useState(null);

  if (!currentUser?.is_super_admin) {
    return (
      <div className="p-6 text-center" style={{ color: 'var(--mc-muted)' }}>
        Доступ запрещён. Только для супер-администратора.
      </div>
    );
  }

  const allUsers = db.users || [];
  const roleDefinitions = db.roleDefinitions || [];

  const filtered = useMemo(() => {
    let list = allUsers;
    if (filterOrg !== 'all') {
      list = list.filter(u => u.org_id === filterOrg);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(u =>
        (u.first_name || '').toLowerCase().includes(q) ||
        (u.last_name || '').toLowerCase().includes(q) ||
        (u.tg_username || '').toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return (a.first_name || '').localeCompare(b.first_name || '');
    });
  }, [allUsers, filterOrg, search]);

  const orgCounts = useMemo(() => {
    const counts = {};
    allUsers.forEach(u => {
      const oid = u.org_id || 'none';
      counts[oid] = (counts[oid] || 0) + 1;
    });
    return counts;
  }, [allUsers]);

  const handleOrgChange = async (userId, newOrgId) => {
    setSaving(true);
    const res = await updateUserOrg(userId, newOrgId);
    if (res?.error) showToast(res.error, 'error');
    else showToast('Организация пользователя изменена');
    setSaving(false);
  };

  const handleRoleChange = async (userId, newRole) => {
    if (newRole === 'admin') {
      setConfirmAdmin(userId);
      return;
    }
    setSaving(true);
    const res = await updateUserRole(userId, newRole);
    if (res?.error) showToast(res.error, 'error');
    else showToast('Роль изменена');
    setSaving(false);
  };

  const confirmAdminAssign = async () => {
    if (!confirmAdmin) return;
    setSaving(true);
    const res = await updateUserRole(confirmAdmin, 'admin');
    if (res?.error) showToast(res.error, 'error');
    else showToast('Назначен администратором организации');
    setConfirmAdmin(null);
    setSaving(false);
  };

  const getOrgName = (orgId) => {
    const org = organizations.find(o => o.id === orgId);
    return org?.name || 'Без организации';
  };

  const getRoleLabel = (user) => {
    if (!user.role) return 'Без роли';
    const rd = roleDefinitions.find(r => r.key === user.role);
    return rd?.short || rd?.label || user.role;
  };

  const getRoleColor = (user) => {
    const rd = roleDefinitions.find(r => r.key === user.role);
    return rd?.color || '#A8A8AE';
  };

  const assignableRoles = roleDefinitions.filter(r => r.key !== 'pending');

  const confirmUser = confirmAdmin ? allUsers.find(u => u.id === confirmAdmin) : null;

  return (
    <div className="p-4 lg:p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold" style={{ color: 'var(--mc-text)' }}>Все пользователи</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--mc-muted)' }}>
          {allUsers.length} пользователей · {organizations.length} организаций
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex-1 min-w-[200px] relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--mc-muted)' }} />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по имени или username..."
            className="w-full rounded-lg border pl-9 pr-3 py-2 text-sm"
            style={{ background: 'var(--mc-bg)', color: 'var(--mc-text)', borderColor: 'var(--mc-border)' }}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Filter size={14} style={{ color: 'var(--mc-muted)' }} />
          <select
            value={filterOrg} onChange={e => setFilterOrg(e.target.value)}
            className="rounded-lg border px-2 py-2 text-sm font-semibold"
            style={{ background: 'var(--mc-bg)', color: 'var(--mc-text)', borderColor: 'var(--mc-border)' }}
          >
            <option value="all">Все организации ({allUsers.length})</option>
            {organizations.map(o => (
              <option key={o.id} value={o.id}>{o.name} ({orgCounts[o.id] || 0})</option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        {filtered.map(user => {
          const expanded = expandedId === user.id;
          const roleColor = getRoleColor(user);
          const isCurrentUser = user.id === currentUser.id;
          return (
            <div key={user.id} className="rounded-xl p-3" style={{ background: 'var(--mc-bg)', border: '1px solid var(--mc-border)', opacity: user.active === false ? 0.6 : 1 }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 overflow-hidden"
                  style={{ background: roleColor }}>
                  {user.photo_url
                    ? <img src={user.photo_url} alt="" className="w-full h-full object-cover" />
                    : (user.first_name?.[0] || '?')
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate" style={{ color: 'var(--mc-text)' }}>
                    {user.first_name} {user.last_name}
                    {user.is_super_admin && (
                      <ShieldCheck size={12} className="inline ml-1" style={{ color: '#297b8a', verticalAlign: 'middle' }} />
                    )}
                  </div>
                  <div className="text-xs truncate" style={{ color: 'var(--mc-muted)' }}>
                    {user.tg_username ? `@${user.tg_username}` : user.telegram_id}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                  <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap"
                    style={{ background: `${roleColor}20`, color: roleColor }}>
                    {getRoleLabel(user)}
                  </span>
                  <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap"
                    style={{ background: 'var(--mc-active-item)', color: 'var(--mc-muted)' }}>
                    {getOrgName(user.org_id)}
                  </span>
                  {!user.active && (
                    <span className="text-[10px] font-semibold rounded-full px-2 py-0.5"
                      style={{ background: 'var(--mc-danger-bg)', color: '#EB5757' }}>откл.</span>
                  )}
                  <button onClick={() => setExpandedId(expanded ? null : user.id)}
                    className="p-1" style={{ color: 'var(--mc-muted)' }}>
                    <ChevronDown size={14} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                  </button>
                </div>
              </div>

              {expanded && (
                <div className="mt-3 pt-3 space-y-2" style={{ borderTop: '1px solid var(--mc-border)' }}>
                  <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: 'var(--mc-active-item)' }}>
                    <Building2 size={14} style={{ color: 'var(--mc-muted)', flexShrink: 0 }} />
                    <span className="text-xs font-semibold" style={{ color: 'var(--mc-text)', flexShrink: 0 }}>Организация:</span>
                    <select
                      value={user.org_id || ''}
                      onChange={e => handleOrgChange(user.id, e.target.value)}
                      disabled={saving || isCurrentUser}
                      className="flex-1 rounded-md border px-2 py-1 text-xs"
                      style={{ background: 'var(--mc-bg)', color: 'var(--mc-text)', borderColor: 'var(--mc-border)' }}
                    >
                      {organizations.map(o => (
                        <option key={o.id} value={o.id}>{o.name}{o.is_demo ? ' (demo)' : ''}</option>
                      ))}
                    </select>
                  </div>
                  {!isCurrentUser && (
                    <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: 'var(--mc-active-item)' }}>
                      <Shield size={14} style={{ color: 'var(--mc-muted)', flexShrink: 0 }} />
                      <span className="text-xs font-semibold" style={{ color: 'var(--mc-text)', flexShrink: 0 }}>Роль:</span>
                      <select
                        value={user.role || ''}
                        onChange={e => handleRoleChange(user.id, e.target.value)}
                        disabled={saving}
                        className="flex-1 rounded-md border px-2 py-1 text-xs"
                        style={{ background: 'var(--mc-bg)', color: 'var(--mc-text)', borderColor: 'var(--mc-border)' }}
                      >
                        {assignableRoles.map(r => (
                          <option key={r.key} value={r.key}>
                            {r.label || r.key}{r.key === 'admin' ? ' (Администратор орг.)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-xs" style={{ color: 'var(--mc-muted)' }}>
                    <div>ID: <span className="mono-font">{user.id.slice(0, 8)}…</span></div>
                    <div>Telegram: <span className="mono-font">{user.telegram_id}</span></div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center py-8 text-sm" style={{ color: 'var(--mc-muted)' }}>
            Пользователи не найдены
          </div>
        )}
      </div>

      {confirmUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="rounded-2xl p-6 max-w-sm w-full mx-4" style={{ background: 'var(--mc-bg)', border: '1px solid var(--mc-border)' }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: '#297b8a20' }}>
                <ShieldCheck size={20} style={{ color: '#297b8a' }} />
              </div>
              <div>
                <div className="font-bold text-sm" style={{ color: 'var(--mc-text)' }}>Назначить администратором?</div>
                <div className="text-xs" style={{ color: 'var(--mc-muted)' }}>Это действие даёт полный доступ</div>
              </div>
            </div>
            <div className="rounded-lg p-3 mb-4" style={{ background: 'var(--mc-active-item)' }}>
              <div className="font-semibold text-sm" style={{ color: 'var(--mc-text)' }}>
                {confirmUser.first_name} {confirmUser.last_name}
              </div>
              <div className="text-xs" style={{ color: 'var(--mc-muted)' }}>
                {getOrgName(confirmUser.org_id)} · {confirmUser.tg_username ? `@${confirmUser.tg_username}` : confirmUser.telegram_id}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setConfirmAdmin(null)}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold"
                style={{ color: 'var(--mc-muted)', background: 'var(--mc-active-item)' }}>
                Отмена
              </button>
              <button onClick={confirmAdminAssign} disabled={saving}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold text-white"
                style={{ background: '#297b8a', opacity: saving ? 0.6 : 1 }}>
                Назначить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
