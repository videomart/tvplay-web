import { useState, useEffect } from 'react'
import { Layers } from 'lucide-react'
import { clsx } from 'clsx'
import { api } from '../../api/client'

export interface GraphicElementConfig {
  id?: string
  type: 'LOGO' | 'CLOCK' | 'TEXT' | 'TICKER' | 'LOWER_THIRD'
  position: 'TL' | 'TC' | 'TR' | 'ML' | 'MC' | 'MR' | 'BL' | 'BC' | 'BR' | 'BAR_TOP' | 'BAR_BOTTOM'
  imageUrl?: string | null
  text?: string | null
  subtitle?: string | null
  fontColor: string
  bgColor?: string | null
  fontSize: number
  opacity: number
  bold: boolean
  width?: number | null
  height?: number | null
  padding: number
  tickerSpeed?: number | null
  rssUrl?: string | null
}

export interface GraphicConfig {
  logoUrl?: string | null
  logoPosition?: string | null
  showClock?: boolean
  lowerText?: string | null
  templateElements?: GraphicElementConfig[]
}

// Posições legacy (Graphic simples)
const legacyPosClass: Record<string, string> = {
  'top-left':     'top-2 left-2',
  'bottom-left':  'bottom-8 left-2',
  'bottom-right': 'bottom-8 right-2',
  'top-right':    'top-2 right-2',
}

// CSS absoluto para cada posição do template
function elPosStyle(pos: string, pad: number): React.CSSProperties {
  const p = `${pad}px`
  switch (pos) {
    case 'TL': return { position: 'absolute', top: p, left: p }
    case 'TC': return { position: 'absolute', top: p, left: '50%', transform: 'translateX(-50%)' }
    case 'TR': return { position: 'absolute', top: p, right: p }
    case 'ML': return { position: 'absolute', top: '50%', left: p, transform: 'translateY(-50%)' }
    case 'MC': return { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
    case 'MR': return { position: 'absolute', top: '50%', right: p, transform: 'translateY(-50%)' }
    case 'BL': return { position: 'absolute', bottom: p, left: p }
    case 'BC': return { position: 'absolute', bottom: p, left: '50%', transform: 'translateX(-50%)' }
    case 'BR': return { position: 'absolute', bottom: p, right: p }
    case 'BAR_TOP':    return { position: 'absolute', top: 0, left: 0, right: 0 }
    case 'BAR_BOTTOM': return { position: 'absolute', bottom: 0, left: 0, right: 0 }
    default:           return { position: 'absolute', top: p, left: p }
  }
}

// Escala a fonte para o monitor de preview (template desenhado para 1080p)
function scaledFontSize(fs: number): string {
  return `${Math.max(Math.round(fs * 0.5), 8)}px`
}

function textBaseStyle(el: GraphicElementConfig): React.CSSProperties {
  return {
    display:         'inline-block',
    color:           el.fontColor,
    fontSize:        scaledFontSize(el.fontSize),
    fontWeight:      el.bold ? 'bold' : 'normal',
    fontFamily:      'sans-serif',
    lineHeight:      '1.2',
    whiteSpace:      'nowrap',
    backgroundColor: el.bgColor ?? undefined,
    padding:         el.bgColor
      ? `${Math.max(Math.round(el.padding * 0.3), 2)}px ${Math.max(Math.round(el.padding * 0.5), 4)}px`
      : undefined,
    pointerEvents:   'none',
  }
}

// Elemento único do template renderizado em CSS
function TemplateElement({ el, clock, rssText }: { el: GraphicElementConfig; clock: string; rssText?: string }) {
  const pos = elPosStyle(el.position, el.padding)

  switch (el.type) {
    case 'LOGO':
      if (!el.imageUrl) return null
      return (
        <img
          src={el.imageUrl}
          alt=""
          style={{
            ...pos,
            zIndex: 10,
            opacity: el.opacity,
            objectFit: 'contain',
            pointerEvents: 'none',
            width:  el.width  ? `${Math.round(el.width  * 0.5)}px` : '10%',
            height: el.height ? `${Math.round(el.height * 0.5)}px` : 'auto',
          }}
        />
      )

    case 'CLOCK':
      return (
        <div style={{ ...pos, zIndex: 10, opacity: el.opacity }}>
          <span style={textBaseStyle(el)}>{clock}</span>
        </div>
      )

    case 'TEXT':
      if (!el.text) return null
      return (
        <div style={{ ...pos, zIndex: 10, opacity: el.opacity }}>
          <span style={textBaseStyle(el)}>{el.text}</span>
        </div>
      )

    case 'TICKER': {
      const speed    = Math.max(5, el.tickerSpeed ?? 50)
      const duration = Math.max(2, Math.round(3000 / speed))
      const showText = el.rssUrl
        ? (rssText ?? '⏳ carregando RSS...')
        : (el.text || '')
      if (!showText) return null
      const isBottom = ['BL','BC','BR','BAR_BOTTOM'].includes(el.position)
      return (
        <div style={{
          position: 'absolute', left: 0, right: 0,
          ...(isBottom ? { bottom: el.padding } : { top: el.padding }),
          overflow: 'hidden', zIndex: 10, opacity: el.opacity,
        }}>
          <span style={{ ...textBaseStyle(el), display: 'inline-block', paddingLeft: '100%', animation: `tvplay-ticker ${duration}s linear infinite` }}>
            {showText}
            {el.rssUrl && rssText && <span style={{ opacity: 0.5, fontSize: '75%', marginLeft: 4 }}>[RSS]</span>}
          </span>
        </div>
      )
    }

    case 'LOWER_THIRD': {
      const title = el.text?.trim()
      const sub   = el.subtitle?.trim()
      if (!title && !sub) return null
      const subStyle: React.CSSProperties = {
        ...textBaseStyle(el),
        fontSize: scaledFontSize(Math.round(el.fontSize * 0.75)),
        display:  'block',
        marginTop: '1px',
      }
      return (
        <div style={{ ...pos, zIndex: 10, opacity: el.opacity }}>
          {title && <div style={{ ...textBaseStyle(el), display: 'block' }}>{title}</div>}
          {sub   && <div style={subStyle}>{sub}</div>}
        </div>
      )
    }

    default: return null
  }
}

function TemplateOverlay({ elements }: { elements: GraphicElementConfig[] }) {
  const [clock, setClock] = useState('')
  const [rssTexts, setRssTexts] = useState<Record<string, string>>({})
  const hasClocks = elements.some(el => el.type === 'CLOCK')

  useEffect(() => {
    if (!hasClocks) return
    const tick = () =>
      setClock(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [hasClocks])

  useEffect(() => {
    const tickers = elements.filter(el => el.type === 'TICKER' && el.rssUrl && el.id)
    if (!tickers.length) return
    tickers.forEach(el => {
      api.get(`/ticker/rss?url=${encodeURIComponent(el.rssUrl!)}`)
        .then(r => { if (r.data?.text) setRssTexts(prev => ({ ...prev, [el.id!]: r.data.text })) })
        .catch(() => {})
    })
  }, [elements.map(e => e.id + (e.rssUrl ?? '')).join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {elements.map((el, i) => (
        <TemplateElement key={`${el.type}-${i}`} el={el} clock={clock} rssText={el.id ? rssTexts[el.id] : undefined} />
      ))}
    </>
  )
}

export function GraphicOverlay({ graphic }: { graphic: GraphicConfig }) {
  const [legacyClock, setLegacyClock] = useState('')
  const isTemplate = !!(graphic.templateElements?.length)

  useEffect(() => {
    if (isTemplate || !graphic.showClock) return
    const tick = () =>
      setLegacyClock(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [graphic.showClock, isTemplate])

  return (
    <>
      {/* Keyframe para o ticker */}
      <style>{`@keyframes tvplay-ticker{0%{transform:translateX(0)}100%{transform:translateX(-100%)}}`}</style>

      {isTemplate ? (
        <TemplateOverlay elements={graphic.templateElements!} />
      ) : (
        <>
          {graphic.logoUrl && (
            <img
              src={graphic.logoUrl}
              alt="Logo"
              className={clsx(
                'absolute z-10 h-8 w-auto object-contain opacity-90 pointer-events-none',
                legacyPosClass[graphic.logoPosition ?? 'top-right'] ?? legacyPosClass['top-right'],
              )}
            />
          )}
          {graphic.showClock && legacyClock && (
            <div className="absolute z-10 top-2 right-2 bg-black/50 text-white text-[11px] font-mono px-1.5 py-0.5 rounded pointer-events-none">
              {legacyClock}
            </div>
          )}
          {graphic.lowerText && (
            <div className="absolute z-10 bottom-2 left-0 right-0 flex justify-center pointer-events-none">
              <span className="bg-black/60 text-white text-[11px] px-2 py-0.5">{graphic.lowerText}</span>
            </div>
          )}
        </>
      )}

      {/* Badge GFX no canto superior esquerdo */}
      <div className="absolute z-20 top-2 left-2 flex items-center gap-1 bg-violet-900/60 text-violet-300 text-[9px] px-1.5 py-0.5 rounded font-mono pointer-events-none">
        <Layers className="h-2.5 w-2.5" />GFX
      </div>
    </>
  )
}
