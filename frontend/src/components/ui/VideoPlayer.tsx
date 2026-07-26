import { useEffect, useRef, useState } from 'react'
import Hls, { type ErrorData } from 'hls.js'
import { Loader2, AlertCircle } from 'lucide-react'
import { clsx } from 'clsx'

interface VideoPlayerProps {
  src: string          // URL do index.m3u8
  poster?: string
  className?: string
  autoPlay?: boolean
  startAt?: number     // segundos para seek após carregar
  muted?: boolean
  onTimeUpdate?: (time: number) => void
  onVideoRef?: (el: HTMLVideoElement | null) => void
}

type State = 'loading' | 'ready' | 'error'

function getToken(): string | null {
  try {
    const raw = localStorage.getItem('tvplay-auth')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.state?.token ?? null
  } catch {
    return null
  }
}

export function VideoPlayer({ src, poster, className, autoPlay = false, startAt, muted = false, onTimeUpdate, onVideoRef }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  // Guarda o listener pendente de MANIFEST_PARSED para cancelar em troca de src
  const manifestHandlerRef = useRef<((event: string, data: unknown) => void) | null>(null)
  const [state, setState] = useState<State>('loading')
  const [errorMsg, setErrorMsg] = useState('')

  // Cria a instância HLS uma única vez ao montar — evita destroy/recreate ao trocar src
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (!Hls.isSupported()) return

    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      xhrSetup: (xhr: XMLHttpRequest, url: string) => {
        const isInternal = !url || url.startsWith('/') || url.includes(window.location.hostname)
        if (!isInternal) return
        const token = getToken()
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      },
    })

    hls.attachMedia(video)

    hls.on(Hls.Events.ERROR, (_ev: string, data: ErrorData) => {
      if (data.fatal) {
        setState('error')
        setErrorMsg(data.details ?? 'Erro ao carregar vídeo')
      }
    })

    hlsRef.current = hls

    return () => {
      if (manifestHandlerRef.current) {
        hls.off(Hls.Events.MANIFEST_PARSED, manifestHandlerRef.current)
        manifestHandlerRef.current = null
      }
      hls.destroy()
      hlsRef.current = null
    }
  }, [])

  // Carrega nova fonte quando src muda — reutiliza instância HLS existente
  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return

    setState('loading')
    setErrorMsg('')

    if (hlsRef.current) {
      const hls = hlsRef.current

      // Cancela listener pendente de carregamento anterior
      if (manifestHandlerRef.current) {
        hls.off(Hls.Events.MANIFEST_PARSED, manifestHandlerRef.current)
        manifestHandlerRef.current = null
      }

      const handler = () => {
        manifestHandlerRef.current = null
        setState('ready')
        if (startAt && startAt > 0) video.currentTime = startAt
        if (autoPlay) video.play().catch(() => {})
      }
      manifestHandlerRef.current = handler
      hls.once(Hls.Events.MANIFEST_PARSED, handler)

      hls.loadSource(src)

      return () => {
        if (manifestHandlerRef.current) {
          hls.off(Hls.Events.MANIFEST_PARSED, manifestHandlerRef.current)
          manifestHandlerRef.current = null
        }
      }
    }

    // Fallback: HLS nativo (Safari)
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src
      video.addEventListener('loadedmetadata', () => {
        setState('ready')
        if (startAt && startAt > 0) video.currentTime = startAt
        if (autoPlay) video.play().catch(() => {})
      }, { once: true })
      video.addEventListener('error', () => {
        setState('error')
        setErrorMsg('Erro ao carregar vídeo')
      }, { once: true })
      return
    }

    setState('error')
    setErrorMsg('Navegador não suporta HLS')
  }, [src, autoPlay, startAt])

  return (
    <div className={clsx('relative bg-black rounded-lg overflow-hidden', className)}>
      <video
        ref={videoRef}
        poster={poster}
        controls
        muted={muted}
        className="w-full h-full"
        style={{ display: state === 'error' ? 'none' : 'block' }}
        onTimeUpdate={() => onTimeUpdate?.(videoRef.current?.currentTime ?? 0)}
      />

      {state === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-8 w-8 text-gray-400 animate-spin" />
        </div>
      )}

      {state === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4">
          <AlertCircle className="h-8 w-8 text-red-400" />
          <p className="text-sm text-gray-400 text-center">{errorMsg}</p>
        </div>
      )}
    </div>
  )
}
