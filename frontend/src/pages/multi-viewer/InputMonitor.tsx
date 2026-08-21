import { useEffect, useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
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
  const [audioMuted, setAudioMuted] = useState(true)

  const status: 'ok' | 'warn' | 'off' = !source ? 'off' : errored ? 'off' : streamUrl ? 'ok' : 'warn'
  const statusLabel = !source ? 'SEM ENTRADA' : errored ? 'SEM SINAL' : streamUrl ? undefined : 'CONECTANDO'

  return (
    <MonitorFrame
      label={slotLabel}
      status={status}
      statusLabel={statusLabel}
      footer={
        <>
          <VuMeter videoEl={videoEl} muted={audioMuted} className="flex-shrink-0" />
          <button
            onClick={() => setAudioMuted((m) => !m)}
            title={audioMuted ? 'Ativar áudio do monitor' : 'Silenciar monitor'}
            className="p-0.5 rounded text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0"
          >
            {audioMuted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
          </button>
        </>
      }
    >
      {streamUrl && !errored ? (
        // muted não é passado para o <video> de propósito: uma vez que o VuMeter
        // conecta createMediaElementSource, a saída audível já é controlada só
        // pelo gain node dele (prop `muted` do VuMeter abaixo) -- setar o
        // atributo nativo `muted` aqui corta o próprio sinal que alimenta o
        // analyser, e o VU fica sempre zerado até o operador clicar "ativar
        // áudio" (2026-08-20). Mesmo padrão do monitor em ChannelPanel.tsx.
        <VideoPlayer src={streamUrl} className="w-full h-full" autoPlay loop onVideoRef={setVideoEl} />
      ) : (
        <ColorBars label={!source ? 'SEM ENTRADA' : errored ? 'SEM SINAL' : undefined} />
      )}
    </MonitorFrame>
  )
}
