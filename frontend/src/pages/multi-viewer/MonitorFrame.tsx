import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
  label: string
  status?: 'ok' | 'warn' | 'off'
  statusLabel?: string
  footer?: ReactNode
}

const DOT_COLOR: Record<NonNullable<Props['status']>, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  off: 'bg-gray-600',
}

// A área de vídeo preenche o espaço restante (flex-1) e o próprio <video>
// (object-contain, ver VideoPlayer.tsx) preserva 16:9 sem distorcer —
// deixar o wrapper aqui tentar assumir um tamanho de aspect-ratio próprio
// (em vez de só encher o flex-1) já causou a barra de nome/VU sumir da tela
// em janelas largas: o box calculado a partir da largura podia passar da
// altura disponível e empurrar a barra pra fora da célula do grid.
export function MonitorFrame({ children, label, status = 'off', statusLabel, footer }: Props) {
  return (
    <div className="relative w-full h-full bg-black flex flex-col overflow-hidden rounded">
      <div className="relative flex-1 min-h-0 bg-black overflow-hidden">{children}</div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-2 py-1 bg-gray-950 border-t border-gray-800/80 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">{footer}</div>
        <div className="flex items-center justify-center gap-1.5 min-w-0">
          <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${DOT_COLOR[status]}`} />
          <span className="text-xs font-bold text-white tracking-wide truncate">{label}</span>
        </div>
        <div className="flex items-center justify-end min-w-0">
          {statusLabel && (
            <span className="text-[9px] font-semibold text-gray-400 tracking-wide truncate">{statusLabel}</span>
          )}
        </div>
      </div>
    </div>
  )
}
