import { useState, useEffect, useCallback } from 'react'
import { getFileContent, saveFileContent, getDriveFileContent, saveDriveFileContent } from '../api'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

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
        if (/null/.test(match))       return `<span style="color:#f87171">${match}</span>`
        return `<span style="color:#c4b5fd">${match}</span>` // number
      }
    )
}

export default function JsonViewer({ file, onToast }) {
  const [raw, setRaw]           = useState(null)
  const [draft, setDraft]       = useState(null)
  const [mode, setMode]         = useState('view') // 'view' | 'edit'
  const [parseErr, setParseErr] = useState('')
  const [saving, setSaving]     = useState(false)
  const [loading, setLoading]   = useState(false)
  const [copied, setCopied]     = useState(false)

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
        const str = typeof text === 'string' ? text : JSON.stringify(text, null, 2)
        try {
          const pretty = JSON.stringify(JSON.parse(str), null, 2)
          setRaw(pretty)
          setDraft(pretty)
        } catch {
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
    try { JSON.parse(draft) } catch {
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
    <div className="flex items-center justify-center p-12 rounded-xl border border-border bg-card">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
    </div>
  )

  if (raw === null) return null

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-sm font-semibold truncate">{file.name}</h2>
          {isDirty && <span className="text-[0.7rem] text-muted-foreground shrink-0">● unsaved</span>}
        </div>
        <div className="flex gap-1.5 items-center shrink-0">
          {['view', 'edit'].map(m => (
            <Button
              key={m}
              size="xs"
              variant={mode === m ? 'default' : 'outline'}
              onClick={() => setMode(m)}
              className={mode === m ? 'bg-sky-400 hover:bg-sky-500 border-sky-400' : ''}
            >
              {m === 'view' ? 'View' : 'Edit'}
            </Button>
          ))}
          {mode === 'edit' && (
            <Button size="xs" variant="outline" onClick={handleFormat}>Format</Button>
          )}
          <Button
            size="xs"
            variant="outline"
            onClick={handleCopy}
            className={cn(copied && 'text-green-500 border-green-500/30')}
          >
            {copied ? 'Copied!' : 'Copy'}
          </Button>
          {isDirty && (
            <>
              <Button size="xs" variant="ghost" onClick={() => setDraft(raw)}>Discard</Button>
              <Button size="xs" onClick={handleSave} disabled={saving}
                className="bg-sky-400 hover:bg-sky-500 text-white">
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </>
          )}
        </div>
      </div>

      {parseErr && (
        <div className="px-4 py-2 bg-destructive/10 border-b border-destructive/30 text-destructive text-[0.8125rem]">
          {parseErr}
        </div>
      )}

      {/* Body */}
      {mode === 'view' ? (
        <div className="overflow-auto">
          <pre
            className="m-0 p-5 text-[0.8125rem] leading-relaxed text-foreground bg-transparent whitespace-pre"
            style={{ fontFamily: "'Fira Code', 'Cascadia Code', monospace" }}
            dangerouslySetInnerHTML={{ __html: highlight(raw) }}
          />
        </div>
      ) : (
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          className="flex-1 resize-none bg-background text-foreground border-none outline-none p-5 text-sm leading-relaxed min-h-[500px]"
          style={{ fontFamily: "'Fira Code', 'Cascadia Code', monospace", tabSize: 2 }}
        />
      )}
    </div>
  )
}
