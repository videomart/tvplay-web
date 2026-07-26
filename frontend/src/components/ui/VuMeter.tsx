interface Props {
  levels: { l: number; r: number } | null
  className?: string
}

const BARS = 16

function dbToBar(db: number): number {
  const clamped = Math.max(-60, Math.min(0, db))
  return Math.round(((clamped + 60) / 60) * (BARS - 1))
}

function segColor(i: number): string {
  if (i >= BARS - 2) return '#ef4444'
  if (i >= BARS - 5) return '#f59e0b'
  return '#22c55e'
}

function Bar({ db, label }: { db: number; label: string }) {
  const active = dbToBar(db)
  return (
    <div className="flex items-center gap-0.5">
      <span className="text-[8px] text-gray-600 font-mono w-2 leading-none">{label}</span>
      <div className="flex gap-px items-center">
        {Array.from({ length: BARS }, (_, i) => (
          <div
            key={i}
            style={{
              width: 3,
              height: 4,
              borderRadius: 0.5,
              backgroundColor: i <= active ? segColor(i) : 'rgba(255,255,255,0.07)',
            }}
          />
        ))}
      </div>
    </div>
  )
}

export function VuMeter({ levels, className }: Props) {
  const l = levels?.l ?? -60
  const r = levels?.r ?? -60
  return (
    <div className={`flex flex-col gap-px ${className ?? ''}`}>
      <Bar db={l} label="L" />
      <Bar db={r} label="R" />
    </div>
  )
}
