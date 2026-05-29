import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Library, Loader2, Plus, Search, Trash2, Copy, Play } from 'lucide-react'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import { clipsApi } from '../../api/clips.api'
import { clipTypesApi } from '../../api/clip-types.api'
import { playoutApi } from '../../api/playout.api'
import { playlistsApi } from '../../api/playlists.api'
import { Badge } from '../../components/ui/Badge'
import type { Channel } from '../../api/channels.api'
import { usePlayoutSelection } from '../../stores/playoutSelection.store'

function formatTime(sec: number) {
  const abs = Math.floor(sec)
  const m = Math.floor(abs / 60)
  const s = abs % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

interface ClipLibraryPanelProps {
  channels: Channel[]
}

export default function ClipLibraryPanel({ channels }: ClipLibraryPanelProps) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [typeId, setTypeId] = useState('')
  const [targetChannelId, setTargetChannelId] = useState(channels[0]?.id ?? '')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleSearchChange(v: string) {
    setSearch(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(v), 400)
  }

  const { data: playoutState } = useQuery({
    queryKey: ['playout-state', targetChannelId],
    queryFn: () => playoutApi.getState(targetChannelId),
    refetchInterval: 5000,
    enabled: !!targetChannelId,
  })

  const activePlaylistId = playoutState?.playlistId ?? null
  const hasActivePlaylist = !!activePlaylistId
  const playoutStatus = (playoutState as any)?.status ?? 'IDLE'

  const { data: roteiros = [] } = useQuery({
    queryKey: ['playlists-panel', targetChannelId],
    queryFn: () => playlistsApi.list({ channelId: targetChannelId }),
    enabled: !!targetChannelId,
    staleTime: 10_000,
  })

  const { data: types = [] } = useQuery({
    queryKey: ['clip-types'],
    queryFn: clipTypesApi.list,
    staleTime: 60_000,
  })

  const { data, isFetching } = useQuery({
    queryKey: ['clips-library', debouncedSearch, typeId],
    queryFn: () => clipsApi.list({
      search: debouncedSearch || undefined,
      typeId: typeId || undefined,
      page: 1,
    }),
    staleTime: 10_000,
  })

  const { selectedByChannel, clearSelected } = usePlayoutSelection()
  const selectedItemId = selectedByChannel[targetChannelId] ?? null

  const insertBreakMut = useMutation({
    mutationFn: () => playoutApi.insertBreak(targetChannelId, selectedItemId),
    onSuccess: () => {
      toast.success('BREAK inserido')
      qc.invalidateQueries({ queryKey: ['playout-items', targetChannelId] })
      clearSelected(targetChannelId)
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao inserir BREAK'),
  })

  const insertMut = useMutation({
    mutationFn: ({ channelId, clipId }: { channelId: string; clipId: string }) =>
      playoutApi.insertClip(channelId, clipId, selectedByChannel[channelId] ?? null),
    onSuccess: (_data, { channelId }) => {
      toast.success('Clipe inserido')
      qc.invalidateQueries({ queryKey: ['playout-items', channelId] })
      clearSelected(channelId)
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao inserir clipe'),
  })

  const createAndPlayMut = useMutation({
    mutationFn: async ({ channelId, clipId }: { channelId: string; clipId: string }) => {
      const playlist = await playlistsApi.create({ date: todayISO(), channelId })
      await playlistsApi.addItem(playlist.id, { clipId, order: 0 })
      await playoutApi.play(channelId, playlist.id)
      return playlist
    },
    onSuccess: (playlist, { channelId }) => {
      toast.success(`Roteiro "${playlist.name}" criado e iniciado`)
      qc.invalidateQueries({ queryKey: ['playout-items', channelId] })
      qc.invalidateQueries({ queryKey: ['playout-state', channelId] })
      qc.invalidateQueries({ queryKey: ['playlists-panel'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao criar roteiro'),
  })

  const newPlaylistMut = useMutation({
    mutationFn: () => playlistsApi.create({ date: todayISO(), channelId: targetChannelId }),
    onSuccess: (playlist) => {
      toast.success(`Roteiro "${playlist.name}" criado`)
      qc.invalidateQueries({ queryKey: ['playlists-panel'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao criar roteiro'),
  })

  const playRotMut = useMutation({
    mutationFn: (id: string) => playoutApi.play(targetChannelId, id),
    onSuccess: () => {
      toast.success('Roteiro iniciado')
      qc.invalidateQueries({ queryKey: ['playout-state', targetChannelId] })
      qc.invalidateQueries({ queryKey: ['playout-items', targetChannelId] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao iniciar roteiro'),
  })

  const cloneRotMut = useMutation({
    mutationFn: (id: string) => playlistsApi.clone(id),
    onSuccess: (pl) => {
      toast.success(`Roteiro "${pl.name}" salvo como cópia`)
      qc.invalidateQueries({ queryKey: ['playlists-panel'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao salvar como'),
  })

  const deleteRotMut = useMutation({
    mutationFn: async (id: string) => {
      if (id === activePlaylistId) await playoutApi.stop(targetChannelId).catch(() => null)
      await playlistsApi.delete(id)
    },
    onSuccess: () => {
      toast.success('Roteiro excluído')
      qc.invalidateQueries({ queryKey: ['playout-state', targetChannelId] })
      qc.invalidateQueries({ queryKey: ['playout-items', targetChannelId] })
      qc.invalidateQueries({ queryKey: ['playlists-panel'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao excluir'),
  })

  function handleInsertClick(clipId: string) {
    if (!hasActivePlaylist) {
      createAndPlayMut.mutate({ channelId: targetChannelId, clipId })
    } else {
      insertMut.mutate({ channelId: targetChannelId, clipId })
    }
  }

  const clips = data?.items ?? []
  const activeTypes = types.filter((t) => t.active)

  return (
    <div className="card flex flex-col gap-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
        <Library className="h-4 w-4 text-brand-400 flex-shrink-0" />
        <span className="text-sm font-semibold text-white flex-1">Biblioteca</span>
        {isFetching && <Loader2 className="h-3 w-3 text-gray-500 animate-spin" />}
      </div>

      {/* Seletor de canal destino */}
      {channels.length > 1 && (
        <div className="px-3 pt-2">
          <select
            value={targetChannelId}
            onChange={(e) => setTargetChannelId(e.target.value)}
            className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-300 focus:outline-none focus:border-brand-500"
          >
            {channels.map((ch) => (
              <option key={ch.id} value={ch.id}>
                {ch.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Lista de roteiros */}
      <div className="border-b border-gray-800/60">
        <div className="max-h-40 overflow-y-auto">
          {roteiros.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-1.5">
              <span className="h-1.5 w-1.5 flex-shrink-0" />
              <p className="flex-1 min-w-0 text-[11px] text-gray-600 italic truncate">
                Não há roteiros disponíveis, crie um novo...
              </p>
              <button
                onClick={() => newPlaylistMut.mutate()}
                disabled={newPlaylistMut.isPending}
                title="Criar novo roteiro"
                className="p-1 rounded text-gray-600 hover:text-brand-400 disabled:opacity-40 transition-colors"
              >
                {newPlaylistMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              </button>
            </div>
          ) : (
            <>
              {roteiros.map((pl) => {
                const isCurrent = pl.id === activePlaylistId
                const isLocked = isCurrent && (playoutStatus === 'PLAYING' || playoutStatus === 'PAUSED')
                return (
                  <div
                    key={pl.id}
                    className={clsx(
                      'flex items-center gap-2 px-3 py-1.5',
                      isCurrent ? 'bg-emerald-900/15' : 'hover:bg-gray-800/30'
                    )}
                  >
                    <span className={clsx(
                      'h-1.5 w-1.5 rounded-full flex-shrink-0',
                      isCurrent ? 'bg-emerald-400' : 'bg-gray-700'
                    )} />
                    <div className="flex-1 min-w-0">
                      <p className={clsx(
                        'text-[11px] font-medium truncate leading-tight',
                        isCurrent ? 'text-white' : 'text-gray-300'
                      )}>{pl.name}</p>
                      <p className="text-[10px] text-gray-600 leading-tight">
                        {new Date(pl.date).toLocaleDateString('pt-BR')} · {pl._count?.items ?? 0} itens
                      </p>
                    </div>
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      <button
                        onClick={() => playRotMut.mutate(pl.id)}
                        disabled={playRotMut.isPending}
                        title="Usar este roteiro"
                        className="p-1 rounded text-gray-600 hover:text-brand-400 disabled:opacity-30 transition-colors"
                      >
                        <Play className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => cloneRotMut.mutate(pl.id)}
                        disabled={cloneRotMut.isPending}
                        title="Salvar cópia"
                        className="p-1 rounded text-gray-600 hover:text-sky-400 disabled:opacity-30 transition-colors"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => { if (!confirm(`Excluir "${pl.name}"?`)) return; deleteRotMut.mutate(pl.id) }}
                        disabled={isLocked || deleteRotMut.isPending}
                        title={isLocked ? 'Roteiro em uso — não pode excluir' : 'Excluir roteiro'}
                        className="p-1 rounded text-gray-600 hover:text-red-400 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                )
              })}
              {/* Linha fixa: criar novo roteiro */}
              <div className="flex items-center gap-2 px-3 py-1.5 border-t border-gray-800/30 hover:bg-gray-800/20 transition-colors">
                <span className="h-1.5 w-1.5 flex-shrink-0" />
                <p className="flex-1 text-[11px] text-gray-600">Criar novo roteiro</p>
                <button
                  onClick={() => newPlaylistMut.mutate()}
                  disabled={newPlaylistMut.isPending}
                  title="Criar novo roteiro"
                  className="p-1 rounded text-gray-600 hover:text-brand-400 disabled:opacity-40 transition-colors"
                >
                  {newPlaylistMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Busca */}
      <div className="px-3 pt-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Buscar clipe..."
            className="w-full bg-gray-800 border border-gray-700 rounded pl-7 pr-3 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-brand-500"
          />
        </div>
      </div>

      {/* Filtro por tipo + botão BREAK */}
      <div className="px-3 pt-2 pb-1 flex items-center gap-1">
        <div className="flex gap-1 flex-wrap flex-1 min-w-0">
          <button
            onClick={() => setTypeId('')}
            className={clsx(
              'text-[10px] px-2 py-0.5 rounded transition-colors',
              !typeId
                ? 'bg-brand-600/30 text-brand-300 ring-1 ring-brand-500/30'
                : 'bg-gray-800 text-gray-500 hover:bg-gray-700 hover:text-gray-300'
            )}
          >
            Todos
          </button>
          {activeTypes.map((t) => (
            <button
              key={t.id}
              onClick={() => setTypeId(t.id === typeId ? '' : t.id)}
              className={clsx(
                'text-[10px] px-2 py-0.5 rounded transition-colors',
                typeId === t.id ? 'ring-1 ring-white/20' : 'bg-gray-800 text-gray-500 hover:bg-gray-700 hover:text-gray-300'
              )}
              style={typeId === t.id ? { backgroundColor: t.fontBackColor + '44', color: t.fontColor } : {}}
            >
              {t.code}
            </button>
          ))}
        </div>

        {/* Botão BREAK */}
        <button
          onClick={() => insertBreakMut.mutate()}
          disabled={!hasActivePlaylist || insertBreakMut.isPending}
          title={selectedItemId ? 'Inserir BREAK após item selecionado no grid' : 'Inserir BREAK no final da playlist'}
          className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded bg-black border-2 border-yellow-400 text-yellow-400 text-[11px] font-black tracking-wider hover:bg-yellow-400 hover:text-black disabled:opacity-30 disabled:cursor-not-allowed transition-all"
        >
          {insertBreakMut.isPending
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : '⏸'}
          BREAK
        </button>
      </div>

      {/* Lista de clipes */}
      <div className="overflow-y-auto max-h-96 divide-y divide-gray-800/50 mt-1">
        {clips.length === 0 ? (
          <p className="text-[11px] text-gray-600 text-center py-5">
            {isFetching ? 'Buscando...' : 'Nenhum clipe encontrado'}
          </p>
        ) : (
          clips.map((clip) => {
            const isPending =
              (insertMut.isPending || createAndPlayMut.isPending) &&
              (insertMut.variables as any)?.clipId === clip.id &&
              (insertMut.variables as any)?.channelId === targetChannelId
            return (
              <div
                key={clip.id}
                className="flex items-center gap-1.5 px-3 py-2 hover:bg-gray-800/30 transition-colors"
              >
                {clip.type ? (
                  <Badge
                    bg={clip.type.fontBackColor}
                    color={clip.type.fontColor}
                    className="text-[9px] flex-shrink-0"
                  >
                    {clip.type.code}
                  </Badge>
                ) : (
                  <span className="w-6 flex-shrink-0" />
                )}

                <span className="text-[10px] font-mono text-gray-500 flex-shrink-0 w-16 truncate" title={clip.code}>
                  {clip.code}
                </span>

                <p className="flex-1 text-xs text-gray-200 truncate leading-tight min-w-0">{clip.title}</p>

                {(clip as any).graphic && (
                  <span
                    title={`Gráfico: ${(clip as any).graphic.name}`}
                    className="text-[9px] bg-violet-900/50 text-violet-400 px-1 py-0.5 rounded font-mono flex-shrink-0 border border-violet-700/40"
                  >
                    GFX
                  </span>
                )}

                {clip.media?.duration != null && (
                  <span className="text-[10px] font-mono text-gray-600 flex-shrink-0">
                    {formatTime(clip.media.duration)}
                  </span>
                )}

                <button
                  onClick={() => handleInsertClick(clip.id)}
                  disabled={isPending || !targetChannelId}
                  title={hasActivePlaylist ? 'Inserir após clipe atual' : 'Criar playlist e iniciar com este clipe'}
                  className="flex-shrink-0 p-1 rounded text-gray-600 hover:text-emerald-400 hover:bg-emerald-900/20 transition-colors disabled:opacity-40"
                >
                  {isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />
                    : <Plus className="h-3.5 w-3.5" />}
                </button>
              </div>
            )
          })
        )}
      </div>

      {data && data.total > clips.length && (
        <p className="text-[10px] text-gray-700 text-center py-1.5 border-t border-gray-800/50">
          {clips.length} de {data.total} — refine a busca
        </p>
      )}
    </div>
  )
}
