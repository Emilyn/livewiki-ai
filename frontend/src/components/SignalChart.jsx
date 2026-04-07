import { useMemo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Brush,
} from 'recharts'
import { Button } from '@/components/ui/button'

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
      <div className="flex items-center justify-center text-sm text-muted-foreground min-h-[250px]">
        No data points in this signal
      </div>
    )
  }

  const unit = signal.unit ? ` (${signal.unit})` : ''

  return (
    <div>
      {/* Stats bar */}
      <div className="flex items-center gap-4 mb-3 flex-wrap">
        <span className="text-sm font-semibold" style={{ color }}>
          {signal.name}{unit}
        </span>
        <span className="text-xs text-muted-foreground ml-auto">
          {stats.samples.toLocaleString()} samples
          {data.length < stats.samples && ` (${data.length.toLocaleString()} shown)`}
        </span>
        <Button size="xs" variant="outline" onClick={() => setShowStats(s => !s)}>
          {showStats ? 'Hide stats' : 'Stats'}
        </Button>
      </div>

      {showStats && (
        <div className="flex gap-3 flex-wrap mb-3">
          {[['Min', stats.min], ['Max', stats.max], ['Mean', stats.mean], ['Std dev', stats.std]].map(([label, val]) => (
            <div key={label} className="flex-1 basis-24 rounded-lg border border-border bg-muted/50 px-3 py-2">
              <p className="text-[0.6875rem] text-muted-foreground uppercase tracking-wide font-semibold">{label}</p>
              <p className="text-sm font-mono font-medium mt-0.5">{fmt(val)}</p>
              {signal.unit && <p className="text-[0.6875rem] text-muted-foreground">{signal.unit}</p>}
            </div>
          ))}
        </div>
      )}

      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="t"
            tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: 'var(--border)' }}
            label={{ value: 'Time (s)', position: 'insideBottomRight', offset: -4, fill: 'var(--muted-foreground)', fontSize: 11 }}
          />
          <YAxis
            tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: 'var(--border)' }}
            width={70}
            tickFormatter={v => fmt(v)}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: '0.8125rem',
            }}
            labelStyle={{ color: 'var(--muted-foreground)' }}
            formatter={(v) => [fmt(v) + (signal.unit ? ' ' + signal.unit : ''), signal.name]}
            labelFormatter={t => `t = ${fmt(t)} s`}
          />
          {isFinite(stats.mean) && (
            <ReferenceLine y={stats.mean} stroke="var(--muted-foreground)" strokeDasharray="4 4" strokeWidth={1} />
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
              fill="var(--card)"
              travellerWidth={6}
              tickFormatter={v => fmt(v)}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
