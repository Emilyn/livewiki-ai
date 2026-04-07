import { useState, useEffect, useRef } from 'react'
import {
  getDriveStatus, getDriveFolders, setDriveFolder,
  driveDisconnect, listDriveFiles, uploadDriveFile, deleteDriveFile,
  startDriveAuth,
} from '../api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

function formatBytes(b) {
  if (!b) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1048576).toFixed(1)} MB`
}
function formatDate(d) {
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function StepNum({ n }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-xs font-bold text-white mt-0.5">
      {n}
    </span>
  )
}

function Chip({ children }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 text-xs border border-border font-mono">{children}</code>
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
    <Button
      variant="outline"
      size="xs"
      onClick={copy}
      className={cn('absolute top-2 right-2', copied && 'text-green-500')}
    >
      {copied ? 'Copied!' : 'Copy'}
    </Button>
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
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-md p-0 overflow-hidden">
        <DialogHeader className="px-5 py-4 border-b">
          <DialogTitle>Select Drive Folder</DialogTitle>
        </DialogHeader>
        <div className="px-5 py-3 border-b">
          <Input
            placeholder="Search folders…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
        </div>
        <div className="max-h-80 overflow-y-auto px-3 py-2">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-primary" />
            </div>
          )}
          {error && <p className="text-sm text-destructive px-2 py-3">{error}</p>}
          {!loading && filtered.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">No folders found</p>
          )}
          {filtered.map(f => (
            <button
              key={f.id}
              onClick={() => onPick(f)}
              className="flex items-center gap-2.5 w-full rounded-lg px-3 py-2.5 text-sm hover:bg-muted transition-colors text-left"
            >
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" className="text-indigo-500 shrink-0">
                <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
              </svg>
              <span className="flex-1 truncate">{f.name}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DriveIcon({ size = 20, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 87.3 78" className={className}>
      <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
      <path d="M43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L1.2 48.5C.4 49.9 0 51.45 0 53h27.45z" fill="#00ac47"/>
      <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.85l5.55 10.25z" fill="#ea4335"/>
      <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.95 0H34.35c-1.55 0-3.1.45-4.45 1.2z" fill="#00832d"/>
      <path d="M59.85 53H27.45L13.7 76.8c1.35.8 2.9 1.2 4.45 1.2h50c1.55 0 3.1-.4 4.45-1.2z" fill="#2684fc"/>
      <path d="M73.4 26.5l-12.65-21.8C59.95 3.1 58.8 2 57.4 1.2L43.65 25 59.85 53h27.4c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
    </svg>
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

  const loadStatus = () => getDriveStatus().then(setStatus).catch(() => {})

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
    <div className="flex items-center justify-center min-h-[200px]">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
    </div>
  )

  // ── Not configured ─────────────────────────────────────────────────────────
  if (!status.configured) return (
    <Card className="max-w-2xl">
      <CardHeader className="border-b">
        <div className="flex items-center gap-2">
          <DriveIcon size={16} />
          <CardTitle>Setup required</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-5 space-y-5">
        <div className="flex gap-3">
          <StepNum n={1} />
          <div className="space-y-2">
            <p className="text-sm font-semibold">Add env vars to your Railway service</p>
            <p className="text-xs text-muted-foreground">
              In Railway → your service → <strong>Variables</strong>, add:
            </p>
            <div className="flex gap-2 flex-wrap">
              <Chip>GOOGLE_CLIENT_ID</Chip>
              <Chip>GOOGLE_CLIENT_SECRET</Chip>
            </div>
            <p className="text-xs text-muted-foreground">
              Get these from{' '}
              <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="text-indigo-500 hover:underline underline-offset-3">
                Google Cloud Console → APIs &amp; Services → Credentials
              </a>
              {' '}→ OAuth 2.0 Client ID (Web application).
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <StepNum n={2} />
          <div className="flex-1 min-w-0 space-y-2">
            <p className="text-sm font-semibold">Add the redirect URI to your Google OAuth client</p>
            <p className="text-xs text-muted-foreground">
              In your OAuth client's <strong>Authorized redirect URIs</strong>, add exactly:
            </p>
            <div className="relative">
              <pre className="rounded-lg bg-muted border border-border px-3 py-2.5 pr-20 text-xs overflow-x-auto">
                {status.redirect_uri || 'https://<your-app>.railway.app/api/drive/callback'}
              </pre>
              <CopyBtn text={status.redirect_uri} />
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <StepNum n={3} />
          <div className="space-y-1">
            <p className="text-sm font-semibold">Redeploy</p>
            <p className="text-xs text-muted-foreground">
              After setting the env vars, trigger a redeploy. The Drive tab will update automatically.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )

  // ── Not connected ──────────────────────────────────────────────────────────
  if (!status.connected) return (
    <Card className="max-w-sm">
      <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
        <DriveIcon size={40} />
        <div>
          <h3 className="font-semibold text-base mb-1">Connect Google Drive</h3>
          <p className="text-sm text-muted-foreground">Authorise access to pick a folder as your files source.</p>
        </div>
        <Button onClick={startDriveAuth}>Sign in with Google</Button>
      </CardContent>
    </Card>
  )

  // ── Connected ──────────────────────────────────────────────────────────────
  return (
    <>
      {showPicker && <FolderPicker onPick={handlePickFolder} onClose={() => setShowPicker(false)} />}

      <div className="grid md:grid-cols-[280px_1fr] gap-4 items-start">
        <div className="flex flex-col gap-4">
          {/* Connection card */}
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <DriveIcon size={16} />
                  <CardTitle>Google Drive</CardTitle>
                </div>
                <span className="flex items-center gap-1.5 text-xs text-green-500 font-medium">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                  Connected
                </span>
              </div>
            </CardHeader>
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground mb-0.5">Active folder</p>
                  {status.folder
                    ? <span className="text-sm font-semibold">📁 {status.folder.name}</span>
                    : <span className="text-sm text-muted-foreground">No folder selected</span>}
                </div>
                <Button variant="outline" size="sm" onClick={() => setShowPicker(true)}>
                  {status.folder ? 'Change' : 'Pick folder'}
                </Button>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDisconnect}
              >
                Disconnect
              </Button>
            </CardContent>
          </Card>

          {/* Upload */}
          {status.folder && (
            <Card>
              <CardHeader className="border-b"><CardTitle>Upload to Drive</CardTitle></CardHeader>
              <CardContent className="pt-4 space-y-3">
                <div
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 cursor-pointer transition-colors text-sm',
                    dragOver ? 'border-indigo-500 bg-indigo-500/5' : 'border-border hover:border-muted-foreground/40 hover:bg-muted/40'
                  )}
                  onClick={() => !uploading && inputRef.current.click()}
                  onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
                >
                  <svg width="24" height="24" fill="none" viewBox="0 0 24 24" className="text-indigo-500" stroke="currentColor" strokeWidth="1.5">
                    <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1"/>
                    <polyline points="16 6 12 2 8 6"/>
                    <line x1="12" y1="2" x2="12" y2="15"/>
                  </svg>
                  <p className="text-muted-foreground text-xs">Drop or click to upload</p>
                  <div className="flex gap-1.5">
                    {['.mf4', '.mdf', '.md'].map(ext => (
                      <span key={ext} className="text-xs bg-secondary text-secondary-foreground rounded px-1.5 py-0.5">{ext}</span>
                    ))}
                  </div>
                </div>
                {uploading && <Progress value={progress} />}
                <input
                  ref={inputRef}
                  type="file"
                  accept=".mf4,.mdf,.md,.MF4,.MDF,.MD"
                  className="hidden"
                  onChange={e => handleFiles(e.target.files)}
                />
              </CardContent>
            </Card>
          )}
        </div>

        {/* File list */}
        <Card>
          {!status.folder ? (
            <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
              <svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
              </svg>
              <p className="text-sm">Pick a Drive folder to see files</p>
            </CardContent>
          ) : (
            <>
              <CardHeader className="border-b">
                <div className="flex items-center gap-2">
                  <CardTitle className="truncate">Files in "{status.folder.name}"</CardTitle>
                  {files.length > 0 && <Badge variant="secondary">{files.length}</Badge>}
                  <Button
                    variant="outline"
                    size="xs"
                    className="ml-auto shrink-0"
                    onClick={loadFiles}
                    disabled={loadingFiles}
                  >
                    ↺ Refresh
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-3">
                {loadingFiles ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" />
                    Loading…
                  </div>
                ) : files.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No supported files in this folder.</p>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    {files.map(f => (
                      <div
                        key={f.id}
                        className={cn(
                          'flex items-center gap-2.5 rounded-lg px-3 py-2.5 cursor-pointer transition-colors group',
                          selectedFile?.id === f.id
                            ? 'bg-indigo-500/10 border border-indigo-500/20'
                            : 'hover:bg-muted border border-transparent'
                        )}
                        onClick={() => onSelect(f)}
                      >
                        <DriveIcon size={16} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate" title={f.name}>{f.name}</div>
                          <div className="text-xs text-muted-foreground">{formatBytes(f.size)} · {formatDate(f.uploaded_at)}</div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive hover:bg-destructive/10"
                          title="Delete"
                          onClick={e => handleDelete(e, f.id)}
                        >
                          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                            <path d="M10 11v6M14 11v6"/>
                            <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                          </svg>
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </>
  )
}
