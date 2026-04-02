import { useState, useEffect } from 'react'
import {
  getGitHubStatus, disconnectGitHub,
  listGitHubRepos, getGitHubTree,
  generateWiki,
} from '../api'

// ── GitHub mark icon ──────────────────────────────────────────────────────────
function GitHubIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
    </svg>
  )
}

// ── File tree ─────────────────────────────────────────────────────────────────
function FileTree({ tree, selected, onToggle }) {
  const [expanded, setExpanded] = useState({})

  // Build tree structure
  const nodes = {}
  tree.forEach(item => {
    const parts = item.path.split('/')
    let cur = nodes
    parts.forEach((part, i) => {
      if (!cur[part]) cur[part] = { __meta: null, __children: {} }
      if (i === parts.length - 1) cur[part].__meta = item
      cur = cur[part].__children
    })
  })

  const toggleDir = (path) => setExpanded(e => ({ ...e, [path]: !e[path] }))

  const renderNode = (nodeMap, depth = 0, prefix = '') => {
    return Object.entries(nodeMap).map(([name, node]) => {
      const path = prefix ? `${prefix}/${name}` : name
      const isDir = node.__meta?.type === 'tree' || (!node.__meta && Object.keys(node.__children).length > 0)
      const isFile = node.__meta?.type === 'blob'
      const isExpanded = expanded[path] !== false // default expanded

      return (
        <div key={path}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.375rem',
              padding: '0.25rem 0.5rem',
              paddingLeft: `${0.5 + depth * 1}rem`,
              borderRadius: 5,
              cursor: isFile ? 'pointer' : 'default',
              fontSize: '0.8125rem',
              background: isFile && selected.has(path) ? 'rgba(99,102,241,0.12)' : 'transparent',
              transition: 'background 0.1s',
            }}
            onClick={() => {
              if (isDir) toggleDir(path)
              else if (isFile) onToggle(path)
            }}
            onMouseEnter={e => { if (isFile && !selected.has(path)) e.currentTarget.style.background = 'var(--surface2)' }}
            onMouseLeave={e => { if (!selected.has(path)) e.currentTarget.style.background = 'transparent' }}
          >
            {isDir ? (
              <>
                <span style={{ color: 'var(--muted)', fontSize: '0.625rem' }}>{isExpanded ? '▼' : '▶'}</span>
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="var(--accent)" strokeWidth="2">
                  <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
                </svg>
                <span style={{ color: 'var(--text)', fontWeight: 500 }}>{name}</span>
              </>
            ) : (
              <>
                <input
                  type="checkbox"
                  checked={selected.has(path)}
                  onChange={() => onToggle(path)}
                  onClick={e => e.stopPropagation()}
                  style={{ margin: 0, accentColor: 'var(--accent)', cursor: 'pointer' }}
                />
                <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="var(--muted)" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <span style={{ color: selected.has(path) ? 'var(--text)' : 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
              </>
            )}
          </div>
          {isDir && isExpanded && (
            <div>{renderNode(node.__children, depth + 1, path)}</div>
          )}
        </div>
      )
    })
  }

  return <div>{renderNode(nodes)}</div>
}

// ── Main WikiPage ─────────────────────────────────────────────────────────────
export default function WikiPage({ onToast, onFileCreated }) {
  const [status, setStatus]             = useState(null)
  const [repos, setRepos]               = useState([])
  const [repoSearch, setRepoSearch]     = useState('')
  const [selectedRepo, setSelectedRepo] = useState(null)
  const [tree, setTree]                 = useState([])
  const [treeLoading, setTreeLoading]   = useState(false)
  const [selectedFiles, setSelectedFiles] = useState(new Set())
  const [prompt, setPrompt]             = useState('')
  const [generating, setGenerating]     = useState(false)
  const [genError, setGenError]         = useState('')

  useEffect(() => { loadStatus() }, [])

  const loadStatus = () =>
    getGitHubStatus()
      .then(s => {
        setStatus(s)
        if (s.connected) loadRepos()
      })
      .catch(() => setStatus({ connected: false, configured: false, accounts: [] }))

  const loadRepos = () =>
    listGitHubRepos()
      .then(setRepos)
      .catch(() => onToast('Failed to load repos', 'error'))

  const handleDisconnect = async (login) => {
    try {
      await disconnectGitHub(login)
      onToast(login ? `Disconnected @${login}` : 'Disconnected all accounts')
      setSelectedRepo(null)
      setTree([])
      loadStatus()
    } catch {
      onToast('Disconnect failed', 'error')
    }
  }

  const handleSelectRepo = async (repo) => {
    setSelectedRepo(repo)
    setSelectedFiles(new Set())
    setTree([])
    setTreeLoading(true)
    try {
      const data = await getGitHubTree(repo.full_name, repo.default_branch)
      setTree(data || [])
    } catch {
      onToast('Failed to load file tree', 'error')
    } finally {
      setTreeLoading(false)
    }
  }

  const toggleFile = (path) => {
    setSelectedFiles(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const handleGenerate = async () => {
    if (!prompt.trim()) { onToast('Enter a prompt first', 'error'); return }
    if (selectedFiles.size === 0) { onToast('Select at least one file', 'error'); return }
    setGenerating(true)
    setGenError('')
    try {
      const meta = await generateWiki({
        repo: selectedRepo.full_name,
        branch: selectedRepo.default_branch,
        files: [...selectedFiles],
        prompt: prompt.trim(),
      })
      onToast(`Wiki doc created: ${meta.name}`)
      onFileCreated(meta)
    } catch (e) {
      const msg = e?.response?.data?.error || 'Generation failed'
      setGenError(msg)
      onToast(msg, 'error')
    } finally {
      setGenerating(false)
    }
  }

  if (!status) {
    return <div className="loading-overlay"><span className="spinner" /></div>
  }

  const accounts = status.accounts || []

  // ── Not connected ─────────────────────────────────────────────────────────
  if (!status.connected) {
    return (
      <div style={{ maxWidth: 480 }}>
        <div className="card">
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', padding: '2.5rem 1.5rem', textAlign: 'center' }}>
            <GitHubIcon size={40} />
            <div>
              <h3 style={{ marginBottom: '0.5rem' }}>Living Wiki</h3>
              <p style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>
                Connect your GitHub account and AI provider in <strong>Settings</strong>, then come back here to generate wiki docs from your repos.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Repo list ─────────────────────────────────────────────────────────────
  if (!selectedRepo) {
    const filtered = repos.filter(r =>
      r.full_name.toLowerCase().includes(repoSearch.toLowerCase()) ||
      (r.description || '').toLowerCase().includes(repoSearch.toLowerCase())
    )
    return (
      <div style={{ maxWidth: 640 }}>
        {/* Connected accounts */}
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <GitHubIcon size={15} />
              <h2>GitHub Accounts</h2>
              <span className="badge">{accounts.length}</span>
            </div>
          </div>
          <div className="card-body" style={{ padding: '0.5rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {accounts.map(login => (
              <div key={login} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.375rem 0.25rem' }}>
                <GitHubIcon size={14} />
                <span style={{ flex: 1, fontSize: '0.875rem', fontWeight: 500 }}>@{login}</span>
                <button className="btn-danger-sm" onClick={() => handleDisconnect(login)}>Disconnect</button>
              </div>
            ))}
          </div>
        </div>

        {/* Repo list */}
        <div className="card">
          <div className="card-header">
            <h2>Select a Repository</h2>
            {repos.length > 0 && <span className="badge">{repos.length}</span>}
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <input
              placeholder="Search repositories…"
              value={repoSearch}
              onChange={e => setRepoSearch(e.target.value)}
              style={{ width: '100%' }}
              autoFocus
            />
            <div style={{ maxHeight: 400, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              {filtered.length === 0 && (
                <div className="empty-state">No repositories found.</div>
              )}
              {filtered.map(r => (
                <div key={r.id} className="file-item" onClick={() => handleSelectRepo(r)}>
                  <div className="file-icon"><GitHubIcon size={16} /></div>
                  <div className="file-info">
                    <div className="file-name">{r.full_name}</div>
                    {r.description && <div className="file-meta">{r.description}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: '0.375rem', flexShrink: 0 }}>
                    {r.private && (
                      <span style={{ fontSize: '0.6875rem', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, padding: '0.1rem 0.4rem', color: 'var(--muted)' }}>private</span>
                    )}
                    <span style={{ fontSize: '0.6875rem', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 4, padding: '0.1rem 0.4rem', color: 'var(--accent)' }}>@{r.account}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── File tree + generate ──────────────────────────────────────────────────
  const blobs = tree.filter(n => n.type === 'blob')

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '1.5rem', alignItems: 'start' }}>
      {/* File tree */}
      <div className="card">
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <GitHubIcon size={15} />
            <h2 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedRepo.full_name}</h2>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0, alignItems: 'center' }}>
            {blobs.length > 0 && (
              <button
                className="btn-secondary"
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
                onClick={() => {
                  if (selectedFiles.size === blobs.length) {
                    setSelectedFiles(new Set())
                  } else {
                    setSelectedFiles(new Set(blobs.map(n => n.path)))
                  }
                }}
              >
                {selectedFiles.size === blobs.length ? 'Deselect all' : 'Select all'}
              </button>
            )}
            {selectedFiles.size > 0 && <span className="badge">{selectedFiles.size}</span>}
            <button className="btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }} onClick={() => { setSelectedRepo(null); setTree([]) }}>← Back</button>
          </div>
        </div>
        <div className="card-body" style={{ padding: '0.75rem' }}>
          {treeLoading ? (
            <div className="loading-overlay" style={{ minHeight: 200 }}><span className="spinner" /> Loading tree…</div>
          ) : blobs.length === 0 ? (
            <div className="empty-state">No files found in this repository.</div>
          ) : (
            <div style={{ maxHeight: 500, overflowY: 'auto' }}>
              <FileTree tree={tree} selected={selectedFiles} onToggle={toggleFile} />
            </div>
          )}
        </div>
      </div>

      {/* Generate panel */}
      <div className="card">
        <div className="card-header"><h2>Generate Wiki Doc</h2></div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--muted)', marginBottom: '0.375rem' }}>
              {selectedFiles.size === 0 ? 'No files selected' : `${selectedFiles.size} file${selectedFiles.size > 1 ? 's' : ''} selected`}
            </div>
            {selectedFiles.size > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', maxHeight: 120, overflowY: 'auto' }}>
                {[...selectedFiles].map(f => (
                  <div key={f} style={{ fontSize: '0.75rem', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f}</span>
                    <button className="btn-icon" style={{ width: 18, height: 18 }} onClick={() => toggleFile(f)}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="auth-field">
            <label>Prompt</label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Describe what you want the wiki doc to cover…"
              rows={5}
              style={{
                width: '100%', resize: 'vertical',
                background: 'var(--surface2)', border: '1px solid var(--border)',
                borderRadius: 6, color: 'var(--text)', padding: '0.5rem 0.75rem',
                fontFamily: 'inherit', fontSize: '0.875rem', outline: 'none',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'}
            />
          </div>

          {genError && <div className="auth-error">{genError}</div>}

          <button
            className="btn-primary"
            onClick={handleGenerate}
            disabled={generating || selectedFiles.size === 0 || !prompt.trim()}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
          >
            {generating
              ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Generating…</>
              : 'Generate with Claude →'
            }
          </button>

          <p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
            The doc will be saved as a .md file and opened in the Viewer.
          </p>
        </div>
      </div>
    </div>
  )
}
