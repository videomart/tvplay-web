import { api } from './client'

export interface Client {
  id: string
  name: string
  document?: string
  contact?: string
  email?: string
  phone?: string
  active: boolean
  createdAt: string
}

export const clientsApi = {
  list: (search?: string) => api.get<Client[]>('/clients', { params: { search } }).then((r) => r.data),
  get: (id: string) => api.get<Client>(`/clients/${id}`).then((r) => r.data),
  create: (data: Partial<Client>) => api.post<Client>('/clients', data).then((r) => r.data),
  update: (id: string, data: Partial<Client>) => api.put<Client>(`/clients/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/clients/${id}`),
}
