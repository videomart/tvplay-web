import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuthStore } from '../stores/auth.store'

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

  const [active, setActive]           = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [videoDevices, setVideoDevices] = useState<MediaDeviceOption[]>([])
  const [audioDevices, setAudioDevices] = useState<MediaDeviceOption[]>([])

  const streamRef   = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const wsRef       = useRef<WebSocket | null>(null)

  const enumerateDevices = useCallback(async () => {
    try {
      // Pede permissão primeiro para obter labels dos dispositivos
      await navigator.mediaDevices
        .getUserMedia({ video: true, audio: true })
        .then((s) => s.getTracks().forEach((t) => t.stop()))
        .catch(() => {})

      const all = await navigator.mediaDevices.enumerateDevices()
      setVideoDevices(
        all
          .filter((d) => d.kind === 'videoinput')
          .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Câmera ${i + 1}` }))
      )
      setAudioDevices(
        all
          .filter((d) => d.kind === 'audioinput')
          .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microfone ${i + 1}` }))
      )
    } catch (e: any) {
      setError('Não foi possível listar dispositivos: ' + (e.message ?? e))
    }
  }, [])

  useEffect(() => { enumerateDevices() }, [enumerateDevices])

  async function start(videoDeviceId: string, audioDeviceId: string): Promise<void> {
    setError(null)

    // 1. Captura a mídia da câmera/microfone
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: videoDeviceId ? { exact: videoDeviceId } : undefined,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true,
      })
    } catch (e: any) {
      const msg = e.name === 'NotAllowedError'
        ? 'Permissão de câmera negada pelo navegador'
        : e.name === 'NotFoundError'
          ? 'Câmera não encontrada'
          : e.message ?? 'Erro ao acessar câmera'
      setError(msg)
      throw new Error(msg)
    }
    streamRef.current = stream

    // 2. Conecta WebSocket ao backend
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const host = import.meta.env.DEV ? 'localhost:3001' : window.location.host
    const ws = new WebSocket(`${protocol}://${host}/api/camera/${channelId}/ws?token=${token}`)
    wsRef.current = ws

    // 3. Aguarda conexão ou erro (timeout 8s)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timeout ao conectar ao servidor (8s)'))
      }, 8000)

      ws.onopen = () => {
        clearTimeout(timer)
        resolve()
      }
      ws.onerror = () => {
        clearTimeout(timer)
        reject(new Error('Servidor de câmera não respondeu — verifique se o container está rodando'))
      }
      // Fecha antes de abrir = servidor rejeitou (ex: sem outputs configurados)
      ws.onclose = (e) => {
        clearTimeout(timer)
        reject(new Error(e.reason || `Servidor recusou a conexão (código ${e.code})`))
      }
    }).catch((e: Error) => {
      stream.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      wsRef.current = null
      setError(e.message)
      throw e
    })

    // 4. WS aberto — agora registra handlers permanentes e inicia MediaRecorder
    ws.onclose = (e) => {
      stopAll()
      if (e.code !== 1000 && e.code !== 1001) {
        setError(e.reason || `Transmissão encerrada (código ${e.code})`)
      }
    }
    ws.onerror = () => {
      stopAll()
      setError('Erro de conexão com o servidor de câmera')
    }

    const mimeType = getSupportedMimeType()
    const recorder = new MediaRecorder(stream, { mimeType })
    recorderRef.current = recorder

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
        ws.send(e.data)
      }
    }
    recorder.onerror = (e: any) => {
      setError('Erro no MediaRecorder: ' + (e.error?.message ?? 'desconhecido'))
      stop()
    }

    recorder.start(200)
    setActive(true)
  }

  function stopAll() {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop() } catch {}
    }
    recorderRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setActive(false)
  }

  function stop() {
    const ws = wsRef.current
    wsRef.current = null
    // Remove handlers antes de fechar para não disparar setError
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      ws.onclose = null
      ws.onerror = null
      ws.close(1000)
    }
    stopAll()
  }

  function getPreviewStream(): MediaStream | null {
    return streamRef.current
  }

  return { active, error, videoDevices, audioDevices, start, stop, getPreviewStream, enumerateDevices }
}
