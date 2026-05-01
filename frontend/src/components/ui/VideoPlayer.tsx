import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
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
}

type State = 'loading' | 'ready' | 'error'

export function VideoPlayer({ src, poster, className, autoPlay = false, startAt, muted = false, onTimeUpdate }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const [state, setState] = useState<State>('loading')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return

    setState('loading')
    setErrorMsg('')

    hlsRef.current?.destroy()

    const onReady = () => {
      setState('ready')
      if (startAt && startAt > 0) video.currentTime = startAt
      if (autoPlay) video.play().catch(() => {})
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        xhrSetup: (xhr) => {
          const token = localStorage.getItem('tvplay-auth')
          if (token) {
            try {
              const parsed = JSON.parse(token)
              if (parsed?.state?.token)
                xhr.setRequestHeader('Authorization', `Bearer ${parsed.state.token}`)
            } catch {}
          }
        },
      })
      hls.loadSource(src)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, onReady)
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          setState('error')
          setErrorMsg(data.details ?? 'Erro ao carregar vídeo')
        }
      })
      hlsRef.current = hls
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src
      video.addEventListener('loadedmetadata', onReady, { once: true })
      video.addEventListener('error', () => {
        setState('error')
        setErrorMsg('Erro ao carregar vídeo')
      }, { once: true })
    } else {
      setState('error')
      setErrorMsg('Navegador não suporta HLS')
    }

    return () => { hlsRef.current?.destroy(); hlsRef.current = null }
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
