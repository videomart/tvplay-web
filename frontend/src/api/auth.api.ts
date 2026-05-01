import { api } from './client'

export const authApi = {
  login: (username: string, password: string) =>
    api.post<{ token: string; user: any }>('/auth/login', { username, password }).then((r) => r.data),

  me: () =>
    api.get('/auth/me').then((r) => r.data),
}
