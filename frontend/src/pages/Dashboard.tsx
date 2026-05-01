import { useQuery } from '@tanstack/react-query'
import { Tv2, Users, Film, Tag, Activity } from 'lucide-react'
import { channelsApi } from '../api/channels.api'
import { clientsApi } from '../api/clients.api'
import { clipsApi } from '../api/clips.api'
import { clipTypesApi } from '../api/clip-types.api'
import { Card } from '../components/ui/Card'

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number | string; color: string }) {
  return (
    <div className="card p-5 flex items-center gap-4">
      <div className={`p-3 rounded-xl ${color}`}>{icon}</div>
      <div>
        <p className="text-2xl font-bold text-white">{value}</p>
        <p className="text-sm text-gray-500">{label}</p>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const channels = useQuery({ queryKey: ['channels'], queryFn: () => channelsApi.list() })
  const clients = useQuery({ queryKey: ['clients'], queryFn: () => clientsApi.list() })
  const clips = useQuery({ queryKey: ['clips'], queryFn: () => clipsApi.list() })
  const types = useQuery({ queryKey: ['clip-types'], queryFn: () => clipTypesApi.list() })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Visão geral do sistema</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Tv2 className="h-5 w-5 text-brand-400" />}
          label="Canais"
          value={channels.data?.length ?? '—'}
          color="bg-brand-500/10"
        />
        <StatCard
          icon={<Film className="h-5 w-5 text-violet-400" />}
          label="Clipes"
          value={clips.data?.total ?? '—'}
          color="bg-violet-500/10"
        />
        <StatCard
          icon={<Users className="h-5 w-5 text-emerald-400" />}
          label="Clientes"
          value={clients.data?.length ?? '—'}
          color="bg-emerald-500/10"
        />
        <StatCard
          icon={<Tag className="h-5 w-5 text-amber-400" />}
          label="Tipos"
          value={types.data?.length ?? '—'}
          color="bg-amber-500/10"
        />
      </div>

      {/* Canais em linha */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Activity className="h-4 w-4 text-brand-400" />
          <h2 className="text-sm font-semibold text-white">Status dos Canais</h2>
        </div>
        {channels.isLoading ? (
          <p className="text-gray-500 text-sm">Carregando...</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {channels.data?.map((ch) => (
              <div key={ch.id} className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-brand-600/20 flex items-center justify-center text-brand-300 text-xs font-bold">
                    {ch.number}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{ch.name}</p>
                    <p className="text-xs text-gray-500">{ch.description ?? 'Sem descrição'}</p>
                  </div>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                  ch.status === 'PLAYING' ? 'bg-emerald-500/10 text-emerald-400' :
                  ch.status === 'IDLE' ? 'bg-gray-700 text-gray-400' : 'bg-red-500/10 text-red-400'
                }`}>
                  {ch.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
