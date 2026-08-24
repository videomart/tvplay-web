import { useEffect, useState } from 'react'
import { inputSourcesApi, type InputSource } from '../../api/input-sources.api'
import { VideoPlayer } from '../../components/ui/VideoPlayer'
import { VuMeter } from '../../components/ui/VuMeter'
import { ColorBars } from './ColorBars'
import { MonitorFrame } from './MonitorFrame'

// preview/start no backend pode levar até 60s para desistir de uma fonte SRT
// sem sinal (preview.service.ts) — bom para uma tela de edição, ruim para um
// mural de monitoração. Aqui mostramos o colorbars bem antes disso; a
// requisição HTTP original segue em voo e é ignorada se chegar depois.
const LOADING_TIMEOUT_MS = 12_000

interface Props {
  source?: InputSource
  slotLabel: string
}

export function InputMonitor({ source, slotLabel }: Props) {
  const [streamUrl, setStreamUrl] = useState<string | null>(null)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    setStreamUrl(null)
    setErrored(false)
    if (!source) return

    // URL HLS/HTTP direta — sem sessão de preview no backend, igual InputSourcesPage.tsx
    if (source.type === 'IP' && source.url?.match(/^https?:\/\//i)) {
      setStreamUrl(source.url)
      return
    }

    let cancelled = false
    const timeoutId = setTimeout(() => {
      if (!cancelled) setErrored(true)
    }, LOADING_TIMEOUT_MS)

    inputSourcesApi.startPreview(source.id)
      .then(({ hlsUrl }) => {
        if (cancelled) return
        clearTimeout(timeoutId)
        setStreamUrl(hlsUrl)
      })
      .catch(() => {
        if (cancelled) return
        clearTimeout(timeoutId)
        setErrored(true)
      })

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
      if (!(source.type === 'IP' && source.url?.match(/^https?:\/\//i))) {
        inputSourcesApi.stopPreview(source.id).catch(() => {})
      }
    }
  }, [source?.id])

  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)

  const status: 'ok' | 'warn' | 'off' = !source ? 'off' : errored ? 'off' : streamUrl ? 'ok' : 'warn'
  const statusLabel = !source ? 'SEM ENTRADA' : errored ? 'SEM SINAL' : streamUrl ? undefined : 'CONECTANDO'

  return (
    <MonitorFrame
      label={slotLabel}
      status={status}
      statusLabel={statusLabel}
      // Entradas do multi-viewer ficam permanentemente mutadas (sem switcher de
      // áudio) — o gain do VuMeter em 0 já garante isso; só o nível continua
      // visível, alimentado pelo <video> desmutado (ver comentário abaixo).
      footer={<VuMeter videoEl={videoEl} muted className="flex-shrink-0" />}
    >
      {streamUrl && !errored ? (
        // muted não é passado para o <video> de propósito: uma vez que o VuMeter
        // conecta createMediaElementSource, a saída audível já é controlada só
        // pelo gain node dele (sempre muted, ver acima) -- setar o atributo
        // nativo `muted` aqui corta o próprio sinal que alimenta o analyser, e
        // o VU fica sempre zerado. Mesmo padrão do monitor em ChannelPanel.tsx.
        <VideoPlayer src={streamUrl} className="w-full h-full" autoPlay controls={false} loop onVideoRef={setVideoEl} />
      ) : (
        <ColorBars label={!source ? 'SEM ENTRADA' : errored ? 'SEM SINAL' : undefined} />
      )}
    </MonitorFrame>
  )
}
