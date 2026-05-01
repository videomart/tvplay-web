import { api } from './client'

export interface ClipType {
  id: string
  name: string
  code: string
  fontColor: string
  fontBackColor: string
  active: boolean
  createdAt: string
}

export const clipTypesApi = {
  list: () => api.get<ClipType[]>('/clip-types').then((r) => r.data),
  get: (id: string) => api.get<ClipType>(`/clip-types/${id}`).then((r) => r.data),
  create: (data: Partial<ClipType>) => api.post<ClipType>('/clip-types', data).then((r) => r.data),
  update: (id: string, data: Partial<ClipType>) => api.put<ClipType>(`/clip-types/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/clip-types/${id}`),
}
