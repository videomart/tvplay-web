import { clsx } from 'clsx'

interface BadgeProps {
  children: React.ReactNode
  color?: string
  bg?: string
  className?: string
}

export function Badge({ children, color, bg, className }: BadgeProps) {
  return (
    <span
      className={clsx('inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold', className)}
      style={color || bg ? { color: color ?? '#fff', backgroundColor: bg ?? '#374151' } : undefined}
    >
      {children}
    </span>
  )
}

export function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
      active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-gray-700 text-gray-500',
    )}>
      <span className={clsx('h-1.5 w-1.5 rounded-full', active ? 'bg-emerald-400' : 'bg-gray-500')} />
      {active ? 'Ativo' : 'Inativo'}
    </span>
  )
}
