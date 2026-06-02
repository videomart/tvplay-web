import { api } from './client'
import type { Client } from './clients.api'
import type { ClipType } from './clip-types.api'

export interface OrphanMedia {
  id: string
  originalName: string
  ingestStatus: string
  duration?: number
  createdAt: string
}

export interface MediaFile {
  id: string
  originalName: string
  ingestStatus: string
  duration?: number | null
  sizeBytes?: string | null
  width?: number | null
  height?: number | null
  hlsPath?: string | null
  thumbnail?: string | null
  errorMsg?: string | null
  createdAt: string
  _count: { clips: number }
  clips: { id: string; title: string; code: string; sourceType?: string; duration?: number | null; type?: { id: string; code: string; name: string; fontColor: string; fontBackColor: string } | null }[]
}

export type ClipModality = 'BK' | 'AR' | 'PT' | 'VH' | 'CP' | 'CA' | 'LV' | 'ID' | 'MT'
export type ClipSourceType = 'FILE' | 'URL'

export interface Clip {
  id: string
  code: string
  title: string
  modality: ClipModality
  sourceType: ClipSourceType
  sourceUrl?: string | null
  cueIn: number
  cueOut?: number
  duration?: number
  validUntil?: string
  isLive: boolean
  active: boolean
  notes?: string
  clientId?: string | null
  client?: Client
  typeId?: string | null
  type?: ClipType
  mediaId?: string | null
  media?: { duration?: number; hlsPath?: string; ingestStatus: string }
  graphicId?: string | null
  graphic?: { id: string; name: string; logoUrl?: string | null; logoPosition?: string | null; showClock: boolean; lowerText?: string | null }
  createdAt: string
}

export interface ClipsListResponse {
  items: Clip[]
  total: number
  page: number
  limit: number
}

export const clipsApi = {
  list: (params?: { search?: string; modality?: string; clientId?: string; typeId?: string; page?: number; sortBy?: string; sortDir?: string }) =>
    api.get<ClipsListResponse>('/clips', { params }).then((r) => r.data),
  get: (id: string) => api.get<Clip>(`/clips/${id}`).then((r) => r.data),
  create: (data: Partial<Clip>) => api.post<Clip>('/clips', data).then((r) => r.data),
  update: (id: string, data: Partial<Clip>) => api.put<Clip>(`/clips/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/clips/${id}`),
  nextCode: (prefix: string) => api.get<{ code: string }>(`/clips/next-code?prefix=${encodeURIComponent(prefix)}`).then((r) => r.data),
  checkUrl: (url: string) => api.post<{ isLive: boolean | null; title?: string; duration?: number }>('/clips/check-url', { url }).then((r) => r.data),
  uploadMediaDirect: (file: File, onProgress?: (pct: number) => void) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<{ mediaId: string; message: string }>('/ingest/upload', form, {
      onUploadProgress: (e) => onProgress?.(Math.round((e.loaded * 100) / (e.total ?? 1))),
    }).then((r) => r.data)
  },
  listOrphanMedia: () =>
    api.get<OrphanMedia[]>('/ingest/media?orphan=true&status=READY').then((r) => r.data),
  listMedia: (params?: { orphan?: boolean; status?: string }) =>
    api.get<MediaFile[]>('/ingest/media', { params }).then((r) => r.data),
  deleteMedia: (id: string) =>
    api.delete<{ ok: boolean; deletedObjects: number }>(`/ingest/media/${id}`).then((r) => r.data),
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
