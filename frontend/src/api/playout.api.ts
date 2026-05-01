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
  programName: string | null
  currentIndex: number
  currentItem: CurrentItem | null
  position: number
  totalElapsed: number
  updatedAt: number
}

export const playoutApi = {
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
}
