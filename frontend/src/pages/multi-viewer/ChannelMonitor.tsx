import { useQuery } from '@tanstack/react-query'
import { playoutApi } from '../../api/playout.api'
import { VideoPlayer } from '../../components/ui/VideoPlayer'
import { ColorBars } from './ColorBars'

// Mesma lógica de ChannelPanel.tsx — hlsPath vem como "hls/<mediaId>/index.m3u8"
function hlsStreamUrl(hlsPath: string) {
  const mediaId = hlsPath.split('/')[1]
  return `/api/media/stream/${mediaId}/index.m3u8`
}

interface Props {
  channelId?: string
  channelLabel: string
}

export function ChannelMonitor({ channelId, channelLabel }: Props) {
  const { data: state } = useQuery({
    queryKey: ['playout-state', channelId],
    queryFn: () => playoutApi.getState(channelId!),
    enabled: !!channelId,
    refetchInterval: 5000,
  })

  const hlsPath = state?.currentItem?.hlsPath
  const src = hlsPath ? hlsStreamUrl(hlsPath) : null

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      {src ? (
        <VideoPlayer src={src} className="w-full h-full" autoPlay muted startAt={(state?.currentItem?.cueIn ?? 0) + (state?.position ?? 0)} />
      ) : (
        <ColorBars label={channelId ? 'SEM SINAL' : 'CANAL NÃO CONFIGURADO'} />
      )}
      <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/70 text-xs font-bold text-white tracking-wide">
        {channelLabel}
      </div>
    </div>
  )
}
