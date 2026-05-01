import { api } from './client'
import type { Client } from './clients.api'
import type { ClipType } from './clip-types.api'

export type ClipModality = 'BK' | 'AR' | 'PT' | 'VH' | 'CP' | 'CA' | 'LV' | 'ID' | 'MT'

export interface Clip {
  id: string
  code: string
  title: string
  modality: ClipModality
  cueIn: number
  cueOut?: number
  duration?: number
  validUntil?: string
  isLive: boolean
  active: boolean
  notes?: string
  clientId?: string
  client?: Client
  typeId?: string
  type?: ClipType
  mediaId?: string
  media?: { duration?: number; hlsPath?: string; ingestStatus: string }
  createdAt: string
}

export interface ClipsListResponse {
  items: Clip[]
  total: number
  page: number
  limit: number
}

export const clipsApi = {
  list: (params?: { search?: string; modality?: string; clientId?: string; typeId?: string; page?: number }) =>
    api.get<ClipsListResponse>('/clips', { params }).then((r) => r.data),
  get: (id: string) => api.get<Clip>(`/clips/${id}`).then((r) => r.data),
  create: (data: Partial<Clip>) => api.post<Clip>('/clips', data).then((r) => r.data),
  update: (id: string, data: Partial<Clip>) => api.put<Clip>(`/clips/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/clips/${id}`),
  uploadMedia: (file: File, clipId: string, onProgress?: (pct: number) => void) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<{ mediaId: string; message: string }>(`/ingest/upload?clipId=${clipId}`, form, {
      onUploadProgress: (e) => onProgress?.(Math.round((e.loaded * 100) / (e.total ?? 1))),
    }).then((r) => r.data)
  },
}

export const MODALITY_LABELS: Record<ClipModality, string> = {
  BK: 'Bloco', AR: 'Arquivo', PT: 'Vinheta', VH: 'Humor',
  CP: 'Comercial', CA: 'Campanha', LV: 'Ao Vivo', ID: 'ID Canal', MT: 'Teaser',
}
