import { api } from './client'

export interface SystemMetrics {
  cpu: { percent: number; cores: number; loadAvg: number[] }
  memory: { totalBytes: number; freeBytes: number; usedBytes: number }
  disk: { totalBytes: number; freeBytes: number; usedBytes: number } | null
  database: { sizeBytes: number } | null
  videos: { usedBytes: number }
  docker: {
    imagesBytes: number
    containersBytes: number
    volumesBytes: number
    totalBytes: number
    imageCount: number
    containerCount: number
    volumeCount: number
  } | null
}

export const systemApi = {
  getMetrics: () => api.get<SystemMetrics>('/system/metrics').then((r) => r.data),
}
