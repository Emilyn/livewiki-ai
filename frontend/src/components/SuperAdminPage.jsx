import { useState, useEffect } from 'react'
import { superAdminListOrgs, superAdminListUsers, superAdminDeleteOrg, superAdminPromote, superAdminDemote } from '../api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

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
    <div className="flex items-center gap-3.5 rounded-xl border border-border bg-card px-5 py-4">
      <div className="h-9 w-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shrink-0 text-indigo-500">
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold leading-none">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </div>
    </div>
  )
}

export default function SuperAdminPage({ user: currentUser, onToast }) {
  const [orgs, setOrgs] = useState(null)
  const [users, setUsers] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('orgs')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [togglingAdmin, setTogglingAdmin] = useState(null)

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
    <div className="flex h-[60vh] items-center justify-center">
      <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-border border-t-primary" />
    </div>
  )

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div>
        <h2 className="font-bold text-lg">Super Admin</h2>
        <p className="text-sm text-muted-foreground">System-wide management dashboard</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard icon={<IconOrg size={18} />} label="Total Organizations" value={orgs?.length ?? 0} />
        <StatCard icon={<IconUser size={18} />} label="Total Users" value={users?.length ?? 0} />
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 border-b border-border">
        {[
          { id: 'orgs',  label: `Organizations (${orgs?.length ?? 0})` },
          { id: 'users', label: `Users (${users?.length ?? 0})` },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={cn(
              'px-3.5 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === t.id
                ? 'border-indigo-500 text-indigo-500'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Orgs tab */}
      {activeTab === 'orgs' && (
        <div className="space-y-1.5">
          {orgs?.length === 0 && <p className="text-sm text-muted-foreground py-4">No organizations found.</p>}
          {orgs?.map(org => (
            <div key={org.id} className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
              <div className="h-7 w-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shrink-0 text-indigo-500">
                <IconOrg size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {org.name}
                  {org.is_personal && (
                    <Badge variant="secondary" className="ml-2 text-[10px]">personal</Badge>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {org.member_count} members · created {new Date(org.created_at).toLocaleDateString()}
                </p>
              </div>
              {confirmDelete === org.id ? (
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground">Delete?</span>
                  <Button size="xs" variant="destructive" onClick={() => handleDelete(org.id)}>Yes</Button>
                  <Button size="xs" variant="outline" onClick={() => setConfirmDelete(null)}>No</Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  disabled={org.is_personal}
                  title={org.is_personal ? 'Cannot delete personal orgs' : 'Delete organization'}
                  onClick={() => setConfirmDelete(org.id)}
                >
                  <IconTrash />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Users tab */}
      {activeTab === 'users' && (
        <div className="space-y-1.5">
          {users?.length === 0 && <p className="text-sm text-muted-foreground py-4">No users found.</p>}
          {users?.map(u => (
            <div key={u.id} className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5">
              {u.avatar_url
                ? <img src={u.avatar_url} alt={u.name} referrerPolicy="no-referrer" className="h-7 w-7 rounded-full object-cover shrink-0" />
                : <div className="h-7 w-7 rounded-full bg-indigo-500 flex items-center justify-center text-xs font-bold text-white shrink-0">
                    {u.name?.[0]?.toUpperCase() ?? '?'}
                  </div>
              }
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{u.name}</span>
                  {u.id === currentUser?.id && <span className="text-xs text-muted-foreground">(you)</span>}
                  {u.is_super_admin && (
                    <Badge className="text-[10px] bg-indigo-500/10 text-indigo-500 border border-indigo-500/20 hover:bg-indigo-500/10">super admin</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{u.email}</p>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                Joined {new Date(u.created_at).toLocaleDateString()}
              </span>
              <Button
                size="xs"
                variant={u.is_super_admin ? 'destructive' : 'outline'}
                onClick={() => handleToggleAdmin(u)}
                disabled={togglingAdmin === u.id || u.id === currentUser?.id}
                title={u.id === currentUser?.id ? 'Cannot change your own role' : u.is_super_admin ? 'Remove super admin' : 'Make super admin'}
                className={cn(
                  'shrink-0',
                  !u.is_super_admin && 'text-indigo-500 border-indigo-500/30 hover:bg-indigo-500/10'
                )}
              >
                {togglingAdmin === u.id ? '…' : u.is_super_admin ? 'Revoke' : 'Make Admin'}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
