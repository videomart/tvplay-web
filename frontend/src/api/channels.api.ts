import { api } from './client'

export type FallbackType = 'BLACK' | 'COLORBARS' | 'INPUT_SOURCE'

export interface Channel {
  id: string
  name: string
  number: number
  description?: string
  logoUrl?: string
  active: boolean
  status: string
  fallbackType: FallbackType
  fallbackSourceId?: string | null
  fallbackSource?: { id: string; name: string; type: string; url?: string }
  scteEnabled?: boolean
  createdAt: string
}

export const channelsApi = {
  list: () => api.get<Channel[]>('/channels').then((r) => r.data),
  get: (id: string) => api.get<Channel>(`/channels/${id}`).then((r) => r.data),
  create: (data: Partial<Channel>) => api.post<Channel>('/channels', data).then((r) => r.data),
  update: (id: string, data: Partial<Channel>) => api.put<Channel>(`/channels/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/channels/${id}`),
}
