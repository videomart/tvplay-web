import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2, Search, ClipboardList, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { logsApi, type LogFilters } from '../../api/logs.api'
import { channelsApi } from '../../api/channels.api'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Input'
import { Table, Thead, Th, Tbody, Tr, Td } from '../../components/ui/Table'

function fmtTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function fmtDur(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${h}h${String(m).padStart(2,'0')}m${String(s).padStart(2,'0')}s`
  return `${String(m).padStart(2,'0')}m${String(s).padStart(2,'0')}s`
}

export default function LogsPage() {
  const qc = useQueryClient()
  const [filters, setFilters] = useState<LogFilters>({ page: 1, limit: 100 })
  const [search, setSearch]   = useState('')

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['logs', filters],
    queryFn:  () => logsApi.list(filters),
  })

  const { data: channels = [] } = useQuery({ queryKey: ['channels'], queryFn: channelsApi.list })

  const remove = useMutation({
    mutationFn: logsApi.delete,
    onSuccess: () => { toast.success('Log removido'); qc.invalidateQueries({ queryKey: ['logs'] }) },
  })

  function applySearch() {
    setFilters((f) => ({ ...f, search: search || undefined, page: 1 }))
  }

  const items = data?.items ?? []
  const total = data?.total ?? 0

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-brand-400" />
            Logs de Exibição
          </h1>
          <p className="text-gray-500 text-sm mt-1">{total} registro(s)</p>
        </div>
        <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => refetch()}>
          Atualizar
        </Button>
      </div>

      {/* Filtros */}
      <div className="card p-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-48">
          <Input
            label="Busca"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Título, programa ou cliente"
            onKeyDown={(e) => e.key === 'Enter' && applySearch()}
          />
        </div>
        <div className="w-48">
          <Select label="Canal" value={filters.channelId ?? ''} onChange={(e) =>
            setFilters((f) => ({ ...f, channelId: e.target.value || undefined, page: 1 }))}>
            <option value="">Todos os canais</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>Canal {c.number} — {c.name}</option>
            ))}
          </Select>
        </div>
        <div className="w-44">
          <Input
            label="De"
            type="date"
            value={filters.dateFrom ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value || undefined, page: 1 }))}
          />
        </div>
        <div className="w-44">
          <Input
            label="Até"
            type="date"
            value={filters.dateTo ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value || undefined, page: 1 }))}
          />
        </div>
        <div className="w-36">
          <Select label="Exibido" value={filters.exhibited ?? ''} onChange={(e) =>
            setFilters((f) => ({ ...f, exhibited: e.target.value as LogFilters['exhibited'], page: 1 }))}>
            <option value="">Todos</option>
            <option value="true">Sim</option>
            <option value="false">Não</option>
          </Select>
        </div>
        <Button icon={<Search className="h-4 w-4" />} onClick={applySearch}>Filtrar</Button>
      </div>

      <div className="card">
        <Table>
          <Thead>
            <Th>Início</Th>
            <Th>Programa</Th>
            <Th>Título</Th>
            <Th>Cliente</Th>
            <Th>Canal</Th>
            <Th>Duração</Th>
            <Th>Exibido</Th>
            <Th className="w-12 text-right">Ações</Th>
          </Thead>
          <Tbody>
            {isLoading ? (
              <Tr><Td colSpan={8} className="text-center text-gray-500 py-8">Carregando...</Td></Tr>
            ) : items.length === 0 ? (
              <Tr><Td colSpan={8} className="text-center text-gray-500 py-8">Nenhum registro encontrado.</Td></Tr>
            ) : items.map((log) => (
              <Tr key={log.id}>
                <Td>
                  <span className="font-mono text-xs text-gray-300">{fmtTime(log.startedAt)}</span>
                </Td>
                <Td>
                  <span className="text-gray-300 text-sm">{log.program}</span>
                </Td>
                <Td>
                  <span className="font-medium text-white">{log.title}</span>
                </Td>
                <Td>
                  <span className="text-gray-400 text-sm">{log.client ?? <span className="text-gray-600">—</span>}</span>
                </Td>
                <Td>
                  {log.playlist?.channel
                    ? <span className="text-gray-400 text-sm">Canal {log.playlist.channel.number} — {log.playlist.channel.name}</span>
                    : <span className="text-gray-600">—</span>}
                </Td>
                <Td>
                  <span className="font-mono text-xs text-cyan-400">{fmtDur(log.duration)}</span>
                </Td>
                <Td>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded ${log.exhibited ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'}`}>
                    {log.exhibited ? 'Sim' : 'Não'}
                  </span>
                </Td>
                <Td className="text-right">
                  <Button
                    size="sm" variant="danger"
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                    onClick={() => { if (confirm('Remover este log?')) remove.mutate(log.id) }}
                  />
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>

        {/* Paginação simples */}
        {total > (filters.limit ?? 100) && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
            <span className="text-sm text-gray-500">
              Página {filters.page} de {Math.ceil(total / (filters.limit ?? 100))}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={(filters.page ?? 1) <= 1}
                onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}>
                Anterior
              </Button>
              <Button size="sm" variant="secondary"
                disabled={(filters.page ?? 1) >= Math.ceil(total / (filters.limit ?? 100))}
                onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}>
                Próximo
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
