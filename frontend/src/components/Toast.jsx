export default function Toast({ toasts }) {
  if (!toasts.length) return null
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type}`}>
          {t.type === 'success'
            ? <span style={{ color: 'var(--success)' }}>✓</span>
            : <span style={{ color: 'var(--danger)' }}>✕</span>}
          {t.msg}
        </div>
      ))}
    </div>
  )
}
