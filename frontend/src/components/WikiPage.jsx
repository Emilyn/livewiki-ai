import { useState, useEffect, useCallback, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import mermaid from 'mermaid'
import DOMPurify from 'dompurify'
import {
  getGitHubStatus,
  listGitHubRepos,
  getGitLabStatus,
  listGitLabRepos,
  listWikis, getWikiPage, generateWikiV2, deleteWikiV2, wikiChat,
  listTemplates,
} from '../api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

mermaid.initialize({ startOnLoad: false, theme: 'dark', darkMode: true })

function GitHubIcon({ size = 16 }) {
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
function IconChat({ size = 14 }) {
  return <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
}
function IconSend({ size = 14 }) {
  return <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
}
function IconExpand({ size = 14 }) {
  return <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
}
function IconCollapse({ size = 14 }) {
  return <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/></svg>
}

// ── Chat panel ────────────────────────────────────────────────────────────────
function ChatPanel({ wikiSlug, onClose, expanded = false, onToggleExpand, messages, setMessages, input, setInput, loading, setLoading }) {
  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])
  useEffect(() => { inputRef.current?.focus() }, [])

  const handleSend = async () => {
    const q = input.trim()
    if (!q || loading) return
    const newMessages = [...messages, { role: 'user', content: q }]
    setMessages(newMessages)
    setInput('')
    setLoading(true)
    try {
      const history = newMessages.slice(0, -1).map(m => ({ role: m.role, content: m.content }))
      const { answer } = await wikiChat(wikiSlug, q, history)
      setMessages(m => [...m, { role: 'assistant', content: answer }])
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', content: `Error: ${e?.response?.data?.error || 'Something went wrong'}` }])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <IconChat size={14} />
        <span className="font-semibold text-sm flex-1">Ask AI</span>
        {onToggleExpand && (
          <Button variant="ghost" size="icon-xs" onClick={onToggleExpand} title={expanded ? 'Collapse' : 'Expand'}>
            {expanded ? <IconCollapse size={13} /> : <IconExpand size={13} />}
          </Button>
        )}
        <Button variant="ghost" size="icon-xs" onClick={onClose} title="Close chat">✕</Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4 min-h-0">
        {messages.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <div className="text-2xl mb-3">💬</div>
            <p className="font-medium text-sm mb-1">Ask anything about this repo</p>
            <p className="text-xs">How does auth work? What does X module do?</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={cn('flex gap-2.5 items-start', msg.role === 'user' && 'flex-row-reverse')}>
            <div className={cn(
              'h-7 w-7 rounded-full shrink-0 flex items-center justify-center text-xs font-bold border border-border',
              msg.role === 'user' ? 'bg-sky-400 text-white border-sky-400' : 'bg-muted text-muted-foreground'
            )}>
              {msg.role === 'user' ? 'U' : 'AI'}
            </div>
            <div className={cn(
              'max-w-[82%] rounded-xl px-3 py-2.5 text-sm border',
              msg.role === 'user'
                ? 'bg-sky-400/10 border-sky-400/20'
                : 'bg-muted border-border'
            )}>
              {msg.role === 'assistant' ? (
                <div className="md-body text-sm">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                </div>
              ) : (
                <span>{msg.content}</span>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-2.5 items-start">
            <div className="h-7 w-7 rounded-full bg-muted border border-border flex items-center justify-center text-xs font-bold text-muted-foreground shrink-0">AI</div>
            <div className="bg-muted border border-border rounded-xl px-3 py-3 flex gap-1.5 items-center">
              {[0,1,2].map(i => (
                <div key={i} className="h-1.5 w-1.5 rounded-full bg-muted-foreground" style={{ animation: `chat-bounce 1.2s ${i * 0.2}s infinite` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-border shrink-0">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question… (Enter to send)"
            rows={2}
            disabled={loading}
            className="flex-1 resize-none rounded-lg border border-input bg-muted/50 px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:opacity-50 dark:bg-input/30"
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="self-stretch px-3"
          >
            <IconSend size={14} />
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5">Shift+Enter for new line</p>
      </div>
    </div>
  )
}

// ── Mermaid block ─────────────────────────────────────────────────────────────
function MermaidBlock({ code }) {
  const [svg, setSvg]   = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    const id = 'mermaid-' + Math.random().toString(36).slice(2)
    mermaid.render(id, code)
      .then(({ svg }) => setSvg(DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ['style', 'foreignObject', 'div', 'span'], ADD_ATTR: ['xmlns', 'dominant-baseline', 'requiredFeatures'] })))
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

// ── Generating overlay ────────────────────────────────────────────────────────
const DEFAULT_PAGE_TITLES = ['Overview', 'Architecture', 'Project Structure', 'Core Modules', 'Data Flow']

function GeneratingOverlay({ repo, pages = DEFAULT_PAGE_TITLES }) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    setStep(0)
    const interval = setInterval(() => setStep(s => Math.min(s + 1, pages.length - 1)), 12000)
    return () => clearInterval(interval)
  }, [pages])

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-6 text-center p-6">
      <div className="h-12 w-12 rounded-full bg-sky-400/15 flex items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-[3px] border-border border-t-sky-400" />
      </div>
      <div>
        <p className="font-semibold text-base mb-1">Generating wiki for {repo}</p>
        <p className="text-sm text-muted-foreground">Analyzing codebase and writing documentation…</p>
      </div>
      <div className="flex flex-col gap-2.5 w-full max-w-xs">
        {pages.map((title, i) => (
          <div key={title} className="flex items-center gap-2.5 text-sm">
            <div className={cn(
              'h-5 w-5 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold transition-all border',
              i < step ? 'bg-green-500 border-green-500 text-white'
                : i === step ? 'bg-sky-400 border-sky-400 text-white'
                : 'bg-muted border-border text-muted-foreground'
            )}>
              {i < step ? '✓' : i + 1}
            </div>
            <span className={cn('transition-colors', i <= step ? 'text-foreground' : 'text-muted-foreground')}>
              {title}
            </span>
            {i === step && (
              <div className="h-3 w-3 ml-auto animate-spin rounded-full border-2 border-border border-t-sky-400" />
            )}
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
    <div className="flex flex-col items-center justify-center h-full min-h-[300px] gap-3 text-muted-foreground">
      <span className="opacity-50"><IconBook size={36} /></span>
      <div className="text-center">
        <p className="font-semibold text-sm">Select a page</p>
        <p className="text-xs mt-1">Choose a page from the sidebar</p>
      </div>
    </div>
  )

  if (loading) return (
    <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" /> Loading…
    </div>
  )

  return (
    <div className="p-6 overflow-y-auto">
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
  const [ghStatus, setGhStatus]     = useState(null)
  const [glStatus, setGlStatus]     = useState(null)
  const [repos, setRepos]           = useState([])
  const [repoSearch, setRepoSearch] = useState('')

  const [wikis, setWikis]           = useState([])
  const [wikisLoaded, setWikisLoaded] = useState(false)

  const [activeWiki, setActiveWiki] = useState(null)
  const [activePage, setActivePage] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [genRepo, setGenRepo]       = useState('')
  const [genPages, setGenPages]     = useState(DEFAULT_PAGE_TITLES)

  const [view, setView]             = useState('list')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [showChat, setShowChat]       = useState(false)
  const [chatExpanded, setChatExpanded] = useState(false)
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput]       = useState('')
  const [chatLoading, setChatLoading]   = useState(false)
  const [expandedRepo, setExpandedRepo] = useState(null)
  const [branchInput, setBranchInput]   = useState('')
  const [pageSearch, setPageSearch]     = useState('')
  const [copiedShare, setCopiedShare]   = useState(false)
  const [templates, setTemplates] = useState([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [showRegenModal, setShowRegenModal] = useState(false)
  const [regenBranch, setRegenBranch] = useState('')
  const [regenTemplateId, setRegenTemplateId] = useState('')

  const selectClass = "h-7 rounded border border-input bg-background px-2 text-xs outline-none focus:border-ring dark:bg-input/30"

  useEffect(() => {
    const ghPromise = getGitHubStatus()
      .then(s => { setGhStatus(s); return s })
      .catch(() => { const s = { connected: false, configured: false, accounts: [] }; setGhStatus(s); return s })
    const glPromise = getGitLabStatus()
      .then(s => { setGlStatus(s); return s })
      .catch(() => { const s = { connected: false, configured: false, accounts: [] }; setGlStatus(s); return s })

    Promise.all([ghPromise, glPromise]).then(([gh, gl]) => {
      const fetches = []
      if (gh.connected) fetches.push(listGitHubRepos().then(r => r.map(x => ({ ...x, source: 'github' }))).catch(() => []))
      if (gl.connected) fetches.push(listGitLabRepos().catch(() => []))
      Promise.all(fetches).then(results => setRepos(results.flat()))
    })

    listWikis()
      .then(w => { setWikis(w || []); setWikisLoaded(true) })
      .catch(() => setWikisLoaded(true))
    listTemplates().then(setTemplates).catch(() => {})
  }, [])

  const handleGenerate = useCallback(async (repo, branch, templateId = '') => {
    if (templateId) {
      const tpl = templates.find(t => t.id === templateId)
      setGenPages(tpl ? tpl.pages.map(p => p.title) : DEFAULT_PAGE_TITLES)
    } else {
      setGenPages(DEFAULT_PAGE_TITLES)
    }
    setGenerating(true)
    setGenRepo(repo.full_name)
    setView('generating')
    try {
      const meta = await generateWikiV2(repo.full_name, branch || repo.default_branch, templateId, repo.source || 'github')
      setWikis(w => {
        const idx = w.findIndex(x => x.repo_slug === meta.repo_slug)
        if (idx >= 0) { const next = [...w]; next[idx] = meta; return next }
        return [...w, meta]
      })
      setActiveWiki(meta)
      setActivePage(meta.pages[0] || null)
      setView('wiki')
      const regen = meta.regenerated_pages
      if (Array.isArray(regen) && regen.length === 0) onToast('Already up to date — no changes detected')
      else if (Array.isArray(regen) && regen.length < meta.pages.length) onToast(`Updated ${regen.length} page${regen.length !== 1 ? 's' : ''}: ${regen.join(', ')}`)
      else onToast(`Wiki generated for ${repo.full_name}`)
    } catch (e) {
      onToast(e?.response?.data?.error || 'Generation failed', 'error')
      setView('list')
    } finally {
      setGenerating(false)
    }
  }, [onToast, templates])

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

  // ── Not connected ──────────────────────────────────────────────────────────
  if (!ghStatus || !glStatus) return (
    <div className="flex items-center justify-center h-40">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
    </div>
  )

  const anyConnected = ghStatus.connected || glStatus.connected
  if (!anyConnected) {
    return (
      <Card className="max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="flex gap-3">
            <GitHubIcon size={32} />
            <GitLabIcon size={32} />
          </div>
          <div>
            <h3 className="font-semibold text-base mb-1.5">Living Wiki</h3>
            <p className="text-sm text-muted-foreground">
              Connect your GitHub or GitLab account and AI provider in <strong>Settings</strong>, then come back here to auto-generate wiki docs from your repos.
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  // ── Generating overlay ─────────────────────────────────────────────────────
  if (view === 'generating') {
    return (
      <Card className="max-w-lg">
        <CardContent className="p-0">
          <GeneratingOverlay repo={genRepo} pages={genPages} />
        </CardContent>
      </Card>
    )
  }

  // ── Wiki viewer ────────────────────────────────────────────────────────────
  if (view === 'wiki' && activeWiki) {
    return (
      <div className="flex flex-col gap-4 h-full">
        {/* Wiki header */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setView('list')}>← All wikis</Button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {activeWiki.source === 'gitlab' ? <GitLabIcon size={13} /> : <GitHubIcon size={13} />}
            <span className="font-semibold text-sm truncate">{activeWiki.repo}</span>
            <div className="flex gap-1 flex-wrap">
              {activeWiki.stack?.map(s => (
                <span key={s} className="text-[11px] bg-sky-400/10 text-sky-400 border border-sky-400/20 rounded px-1.5 py-0.5">{s}</span>
              ))}
              {activeWiki.has_custom_config && (
                <span className="text-[11px] bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20 rounded px-1.5 py-0.5">wiki.json</span>
              )}
            </div>
          </div>
          <div className="flex gap-1.5 shrink-0 flex-wrap">
            {activeWiki.share_token && (
              <Button
                variant="outline"
                size="sm"
                className={cn('flex items-center gap-1.5', copiedShare && 'text-green-500')}
                onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}/share/${activeWiki.share_token}`)
                  setCopiedShare(true)
                  setTimeout(() => setCopiedShare(false), 2000)
                }}
              >
                <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M9 17H7A5 5 0 017 7h2"/><path d="M15 7h2a5 5 0 110 10h-2"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                {copiedShare ? 'Copied!' : 'Share'}
              </Button>
            )}
            <Button
              variant={showChat ? 'default' : 'outline'}
              size="sm"
              className="flex items-center gap-1.5"
              onClick={() => { setShowChat(v => !v); setChatExpanded(false) }}
            >
              <IconChat size={12} /> {showChat ? 'Close Chat' : 'Ask AI'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex items-center gap-1.5"
              onClick={() => {
                setRegenBranch(activeWiki.branch)
                setRegenTemplateId(activeWiki.template_id || '')
                setShowRegenModal(true)
              }}
            >
              <IconRefresh size={12} /> Regenerate
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="flex items-center gap-1.5"
              onClick={() => setConfirmDelete(activeWiki)}
            >
              <IconTrash size={12} /> Delete
            </Button>
          </div>
        </div>

        {/* Wiki layout */}
        <div className={cn(
          'grid gap-4 items-start',
          showChat && !chatExpanded ? 'grid-cols-[180px_1fr_340px]' : 'grid-cols-[180px_1fr]'
        )}>
          {/* Page sidebar */}
          <Card>
            <div className="p-2 space-y-0.5">
              <Input
                placeholder="Search pages…"
                value={pageSearch}
                onChange={e => setPageSearch(e.target.value)}
                className="h-7 text-xs mb-2"
              />
              {activeWiki.pages
                .filter(p => p.title.toLowerCase().includes(pageSearch.toLowerCase()))
                .map(page => {
                  const isActive = activePage?.id === page.id && !showChat
                  const wasUpdated = activeWiki.regenerated_pages?.includes(page.title)
                  return (
                    <button
                      key={page.id}
                      onClick={() => { setActivePage(page); setShowChat(false) }}
                      className={cn(
                        'flex items-center gap-2 w-full rounded-lg px-2.5 py-2 text-xs transition-colors text-left',
                        isActive
                          ? 'bg-sky-400/10 text-sky-400 border border-sky-400/20 font-semibold'
                          : 'text-foreground hover:bg-muted border border-transparent'
                      )}
                    >
                      <IconBook size={12} />
                      <span className="flex-1">{page.title}</span>
                      {wasUpdated && <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" title="Updated" />}
                    </button>
                  )
                })
              }
              <div className="border-t border-border mt-1 pt-1">
                <button
                  onClick={() => { setShowChat(v => !v); setChatExpanded(false) }}
                  className={cn(
                    'flex items-center gap-2 w-full rounded-lg px-2.5 py-2 text-xs transition-colors text-left',
                    showChat
                      ? 'bg-sky-400/10 text-sky-400 border border-sky-400/20 font-semibold'
                      : 'text-muted-foreground hover:bg-muted border border-transparent hover:text-foreground'
                  )}
                >
                  <IconChat size={12} /> Ask AI
                </button>
              </div>
            </div>
          </Card>

          {/* Main content or expanded chat */}
          <Card className={cn(
            'min-h-[500px] flex flex-col',
            showChat && chatExpanded && 'sticky top-4 max-h-[calc(100vh-8rem)] overflow-hidden'
          )}>
            {showChat && chatExpanded
              ? <ChatPanel
                  wikiSlug={activeWiki.repo_slug}
                  onClose={() => { setShowChat(false); setChatExpanded(false); setChatMessages([]); setChatInput('') }}
                  expanded
                  onToggleExpand={() => setChatExpanded(false)}
                  messages={chatMessages} setMessages={setChatMessages}
                  input={chatInput} setInput={setChatInput}
                  loading={chatLoading} setLoading={setChatLoading}
                />
              : <WikiPageViewer wikiSlug={activeWiki.repo_slug} page={activePage} />
            }
          </Card>

          {/* Side chat panel */}
          {showChat && !chatExpanded && (
            <Card className="min-h-[500px] flex flex-col sticky top-4 max-h-[calc(100vh-8rem)] overflow-hidden">
              <ChatPanel
                wikiSlug={activeWiki.repo_slug}
                onClose={() => { setShowChat(false); setChatMessages([]); setChatInput('') }}
                expanded={false}
                onToggleExpand={() => setChatExpanded(true)}
                messages={chatMessages} setMessages={setChatMessages}
                input={chatInput} setInput={setChatInput}
                loading={chatLoading} setLoading={setChatLoading}
              />
            </Card>
          )}
        </div>

        {/* Regen modal */}
        <Dialog open={showRegenModal} onOpenChange={open => !open && setShowRegenModal(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Regenerate wiki</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="flex items-center gap-3">
                <label className="text-sm text-muted-foreground w-20 shrink-0">Branch:</label>
                <Input value={regenBranch} onChange={e => setRegenBranch(e.target.value)} className="flex-1 h-8" />
              </div>
              {templates.length > 0 && (
                <div className="flex items-center gap-3">
                  <label className="text-sm text-muted-foreground w-20 shrink-0">Template:</label>
                  <select className={cn(selectClass, 'flex-1 h-8')} value={regenTemplateId} onChange={e => setRegenTemplateId(e.target.value)}>
                    <option value="">Default (5 pages)</option>
                    {templates.map(t => <option key={t.id} value={t.id}>{t.name} ({t.pages?.length || 0} pages)</option>)}
                  </select>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowRegenModal(false)}>Cancel</Button>
              <Button onClick={() => {
                setShowRegenModal(false)
                const repo = repos.find(r => r.full_name === activeWiki.repo && (r.source || 'github') === (activeWiki.source || 'github'))
                  || repos.find(r => r.full_name === activeWiki.repo)
                if (repo) handleGenerate(repo, regenBranch, regenTemplateId)
                else handleGenerate({ full_name: activeWiki.repo, default_branch: activeWiki.branch, source: activeWiki.source || 'github' }, regenBranch, regenTemplateId)
              }}>
                Regenerate
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete confirm modal */}
        <Dialog open={!!confirmDelete} onOpenChange={open => !open && setConfirmDelete(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="text-destructive"><IconTrash size={16} /></span>
                Delete wiki?
              </DialogTitle>
              <DialogDescription>
                This will permanently delete the wiki for <strong>{confirmDelete?.repo}</strong>.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
              <Button variant="destructive" onClick={() => confirmDelete && handleDeleteWiki(confirmDelete)}>Delete</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  // ── Repo picker ────────────────────────────────────────────────────────────
  if (view === 'new') {
    const filtered = repos.filter(r =>
      r.full_name.toLowerCase().includes(repoSearch.toLowerCase()) ||
      (r.description || '').toLowerCase().includes(repoSearch.toLowerCase())
    )
    return (
      <div className="max-w-xl">
        <div className="flex items-center gap-3 mb-4">
          <Button variant="outline" size="sm" onClick={() => setView('list')}>← Back</Button>
          <h3 className="text-sm font-semibold">Select a repository to document</h3>
        </div>
        <Card>
          <div className="p-4 space-y-3">
            <Input
              placeholder="Search repositories…"
              value={repoSearch}
              onChange={e => setRepoSearch(e.target.value)}
              autoFocus
            />
            <div className="max-h-[420px] overflow-y-auto flex flex-col gap-1">
              {filtered.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">No repositories found.</p>
              )}
              {filtered.map(r => {
                const isExpanded = expandedRepo === r.id
                return (
                  <div
                    key={r.id}
                    className={cn(
                      'rounded-lg border transition-colors',
                      isExpanded ? 'border-sky-400/30' : 'border-transparent'
                    )}
                  >
                    <div
                      className={cn(
                        'flex items-center gap-2.5 rounded-lg px-3 py-2.5 cursor-pointer transition-colors',
                        isExpanded ? 'rounded-b-none bg-muted/60' : 'hover:bg-muted'
                      )}
                      onClick={() => {
                        if (isExpanded) { setExpandedRepo(null) }
                        else { setExpandedRepo(r.id); setBranchInput(r.default_branch || 'main') }
                      }}
                    >
                      <span className="text-muted-foreground shrink-0">
                        {r.source === 'gitlab' ? <GitLabIcon size={15} /> : <GitHubIcon size={15} />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{r.full_name}</p>
                        {r.description && <p className="text-xs text-muted-foreground truncate">{r.description}</p>}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {r.private && <Badge variant="secondary" className="text-[10px]">private</Badge>}
                        <span className="text-[11px] bg-sky-400/10 border border-sky-400/20 text-sky-400 rounded px-1.5 py-0.5">@{r.account}</span>
                        <span className="text-xs text-sky-400 font-medium">{isExpanded ? '▲' : 'Select →'}</span>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="px-4 py-3 bg-muted/40 border-t border-border rounded-b-lg space-y-2.5">
                        <div className="flex items-center gap-3">
                          <label className="text-xs text-muted-foreground w-16 shrink-0">Branch:</label>
                          <Input
                            value={branchInput}
                            onChange={e => setBranchInput(e.target.value)}
                            onClick={e => e.stopPropagation()}
                            onKeyDown={e => { if (e.key === 'Enter') handleGenerate(r, branchInput, selectedTemplateId) }}
                            className="flex-1 h-7 text-xs"
                            autoFocus
                          />
                        </div>
                        {templates.length > 0 && (
                          <div className="flex items-center gap-3">
                            <label className="text-xs text-muted-foreground w-16 shrink-0">Template:</label>
                            <select
                              value={selectedTemplateId}
                              onChange={e => setSelectedTemplateId(e.target.value)}
                              onClick={e => e.stopPropagation()}
                              className={cn(selectClass, 'flex-1')}
                            >
                              <option value="">Default (5 pages)</option>
                              {templates.map(t => <option key={t.id} value={t.id}>{t.name} ({t.pages?.length || 0} pages)</option>)}
                            </select>
                          </div>
                        )}
                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            className="flex items-center gap-1.5"
                            onClick={e => { e.stopPropagation(); handleGenerate(r, branchInput, selectedTemplateId) }}
                          >
                            <IconSparkle size={12} /> Generate
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </Card>
      </div>
    )
  }

  // ── Wiki list (home) ───────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl">
      <div className="flex items-start justify-between mb-5 gap-4">
        <div>
          <h2 className="font-semibold text-base mb-1">Your Wikis</h2>
          <p className="text-sm text-muted-foreground">Auto-generated documentation from your GitHub and GitLab repositories</p>
        </div>
        <Button
          className="flex items-center gap-1.5 shrink-0"
          onClick={() => { setRepoSearch(''); setView('new') }}
        >
          <IconSparkle size={13} /> New wiki
        </Button>
      </div>

      {!wikisLoaded ? (
        <div className="flex items-center justify-center h-32">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
        </div>
      ) : wikis.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-5 py-12 text-center">
            <div className="h-14 w-14 rounded-full bg-sky-400/10 flex items-center justify-center text-sky-400">
              <IconBook size={24} />
            </div>
            <div>
              <p className="font-semibold text-base mb-2">No wikis yet</p>
              <p className="text-sm text-muted-foreground max-w-sm">
                Select a GitHub repository and let the AI automatically analyze its codebase and generate structured documentation.
              </p>
            </div>
            <Button className="flex items-center gap-1.5" onClick={() => { setRepoSearch(''); setView('new') }}>
              <IconSparkle size={13} /> Generate your first wiki
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2.5">
          {wikis.map(wiki => (
            <div
              key={wiki.repo_slug}
              className="rounded-xl border border-border bg-card cursor-pointer hover:border-sky-400/40 transition-colors"
              onClick={() => handleOpenWiki(wiki)}
            >
              <div className="flex items-center gap-3.5 px-5 py-4">
                <div className="h-10 w-10 rounded-lg bg-sky-400/10 flex items-center justify-center shrink-0 text-sky-400">
                  <IconBook size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                    {wiki.source === 'gitlab' ? <GitLabIcon size={12} /> : <GitHubIcon size={12} />}
                    <span className="font-semibold text-sm truncate">{wiki.repo}</span>
                    <Badge variant="secondary" className="text-[10px]">{wiki.branch}</Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                    <span>{wiki.pages?.length || 0} pages</span>
                    <span>·</span>
                    <span>{new Date(wiki.generated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    {wiki.stack?.length > 0 && (
                      <div className="flex gap-1">
                        {wiki.stack.map(s => (
                          <span key={s} className="text-sky-400 bg-sky-400/8 border border-sky-400/15 rounded px-1.5 py-0.5 text-[10px]">{s}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                  title="Delete"
                  onClick={e => { e.stopPropagation(); setConfirmDelete(wiki) }}
                >
                  <IconTrash size={14} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirm */}
      <Dialog open={!!confirmDelete} onOpenChange={open => !open && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="text-destructive"><IconTrash size={16} /></span>
              Delete wiki?
            </DialogTitle>
            <DialogDescription>
              This will permanently delete the wiki for <strong>{confirmDelete?.repo}</strong>.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => confirmDelete && handleDeleteWiki(confirmDelete)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
