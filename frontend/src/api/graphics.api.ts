import { api } from './client'

export interface Graphic {
  id: string
  name: string
  logoUrl?: string | null
  logoPosition?: string | null
  showClock: boolean
  lowerText?: string | null
  active: boolean
  createdAt: string
}

export const graphicsApi = {
  list:   ()                         => api.get<Graphic[]>('/graphics').then((r) => r.data),
  create: (data: Partial<Graphic>)   => api.post<Graphic>('/graphics', data).then((r) => r.data),
  update: (id: string, data: Partial<Graphic>) => api.put<Graphic>(`/graphics/${id}`, data).then((r) => r.data),
  delete: (id: string)               => api.delete(`/graphics/${id}`),
}
