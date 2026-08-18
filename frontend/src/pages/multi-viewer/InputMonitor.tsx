import { useEffect, useState } from 'react'
import { inputSourcesApi, type InputSource } from '../../api/input-sources.api'
import { VideoPlayer } from '../../components/ui/VideoPlayer'
import { ColorBars } from './ColorBars'

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

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      {streamUrl && !errored ? (
        <VideoPlayer src={streamUrl} className="w-full h-full" autoPlay muted />
      ) : (
        <ColorBars label={!source ? 'SEM ENTRADA' : errored ? 'SEM SINAL' : undefined} />
      )}
      <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/70 text-xs font-bold text-white tracking-wide">
        {slotLabel}
      </div>
    </div>
  )
}
