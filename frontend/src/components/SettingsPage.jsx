import { useState, useEffect } from 'react'
import {
  getSettings, putSettings,
  getGitHubStatus, disconnectGitHub, startGitHubAuth,
  listTemplates, createTemplate, updateTemplate, deleteTemplate,
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

function GitHubMark({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
    </svg>
  )
}
function DriveIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 87.3 78" fill="none">
      <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
      <path d="M43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L1.2 48.5c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00ac47"/>
      <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.75z" fill="#ea4335"/>
      <path d="M43.65 25L57.4 1.2C56.05.45 54.5 0 52.85 0H34.45c-1.65 0-3.2.45-4.55 1.2z" fill="#00832d"/>
      <path d="M59.8 53H27.5L13.75 76.8c1.35.75 2.9 1.2 4.55 1.2h50.7c1.65 0 3.2-.45 4.55-1.2z" fill="#2684fc"/>
      <path d="M73.4 26.5l-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
    </svg>
  )
}

function SectionCard({ icon, title, subtitle, children, action }) {
  return (
    <div className="card">
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flex: 1, minWidth: 0 }}>
          {icon && <span style={{ color: 'var(--accent)', flexShrink: 0 }}>{icon}</span>}
          <div>
            <h2>{title}</h2>
            {subtitle && <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.125rem', fontWeight: 400 }}>{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {children}
      </div>
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <div className="auth-field">
      <label>{label}</label>
      {children}
      {hint && <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.25rem' }}>{hint}</p>}
    </div>
  )
}

export default function SettingsPage({ onToast }) {
  const [provider, setProvider]   = useState('anthropic')
  const [apiKey, setApiKey]       = useState('')
  const [model, setModel]         = useState('claude-sonnet-4-6')
  const [openaiKey, setOpenaiKey] = useState('')
  const [openaiModel, setOpenaiModel] = useState('gpt-4o')
  const [showKey, setShowKey]     = useState(false)
  const [showOKey, setShowOKey]   = useState(false)
  const [saving, setSaving]       = useState(false)
  const [loading, setLoading]     = useState(true)
  const [ghStatus, setGhStatus]   = useState(null)
  const [ghLoading, setGhLoading] = useState(true)
  const [templates, setTemplates]     = useState([])
  const [editingTpl, setEditingTpl]   = useState(null)  // null | 'new' | template object
  const [tplDraft, setTplDraft]       = useState('')     // JSON string being edited
  const [tplError, setTplError]       = useState('')
  const [tplSaving, setTplSaving]     = useState(false)

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
    listTemplates().then(setTemplates).catch(() => {})
  }, [])

  const DEFAULT_TEMPLATE = {
    name: 'Default (5 pages)',
    pages: [
      {
        id: 'overview',
        title: 'Overview',
        prompt: 'Write an Overview page for this repository.\nInclude:\n- What this project does (1-2 paragraph summary)\n- Key features (bullet list)\n- Tech stack used\n- Prerequisites and how to get started (installation + first run commands)\n- Any important configuration\n\nBase everything on the actual code provided. Be concise but complete.',
      },
      {
        id: 'architecture',
        title: 'Architecture',
        prompt: 'Write an Architecture page for this repository.\nInclude:\n- High-level architecture description (2-3 paragraphs)\n- A Mermaid diagram showing the main components and their relationships. Use graph TD or flowchart TD syntax.\n- Component responsibilities table (component | responsibility | key files)\n- Key design decisions and patterns used\n\nBase everything on the actual code. Make the Mermaid diagram reflect the real architecture.',
      },
      {
        id: 'structure',
        title: 'Project Structure',
        prompt: 'Write a Project Structure page for this repository.\nInclude:\n- Directory tree (use `tree` style formatting in a code block)\n- Description of each major directory and what it contains\n- Key files and their purposes (table: file | purpose)\n- Conventions and patterns used in the codebase\n\nBe specific about the actual files present.',
      },
      {
        id: 'modules',
        title: 'Core Modules',
        prompt: 'Write a Core Modules page for this repository.\nFor each major module/package/component in the codebase:\n- Module name as a heading\n- What it does\n- Key functions/classes/types with brief descriptions\n- Dependencies on other modules\n- Example usage if applicable\n\nFocus on the most important 4-6 modules. Use code snippets from the actual source where helpful.',
      },
      {
        id: 'dataflow',
        title: 'Data Flow',
        prompt: 'Write a Data Flow page for this repository.\nInclude:\n- How data enters the system (inputs, API endpoints, user actions)\n- How it\'s processed and transformed\n- How it\'s stored/persisted\n- How it\'s returned/displayed\n- A Mermaid sequence diagram showing the main data flow\n- Error handling and edge cases\n\nBase this on the actual code flows you can see.',
      },
    ],
  }

  const openNewTemplate = () => {
    setTplDraft(JSON.stringify(DEFAULT_TEMPLATE, null, 2))
    setTplError('')
    setEditingTpl('new')
  }

  const loadDefaultTemplate = async () => {
    setTplSaving(true)
    try {
      const created = await createTemplate({ name: DEFAULT_TEMPLATE.name, pages: DEFAULT_TEMPLATE.pages })
      setTemplates(t => [...t, created])
      onToast('Default template added')
    } catch {
      onToast('Failed to add template', 'error')
    } finally {
      setTplSaving(false)
    }
  }

  const openEditTemplate = (tpl) => {
    setTplDraft(JSON.stringify({ name: tpl.name, pages: tpl.pages }, null, 2))
    setTplError('')
    setEditingTpl(tpl)
  }

  const handleSaveTemplate = async () => {
    let parsed
    try { parsed = JSON.parse(tplDraft) } catch { setTplError('Invalid JSON'); return }
    if (!parsed.name?.trim()) { setTplError('Template must have a name'); return }
    if (!Array.isArray(parsed.pages) || parsed.pages.length === 0) { setTplError('Template must have at least one page'); return }
    setTplSaving(true)
    try {
      if (editingTpl === 'new') {
        const created = await createTemplate({ name: parsed.name.trim(), pages: parsed.pages })
        setTemplates(t => [...t, created])
      } else {
        const updated = await updateTemplate(editingTpl.id, { name: parsed.name.trim(), pages: parsed.pages })
        setTemplates(t => t.map(x => x.id === updated.id ? updated : x))
      }
      setEditingTpl(null)
      onToast('Template saved')
    } catch { setTplError('Save failed') }
    finally { setTplSaving(false) }
  }

  const handleDeleteTemplate = async (tpl) => {
    try {
      await deleteTemplate(tpl.id)
      setTemplates(t => t.filter(x => x.id !== tpl.id))
      onToast('Template deleted')
    } catch { onToast('Delete failed', 'error') }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await putSettings({ anthropic_api_key: apiKey, model, openai_api_key: openaiKey, openai_model: openaiModel, ai_provider: provider })
      onToast('Settings saved')
    } catch { onToast('Failed to save settings', 'error') }
    finally { setSaving(false) }
  }

  const handleGhDisconnect = async (login) => {
    try {
      await disconnectGitHub(login)
      onToast(login ? `Disconnected @${login}` : 'Disconnected GitHub')
      getGitHubStatus().then(setGhStatus).catch(() => {})
    } catch { onToast('Disconnect failed', 'error') }
  }


  if (loading) return <div className="loading-overlay"><span className="spinner" /></div>

  const ghAccounts = ghStatus?.accounts || []

  return (
    <div style={{ maxWidth: 600, display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* AI Provider */}
      <SectionCard
        icon={<svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M12 2a10 10 0 110 20A10 10 0 0112 2zm0 0v4m0 14v-4m-7-7h4m10 0h-4"/></svg>}
        title="AI Provider"
        subtitle="Used for the Living Wiki feature"
      >
        {/* Provider tabs */}
        <div style={{ display: 'flex', background: 'var(--surface2)', borderRadius: 8, padding: 3, gap: 3 }}>
          {[{ id: 'anthropic', label: 'Claude (Anthropic)' }, { id: 'openai', label: 'ChatGPT (OpenAI)' }].map(p => (
            <button
              key={p.id}
              onClick={() => setProvider(p.id)}
              style={{
                flex: 1, padding: '0.45rem 0.75rem', borderRadius: 6, border: 'none',
                background: provider === p.id ? 'var(--surface)' : 'transparent',
                color: provider === p.id ? 'var(--text)' : 'var(--muted)',
                fontWeight: provider === p.id ? 600 : 400,
                fontSize: '0.875rem', cursor: 'pointer', transition: 'all 0.15s',
                boxShadow: provider === p.id ? 'var(--shadow)' : 'none',
              }}
            >{p.label}</button>
          ))}
        </div>

        {provider === 'anthropic' && (
          <>
            <Field label="Anthropic API Key" hint="Stored securely on the server, never shared.">
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input type={showKey ? 'text' : 'password'} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-ant-..." style={{ flex: 1 }} spellCheck={false} autoComplete="off" />
                <button className="btn-secondary" onClick={() => setShowKey(v => !v)} style={{ flexShrink: 0, padding: '0.5rem 0.75rem' }}>{showKey ? 'Hide' : 'Show'}</button>
              </div>
            </Field>
            <Field label="Claude Model">
              <select value={model} onChange={e => setModel(e.target.value)} style={{ width: '100%' }}>
                {CLAUDE_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </Field>
          </>
        )}

        {provider === 'openai' && (
          <>
            <Field label="OpenAI API Key" hint="Stored securely on the server, never shared.">
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input type={showOKey ? 'text' : 'password'} value={openaiKey} onChange={e => setOpenaiKey(e.target.value)} placeholder="sk-..." style={{ flex: 1 }} spellCheck={false} autoComplete="off" />
                <button className="btn-secondary" onClick={() => setShowOKey(v => !v)} style={{ flexShrink: 0, padding: '0.5rem 0.75rem' }}>{showOKey ? 'Hide' : 'Show'}</button>
              </div>
            </Field>
            <Field label="ChatGPT Model">
              <select value={openaiModel} onChange={e => setOpenaiModel(e.target.value)} style={{ width: '100%' }}>
                {OPENAI_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </Field>
          </>
        )}

        <div>
          <button className="btn-primary" onClick={handleSave} disabled={saving} style={{ minWidth: 100 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </SectionCard>

      {/* GitHub */}
      <SectionCard
        icon={<GitHubMark size={16} />}
        title="GitHub"
        subtitle="Connect to use the Living Wiki feature"
        action={ghStatus?.configured && ghStatus?.connected && (
          <button className="btn-add" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', flexShrink: 0 }} onClick={startGitHubAuth}>+ Add account</button>
        )}
      >
        {ghLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--muted)', fontSize: '0.875rem' }}>
            <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Loading…
          </div>
        ) : !ghStatus?.configured ? (
          <div className="auth-error">
            GitHub OAuth is not configured. Add <code>GITHUB_CLIENT_ID</code> and <code>GITHUB_CLIENT_SECRET</code> env vars and redeploy.
          </div>
        ) : !ghStatus?.connected ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            <p style={{ color: 'var(--muted)', fontSize: '0.875rem', margin: 0 }}>No accounts connected. Connect GitHub to browse repos and generate wiki docs.</p>
            <button className="btn-primary" style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '0.5rem' }} onClick={startGitHubAuth}>
              <GitHubMark size={14} /> Connect GitHub
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {ghAccounts.map(login => (
              <div key={login} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', padding: '0.5rem 0.75rem', background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <GitHubMark size={14} />
                <span style={{ flex: 1, fontSize: '0.875rem', fontWeight: 500 }}>@{login}</span>
                <button className="btn-danger-sm" onClick={() => handleGhDisconnect(login)}>Disconnect</button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Wiki Templates */}
      <SectionCard
        icon={<svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>}
        title="Wiki Templates"
        subtitle="Reusable page configs for wiki generation"
        action={
          editingTpl ? null : (
            <button className="btn-add" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }} onClick={openNewTemplate}>
              + New template
            </button>
          )
        }
      >
        {editingTpl ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <p style={{ fontSize: '0.8125rem', color: 'var(--muted)', margin: 0 }}>
              Edit as JSON. The <code>name</code> field sets the template name. Each page needs <code>id</code>, <code>title</code>, and <code>prompt</code>.
            </p>
            <textarea
              value={tplDraft}
              onChange={e => { setTplDraft(e.target.value); setTplError('') }}
              spellCheck={false}
              rows={16}
              style={{
                fontFamily: "'Fira Code', 'Cascadia Code', monospace",
                fontSize: '0.8125rem', lineHeight: 1.6,
                background: 'var(--bg)', color: 'var(--text)',
                border: `1px solid ${tplError ? 'var(--danger)' : 'var(--border)'}`,
                borderRadius: 8, padding: '0.75rem', resize: 'vertical', outline: 'none',
              }}
              onFocus={e => e.target.style.borderColor = tplError ? 'var(--danger)' : 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = tplError ? 'var(--danger)' : 'var(--border)'}
            />
            {tplError && <p style={{ color: 'var(--danger)', fontSize: '0.8125rem', margin: 0 }}>{tplError}</p>}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn-primary" onClick={handleSaveTemplate} disabled={tplSaving} style={{ minWidth: 80 }}>
                {tplSaving ? 'Saving\u2026' : 'Save'}
              </button>
              <button className="btn-secondary" onClick={() => setEditingTpl(null)}>Cancel</button>
            </div>
          </div>
        ) : templates.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <p style={{ color: 'var(--muted)', fontSize: '0.875rem', margin: 0 }}>
              No templates yet. Start from the default 5-page template or create your own.
            </p>
            <button
              className="btn-secondary"
              style={{ alignSelf: 'flex-start', fontSize: '0.8125rem' }}
              onClick={loadDefaultTemplate}
              disabled={tplSaving}>
              {tplSaving ? 'Adding…' : '+ Add default template'}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {templates.map(tpl => (
              <div key={tpl.id} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', padding: '0.5rem 0.75rem', background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tpl.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.125rem' }}>{tpl.pages?.length || 0} pages</div>
                </div>
                <button className="btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', flexShrink: 0 }} onClick={() => openEditTemplate(tpl)}>Edit</button>
                <button className="btn-danger-sm" style={{ flexShrink: 0 }} onClick={() => handleDeleteTemplate(tpl)}>Delete</button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>


    </div>
  )
}
