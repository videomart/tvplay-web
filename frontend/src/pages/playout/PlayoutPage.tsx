import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Tv2, Radio, Library } from 'lucide-react'
import { clsx } from 'clsx'
import { channelsApi } from '../../api/channels.api'
import ChannelPanel from './ChannelPanel'
import ClipLibraryPanel from './ClipLibraryPanel'

export default function PlayoutPage() {
  const [mobileTab, setMobileTab] = useState(0) // índice da aba ativa no mobile

  const { data: channels = [], isLoading } = useQuery({
    queryKey: ['channels'],
    queryFn: channelsApi.list,
    refetchInterval: 30_000,
  })

  const active = channels.filter((ch) => ch.active)

  // Desktop: grade intercalando canais com a biblioteca
  function buildGrid() {
    if (active.length === 0) return []
    const panels: React.ReactNode[] = [<ChannelPanel key={active[0].id} channel={active[0]} />]
    panels.push(<ClipLibraryPanel key="library" channels={active} />)
    for (let i = 1; i < active.length; i++) {
      panels.push(<ChannelPanel key={active[i].id} channel={active[i]} />)
    }
    return panels
  }

  // Abas mobile: uma por canal + biblioteca
  const mobileTabs = [
    ...active.map((ch, i) => ({ label: ch.name, short: `Canal ${ch.number}`, idx: i })),
    { label: 'Biblioteca', short: 'Biblioteca', idx: active.length },
  ]

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2].map((i) => <div key={i} className="card h-56 animate-pulse bg-gray-900" />)}
        </div>
      </div>
    )
  }

  if (active.length === 0) {
    return (
      <div className="p-6">
        <div className="card p-12 text-center">
          <Tv2 className="h-10 w-10 text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500">Nenhum canal ativo. Crie canais em <strong>Canais</strong>.</p>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* ── DESKTOP ─────────────────────────────────────────────────────────── */}
      <div className="hidden md:flex p-6 flex-col h-full gap-4">
        <div className="flex items-center justify-between flex-shrink-0">
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Radio className="h-6 w-6 text-brand-400" />
            Playout
            <span className="text-sm font-normal text-gray-500">Controle em tempo real dos canais</span>
          </h1>
          <span className="text-sm text-gray-500 flex items-center gap-1.5"><Tv2 className="h-4 w-4" />{active.length} canal(is)</span>
        </div>

        {/* Subtítulos das colunas — Canal | Mídias | Canal */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 flex-shrink-0 -mb-2">
          <div className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest px-1">Playout</div>
          <div className="text-[10px] font-semibold text-brand-400 uppercase tracking-widest px-1 flex items-center gap-1.5">
            <Library className="h-3 w-3" />Mídias
          </div>
          {active.length > 1 && <div className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest px-1">Playout 2</div>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 flex-1 min-h-0 auto-rows-fr">
          {buildGrid()}
        </div>
      </div>

      {/* ── MOBILE ──────────────────────────────────────────────────────────── */}
      <div className="flex md:hidden flex-col h-full">
        {/* Abas de canal no topo */}
        <div className="flex-shrink-0 bg-gray-900 border-b border-gray-800 overflow-x-auto">
          <div className="flex min-w-max">
            {mobileTabs.map((tab) => (
              <button
                key={tab.idx}
                onClick={() => setMobileTab(tab.idx)}
                className={clsx(
                  'flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                  mobileTab === tab.idx
                    ? 'border-brand-400 text-brand-300 bg-brand-600/10'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                )}
              >
                {tab.idx === active.length
                  ? <Library className="h-3.5 w-3.5" />
                  : <Radio className="h-3.5 w-3.5" />}
                {tab.short}
              </button>
            ))}
          </div>
        </div>

        {/* Conteúdo da aba selecionada */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {mobileTab < active.length ? (
            <ChannelPanel channel={active[mobileTab]} />
          ) : (
            <div className="h-full">
              <ClipLibraryPanel channels={active} />
            </div>
          )}
        </div>
      </div>
    </>
  )
}
