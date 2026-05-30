import { api } from './client'
import type { GraphicTemplate, GraphicElement } from './graphic-templates.api'

export interface Graphic {
  id: string
  name: string
  active: boolean
  createdAt: string
  // Sistema novo
  templateId?: string | null
  template?: GraphicTemplate | null
  elementValues?: Record<string, Record<string, any>> | null
  // Sistema legado
  logoUrl?: string | null
  logoPosition?: string | null
  showClock: boolean
  lowerText?: string | null
}

// Mescla os elementos do template com os valores salvos no gráfico
export function resolveGraphicElements(graphic: Graphic): GraphicElement[] {
  if (!graphic.template?.elements?.length) return []
  const values = graphic.elementValues ?? {}
  return graphic.template.elements.map(el => ({
    ...el,
    ...(values[el.id] ?? {}),
  }))
}

export const graphicsApi = {
  list:   ()                         => api.get<Graphic[]>('/graphics').then((r) => r.data),
  create: (data: Partial<Graphic>)   => api.post<Graphic>('/graphics', data).then((r) => r.data),
  update: (id: string, data: Partial<Graphic>) => api.put<Graphic>(`/graphics/${id}`, data).then((r) => r.data),
  delete: (id: string)               => api.delete(`/graphics/${id}`),
}

export const FACTORY_TEMPLATE_SIMPLES = 'template-simples-factory'
export const TEMPLATE_SIMPLES_ELEM_LOGO  = 'tpl-simples-logo'
export const TEMPLATE_SIMPLES_ELEM_CLOCK = 'tpl-simples-clock'
export const TEMPLATE_SIMPLES_ELEM_TEXT  = 'tpl-simples-text'
