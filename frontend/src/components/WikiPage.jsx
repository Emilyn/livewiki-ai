import { useState, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import mermaid from 'mermaid'
import {
  getGitHubStatus,
  listGitHubRepos,
  listWikis, getWiki, getWikiPage, generateWikiV2, deleteWikiV2,
} from '../api'

mermaid.initialize({ startOnLoad: false, theme: 'dark', darkMode: true })

// ── Icons ─────────────────────────────────────────────────────────────────────
function GitHubIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
    </svg>
  )
}
function IconBook({ size = 16 }) {
  return <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>
}
function IconSparkle({ size = 16 }) {
  return <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M12 3L9.5 9.5 3 12l6.5 2.5L12 21l2.5-6.5L21 12l-6.5-2.5z"/></svg>
}
function IconTrash({ size = 14 }) {
  return <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
}
function IconRefresh({ size = 14 }) {
  return <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
}

// ── Mermaid block ─────────────────────────────────────────────────────────────
function MermaidBlock({ code }) {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    const id = 'mermaid-' + Math.random().toString(36).slice(2)
    mermaid.render(id, code).then(({ svg }) => setSvg(svg)).catch(e => setError(e.message || 'Diagram error'))
  }, [code])
  if (error) return <pre style={{ color: 'var(--danger)', background: 'var(--surface2)', padding: '0.75rem', borderRadius: 6, fontSize: '0.8125rem' }}>Mermaid error: {error}</pre>
  return <div style={{ overflowX: 'auto', margin: '1rem 0', textAlign: 'center' }} dangerouslySetInnerHTML={{ __html: svg }} />
}

function CodeBlock({ className, children }) {
  const lang = (className || '').replace('language-', '')
  const code = String(children).trimEnd()
  if (lang === 'mermaid') return <MermaidBlock code={code} />
  return <pre><code className={className}>{code}</code></pre>
}

// ── Progress steps ────────────────────────────────────────────────────────────
const PAGE_TITLES = ['Overview', 'Architecture', 'Project Structure', 'Core Modules', 'Data Flow']

function GeneratingOverlay({ repo }) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => setStep(s => Math.min(s + 1, PAGE_TITLES.length - 1)), 12000)
    return () => clearInterval(interval)
  }, [])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: '1.5rem', textAlign: 'center' }}>
      <div style={{ width: 48, height: 48, background: 'rgba(99,102,241,0.15)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="spinner" style={{ width: 24, height: 24, borderWidth: 3 }} />
      </div>
      <div>
        <div style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.375rem' }}>Generating wiki for {repo}</div>
        <div style={{ fontSize: '0.8125rem', color: 'var(--muted)' }}>Analyzing codebase and writing documentation…</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%', maxWidth: 320 }}>
        {PAGE_TITLES.map((title, i) => (
          <div key={title} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', fontSize: '0.8125rem' }}>
            <div style={{
              width: 20, height: 20, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: i < step ? 'var(--success)' : i === step ? 'var(--accent)' : 'var(--surface2)',
              border: `1px solid ${i < step ? 'var(--success)' : i === step ? 'var(--accent)' : 'var(--border)'}`,
              transition: 'all 0.3s',
              fontSize: '0.625rem', color: i <= step ? 'white' : 'var(--muted)',
            }}>
              {i < step ? '✓' : i + 1}
            </div>
            <span style={{ color: i <= step ? 'var(--text)' : 'var(--muted)', transition: 'color 0.3s' }}>{title}</span>
            {i === step && <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2, marginLeft: 'auto' }} />}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Wiki page viewer ──────────────────────────────────────────────────────────
function WikiPageViewer({ wikiSlug, page }) {
  const [content, setContent] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!page) return
    setLoading(true)
    setContent(null)
    getWikiPage(wikiSlug, page.id)
      .then(text => setContent(typeof text === 'string' ? text : JSON.stringify(text)))
      .catch(() => setContent('Failed to load page content.'))
      .finally(() => setLoading(false))
  }, [wikiSlug, page?.id])

  if (!page) return (
    <div className="viewer-placeholder">
      <IconBook size={40} />
      <div><div style={{ fontWeight: 600 }}>Select a page</div><div style={{ fontSize: '0.8125rem', color: 'var(--muted)', marginTop: '0.25rem' }}>Choose a page from the sidebar</div></div>
    </div>
  )

  if (loading) return <div className="loading-overlay"><span className="spinner" /> Loading…</div>

  return (
    <div style={{ padding: '1.5rem', overflowY: 'auto' }}>
      <div className="md-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: CodeBlock }}>
          {content || ''}
        </ReactMarkdown>
      </div>
    </div>
  )
}

// ── Main WikiPage ─────────────────────────────────────────────────────────────
export default function WikiPage({ onToast }) {
  // GitHub + repo state
  const [ghStatus, setGhStatus]     = useState(null)
  const [repos, setRepos]           = useState([])
  const [repoSearch, setRepoSearch] = useState('')

  // Wiki list
  const [wikis, setWikis]           = useState([])
  const [wikisLoaded, setWikisLoaded] = useState(false)

  // Active wiki
  const [activeWiki, setActiveWiki] = useState(null)   // WikiMeta
  const [activePage, setActivePage] = useState(null)   // WikiPageMeta
  const [generating, setGenerating] = useState(false)
  const [genRepo, setGenRepo]       = useState('')

  // UI state
  const [view, setView]             = useState('list') // 'list' | 'new' | 'wiki'
  const [confirmDelete, setConfirmDelete] = useState(null)

  useEffect(() => {
    getGitHubStatus()
      .then(s => {
        setGhStatus(s)
        if (s.connected) {
          listGitHubRepos().then(setRepos).catch(() => {})
        }
      })
      .catch(() => setGhStatus({ connected: false, configured: false, accounts: [] }))

    listWikis()
      .then(w => { setWikis(w || []); setWikisLoaded(true) })
      .catch(() => setWikisLoaded(true))
  }, [])

  const handleGenerate = useCallback(async (repo, branch) => {
    setGenerating(true)
    setGenRepo(repo.full_name)
    setView('generating')
    try {
      const meta = await generateWikiV2(repo.full_name, branch || repo.default_branch)
      setWikis(w => {
        const idx = w.findIndex(x => x.repo_slug === meta.repo_slug)
        if (idx >= 0) { const next = [...w]; next[idx] = meta; return next }
        return [...w, meta]
      })
      setActiveWiki(meta)
      setActivePage(meta.pages[0] || null)
      setView('wiki')
      onToast(`Wiki generated for ${repo.full_name}`)
    } catch (e) {
      onToast(e?.response?.data?.error || 'Generation failed', 'error')
      setView('list')
    } finally {
      setGenerating(false)
    }
  }, [onToast])

  const handleOpenWiki = (wiki) => {
    setActiveWiki(wiki)
    setActivePage(wiki.pages[0] || null)
    setView('wiki')
  }

  const handleDeleteWiki = async (wiki) => {
    setConfirmDelete(null)
    try {
      await deleteWikiV2(wiki.repo_slug)
      setWikis(w => w.filter(x => x.repo_slug !== wiki.repo_slug))
      if (activeWiki?.repo_slug === wiki.repo_slug) { setActiveWiki(null); setView('list') }
      onToast('Wiki deleted')
    } catch { onToast('Delete failed', 'error') }
  }

  // ── Not connected ───────────────────────────────────────────────────────────
  if (!ghStatus) return <div className="loading-overlay"><span className="spinner" /></div>

  if (!ghStatus.connected) {
    return (
      <div style={{ maxWidth: 480 }}>
        <div className="card">
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', padding: '2.5rem 1.5rem', textAlign: 'center' }}>
            <GitHubIcon size={40} />
            <div>
              <h3 style={{ marginBottom: '0.5rem' }}>Living Wiki</h3>
              <p style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>
                Connect your GitHub account and AI provider in <strong>Settings</strong>, then come back here to auto-generate wiki docs from your repos.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Generating overlay ──────────────────────────────────────────────────────
  if (view === 'generating') {
    return (
      <div className="card" style={{ maxWidth: 560 }}>
        <div className="card-body">
          <GeneratingOverlay repo={genRepo} />
        </div>
      </div>
    )
  }

  // ── Wiki viewer ─────────────────────────────────────────────────────────────
  if (view === 'wiki' && activeWiki) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0', height: '100%' }}>
        {/* Wiki header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <button className="btn-secondary" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }} onClick={() => setView('list')}>
            ← All wikis
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: 0 }}>
            <GitHubIcon size={14} />
            <span style={{ fontWeight: 600, fontSize: '0.9375rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeWiki.repo}
            </span>
            <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
              {activeWiki.stack?.map(s => (
                <span key={s} style={{ fontSize: '0.6875rem', background: 'rgba(99,102,241,0.1)', color: 'var(--accent)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 4, padding: '0.1rem 0.4rem' }}>{s}</span>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
            <button
              className="btn-secondary"
              style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}
              onClick={() => {
                const repo = repos.find(r => r.full_name === activeWiki.repo)
                if (repo) handleGenerate(repo, activeWiki.branch)
                else onToast('Repo not found', 'error')
              }}
            >
              <IconRefresh size={12} /> Regenerate
            </button>
            <button
              className="btn-danger-sm"
              style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}
              onClick={() => setConfirmDelete(activeWiki)}
            >
              <IconTrash size={12} /> Delete
            </button>
          </div>
        </div>

        {/* Wiki layout */}
        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '1rem', alignItems: 'start' }}>
          {/* Page sidebar */}
          <div className="card">
            <div className="card-body" style={{ padding: '0.5rem' }}>
              {activeWiki.pages.map(page => (
                <button
                  key={page.id}
                  onClick={() => setActivePage(page)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem',
                    padding: '0.5rem 0.625rem', borderRadius: 6, fontSize: '0.8125rem',
                    background: activePage?.id === page.id ? 'rgba(99,102,241,0.1)' : 'transparent',
                    color: activePage?.id === page.id ? 'var(--accent)' : 'var(--text)',
                    border: `1px solid ${activePage?.id === page.id ? 'rgba(99,102,241,0.25)' : 'transparent'}`,
                    cursor: 'pointer', textAlign: 'left', fontWeight: activePage?.id === page.id ? 600 : 400,
                    transition: 'all 0.12s',
                  }}
                  onMouseEnter={e => { if (activePage?.id !== page.id) e.currentTarget.style.background = 'var(--surface2)' }}
                  onMouseLeave={e => { if (activePage?.id !== page.id) e.currentTarget.style.background = 'transparent' }}
                >
                  <IconBook size={13} />
                  {page.title}
                </button>
              ))}
            </div>
          </div>

          {/* Page content */}
          <div className="card" style={{ minHeight: 500 }}>
            <WikiPageViewer wikiSlug={activeWiki.repo_slug} page={activePage} />
          </div>
        </div>

        {/* Delete confirm modal */}
        {confirmDelete && (
          <div className="modal-backdrop">
            <div className="modal">
              <div className="modal-icon"><IconTrash size={20} /></div>
              <h3>Delete wiki?</h3>
              <p>This will permanently delete the wiki for <strong>{confirmDelete.repo}</strong>.</p>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
                <button className="btn-danger" onClick={() => handleDeleteWiki(confirmDelete)}>Delete</button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Repo picker (new wiki) ──────────────────────────────────────────────────
  if (view === 'new') {
    const filtered = repos.filter(r =>
      r.full_name.toLowerCase().includes(repoSearch.toLowerCase()) ||
      (r.description || '').toLowerCase().includes(repoSearch.toLowerCase())
    )
    return (
      <div style={{ maxWidth: 600 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <button className="btn-secondary" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }} onClick={() => setView('list')}>← Back</button>
          <h3 style={{ fontSize: '0.9375rem' }}>Select a repository to document</h3>
        </div>
        <div className="card">
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <input
              placeholder="Search repositories…"
              value={repoSearch}
              onChange={e => setRepoSearch(e.target.value)}
              style={{ width: '100%' }}
              autoFocus
            />
            <div style={{ maxHeight: 420, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              {filtered.length === 0 && <div className="empty-state">No repositories found.</div>}
              {filtered.map(r => (
                <div
                  key={r.id}
                  className="file-item"
                  onClick={() => handleGenerate(r)}
                >
                  <div className="file-icon"><GitHubIcon size={16} /></div>
                  <div className="file-info">
                    <div className="file-name">{r.full_name}</div>
                    {r.description && <div className="file-meta">{r.description}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: '0.375rem', flexShrink: 0, alignItems: 'center' }}>
                    {r.private && <span style={{ fontSize: '0.6875rem', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, padding: '0.1rem 0.4rem', color: 'var(--muted)' }}>private</span>}
                    <span style={{ fontSize: '0.6875rem', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 4, padding: '0.1rem 0.4rem', color: 'var(--accent)' }}>@{r.account}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 500 }}>Generate →</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Wiki list (home) ────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <div>
          <h2 style={{ fontSize: '1.0625rem', marginBottom: '0.25rem' }}>Your Wikis</h2>
          <p style={{ fontSize: '0.8125rem', color: 'var(--muted)' }}>Auto-generated documentation from your GitHub repositories</p>
        </div>
        <button
          className="btn-primary"
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}
          onClick={() => { setRepoSearch(''); setView('new') }}
        >
          <IconSparkle size={14} /> New wiki
        </button>
      </div>

      {!wikisLoaded ? (
        <div className="loading-overlay"><span className="spinner" /></div>
      ) : wikis.length === 0 ? (
        <div className="card">
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.25rem', padding: '3rem 1.5rem', textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, background: 'rgba(99,102,241,0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <IconBook size={24} />
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.5rem' }}>No wikis yet</div>
              <p style={{ color: 'var(--muted)', fontSize: '0.875rem', maxWidth: 360 }}>
                Select a GitHub repository and let the AI automatically analyze its codebase and generate structured documentation.
              </p>
            </div>
            <button
              className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              onClick={() => { setRepoSearch(''); setView('new') }}
            >
              <IconSparkle size={14} /> Generate your first wiki
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
          {wikis.map(wiki => (
            <div
              key={wiki.repo_slug}
              className="card"
              style={{ cursor: 'pointer', transition: 'border-color 0.12s' }}
              onClick={() => handleOpenWiki(wiki)}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', padding: '1rem 1.25rem' }}>
                <div style={{ width: 40, height: 40, background: 'rgba(99,102,241,0.1)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--accent)' }}>
                  <IconBook size={18} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9375rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <GitHubIcon size={13} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wiki.repo}</span>
                    <span style={{ fontSize: '0.6875rem', color: 'var(--muted)', fontWeight: 400, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, padding: '0.1rem 0.4rem' }}>{wiki.branch}</span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <span>{wiki.pages?.length || 0} pages</span>
                    <span>·</span>
                    <span>{new Date(wiki.generated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    {wiki.stack?.length > 0 && (
                      <div style={{ display: 'flex', gap: '0.25rem' }}>
                        {wiki.stack.map(s => <span key={s} style={{ color: 'var(--accent)', fontSize: '0.6875rem', background: 'rgba(99,102,241,0.08)', borderRadius: 4, padding: '0.1rem 0.35rem', border: '1px solid rgba(99,102,241,0.15)' }}>{s}</span>)}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.375rem', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                  <button
                    className="btn-icon"
                    title="Delete"
                    onClick={() => setConfirmDelete(wiki)}
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmDelete && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-icon"><IconTrash size={20} /></div>
            <h3>Delete wiki?</h3>
            <p>This will permanently delete the wiki for <strong>{confirmDelete.repo}</strong>.</p>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn-danger" onClick={() => handleDeleteWiki(confirmDelete)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
