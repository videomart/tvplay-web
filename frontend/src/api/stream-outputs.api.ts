import { api } from './client'

export type StreamOutputType = 'RTMP' | 'HLS_PUSH' | 'SDI'

export interface StreamOutput {
  id: string
  name: string
  type: StreamOutputType
  url?: string
  streamKey?: string
  device?: string
  channelId?: string
  channel?: { id: string; name: string; number: number }
  active: boolean
  createdAt: string
}

export const TYPE_LABELS: Record<StreamOutputType, string> = {
  RTMP:     'RTMP',
  HLS_PUSH: 'HLS Push',
  SDI:      'SDI',
}

export const streamOutputsApi = {
  list: () => api.get<StreamOutput[]>('/stream-outputs').then((r) => r.data),
  create: (data: Partial<StreamOutput>) => api.post<StreamOutput>('/stream-outputs', data).then((r) => r.data),
  update: (id: string, data: Partial<StreamOutput>) => api.put<StreamOutput>(`/stream-outputs/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/stream-outputs/${id}`),
}
