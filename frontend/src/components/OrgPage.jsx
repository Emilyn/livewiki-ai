import { useState, useEffect, useCallback } from 'react'
import {
  listOrgs, getOrg, inviteToOrg, removeOrgMember,
  changeOrgMemberRole, cancelOrgInvite, getOrgWikis
} from '../api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

function IconOrg({ size = 16 }) {
  return <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
}
function IconBook({ size = 14 }) {
  return <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>
}
function IconTrash({ size = 14 }) {
  return <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
}
function IconMail({ size = 14 }) {
  return <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
}
function IconExternal({ size = 13 }) {
  return <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
}
function IconCopy({ size = 13 }) {
  return <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
}

function RoleBadge({ role }) {
  return (
    <Badge
      variant={role === 'admin' ? 'default' : 'secondary'}
      className={role === 'admin' ? 'bg-indigo-500/10 text-indigo-500 border border-indigo-500/20 hover:bg-indigo-500/10' : ''}
    >
      {role}
    </Badge>
  )
}

function Avatar({ user }) {
  if (user.avatar_url) {
    return <img src={user.avatar_url} alt={user.name} referrerPolicy="no-referrer" className="h-7 w-7 rounded-full object-cover shrink-0" />
  }
  return (
    <div className="h-7 w-7 rounded-full bg-indigo-500 flex items-center justify-center text-xs font-bold text-white shrink-0">
      {user.name?.[0]?.toUpperCase() ?? '?'}
    </div>
  )
}

// ── Members tab ───────────────────────────────────────────────────────────────
function MembersTab({ orgId, orgDetail, myRole, ownerId, currentUserId, onRefresh, onToast }) {
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteResult, setInviteResult] = useState(null)

  const isAdmin = myRole === 'admin'

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return
    setInviting(true)
    setInviteResult(null)
    try {
      const res = await inviteToOrg(orgId, inviteEmail.trim())
      if (res.status === 'added') {
        onToast('User added to org')
        setInviteEmail('')
        onRefresh()
      } else if (res.status === 'invited' || res.status === 'pending') {
        const link = `${window.location.origin}/invite/${res.token}`
        setInviteResult({ status: res.status, token: res.token, link })
      }
    } catch (e) {
      onToast(e?.response?.data?.error || 'Failed to invite user', 'error')
    } finally {
      setInviting(false)
    }
  }

  const handleRemove = async (uid) => {
    try {
      await removeOrgMember(orgId, uid)
      onToast('Member removed')
      onRefresh()
    } catch (e) {
      onToast(e?.response?.data?.error || 'Failed to remove member', 'error')
    }
  }

  const handleRoleChange = async (uid, role) => {
    try {
      await changeOrgMemberRole(orgId, uid, role)
      onToast('Role updated')
      onRefresh()
    } catch (e) {
      onToast(e?.response?.data?.error || 'Failed to update role', 'error')
    }
  }

  const handleCancelInvite = async (inviteId) => {
    try {
      await cancelOrgInvite(orgId, inviteId)
      onToast('Invite cancelled')
      onRefresh()
    } catch (e) {
      onToast('Failed to cancel invite', 'error')
    }
  }

  return (
    <div className="space-y-5">
      {/* Invite form (admin only) */}
      {isAdmin && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <p className="text-sm font-semibold flex items-center gap-1.5">
            <IconMail /> Invite by email
          </p>
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="user@example.com"
              value={inviteEmail}
              onChange={e => { setInviteEmail(e.target.value); setInviteResult(null) }}
              onKeyDown={e => e.key === 'Enter' && handleInvite()}
              className="flex-1"
            />
            <Button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()} size="sm">
              {inviting ? '…' : 'Invite'}
            </Button>
          </div>
          {inviteResult && (
            <div className="rounded-lg border border-green-500/25 bg-green-500/8 px-3 py-2.5 space-y-1.5">
              <p className="text-xs font-semibold text-green-600 dark:text-green-400">
                {inviteResult.status === 'pending' ? 'Invite already pending' : 'Invite link created'}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <code className="text-xs text-muted-foreground break-all flex-1">{inviteResult.link}</code>
                <Button
                  variant="outline"
                  size="xs"
                  className="shrink-0"
                  onClick={() => { navigator.clipboard.writeText(inviteResult.link); onToast('Link copied') }}
                >
                  <IconCopy /> Copy
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Members list */}
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">
          Members ({orgDetail.members.length})
        </p>
        <div className="space-y-1.5">
          {orgDetail.members.map(m => (
            <div key={m.user_id} className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2">
              <Avatar user={m} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {m.name}
                  {m.user_id === currentUserId && <span className="text-xs text-muted-foreground ml-1.5">(you)</span>}
                </p>
                <p className="text-xs text-muted-foreground truncate">{m.email}</p>
              </div>
              <RoleBadge role={m.role} />
              {isAdmin && m.user_id !== ownerId && m.user_id !== currentUserId && (
                <div className="flex gap-1.5 shrink-0">
                  <select
                    value={m.role}
                    onChange={e => handleRoleChange(m.user_id, e.target.value)}
                    className="h-6 rounded border border-input bg-background px-1.5 text-xs outline-none focus:border-ring dark:bg-input/30"
                  >
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    title="Remove member"
                    onClick={() => handleRemove(m.user_id)}
                  >
                    <IconTrash />
                  </Button>
                </div>
              )}
              {!isAdmin && m.user_id === currentUserId && m.user_id !== ownerId && (
                <Button variant="outline" size="xs" onClick={() => handleRemove(m.user_id)}>Leave</Button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Pending invites (admin only) */}
      {isAdmin && orgDetail.invites?.length > 0 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">
            Pending Invites ({orgDetail.invites.length})
          </p>
          <div className="space-y-1.5">
            {orgDetail.invites.map(inv => (
              <div key={inv.id} className="flex items-center gap-2.5 rounded-lg border border-dashed border-border bg-card px-3 py-2">
                <div className="h-7 w-7 rounded-full bg-muted border border-border flex items-center justify-center shrink-0 text-muted-foreground">
                  <IconMail size={13} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{inv.email}</p>
                  <p className="text-xs text-muted-foreground">
                    Invited by {inv.invited_by} · expires {new Date(inv.expires_at).toLocaleDateString()}
                  </p>
                </div>
                <Badge className="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20 hover:bg-yellow-500/10 text-[10px]">
                  pending
                </Badge>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title="Copy invite link"
                  onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/invite/${inv.token}`); onToast('Link copied') }}
                >
                  <IconCopy />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  title="Cancel invite"
                  onClick={() => handleCancelInvite(inv.id)}
                >
                  <IconTrash />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Wikis tab ─────────────────────────────────────────────────────────────────
function WikisTab({ orgId, onToast }) {
  const [wikis, setWikis] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getOrgWikis(orgId)
      .then(setWikis)
      .catch(() => onToast('Failed to load wikis', 'error'))
      .finally(() => setLoading(false))
  }, [orgId])

  if (loading) return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-primary" />
      Loading wikis…
    </div>
  )

  if (!wikis?.length) return (
    <p className="text-center text-sm text-muted-foreground py-8">No wikis have been generated yet in this org.</p>
  )

  return (
    <div className="space-y-1.5">
      {wikis.map(w => (
        <div key={`${w.owner_id}-${w.slug}`} className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
          <span className="text-muted-foreground shrink-0"><IconBook size={15} /></span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{w.repo}</p>
            <p className="text-xs text-muted-foreground">{w.branch} · by {w.owner_name} · {w.pages?.length ?? 0} pages</p>
          </div>
          {w.share_token && (
            <a
              href={`/share/${w.share_token}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors no-underline text-foreground shrink-0"
            >
              <IconExternal /> View
            </a>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Org detail panel ──────────────────────────────────────────────────────────
function OrgDetail({ org, currentUserId, onToast }) {
  const [orgDetail, setOrgDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('members')

  const load = useCallback(() => {
    setLoading(true)
    getOrg(org.id)
      .then(setOrgDetail)
      .catch(() => onToast('Failed to load org details', 'error'))
      .finally(() => setLoading(false))
  }, [org.id])

  useEffect(() => { load() }, [load])

  if (loading) return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" /> Loading…
    </div>
  )
  if (!orgDetail) return null

  const tabs = [
    { id: 'members', label: `Members (${orgDetail.members.length})` },
    { id: 'wikis',   label: 'Wikis' },
  ]

  return (
    <div className="space-y-4 min-w-0">
      {/* Org header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="h-9 w-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shrink-0 text-indigo-500">
          <IconOrg size={18} />
        </div>
        <div>
          <p className="font-bold">{orgDetail.org.name}</p>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            Created {new Date(orgDetail.org.created_at).toLocaleDateString()} · <RoleBadge role={orgDetail.role} />
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0.5 border-b border-border">
        {tabs.map(t => (
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

      {activeTab === 'members' && (
        <MembersTab
          orgId={org.id}
          orgDetail={orgDetail}
          myRole={orgDetail.role}
          ownerId={orgDetail.org.owner_id}
          currentUserId={currentUserId}
          onRefresh={load}
          onToast={onToast}
        />
      )}
      {activeTab === 'wikis' && <WikisTab orgId={org.id} onToast={onToast} />}
    </div>
  )
}

// ── Main OrgPage ──────────────────────────────────────────────────────────────
export default function OrgPage({ user, onToast }) {
  const [orgs, setOrgs] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedOrgId, setSelectedOrgId] = useState(null)

  const loadOrgs = useCallback(() => {
    listOrgs()
      .then(data => {
        setOrgs(data)
        if (data.length > 0 && !selectedOrgId) setSelectedOrgId(data[0].id)
      })
      .catch(() => onToast('Failed to load organizations', 'error'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadOrgs() }, [loadOrgs])

  const selectedOrg = orgs?.find(o => o.id === selectedOrgId)

  if (loading) return (
    <div className="flex h-[60vh] items-center justify-center">
      <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-border border-t-primary" />
    </div>
  )

  if (!orgs?.length) return (
    <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-muted-foreground">
      <IconOrg size={36} />
      <p className="text-sm">No organizations yet.</p>
    </div>
  )

  return (
    <div className="flex h-full min-h-0 -m-4 md:-m-6">
      {/* Org sidebar */}
      <aside className="w-52 shrink-0 border-r border-border overflow-y-auto flex flex-col p-2 gap-0.5">
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground px-2.5 py-1.5 mb-1">
          Organizations
        </p>
        {orgs.map(org => (
          <button
            key={org.id}
            onClick={() => setSelectedOrgId(org.id)}
            className={cn(
              'w-full flex flex-col items-start rounded-lg px-2.5 py-2 text-sm transition-colors text-left',
              selectedOrgId === org.id
                ? 'bg-indigo-500/10 text-indigo-500 border border-indigo-500/20'
                : 'text-foreground hover:bg-muted border border-transparent'
            )}
          >
            <span className={cn('font-medium truncate w-full', selectedOrgId === org.id ? 'font-semibold' : '')}>
              {org.name}
            </span>
            <span className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[11px] text-muted-foreground">{org.member_count} members</span>
              <RoleBadge role={org.role} />
            </span>
          </button>
        ))}
      </aside>

      {/* Detail area */}
      <div className="flex-1 overflow-y-auto p-6">
        {selectedOrg
          ? <OrgDetail key={selectedOrg.id} org={selectedOrg} currentUserId={user.id} onToast={onToast} />
          : <p className="text-sm text-muted-foreground">Select an organization</p>
        }
      </div>
    </div>
  )
}
