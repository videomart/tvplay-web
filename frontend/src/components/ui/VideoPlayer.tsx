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
  loop?: boolean       // reinicia ao chegar no fim — fontes VOD usadas como feed contínuo (ex.: clipe de arquivo como entrada)
  controls?: boolean   // exibe play/pause/scrub nativos — telas de edição/preview que dependem de scrubar manualmente (ex.: marcação de cue-in/out em ClipsPage)
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

export function VideoPlayer({ src, poster, className, autoPlay = false, startAt, muted = false, loop = false, controls = false, onTimeUpdate, onVideoRef }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  // Guarda o listener pendente de MANIFEST_PARSED para cancelar em troca de src
  const manifestHandlerRef = useRef<((event: string, data: unknown) => void) | null>(null)
  const [state, setState] = useState<State>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  // Refs (não state) porque são lidos só dentro dos handlers do efeito de
  // montagem (deps [], não recria o listener) — precisam sempre do valor mais
  // recente de `loop`/`src`, que podem mudar em re-renders sem remontar o player.
  const loopRef = useRef(loop)
  loopRef.current = loop
  const srcRef = useRef(src)
  srcRef.current = src

  // Expõe o elemento video para uso externo (ex.: VuMeter Web Audio API)
  useEffect(() => {
    onVideoRef?.(videoRef.current)
    return () => onVideoRef?.(null)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Loop manual em vez do atributo nativo `loop`: com hls.js/MediaSource o VOD
  // às vezes trava perto do fim (buffer stall no fechamento do MediaSource) sem
  // nunca disparar 'ended' — o `timeupdate` chegando perto da duração cobre esse
  // caso, e o listener de 'ended' cobre o caminho normal. Usado pelas entradas
  // de arquivo do multi-viewer, que devem se comportar como um feed contínuo.
  useEffect(() => {
    const video = videoRef.current
    if (!video || !loop) return

    const restart = () => {
      video.currentTime = 0
      video.play().catch(() => {})
    }
    const onTimeUpdate = () => {
      if (video.duration && video.duration - video.currentTime < 0.3) restart()
    }
    video.addEventListener('ended', restart)
    video.addEventListener('timeupdate', onTimeUpdate)
    return () => {
      video.removeEventListener('ended', restart)
      video.removeEventListener('timeupdate', onTimeUpdate)
    }
  }, [loop])

  // Cria a instância HLS uma única vez ao montar — evita destroy/recreate ao trocar src
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (!Hls.isSupported()) return

    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      // Default (liveSyncDurationCount: 3) mantém o player só 3 segmentos
      // atrás da borda ao vivo -- com playlists curtas no servidor (ex.:
      // preview.service.ts, 6 segmentos de 2s), qualquer soluço no encoder
      // esgota esse buffer e o player estagna (lido como "pausa sozinha").
      // liveSyncDurationCount maior dá mais colchão sem mudar a latência
      // de forma perceptível num preview.
      liveSyncDurationCount: 5,
      xhrSetup: (xhr: XMLHttpRequest, url: string) => {
        const isInternal = !url || url.startsWith('/') || url.includes(window.location.hostname)
        if (!isInternal) return
        const token = getToken()
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      },
    })

    hls.attachMedia(video)

    hls.on(Hls.Events.ERROR, (_ev: string, data: ErrorData) => {
      if (!data.fatal) return
      // Fontes VOD em loop (ex.: arquivo de vídeo usado como entrada no
      // multi-viewer) podem soltar um erro fatal no hls.js bem perto do fim
      // (stall do MediaSource ao fechar o VOD) em vez de um 'ended' limpo --
      // tratar como fim de loop e recuperar, em vez de travar na tela de erro.
      if (loopRef.current) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR: hls.startLoad(0); break
          case Hls.ErrorTypes.MEDIA_ERROR:   hls.recoverMediaError(); break
          default:                           hls.loadSource(srcRef.current)
        }
        video.currentTime = 0
        video.play().catch(() => {})
        return
      }
      setState('error')
      setErrorMsg(data.details ?? 'Erro ao carregar vídeo')
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
        if (autoPlay) {
          video.play().catch(() => {
            // Autoplay sem mute bloqueado — inicia muted para garantir reprodução
            video.muted = true
            video.play().catch(() => {})
          })
        }
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
        muted={muted}
        controls={controls}
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
