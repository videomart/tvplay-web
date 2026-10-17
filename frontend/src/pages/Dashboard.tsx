import { useQuery } from '@tanstack/react-query'
import { Tv2, Users, Film, Tag, Activity, Cpu, MemoryStick, HardDrive, Database, Box, AlertTriangle } from 'lucide-react'
import { clsx } from 'clsx'
import { channelsApi } from '../api/channels.api'
import { clientsApi } from '../api/clients.api'
import { clipsApi } from '../api/clips.api'
import { clipTypesApi } from '../api/clip-types.api'
import { systemApi } from '../api/system.api'
import { Card } from '../components/ui/Card'

function formatBytes(bytes?: number | null) {
  if (bytes == null) return '—'
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${(bytes / 1e3).toFixed(0)} KB`
}

function barColor(pct: number) {
  if (pct >= 90) return 'bg-red-500'
  if (pct >= 70) return 'bg-amber-500'
  return 'bg-emerald-500'
}

function MetricBar({
  icon, label, pct, detail,
}: { icon: React.ReactNode; label: string; pct: number | null; detail: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 text-gray-300">{icon}{label}</span>
        <span className="text-xs text-gray-500 font-mono">{detail}</span>
      </div>
      {pct != null ? (
        <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
          <div className={clsx('h-full rounded-full transition-all', barColor(pct))} style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      ) : (
        <p className="text-xs text-gray-600 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />indisponível</p>
      )}
    </div>
  )
}

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
  const metrics = useQuery({ queryKey: ['system-metrics'], queryFn: systemApi.getMetrics, refetchInterval: 5000 })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
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

      {/* Recursos do sistema — um card por métrica */}
      <div>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
          <Cpu className="h-4 w-4 text-brand-600 dark:text-brand-400" />
          Recursos do Sistema
        </h2>
        {metrics.isLoading ? (
          <p className="text-gray-500 text-sm">Carregando...</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card>
              <MetricBar
                icon={<Cpu className="h-3.5 w-3.5" />}
                label="CPU"
                pct={metrics.data?.cpu.percent ?? null}
                detail={metrics.data ? `${metrics.data.cpu.percent}% · ${metrics.data.cpu.cores} núcleos` : '—'}
              />
            </Card>
            <Card>
              <MetricBar
                icon={<MemoryStick className="h-3.5 w-3.5" />}
                label="Memória"
                pct={metrics.data ? (metrics.data.memory.usedBytes / metrics.data.memory.totalBytes) * 100 : null}
                detail={metrics.data ? `${formatBytes(metrics.data.memory.usedBytes)} de ${formatBytes(metrics.data.memory.totalBytes)}` : '—'}
              />
            </Card>
            <Card>
              <MetricBar
                icon={<HardDrive className="h-3.5 w-3.5" />}
                label="Disco"
                pct={metrics.data?.disk ? (metrics.data.disk.usedBytes / metrics.data.disk.totalBytes) * 100 : null}
                detail={metrics.data?.disk ? `${formatBytes(metrics.data.disk.usedBytes)} de ${formatBytes(metrics.data.disk.totalBytes)}` : 'indisponível'}
              />
            </Card>
            <Card>
              <MetricBar
                icon={<Film className="h-3.5 w-3.5" />}
                label="Vídeos (Mídias)"
                pct={null}
                detail={metrics.data ? formatBytes(metrics.data.videos.usedBytes) : '—'}
              />
            </Card>
            <Card>
              <MetricBar
                icon={<Database className="h-3.5 w-3.5" />}
                label="Banco de Dados"
                pct={null}
                detail={metrics.data?.database ? formatBytes(metrics.data.database.sizeBytes) : 'indisponível'}
              />
            </Card>
            <Card>
              <MetricBar
                icon={<Box className="h-3.5 w-3.5" />}
                label="Docker (imagens/volumes)"
                pct={null}
                detail={metrics.data?.docker
                  ? `${formatBytes(metrics.data.docker.totalBytes)} · ${metrics.data.docker.imageCount} imagens, ${metrics.data.docker.volumeCount} volumes`
                  : 'indisponível'}
              />
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
