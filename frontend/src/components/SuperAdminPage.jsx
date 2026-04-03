import { useState, useEffect } from 'react'
import { superAdminListOrgs, superAdminListUsers, superAdminDeleteOrg, superAdminPromote, superAdminDemote } from '../api'

function IconOrg({ size = 16 }) {
  return <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
}
function IconUser({ size = 16 }) {
  return <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
}
function IconTrash({ size = 14 }) {
  return <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
}

function StatCard({ icon, label, value }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
      padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
      <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(99,102,241,0.1)',
        border: '1px solid rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: '1.375rem', fontWeight: 700, lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: 2 }}>{label}</div>
      </div>
    </div>
  )
}

export default function SuperAdminPage({ user: currentUser, onToast }) {
  const [orgs, setOrgs] = useState(null)
  const [users, setUsers] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('orgs')
  const [confirmDelete, setConfirmDelete] = useState(null) // orgId
  const [togglingAdmin, setTogglingAdmin] = useState(null) // uid

  const load = () => {
    setLoading(true)
    Promise.all([superAdminListOrgs(), superAdminListUsers()])
      .then(([o, u]) => { setOrgs(o); setUsers(u) })
      .catch(() => onToast('Failed to load super admin data', 'error'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleDelete = async (orgId) => {
    try {
      await superAdminDeleteOrg(orgId)
      onToast('Organization deleted')
      setConfirmDelete(null)
      load()
    } catch {
      onToast('Failed to delete organization', 'error')
    }
  }

  const handleToggleAdmin = async (u) => {
    setTogglingAdmin(u.id)
    try {
      if (u.is_super_admin) {
        await superAdminDemote(u.id)
        onToast(`${u.name} is no longer a super admin`)
      } else {
        await superAdminPromote(u.id)
        onToast(`${u.name} is now a super admin`)
      }
      load()
    } catch (e) {
      onToast(e?.response?.data?.error || 'Failed to update role', 'error')
    } finally {
      setTogglingAdmin(null)
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <span className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
    </div>
  )

  return (
    <div style={{ padding: '1.5rem 2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: 900 }}>
      {/* Header */}
      <div>
        <div style={{ fontWeight: 700, fontSize: '1.125rem', marginBottom: '0.25rem' }}>Super Admin</div>
        <div style={{ fontSize: '0.8125rem', color: 'var(--muted)' }}>System-wide management dashboard</div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
        <StatCard icon={<IconOrg size={18} />} label="Total Organizations" value={orgs?.length ?? 0} />
        <StatCard icon={<IconUser size={18} />} label="Total Users" value={users?.length ?? 0} />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.125rem' }}>
        {[{ id: 'orgs', label: `Organizations (${orgs?.length ?? 0})` }, { id: 'users', label: `Users (${users?.length ?? 0})` }].map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{ padding: '0.4rem 0.875rem', fontSize: '0.8125rem', fontWeight: activeTab === t.id ? 600 : 400,
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: activeTab === t.id ? 'var(--accent)' : 'var(--muted)',
              borderBottom: `2px solid ${activeTab === t.id ? 'var(--accent)' : 'transparent'}`,
              marginBottom: -1 }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Orgs table */}
      {activeTab === 'orgs' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
          {orgs?.length === 0 && (
            <div style={{ color: 'var(--muted)', fontSize: '0.875rem', padding: '1rem 0' }}>No organizations found.</div>
          )}
          {orgs?.map(org => (
            <div key={org.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem',
              padding: '0.625rem 0.875rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
              <div style={{ width: 30, height: 30, borderRadius: 7, background: 'rgba(99,102,241,0.1)',
                border: '1px solid rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <IconOrg size={15} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {org.name}
                  {org.is_personal && (
                    <span style={{ fontSize: '0.6875rem', marginLeft: 6, padding: '0.1rem 0.4rem', borderRadius: 4,
                      background: 'rgba(148,163,184,0.1)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                      personal
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                  {org.member_count} members · created {new Date(org.created_at).toLocaleDateString()}
                </div>
              </div>
              {confirmDelete === org.id ? (
                <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Delete?</span>
                  <button onClick={() => handleDelete(org.id)}
                    style={{ padding: '0.25rem 0.625rem', fontSize: '0.75rem', fontWeight: 600,
                      background: '#ef4444', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                    Yes
                  </button>
                  <button onClick={() => setConfirmDelete(null)}
                    style={{ padding: '0.25rem 0.625rem', fontSize: '0.75rem',
                      background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer' }}>
                    No
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(org.id)}
                  disabled={org.is_personal}
                  title={org.is_personal ? "Cannot delete personal orgs" : "Delete organization"}
                  style={{ padding: '0.3rem', background: 'transparent', border: '1px solid var(--border)',
                    borderRadius: 5, cursor: org.is_personal ? 'not-allowed' : 'pointer',
                    color: 'var(--muted)', opacity: org.is_personal ? 0.35 : 1,
                    display: 'flex', alignItems: 'center' }}>
                  <IconTrash />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Users table */}
      {activeTab === 'users' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
          {users?.length === 0 && (
            <div style={{ color: 'var(--muted)', fontSize: '0.875rem', padding: '1rem 0' }}>No users found.</div>
          )}
          {users?.map(u => (
            <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem',
              padding: '0.5rem 0.875rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
              {u.avatar_url
                ? <img src={u.avatar_url} alt={u.name} referrerPolicy="no-referrer"
                    style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                : <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--accent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.75rem', fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                    {u.name?.[0]?.toUpperCase() ?? '?'}
                  </div>
              }
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontWeight: 500, fontSize: '0.875rem' }}>{u.name}</span>
                  {u.id === currentUser?.id && (
                    <span style={{ fontSize: '0.6875rem', color: 'var(--muted)' }}>(you)</span>
                  )}
                  {u.is_super_admin && (
                    <span style={{ fontSize: '0.6875rem', fontWeight: 600, padding: '0.1rem 0.4rem', borderRadius: 4,
                      background: 'rgba(99,102,241,0.12)', color: 'var(--accent)', border: '1px solid rgba(99,102,241,0.25)' }}>
                      super admin
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{u.email}</div>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--muted)', flexShrink: 0 }}>
                Joined {new Date(u.created_at).toLocaleDateString()}
              </div>
              <button
                onClick={() => handleToggleAdmin(u)}
                disabled={togglingAdmin === u.id || u.id === currentUser?.id}
                title={u.id === currentUser?.id ? 'Cannot change your own role' : u.is_super_admin ? 'Remove super admin' : 'Make super admin'}
                style={{ padding: '0.3rem 0.625rem', fontSize: '0.75rem', fontWeight: 500, flexShrink: 0,
                  background: u.is_super_admin ? 'rgba(239,68,68,0.08)' : 'rgba(99,102,241,0.08)',
                  color: u.is_super_admin ? '#ef4444' : 'var(--accent)',
                  border: `1px solid ${u.is_super_admin ? 'rgba(239,68,68,0.25)' : 'rgba(99,102,241,0.25)'}`,
                  borderRadius: 5, cursor: (togglingAdmin === u.id || u.id === currentUser?.id) ? 'not-allowed' : 'pointer',
                  opacity: (togglingAdmin === u.id || u.id === currentUser?.id) ? 0.5 : 1 }}>
                {togglingAdmin === u.id ? '…' : u.is_super_admin ? 'Revoke' : 'Make Admin'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
