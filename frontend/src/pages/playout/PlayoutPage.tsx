import { useQuery } from '@tanstack/react-query'
import { Tv2, Radio } from 'lucide-react'
import { channelsApi } from '../../api/channels.api'
import ChannelPanel from './ChannelPanel'
import ClipLibraryPanel from './ClipLibraryPanel'

export default function PlayoutPage() {
  const { data: channels = [], isLoading } = useQuery({
    queryKey: ['channels'],
    queryFn: channelsApi.list,
    refetchInterval: 30_000,
  })

  const active = channels.filter((ch) => ch.active)

  // Monta a grade intercalando os canais com a biblioteca após o primeiro canal
  function buildGrid() {
    if (active.length === 0) return []
    const panels: React.ReactNode[] = [<ChannelPanel key={active[0].id} channel={active[0]} />]
    panels.push(<ClipLibraryPanel key="library" channels={active} />)
    for (let i = 1; i < active.length; i++) {
      panels.push(<ChannelPanel key={active[i].id} channel={active[i]} />)
    }
    return panels
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Radio className="h-6 w-6 text-brand-400" />
            Playout
          </h1>
          <p className="text-gray-500 text-sm mt-1">Controle em tempo real dos canais</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Tv2 className="h-4 w-4" />
          {active.length} canal(is) ativo(s)
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2].map((i) => (
            <div key={i} className="card h-56 animate-pulse bg-gray-900" />
          ))}
        </div>
      ) : active.length === 0 ? (
        <div className="card p-12 text-center">
          <Tv2 className="h-10 w-10 text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500">Nenhum canal ativo. Crie canais em <strong>Canais</strong>.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {buildGrid()}
        </div>
      )}
    </div>
  )
}
