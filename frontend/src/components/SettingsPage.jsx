import { useState, useEffect } from 'react'
import {
  getSettings, putSettings,
  getGitHubStatus, disconnectGitHub, startGitHubAuth,
  getGitLabStatus, disconnectGitLab, startGitLabAuth,
  listTemplates, createTemplate, updateTemplate, deleteTemplate,
} from '../api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

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
function GitLabIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 01-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 014.82 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0118.6 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.51L23 13.45a.84.84 0 01-.35.94z"/>
    </svg>
  )
}

const DEFAULT_TEMPLATE = {
  name: 'Default (5 pages)',
  pages: [
    { id: 'overview', title: 'Overview', prompt: 'Write an Overview page for this repository.\nInclude:\n- What this project does (1-2 paragraph summary)\n- Key features (bullet list)\n- Tech stack used\n- Prerequisites and how to get started (installation + first run commands)\n- Any important configuration\n\nBase everything on the actual code provided. Be concise but complete.' },
    { id: 'architecture', title: 'Architecture', prompt: 'Write an Architecture page for this repository.\nInclude:\n- High-level architecture description (2-3 paragraphs)\n- A Mermaid diagram showing the main components and their relationships. Use graph TD or flowchart TD syntax.\n- Component responsibilities table (component | responsibility | key files)\n- Key design decisions and patterns used\n\nBase everything on the actual code. Make the Mermaid diagram reflect the real architecture.' },
    { id: 'structure', title: 'Project Structure', prompt: 'Write a Project Structure page for this repository.\nInclude:\n- Directory tree (use `tree` style formatting in a code block)\n- Description of each major directory and what it contains\n- Key files and their purposes (table: file | purpose)\n- Conventions and patterns used in the codebase\n\nBe specific about the actual files present.' },
    { id: 'modules', title: 'Core Modules', prompt: 'Write a Core Modules page for this repository.\nFor each major module/package/component in the codebase:\n- Module name as a heading\n- What it does\n- Key functions/classes/types with brief descriptions\n- Dependencies on other modules\n- Example usage if applicable\n\nFocus on the most important 4-6 modules. Use code snippets from the actual source where helpful.' },
    { id: 'dataflow', title: 'Data Flow', prompt: "Write a Data Flow page for this repository.\nInclude:\n- How data enters the system (inputs, API endpoints, user actions)\n- How it's processed and transformed\n- How it's stored/persisted\n- How it's returned/displayed\n- A Mermaid sequence diagram showing the main data flow\n- Error handling and edge cases\n\nBase this on the actual code flows you can see." },
  ],
}

function ProviderAccountRow({ icon, name, onDisconnect }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/40 px-3 py-2">
      {icon}
      <span className="flex-1 text-sm font-medium">@{name}</span>
      <Button variant="destructive" size="xs" onClick={() => onDisconnect(name)}>Disconnect</Button>
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
  const [glStatus, setGlStatus]   = useState(null)
  const [glLoading, setGlLoading] = useState(true)
  const [templates, setTemplates]     = useState([])
  const [editingTpl, setEditingTpl]   = useState(null)
  const [tplDraft, setTplDraft]       = useState('')
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
    getGitLabStatus()
      .then(setGlStatus)
      .catch(() => setGlStatus({ connected: false, configured: false, accounts: [] }))
      .finally(() => setGlLoading(false))
    listTemplates().then(setTemplates).catch(() => {})
  }, [])

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

  const handleGlDisconnect = async (username) => {
    try {
      await disconnectGitLab(username)
      onToast(username ? `Disconnected @${username}` : 'Disconnected GitLab')
      getGitLabStatus().then(setGlStatus).catch(() => {})
    } catch { onToast('Disconnect failed', 'error') }
  }

  const selectClass = "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus:border-ring dark:bg-input/30"

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
    </div>
  )

  const ghAccounts = ghStatus?.accounts || []
  const glAccounts = glStatus?.accounts || []

  return (
    <div className="max-w-5xl space-y-5">
      <div className="grid gap-5 md:grid-cols-2 items-start">

        {/* AI Provider */}
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center gap-2">
              <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" className="text-indigo-500">
                <path d="M12 2a10 10 0 110 20A10 10 0 0112 2zm0 0v4m0 14v-4m-7-7h4m10 0h-4"/>
              </svg>
              <CardTitle>AI Provider</CardTitle>
            </div>
            <CardDescription>Used for the Living Wiki feature</CardDescription>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            {/* Provider toggle */}
            <div className="flex gap-1 rounded-lg border border-border bg-muted p-1">
              {[{ id: 'anthropic', label: 'Claude (Anthropic)' }, { id: 'openai', label: 'ChatGPT (OpenAI)' }].map(p => (
                <button
                  key={p.id}
                  onClick={() => setProvider(p.id)}
                  className={cn(
                    'flex-1 rounded-md px-2.5 py-1.5 text-sm transition-all',
                    provider === p.id
                      ? 'bg-background text-foreground font-semibold shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {provider === 'anthropic' && (
              <>
                <div className="space-y-1.5">
                  <Label>Anthropic API Key</Label>
                  <div className="flex gap-2">
                    <Input type={showKey ? 'text' : 'password'} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-ant-…" className="flex-1" spellCheck={false} autoComplete="off" />
                    <Button variant="outline" size="sm" onClick={() => setShowKey(v => !v)} className="shrink-0">{showKey ? 'Hide' : 'Show'}</Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Stored securely on the server, never shared.</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Claude Model</Label>
                  <select className={selectClass} value={model} onChange={e => setModel(e.target.value)}>
                    {CLAUDE_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </div>
              </>
            )}

            {provider === 'openai' && (
              <>
                <div className="space-y-1.5">
                  <Label>OpenAI API Key</Label>
                  <div className="flex gap-2">
                    <Input type={showOKey ? 'text' : 'password'} value={openaiKey} onChange={e => setOpenaiKey(e.target.value)} placeholder="sk-…" className="flex-1" spellCheck={false} autoComplete="off" />
                    <Button variant="outline" size="sm" onClick={() => setShowOKey(v => !v)} className="shrink-0">{showOKey ? 'Hide' : 'Show'}</Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Stored securely on the server, never shared.</p>
                </div>
                <div className="space-y-1.5">
                  <Label>ChatGPT Model</Label>
                  <select className={selectClass} value={openaiModel} onChange={e => setOpenaiModel(e.target.value)}>
                    {OPENAI_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </div>
              </>
            )}

            <Button onClick={handleSave} disabled={saving} className="min-w-[90px]">
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </CardContent>
        </Card>

        {/* Right column: GitHub + GitLab */}
        <div className="space-y-5">
          {/* GitHub */}
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <GitHubMark size={15} />
                  <CardTitle>GitHub</CardTitle>
                </div>
                {ghStatus?.configured && ghStatus?.connected && (
                  <Button variant="outline" size="xs" onClick={startGitHubAuth}>+ Add account</Button>
                )}
              </div>
              <CardDescription>Connect to use the Living Wiki feature</CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              {ghLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-primary" />
                  Loading…
                </div>
              ) : !ghStatus?.configured ? (
                <p className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive">
                  GitHub OAuth is not configured. Add <code>GITHUB_CLIENT_ID</code> and <code>GITHUB_CLIENT_SECRET</code> env vars and redeploy.
                </p>
              ) : !ghStatus?.connected ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">No accounts connected. Connect GitHub to browse repos and generate wiki docs.</p>
                  <Button size="sm" onClick={startGitHubAuth} className="flex items-center gap-1.5">
                    <GitHubMark size={13} /> Connect GitHub
                  </Button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {ghAccounts.map(login => (
                    <ProviderAccountRow key={login} icon={<GitHubMark size={13} />} name={login} onDisconnect={handleGhDisconnect} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* GitLab */}
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <GitLabIcon size={15} />
                  <CardTitle>GitLab</CardTitle>
                </div>
                {glStatus?.configured && glStatus?.connected && (
                  <Button variant="outline" size="xs" onClick={startGitLabAuth}>+ Add account</Button>
                )}
              </div>
              <CardDescription>Connect to use the Living Wiki feature with GitLab repositories</CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              {glLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-primary" />
                  Loading…
                </div>
              ) : !glStatus?.configured ? (
                <p className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive">
                  GitLab OAuth is not configured. Add <code>GITLAB_CLIENT_ID</code> and <code>GITLAB_CLIENT_SECRET</code> env vars and redeploy.
                </p>
              ) : !glStatus?.connected ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">No accounts connected. Connect GitLab to browse repos and generate wiki docs.</p>
                  <Button size="sm" onClick={startGitLabAuth} className="flex items-center gap-1.5">
                    <GitLabIcon size={13} /> Connect GitLab
                  </Button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {glAccounts.map(username => (
                    <ProviderAccountRow key={username} icon={<GitLabIcon size={13} />} name={username} onDisconnect={handleGlDisconnect} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Wiki Templates */}
      <Card>
        <CardHeader className="border-b">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" className="text-indigo-500">
                <path d="M4 19.5A2.5 2.5 0 016.5 17H20"/>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>
              </svg>
              <CardTitle>Wiki Templates</CardTitle>
            </div>
            {!editingTpl && (
              <Button variant="outline" size="xs" onClick={openNewTemplate}>+ New template</Button>
            )}
          </div>
          <CardDescription>Reusable page configs for wiki generation</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {editingTpl ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Edit as JSON. The <code className="bg-muted px-1 rounded text-xs">name</code> field sets the template name. Each page needs <code className="bg-muted px-1 rounded text-xs">id</code>, <code className="bg-muted px-1 rounded text-xs">title</code>, and <code className="bg-muted px-1 rounded text-xs">prompt</code>.
              </p>
              <Textarea
                value={tplDraft}
                onChange={e => { setTplDraft(e.target.value); setTplError('') }}
                spellCheck={false}
                rows={16}
                className={cn('font-mono text-xs resize-y', tplError && 'border-destructive')}
              />
              {tplError && <p className="text-xs text-destructive">{tplError}</p>}
              <div className="flex gap-2">
                <Button onClick={handleSaveTemplate} disabled={tplSaving} className="min-w-[72px]">
                  {tplSaving ? 'Saving…' : 'Save'}
                </Button>
                <Button variant="outline" onClick={() => setEditingTpl(null)}>Cancel</Button>
              </div>
            </div>
          ) : templates.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">No templates yet. Start from the default 5-page template or create your own.</p>
              <Button variant="outline" size="sm" onClick={loadDefaultTemplate} disabled={tplSaving}>
                {tplSaving ? 'Adding…' : '+ Add default template'}
              </Button>
            </div>
          ) : (
            <div className="space-y-1.5">
              {templates.map(tpl => (
                <div key={tpl.id} className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{tpl.name}</div>
                    <div className="text-xs text-muted-foreground">{tpl.pages?.length || 0} pages</div>
                  </div>
                  <Button variant="outline" size="xs" onClick={() => openEditTemplate(tpl)}>Edit</Button>
                  <Button variant="destructive" size="xs" onClick={() => handleDeleteTemplate(tpl)}>Delete</Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
