import { useState, useEffect, useRef } from 'react'
import { getFileInfo, getChannelData, getDriveFileInfo, getDriveChannelData, listFiles, listFolders } from '../api'
import SignalChart from './SignalChart'
import MarkdownViewer from './MarkdownViewer'
import JsonViewer from './JsonViewer'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

// ── File picker ───────────────────────────────────────────────────────────────
function FilePicker({ file, onSelect }) {
  const [open, setOpen]       = useState(false)
  const [files, setFiles]     = useState([])
  const [folders, setFolders] = useState([])
  const [search, setSearch]   = useState('')
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
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'flex items-center gap-2 px-3.5 py-2 rounded-lg border border-border bg-card text-sm cursor-pointer',
          'min-w-[220px] max-w-[340px] hover:bg-muted transition-colors',
          file ? 'text-foreground font-medium' : 'text-muted-foreground'
        )}
      >
        <svg width="14" height="14" className="shrink-0 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/>
        </svg>
        <span className="overflow-hidden text-ellipsis whitespace-nowrap flex-1 text-left">
          {file ? file.name : 'Select a file…'}
        </span>
        <svg width="12" height="12" className="shrink-0 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div className="absolute top-[calc(100%+6px)] left-0 z-50 w-[300px] max-h-[360px] flex flex-col rounded-xl border border-border bg-card shadow-xl">
          <div className="p-2 border-b border-border">
            <Input
              ref={searchRef}
              placeholder="Search files…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-7 text-xs"
            />
          </div>
          <div className="overflow-y-auto flex-1 p-1.5">
            {filteredFiles.length === 0 && (
              <div className="text-[0.8125rem] text-muted-foreground px-3 py-3 text-center">
                No files found
              </div>
            )}
            {groups.map(groupKey => (
              <div key={groupKey}>
                <div className="text-[0.6875rem] font-bold text-muted-foreground uppercase tracking-wide px-2 py-1 mt-1 first:mt-0">
                  {groupKey ? (folderMap[groupKey] || 'Unknown folder') : 'Unfiled'}
                </div>
                {grouped[groupKey].map(f => (
                  <button key={f.id} onClick={() => handleSelect(f)}
                    className={cn(
                      'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[0.8125rem] border-none cursor-pointer text-left transition-colors',
                      file?.id === f.id
                        ? 'bg-sky-400/10 text-sky-400 font-semibold'
                        : 'text-foreground bg-transparent hover:bg-muted'
                    )}
                  >
                    <svg width="13" height="13" className="shrink-0 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/>
                    </svg>
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap">{f.name}</span>
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
  const [info, setInfo]             = useState(null)
  const [loading, setLoading]       = useState(false)
  const [search, setSearch]         = useState('')
  const [charts, setCharts]         = useState([])
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
    if (charts.find(c => c.key === key)) { setActiveChart(key); onToast(`${ch.name} already in chart`); return }
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
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card p-12 text-center">
        <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.2" className="text-border">
          <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/>
        </svg>
        <div className="font-semibold">No file selected</div>
        <div className="text-sm text-muted-foreground">Choose a file from the dropdown above</div>
      </div>
    )

    if (file.ext === '.md')   return <MarkdownViewer file={file} onToast={onToast} />
    if (file.ext === '.json') return <JsonViewer file={file} onToast={onToast} />

    if (loading) return (
      <>
        <div className="flex gap-2 flex-wrap mb-1">
          {[80, 64, 56, 120].map((w, i) => (
            <div key={i} className="h-9 rounded-lg border border-border bg-card px-3 py-1.5 flex items-center">
              <div className="h-2.5 rounded bg-muted animate-pulse" style={{ width: w }} />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-[260px_1fr] gap-4 items-start">
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="h-3 w-16 rounded bg-muted animate-pulse" />
              <div className="h-4 w-6 rounded-full bg-muted animate-pulse" />
            </div>
            <div className="p-3 flex flex-col gap-2">
              <div className="h-7 rounded-md bg-muted animate-pulse" />
              <div className="flex flex-col gap-0.5">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-7 rounded-md bg-muted/60 animate-pulse" style={{ animationDelay: `${i * 40}ms` }} />
                ))}
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center px-4 py-3 border-b border-border">
              <div className="h-3 w-24 rounded bg-muted animate-pulse" />
            </div>
            <div className="p-4 flex items-center justify-center min-h-[200px]">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" />
                Parsing MDF file…
              </div>
            </div>
          </div>
        </div>
      </>
    )

    if (!info) return null

    const allChannels = info.channels || []
    const filtered = search
      ? allChannels.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
      : allChannels

    return (
      <>
        {/* Info bar */}
        <div className="flex gap-2 flex-wrap mb-1">
          {[
            { label: 'Version',  value: info.version },
            { label: 'Channels', value: allChannels.length },
            { label: 'Groups',   value: info.groups },
            ...(info.start_time ? [{ label: 'Start', value: new Date(info.start_time).toLocaleString() }] : []),
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5">
              <span className="text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-wide">{label}</span>
              <span className="text-sm font-medium">{value}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-[260px_1fr] gap-4 items-start">
          {/* Channel list */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold">Channels</h2>
              <span className="text-xs bg-muted border border-border rounded-full px-2 py-0.5">{allChannels.length}</span>
            </div>
            <div className="p-3 flex flex-col gap-2">
              <Input
                placeholder="Search channels..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="h-7 text-xs"
              />
              <div className="flex flex-col gap-0.5 max-h-[400px] overflow-y-auto">
                {filtered.length === 0 && (
                  <div className="text-muted-foreground text-[0.8125rem] py-2">No channels found</div>
                )}
                {filtered.map(ch => {
                  const key = `${ch.group}:${ch.name}`
                  const sel = !!charts.find(c => c.key === key)
                  const isMaster = ch.type === 2 || ch.type === 3
                  return (
                    <div
                      key={key}
                      onClick={() => addChannel(ch)}
                      title={`Group ${ch.group} · ${ch.bit_count}-bit`}
                      className={cn(
                        'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md cursor-pointer transition-colors text-xs',
                        sel
                          ? 'bg-sky-400/10 text-sky-400 border border-sky-400/20'
                          : isMaster
                            ? 'text-muted-foreground hover:bg-muted border border-transparent italic'
                            : 'text-foreground hover:bg-muted border border-transparent'
                      )}
                    >
                      <span className="flex-1 truncate font-medium">{ch.name}</span>
                      {ch.unit && <span className="text-[0.65rem] text-muted-foreground shrink-0">{ch.unit}</span>}
                      <span className="text-[0.65rem] text-muted-foreground/60 shrink-0">{ch.bit_count}b</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Chart panel */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold">Signal Plots</h2>
              {charts.length > 0 && (
                <span className="text-xs text-muted-foreground">Click a channel to add it</span>
              )}
            </div>
            <div className="p-4">
              {charts.length === 0 ? (
                <div className="flex items-center justify-center text-sm text-muted-foreground min-h-[200px]">
                  Click a channel to plot its data
                </div>
              ) : (
                <>
                  {/* Chart tabs */}
                  <div className="flex gap-1 flex-wrap mb-4">
                    {charts.map(c => (
                      <div
                        key={c.key}
                        onClick={() => setActiveChart(c.key)}
                        className={cn(
                          'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs cursor-pointer transition-colors',
                          activeChart === c.key
                            ? 'bg-sky-400 text-white'
                            : 'bg-muted text-muted-foreground border border-border hover:text-foreground'
                        )}
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ background: activeChart === c.key ? 'white' : c.color }}
                        />
                        <span className="max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap">{c.name}</span>
                        <span
                          className="hover:text-destructive ml-0.5 opacity-60 hover:opacity-100"
                          onClick={e => { e.stopPropagation(); removeChart(c.key) }}
                          title="Remove"
                        >
                          ×
                        </span>
                      </div>
                    ))}
                  </div>
                  {currentChart?.loading && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" /> Loading signal…
                    </div>
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
    <div className="flex flex-col gap-4">
      {/* File picker — always visible */}
      <div className="flex items-center gap-3">
        <FilePicker file={file} onSelect={onSelect} />
        {file && (
          <span className="text-xs text-muted-foreground">
            {file.ext === '.md' ? 'Markdown' : file.ext === '.json' ? 'JSON' : 'MDF'} file
          </span>
        )}
      </div>

      {renderContent()}
    </div>
  )
}
