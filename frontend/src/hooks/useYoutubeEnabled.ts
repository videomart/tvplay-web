import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

// YouTube/Twitch via yt-dlp é desabilitado em servidores VPS (YTDLP_ENABLED=false no
// backend) — IPs de datacenter são bloqueados pelo YouTube quase universalmente.
// Usado para avisar o operador antes de configurar uma entrada/clipe que não vai funcionar.
export function useYoutubeEnabled(): boolean {
  const { data } = useQuery({
    queryKey: ['youtube-cookies-status'],
    queryFn: () => api.get('/settings/youtube-cookies-status').then((r) => r.data as { enabled: boolean }),
    staleTime: 5 * 60 * 1000,
  })
  return data?.enabled ?? true
}
