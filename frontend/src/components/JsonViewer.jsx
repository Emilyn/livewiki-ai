import { useState, useEffect, useCallback } from 'react'
import { getFileContent, saveFileContent, getDriveFileContent, saveDriveFileContent } from '../api'

// ── Syntax-highlighted JSON renderer ─────────────────────────────────────────
function highlight(json) {
  return json
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      match => {
        if (/^"/.test(match)) {
          if (/:$/.test(match)) return `<span style="color:#7dd3fc">${match}</span>` // key
          return `<span style="color:#86efac">${match}</span>` // string value
        }
        if (/true|false/.test(match)) return `<span style="color:#fbbf24">${match}</span>`
        if (/null/.test(match)) return `<span style="color:#f87171">${match}</span>`
        return `<span style="color:#c4b5fd">${match}</span>` // number
      }
    )
}

export default function JsonViewer({ file, onToast }) {
  const [raw, setRaw]         = useState(null)
  const [draft, setDraft]     = useState(null)
  const [mode, setMode]       = useState('view') // 'view' | 'edit'
  const [parseErr, setParseErr] = useState('')
  const [saving, setSaving]   = useState(false)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied]   = useState(false)

  useEffect(() => {
    if (!file) return
    setLoading(true)
    setRaw(null)
    setDraft(null)
    setParseErr('')
    setMode('view')
    const fetchContent = file.source === 'drive' ? getDriveFileContent : getFileContent
    fetchContent(file.id)
      .then(text => {
        // axios may auto-parse JSON into an object; normalise to string first
        const str = typeof text === 'string' ? text : JSON.stringify(text, null, 2)
        try {
          const pretty = JSON.stringify(JSON.parse(str), null, 2)
          setRaw(pretty)
          setDraft(pretty)
        } catch {
          // Not valid JSON — still load it for editing
          setRaw(str)
          setDraft(str)
          setParseErr('File contains invalid JSON')
        }
      })
      .catch(() => onToast('Failed to load file content', 'error'))
      .finally(() => setLoading(false))
  }, [file])

  const isDirty = draft !== raw

  const handleSave = async () => {
    // Validate before saving
    try { JSON.parse(draft) } catch (e) {
      onToast('Invalid JSON — fix errors before saving', 'error')
      return
    }
    setSaving(true)
    try {
      const saveFn = file.source === 'drive' ? saveDriveFileContent : saveFileContent
      await saveFn(file.id, draft)
      setRaw(draft)
      setParseErr('')
      onToast('Saved')
    } catch {
      onToast('Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleFormat = useCallback(() => {
    try {
      const pretty = JSON.stringify(JSON.parse(draft), null, 2)
      setDraft(pretty)
      setParseErr('')
    } catch (e) {
      setParseErr('Invalid JSON: ' + e.message)
    }
  }, [draft])

  const handleCopy = () => {
    navigator.clipboard.writeText(raw ?? '').then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

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
      requestAnimationFrame(() => ta.setSelectionRange(s + 2, s + 2))
    }
  }

  if (loading) return (
    <div className="card">
      <div className="loading-overlay"><span className="spinner" /> Loading...</div>
    </div>
  )

  if (raw === null) return null

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
          <h2 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</h2>
          {isDirty && <span style={{ fontSize: '0.7rem', color: 'var(--muted)', flexShrink: 0 }}>● unsaved</span>}
        </div>
        <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center', flexShrink: 0 }}>
          {['view', 'edit'].map(m => (
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
              {m === 'view' ? 'View' : 'Edit'}
            </button>
          ))}
          {mode === 'edit' && (
            <button
              onClick={handleFormat}
              style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem', background: 'var(--surface2)', color: 'var(--muted)', border: '1px solid var(--border)' }}
            >
              Format
            </button>
          )}
          <button
            onClick={handleCopy}
            style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem', background: 'var(--surface2)', color: copied ? 'var(--success)' : 'var(--muted)', border: '1px solid var(--border)' }}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
          {isDirty && (
            <>
              <button onClick={() => setDraft(raw)} style={{ background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)', padding: '0.3rem 0.65rem', fontSize: '0.75rem' }}>
                Discard
              </button>
              <button onClick={handleSave} disabled={saving} className="btn-primary" style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem' }}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>

      {parseErr && (
        <div style={{ padding: '0.5rem 1rem', background: 'rgba(239,68,68,0.1)', borderBottom: '1px solid rgba(239,68,68,0.3)', color: 'var(--danger)', fontSize: '0.8125rem' }}>
          {parseErr}
        </div>
      )}

      {/* Body */}
      {mode === 'view' ? (
        <div style={{ overflowY: 'auto', overflowX: 'auto' }}>
          <pre
            style={{
              margin: 0,
              padding: '1.25rem',
              fontFamily: "'Fira Code', 'Cascadia Code', monospace",
              fontSize: '0.8125rem',
              lineHeight: 1.7,
              color: 'var(--text)',
              background: 'transparent',
              whiteSpace: 'pre',
            }}
            dangerouslySetInnerHTML={{ __html: highlight(raw) }}
          />
        </div>
      ) : (
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          style={{
            flex: 1,
            resize: 'none',
            background: 'var(--bg)',
            color: 'var(--text)',
            border: 'none',
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
    </div>
  )
}
