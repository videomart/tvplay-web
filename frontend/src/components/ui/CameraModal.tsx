import { useState, useEffect, useRef } from 'react'
import { Camera, CameraOff, Mic, Video, AlertCircle, RefreshCw } from 'lucide-react'
import { clsx } from 'clsx'
import { Modal } from './Modal'
import { Button } from './Button'
import { useCameraStream } from '../../hooks/useCameraStream'

interface CameraModalProps {
  open: boolean
  onClose: () => void
  channelId: string
  channelName: string
}

export function CameraModal({ open, onClose, channelId, channelName }: CameraModalProps) {
  const {
    active, error, videoDevices, audioDevices,
    start, stop, getPreviewStream, enumerateDevices,
  } = useCameraStream(channelId)

  const [selectedVideo, setSelectedVideo] = useState('')
  const [selectedAudio, setSelectedAudio] = useState('')
  const [starting, setStarting] = useState(false)

  const previewRef = useRef<HTMLVideoElement>(null)

  // Seleciona primeiro dispositivo disponível
  useEffect(() => {
    if (videoDevices.length && !selectedVideo) setSelectedVideo(videoDevices[0].deviceId)
  }, [videoDevices])

  useEffect(() => {
    if (audioDevices.length && !selectedAudio) setSelectedAudio(audioDevices[0].deviceId)
  }, [audioDevices])

  // Atualiza preview quando câmera está ativa
  useEffect(() => {
    if (!previewRef.current) return
    const stream = getPreviewStream()
    if (stream && active) {
      previewRef.current.srcObject = stream
    } else {
      previewRef.current.srcObject = null
    }
  }, [active, getPreviewStream])

  async function handleStart() {
    setStarting(true)
    try {
      await start(selectedVideo, selectedAudio)
    } catch {
      // error já está em `error`
    } finally {
      setStarting(false)
    }
  }

  function handleStop() {
    stop()
  }

  function handleClose() {
    if (active) stop()
    onClose()
  }

  const selectCls = 'w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-brand-500'

  return (
    <Modal open={open} onClose={handleClose} title={`Câmera — ${channelName}`}>
      <div className="space-y-4">

        {/* Preview */}
        <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
          <video
            ref={previewRef}
            autoPlay
            muted
            playsInline
            className={clsx('w-full h-full object-cover', !active && 'hidden')}
          />
          {!active && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-600">
              <Camera className="h-10 w-10" />
              <p className="text-sm">Preview aparece após iniciar</p>
            </div>
          )}
          {active && (
            <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
              <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
              AO VIVO
            </div>
          )}
        </div>

        {/* Seleção de dispositivos */}
        {!active && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-medium text-gray-400">
                <Video className="h-3.5 w-3.5" /> Câmera
              </label>
              {videoDevices.length === 0 ? (
                <p className="text-xs text-gray-500">Nenhuma câmera encontrada</p>
              ) : (
                <select value={selectedVideo} onChange={(e) => setSelectedVideo(e.target.value)} className={selectCls}>
                  {videoDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-medium text-gray-400">
                <Mic className="h-3.5 w-3.5" /> Microfone
              </label>
              {audioDevices.length === 0 ? (
                <p className="text-xs text-gray-500">Nenhum microfone encontrado</p>
              ) : (
                <select value={selectedAudio} onChange={(e) => setSelectedAudio(e.target.value)} className={selectCls}>
                  {audioDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                  ))}
                </select>
              )}
            </div>

            <button
              onClick={enumerateDevices}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              <RefreshCw className="h-3 w-3" /> Atualizar dispositivos
            </button>
          </div>
        )}

        {/* Aviso de funcionamento */}
        {!active && (
          <div className="bg-amber-950/30 border border-amber-700/30 rounded-lg p-3 text-xs text-amber-300/80 space-y-1">
            <p>Ao iniciar, a câmera substitui o sinal atual nas saídas de streaming ativas do canal.</p>
            <p>Ao parar, o playout retoma automaticamente.</p>
          </div>
        )}

        {/* Erro */}
        {error && (
          <div className="flex items-start gap-2 bg-red-950/30 border border-red-700/30 rounded-lg p-3">
            <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-300">{error}</p>
          </div>
        )}

        {/* Ações */}
        <div className="flex gap-2 justify-end pt-1">
          <Button variant="secondary" onClick={handleClose}>
            {active ? 'Fechar' : 'Cancelar'}
          </Button>
          {active ? (
            <Button
              onClick={handleStop}
              className="bg-red-700 hover:bg-red-600 text-white"
              icon={<CameraOff className="h-4 w-4" />}
            >
              Parar câmera
            </Button>
          ) : (
            <Button
              onClick={handleStart}
              loading={starting}
              disabled={!videoDevices.length}
              icon={<Camera className="h-4 w-4" />}
            >
              Iniciar câmera
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
