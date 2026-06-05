import { api } from './client'

export interface CurrentItem {
  playlistItemId: string
  clipId: string
  mediaId: string | null
  code: string
  title: string
  modality: string
  sourceType: string       // 'FILE' | 'URL'
  sourceUrl: string | null
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
  loop: boolean
  isBreak: boolean
  graphicName: string | null
  mediaReady: boolean
}

export interface GraphicElementConfig {
  type: 'LOGO' | 'CLOCK' | 'TEXT' | 'TICKER' | 'LOWER_THIRD'
  position: 'TL' | 'TC' | 'TR' | 'ML' | 'MC' | 'MR' | 'BL' | 'BC' | 'BR' | 'BAR_TOP' | 'BAR_BOTTOM'
  imageUrl?: string | null
  text?: string | null
  subtitle?: string | null
  fontColor: string
  bgColor?: string | null
  fontSize: number
  opacity: number
  bold: boolean
  width?: number | null
  height?: number | null
  padding: number
}

export interface ActiveGraphic {
  logoUrl?: string | null
  logoPosition?: string | null
  showClock?: boolean
  lowerText?: string | null
  templateElements?: GraphicElementConfig[]
}

export interface PlayoutState {
  channelId: string
  status: 'IDLE' | 'PLAYING' | 'PAUSED' | 'STOPPED'
  playlistId: string | null
  name: string | null
  playlistIsAutoSave: boolean
  loop: boolean
  currentIndex: number
  currentItem: CurrentItem | null
  position: number
  totalElapsed: number
  totalPlaylistDuration: number
  itemCount: number
  updatedAt: number
  activeGraphic: ActiveGraphic | null
  activeCut: { type: 'INPUT_SOURCE' | 'BLACK' | 'COLORBARS'; sourceId?: string | null } | null
}

export interface PlaylistItemRow {
  id: string
  index: number
  order: number
  clipId?: string | null
  code: string
  title: string
  typeCode: string | null
  typeBg: string | null
  typeColor: string | null
  duration: number
  loop: boolean
  maxDuration: number | null
  clientName: string | null
  breakNum: number
  mediaReady: boolean
  sourceType: string
  sourceUrl: string | null
  graphicName: string | null
  isBreak: boolean
}

export interface OutputStats {
  bitrate:   number   // kbits/s
  fps:       number
  speed:     number   // 1.00 = tempo real
  updatedAt: number
}

export interface ChannelOutput {
  id:           string
  name:         string
  description:  string | null
  type:         string
  url:          string | null
  streamKey:    string | null
  active:       boolean
  streaming:    boolean
  outputNumber: number | null
  stats:        OutputStats | null
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
  play: (channelId: string, playlistId: string, startItemId?: string | null) =>
    api.post<PlayoutState>(`/playout/${channelId}/play`, { playlistId, startItemId }).then((r) => r.data),
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
  insertClip: (channelId: string, clipId: string, afterItemId?: string | null) =>
    api.post<PlayoutState>(`/playout/${channelId}/insert`, { clipId, afterItemId }).then((r) => r.data),
  insertBreak: (channelId: string, afterItemId?: string | null) =>
    api.post<PlayoutState>(`/playout/${channelId}/insert-break`, { afterItemId }).then((r) => r.data),
  removeItem: (channelId: string, itemId: string) =>
    api.delete<PlayoutState>(`/playout/${channelId}/items/${itemId}`).then((r) => r.data),
  setFallback: (channelId: string, fallbackType: 'BLACK' | 'COLORBARS' | 'INPUT_SOURCE', fallbackSourceId?: string | null) =>
    api.post(`/playout/${channelId}/set-fallback`, { fallbackType, fallbackSourceId }).then((r) => r.data),
  togglePlaylistLoop: (channelId: string) =>
    api.post<{ playlistId: string; loop: boolean }>(`/playout/${channelId}/toggle-playlist-loop`).then((r) => r.data),
  stopCamera: (channelId: string) =>
    api.delete(`/camera/${channelId}`).then((r) => r.data),
  cutToCamera: (channelId: string) =>
    api.post<PlayoutState>(`/playout/${channelId}/cut-to-camera`).then((r) => r.data),
  cutToType: (channelId: string, type: 'BLACK' | 'COLORBARS') =>
    api.post(`/playout/${channelId}/cut-to-type`, { type }).then((r) => r.data),
}
