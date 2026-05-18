import { useState, useEffect, useRef } from 'react'
import { Camera, CameraOff, Mic, Video, AlertCircle, RefreshCw } from 'lucide-react'
import { Modal } from './Modal'
import { Button } from './Button'
import type { MediaDeviceOption } from '../../hooks/useCameraStream'

export interface CameraControls {
  active: boolean
  error: string | null
  previewStream: MediaStream | null
  videoDevices: MediaDeviceOption[]
  audioDevices: MediaDeviceOption[]
  start: (videoDeviceId: string, audioDeviceId: string) => Promise<void>
  stop: () => void
  enumerateDevices: () => Promise<void>
}

interface CameraModalProps {
  open: boolean
  onClose: () => void
  channelName: string
  camera: CameraControls
}

const selectCls = 'w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-brand-500'

export function CameraModal({ open, onClose, channelName, camera }: CameraModalProps) {
  const { active, error, previewStream, videoDevices, audioDevices, start, stop, enumerateDevices } = camera

  const [selectedVideo, setSelectedVideo] = useState('')
  const [selectedAudio, setSelectedAudio] = useState('')
  const [starting, setStarting] = useState(false)

  const previewRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoDevices.length && !selectedVideo) setSelectedVideo(videoDevices[0].deviceId)
  }, [videoDevices])

  useEffect(() => {
    if (audioDevices.length && !selectedAudio) setSelectedAudio(audioDevices[0].deviceId)
  }, [audioDevices])

  // Vincula o MediaStream ao elemento de vídeo
  useEffect(() => {
    const el = previewRef.current
    if (!el) return
    el.srcObject = previewStream ?? null
  }, [previewStream])

  async function handleStart() {
    setStarting(true)
    try { await start(selectedVideo, selectedAudio) } catch {}
    setStarting(false)
  }

  // Fechar o modal NÃO para a câmera — ela continua transmitindo em background
  // O botão "Parar câmera" é o único que encerra a transmissão
  return (
    <Modal open={open} onClose={onClose} title={`Câmera — ${channelName}`}>
      <div className="space-y-4">

        {/* Preview */}
        <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
          <video
            ref={previewRef}
            autoPlay muted playsInline
            className="w-full h-full object-cover"
            style={{ display: previewStream ? 'block' : 'none' }}
          />
          {!previewStream && (
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

        {/* Seleção de dispositivos — só quando inativa */}
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

            <button onClick={enumerateDevices} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors">
              <RefreshCw className="h-3 w-3" /> Atualizar dispositivos
            </button>

            <div className="bg-amber-950/30 border border-amber-700/30 rounded-lg p-3 text-xs text-amber-300/80 space-y-1">
              <p>Ao iniciar, a câmera substitui o sinal atual nas saídas de streaming ativas.</p>
              <p>Fechar este painel <strong>não</strong> para a transmissão — use "Parar câmera".</p>
            </div>
          </div>
        )}

        {active && (
          <div className="bg-emerald-950/30 border border-emerald-700/30 rounded-lg p-3 text-xs text-emerald-300/80">
            Câmera transmitindo nas saídas ativas. Feche este painel sem parar — o sinal continua.
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 bg-red-950/30 border border-red-700/30 rounded-lg p-3">
            <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-300">{error}</p>
          </div>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="secondary" onClick={onClose}>
            {active ? 'Minimizar' : 'Cancelar'}
          </Button>
          {active ? (
            <Button
              onClick={() => { stop(); onClose() }}
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
