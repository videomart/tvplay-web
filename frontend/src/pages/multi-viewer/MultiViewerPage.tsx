import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Maximize, Minimize, X } from 'lucide-react'
import { channelsApi } from '../../api/channels.api'
import { inputSourcesApi } from '../../api/input-sources.api'
import { ChannelMonitor } from './ChannelMonitor'
import { InputMonitor } from './InputMonitor'

export default function MultiViewerPage() {
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const { data: channels = [] } = useQuery({ queryKey: ['channels'], queryFn: channelsApi.list })
  const { data: inputSources = [] } = useQuery({ queryKey: ['input-sources'], queryFn: inputSourcesApi.list })

  const activeChannels = channels.filter((c) => c.active).sort((a, b) => a.number - b.number)
  const activeInputs = inputSources.filter((s) => s.enabled)

  const channel1 = activeChannels[0]
  const channel2 = activeChannels[1]
  const inputSlots = [0, 1, 2, 3].map((i) => activeInputs[i])

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else {
      containerRef.current?.requestFullscreen().catch(() => {})
    }
  }

  return (
    <div ref={containerRef} className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Barra de controle — discreta, some junto com o cursor em fullscreen se quiser depois */}
      <div className="flex items-center justify-end gap-2 px-3 py-1.5 bg-gray-950 border-b border-gray-800 flex-shrink-0">
        <button
          onClick={toggleFullscreen}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-gray-300 hover:bg-gray-800 transition-colors"
        >
          {isFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
          {isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
        </button>
        <button
          onClick={() => navigate('/playout')}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-gray-300 hover:bg-gray-800 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
          Fechar
        </button>
      </div>

      {/* Linha de cima: canal 1 e canal 2 */}
      <div className="flex-1 grid grid-cols-2 gap-1 p-1 min-h-0">
        <ChannelMonitor channelId={channel1?.id} channelLabel={channel1 ? `CH${channel1.number} · ${channel1.name}` : 'CANAL 1'} />
        <ChannelMonitor channelId={channel2?.id} channelLabel={channel2 ? `CH${channel2.number} · ${channel2.name}` : 'CANAL 2'} />
      </div>

      {/* Linha de baixo: 4 entradas */}
      <div className="flex-1 grid grid-cols-4 gap-1 p-1 min-h-0">
        {inputSlots.map((source, i) => (
          <InputMonitor key={source?.id ?? `empty-${i}`} source={source} slotLabel={source ? source.name : `ENTRADA ${i + 1}`} />
        ))}
      </div>
    </div>
  )
}
