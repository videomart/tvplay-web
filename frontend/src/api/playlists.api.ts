import { api } from './client'
import type { Clip } from './clips.api'

export interface PlaylistItem {
  id: string
  order: number
  breakNum: number
  blockOrder: number
  scheduledAt?: string
  overrideCueIn?: number
  overrideCueOut?: number
  loop?: boolean
  playlistId: string
  clipId: string
  clip: Clip & {
    media?: { duration?: number; hlsPath?: string; ingestStatus: string }
  }
}

export interface Playlist {
  id: string
  date: string
  name: string
  channelId?: string | null
  channel?: { id: string; name: string; number: number }
  locked: boolean
  autoStart: boolean
  startTime?: string | null
  notes?: string
  createdAt: string
  updatedAt: string
  items?: PlaylistItem[]
  graphicId?: string | null
  graphic?: { id: string; name: string }
  _count?: { items: number }
  _noMediaCount?: number
}

export const playlistsApi = {
  list: (params?: { channelId?: string; date?: string }) =>
    api.get<Playlist[]>('/playlists', { params }).then((r) => r.data),

  get: (id: string) =>
    api.get<Playlist>(`/playlists/${id}`).then((r) => r.data),

  create: (data: { date: string; name?: string | null; channelId?: string | null; notes?: string; autoStart?: boolean; startTime?: string | null }) =>
    api.post<Playlist>('/playlists', data).then((r) => r.data),

  update: (id: string, data: Partial<Playlist>) =>
    api.put<Playlist>(`/playlists/${id}`, data).then((r) => r.data),

  delete: (id: string) => api.delete(`/playlists/${id}`),

  addItem: (playlistId: string, data: { clipId: string; order?: number; breakNum?: number }) =>
    api.post<PlaylistItem>(`/playlists/${playlistId}/items`, data).then((r) => r.data),

  updateItem: (playlistId: string, itemId: string, data: Partial<PlaylistItem>) =>
    api.put<PlaylistItem>(`/playlists/${playlistId}/items/${itemId}`, data).then((r) => r.data),

  removeItem: (playlistId: string, itemId: string) =>
    api.delete(`/playlists/${playlistId}/items/${itemId}`),

  reorder: (playlistId: string, items: { id: string; order: number }[]) =>
    api.put(`/playlists/${playlistId}/reorder`, items),
}
