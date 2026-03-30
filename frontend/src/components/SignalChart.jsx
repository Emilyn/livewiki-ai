import { useMemo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Brush,
} from 'recharts'

const MAX_POINTS = 4000

function downsample(times, values, maxPoints) {
  if (times.length <= maxPoints) return { times, values }
  const step = Math.ceil(times.length / maxPoints)
  const t = [], v = []
  for (let i = 0; i < times.length; i += step) {
    t.push(times[i])
    v.push(values[i])
  }
  return { times: t, values: v }
}

function fmt(n) {
  if (n === undefined || n === null || isNaN(n)) return '—'
  if (Math.abs(n) >= 1e6 || (Math.abs(n) < 0.001 && n !== 0)) return n.toExponential(3)
  return parseFloat(n.toPrecision(6)).toString()
}

export default function SignalChart({ signal, color }) {
  const [showStats, setShowStats] = useState(false)

  const { data, stats } = useMemo(() => {
    const { times, values } = downsample(signal.times || [], signal.values || [], MAX_POINTS)
    const chartData = times.map((t, i) => ({ t: parseFloat(t.toPrecision(8)), v: values[i] }))

    const nums = (signal.values || []).filter(x => isFinite(x))
    let min = Infinity, max = -Infinity, sum = 0
    for (const n of nums) {
      if (n < min) min = n
      if (n > max) max = n
      sum += n
    }
    const mean = nums.length ? sum / nums.length : 0
    const variance = nums.length
      ? nums.reduce((a, x) => a + (x - mean) ** 2, 0) / nums.length
      : 0

    return {
      data: chartData,
      stats: {
        samples: signal.values?.length || 0,
        min: nums.length ? min : NaN,
        max: nums.length ? max : NaN,
        mean,
        std: Math.sqrt(variance),
      },
    }
  }, [signal])

  if (!data.length) {
    return (
      <div className="chart-placeholder" style={{ minHeight: 250 }}>
        No data points in this signal
      </div>
    )
  }

  const unit = signal.unit ? ` (${signal.unit})` : ''

  return (
    <div>
      {/* Stats bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.875rem', fontWeight: 600, color }}>
          {signal.name}{unit}
        </span>
        <span style={{ fontSize: '0.75rem', color: 'var(--muted)', marginLeft: 'auto' }}>
          {stats.samples.toLocaleString()} samples
          {data.length < stats.samples && ` (${data.length.toLocaleString()} shown)`}
        </span>
        <button
          className="btn-add"
          onClick={() => setShowStats(s => !s)}
          style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
        >
          {showStats ? 'Hide stats' : 'Stats'}
        </button>
      </div>

      {showStats && (
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
          {[['Min', stats.min], ['Max', stats.max], ['Mean', stats.mean], ['Std dev', stats.std]].map(([label, val]) => (
            <div key={label} className="info-chip" style={{ flex: '1 1 100px' }}>
              <span className="label">{label}</span>
              <span className="value" style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}>{fmt(val)}</span>
              {signal.unit && <span style={{ fontSize: '0.6875rem', color: 'var(--muted)' }}>{signal.unit}</span>}
            </div>
          ))}
        </div>
      )}

      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="t"
            tick={{ fill: 'var(--muted)', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: 'var(--border)' }}
            label={{ value: 'Time (s)', position: 'insideBottomRight', offset: -4, fill: 'var(--muted)', fontSize: 11 }}
          />
          <YAxis
            tick={{ fill: 'var(--muted)', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: 'var(--border)' }}
            width={70}
            tickFormatter={v => fmt(v)}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: '0.8125rem',
            }}
            labelStyle={{ color: 'var(--muted)' }}
            formatter={(v) => [fmt(v) + (signal.unit ? ' ' + signal.unit : ''), signal.name]}
            labelFormatter={t => `t = ${fmt(t)} s`}
          />
          {isFinite(stats.mean) && (
            <ReferenceLine y={stats.mean} stroke="var(--muted)" strokeDasharray="4 4" strokeWidth={1} />
          )}
          <Line
            type="linear"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={data.length < 500}
          />
          {data.length > 200 && (
            <Brush
              dataKey="t"
              height={22}
              stroke="var(--border)"
              fill="var(--surface)"
              travellerWidth={6}
              tickFormatter={v => fmt(v)}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
