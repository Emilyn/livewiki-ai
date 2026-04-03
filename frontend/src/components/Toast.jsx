export default function Toast({ toasts }) {
  if (!toasts.length) return null
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type}`}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            background: t.type === 'error' ? 'var(--danger)' : 'var(--success)',
          }} />
          {t.msg}
        </div>
      ))}
    </div>
  )
}
