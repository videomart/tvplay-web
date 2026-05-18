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

  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [videoDevices, setVideoDevices] = useState<MediaDeviceOption[]>([])
  const [audioDevices, setAudioDevices] = useState<MediaDeviceOption[]>([])

  const streamRef    = useRef<MediaStream | null>(null)
  const recorderRef  = useRef<MediaRecorder | null>(null)
  const wsRef        = useRef<WebSocket | null>(null)
  const activeRef    = useRef(false)

  // Enumera câmeras e microfones disponíveis
  const enumerateDevices = useCallback(async () => {
    try {
      // Pede permissão antes de enumerar (labels ficam vazios sem permissão)
      await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then((s) => s.getTracks().forEach((t) => t.stop()))
        .catch(() => {})

      const all = await navigator.mediaDevices.enumerateDevices()
      setVideoDevices(
        all.filter((d) => d.kind === 'videoinput').map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Câmera ${i + 1}`,
        }))
      )
      setAudioDevices(
        all.filter((d) => d.kind === 'audioinput').map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Microfone ${i + 1}`,
        }))
      )
    } catch (e: any) {
      setError('Não foi possível listar dispositivos: ' + e.message)
    }
  }, [])

  useEffect(() => {
    enumerateDevices()
  }, [enumerateDevices])

  async function start(videoDeviceId: string, audioDeviceId: string): Promise<void> {
    setError(null)
    try {
      // 1. Captura mídia
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: videoDeviceId ? { exact: videoDeviceId } : undefined,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: audioDeviceId
          ? { deviceId: { exact: audioDeviceId } }
          : true,
      })
      streamRef.current = stream

      // 2. Conecta WebSocket ao servidor
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const host = import.meta.env.DEV ? 'localhost:3001' : window.location.host
      const ws = new WebSocket(`${protocol}://${host}/api/camera/${channelId}/ws?token=${token}`)
      wsRef.current = ws
      ws.binaryType = 'arraybuffer'

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve()
        ws.onerror = () => reject(new Error('Falha ao conectar ao servidor de câmera'))
        ws.onclose = (e) => {
          if (!activeRef.current) return
          setActive(false)
          activeRef.current = false
          if (e.code !== 1000) setError(`Conexão encerrada (${e.code})`)
        }
      })

      // 3. Inicia MediaRecorder e envia chunks pelo WS
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

      recorder.start(200) // chunks de 200ms
      activeRef.current = true
      setActive(true)
    } catch (e: any) {
      cleanup()
      setError(e.message ?? 'Erro ao iniciar câmera')
      throw e
    }
  }

  function stop() {
    cleanup()
    setActive(false)
    activeRef.current = false
  }

  function cleanup() {
    recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop()
    recorderRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
      wsRef.current.close(1000)
    }
    wsRef.current = null
  }

  // Retorna o stream para preview de vídeo local
  function getPreviewStream(): MediaStream | null {
    return streamRef.current
  }

  return { active, error, videoDevices, audioDevices, start, stop, getPreviewStream, enumerateDevices }
}
