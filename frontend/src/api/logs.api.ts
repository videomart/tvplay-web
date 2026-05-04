import { api } from './client'

export interface LogEntry {
  id: string
  program: string
  title: string
  duration: number
  exhibited: boolean
  startedAt: string | null
  finishedAt: string | null
  scheduledAt: string | null
  client: string | null
  notes: string | null
  createdAt: string
  user:     { id: string; name: string } | null
  playlist: {
    id: string
    name: string
    channel: { id: string; name: string; number: number }
  } | null
}

export interface LogsResponse {
  total: number
  page: number
  limit: number
  items: LogEntry[]
}

export interface LogFilters {
  search?:    string
  channelId?: string
  dateFrom?:  string
  dateTo?:    string
  exhibited?: 'true' | 'false' | ''
  page?:      number
  limit?:     number
}

export const logsApi = {
  list: (filters: LogFilters = {}) => {
    const params = Object.fromEntries(
      Object.entries(filters).filter(([, v]) => v !== '' && v !== undefined)
    )
    return api.get<LogsResponse>('/logs', { params }).then((r) => r.data)
  },
  delete: (id: string) => api.delete(`/logs/${id}`),
}
