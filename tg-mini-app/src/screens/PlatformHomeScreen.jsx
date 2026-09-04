import React, { useEffect, useState } from 'react';
import { Building2, Users, AlertTriangle, Mail, ChevronRight, CalendarClock, ShieldAlert } from 'lucide-react';
import { supabase } from '../supabase/client';
import { ALL_MODULES } from '../modules';
import { daysUntil, trialBadge } from './OrgManagementScreen';

// ═══════════════════════════════════════════════════════════════════════════
// PlatformHomeScreen — сводка для супер-админа: что требует внимания прямо
// сейчас (истекающие подписки, нерешённые ошибки, непрочитанные сообщения),
// без необходимости обходить каждый раздел платформы по отдельности.
// ═══════════════════════════════════════════════════════════════════════════

function StatCard({ icon: Icon, label, value, tone, onClick }) {
  const toneColor = tone === 'danger' ? '#EB5757' : tone === 'warning' ? '#D97706' : '#297b8a';
  return (
    <button onClick={onClick} disabled={!onClick}
      className="rounded-xl p-4 text-left flex-1 min-w-[140px]"
      style={{ background: 'var(--mc-bg)', border: '1px solid var(--mc-border)', cursor: onClick ? 'pointer' : 'default' }}>
      <div className="flex items-center gap-2 mb-2" style={{ color: toneColor }}>
        <Icon size={16} />
      </div>
      <div className="text-2xl font-bold" style={{ color: 'var(--mc-text)' }}>{value}</div>
      <div className="text-xs mt-0.5" style={{ color: 'var(--mc-muted)' }}>{label}</div>
    </button>
  );
}

export default function PlatformHomeScreen({ ctx }) {
  const { organizations, currentUser, db, navigate } = ctx;
  const [unresolvedErrors, setUnresolvedErrors] = useState(null);
  const [activeFeedback, setActiveFeedback] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // "Активные" — то же определение, что и вкладка "Активные" в AdminFeedbackScreen
      // (всё, что ещё не ушло в архив), а не read/unread — это разные, не связанные поля.
      const [{ count: errCount }, { count: fbCount }] = await Promise.all([
        supabase.from('error_reports').select('id', { count: 'exact', head: true }).eq('resolved', false),
        supabase.from('feedback_messages').select('id', { count: 'exact', head: true }).neq('status', 'archived'),
      ]);
      if (!cancelled) {
        setUnresolvedErrors(errCount ?? 0);
        setActiveFeedback(fbCount ?? 0);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!currentUser?.is_super_admin) {
    return (
      <div className="p-6 text-center" style={{ color: 'var(--mc-muted)' }}>
        Доступ запрещён. Только для супер-администратора.
      </div>
    );
  }

  const userCounts = {};
  (db.users || []).forEach(u => {
    if (u.active !== false) {
      const oid = u.org_id || 'none';
      userCounts[oid] = (userCounts[oid] || 0) + 1;
    }
  });
  const totalUsers = Object.values(userCounts).reduce((s, n) => s + n, 0);

  const attentionOrgs = organizations
    .map(o => ({ org: o, days: daysUntil(o.trial_ends_at), badge: trialBadge(o.trial_ends_at) }))
    .filter(o => (o.days !== null && o.days <= 7) || !o.org.is_active)
    .sort((a, b) => (a.days ?? -Infinity) - (b.days ?? -Infinity));

  const inactiveCount = organizations.filter(o => !o.is_active).length;

  return (
    <div className="p-4 lg:p-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold" style={{ color: 'var(--mc-text)' }}>Обзор платформы</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--mc-muted)' }}>Что требует внимания прямо сейчас</p>
      </div>

      <div className="flex flex-wrap gap-3 mb-6">
        <StatCard icon={Building2} label={`организаций (${organizations.filter(o => o.is_active).length} активных)`}
          value={organizations.length} onClick={() => navigate({ name: 'platform_orgs' })} />
        <StatCard icon={Users} label="активных пользователей" value={totalUsers} onClick={() => navigate({ name: 'platform_users' })} />
        <StatCard icon={AlertTriangle} label="нерешённых ошибок" value={unresolvedErrors ?? '…'}
          tone={unresolvedErrors > 0 ? 'danger' : undefined} onClick={() => navigate({ name: 'platform_errors' })} />
        <StatCard icon={Mail} label="активных сообщений от сотрудников" value={activeFeedback ?? '…'}
          tone={activeFeedback > 0 ? 'warning' : undefined} onClick={() => navigate({ name: 'admin_feedback' })} />
      </div>

      <div className="rounded-xl p-4" style={{ background: 'var(--mc-bg)', border: '1px solid var(--mc-border)' }}>
        <div className="flex items-center gap-2 mb-3">
          <ShieldAlert size={16} style={{ color: '#D97706' }} />
          <div className="text-sm font-semibold" style={{ color: 'var(--mc-text)' }}>Организации, требующие внимания</div>
        </div>

        {attentionOrgs.length === 0 ? (
          <div className="text-sm py-4 text-center" style={{ color: 'var(--mc-muted)' }}>
            Всё в порядке — ни у одной организации не истекает подписка в ближайшие 7 дней{inactiveCount > 0 ? '' : ' и все активны'}.
          </div>
        ) : (
          <div className="space-y-1.5">
            {attentionOrgs.map(({ org, badge }) => {
              const modCount = Array.isArray(org.enabled_modules) ? org.enabled_modules.length : ALL_MODULES.length;
              const uCount = userCounts[org.id] || 0;
              return (
                <button key={org.id} onClick={() => navigate({ name: 'platform_orgs' })}
                  className="w-full flex items-center gap-3 p-2.5 rounded-lg text-left"
                  style={{ background: 'var(--mc-active-item)' }}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold truncate" style={{ color: 'var(--mc-text)' }}>{org.name}</span>
                      {!org.is_active && (
                        <span className="text-[10px] font-semibold rounded-full px-1.5 py-0.5" style={{ background: 'var(--mc-danger-bg)', color: '#EB5757' }}>
                          неактивна
                        </span>
                      )}
                      {badge && (
                        <span className="text-[10px] font-semibold rounded-full px-1.5 py-0.5 flex items-center gap-1" style={{ background: badge.bg, color: badge.color }}>
                          <CalendarClock size={9} /> {badge.label}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] mt-0.5" style={{ color: 'var(--mc-muted)' }}>
                      {uCount} польз. · {modCount}/{ALL_MODULES.length} модулей
                    </div>
                  </div>
                  <ChevronRight size={14} style={{ color: 'var(--mc-muted)' }} />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
