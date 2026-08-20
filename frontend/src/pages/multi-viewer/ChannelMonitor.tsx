import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { playoutApi } from '../../api/playout.api'
import { inputSourcesApi } from '../../api/input-sources.api'
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

  const item = state?.currentItem
  const cutSourceId = state?.activeCut?.type === 'INPUT_SOURCE' ? state.activeCut.sourceId : undefined

  // src/startAt só recalculam quando o CLIPE muda (item.clipId), não a cada
  // refetch de 5s -- se recalculássemos startAt a partir de state.position
  // inline no render, o VideoPlayer recarregaria o vídeo do zero a cada
  // poll (hls.loadSource depende de [src, startAt]), causando a "piscada"
  // reportada em produção. Mesmo padrão de ChannelPanel.tsx:734-741.
  const [monitorSrc, setMonitorSrc] = useState<string | null>(null)
  const [monitorStartAt, setMonitorStartAt] = useState(0)

  useEffect(() => {
    if (item?.hlsPath) {
      setMonitorSrc(hlsStreamUrl(item.hlsPath))
      setMonitorStartAt((item.cueIn ?? 0) + (state?.position ?? 0))
    } else {
      setMonitorSrc(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.clipId])

  // CUT para uma InputSource: currentItem fica null (ver playout.service.ts
  // cutToInput), então o efeito acima nunca preenche monitorSrc. Sobe uma
  // sessão de preview server-side pro sourceId do activeCut, mesmo mecanismo
  // usado por InputMonitor.tsx (linha de entradas) e por ChannelPanel.tsx
  // (switcher) — sem isso o Multi-viewer cai em colorbars mesmo com o CUT
  // funcionando normalmente no canal.
  const [cutSrc, setCutSrc] = useState<string | null>(null)

  useEffect(() => {
    setCutSrc(null)
    if (!cutSourceId) return

    let cancelled = false
    inputSourcesApi.startPreview(cutSourceId)
      .then(({ hlsUrl }) => { if (!cancelled) setCutSrc(hlsUrl) })
      .catch(() => {})

    return () => {
      cancelled = true
      inputSourcesApi.stopPreview(cutSourceId).catch(() => {})
    }
  }, [cutSourceId])

  const activeSrc = cutSourceId ? cutSrc : monitorSrc

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      {activeSrc ? (
        <VideoPlayer src={activeSrc} className="w-full h-full" autoPlay muted startAt={cutSourceId ? 0 : monitorStartAt} />
      ) : (
        <ColorBars label={channelId ? 'SEM SINAL' : 'CANAL NÃO CONFIGURADO'} />
      )}
      <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/70 text-xs font-bold text-white tracking-wide">
        {channelLabel}
      </div>
    </div>
  )
}
