import { useState, useEffect, useRef } from 'react'
import { listFiles, uploadFile, deleteFile, listFolders, createFolder, deleteFolder, assignFileFolder } from '../api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

function formatBytes(b) {
  if (b < 1024) return `${b} B`
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1048576).toFixed(1)} MB`
}

function formatDate(d) {
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function IconFile() {
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  )
}

function IconTrash() {
  return (
    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
      <path d="M10 11v6M14 11v6"/>
      <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
    </svg>
  )
}

export default function FilePanel({ selectedFile, onSelect, onToast }) {
  const [files, setFiles]       = useState([])
  const [folders, setFolders]   = useState([])
  const [collapsed, setCollapsed] = useState({})
  const [newFolderName, setNewFolderName] = useState('')
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [draggingFile, setDraggingFile]   = useState(null)
  const [dropTarget, setDropTarget]       = useState(null)
  const newFolderRef = useRef()
  const inputRef = useRef()

  const load = () => {
    listFiles().then(setFiles).catch(() => {})
    listFolders().then(setFolders).catch(() => {})
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (showNewFolder) newFolderRef.current?.focus()
  }, [showNewFolder])

  const handleFiles = async (fileList) => {
    const file = fileList[0]
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    if (!['mf4', 'mdf', 'md', 'json'].includes(ext)) {
      onToast('Only .mf4, .mdf, .md, and .json files are supported', 'error')
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
        try { await deleteFile(id) } catch { failed++ }
      }
      setFiles([])
      onSelect(null)
      if (failed > 0) onToast(`${failed} file(s) failed to delete`, 'error')
      else onToast('All files deleted')
    } else if (target?.type === 'folder') {
      try {
        await deleteFolder(target.id)
        setFolders(f => f.filter(x => x.id !== target.id))
        setFiles(f => f.map(x => x.folder_id === target.id ? { ...x, folder_id: '' } : x))
        onToast(`Folder "${target.name}" deleted`)
      } catch {
        onToast('Delete failed', 'error')
      }
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

  const handleCreateFolder = async () => {
    const name = newFolderName.trim()
    if (!name) return
    try {
      const folder = await createFolder(name)
      setFolders(f => [...f, folder])
      setNewFolderName('')
      setShowNewFolder(false)
      onToast(`Folder "${name}" created`)
    } catch {
      onToast('Failed to create folder', 'error')
    }
  }

  const handleAssignFolder = async (fileId, folderId) => {
    try {
      const updated = await assignFileFolder(fileId, folderId)
      setFiles(f => f.map(x => x.id === fileId ? { ...x, folder_id: updated.folder_id } : x))
      const folder = folders.find(f => f.id === folderId)
      onToast(folderId ? `Moved to "${folder?.name}"` : 'Removed from folder')
    } catch {
      onToast('Failed to move file', 'error')
    }
  }

  const toggleCollapse = (folderId) =>
    setCollapsed(c => ({ ...c, [folderId]: !c[folderId] }))

  const handleFileDrop = (folderId) => {
    if (!draggingFile || draggingFile.folder_id === folderId) return
    handleAssignFolder(draggingFile.id, folderId)
    setDraggingFile(null)
    setDropTarget(null)
  }

  const renderFile = (f) => (
    <div
      key={f.id}
      className={cn(
        'flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors group',
        selectedFile?.id === f.id
          ? 'bg-sky-400/10 border border-sky-400/20'
          : 'hover:bg-muted border border-transparent',
        draggingFile?.id === f.id && 'opacity-50'
      )}
      onClick={() => onSelect(f)}
      draggable
      onDragStart={e => { e.stopPropagation(); setDraggingFile(f) }}
      onDragEnd={() => { setDraggingFile(null); setDropTarget(null) }}
      style={{ cursor: 'grab' }}
    >
      <span className={cn('shrink-0', selectedFile?.id === f.id ? 'text-sky-400' : 'text-muted-foreground')}>
        <IconFile />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate" title={f.name}>{f.name}</div>
        <div className="text-xs text-muted-foreground">{formatBytes(f.size)} · {formatDate(f.uploaded_at)}</div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
        <select
          className="h-6 rounded border border-input bg-background px-1.5 text-xs outline-none focus:border-ring dark:bg-input/30"
          value={f.folder_id || ''}
          onChange={e => handleAssignFolder(f.id, e.target.value)}
          title="Move to folder"
        >
          <option value="">No folder</option>
          {folders.map(fo => (
            <option key={fo.id} value={fo.id}>{fo.name}</option>
          ))}
        </select>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
          title="Delete file"
          onClick={() => setConfirmDelete(f)}
        >
          <IconTrash />
        </Button>
      </div>
    </div>
  )

  const unfiledFiles = files.filter(f => !f.folder_id)

  return (
    <div className="grid md:grid-cols-[1fr_1.3fr] gap-4 items-start">
      <div className="flex flex-col gap-4">
        {/* Upload card */}
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Upload</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-3">
            <div
              className={cn(
                'flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 cursor-pointer transition-colors text-sm',
                dragOver ? 'border-sky-400 bg-sky-400/5' : 'border-border hover:border-muted-foreground/40 hover:bg-muted/40'
              )}
              onClick={() => !uploading && inputRef.current.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <svg width="28" height="28" fill="none" viewBox="0 0 24 24" className="text-sky-400" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1"/>
                <polyline points="16 6 12 2 8 6"/>
                <line x1="12" y1="2" x2="12" y2="15"/>
              </svg>
              <p className="text-muted-foreground">Drop a file or click to browse</p>
              <div className="flex gap-1.5 flex-wrap justify-center">
                {['.mf4', '.mdf', '.md', '.json'].map(ext => (
                  <span key={ext} className="text-xs bg-secondary text-secondary-foreground rounded px-1.5 py-0.5">{ext}</span>
                ))}
              </div>
            </div>
            {uploading && <Progress value={progress} />}
            <input
              ref={inputRef}
              type="file"
              accept=".mf4,.mdf,.md,.json,.MF4,.MDF,.MD,.JSON"
              className="hidden"
              onChange={e => handleFiles(e.target.files)}
            />
          </CardContent>
        </Card>

        {/* Files + Folders card */}
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center gap-2">
              <CardTitle>Files</CardTitle>
              {files.length > 0 && <Badge variant="secondary">{files.length}</Badge>}
              <div className="flex gap-1.5 ml-auto">
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => setShowNewFolder(v => !v)}
                >
                  + Folder
                </Button>
                {files.length > 0 && (
                  <Button
                    variant="destructive"
                    size="xs"
                    onClick={() => setConfirmDelete('all')}
                  >
                    Delete all
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-3">
            {/* New folder input */}
            {showNewFolder && (
              <div className="flex gap-2 mb-3">
                <Input
                  ref={newFolderRef}
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  placeholder="Folder name…"
                  className="flex-1"
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleCreateFolder()
                    if (e.key === 'Escape') { setShowNewFolder(false); setNewFolderName('') }
                  }}
                />
                <Button size="sm" onClick={handleCreateFolder}>Add</Button>
                <Button size="sm" variant="outline" onClick={() => { setShowNewFolder(false); setNewFolderName('') }}>✕</Button>
              </div>
            )}

            {files.length === 0 && folders.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No files yet. Upload an MDF file to get started.</p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {/* Folders */}
                {folders.map(folder => {
                  const folderFiles = files.filter(f => f.folder_id === folder.id)
                  const isCollapsed = collapsed[folder.id]
                  return (
                    <div key={folder.id}>
                      <div
                        className={cn(
                          'flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer hover:bg-muted transition-colors',
                          dropTarget === folder.id && 'ring-2 ring-sky-400'
                        )}
                        onClick={() => toggleCollapse(folder.id)}
                        onDragOver={e => { if (draggingFile && draggingFile.folder_id !== folder.id) { e.preventDefault(); setDropTarget(folder.id) } }}
                        onDragLeave={() => setDropTarget(null)}
                        onDrop={e => { e.preventDefault(); handleFileDrop(folder.id) }}
                      >
                        <span className={cn('text-xs transition-transform text-muted-foreground', isCollapsed && '-rotate-90')}>▼</span>
                        <svg width="13" height="13" fill="none" viewBox="0 0 24 24" className="text-sky-400 shrink-0" stroke="currentColor" strokeWidth="2">
                          <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
                        </svg>
                        <span className="text-sm font-medium flex-1">{folder.name}</span>
                        {folderFiles.length > 0 && <Badge variant="secondary" className="h-4 text-[10px]">{folderFiles.length}</Badge>}
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          title="Delete folder"
                          onClick={e => { e.stopPropagation(); setConfirmDelete({ ...folder, type: 'folder' }) }}
                        >
                          <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                          </svg>
                        </Button>
                      </div>
                      <div className={cn('grid transition-all duration-200', isCollapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]')}>
                        <div className="overflow-hidden">
                          <div className="pl-4 flex flex-col gap-0.5 pt-0.5">
                            {folderFiles.length === 0 ? (
                              <p className="text-xs text-muted-foreground px-3 py-2">Empty folder</p>
                            ) : (
                              folderFiles.map(renderFile)
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}

                {/* Unfiled files */}
                {(unfiledFiles.length > 0 || (draggingFile && draggingFile.folder_id)) && (
                  <div
                    className={cn('rounded-lg', dropTarget === '' && 'ring-2 ring-sky-400')}
                    onDragOver={e => { if (draggingFile?.folder_id) { e.preventDefault(); setDropTarget('') } }}
                    onDragLeave={() => setDropTarget(null)}
                    onDrop={e => { e.preventDefault(); handleFileDrop('') }}
                  >
                    {folders.length > 0 && (
                      <p className={cn(
                        'text-xs font-medium px-3 py-1.5 transition-colors',
                        dropTarget === '' ? 'text-sky-400' : 'text-muted-foreground'
                      )}>
                        {dropTarget === '' ? 'Drop to remove from folder' : 'Unfiled'}
                      </p>
                    )}
                    {unfiledFiles.map(renderFile)}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Selected file detail */}
      <Card>
        {selectedFile ? (
          <>
            <CardHeader className="border-b">
              <div className="flex items-center gap-2 min-w-0">
                <CardTitle className="truncate flex-1">{selectedFile.name}</CardTitle>
                <span className="text-xs text-muted-foreground shrink-0">{selectedFile.ext?.toUpperCase().replace('.','')}</span>
              </div>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="flex flex-wrap gap-3">
                {[
                  { label: 'Size', value: formatBytes(selectedFile.size) },
                  { label: 'Uploaded', value: formatDate(selectedFile.uploaded_at) },
                  { label: 'Type', value: selectedFile.ext },
                ].map(({ label, value }) => (
                  <div key={label} className="flex flex-col gap-0.5 min-w-[80px]">
                    <span className="text-xs text-muted-foreground">{label}</span>
                    <span className="text-sm font-medium">{value}</span>
                  </div>
                ))}
              </div>
              <Button onClick={() => onSelect(selectedFile)}>Open in Viewer →</Button>
            </CardContent>
          </>
        ) : (
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
            <svg width="36" height="36" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            <p className="text-sm">Select a file to see details</p>
          </CardContent>
        )}
      </Card>

      {/* Delete confirmation dialog */}
      <Dialog open={!!confirmDelete} onOpenChange={open => !open && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="text-destructive"><IconTrash /></span>
              {confirmDelete === 'all'
                ? `Delete all ${files.length} files?`
                : confirmDelete?.type === 'folder'
                  ? `Delete folder "${confirmDelete?.name}"?`
                  : `Delete "${confirmDelete?.name}"?`}
            </DialogTitle>
            <DialogDescription>
              {confirmDelete?.type === 'folder'
                ? 'Files inside will be unassigned, not deleted.'
                : 'This is permanent and cannot be undone.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmAndDelete}>
              {confirmDelete?.type === 'folder' ? 'Delete folder' : 'Delete permanently'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
