import { api } from './client'

export type UserLevel = 'ADMIN' | 'OPERATOR' | 'VIEWER'

export interface UserRecord {
  id: string
  name: string
  username: string
  email?: string | null
  level: UserLevel
  active: boolean
  createdAt: string
  updatedAt: string
}

export const LEVEL_LABELS: Record<UserLevel, string> = {
  ADMIN:    'Administrador',
  OPERATOR: 'Operador',
  VIEWER:   'Visualizador',
}

export const usersApi = {
  list:   ()                              => api.get<UserRecord[]>('/users').then((r) => r.data),
  create: (data: Partial<UserRecord> & { password: string }) =>
    api.post<UserRecord>('/users', data).then((r) => r.data),
  update: (id: string, data: Partial<UserRecord> & { password?: string }) =>
    api.put<UserRecord>(`/users/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/users/${id}`),
  resetPassword: (id: string) =>
    api.post<{ id: string; name: string; username: string; tempPassword: string }>(`/users/${id}/reset-password`).then((r) => r.data),
}
