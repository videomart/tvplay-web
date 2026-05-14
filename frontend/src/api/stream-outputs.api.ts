import { api } from './client'

export type StreamOutputType = 'RTMP' | 'HLS_PUSH' | 'SDI' | 'SRT' | 'UDP' | 'RTP' | 'LOCAL_DEVICE'

export interface StreamOutput {
  id: string
  name: string
  description?: string
  type: StreamOutputType
  url?: string
  streamKey?: string
  device?: string
  deviceOs?: string | null
  deviceDriver?: string | null
  deviceName?: string | null
  videoResolution?: string | null
  videoBitrate?: number | null
  audioBitrate?: number | null
  graphicId?: string | null
  graphic?: { id: string; name: string; logoUrl?: string | null; showClock?: boolean; lowerText?: string | null } | null
  channelId?: string
  channel?: { id: string; name: string; number: number }
  active: boolean
  createdAt: string
}

export const TYPE_LABELS: Record<StreamOutputType, string> = {
  RTMP:         'RTMP',
  HLS_PUSH:     'HLS Push',
  SDI:          'SDI Local',
  SRT:          'SRT',
  UDP:          'UDP',
  RTP:          'RTP',
  LOCAL_DEVICE: 'Agente Remoto (DeckLink)',
}

export const TYPE_DESCRIPTIONS: Record<StreamOutputType, string> = {
  RTMP:         'Push para YouTube Live, Facebook, Twitch, etc.',
  HLS_PUSH:     'HLS para CDN ou servidor remoto',
  SDI:          'Saída SDI/DeckLink instalada no host ou container Docker',
  SRT:          'Secure Reliable Transport — baixa latência',
  UDP:          'UDP MPEG-TS — para decoders, IRDs',
  RTP:          'RTP MPEG-TS — para equipamentos de broadcast',
  LOCAL_DEVICE: 'Envia via SRT para agente Windows/Linux com DeckLink externo',
}

export const streamOutputsApi = {
  list: () => api.get<StreamOutput[]>('/stream-outputs').then((r) => r.data),
  create: (data: Partial<StreamOutput>) => api.post<StreamOutput>('/stream-outputs', data).then((r) => r.data),
  update: (id: string, data: Partial<StreamOutput>) => api.put<StreamOutput>(`/stream-outputs/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/stream-outputs/${id}`),
}
