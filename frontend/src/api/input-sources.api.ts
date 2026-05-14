import { api } from './client'

export type InputSourceType = 'IP' | 'YOUTUBE' | 'SRT' | 'SDI' | 'USB' | 'LOCAL_DEVICE' | 'CLIP'

export interface InputSource {
  id: string
  name: string
  type: InputSourceType
  url?: string
  device?: string
  deviceOs?: string | null
  deviceDriver?: string | null
  deviceName?: string | null
  clipId?: string | null
  clip?: { id: string; code: string; title: string; sourceType: string; sourceUrl?: string | null; media?: { hlsPath?: string; ingestStatus: string } | null } | null
  channelId?: string
  channel?: { id: string; name: string; number: number }
  active: boolean
  createdAt: string
}

export const SOURCE_TYPE_LABELS: Record<InputSourceType, string> = {
  IP:           'URL (RTMP / RTSP / HTTP / HLS / YouTube / Twitch)',
  YOUTUBE:      'URL (yt-dlp)',   // legado — exibido em fontes existentes
  SRT:          'SRT',
  SDI:          'SDI',
  USB:          'USB / Captura Local',
  LOCAL_DEVICE: 'Dispositivo no Host (Agente)',
  CLIP:         'Clipe cadastrado',
}

// URL que claramente requer yt-dlp
export function urlNeedsYtDlp(url: string): boolean {
  return /youtube\.com|youtu\.be|twitch\.tv/i.test(url)
}

// Tipo a persistir com base na URL digitada
export function resolveSourceType(url: string): 'IP' | 'YOUTUBE' {
  return urlNeedsYtDlp(url) ? 'YOUTUBE' : 'IP'
}

export const inputSourcesApi = {
  list: () => api.get<InputSource[]>('/input-sources').then((r) => r.data),
  create: (data: Partial<InputSource>) => api.post<InputSource>('/input-sources', data).then((r) => r.data),
  update: (id: string, data: Partial<InputSource>) => api.put<InputSource>(`/input-sources/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/input-sources/${id}`),
  resolveYoutube: (url: string) =>
    api.post<{ streamUrl: string; isHls: boolean }>('/input-sources/resolve-youtube', { url }).then((r) => r.data),
  listDevices: () =>
    api.get<{ devices: { path: string; name: string }[] }>('/input-sources/devices').then((r) => r.data),
  startPreview: (id: string) =>
    api.post<{ hlsUrl: string }>(`/input-sources/${id}/preview/start`).then((r) => r.data),
  stopPreview: (id: string) =>
    api.delete(`/input-sources/${id}/preview/stop`),
}
