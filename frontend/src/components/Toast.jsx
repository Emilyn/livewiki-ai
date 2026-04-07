import { cn } from '@/lib/utils'

export default function Toast({ toasts }) {
  if (!toasts.length) return null
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={cn(
            'flex items-center gap-2.5 rounded-lg px-4 py-3 text-sm font-medium shadow-lg pointer-events-auto animate-in slide-in-from-right-4 fade-in-0 duration-200',
            t.type === 'error'
              ? 'bg-destructive/10 text-destructive border border-destructive/20'
              : 'bg-card text-foreground border border-border'
          )}
        >
          <span className={cn(
            'h-1.5 w-1.5 rounded-full shrink-0',
            t.type === 'error' ? 'bg-destructive' : 'bg-green-500'
          )} />
          {t.msg}
        </div>
      ))}
    </div>
  )
}
