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
  clockOffsetHours: number
  updatedAt: string
}

export const settingsApi = {
  get: () => api.get<SystemSettings>('/settings').then((r) => r.data),
  update: (data: Partial<Omit<SystemSettings, 'id' | 'updatedAt'>>) =>
    api.put<SystemSettings>('/settings', data).then((r) => r.data),
  uploadLogo: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<{ logoUrl: string }>('/settings/upload-logo', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data)
  },
}
