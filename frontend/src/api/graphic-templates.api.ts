import { api } from './client'

export type GraphicElementType = 'LOGO' | 'CLOCK' | 'TEXT' | 'TICKER' | 'LOWER_THIRD'
export type GraphicPosition    = 'TL' | 'TC' | 'TR' | 'ML' | 'MC' | 'MR' | 'BL' | 'BC' | 'BR' | 'BAR_TOP' | 'BAR_BOTTOM'
export type GraphicAnchorRef   = 'FRAME' | 'BAR'

export const ANCHOR_REF_LABELS: Record<GraphicAnchorRef, string> = {
  FRAME: 'Borda do quadro',
  BAR:   'Barra adjacente',
}

export const POSITION_LABELS: Record<GraphicPosition, string> = {
  TL: 'Superior Esquerdo', TC: 'Superior Centro',  TR: 'Superior Direito',
  ML: 'Centro Esquerdo',   MC: 'Centro',            MR: 'Centro Direito',
  BL: 'Inferior Esquerdo', BC: 'Inferior Centro',   BR: 'Inferior Direito',
  BAR_TOP:    'Barra Superior (largura total)',
  BAR_BOTTOM: 'Barra Inferior (largura total)',
}

export const ELEMENT_TYPE_LABELS: Record<GraphicElementType, string> = {
  LOGO:        'Logo / Imagem',
  CLOCK:       'Relógio',
  TEXT:        'Texto Estático',
  TICKER:      'Ticker (texto rolante)',
  LOWER_THIRD: 'Lower Third (título + subtítulo)',
}

export interface GraphicElement {
  id:        string
  templateId: string
  type:      GraphicElementType
  position:  GraphicPosition
  imageUrl?: string | null
  text?:     string | null
  subtitle?: string | null
  fontColor: string
  bgColor?:  string | null
  fontSize:  number
  opacity:   number
  bold:      boolean
  width?:    number | null
  height?:   number | null
  padding:   number
  marginX:   number         // px — distância da borda esquerda/direita do quadro
  marginY:   number         // px — distância da borda superior/inferior (ou deslocamento da barra)
  anchorRef: GraphicAnchorRef // TL/TC/TR/BL/BC/BR: referência vertical (borda do quadro ou barra adjacente)
  tickerSpeed: number       // px/seg, padrão 5
  tickerLoop:  boolean      // false = exibe uma vez e para
  rssUrl?:     string | null
  active:      boolean
  order:       number
  createdAt:   string
  updatedAt:   string
}

export interface GraphicTemplate {
  id:          string
  name:        string
  description?: string | null
  active:      boolean
  elements:    GraphicElement[]
  _count?:     { channels: number }
  createdAt:   string
  updatedAt:   string
}

export const graphicTemplatesApi = {
  list: () =>
    api.get<GraphicTemplate[]>('/graphic-templates').then(r => r.data),

  get: (id: string) =>
    api.get<GraphicTemplate>(`/graphic-templates/${id}`).then(r => r.data),

  create: (data: { name: string; description?: string }) =>
    api.post<GraphicTemplate>('/graphic-templates', data).then(r => r.data),

  update: (id: string, data: Partial<{ name: string; description: string; active: boolean }>) =>
    api.put<GraphicTemplate>(`/graphic-templates/${id}`, data).then(r => r.data),

  delete: (id: string) =>
    api.delete(`/graphic-templates/${id}`),

  // Salva todos os elementos de uma vez (substitui tudo)
  saveElements: (id: string, elements: Omit<GraphicElement, 'id' | 'templateId' | 'createdAt' | 'updatedAt'>[]) =>
    api.put<GraphicTemplate>(`/graphic-templates/${id}/elements`, elements).then(r => r.data),

  addElement: (id: string, element: Omit<GraphicElement, 'id' | 'templateId' | 'createdAt' | 'updatedAt'>) =>
    api.post<GraphicElement>(`/graphic-templates/${id}/elements`, element).then(r => r.data),

  updateElement: (templateId: string, elemId: string, data: Partial<GraphicElement>) =>
    api.put<GraphicElement>(`/graphic-templates/${templateId}/elements/${elemId}`, data).then(r => r.data),

  deleteElement: (templateId: string, elemId: string) =>
    api.delete(`/graphic-templates/${templateId}/elements/${elemId}`),
}
