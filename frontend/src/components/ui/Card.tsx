import { clsx } from 'clsx'

interface CardProps {
  children: React.ReactNode
  className?: string
  padding?: boolean
}

export function Card({ children, className, padding = true }: CardProps) {
  return (
    <div className={clsx('card', padding && 'p-6', className)}>
      {children}
    </div>
  )
}

export function StatCard({ label, value, icon, color = 'brand' }: { label: string; value: string | number; icon: React.ReactNode; color?: string }) {
  return (
    <div className="card p-5 flex items-center gap-4">
      <div className={`p-3 rounded-xl bg-${color}-500/10 text-${color}-400`}>{icon}</div>
      <div>
        <p className="text-2xl font-bold text-white">{value}</p>
        <p className="text-sm text-gray-500">{label}</p>
      </div>
    </div>
  )
}
