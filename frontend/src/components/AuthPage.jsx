import { useState, useEffect } from 'react'
import { getAuthConfig, authLogin, authRegister, startGoogleAuth } from '../api'

export default function AuthPage({ onAuth }) {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleEnabled, setGoogleEnabled] = useState(false)

  useEffect(() => {
    getAuthConfig().then(c => setGoogleEnabled(c.google_enabled)).catch(() => {})
  }, [])

  const handleSubmit = async e => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = mode === 'login'
        ? await authLogin(email, password)
        : await authRegister(email, name, password)
      localStorage.setItem('mdf_token', data.token)
      onAuth(data.user)
    } catch (err) {
      setError(err?.response?.data?.error || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="header-icon" style={{ width: 40, height: 40 }}>
            <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M9 17H7A5 5 0 0 1 7 7h2"/>
              <path d="M15 7h2a5 5 0 1 1 0 10h-2"/>
              <line x1="8" y1="12" x2="16" y2="12"/>
            </svg>
          </div>
          <div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>MDF Viewer</h1>
            <p style={{ fontSize: '0.8125rem', color: 'var(--muted)', margin: 0 }}>
              Upload and explore MDF4 measurement data
            </p>
          </div>
        </div>

        <div className="auth-tabs">
          <button
            className={`auth-tab${mode === 'login' ? ' active' : ''}`}
            onClick={() => { setMode('login'); setError('') }}
          >
            Sign in
          </button>
          <button
            className={`auth-tab${mode === 'register' ? ' active' : ''}`}
            onClick={() => { setMode('register'); setError('') }}
          >
            Create account
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-field">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus
            />
          </div>

          {mode === 'register' && (
            <div className="auth-field">
              <label>Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your name"
                required
              />
            </div>
          )}

          <div className="auth-field">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={mode === 'register' ? 'At least 8 characters' : ''}
              required
            />
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button className="btn-primary auth-submit" disabled={loading}>
            {loading ? 'Please wait\u2026' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        {googleEnabled && (
          <>
            <div className="auth-divider"><span>or</span></div>
            <button className="btn-google" onClick={startGoogleAuth}>
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </button>
          </>
        )}
      </div>
    </div>
  )
}
