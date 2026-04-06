import { useState, useEffect, useRef } from 'react'
import { getFileInfo, getChannelData, getDriveFileInfo, getDriveChannelData, listFiles, listFolders } from '../api'
import SignalChart from './SignalChart'
import MarkdownViewer from './MarkdownViewer'
import JsonViewer from './JsonViewer'

// ── File picker ───────────────────────────────────────────────────────────────
function FilePicker({ file, onSelect }) {
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState([])
  const [folders, setFolders] = useState([])
  const [search, setSearch] = useState('')
  const ref = useRef()
  const searchRef = useRef()

  useEffect(() => {
    Promise.all([listFiles(), listFolders()])
      .then(([f, fo]) => { setFiles(f); setFolders(fo) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50)
    else setSearch('')
  }, [open])

  const q = search.toLowerCase()
  const filteredFiles = q ? files.filter(f => f.name.toLowerCase().includes(q)) : files

  const folderMap = Object.fromEntries(folders.map(f => [f.id, f.name]))
  const groups = []
  const grouped = {}
  for (const f of filteredFiles) {
    const key = f.folder_id || ''
    if (!grouped[key]) { grouped[key] = []; groups.push(key) }
    grouped[key].push(f)
  }

  const handleSelect = (f) => { onSelect(f); setOpen(false); setSearch('') }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          padding: '0.45rem 0.875rem', borderRadius: 7, fontSize: '0.875rem',
          background: 'var(--surface)', border: '1px solid var(--border)',
          color: file ? 'var(--text)' : 'var(--muted)', cursor: 'pointer',
          minWidth: 220, maxWidth: 340, fontWeight: file ? 500 : 400,
        }}>
        <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, opacity: 0.6 }}>
          <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/>
        </svg>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'left' }}>
          {file ? file.name : 'Select a file…'}
        </span>
        <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0, opacity: 0.5 }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 200,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 9,
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)', width: 300, maxHeight: 360,
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '0.5rem', borderBottom: '1px solid var(--border)' }}>
            <input
              ref={searchRef}
              placeholder="Search files…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', fontSize: '0.8125rem', padding: '0.375rem 0.625rem', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ overflowY: 'auto', flex: 1, padding: '0.375rem' }}>
            {filteredFiles.length === 0 && (
              <div style={{ fontSize: '0.8125rem', color: 'var(--muted)', padding: '0.75rem', textAlign: 'center' }}>
                No files found
              </div>
            )}
            {groups.map(groupKey => (
              <div key={groupKey}>
                <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase',
                  letterSpacing: '0.06em', padding: '0.4rem 0.5rem 0.2rem',
                  marginTop: groupKey ? '0.375rem' : 0 }}>
                  {groupKey ? (folderMap[groupKey] || 'Unknown folder') : 'Unfiled'}
                </div>
                {grouped[groupKey].map(f => (
                  <button key={f.id} onClick={() => handleSelect(f)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem',
                      padding: '0.4rem 0.5rem', borderRadius: 5, fontSize: '0.8125rem',
                      background: file?.id === f.id ? 'rgba(99,102,241,0.1)' : 'transparent',
                      color: file?.id === f.id ? 'var(--accent)' : 'var(--text)',
                      border: 'none', cursor: 'pointer', textAlign: 'left',
                      fontWeight: file?.id === f.id ? 600 : 400,
                    }}>
                    <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, opacity: 0.5 }}>
                      <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/>
                    </svg>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main viewer ───────────────────────────────────────────────────────────────
const CHART_COLORS = [
  '#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4',
  '#a855f7', '#f97316', '#14b8a6', '#ec4899', '#84cc16',
]

export default function MDFViewer({ file, onSelect, onToast }) {
  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [charts, setCharts] = useState([])
  const [activeChart, setActiveChart] = useState(null)

  useEffect(() => {
    if (!file || file.ext === '.md' || file.ext === '.json') {
      setInfo(null); setCharts([]); setActiveChart(null); return
    }
    setLoading(true)
    setInfo(null)
    setCharts([])
    setActiveChart(null)
    const fetchInfo = file.source === 'drive' ? getDriveFileInfo : getFileInfo
    fetchInfo(file.id)
      .then(setInfo)
      .catch(e => onToast(e?.response?.data?.error || 'Failed to parse file', 'error'))
      .finally(() => setLoading(false))
  }, [file?.id])

  const addChannel = async (ch) => {
    const key = `${ch.group}:${ch.name}`
    if (charts.find(c => c.key === key)) { setActiveChart(key); return }
    const color = CHART_COLORS[charts.length % CHART_COLORS.length]
    setCharts(c => [...c, { key, name: ch.name, group: ch.group, color, data: null, loading: true }])
    setActiveChart(key)
    try {
      const fetchData = file.source === 'drive' ? getDriveChannelData : getChannelData
      const data = await fetchData(file.id, ch.group, ch.name)
      setCharts(c => c.map(x => x.key === key ? { ...x, data, loading: false } : x))
    } catch (e) {
      onToast(e?.response?.data?.error || `Failed to load ${ch.name}`, 'error')
      setCharts(c => c.filter(x => x.key !== key))
      if (activeChart === key) setActiveChart(charts[0]?.key || null)
    }
  }

  const removeChart = (key) => {
    setCharts(c => {
      const next = c.filter(x => x.key !== key)
      if (activeChart === key) setActiveChart(next[0]?.key || null)
      return next
    })
  }

  const currentChart = charts.find(c => c.key === activeChart)

  const renderContent = () => {
    if (!file) return (
      <div className="card">
        <div className="viewer-placeholder">
          <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="var(--border)" strokeWidth="1.2">
            <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/>
          </svg>
          <div style={{ fontWeight: 600 }}>No file selected</div>
          <div style={{ fontSize: '0.8125rem', color: 'var(--muted)' }}>Choose a file from the dropdown above</div>
        </div>
      </div>
    )

    if (file.ext === '.md')   return <MarkdownViewer file={file} onToast={onToast} />
    if (file.ext === '.json') return <JsonViewer file={file} onToast={onToast} />

    if (loading) return (
      <div className="card">
        <div className="loading-overlay"><span className="spinner" /> Parsing MDF file…</div>
      </div>
    )

    if (!info) return null

    const allChannels = info.channels || []
    const filtered = search
      ? allChannels.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
      : allChannels

    return (
      <>
        <div className="info-bar">
          <div className="info-chip"><span className="label">Version</span><span className="value">{info.version}</span></div>
          <div className="info-chip"><span className="label">Channels</span><span className="value">{allChannels.length}</span></div>
          <div className="info-chip"><span className="label">Groups</span><span className="value">{info.groups}</span></div>
          {info.start_time && (
            <div className="info-chip"><span className="label">Start</span><span className="value">{new Date(info.start_time).toLocaleString()}</span></div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: '1rem', alignItems: 'start' }}>
          <div className="card">
            <div className="card-header">
              <h2>Channels</h2>
              <span className="badge">{allChannels.length}</span>
            </div>
            <div className="card-body">
              <input className="channel-search" placeholder="Search channels..." value={search} onChange={e => setSearch(e.target.value)} />
              <div className="channel-grid">
                {filtered.length === 0 && (
                  <div style={{ color: 'var(--muted)', fontSize: '0.8125rem', padding: '0.5rem 0' }}>No channels found</div>
                )}
                {filtered.map(ch => {
                  const key = `${ch.group}:${ch.name}`
                  const sel = !!charts.find(c => c.key === key)
                  return (
                    <div key={key}
                      className={`channel-item${sel ? ' selected' : ''}${ch.type === 2 || ch.type === 3 ? ' master' : ''}`}
                      onClick={() => addChannel(ch)} title={`Group ${ch.group} · ${ch.bit_count}-bit`}>
                      <span className="channel-name">{ch.name}</span>
                      {ch.unit && <span className="channel-unit">{ch.unit}</span>}
                      <span className="channel-bits">{ch.bit_count}b</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h2>Signal Plots</h2>
              {charts.length > 0 && (
                <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Click a channel to add it</span>
              )}
            </div>
            <div className="card-body">
              {charts.length === 0 ? (
                <div className="chart-placeholder">Click a channel to plot its data</div>
              ) : (
                <>
                  <div className="chart-tabs">
                    {charts.map(c => (
                      <div key={c.key} className={`chart-tab${activeChart === c.key ? ' active' : ''}`} onClick={() => setActiveChart(c.key)}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, display: 'inline-block',
                          background: activeChart === c.key ? 'white' : c.color }} />
                        <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                        <span className="tab-close" onClick={e => { e.stopPropagation(); removeChart(c.key) }} title="Remove">×</span>
                      </div>
                    ))}
                  </div>
                  {currentChart?.loading && (
                    <div className="loading-overlay"><span className="spinner" /> Loading signal…</div>
                  )}
                  {currentChart && !currentChart.loading && currentChart.data && (
                    <SignalChart signal={currentChart.data} color={currentChart.color} />
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* File picker — always visible */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <FilePicker file={file} onSelect={onSelect} />
        {file && (
          <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
            {file.ext === '.md' ? 'Markdown' : file.ext === '.json' ? 'JSON' : 'MDF'} file
          </span>
        )}
      </div>

      {renderContent()}
    </div>
  )
}
