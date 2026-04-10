import { useState, useEffect, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import mermaid from 'mermaid'
import DOMPurify from 'dompurify'
import { getFileContent, saveFileContent, getDriveFileContent, saveDriveFileContent, aiInlineEdit } from '../api'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

mermaid.initialize({ startOnLoad: false, theme: 'dark', darkMode: true })

function MermaidBlock({ code }) {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const id = 'mermaid-' + Math.random().toString(36).slice(2)
    mermaid.render(id, code)
      .then(({ svg }) => setSvg(DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ['style', 'foreignObject', 'div', 'span'], ADD_ATTR: ['xmlns', 'dominant-baseline', 'requiredFeatures'] })))
      .catch(e => setError(e.message || 'Diagram error'))
      .finally(() => {
        document.getElementById(`d${id}`)?.remove()
        document.getElementById(id)?.remove()
      })
  }, [code])

  if (error) return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive font-mono">
      Mermaid error: {error}
    </div>
  )
  return (
    <div className="overflow-x-auto my-4 text-center" dangerouslySetInnerHTML={{ __html: svg }} />
  )
}

function CodeBlock({ className, children }) {
  const lang = (className || '').replace('language-', '')
  const code = String(children).trimEnd()
  if (lang === 'mermaid') return <MermaidBlock code={code} />
  return <pre><code className={className}>{code}</code></pre>
}

function Preview({ content }) {
  return (
    <div className="md-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: CodeBlock }}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

const AI_ACTIONS = [
  { label: 'Improve',     instruction: 'Improve the clarity and quality of this text while keeping the same meaning and markdown formatting.' },
  { label: 'Shorter',     instruction: 'Make this text more concise. Remove redundancy but keep all key information and markdown formatting.' },
  { label: 'Longer',      instruction: 'Expand this text with more detail and depth. Keep the same markdown formatting style.' },
  { label: 'Fix grammar', instruction: 'Fix any grammar, spelling, and punctuation issues. Do not change the meaning or structure.' },
  { label: 'Simplify',    instruction: 'Rewrite this in simpler, plainer language that is easy to understand. Keep markdown formatting.' },
]

function AIEditPopover({ anchor, selectedText, onApply, onClose }) {
  const [custom, setCustom]           = useState('')
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState('')
  const [preview, setPreview]         = useState(null)
  const popRef = useRef()

  const posStyle = {
    position: 'fixed',
    top: Math.max(8, anchor.y - 8),
    left: Math.max(8, Math.min(anchor.x, window.innerWidth - 360 - 8)),
    transform: 'translateY(-100%)',
    zIndex: 1000,
    width: 340,
  }

  useEffect(() => {
    const handler = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const run = async (instruction) => {
    setLoading(true)
    setError('')
    setPreview(null)
    try {
      const { result } = await aiInlineEdit(selectedText, instruction)
      setPreview(result)
    } catch (e) {
      setError(e?.response?.data?.error || 'AI request failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      ref={popRef}
      style={posStyle}
      className="rounded-xl border border-border bg-card shadow-2xl p-3 flex flex-col gap-2"
      onMouseDown={e => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-sky-400 flex items-center gap-1">
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path d="M12 3L9.5 9.5 3 12l6.5 2.5L12 21l2.5-6.5L21 12l-6.5-2.5z"/>
          </svg>
          AI Edit
        </span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground leading-none px-0.5 text-base bg-transparent border-none cursor-pointer">×</button>
      </div>

      {/* Quick actions */}
      {!preview && (
        <div className="flex flex-wrap gap-1">
          {AI_ACTIONS.map(a => (
            <button
              key={a.label}
              disabled={loading}
              onClick={() => run(a.instruction)}
              className="text-[0.72rem] px-2 py-1 bg-muted border border-border text-foreground rounded-md cursor-pointer disabled:opacity-50 hover:bg-muted/80 transition-colors"
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* Custom instruction */}
      {!preview && (
        <div className="flex gap-1.5">
          <input
            value={custom}
            onChange={e => setCustom(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && custom.trim()) run(custom.trim()) }}
            placeholder="Custom instruction…"
            disabled={loading}
            className="flex-1 text-[0.8rem] px-2 py-1.5 bg-background border border-border text-foreground rounded-md outline-none focus:border-ring disabled:opacity-50"
          />
          <button
            disabled={loading || !custom.trim()}
            onClick={() => run(custom.trim())}
            className="px-2.5 text-xs bg-sky-400 text-white rounded-md cursor-pointer disabled:opacity-50 hover:bg-sky-500 transition-colors"
          >
            {loading ? '…' : '→'}
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-border border-t-primary" /> Thinking…
        </div>
      )}

      {/* Error */}
      {error && <div className="text-xs text-destructive">{error}</div>}

      {/* Preview + accept/reject */}
      {preview && (
        <>
          <div className="text-[0.78rem] text-muted-foreground bg-muted border border-border rounded-md px-2.5 py-2 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono leading-relaxed">
            {preview}
          </div>
          <div className="flex gap-1.5 justify-end">
            <button
              onClick={() => setPreview(null)}
              className="text-xs px-2.5 py-1.5 bg-muted border border-border text-muted-foreground rounded-md cursor-pointer hover:text-foreground"
            >
              Retry
            </button>
            <button
              onClick={() => onApply(preview)}
              className="text-xs px-3 py-1.5 bg-sky-400 text-white rounded-md cursor-pointer hover:bg-sky-500 transition-colors"
            >
              Apply
            </button>
          </div>
        </>
      )}
    </div>
  )
}

const TOOLBAR = [
  { label: 'B',  labelClass: 'font-bold',   wrap: ['**', '**'],  title: 'Bold' },
  { label: 'I',  labelClass: 'italic',       wrap: ['_', '_'],    title: 'Italic' },
  { label: '`',  labelClass: 'font-mono',    wrap: ['`', '`'],    title: 'Inline code' },
  { label: 'H1', labelClass: '',             prefix: '# ',        title: 'Heading 1' },
  { label: 'H2', labelClass: '',             prefix: '## ',       title: 'Heading 2' },
  { label: 'H3', labelClass: '',             prefix: '### ',      title: 'Heading 3' },
  { label: '—',  labelClass: '',             insert: '\n---\n',   title: 'Horizontal rule' },
  { label: '≡',  labelClass: '',             prefix: '- ',        title: 'List item' },
  { label: '☐',  labelClass: '',             prefix: '- [ ] ',   title: 'Task item' },
  { label: '❝',  labelClass: '',             prefix: '> ',        title: 'Blockquote' },
  { label: '⌥',  labelClass: 'font-mono',    block: '```\n',      title: 'Code block' },
]

export default function MarkdownViewer({ file, onToast }) {
  const [content, setContent] = useState(null)
  const [draft, setDraft]     = useState(null)
  const [mode, setMode]       = useState('view') // 'view' | 'edit' | 'split'
  const [saving, setSaving]   = useState(false)
  const [loading, setLoading] = useState(false)
  const [aiPopover, setAiPopover] = useState(null)
  const [splitPos, setSplitPos] = useState(50) // left pane % in split mode
  const textareaRef  = useRef()
  const containerRef = useRef()
  const isDragging   = useRef(false)

  const handleDividerMouseDown = useCallback((e) => {
    e.preventDefault()
    isDragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMouseMove = (e) => {
      if (!isDragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pos = ((e.clientX - rect.left) / rect.width) * 100
      setSplitPos(Math.min(80, Math.max(20, pos)))
    }

    const onMouseUp = () => {
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [])

  useEffect(() => {
    if (!file) return
    setLoading(true)
    setContent(null)
    setDraft(null)
    setMode('view')
    const fetchContent = file.source === 'drive' ? getDriveFileContent : getFileContent
    fetchContent(file.id)
      .then(text => { setContent(text); setDraft(text) })
      .catch(() => onToast('Failed to load file content', 'error'))
      .finally(() => setLoading(false))
  }, [file])

  const isDirty = draft !== content

  const handleSave = async () => {
    setSaving(true)
    try {
      const saveFn = file.source === 'drive' ? saveDriveFileContent : saveFileContent
      await saveFn(file.id, draft)
      setContent(draft)
      onToast('Saved')
    } catch {
      onToast('Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDiscard = () => setDraft(content)

  const handleTextareaMouseUp = useCallback((e) => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end   = ta.selectionEnd
    if (end <= start) { setAiPopover(null); return }
    const text = draft.slice(start, end).trim()
    if (!text) { setAiPopover(null); return }
    setAiPopover({ x: e.clientX, y: e.clientY, start, end, text })
  }, [draft])

  const handleAiApply = useCallback((result) => {
    if (!aiPopover) return
    const { start, end } = aiPopover
    const next = draft.slice(0, start) + result + draft.slice(end)
    setDraft(next)
    setAiPopover(null)
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (ta) { ta.focus(); ta.setSelectionRange(start, start + result.length) }
    })
  }, [aiPopover, draft])

  const applyFormat = useCallback((action) => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end   = ta.selectionEnd
    const sel   = draft.slice(start, end)
    let next = draft, cursor = start

    if (action.wrap) {
      const [open, close] = action.wrap
      next = draft.slice(0, start) + open + sel + close + draft.slice(end)
      cursor = sel ? end + open.length + close.length : start + open.length
    } else if (action.prefix) {
      const before = draft.slice(0, start)
      const after  = draft.slice(end)
      const lines  = sel || ''
      const prefixed = lines.split('\n').map(l => action.prefix + l).join('\n')
      const insert = sel ? prefixed : action.prefix
      next = before + insert + after
      cursor = start + insert.length
    } else if (action.insert) {
      next = draft.slice(0, start) + action.insert + draft.slice(end)
      cursor = start + action.insert.length
    } else if (action.block) {
      const block = action.block + sel + '\n```'
      next = draft.slice(0, start) + block + draft.slice(end)
      cursor = start + action.block.length + sel.length
    }

    setDraft(next)
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(cursor, cursor)
    })
  }, [draft])

  const handleKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      handleSave()
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = e.target
      const s = ta.selectionStart
      const next = draft.slice(0, s) + '  ' + draft.slice(ta.selectionEnd)
      setDraft(next)
      requestAnimationFrame(() => { ta.setSelectionRange(s + 2, s + 2) })
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center p-12 rounded-xl border border-border bg-card">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
    </div>
  )

  if (content === null) return null

  const inEdit = mode === 'edit' || mode === 'split'

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-sm font-semibold truncate">{file.name}</h2>
          {isDirty && <span className="text-[0.7rem] text-muted-foreground shrink-0">● unsaved</span>}
        </div>
        <div className="flex gap-1.5 items-center shrink-0">
          {['view', 'split', 'edit'].map(m => (
            <Button
              key={m}
              size="xs"
              variant={mode === m ? 'default' : 'outline'}
              onClick={() => setMode(m)}
              className={mode === m ? 'bg-sky-400 hover:bg-sky-500 border-sky-400' : ''}
            >
              {m === 'view' ? 'Preview' : m === 'split' ? 'Split' : 'Edit'}
            </Button>
          ))}
          {isDirty && (
            <>
              <Button size="xs" variant="ghost" onClick={handleDiscard}>Discard</Button>
              <Button size="xs" onClick={handleSave} disabled={saving}
                className="bg-sky-400 hover:bg-sky-500 text-white">
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Toolbar */}
      {inEdit && (
        <div className="flex flex-wrap gap-1 px-4 py-2 border-b border-border bg-muted/50 items-center">
          {TOOLBAR.map((t, i) => (
            <button
              key={i}
              title={t.title}
              onClick={() => applyFormat(t)}
              className={cn(
                'px-2 py-0.5 text-[0.8125rem] bg-card text-foreground border border-border rounded min-w-[30px] hover:bg-muted transition-colors',
                t.labelClass
              )}
            >
              {t.label}
            </button>
          ))}
          <span className="ml-auto text-[0.7rem] text-muted-foreground">
            {navigator.platform.includes('Mac') ? '⌘S' : 'Ctrl+S'} to save
          </span>
        </div>
      )}

      {/* Body */}
      <div ref={containerRef} className="flex flex-1 min-h-0">
        {/* Editor pane */}
        {inEdit && (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onMouseUp={handleTextareaMouseUp}
            spellCheck={false}
            className="resize-none bg-background text-foreground border-none outline-none p-5 font-mono text-sm leading-relaxed min-h-[500px]"
            style={{
              fontFamily: "'Fira Code', 'Cascadia Code', monospace",
              tabSize: 2,
              width: mode === 'split' ? `${splitPos}%` : '100%',
            }}
          />
        )}

        {/* Drag divider */}
        {mode === 'split' && (
          <div
            onMouseDown={handleDividerMouseDown}
            className="relative shrink-0 w-px bg-border hover:bg-sky-400/60 transition-colors cursor-col-resize group"
          >
            {/* wider invisible hit area */}
            <div className="absolute inset-y-0 -left-2 -right-2 cursor-col-resize" />
            {/* handle dots */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              {[0,1,2].map(i => <div key={i} className="w-1 h-1 rounded-full bg-sky-400" />)}
            </div>
          </div>
        )}

        {/* Preview pane */}
        {(mode === 'view' || mode === 'split') && (
          <div
            className="overflow-y-auto p-5"
            style={{
              width: mode === 'split' ? `${100 - splitPos}%` : '100%',
              minHeight: 500,
            }}
          >
            <Preview content={draft ?? content} />
          </div>
        )}
      </div>

      {aiPopover && (
        <AIEditPopover
          anchor={{ x: aiPopover.x, y: aiPopover.y }}
          selectedText={aiPopover.text}
          onApply={handleAiApply}
          onClose={() => setAiPopover(null)}
        />
      )}
    </div>
  )
}
