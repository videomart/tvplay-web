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

// Cada monitor mantém sempre proporção 16:9 (aspect-video), independente do
// formato da célula do grid — o espaço que sobra acima/abaixo (ou nas
// laterais) vira badges com nome do canal/entrada, status e controle de
// áudio, em vez de esticar o vídeo e distorcer a imagem.
export function MonitorFrame({ children, label, status = 'off', statusLabel, footer }: Props) {
  return (
    <div className="relative w-full h-full bg-black flex flex-col overflow-hidden rounded">
      <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-950 border-b border-gray-800/80 flex-shrink-0">
        <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${DOT_COLOR[status]}`} />
        <span className="text-xs font-bold text-white tracking-wide truncate">{label}</span>
        {statusLabel && (
          <span className="ml-auto text-[9px] font-semibold text-gray-400 tracking-wide flex-shrink-0">
            {statusLabel}
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 grid place-items-center bg-black">
        <div className="relative aspect-video w-auto h-auto max-w-full max-h-full">{children}</div>
      </div>

      {footer && (
        <div className="flex items-center gap-2 px-2 py-1 bg-gray-950 border-t border-gray-800/80 flex-shrink-0">
          {footer}
        </div>
      )}
    </div>
  )
}
