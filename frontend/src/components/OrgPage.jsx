import { useState, useEffect, useCallback } from 'react'
import {
  listOrgs, getOrg, inviteToOrg, removeOrgMember,
  changeOrgMemberRole, cancelOrgInvite, getOrgWikis
} from '../api'

// ── Icons ─────────────────────────────────────────────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────────────────────────
const ROLE_COLORS = {
  admin: { bg: 'rgba(99,102,241,0.12)', color: 'var(--accent)', border: 'rgba(99,102,241,0.25)' },
  user:  { bg: 'rgba(148,163,184,0.1)', color: 'var(--muted)',  border: 'var(--border)' },
}

function RoleBadge({ role }) {
  const c = ROLE_COLORS[role] || ROLE_COLORS.user
  return (
    <span style={{ fontSize: '0.6875rem', fontWeight: 600, padding: '0.15rem 0.45rem',
      borderRadius: 4, background: c.bg, color: c.color, border: `1px solid ${c.border}`, textTransform: 'capitalize' }}>
      {role}
    </span>
  )
}

function Avatar({ user }) {
  if (user.avatar_url) {
    return <img src={user.avatar_url} alt={user.name} referrerPolicy="no-referrer"
      style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  }
  return (
    <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--accent)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '0.75rem', fontWeight: 700, color: '#fff', flexShrink: 0 }}>
      {user.name?.[0]?.toUpperCase() ?? '?'}
    </div>
  )
}

// ── Members tab ───────────────────────────────────────────────────────────────
function MembersTab({ orgId, orgDetail, myRole, ownerId, currentUserId, onRefresh, onToast }) {
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteResult, setInviteResult] = useState(null) // { status, token, link }

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Invite form (admin only) */}
      {isAdmin && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '1rem' }}>
          <div style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.625rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <IconMail /> Invite by email
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              type="email"
              placeholder="user@example.com"
              value={inviteEmail}
              onChange={e => { setInviteEmail(e.target.value); setInviteResult(null) }}
              onKeyDown={e => e.key === 'Enter' && handleInvite()}
              style={{ flex: 1, fontSize: '0.8125rem' }}
            />
            <button
              onClick={handleInvite}
              disabled={inviting || !inviteEmail.trim()}
              style={{ padding: '0.45rem 1rem', fontSize: '0.8125rem', fontWeight: 600,
                background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6,
                cursor: inviting || !inviteEmail.trim() ? 'not-allowed' : 'pointer',
                opacity: inviting || !inviteEmail.trim() ? 0.6 : 1 }}>
              {inviting ? '…' : 'Invite'}
            </button>
          </div>
          {inviteResult && (
            <div style={{ marginTop: '0.625rem', padding: '0.625rem 0.75rem', background: 'rgba(16,185,129,0.08)',
              border: '1px solid rgba(16,185,129,0.25)', borderRadius: 6, fontSize: '0.8rem' }}>
              <div style={{ color: '#10b981', fontWeight: 600, marginBottom: '0.25rem' }}>
                {inviteResult.status === 'pending' ? 'Invite already pending' : 'Invite link created'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexWrap: 'wrap' }}>
                <code style={{ fontSize: '0.75rem', color: 'var(--muted)', wordBreak: 'break-all', flex: 1 }}>
                  {inviteResult.link}
                </code>
                <button
                  onClick={() => { navigator.clipboard.writeText(inviteResult.link); onToast('Link copied') }}
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center',
                    gap: '0.25rem', background: 'var(--surface2)', border: '1px solid var(--border)',
                    borderRadius: 4, cursor: 'pointer', color: 'var(--text)', flexShrink: 0 }}>
                  <IconCopy /> Copy
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Members list */}
      <div>
        <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Members ({orgDetail.members.length})
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
          {orgDetail.members.map(m => (
            <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem',
              padding: '0.5rem 0.75rem', background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 8 }}>
              <Avatar user={m} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.875rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.name}
                  {m.user_id === currentUserId && <span style={{ fontSize: '0.7rem', color: 'var(--muted)', marginLeft: 6 }}>(you)</span>}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</div>
              </div>
              <RoleBadge role={m.role} />
              {isAdmin && m.user_id !== ownerId && m.user_id !== currentUserId && (
                <div style={{ display: 'flex', gap: '0.375rem', flexShrink: 0 }}>
                  <select
                    value={m.role}
                    onChange={e => handleRoleChange(m.user_id, e.target.value)}
                    style={{ fontSize: '0.75rem', padding: '0.2rem 0.4rem', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)' }}>
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                  <button
                    onClick={() => handleRemove(m.user_id)}
                    title="Remove member"
                    style={{ padding: '0.25rem', background: 'transparent', border: '1px solid var(--border)',
                      borderRadius: 4, cursor: 'pointer', color: 'var(--muted)', display: 'flex', alignItems: 'center' }}>
                    <IconTrash />
                  </button>
                </div>
              )}
              {/* Non-admin can remove themselves (unless owner) */}
              {!isAdmin && m.user_id === currentUserId && m.user_id !== ownerId && (
                <button
                  onClick={() => handleRemove(m.user_id)}
                  title="Leave org"
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', background: 'transparent',
                    border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', color: 'var(--muted)' }}>
                  Leave
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Pending invites (admin only) */}
      {isAdmin && orgDetail.invites?.length > 0 && (
        <div>
          <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Pending Invites ({orgDetail.invites.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {orgDetail.invites.map(inv => (
              <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem',
                padding: '0.5rem 0.75rem', background: 'var(--surface)', border: '1px dashed var(--border)',
                borderRadius: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--surface2)',
                  border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <IconMail size={13} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>{inv.email}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                    Invited by {inv.invited_by} · expires {new Date(inv.expires_at).toLocaleDateString()}
                  </div>
                </div>
                <span style={{ fontSize: '0.6875rem', padding: '0.15rem 0.45rem', borderRadius: 4,
                  background: 'rgba(234,179,8,0.1)', color: '#ca8a04', border: '1px solid rgba(234,179,8,0.25)' }}>
                  pending
                </span>
                <button
                  onClick={() => {
                    const link = `${window.location.origin}/invite/${inv.token}`
                    navigator.clipboard.writeText(link)
                    onToast('Link copied')
                  }}
                  title="Copy invite link"
                  style={{ padding: '0.25rem', background: 'transparent', border: '1px solid var(--border)',
                    borderRadius: 4, cursor: 'pointer', color: 'var(--muted)', display: 'flex', alignItems: 'center' }}>
                  <IconCopy />
                </button>
                <button
                  onClick={() => handleCancelInvite(inv.id)}
                  title="Cancel invite"
                  style={{ padding: '0.25rem', background: 'transparent', border: '1px solid var(--border)',
                    borderRadius: 4, cursor: 'pointer', color: 'var(--muted)', display: 'flex', alignItems: 'center' }}>
                  <IconTrash />
                </button>
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
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--muted)', fontSize: '0.875rem' }}>
      <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Loading wikis…
    </div>
  )

  if (!wikis?.length) return (
    <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '0.875rem', padding: '2rem' }}>
      No wikis have been generated yet in this org.
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
      {wikis.map(w => (
        <div key={`${w.owner_id}-${w.slug}`} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem',
          padding: '0.625rem 0.875rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <IconBook size={16} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.875rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {w.repo}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
              {w.branch} · by {w.owner_name} · {w.pages?.length ?? 0} pages
            </div>
          </div>
          {w.share_token && (
            <a
              href={`/share/${w.share_token}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', fontWeight: 500,
                padding: '0.3rem 0.625rem', background: 'var(--surface2)', border: '1px solid var(--border)',
                borderRadius: 5, color: 'var(--text)', textDecoration: 'none' }}>
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
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--muted)', padding: '1.5rem' }}>
      <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Loading…
    </div>
  )
  if (!orgDetail) return null

  const tabs = [
    { id: 'members', label: `Members (${orgDetail.members.length})` },
    { id: 'wikis',   label: 'Wikis' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minWidth: 0 }}>
      {/* Org header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(99,102,241,0.1)',
          border: '1px solid rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <IconOrg size={18} />
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1rem' }}>{orgDetail.org.name}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
            Created {new Date(orgDetail.org.created_at).toLocaleDateString()} · <RoleBadge role={orgDetail.role} />
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.125rem' }}>
        {tabs.map(t => (
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
      {activeTab === 'wikis' && (
        <WikisTab orgId={org.id} onToast={onToast} />
      )}
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
        if (data.length > 0 && !selectedOrgId) {
          setSelectedOrgId(data[0].id)
        }
      })
      .catch(() => onToast('Failed to load organizations', 'error'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadOrgs() }, [loadOrgs])

  const selectedOrg = orgs?.find(o => o.id === selectedOrgId)

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <span className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
    </div>
  )

  if (!orgs?.length) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', flexDirection: 'column', gap: '0.75rem', color: 'var(--muted)' }}>
      <IconOrg size={36} />
      <div style={{ fontSize: '0.9rem' }}>No organizations yet.</div>
    </div>
  )

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0, gap: 0 }}>
      {/* Org sidebar */}
      <aside style={{ width: 220, flexShrink: 0, borderRight: '1px solid var(--border)', overflowY: 'auto',
        display: 'flex', flexDirection: 'column', padding: '0.75rem 0.5rem', gap: '0.25rem' }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase',
          letterSpacing: '0.07em', padding: '0.25rem 0.625rem', marginBottom: '0.25rem' }}>
          Organizations
        </div>
        {orgs.map(org => (
          <button
            key={org.id}
            onClick={() => setSelectedOrgId(org.id)}
            style={{
              width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
              padding: '0.5rem 0.625rem', borderRadius: 6, fontSize: '0.8125rem',
              background: selectedOrgId === org.id ? 'rgba(99,102,241,0.1)' : 'transparent',
              color: selectedOrgId === org.id ? 'var(--accent)' : 'var(--text)',
              border: `1px solid ${selectedOrgId === org.id ? 'rgba(99,102,241,0.25)' : 'transparent'}`,
              cursor: 'pointer', textAlign: 'left', transition: 'all 0.12s',
            }}>
            <div style={{ fontWeight: selectedOrgId === org.id ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
              {org.name}
            </div>
            <div style={{ display: 'flex', gap: '0.375rem', marginTop: '0.125rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.6875rem', color: 'var(--muted)' }}>{org.member_count} members</span>
              <RoleBadge role={org.role} />
            </div>
          </button>
        ))}
      </aside>

      {/* Detail area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 2rem' }}>
        {selectedOrg
          ? <OrgDetail key={selectedOrg.id} org={selectedOrg} currentUserId={user.id} onToast={onToast} />
          : <div style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>Select an organization</div>
        }
      </div>
    </div>
  )
}
