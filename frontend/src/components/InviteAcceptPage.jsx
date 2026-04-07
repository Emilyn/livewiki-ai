import { useState, useEffect } from 'react'
import { getInviteInfo, acceptInvite, authMe } from '../api'
import AuthPage from './AuthPage'
import { Button } from '@/components/ui/button'

function IconOrg({ size = 36 }) {
  return <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
}

function Shell({ children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-[420px] rounded-xl border border-border bg-card p-8 flex flex-col items-center gap-5 text-center shadow-sm">
        {children}
      </div>
    </div>
  )
}

function Spinner() {
  return <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-border border-t-primary" />
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

  if (loading) return (
    <Shell>
      <Spinner />
      <p className="text-sm text-muted-foreground">Loading invite…</p>
    </Shell>
  )

  if (error) return (
    <Shell>
      <span className="text-muted-foreground"><IconOrg /></span>
      <div className="font-bold text-base">Invite unavailable</div>
      <p className="text-sm text-muted-foreground">{error}</p>
      <a href="/" className="text-sm text-sky-400 hover:underline underline-offset-3">Go to app →</a>
    </Shell>
  )

  if (accepted) return (
    <Shell>
      <div className="h-14 w-14 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center">
        <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="#10b981" strokeWidth="2.5">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <div className="font-bold text-lg">You're in!</div>
      <p className="text-sm text-muted-foreground">
        You've joined <strong className="text-foreground">{accepted.org_name}</strong>.
      </p>
      <Button asChild>
        <a href="/?tab=orgs">Open Organizations</a>
      </Button>
    </Shell>
  )

  if (!authChecked) return (
    <Shell><Spinner /></Shell>
  )

  if (!user) return (
    <div className="min-h-screen bg-background">
      {/* Invite context banner */}
      <div className="flex justify-center px-4 pt-8 pb-0">
        <div className="w-full max-w-sm rounded-xl border border-border bg-card px-4 py-3 flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-sky-400/10 border border-sky-400/20 flex items-center justify-center shrink-0 text-sky-400">
            <IconOrg size={20} />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold">
              You've been invited to join <strong>{invite.org_name}</strong>
            </p>
            <p className="text-xs text-muted-foreground">
              Invited by {invite.invited_by} · Sign in to accept
            </p>
          </div>
        </div>
      </div>
      <AuthPage onAuth={u => {
        setUser(u)
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
      <div className="h-14 w-14 rounded-xl bg-sky-400/10 border border-sky-400/20 flex items-center justify-center text-sky-400">
        <IconOrg size={28} />
      </div>
      <div>
        <div className="font-bold text-lg mb-1">You're invited!</div>
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">{invite.invited_by}</strong> has invited you to join
        </p>
        <div className="font-bold text-xl mt-1 text-sky-400">{invite.org_name}</div>
      </div>

      {invite.email && (
        <p className="text-xs text-muted-foreground bg-muted border border-border rounded-lg px-3 py-2">
          Invite sent to <strong className="text-foreground">{invite.email}</strong>
        </p>
      )}

      <div className="flex gap-2.5 w-full">
        <Button className="flex-1" onClick={handleAccept} disabled={accepting}>
          {accepting ? 'Joining…' : 'Accept Invite'}
        </Button>
        <Button variant="outline" asChild>
          <a href="/">Decline</a>
        </Button>
      </div>
    </Shell>
  )
}
