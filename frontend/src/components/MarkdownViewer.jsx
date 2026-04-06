import { useState, useEffect, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import mermaid from 'mermaid'
import DOMPurify from 'dompurify'
import { getFileContent, saveFileContent, getDriveFileContent, saveDriveFileContent, aiInlineEdit } from '../api'

mermaid.initialize({ startOnLoad: false, theme: 'dark', darkMode: true })

function MermaidBlock({ code }) {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const id = 'mermaid-' + Math.random().toString(36).slice(2)
    mermaid.render(id, code)
      .then(({ svg }) => setSvg(DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } })))
      .catch(e => setError(e.message || 'Diagram error'))
  }, [code])

  if (error) return (
    <pre style={{ color: 'var(--danger)', background: 'var(--surface2)', padding: '0.75rem', borderRadius: 6, fontSize: '0.8125rem' }}>
      Mermaid error: {error}
    </pre>
  )
  return (
    <div style={{ overflowX: 'auto', margin: '1rem 0', textAlign: 'center' }}
      dangerouslySetInnerHTML={{ __html: svg }} />
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
  { label: 'Improve', instruction: 'Improve the clarity and quality of this text while keeping the same meaning and markdown formatting.' },
  { label: 'Shorter', instruction: 'Make this text more concise. Remove redundancy but keep all key information and markdown formatting.' },
  { label: 'Longer',  instruction: 'Expand this text with more detail and depth. Keep the same markdown formatting style.' },
  { label: 'Fix grammar', instruction: 'Fix any grammar, spelling, and punctuation issues. Do not change the meaning or structure.' },
  { label: 'Simplify', instruction: 'Rewrite this in simpler, plainer language that is easy to understand. Keep markdown formatting.' },
]

function AIEditPopover({ anchor, selectedText, onApply, onClose }) {
  const [custom, setCustom]     = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [preview, setPreview]   = useState(null)
  const [activeInstr, setActiveInstr] = useState(null)
  const popRef = useRef()

  // Position the popover above the anchor point
  const style = {
    position: 'fixed',
    top: Math.max(8, anchor.y - 8),
    left: Math.max(8, Math.min(anchor.x, window.innerWidth - 360 - 8)),
    transform: 'translateY(-100%)',
    zIndex: 1000,
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
    padding: '0.75rem',
    width: 340,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
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
    setActiveInstr(instruction)
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
    <div ref={popRef} style={style} onMouseDown={e => e.stopPropagation()}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M12 3L9.5 9.5 3 12l6.5 2.5L12 21l2.5-6.5L21 12l-6.5-2.5z"/></svg>
          AI Edit
        </span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '0 2px', fontSize: '1rem', lineHeight: 1 }}>×</button>
      </div>

      {/* Quick actions */}
      {!preview && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
          {AI_ACTIONS.map(a => (
            <button
              key={a.label}
              disabled={loading}
              onClick={() => run(a.instruction)}
              style={{
                fontSize: '0.72rem', padding: '0.25rem 0.55rem',
                background: 'var(--surface2)', border: '1px solid var(--border)',
                color: 'var(--text)', borderRadius: 6, cursor: 'pointer',
                opacity: loading ? 0.5 : 1,
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* Custom instruction */}
      {!preview && (
        <div style={{ display: 'flex', gap: '0.35rem' }}>
          <input
            value={custom}
            onChange={e => setCustom(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && custom.trim()) run(custom.trim()) }}
            placeholder="Custom instruction…"
            disabled={loading}
            style={{
              flex: 1, fontSize: '0.8rem', padding: '0.3rem 0.5rem',
              background: 'var(--bg)', border: '1px solid var(--border)',
              color: 'var(--text)', borderRadius: 6, outline: 'none',
            }}
          />
          <button
            disabled={loading || !custom.trim()}
            onClick={() => run(custom.trim())}
            style={{
              padding: '0.3rem 0.6rem', fontSize: '0.75rem',
              background: 'var(--accent)', color: 'white',
              border: 'none', borderRadius: 6, cursor: 'pointer',
              opacity: loading || !custom.trim() ? 0.5 : 1,
            }}
          >
            {loading ? '…' : '→'}
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--muted)' }}>
          <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> Thinking…
        </div>
      )}

      {/* Error */}
      {error && <div style={{ fontSize: '0.75rem', color: 'var(--danger)' }}>{error}</div>}

      {/* Preview + accept/reject */}
      {preview && (
        <>
          <div style={{
            fontSize: '0.78rem', color: 'var(--muted)', background: 'var(--surface2)',
            border: '1px solid var(--border)', borderRadius: 6,
            padding: '0.5rem 0.6rem', maxHeight: 160, overflowY: 'auto',
            whiteSpace: 'pre-wrap', fontFamily: 'monospace', lineHeight: 1.5,
          }}>
            {preview}
          </div>
          <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end' }}>
            <button
              onClick={() => { setPreview(null); setActiveInstr(null) }}
              style={{ fontSize: '0.75rem', padding: '0.3rem 0.65rem', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 6, cursor: 'pointer' }}
            >
              Retry
            </button>
            <button
              onClick={() => onApply(preview)}
              style={{ fontSize: '0.75rem', padding: '0.3rem 0.75rem', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}
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
  { label: 'B',   style: { fontWeight: 700 },      wrap: ['**', '**'],   title: 'Bold' },
  { label: 'I',   style: { fontStyle: 'italic' },   wrap: ['_', '_'],     title: 'Italic' },
  { label: '`',   style: { fontFamily: 'monospace'},wrap: ['`', '`'],     title: 'Inline code' },
  { label: 'H1',  style: {},                        prefix: '# ',         title: 'Heading 1' },
  { label: 'H2',  style: {},                        prefix: '## ',        title: 'Heading 2' },
  { label: 'H3',  style: {},                        prefix: '### ',       title: 'Heading 3' },
  { label: '—',   style: {},                        insert: '\n---\n',    title: 'Horizontal rule' },
  { label: '≡',   style: {},                        prefix: '- ',         title: 'List item' },
  { label: '☐',   style: {},                        prefix: '- [ ] ',     title: 'Task item' },
  { label: '❝',   style: {},                        prefix: '> ',         title: 'Blockquote' },
  { label: '⌥',   style: { fontFamily: 'monospace'},block: '```\n',       title: 'Code block' },
]

export default function MarkdownViewer({ file, onToast }) {
  const [content, setContent] = useState(null)
  const [draft, setDraft]     = useState(null)
  const [mode, setMode]       = useState('view') // 'view' | 'edit' | 'split'
  const [saving, setSaving]   = useState(false)
  const [loading, setLoading] = useState(false)
  const [aiPopover, setAiPopover] = useState(null) // { x, y, start, end, text }
  const textareaRef = useRef()

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

  // Toolbar action: insert wrap/prefix/block around selection
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
      // Apply to each selected line
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
    // Restore focus + cursor after React re-render
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(cursor, cursor)
    })
  }, [draft])

  // Keyboard shortcuts in textarea
  const handleKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      handleSave()
    }
    // Tab → insert 2 spaces
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
    <div className="card">
      <div className="loading-overlay"><span className="spinner" /> Loading...</div>
    </div>
  )

  if (content === null) return null

  const inEdit = mode === 'edit' || mode === 'split'

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
          <h2 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</h2>
          {isDirty && <span style={{ fontSize: '0.7rem', color: 'var(--muted)', flexShrink: 0 }}>● unsaved</span>}
        </div>
        <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center', flexShrink: 0 }}>
          {/* Mode toggle */}
          {['view','split','edit'].map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: '0.3rem 0.65rem',
                fontSize: '0.75rem',
                background: mode === m ? 'var(--accent)' : 'var(--surface2)',
                color: mode === m ? 'white' : 'var(--muted)',
                border: '1px solid ' + (mode === m ? 'var(--accent)' : 'var(--border)'),
              }}
            >
              {m === 'view' ? 'Preview' : m === 'split' ? 'Split' : 'Edit'}
            </button>
          ))}
          {isDirty && (
            <>
              <button onClick={handleDiscard} style={{ background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)', padding: '0.3rem 0.65rem', fontSize: '0.75rem' }}>
                Discard
              </button>
              <button onClick={handleSave} disabled={saving} className="btn-primary" style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem' }}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Toolbar (edit / split) */}
      {inEdit && (
        <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', padding: '0.5rem 1rem', borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
          {TOOLBAR.map((t, i) => (
            <button
              key={i}
              title={t.title}
              onClick={() => applyFormat(t)}
              style={{
                ...t.style,
                padding: '0.2rem 0.55rem',
                fontSize: '0.8125rem',
                background: 'var(--surface)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                minWidth: 30,
              }}
            >
              {t.label}
            </button>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--muted)', alignSelf: 'center' }}>
            {navigator.platform.includes('Mac') ? '⌘S' : 'Ctrl+S'} to save
          </span>
        </div>
      )}

      {/* Body */}
      <div style={{ display: 'grid', gridTemplateColumns: mode === 'split' ? '1fr 1fr' : '1fr', flex: 1, minHeight: 0 }}>
        {/* Editor pane */}
        {inEdit && (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onMouseUp={handleTextareaMouseUp}
            spellCheck={false}
            style={{
              flex: 1,
              resize: 'none',
              background: 'var(--bg)',
              color: 'var(--text)',
              border: 'none',
              borderRight: mode === 'split' ? '1px solid var(--border)' : 'none',
              outline: 'none',
              padding: '1.25rem',
              fontFamily: "'Fira Code', 'Cascadia Code', monospace",
              fontSize: '0.875rem',
              lineHeight: 1.7,
              minHeight: 500,
              tabSize: 2,
            }}
          />
        )}

        {/* Preview pane */}
        {(mode === 'view' || mode === 'split') && (
          <div style={{ padding: '1.25rem', overflowY: 'auto', minHeight: mode === 'split' ? 500 : undefined }}>
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
