import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import mermaid from 'mermaid'
import { getWikiShare, getWikiSharePage } from '../api'

mermaid.initialize({ startOnLoad: false, theme: 'dark', darkMode: true })

function MermaidBlock({ code }) {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    const id = 'mermaid-' + Math.random().toString(36).slice(2)
    mermaid.render(id, code)
      .then(({ svg }) => setSvg(svg))
      .catch(() => setError('Invalid diagram syntax'))
      .finally(() => {
        document.getElementById(`d${id}`)?.remove()
        document.getElementById(id)?.remove()
      })
  }, [code])
  if (error) return (
    <div style={{ padding: '0.625rem 0.875rem', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, fontSize: '0.8125rem', color: 'var(--muted)', fontStyle: 'italic' }}>
      ⚠ Mermaid diagram could not be rendered
    </div>
  )
  if (!svg) return null
  return <div style={{ overflowX: 'auto', margin: '1rem 0', textAlign: 'center' }} dangerouslySetInnerHTML={{ __html: svg }} />
}

function CodeBlock({ className, children }) {
  const code = String(children).trimEnd()
  if (!className && !code.includes('\n')) return <code>{children}</code>
  const lang = (className || '').replace('language-', '')
  if (lang === 'mermaid') return <MermaidBlock code={code} />
  return <pre><code className={className}>{code}</code></pre>
}

function IconBook({ size = 16 }) {
  return <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>
}
function GitHubIcon({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
}

export default function SharedWikiPage({ token }) {
  const [wiki, setWiki]       = useState(null)
  const [activePage, setActivePage] = useState(null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [pageLoading, setPageLoading] = useState(false)
  const [error, setError]     = useState('')
  const [search, setSearch]   = useState('')

  useEffect(() => {
    getWikiShare(token)
      .then(meta => {
        setWiki(meta)
        if (meta.pages?.length > 0) setActivePage(meta.pages[0])
      })
      .catch(() => setError('This wiki does not exist or the link has expired.'))
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => {
    if (!activePage) return
    setPageLoading(true)
    setContent('')
    getWikiSharePage(token, activePage.id)
      .then(text => setContent(typeof text === 'string' ? text : JSON.stringify(text)))
      .catch(() => setContent('Failed to load page content.'))
      .finally(() => setPageLoading(false))
  }, [activePage?.id])

  const filteredPages = wiki?.pages?.filter(p =>
    p.title.toLowerCase().includes(search.toLowerCase())
  ) ?? []

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <span className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
    </div>
  )

  if (error) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: '1rem', color: 'var(--muted)', textAlign: 'center', padding: '2rem' }}>
      <IconBook size={40} />
      <div style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text)' }}>Wiki not found</div>
      <div style={{ fontSize: '0.875rem' }}>{error}</div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)' }}>
      {/* Header */}
      <header style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '0.875rem 1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: 0 }}>
          <GitHubIcon size={16} />
          <span style={{ fontWeight: 700, fontSize: '1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wiki.repo}</span>
          <span style={{ fontSize: '0.6875rem', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, padding: '0.1rem 0.4rem', color: 'var(--muted)', flexShrink: 0 }}>{wiki.branch}</span>
          {wiki.stack?.map(s => (
            <span key={s} style={{ fontSize: '0.6875rem', background: 'rgba(99,102,241,0.1)', color: 'var(--accent)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 4, padding: '0.1rem 0.4rem', flexShrink: 0 }}>{s}</span>
          ))}
          {wiki.has_custom_config && (
            <span style={{ fontSize: '0.6875rem', background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 4, padding: '0.1rem 0.4rem', flexShrink: 0 }}>wiki.json</span>
          )}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--muted)', flexShrink: 0 }}>
          Generated {new Date(wiki.generated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
      </header>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Page sidebar */}
        <aside style={{ width: 220, flexShrink: 0, background: 'var(--surface)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', padding: '0.75rem 0.5rem', gap: '0.25rem', overflowY: 'auto' }}>
          <input
            placeholder="Search pages…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ fontSize: '0.8125rem', padding: '0.35rem 0.6rem', marginBottom: '0.375rem' }}
          />
          {filteredPages.map(page => (
            <button
              key={page.id}
              onClick={() => setActivePage(page)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem',
                padding: '0.5rem 0.625rem', borderRadius: 6, fontSize: '0.8125rem',
                background: activePage?.id === page.id ? 'rgba(99,102,241,0.1)' : 'transparent',
                color: activePage?.id === page.id ? 'var(--accent)' : 'var(--text)',
                border: `1px solid ${activePage?.id === page.id ? 'rgba(99,102,241,0.25)' : 'transparent'}`,
                cursor: 'pointer', textAlign: 'left',
                fontWeight: activePage?.id === page.id ? 600 : 400,
                transition: 'all 0.12s',
              }}
            >
              <IconBook size={13} />
              {page.title}
            </button>
          ))}
        </aside>

        {/* Content */}
        <main style={{ flex: 1, overflowY: 'auto', padding: '2rem 2.5rem' }}>
          {pageLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--muted)' }}>
              <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Loading…
            </div>
          ) : (
            <div className="md-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: CodeBlock }}>
                {content}
              </ReactMarkdown>
            </div>
          )}
        </main>
      </div>

      {/* Footer */}
      <footer style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)', padding: '0.625rem 1.5rem', fontSize: '0.75rem', color: 'var(--muted)', textAlign: 'center' }}>
        Generated by <strong style={{ color: 'var(--text)' }}>MDF Viewer Living Wiki</strong>
      </footer>
    </div>
  )
}
