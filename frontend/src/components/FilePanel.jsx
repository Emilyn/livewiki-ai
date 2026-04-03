import { useState, useEffect, useRef } from 'react'
import { listFiles, uploadFile, deleteFile, listFolders, createFolder, deleteFolder, assignFileFolder } from '../api'

function formatBytes(b) {
  if (b < 1024) return `${b} B`
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1048576).toFixed(1)} MB`
}

function formatDate(d) {
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
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
  const [draggingFile, setDraggingFile]   = useState(null)  // file object being dragged
  const [dropTarget, setDropTarget]       = useState(null)  // folder id or '' for unfiled
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
      className={`file-item${selectedFile?.id === f.id ? ' active' : ''}`}
      onClick={() => onSelect(f)}
      draggable
      onDragStart={e => { e.stopPropagation(); setDraggingFile(f) }}
      onDragEnd={() => { setDraggingFile(null); setDropTarget(null) }}
      style={{ cursor: 'grab', opacity: draggingFile?.id === f.id ? 0.5 : 1 }}
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
      <div className="file-actions" onClick={e => e.stopPropagation()}>
        <select
          className="folder-select"
          value={f.folder_id || ''}
          onChange={e => handleAssignFolder(f.id, e.target.value)}
          title="Move to folder"
        >
          <option value="">No folder</option>
          {folders.map(fo => (
            <option key={fo.id} value={fo.id}>{fo.name}</option>
          ))}
        </select>
        <button
          className="btn-icon btn-icon-danger"
          title="Delete file"
          onClick={() => setConfirmDelete(f)}
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
  )

  const unfiledFiles = files.filter(f => !f.folder_id)

  return (
    <div className="files-layout">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

        {/* Upload */}
        <div className="card">
          <div className="card-header"><h2>Upload</h2></div>
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
                <span className="ext-badge">.json</span>
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
              accept=".mf4,.mdf,.md,.json,.MF4,.MDF,.MD,.JSON"
              style={{ display: 'none' }}
              onChange={e => handleFiles(e.target.files)}
            />
          </div>
        </div>

        {/* Files + Folders */}
        <div className="card">
          <div className="card-header">
            <h2>Files</h2>
            {files.length > 0 && <span className="badge">{files.length}</span>}
            <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
              <button
                className="btn-add"
                title="New folder"
                onClick={() => setShowNewFolder(v => !v)}
                style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
              >
                + Folder
              </button>
              {files.length > 0 && (
                <button className="btn-danger-sm" onClick={() => setConfirmDelete('all')}>
                  Delete all
                </button>
              )}
            </div>
          </div>
          <div className="card-body" style={{ padding: '0.75rem' }}>

            {/* New folder input */}
            {showNewFolder && (
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <input
                  ref={newFolderRef}
                  className="folder-name-input"
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  placeholder="Folder name…"
                  style={{ flex: 1 }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleCreateFolder()
                    if (e.key === 'Escape') { setShowNewFolder(false); setNewFolderName('') }
                  }}
                />
                <button className="btn-primary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8125rem' }} onClick={handleCreateFolder}>
                  Add
                </button>
                <button className="btn-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8125rem' }} onClick={() => { setShowNewFolder(false); setNewFolderName('') }}>
                  ✕
                </button>
              </div>
            )}

            {files.length === 0 && folders.length === 0 ? (
              <div className="empty-state">No files yet. Upload an MDF file to get started.</div>
            ) : (
              <div className="file-list">

                {/* Folders */}
                {folders.map(folder => {
                  const folderFiles = files.filter(f => f.folder_id === folder.id)
                  const isCollapsed = collapsed[folder.id]
                  return (
                    <div key={folder.id} className="folder-section">
                      <div
                        className="folder-row"
                        onClick={() => toggleCollapse(folder.id)}
                        onDragOver={e => { if (draggingFile && draggingFile.folder_id !== folder.id) { e.preventDefault(); setDropTarget(folder.id) } }}
                        onDragLeave={() => setDropTarget(null)}
                        onDrop={e => { e.preventDefault(); handleFileDrop(folder.id) }}
                        style={{ outline: dropTarget === folder.id ? '2px solid var(--accent)' : 'none', outlineOffset: -2, borderRadius: 6, transition: 'outline 0.1s' }}
                      >
                        <span className={`folder-chevron${isCollapsed ? ' collapsed' : ''}`}>▼</span>
                        <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="var(--accent)" strokeWidth="2">
                          <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
                        </svg>
                        <span className="folder-name">{folder.name}</span>
                        {folderFiles.length > 0 && <span className="badge" style={{ fontSize: '0.625rem', minWidth: 16, height: 16 }}>{folderFiles.length}</span>}
                        <button
                          className="btn-icon btn-icon-danger"
                          style={{ marginLeft: 'auto', width: 24, height: 24 }}
                          title="Delete folder"
                          onClick={e => { e.stopPropagation(); setConfirmDelete({ ...folder, type: 'folder' }) }}
                        >
                          <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                          </svg>
                        </button>
                      </div>
                      {!isCollapsed && (
                        <div className="folder-files">
                          {folderFiles.length === 0 ? (
                            <div style={{ fontSize: '0.75rem', color: 'var(--muted)', padding: '0.5rem 0.75rem' }}>Empty folder</div>
                          ) : (
                            folderFiles.map(renderFile)
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* Unfiled files */}
                {(unfiledFiles.length > 0 || (draggingFile && draggingFile.folder_id)) && (
                  <div
                    onDragOver={e => { if (draggingFile?.folder_id) { e.preventDefault(); setDropTarget('') } }}
                    onDragLeave={() => setDropTarget(null)}
                    onDrop={e => { e.preventDefault(); handleFileDrop('') }}
                    style={{ borderRadius: 6, outline: dropTarget === '' ? '2px solid var(--accent)' : 'none', outlineOffset: -2, transition: 'outline 0.1s' }}
                  >
                    {folders.length > 0 && (
                      <div style={{ fontSize: '0.75rem', color: dropTarget === '' ? 'var(--accent)' : 'var(--muted)', padding: '0.5rem 0.25rem 0.25rem', fontWeight: 500, transition: 'color 0.1s' }}>
                        {dropTarget === '' ? 'Drop to remove from folder' : 'Unfiled'}
                      </div>
                    )}
                    {unfiledFiles.map(renderFile)}
                  </div>
                )}
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
                : confirmDelete.type === 'folder'
                  ? `Delete folder "${confirmDelete.name}"?`
                  : `Delete "${confirmDelete.name}"?`}
            </h3>
            <p>
              {confirmDelete.type === 'folder'
                ? 'Files inside will be unassigned, not deleted.'
                : 'This is permanent and cannot be undone.'}
            </p>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn-danger" onClick={confirmAndDelete}>
                {confirmDelete.type === 'folder' ? 'Delete folder' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Selected file detail */}
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
              <button className="btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => onSelect(selectedFile)}>
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
