import { useState, useEffect, useRef } from 'react'
import { listFiles, uploadFile, deleteFile } from '../api'

function formatBytes(b) {
  if (b < 1024) return `${b} B`
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1048576).toFixed(1)} MB`
}

function formatDate(d) {
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function FilePanel({ selectedFile, onSelect, onToast }) {
  const [files, setFiles] = useState([])
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(null) // file object or 'all'
  const inputRef = useRef()

  const load = () => listFiles().then(setFiles).catch(() => {})

  useEffect(() => { load() }, [])

  const handleFiles = async (fileList) => {
    const file = fileList[0]
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    if (!['mf4', 'mdf', 'md'].includes(ext)) {
      onToast('Only .mf4, .mdf, and .md files are supported', 'error')
      return
    }
    setUploading(true)
    setProgress(0)
    try {
      const meta = await uploadFile(file, setProgress)
      setFiles(f => [...f, meta])
      onToast(`Uploaded ${file.name}`)
      onSelect(meta)
    } catch (e) {
      onToast(e?.response?.data?.error || 'Upload failed', 'error')
    } finally {
      setUploading(false)
      setProgress(0)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    handleFiles(e.dataTransfer.files)
  }

  const confirmAndDelete = async () => {
    const target = confirmDelete
    setConfirmDelete(null)
    if (target === 'all') {
      const ids = files.map(f => f.id)
      let failed = 0
      for (const id of ids) {
        try {
          await deleteFile(id)
        } catch {
          failed++
        }
      }
      setFiles([])
      onSelect(null)
      if (failed > 0) onToast(`${failed} file(s) failed to delete`, 'error')
      else onToast('All files deleted')
    } else {
      try {
        await deleteFile(target.id)
        setFiles(f => f.filter(x => x.id !== target.id))
        if (selectedFile?.id === target.id) onSelect(null)
        onToast('File deleted')
      } catch {
        onToast('Delete failed', 'error')
      }
    }
  }

  return (
    <div className="files-layout">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Upload */}
      <div className="card">
        <div className="card-header">
          <h2>Upload</h2>
        </div>
        <div className="card-body">
          <div
            className={`upload-zone${dragOver ? ' drag-over' : ''}`}
            onClick={() => !uploading && inputRef.current.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="var(--accent)" strokeWidth="1.5">
              <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1"/>
              <polyline points="16 6 12 2 8 6"/>
              <line x1="12" y1="2" x2="12" y2="15"/>
            </svg>
            <p>Drop a file or click to browse</p>
            <p style={{ marginTop: '0.25rem' }}>
              <span className="ext-badge">.mf4</span>
              <span className="ext-badge">.mdf</span>
              <span className="ext-badge">.md</span>
            </p>
          </div>
          {uploading && (
            <div className="progress-bar" style={{ marginTop: '0.75rem' }}>
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".mf4,.mdf,.md,.MF4,.MDF,.MD"
            style={{ display: 'none' }}
            onChange={e => handleFiles(e.target.files)}
          />
        </div>
      </div>

      {/* File list */}
      <div className="card">
        <div className="card-header">
          <h2>Files</h2>
          {files.length > 0 && <span className="badge">{files.length}</span>}
          {files.length > 0 && (
            <button
              className="btn-danger-sm"
              style={{ marginLeft: 'auto' }}
              onClick={() => setConfirmDelete('all')}
            >
              Delete all
            </button>
          )}
        </div>
        <div className="card-body">
          {files.length === 0 ? (
            <div className="empty-state">No files yet. Upload an MDF file to get started.</div>
          ) : (
            <div className="file-list">
              {files.map(f => (
                <div
                  key={f.id}
                  className={`file-item${selectedFile?.id === f.id ? ' active' : ''}`}
                  onClick={() => onSelect(f)}
                >
                  <div className="file-icon">
                    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                  </div>
                  <div className="file-info">
                    <div className="file-name" title={f.name}>{f.name}</div>
                    <div className="file-meta">{formatBytes(f.size)} · {formatDate(f.uploaded_at)}</div>
                  </div>
                  <div className="file-actions">
                    <button
                      className="btn-icon btn-icon-danger"
                      title="Delete file"
                      onClick={e => { e.stopPropagation(); setConfirmDelete(f) }}
                    >
                      <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                        <path d="M10 11v6M14 11v6"/>
                        <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </div>

      {/* Confirmation modal */}
      {confirmDelete && (
        <div className="modal-backdrop" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-icon">
              <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="var(--danger)" strokeWidth="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                <path d="M10 11v6M14 11v6"/>
                <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
              </svg>
            </div>
            <h3>
              {confirmDelete === 'all'
                ? `Delete all ${files.length} files?`
                : `Delete "${confirmDelete.name}"?`}
            </h3>
            <p>This is permanent and cannot be undone.</p>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn-danger" onClick={confirmAndDelete}>Delete permanently</button>
            </div>
          </div>
        </div>
      )}

      {/* Right: selected file detail */}
      <div className="card">
        {selectedFile ? (
          <>
            <div className="card-header">
              <h2 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedFile.name}</h2>
              <span style={{ fontSize: '0.75rem', color: 'var(--muted)', flexShrink: 0 }}>{selectedFile.ext?.toUpperCase().replace('.','')}</span>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div className="info-bar" style={{ margin: 0 }}>
                <div className="info-chip"><span className="label">Size</span><span className="value">{formatBytes(selectedFile.size)}</span></div>
                <div className="info-chip"><span className="label">Uploaded</span><span className="value">{formatDate(selectedFile.uploaded_at)}</span></div>
                <div className="info-chip"><span className="label">Type</span><span className="value">{selectedFile.ext}</span></div>
              </div>
              <button
                className="btn-primary"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => onSelect(selectedFile)}
              >
                Open in Viewer →
              </button>
            </div>
          </>
        ) : (
          <div className="viewer-placeholder" style={{ minHeight: 200 }}>
            <svg width="36" height="36" fill="none" viewBox="0 0 24 24" stroke="var(--border)" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            <span>Select a file to see details</span>
          </div>
        )}
      </div>
    </div>
  )
}
