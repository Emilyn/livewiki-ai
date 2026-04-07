import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import mermaid from 'mermaid'
import DOMPurify from 'dompurify'
import { getWikiShare, getWikiSharePage } from '../api'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

mermaid.initialize({ startOnLoad: false, theme: 'dark', darkMode: true })

function MermaidBlock({ code }) {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    const id = 'mermaid-' + Math.random().toString(36).slice(2)
    mermaid.render(id, code)
      .then(({ svg }) => setSvg(DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } })))
      .catch(() => setError('Invalid diagram syntax'))
      .finally(() => {
        document.getElementById(`d${id}`)?.remove()
        document.getElementById(id)?.remove()
      })
  }, [code])
  if (error) return (
    <div className="rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground italic">
      ⚠ Mermaid diagram could not be rendered
    </div>
  )
  if (!svg) return null
  return <div className="overflow-x-auto my-4 text-center" dangerouslySetInnerHTML={{ __html: svg }} />
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
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-border border-t-primary" />
    </div>
  )

  if (error) return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 text-muted-foreground text-center p-8 bg-background">
      <span className="opacity-50"><IconBook size={40} /></span>
      <div className="font-semibold text-base text-foreground">Wiki not found</div>
      <p className="text-sm">{error}</p>
    </div>
  )

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card px-6 py-3.5 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <GitHubIcon size={15} />
          <span className="font-bold text-base truncate">{wiki.repo}</span>
          <span className="text-[11px] bg-muted border border-border rounded px-1.5 py-0.5 text-muted-foreground shrink-0">
            {wiki.branch}
          </span>
          {wiki.stack?.map(s => (
            <span key={s} className="text-[11px] bg-indigo-500/10 text-indigo-500 border border-indigo-500/20 rounded px-1.5 py-0.5 shrink-0">{s}</span>
          ))}
          {wiki.has_custom_config && (
            <span className="text-[11px] bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20 rounded px-1.5 py-0.5 shrink-0">wiki.json</span>
          )}
        </div>
        <span className="text-xs text-muted-foreground shrink-0">
          Generated {new Date(wiki.generated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
      </header>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* Page sidebar */}
        <aside className="w-52 shrink-0 border-r border-border bg-card flex flex-col p-2 gap-0.5 overflow-y-auto">
          <div className="px-1 pb-2">
            <Input
              placeholder="Search pages…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-7 text-xs"
            />
          </div>
          {filteredPages.map(page => (
            <button
              key={page.id}
              onClick={() => setActivePage(page)}
              className={cn(
                'flex items-center gap-2 w-full rounded-lg px-2.5 py-2 text-sm transition-colors text-left',
                activePage?.id === page.id
                  ? 'bg-indigo-500/10 text-indigo-500 border border-indigo-500/20 font-semibold'
                  : 'text-foreground hover:bg-muted border border-transparent'
              )}
            >
              <span className="shrink-0 text-muted-foreground"><IconBook size={12} /></span>
              {page.title}
            </button>
          ))}
        </aside>

        {/* Content */}
        <main className="flex-1 overflow-y-auto px-8 py-8 max-w-4xl">
          {pageLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" /> Loading…
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
      <footer className="border-t border-border bg-card px-6 py-3 text-xs text-muted-foreground text-center">
        Generated by <strong className="text-foreground">LiveWiki</strong>
      </footer>
    </div>
  )
}
