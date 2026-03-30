import { useState, useEffect, useRef } from 'react'
import {
  getDriveStatus, getDriveFolders, setDriveFolder,
  driveDisconnect, listDriveFiles, uploadDriveFile, deleteDriveFile,
  startDriveAuth,
} from '../api'

function formatBytes(b) {
  if (!b) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1048576).toFixed(1)} MB`
}
function formatDate(d) {
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Setup helpers ─────────────────────────────────────────────────────────────
function StepNum({ n }) {
  return (
    <span style={{
      flexShrink: 0, width: 24, height: 24, borderRadius: '50%',
      background: 'var(--accent)', color: 'white',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '0.75rem', fontWeight: 700, marginTop: 1,
    }}>{n}</span>
  )
}

function Chip({ children }) {
  return (
    <code style={{
      background: 'var(--surface2)', border: '1px solid var(--border)',
      borderRadius: 5, padding: '0.15em 0.45em', fontSize: '0.8125rem',
    }}>{children}</code>
  )
}

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    if (!text) return
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button onClick={copy} style={{
      position: 'absolute', top: 6, right: 6,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 5, fontSize: '0.7rem', padding: '0.2rem 0.5rem',
      color: copied ? 'var(--success)' : 'var(--muted)', cursor: 'pointer',
    }}>
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

// ── Folder picker modal ───────────────────────────────────────────────────────
function FolderPicker({ onPick, onClose }) {
  const [folders, setFolders] = useState(null)
  const [search, setSearch]   = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  useEffect(() => {
    getDriveFolders()
      .then(setFolders)
      .catch(e => setError(e?.response?.data?.error || 'Failed to load folders'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = folders
    ? folders.filter(f => f.name.toLowerCase().includes(search.toLowerCase()))
    : []

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 12, width: 420, maxHeight: '70vh',
        display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
          <h2 style={{ fontSize: '0.9375rem' }}>Select Drive Folder</h2>
          <button onClick={onClose} className="btn-icon" style={{ opacity: 1 }}>✕</button>
        </div>
        <div style={{ padding: '0.75rem 1.25rem' }}>
          <input
            style={{ width: '100%' }}
            placeholder="Search folders…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 1.25rem 1rem' }}>
          {loading && <div className="loading-overlay" style={{ minHeight: 120 }}><span className="spinner" /></div>}
          {error && <p style={{ color: 'var(--danger)', fontSize: '0.875rem' }}>{error}</p>}
          {!loading && filtered.length === 0 && (
            <p style={{ color: 'var(--muted)', fontSize: '0.875rem', textAlign: 'center', padding: '1.5rem 0' }}>No folders found</p>
          )}
          {filtered.map(f => (
            <div
              key={f.id}
              onClick={() => onPick(f)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.625rem',
                padding: '0.625rem 0.5rem', borderRadius: 6, cursor: 'pointer',
                fontSize: '0.875rem', transition: 'background 0.1s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="var(--accent)" strokeWidth="2">
                <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
              </svg>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Main DrivePanel ───────────────────────────────────────────────────────────
export default function DrivePanel({ selectedFile, onSelect, onToast }) {
  const [status, setStatus]         = useState(null)
  const [files, setFiles]           = useState([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [dragOver, setDragOver]     = useState(false)
  const [uploading, setUploading]   = useState(false)
  const [progress, setProgress]     = useState(0)
  const inputRef = useRef()

  // Check if just returned from OAuth
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('drive') === 'connected') {
      onToast('Google Drive connected!')
      window.history.replaceState({}, '', window.location.pathname)
    } else if (params.get('drive') === 'error') {
      onToast('Google Drive connection failed', 'error')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  const loadStatus = () =>
    getDriveStatus().then(setStatus).catch(() => {})

  useEffect(() => { loadStatus() }, [])

  const loadFiles = () => {
    setLoadingFiles(true)
    listDriveFiles()
      .then(setFiles)
      .catch(e => onToast(e?.response?.data?.error || 'Failed to list Drive files', 'error'))
      .finally(() => setLoadingFiles(false))
  }

  useEffect(() => {
    if (status?.connected && status?.folder) loadFiles()
  }, [status])

  const handlePickFolder = async (folder) => {
    setShowPicker(false)
    try {
      await setDriveFolder(folder.id, folder.name)
      onToast(`Folder set to "${folder.name}"`)
      await loadStatus()
    } catch {
      onToast('Failed to set folder', 'error')
    }
  }

  const handleDisconnect = async () => {
    try {
      await driveDisconnect()
      setStatus(s => ({ ...s, connected: false, folder: null }))
      setFiles([])
      onToast('Disconnected from Google Drive')
    } catch {
      onToast('Disconnect failed', 'error')
    }
  }

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
      const meta = await uploadDriveFile(file, setProgress)
      setFiles(f => [...f, meta])
      onToast(`Uploaded ${file.name} to Drive`)
      onSelect(meta)
    } catch (e) {
      onToast(e?.response?.data?.error || 'Upload failed', 'error')
    } finally {
      setUploading(false)
      setProgress(0)
    }
  }

  const handleDelete = async (e, id) => {
    e.stopPropagation()
    try {
      await deleteDriveFile(id)
      setFiles(f => f.filter(x => x.id !== id))
      if (selectedFile?.id === id) onSelect(null)
      onToast('File deleted from Drive')
    } catch {
      onToast('Delete failed', 'error')
    }
  }

  if (!status) return (
    <div className="loading-overlay" style={{ minHeight: 200 }}><span className="spinner" /></div>
  )

  // ── Not configured ────────────────────────────────────────────────────────
  if (!status.configured) return (
    <div className="card" style={{ maxWidth: 640 }}>
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <DriveIcon size={16} />
          <h2>Setup required</h2>
        </div>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

        {/* Step 1 */}
        <div style={{ display: 'flex', gap: '0.875rem' }}>
          <StepNum n={1} />
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.35rem' }}>
              Add env vars to your Railway service
            </div>
            <p style={{ fontSize: '0.8125rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
              In Railway → your service → <strong>Variables</strong>, add:
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <Chip>GOOGLE_CLIENT_ID</Chip>
              <Chip>GOOGLE_CLIENT_SECRET</Chip>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.5rem' }}>
              Get these from{' '}
              <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer"
                style={{ color: 'var(--accent)' }}>
                Google Cloud Console → APIs &amp; Services → Credentials
              </a>
              {' '}→ OAuth 2.0 Client ID (Web application).
            </p>
          </div>
        </div>

        {/* Step 2 */}
        <div style={{ display: 'flex', gap: '0.875rem' }}>
          <StepNum n={2} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.35rem' }}>
              Add the redirect URI to your Google OAuth client
            </div>
            <p style={{ fontSize: '0.8125rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
              In your OAuth client's <strong>Authorized redirect URIs</strong>, add exactly:
            </p>
            <div style={{ position: 'relative' }}>
              <pre style={{
                background: 'var(--surface2)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '0.625rem 3rem 0.625rem 0.875rem',
                fontSize: '0.8125rem', overflowX: 'auto', whiteSpace: 'pre',
                color: 'var(--text)', margin: 0,
              }}>
                {status.redirect_uri || 'https://<your-app>.railway.app/api/drive/callback'}
              </pre>
              <CopyBtn text={status.redirect_uri} />
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.4rem' }}>
              This URL is auto-derived from your Railway domain — no manual configuration needed.
            </p>
          </div>
        </div>

        {/* Step 3 */}
        <div style={{ display: 'flex', gap: '0.875rem' }}>
          <StepNum n={3} />
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.35rem' }}>
              Redeploy
            </div>
            <p style={{ fontSize: '0.8125rem', color: 'var(--muted)' }}>
              After setting the env vars, trigger a redeploy. The Drive tab will update automatically.
            </p>
          </div>
        </div>

      </div>
    </div>
  )

  // ── Not connected ─────────────────────────────────────────────────────────
  if (!status.connected) return (
    <div className="card">
      <div className="card-body" style={{ textAlign: 'center', padding: '2.5rem 1.5rem' }}>
        <DriveIcon size={40} style={{ margin: '0 auto 1rem' }} />
        <h3 style={{ marginBottom: '0.5rem' }}>Connect Google Drive</h3>
        <p style={{ color: 'var(--muted)', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
          Authorise access to pick a folder as your files source.
        </p>
        <button className="btn-primary" style={{ padding: '0.6rem 1.5rem' }} onClick={startDriveAuth}>
          Sign in with Google
        </button>
      </div>
    </div>
  )

  // ── Connected ─────────────────────────────────────────────────────────────
  return (
    <>
      {showPicker && <FolderPicker onPick={handlePickFolder} onClose={() => setShowPicker(false)} />}

      <div className="files-layout">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Connection card */}
          <div className="card">
            <div className="card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <DriveIcon size={16} />
                <h2>Google Drive</h2>
              </div>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: 'var(--success)' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} />
                Connected
              </span>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.2rem' }}>Active folder</div>
                  {status.folder
                    ? <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>📁 {status.folder.name}</span>
                    : <span style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>No folder selected</span>}
                </div>
                <button className="btn-add" onClick={() => setShowPicker(true)}>
                  {status.folder ? 'Change' : 'Pick folder'}
                </button>
              </div>
              <button
                onClick={handleDisconnect}
                style={{ background: 'transparent', color: 'var(--danger)', border: '1px solid var(--danger)', fontSize: '0.75rem', padding: '0.3rem 0.75rem', alignSelf: 'flex-start' }}
              >
                Disconnect
              </button>
            </div>
          </div>

          {/* Upload */}
          {status.folder && (
            <div className="card">
              <div className="card-header"><h2>Upload to Drive</h2></div>
              <div className="card-body">
                <div
                  className={`upload-zone${dragOver ? ' drag-over' : ''}`}
                  onClick={() => !uploading && inputRef.current.click()}
                  onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
                >
                  <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="var(--accent)" strokeWidth="1.5">
                    <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1"/>
                    <polyline points="16 6 12 2 8 6"/>
                    <line x1="12" y1="2" x2="12" y2="15"/>
                  </svg>
                  <p>Drop or click to upload</p>
                  <p style={{ marginTop: '0.2rem' }}>
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
                <input ref={inputRef} type="file" accept=".mf4,.mdf,.md,.MF4,.MDF,.MD"
                  style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
              </div>
            </div>
          )}
        </div>

        {/* File list / detail */}
        <div className="card">
          {!status.folder ? (
            <div className="viewer-placeholder" style={{ minHeight: 220 }}>
              <svg width="36" height="36" fill="none" viewBox="0 0 24 24" stroke="var(--border)" strokeWidth="1.5">
                <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
              </svg>
              <span>Pick a Drive folder to see files</span>
            </div>
          ) : (
            <>
              <div className="card-header">
                <h2>Files in "{status.folder.name}"</h2>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {files.length > 0 && <span className="badge">{files.length}</span>}
                  <button className="btn-add" onClick={loadFiles} disabled={loadingFiles} style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}>
                    ↺ Refresh
                  </button>
                </div>
              </div>
              <div className="card-body">
                {loadingFiles ? (
                  <div className="loading-overlay" style={{ minHeight: 120 }}><span className="spinner" /> Loading…</div>
                ) : files.length === 0 ? (
                  <div className="empty-state">No supported files in this folder.</div>
                ) : (
                  <div className="file-list">
                    {files.map(f => (
                      <div
                        key={f.id}
                        className={`file-item${selectedFile?.id === f.id ? ' active' : ''}`}
                        onClick={() => onSelect(f)}
                      >
                        <div className="file-icon"><DriveIcon size={18} /></div>
                        <div className="file-info">
                          <div className="file-name" title={f.name}>{f.name}</div>
                          <div className="file-meta">{formatBytes(f.size)} · {formatDate(f.uploaded_at)}</div>
                        </div>
                        <div className="file-actions">
                          <button className="btn-icon" title="Delete" onClick={e => handleDelete(e, f.id)}>
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
            </>
          )}
        </div>
      </div>
    </>
  )
}

function DriveIcon({ size = 20, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 87.3 78" style={style}>
      <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
      <path d="M43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L1.2 48.5C.4 49.9 0 51.45 0 53h27.45z" fill="#00ac47"/>
      <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.85l5.55 10.25z" fill="#ea4335"/>
      <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.95 0H34.35c-1.55 0-3.1.45-4.45 1.2z" fill="#00832d"/>
      <path d="M59.85 53H27.45L13.7 76.8c1.35.8 2.9 1.2 4.45 1.2h50c1.55 0 3.1-.4 4.45-1.2z" fill="#2684fc"/>
      <path d="M73.4 26.5l-12.65-21.8C59.95 3.1 58.8 2 57.4 1.2L43.65 25 59.85 53h27.4c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
    </svg>
  )
}
