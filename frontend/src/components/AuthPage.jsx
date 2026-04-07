import { useState, useEffect } from 'react'
import { getAuthConfig, authRegister, authLogin, authMe, startGoogleAuth } from '../api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

function IconLink() {
  return <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
}
function IconMoon() {
  return <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
}
function IconSun() {
  return <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
}

export default function AuthPage({ onAuth }) {
  const [mode, setMode]     = useState('login')
  const [email, setEmail]   = useState('')
  const [password, setPassword] = useState('')
  const [name, setName]     = useState('')
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const [googleEnabled, setGoogleEnabled] = useState(false)
  const [dark, setDark]     = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    getAuthConfig().then(c => setGoogleEnabled(c.google_enabled)).catch(() => {})
  }, [])

  const toggleTheme = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('mdf_theme', next ? 'dark' : 'light')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'login') {
        const r = await authLogin(email, password)
        localStorage.setItem('mdf_token', r.token)
      } else {
        if (!name.trim()) { setError('Name is required'); setLoading(false); return }
        const r = await authRegister(email, name, password)
        localStorage.setItem('mdf_token', r.token)
      }
      const user = await authMe()
      onAuth(user)
    } catch (e) {
      setError(e?.response?.data?.error || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background p-4">
      {/* Theme toggle */}
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleTheme}
        title={dark ? 'Light mode' : 'Dark mode'}
        className="absolute top-4 right-4"
      >
        {dark ? <IconSun /> : <IconMoon />}
      </Button>

      <div className="w-full max-w-sm space-y-5">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-sky-400 flex items-center justify-center text-white shrink-0">
            <IconLink />
          </div>
          <div>
            <div className="font-bold text-base">LiveWiki</div>
            <div className="text-xs text-muted-foreground">AI-powered living wikis for your repos</div>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-0 rounded-lg border border-border p-1 bg-muted">
          {[
            { id: 'login', label: 'Sign in' },
            { id: 'register', label: 'Create account' },
          ].map(({ id, label }) => (
            <button
              key={id}
              onClick={() => { setMode(id); setError('') }}
              className={cn(
                'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all',
                mode === id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Google SSO */}
        {googleEnabled && (
          <div className="space-y-3">
            <button
              onClick={startGoogleAuth}
              className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
            >
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </button>
            <div className="relative flex items-center gap-3">
              <div className="flex-1 border-t border-border" />
              <span className="text-xs text-muted-foreground">or</span>
              <div className="flex-1 border-t border-border" />
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" required />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required minLength={6} />
          </div>
          {error && (
            <p className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </Button>
        </form>
      </div>
    </div>
  )
}
