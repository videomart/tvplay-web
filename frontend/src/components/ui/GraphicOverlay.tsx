import { useState, useEffect } from 'react'
import { Layers } from 'lucide-react'
import { clsx } from 'clsx'

export interface GraphicConfig {
  logoUrl?: string | null
  logoPosition?: string | null
  showClock?: boolean
  lowerText?: string | null
}

const posClass: Record<string, string> = {
  'top-left':     'top-2 left-2',
  'bottom-left':  'bottom-8 left-2',
  'bottom-right': 'bottom-8 right-2',
  'top-right':    'top-2 right-2',
}

export function GraphicOverlay({ graphic }: { graphic: GraphicConfig }) {
  const [clock, setClock] = useState('')

  useEffect(() => {
    if (!graphic.showClock) return
    const tick = () => setClock(
      new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    )
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [graphic.showClock])

  return (
    <>
      {graphic.logoUrl && (
        <img
          src={graphic.logoUrl}
          alt="Logo"
          className={clsx(
            'absolute h-8 w-auto object-contain opacity-90 pointer-events-none',
            posClass[graphic.logoPosition ?? 'top-right'] ?? posClass['top-right']
          )}
        />
      )}
      {graphic.showClock && clock && (
        <div className="absolute top-2 right-2 bg-black/50 text-white text-[11px] font-mono px-1.5 py-0.5 rounded pointer-events-none">
          {clock}
        </div>
      )}
      {graphic.lowerText && (
        <div className="absolute bottom-2 left-0 right-0 flex justify-center pointer-events-none">
          <span className="bg-black/60 text-white text-[11px] px-2 py-0.5">{graphic.lowerText}</span>
        </div>
      )}
      <div className="absolute top-2 left-2 flex items-center gap-1 bg-violet-900/60 text-violet-300 text-[9px] px-1.5 py-0.5 rounded font-mono pointer-events-none">
        <Layers className="h-2.5 w-2.5" />GFX
      </div>
    </>
  )
}
