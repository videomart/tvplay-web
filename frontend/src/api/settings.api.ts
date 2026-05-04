import { api } from './client'

export interface SystemSettings {
  id: string
  companyName: string
  logoUrl: string | null
  email: string | null
  defaultMonitorOpen: boolean
  defaultFallbackOpen: boolean
  defaultOutputsOpen: boolean
  defaultPlaylistOpen: boolean
  updatedAt: string
}

export const settingsApi = {
  get: () => api.get<SystemSettings>('/settings').then((r) => r.data),
  update: (data: Partial<Omit<SystemSettings, 'id' | 'updatedAt'>>) =>
    api.put<SystemSettings>('/settings', data).then((r) => r.data),
}
