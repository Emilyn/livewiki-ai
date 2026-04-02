import { useState, useEffect } from 'react'
import {
  getSettings, putSettings,
  getGitHubStatus, disconnectGitHub, startGitHubAuth,
  getDriveStatus, driveDisconnect, startDriveAuth,
} from '../api'

const CLAUDE_MODELS = [
  { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6 (default)' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  { id: 'claude-opus-4-6',           label: 'Claude Opus 4.6' },
]

const OPENAI_MODELS = [
  { id: 'gpt-4o',        label: 'GPT-4o (default)' },
  { id: 'gpt-4o-mini',   label: 'GPT-4o mini' },
  { id: 'gpt-4-turbo',   label: 'GPT-4 Turbo' },
  { id: 'gpt-4',         label: 'GPT-4' },
  { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
]

function SectionHeader({ title }) {
  return (
    <h3 style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
      {title}
    </h3>
  )
}

export default function SettingsPage({ onToast }) {
  // AI settings
  const [provider, setProvider]   = useState('anthropic')
  const [apiKey, setApiKey]       = useState('')
  const [model, setModel]         = useState('claude-sonnet-4-6')
  const [openaiKey, setOpenaiKey] = useState('')
  const [openaiModel, setOpenaiModel] = useState('gpt-4o')
  const [showKey, setShowKey]     = useState(false)
  const [showOKey, setShowOKey]   = useState(false)
  const [saving, setSaving]       = useState(false)
  const [loading, setLoading]     = useState(true)

  // GitHub integration
  const [ghStatus, setGhStatus]   = useState(null)
  const [ghLoading, setGhLoading] = useState(true)

  // Drive integration
  const [driveStatus, setDriveStatus]   = useState(null)
  const [driveLoading, setDriveLoading] = useState(true)

  useEffect(() => {
    getSettings()
      .then(s => {
        setApiKey(s.anthropic_api_key || '')
        setModel(s.model || 'claude-sonnet-4-6')
        setOpenaiKey(s.openai_api_key || '')
        setOpenaiModel(s.openai_model || 'gpt-4o')
        setProvider(s.ai_provider || 'anthropic')
      })
      .catch(() => {})
      .finally(() => setLoading(false))

    getGitHubStatus()
      .then(setGhStatus)
      .catch(() => setGhStatus({ connected: false, configured: false, accounts: [] }))
      .finally(() => setGhLoading(false))

    getDriveStatus()
      .then(setDriveStatus)
      .catch(() => setDriveStatus({ configured: false, connected: false }))
      .finally(() => setDriveLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await putSettings({
        anthropic_api_key: apiKey,
        model,
        openai_api_key: openaiKey,
        openai_model: openaiModel,
        ai_provider: provider,
      })
      onToast('Settings saved')
    } catch {
      onToast('Failed to save settings', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleGhDisconnect = async (login) => {
    try {
      await disconnectGitHub(login)
      onToast(login ? `Disconnected @${login}` : 'Disconnected GitHub')
      getGitHubStatus().then(setGhStatus).catch(() => {})
    } catch {
      onToast('Disconnect failed', 'error')
    }
  }

  const handleDriveDisconnect = async () => {
    try {
      await driveDisconnect()
      onToast('Disconnected Google Drive')
      getDriveStatus().then(setDriveStatus).catch(() => {})
    } catch {
      onToast('Disconnect failed', 'error')
    }
  }

  if (loading) {
    return <div className="loading-overlay"><span className="spinner" /></div>
  }

  const ghAccounts = ghStatus?.accounts || []

  return (
    <div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* ── AI Provider ────────────────────────────────────────────────────── */}
      <div className="card">
        <div className="card-header"><h2>AI Provider</h2></div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Provider toggle */}
          <div className="auth-field">
            <label>Provider</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {[{ id: 'anthropic', label: 'Claude (Anthropic)' }, { id: 'openai', label: 'ChatGPT (OpenAI)' }].map(p => (
                <button
                  key={p.id}
                  onClick={() => setProvider(p.id)}
                  style={{
                    flex: 1,
                    padding: '0.5rem 0.75rem',
                    borderRadius: 6,
                    border: `1px solid ${provider === p.id ? 'var(--accent)' : 'var(--border)'}`,
                    background: provider === p.id ? 'rgba(99,102,241,0.1)' : 'var(--surface2)',
                    color: provider === p.id ? 'var(--accent)' : 'var(--muted)',
                    fontWeight: provider === p.id ? 600 : 400,
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                    transition: 'all 0.15s',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Anthropic fields */}
          {provider === 'anthropic' && (
            <>
              <div className="auth-field">
                <label>Anthropic API Key</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder="sk-ant-..."
                    style={{ flex: 1 }}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <button className="btn-secondary" onClick={() => setShowKey(v => !v)} style={{ flexShrink: 0, padding: '0.5rem 0.75rem' }}>
                    {showKey ? 'Hide' : 'Show'}
                  </button>
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
                  Stored securely on the server, never shared.
                </p>
              </div>
              <div className="auth-field">
                <label>Claude Model</label>
                <select value={model} onChange={e => setModel(e.target.value)} style={{ width: '100%' }}>
                  {CLAUDE_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
            </>
          )}

          {/* OpenAI fields */}
          {provider === 'openai' && (
            <>
              <div className="auth-field">
                <label>OpenAI API Key</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type={showOKey ? 'text' : 'password'}
                    value={openaiKey}
                    onChange={e => setOpenaiKey(e.target.value)}
                    placeholder="sk-..."
                    style={{ flex: 1 }}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <button className="btn-secondary" onClick={() => setShowOKey(v => !v)} style={{ flexShrink: 0, padding: '0.5rem 0.75rem' }}>
                    {showOKey ? 'Hide' : 'Show'}
                  </button>
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
                  Stored securely on the server, never shared.
                </p>
              </div>
              <div className="auth-field">
                <label>ChatGPT Model</label>
                <select value={openaiModel} onChange={e => setOpenaiModel(e.target.value)} style={{ width: '100%' }}>
                  {OPENAI_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
            </>
          )}

          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={saving}
            style={{ alignSelf: 'flex-start', minWidth: 100 }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* ── GitHub Integration ─────────────────────────────────────────────── */}
      <div className="card">
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            <h2>GitHub</h2>
          </div>
          {ghStatus?.configured && (
            <button className="btn-add" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }} onClick={startGitHubAuth}>
              + Add account
            </button>
          )}
        </div>
        <div className="card-body">
          {ghLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--muted)', fontSize: '0.875rem' }}>
              <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Loading…
            </div>
          ) : !ghStatus?.configured ? (
            <div className="auth-error">
              GitHub OAuth is not configured. Add <code>GITHUB_CLIENT_ID</code> and <code>GITHUB_CLIENT_SECRET</code> env vars and redeploy.
            </div>
          ) : !ghStatus?.connected ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <p style={{ color: 'var(--muted)', fontSize: '0.875rem', margin: 0 }}>
                Connect GitHub to use the Living Wiki feature.
              </p>
              <button className="btn-primary" style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '0.5rem' }} onClick={startGitHubAuth}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                </svg>
                Connect GitHub
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              {ghAccounts.map(login => (
                <div key={login} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.375rem 0.25rem' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                  </svg>
                  <span style={{ flex: 1, fontSize: '0.875rem', fontWeight: 500 }}>@{login}</span>
                  <button className="btn-danger-sm" onClick={() => handleGhDisconnect(login)}>Disconnect</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Google Drive Integration ───────────────────────────────────────── */}
      <div className="card">
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <svg width="15" height="15" viewBox="0 0 87.3 78" fill="none">
              <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
              <path d="M43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L1.2 48.5c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00ac47"/>
              <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.75z" fill="#ea4335"/>
              <path d="M43.65 25L57.4 1.2C56.05.45 54.5 0 52.85 0H34.45c-1.65 0-3.2.45-4.55 1.2z" fill="#00832d"/>
              <path d="M59.8 53H27.5L13.75 76.8c1.35.75 2.9 1.2 4.55 1.2h50.7c1.65 0 3.2-.45 4.55-1.2z" fill="#2684fc"/>
              <path d="M73.4 26.5l-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
            </svg>
            <h2>Google Drive</h2>
          </div>
        </div>
        <div className="card-body">
          {driveLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--muted)', fontSize: '0.875rem' }}>
              <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Loading…
            </div>
          ) : !driveStatus?.configured ? (
            <div className="auth-error">
              Google Drive is not configured. Add <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> env vars and redeploy.
            </div>
          ) : !driveStatus?.connected ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <p style={{ color: 'var(--muted)', fontSize: '0.875rem', margin: 0 }}>
                Connect Google Drive to browse and upload MDF files from your Drive.
              </p>
              <button className="btn-primary" style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '0.5rem' }} onClick={startDriveAuth}>
                <svg width="14" height="14" viewBox="0 0 87.3 78" fill="none">
                  <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
                  <path d="M43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L1.2 48.5c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00ac47"/>
                  <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.75z" fill="#ea4335"/>
                  <path d="M43.65 25L57.4 1.2C56.05.45 54.5 0 52.85 0H34.45c-1.65 0-3.2.45-4.55 1.2z" fill="#00832d"/>
                  <path d="M59.8 53H27.5L13.75 76.8c1.35.75 2.9 1.2 4.55 1.2h50.7c1.65 0 3.2-.45 4.55-1.2z" fill="#2684fc"/>
                  <path d="M73.4 26.5l-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
                </svg>
                Connect Google Drive
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.375rem 0' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)', flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: '0.875rem' }}>
                Connected
                {driveStatus.folder ? ` — folder: ${driveStatus.folder.name}` : ''}
              </span>
              <button className="btn-danger-sm" onClick={handleDriveDisconnect}>Disconnect</button>
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
