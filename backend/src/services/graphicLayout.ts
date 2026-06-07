// Layout de elementos gráficos — calcula posição/altura sem sobreposição.
//
// MANTER EM SINCRONIA com a porta TS no preview do editor de templates:
// frontend/src/pages/graphic-templates/GraphicTemplateEditorPage.tsx (TemplatePreview)
// Mesmas constantes (BAR_GAP, fórmulas de elementHeight) — mudanças aqui devem
// ser replicadas lá para o preview continuar WYSIWYG.

export type LayoutElement = {
  type:      'LOGO' | 'CLOCK' | 'TEXT' | 'TICKER' | 'LOWER_THIRD'
  position:  'TL' | 'TC' | 'TR' | 'ML' | 'MC' | 'MR' | 'BL' | 'BC' | 'BR' | 'BAR_TOP' | 'BAR_BOTTOM'
  fontSize:  number
  padding:   number
  width?:    number | null
  height?:   number | null
  subtitle?: string | null
  marginX?:  number | null
  marginY?:  number | null
  anchorRef?: 'FRAME' | 'BAR' | null
  order?:    number
  active?:   boolean
}

export const BAR_GAP = 4

const MX = (el: LayoutElement) => el.marginX ?? 20
const MY = (el: LayoutElement) => el.marginY ?? 20

// Altura estimada do elemento em px, calculada só a partir de suas próprias
// propriedades (independe da resolução real de saída).
export function elementHeight(el: LayoutElement): number {
  if (el.type === 'LOGO') return el.height ?? 60
  if (el.type === 'LOWER_THIRD' && el.subtitle?.trim()) {
    return 2 * el.fontSize + 8 + 2 * el.padding
  }
  return el.fontSize * 1.3 + 2 * el.padding
}

export type BarLayout = {
  totalHeight: number
  // offset acumulado de cada membro a partir do lado da barra voltado para a borda do quadro
  offsets: Map<LayoutElement, number>
}

// Empilha os membros ativos de uma barra (BAR_TOP ou BAR_BOTTOM) em ordem,
// calculando a altura total da barra e o deslocamento de cada membro.
export function computeBarLayout(members: LayoutElement[]): BarLayout | null {
  const active = members.filter(m => m.active !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  if (active.length === 0) return null

  const offsets = new Map<LayoutElement, number>()
  const outerMargin = MY(active[0])
  let cursor = outerMargin
  for (const el of active) {
    offsets.set(el, cursor)
    cursor += elementHeight(el) + BAR_GAP
  }
  const totalHeight = cursor - BAR_GAP

  return { totalHeight, offsets }
}

export type BarContext = {
  topBar?:    BarLayout | null
  bottomBar?: BarLayout | null
}

export type XYExpr = { x: string; y: string }

// Calcula as expressões de posição (x,y) para um elemento, considerando
// margens, ancoragem e altura das barras adjacentes.
// kind = 'drawtext' usa as variáveis de runtime tw/th; 'overlay' usa overlay_w/overlay_h.
export function computeElementXY(
  el: LayoutElement,
  ctx: BarContext,
  kind: 'drawtext' | 'overlay',
  explicitW?: number | null,
  explicitH?: number | null,
): XYExpr {
  const w = kind === 'overlay' ? (explicitW ? String(explicitW) : 'overlay_w') : 'tw'
  const h = kind === 'overlay' ? (explicitH ? String(explicitH) : 'overlay_h') : 'th'
  const mx = MX(el)
  const my = MY(el)

  const left   = (kind === 'overlay') ? `${mx}` : `x=${mx}`
  const right  = (kind === 'overlay') ? `W-${w}-${mx}` : `x=W-${w}-${mx}`
  const center = (kind === 'overlay') ? `(W-${w})/2` : `x=(W-${w})/2`

  const wrapY = (yExpr: string) => (kind === 'overlay' ? yExpr : `y=${yExpr}`)

  switch (el.position) {
    case 'BAR_TOP':
    case 'BAR_BOTTOM': {
      const bar = el.position === 'BAR_TOP' ? ctx.topBar : ctx.bottomBar
      const offset = bar?.offsets.get(el) ?? my
      // offset = distância acumulada da borda do quadro até o lado do box voltado para a borda
      // BAR_TOP: offset é a distância do topo até o topo do box (empilha para baixo)
      // BAR_BOTTOM: offset é a distância da base até a base do box (empilha para cima) — y = H - offset - altura
      const y = el.position === 'BAR_TOP'
        ? `${offset}`
        : `H-${offset}-${h}`
      return kind === 'overlay'
        ? { x: '0', y }
        : { x: 'x=0', y: `y=${y}` }
    }

    case 'ML': return { x: left,   y: wrapY(`(H-${h})/2`) }
    case 'MC': return { x: center, y: wrapY(`(H-${h})/2`) }
    case 'MR': return { x: right,  y: wrapY(`(H-${h})/2`) }

    case 'TL':
    case 'TC':
    case 'TR': {
      const x = el.position === 'TL' ? left : el.position === 'TR' ? right : center
      const useBar = (el.anchorRef === 'BAR') && ctx.topBar && ctx.topBar.totalHeight > 0
      const y = useBar ? `${ctx.topBar!.totalHeight}+${my}` : `${my}`
      return { x, y: wrapY(y) }
    }

    case 'BL':
    case 'BC':
    case 'BR':
    default: {
      const x = el.position === 'BL' ? left : el.position === 'BR' ? right : center
      const useBar = (el.anchorRef === 'BAR') && ctx.bottomBar && ctx.bottomBar.totalHeight > 0
      const y = useBar
        ? `H-${ctx.bottomBar!.totalHeight}-${h}-${my}`
        : `H-${h}-${my}`
      return { x, y: wrapY(y) }
    }
  }
}
