import { useState, useEffect } from 'react'
import { getInviteInfo, acceptInvite, authMe } from '../api'
import AuthPage from './AuthPage'

function IconOrg({ size = 36 }) {
  return <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
}

export default function InviteAcceptPage({ token }) {
  const [invite, setInvite] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [user, setUser] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [accepted, setAccepted] = useState(null) // { org_name }

  // Check auth
  useEffect(() => {
    const storedToken = localStorage.getItem('mdf_token')
    if (storedToken) {
      authMe()
        .then(u => { setUser(u); setAuthChecked(true) })
        .catch(() => { localStorage.removeItem('mdf_token'); setAuthChecked(true) })
    } else {
      setAuthChecked(true)
    }
  }, [])

  // Load invite info
  useEffect(() => {
    getInviteInfo(token)
      .then(setInvite)
      .catch(e => {
        const status = e?.response?.status
        if (status === 410) setError('This invite has already been used or has expired.')
        else if (status === 404) setError('This invite link is invalid.')
        else setError('Failed to load invite information.')
      })
      .finally(() => setLoading(false))
  }, [token])

  const handleAccept = async () => {
    setAccepting(true)
    try {
      const res = await acceptInvite(token)
      setAccepted({ org_name: res.org_name })
    } catch (e) {
      const status = e?.response?.status
      if (status === 410) setError('This invite has already been used or expired.')
      else if (status === 403) setError(e?.response?.data?.error || 'This invite was sent to a different email address.')
      else setError('Failed to accept invite.')
    } finally {
      setAccepting(false)
    }
  }

  // Outer shell
  const Shell = ({ children }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh',
      background: 'var(--bg)', padding: '2rem' }}>
      <div style={{ width: '100%', maxWidth: 420, background: 'var(--surface)',
        border: '1px solid var(--border)', borderRadius: 12, padding: '2rem',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.25rem', textAlign: 'center' }}>
        {children}
      </div>
    </div>
  )

  if (loading) return (
    <Shell>
      <span className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
      <div style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>Loading invite…</div>
    </Shell>
  )

  if (error) return (
    <Shell>
      <div style={{ color: 'var(--muted)' }}><IconOrg /></div>
      <div style={{ fontWeight: 700, fontSize: '1rem' }}>Invite unavailable</div>
      <div style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>{error}</div>
      <a href="/" style={{ fontSize: '0.875rem', color: 'var(--accent)', textDecoration: 'none' }}>Go to app →</a>
    </Shell>
  )

  if (accepted) return (
    <Shell>
      <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(16,185,129,0.1)',
        border: '1px solid rgba(16,185,129,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="#10b981" strokeWidth="2.5">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <div style={{ fontWeight: 700, fontSize: '1.125rem' }}>You're in!</div>
      <div style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
        You've joined <strong style={{ color: 'var(--text)' }}>{accepted.org_name}</strong>.
      </div>
      <a href="/?tab=orgs" style={{ padding: '0.6rem 1.5rem', background: 'var(--accent)', color: '#fff',
        borderRadius: 7, fontWeight: 600, fontSize: '0.875rem', textDecoration: 'none' }}>
        Open Organizations
      </a>
    </Shell>
  )

  // Need to be logged in to accept
  if (!authChecked) return (
    <Shell>
      <span className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
    </Shell>
  )

  if (!user) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Show invite context above auth form */}
      <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem 2rem 0' }}>
        <div style={{ width: '100%', maxWidth: 420, background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 10, padding: '1rem 1.25rem',
          display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(99,102,241,0.1)',
            border: '1px solid rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <IconOrg size={20} />
          </div>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: '0.8125rem', fontWeight: 600 }}>
              You've been invited to join <strong>{invite.org_name}</strong>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
              Invited by {invite.invited_by} · Sign in to accept
            </div>
          </div>
        </div>
      </div>
      <AuthPage onAuth={u => {
        setUser(u)
        // Auto-accept after login
        acceptInvite(token)
          .then(res => setAccepted({ org_name: res.org_name }))
          .catch(e => {
            const status = e?.response?.status
            if (status === 410) setError('This invite has already been used or expired.')
            else if (status === 403) setError(e?.response?.data?.error || 'This invite was sent to a different email address.')
            else setError('Failed to accept invite.')
          })
      }} />
    </div>
  )

  return (
    <Shell>
      <div style={{ width: 52, height: 52, borderRadius: 12, background: 'rgba(99,102,241,0.1)',
        border: '1px solid rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <IconOrg size={28} />
      </div>
      <div>
        <div style={{ fontWeight: 700, fontSize: '1.125rem', marginBottom: '0.25rem' }}>
          You're invited!
        </div>
        <div style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
          <strong style={{ color: 'var(--text)' }}>{invite.invited_by}</strong> has invited you to join
        </div>
        <div style={{ fontWeight: 700, fontSize: '1.25rem', marginTop: '0.375rem', color: 'var(--accent)' }}>
          {invite.org_name}
        </div>
      </div>

      {invite.email && (
        <div style={{ fontSize: '0.8125rem', color: 'var(--muted)', background: 'var(--surface2)',
          border: '1px solid var(--border)', borderRadius: 6, padding: '0.5rem 0.875rem' }}>
          Invite sent to <strong style={{ color: 'var(--text)' }}>{invite.email}</strong>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.625rem', width: '100%' }}>
        <button
          onClick={handleAccept}
          disabled={accepting}
          style={{ flex: 1, padding: '0.65rem', fontWeight: 700, fontSize: '0.9rem',
            background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8,
            cursor: accepting ? 'not-allowed' : 'pointer', opacity: accepting ? 0.7 : 1 }}>
          {accepting ? 'Joining…' : 'Accept Invite'}
        </button>
        <a href="/" style={{ padding: '0.65rem 1rem', fontWeight: 500, fontSize: '0.875rem',
          background: 'var(--surface2)', color: 'var(--muted)', border: '1px solid var(--border)',
          borderRadius: 8, textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
          Decline
        </a>
      </div>
    </Shell>
  )
}
