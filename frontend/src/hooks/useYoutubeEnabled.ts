import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

// Conteúdo YouTube/Twitch pode ser desligado em Configurações (toggle "Conteúdo
// YouTube/Twitch") em servidores VPS — IPs de datacenter são bloqueados pelo YouTube
// quase universalmente. Usado para avisar o operador antes de configurar uma entrada/clipe
// que não vai funcionar.
export function useYoutubeEnabled(): boolean {
  const { data } = useQuery({
    queryKey: ['youtube-cookies-status'],
    queryFn: () => api.get('/settings/youtube-cookies-status').then((r) => r.data as { enabled: boolean }),
    staleTime: 5 * 60 * 1000,
  })
  return data?.enabled ?? true
}
