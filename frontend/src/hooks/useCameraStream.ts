import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '../stores/auth.store'
import { cameraManager } from '../lib/camera-manager'
import { playoutApi } from '../api/playout.api'

export interface MediaDeviceOption {
  deviceId: string
  label: string
}

function getSupportedMimeType(): string {
  const candidates = [
    'video/webm;codecs=h264,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? 'video/webm'
}

export function useCameraStream(channelId: string) {
  const token = useAuthStore((s) => s.token)

  // Estado inicial sincronizado do singleton — funciona mesmo após navegar e voltar
  const [active, setActive]               = useState(() => cameraManager.isActive(channelId))
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(
    () => cameraManager.isActive(channelId) ? (cameraManager.getSession()?.stream ?? null) : null
  )
  const [error, setError]                 = useState<string | null>(null)
  const [videoDevices, setVideoDevices]   = useState<MediaDeviceOption[]>([])
  const [audioDevices, setAudioDevices]   = useState<MediaDeviceOption[]>([])

  // Subscreve ao singleton: re-sincroniza quando a sessão muda (mesmo de outros componentes)
  // O cleanup APENAS remove o listener — NÃO para a câmera. A sessão sobrevive à desmontagem.
  useEffect(() => {
    const sync = () => {
      const isActive = cameraManager.isActive(channelId)
      setActive(isActive)
      setPreviewStream(isActive ? (cameraManager.getSession()?.stream ?? null) : null)
      const err = cameraManager.consumeError()
      if (err) setError(err)
    }
    sync() // sincroniza imediatamente ao montar (pode ter câmera ativa de antes da navegação)
    return cameraManager.subscribe(sync)
  }, [channelId])

  const enumerateDevices = useCallback(async () => {
    setError(null)

    // mediaDevices só existe em contextos seguros (HTTPS ou localhost)
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Câmera requer conexão segura (HTTPS). Acesse o sistema via HTTPS para usar esta funcionalidade.')
      return
    }

    try {
      // Solicita permissão explicitamente — sem isso os labels ficam vazios e devices podem sumir
      const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      tempStream.getTracks().forEach((t) => t.stop())
    } catch (e: any) {
      const name = (e as DOMException).name
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setError('Permissão de câmera/microfone negada. Clique no ícone de cadeado na barra de endereços e permita o acesso.')
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setError('Nenhuma câmera ou microfone encontrado. Verifique se os dispositivos estão conectados.')
      } else if (name === 'NotReadableError') {
        setError('Câmera em uso por outro aplicativo. Feche outros programas que possam estar usando a câmera.')
      } else {
        setError('Erro ao acessar câmera: ' + ((e as Error).message ?? name ?? 'desconhecido'))
      }
      return
    }
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      setVideoDevices(
        all.filter((d) => d.kind === 'videoinput')
           .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Câmera ${i + 1}` }))
      )
      setAudioDevices(
        all.filter((d) => d.kind === 'audioinput')
           .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microfone ${i + 1}` }))
      )
    } catch (e: any) {
      setError('Erro ao listar dispositivos: ' + ((e as Error).message ?? e))
    }
  }, [])

  useEffect(() => { enumerateDevices() }, [enumerateDevices])

  async function start(videoDeviceId: string, audioDeviceId: string): Promise<void> {
    setError(null)

    // Para qualquer câmera em andamento antes de iniciar nova
    if (cameraManager.isActive()) cameraManager.clearSession()

    // 1. Captura mídia
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: videoDeviceId ? { exact: videoDeviceId } : undefined,
          width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 },
        },
        audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true,
      })
    } catch (e: any) {
      const msg = e.name === 'NotAllowedError' ? 'Permissão de câmera negada pelo navegador'
        : e.name === 'NotFoundError' ? 'Câmera não encontrada'
        : e.message ?? 'Erro ao acessar câmera'
      setError(msg)
      throw new Error(msg)
    }

    // 2. Conecta WebSocket ao backend
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const host = import.meta.env.DEV ? 'localhost:3001' : window.location.host
    const ws = new WebSocket(`${protocol}://${host}/api/camera/${channelId}/ws?token=${token}`)

    // 3. Aguarda conexão (timeout 8s)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout ao conectar ao servidor (8s)')), 8000)
      ws.onopen  = () => { clearTimeout(timer); resolve() }
      ws.onerror = () => { clearTimeout(timer); reject(new Error('Servidor de câmera não respondeu')) }
      ws.onclose = (e) => { clearTimeout(timer); reject(new Error(e.reason || `Servidor recusou (código ${e.code})`)) }
    }).catch((e: Error) => {
      stream.getTracks().forEach((t) => t.stop())
      setError(e.message)
      throw e
    })

    // 4. Inicia MediaRecorder
    // videoBitsPerSecond explícito: sem isso o Chrome aplica um bitrate bem
    // conservador por padrão (visivelmente abaixo do que a resolução 1280x720
    // pedida acima suporta), produzindo vídeo borrado mesmo com o preview
    // local parecendo nítido (o preview usa o MediaStream raw, não o WebM
    // comprimido pelo MediaRecorder) — confirmado em produção (2026-06-24).
    const mimeType = getSupportedMimeType()
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 4_000_000,
      audioBitsPerSecond: 128_000,
    })
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data)
    }

    // 5. Registra sessão no singleton ANTES de definir handlers pós-abertura
    //    A sessão agora sobrevive a qualquer navegação
    cameraManager.setSession({ channelId, stream, recorder, ws })

    // Handlers que atuam durante a transmissão (referencia o singleton, não o componente)
    ws.onclose = (e) => {
      if (e.code !== 1000 && e.code !== 1001) {
        cameraManager.failSession(e.reason || `Transmissão encerrada (código ${e.code})`)
      } else {
        cameraManager.clearSession()
      }
    }
    ws.onerror = () => cameraManager.failSession('Erro de conexão com o servidor de câmera')
    recorder.onerror = (e: any) =>
      cameraManager.failSession('Erro no MediaRecorder: ' + (e.error?.message ?? 'desconhecido'))

    recorder.start(200)
  }

  function stop(): void {
    cameraManager.clearSession()
    // Garante que o backend para o FFmpeg mesmo se o WS não propagar o fechamento
    playoutApi.stopCamera(channelId).catch(() => {})
  }

  return { active, error, previewStream, videoDevices, audioDevices, start, stop, enumerateDevices }
}
