import { useState, useEffect } from 'react'
import { getFileInfo, getChannelData, getDriveFileInfo, getDriveChannelData } from '../api'
import SignalChart from './SignalChart'
import MarkdownViewer from './MarkdownViewer'
import JsonViewer from './JsonViewer'

const CHART_COLORS = [
  '#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4',
  '#a855f7', '#f97316', '#14b8a6', '#ec4899', '#84cc16',
]

export default function MDFViewer({ file, onToast }) {
  if (file?.ext === '.md')   return <MarkdownViewer file={file} onToast={onToast} />
  if (file?.ext === '.json') return <JsonViewer file={file} onToast={onToast} />

  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [charts, setCharts] = useState([]) // [{id, name, group, data, color, loading}]
  const [activeChart, setActiveChart] = useState(null)

  useEffect(() => {
    if (!file) { setInfo(null); setCharts([]); setActiveChart(null); return }
    setLoading(true)
    setInfo(null)
    setCharts([])
    setActiveChart(null)
    const fetchInfo = file.source === 'drive' ? getDriveFileInfo : getFileInfo
    fetchInfo(file.id)
      .then(setInfo)
      .catch(e => onToast(e?.response?.data?.error || 'Failed to parse file', 'error'))
      .finally(() => setLoading(false))
  }, [file])

  if (!file) {
    return (
      <div className="card">
        <div className="viewer-placeholder">
          <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="var(--border)" strokeWidth="1.2">
            <path d="M9 17H7A5 5 0 0 1 7 7h2"/>
            <path d="M15 7h2a5 5 0 1 1 0 10h-2"/>
            <line x1="8" y1="12" x2="16" y2="12"/>
          </svg>
          <div>
            <div style={{ fontWeight: 600 }}>No file selected</div>
            <div style={{ fontSize: '0.8125rem', marginTop: '0.25rem' }}>Upload an MDF file and select it to explore signals</div>
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="card">
        <div className="loading-overlay">
          <span className="spinner" />
          Parsing MDF file...
        </div>
      </div>
    )
  }

  if (!info) return null

  const allChannels = info.channels || []
  const filtered = search
    ? allChannels.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
    : allChannels

  const addChannel = async (ch) => {
    const key = `${ch.group}:${ch.name}`
    if (charts.find(c => c.key === key)) {
      // Just switch to it
      setActiveChart(key)
      return
    }
    const color = CHART_COLORS[charts.length % CHART_COLORS.length]
    const entry = { key, name: ch.name, group: ch.group, color, data: null, loading: true }
    setCharts(c => [...c, entry])
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* File info */}
      <div className="info-bar">
        <div className="info-chip">
          <span className="label">Version</span>
          <span className="value">{info.version}</span>
        </div>
        <div className="info-chip">
          <span className="label">Channels</span>
          <span className="value">{allChannels.length}</span>
        </div>
        <div className="info-chip">
          <span className="label">Groups</span>
          <span className="value">{info.groups}</span>
        </div>
        {info.start_time && (
          <div className="info-chip">
            <span className="label">Start</span>
            <span className="value">{new Date(info.start_time).toLocaleString()}</span>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: '1rem', alignItems: 'start' }}>
        {/* Channel list */}
        <div className="card">
          <div className="card-header">
            <h2>Channels</h2>
            <span className="badge">{allChannels.length}</span>
          </div>
          <div className="card-body">
            <input
              className="channel-search"
              placeholder="Search channels..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div className="channel-grid">
              {filtered.length === 0 && (
                <div style={{ color: 'var(--muted)', fontSize: '0.8125rem', padding: '0.5rem 0' }}>No channels found</div>
              )}
              {filtered.map(ch => {
                const key = `${ch.group}:${ch.name}`
                const sel = !!charts.find(c => c.key === key)
                return (
                  <div
                    key={key}
                    className={`channel-item${sel ? ' selected' : ''}${ch.type === 2 || ch.type === 3 ? ' master' : ''}`}
                    onClick={() => addChannel(ch)}
                    title={`Group ${ch.group} · ${ch.bit_count}-bit`}
                  >
                    <span className="channel-name">{ch.name}</span>
                    {ch.unit && <span className="channel-unit">{ch.unit}</span>}
                    <span className="channel-bits">{ch.bit_count}b</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Chart panel */}
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
                    <div
                      key={c.key}
                      className={`chart-tab${activeChart === c.key ? ' active' : ''}`}
                      onClick={() => setActiveChart(c.key)}
                    >
                      <span
                        style={{
                          width: 8, height: 8, borderRadius: '50%',
                          background: activeChart === c.key ? 'white' : c.color,
                          flexShrink: 0,
                          display: 'inline-block',
                        }}
                      />
                      <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.name}
                      </span>
                      <span
                        className="tab-close"
                        onClick={e => { e.stopPropagation(); removeChart(c.key) }}
                        title="Remove"
                      >×</span>
                    </div>
                  ))}
                </div>

                {currentChart?.loading && (
                  <div className="loading-overlay"><span className="spinner" /> Loading signal...</div>
                )}
                {currentChart && !currentChart.loading && currentChart.data && (
                  <SignalChart signal={currentChart.data} color={currentChart.color} />
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
