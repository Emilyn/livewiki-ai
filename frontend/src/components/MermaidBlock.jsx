import { useState, useEffect, useRef, useCallback } from 'react'
import mermaid from 'mermaid'
import DOMPurify from 'dompurify'

mermaid.initialize({ startOnLoad: false, theme: 'dark', darkMode: true })

const SCALE_MIN = 0.2
const SCALE_MAX = 8
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

export default function MermaidBlock({ code }) {
  const [svg, setSvg]   = useState('')
  const [error, setError] = useState('')

  // Transform stored in a ref so wheel/drag handlers don't stale-close over it.
  // We write directly to the DOM to avoid re-renders on every mouse/wheel event.
  const transformRef  = useRef({ scale: 1, x: 0, y: 0 })
  const innerRef      = useRef(null)
  const containerRef  = useRef(null)
  const dragging      = useRef(false)
  const dragOrigin    = useRef({ mx: 0, my: 0, tx: 0, ty: 0 })
  // pinch
  const pinchRef      = useRef({ active: false, dist: 0, scale: 1 })
  // zoom badge
  const [scale, setScale] = useState(1) // only used for the badge display

  useEffect(() => {
    const id = 'mermaid-' + Math.random().toString(36).slice(2)
    mermaid.render(id, code)
      .then(({ svg: raw }) => {
        // Strip fixed width/height so the SVG scales as a crisp vector.
        // Keep viewBox so it still has intrinsic proportions.
        const clean = DOMPurify.sanitize(raw, {
          USE_PROFILES: { svg: true, svgFilters: true },
          ADD_TAGS: ['style', 'foreignObject', 'div', 'span'],
          ADD_ATTR: ['xmlns', 'dominant-baseline', 'requiredFeatures'],
        })
        const parser = new DOMParser()
        const doc    = parser.parseFromString(clean, 'image/svg+xml')
        const svgEl  = doc.querySelector('svg')
        if (svgEl) {
          svgEl.removeAttribute('width')
          svgEl.removeAttribute('height')
          svgEl.style.width  = '100%'
          svgEl.style.height = 'auto'
        }
        setSvg(new XMLSerializer().serializeToString(doc.documentElement))
      })
      .catch(() => setError('Invalid diagram syntax'))
      .finally(() => {
        document.getElementById(`d${id}`)?.remove()
        document.getElementById(id)?.remove()
      })
  }, [code])

  const applyTransform = useCallback((t) => {
    if (!innerRef.current) return
    innerRef.current.style.transform =
      `translate(${t.x}px, ${t.y}px) scale(${t.scale})`
  }, [])

  const resetTransform = useCallback(() => {
    transformRef.current = { scale: 1, x: 0, y: 0 }
    applyTransform(transformRef.current)
    setScale(1)
  }, [applyTransform])

  // Non-passive wheel listener (React synthetic wheel events are passive)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      const rect   = el.getBoundingClientRect()
      const cx     = e.clientX - rect.left - rect.width  / 2
      const cy     = e.clientY - rect.top  - rect.height / 2
      const factor = e.deltaY < 0 ? 1.06 : 1 / 1.06
      const t      = transformRef.current
      const newScale = clamp(t.scale * factor, SCALE_MIN, SCALE_MAX)
      const ratio    = newScale / t.scale
      const newX = cx - ratio * (cx - t.x)
      const newY = cy - ratio * (cy - t.y)
      transformRef.current = { scale: newScale, x: newX, y: newY }
      applyTransform(transformRef.current)
      setScale(+(newScale.toFixed(2)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [applyTransform, svg])

  const onMouseDown = useCallback((e) => {
    if (e.button !== 0) return
    dragging.current = true
    const t = transformRef.current
    dragOrigin.current = { mx: e.clientX, my: e.clientY, tx: t.x, ty: t.y }
    e.preventDefault()
  }, [])

  const onMouseMove = useCallback((e) => {
    if (!dragging.current) return
    const o = dragOrigin.current
    const t = transformRef.current
    transformRef.current = {
      ...t,
      x: o.tx + (e.clientX - o.mx),
      y: o.ty + (e.clientY - o.my),
    }
    applyTransform(transformRef.current)
  }, [applyTransform])

  const onMouseUp = useCallback(() => { dragging.current = false }, [])

  // Touch: single-finger pan, two-finger pinch
  const onTouchStart = useCallback((e) => {
    if (e.touches.length === 1) {
      dragging.current = true
      const t = transformRef.current
      dragOrigin.current = { mx: e.touches[0].clientX, my: e.touches[0].clientY, tx: t.x, ty: t.y }
    } else if (e.touches.length === 2) {
      dragging.current = false
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      pinchRef.current = { active: true, dist: Math.hypot(dx, dy), scale: transformRef.current.scale }
    }
  }, [])

  const onTouchMove = useCallback((e) => {
    e.preventDefault()
    if (e.touches.length === 1 && dragging.current) {
      const o = dragOrigin.current
      const t = transformRef.current
      transformRef.current = {
        ...t,
        x: o.tx + (e.touches[0].clientX - o.mx),
        y: o.ty + (e.touches[0].clientY - o.my),
      }
      applyTransform(transformRef.current)
    } else if (e.touches.length === 2 && pinchRef.current.active) {
      const dx   = e.touches[0].clientX - e.touches[1].clientX
      const dy   = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.hypot(dx, dy)
      const newScale = clamp(pinchRef.current.scale * (dist / pinchRef.current.dist), SCALE_MIN, SCALE_MAX)
      transformRef.current = { ...transformRef.current, scale: newScale }
      applyTransform(transformRef.current)
      setScale(+(newScale.toFixed(2)))
    }
  }, [applyTransform])

  const onTouchEnd = useCallback(() => {
    dragging.current = false
    pinchRef.current.active = false
  }, [])

  // Attach touch listeners as non-passive
  useEffect(() => {
    const el = containerRef.current
    if (!el || !svg) return
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => el.removeEventListener('touchmove', onTouchMove)
  }, [onTouchMove, svg])

  if (error) return (
    <div className="rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground italic my-4">
      ⚠ Mermaid diagram could not be rendered
    </div>
  )
  if (!svg) return null

  return (
    <div
      ref={containerRef}
      className="relative my-4 overflow-hidden rounded-lg border border-border bg-muted/20 select-none"
      style={{ minHeight: 200, maxHeight: 520, height: 'auto', cursor: dragging.current ? 'grabbing' : 'grab' }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onDoubleClick={resetTransform}
    >
      {/* The diagram */}
      <div
        ref={innerRef}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem',
          transformOrigin: '0 0',
        }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />

      {/* Controls overlay */}
      <div className="absolute bottom-2 right-2 flex items-center gap-1.5 pointer-events-none">
        <span className="text-[10px] bg-background/80 border border-border rounded px-1.5 py-0.5 text-muted-foreground tabular-nums">
          {Math.round(scale * 100)}%
        </span>
      </div>
      <button
        className="absolute top-2 right-2 text-[10px] bg-background/80 border border-border rounded px-1.5 py-0.5 text-muted-foreground hover:text-foreground hover:bg-background transition-colors"
        onMouseDown={e => e.stopPropagation()}
        onClick={resetTransform}
        title="Reset view (or double-click)"
      >
        Reset
      </button>
      <div className="absolute bottom-2 left-2 text-[10px] text-muted-foreground/50 pointer-events-none select-none">
        scroll to zoom · drag to pan
      </div>
    </div>
  )
}
