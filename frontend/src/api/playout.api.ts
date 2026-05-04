import { api } from './client'

export interface CurrentItem {
  playlistItemId: string
  clipId: string
  code: string
  title: string
  modality: string
  clientName: string | null
  typeName: string | null
  typeCode: string | null
  typeBg: string | null
  typeColor: string | null
  duration: number
  cueIn: number
  cueOut: number | null
  hlsPath: string | null
  order: number
  breakNum: number
}

export interface PlayoutState {
  channelId: string
  status: 'IDLE' | 'PLAYING' | 'PAUSED' | 'STOPPED'
  playlistId: string | null
  name: string | null
  currentIndex: number
  currentItem: CurrentItem | null
  position: number
  totalElapsed: number
  totalPlaylistDuration: number
  itemCount: number
  updatedAt: number
}

export interface PlaylistItemRow {
  id: string
  index: number
  order: number
  code: string
  title: string
  typeCode: string | null
  typeBg: string | null
  typeColor: string | null
  duration: number
  loop: boolean
  clientName: string | null
  breakNum: number
  mediaReady: boolean
}

export interface ChannelOutput {
  id:          string
  name:        string
  description: string | null
  type:        string
  url:         string | null
  streamKey:   string | null
  active:      boolean
  streaming:   boolean
}

export const playoutApi = {
  getOutputs: (channelId: string) =>
    api.get<ChannelOutput[]>(`/playout/${channelId}/outputs`).then((r) => r.data),
  toggleOutput: (channelId: string, outputId: string) =>
    api.post<{ id: string; active: boolean }>(`/playout/${channelId}/outputs/${outputId}/toggle`).then((r) => r.data),
  reconnectOutput: (channelId: string, outputId: string) =>
    api.post(`/playout/${channelId}/outputs/${outputId}/reconnect`).then((r) => r.data),
  getStates: () => api.get<PlayoutState[]>('/playout/states').then((r) => r.data),
  getState: (channelId: string) => api.get<PlayoutState>(`/playout/${channelId}/state`).then((r) => r.data),
  play: (channelId: string, playlistId: string) =>
    api.post<PlayoutState>(`/playout/${channelId}/play`, { playlistId }).then((r) => r.data),
  pause: (channelId: string) => api.post<PlayoutState>(`/playout/${channelId}/pause`).then((r) => r.data),
  resume: (channelId: string) => api.post<PlayoutState>(`/playout/${channelId}/resume`).then((r) => r.data),
  stop: (channelId: string) => api.post<PlayoutState>(`/playout/${channelId}/stop`).then((r) => r.data),
  next: (channelId: string) => api.post<PlayoutState>(`/playout/${channelId}/next`).then((r) => r.data),
  prev: (channelId: string) => api.post<PlayoutState>(`/playout/${channelId}/prev`).then((r) => r.data),
  jump: (channelId: string, index: number) =>
    api.post<PlayoutState>(`/playout/${channelId}/jump`, { index }).then((r) => r.data),
  cutToInput: (channelId: string, sourceId: string) =>
    api.post<PlayoutState>(`/playout/${channelId}/cut-to-input`, { sourceId }).then((r) => r.data),
  getItems: (channelId: string) =>
    api.get<PlaylistItemRow[]>(`/playout/${channelId}/items`).then((r) => r.data),
  toggleItemLoop: (channelId: string, itemId: string) =>
    api.post<{ id: string; loop: boolean }>(`/playout/${channelId}/items/${itemId}/toggle-loop`).then((r) => r.data),
  reorderItems: (playlistId: string, items: { id: string; order: number }[]) =>
    api.put(`/playlists/${playlistId}/reorder`, items).then((r) => r.data),
  insertClip: (channelId: string, clipId: string) =>
    api.post<PlayoutState>(`/playout/${channelId}/insert`, { clipId }).then((r) => r.data),
  removeItem: (channelId: string, itemId: string) =>
    api.delete<PlayoutState>(`/playout/${channelId}/items/${itemId}`).then((r) => r.data),
  setFallback: (channelId: string, fallbackType: 'BLACK' | 'COLORBARS' | 'INPUT_SOURCE', fallbackSourceId?: string | null) =>
    api.post(`/playout/${channelId}/set-fallback`, { fallbackType, fallbackSourceId }).then((r) => r.data),
}
