import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Library, Loader2, Plus, Search, PlayCircle, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import { clipsApi } from '../../api/clips.api'
import { clipTypesApi } from '../../api/clip-types.api'
import { playoutApi } from '../../api/playout.api'
import { playlistsApi } from '../../api/playlists.api'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import type { Channel } from '../../api/channels.api'

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

  // Estado para criação de playlist em runtime
  const [createOpen, setCreateOpen] = useState(false)
  const [pendingClipId, setPendingClipId] = useState<string | null>(null)
  const [programName, setProgramName] = useState('')

  function handleSearchChange(v: string) {
    setSearch(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(v), 400)
  }

  // Estado do playout do canal selecionado
  const { data: playoutState } = useQuery({
    queryKey: ['playout-state', targetChannelId],
    queryFn: () => playoutApi.getState(targetChannelId),
    refetchInterval: 5000,
    enabled: !!targetChannelId,
  })

  const hasActivePlaylist = !!(playoutState?.playlistId)

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

  const insertMut = useMutation({
    mutationFn: ({ channelId, clipId }: { channelId: string; clipId: string }) =>
      playoutApi.insertClip(channelId, clipId),
    onSuccess: (_state, { channelId }) => {
      toast.success('Clipe inserido')
      qc.invalidateQueries({ queryKey: ['playout-items', channelId] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao inserir clipe'),
  })

  // Cria playlist, adiciona clipe e inicia playout
  const createAndPlayMut = useMutation({
    mutationFn: async ({ channelId, clipId, name }: { channelId: string; clipId: string; name: string }) => {
      const playlist = await playlistsApi.create({
        date: todayISO(),
        name,
        channelId,
      })
      await playlistsApi.addItem(playlist.id, { clipId, order: 0 })
      await playoutApi.play(channelId, playlist.id)
      return playlist
    },
    onSuccess: (playlist, { channelId }) => {
      toast.success(`Playlist "${playlist.name}" criada e iniciada`)
      qc.invalidateQueries({ queryKey: ['playout-items', channelId] })
      qc.invalidateQueries({ queryKey: ['playout-state', channelId] })
      qc.invalidateQueries({ queryKey: ['playlists-all'] })
      setCreateOpen(false)
      setPendingClipId(null)
      setProgramName('')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao criar playlist'),
  })

  function handleInsertClick(clipId: string) {
    if (!hasActivePlaylist) {
      setPendingClipId(clipId)
      setCreateOpen(true)
    } else {
      insertMut.mutate({ channelId: targetChannelId, clipId })
    }
  }

  function handleCreateAndPlay() {
    if (!programName.trim() || !pendingClipId) return
    createAndPlayMut.mutate({
      channelId: targetChannelId,
      clipId: pendingClipId,
      name: programName.trim(),
    })
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

      {/* Indicador de estado do canal */}
      {playoutState && (
        <div className={clsx(
          'mx-3 mt-2 px-2 py-1 rounded text-[10px] font-medium flex items-center gap-1',
          hasActivePlaylist
            ? 'bg-emerald-900/20 text-emerald-400'
            : 'bg-amber-900/20 text-amber-400'
        )}>
          <span className={clsx('h-1.5 w-1.5 rounded-full', hasActivePlaylist ? 'bg-emerald-400' : 'bg-amber-400')} />
          {hasActivePlaylist
            ? `Playlist: ${playoutState.name ?? '—'}`
            : 'Sem playlist ativa — clique + para criar'}
        </div>
      )}

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

      {/* Filtro por tipo */}
      {activeTypes.length > 0 && (
        <div className="px-3 pt-2 pb-1 flex gap-1 flex-wrap">
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
      )}

      {/* Modal inline: criar playlist e iniciar */}
      {createOpen && (
        <div className="mx-3 my-2 p-3 bg-gray-800 rounded-lg border border-brand-500/30 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-white flex items-center gap-1">
              <PlayCircle className="h-3.5 w-3.5 text-brand-400" />
              Criar playlist e iniciar
            </p>
            <button
              onClick={() => { setCreateOpen(false); setPendingClipId(null) }}
              className="text-gray-600 hover:text-gray-400"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <input
            autoFocus
            value={programName}
            onChange={(e) => setProgramName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateAndPlay()}
            placeholder="Nome do programa..."
            className="w-full bg-gray-900 border border-gray-700 rounded px-2.5 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-brand-500"
          />
          <Button
            size="sm"
            className="w-full"
            loading={createAndPlayMut.isPending}
            disabled={!programName.trim()}
            icon={<PlayCircle className="h-3.5 w-3.5" />}
            onClick={handleCreateAndPlay}
          >
            Criar e Iniciar
          </Button>
        </div>
      )}

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
                className="flex items-center gap-2 px-3 py-2 hover:bg-gray-800/30 transition-colors"
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

                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-200 truncate leading-tight">{clip.title}</p>
                  <p className="text-[10px] text-gray-600 font-mono">
                    {clip.code}
                    {clip.media?.duration != null && (
                      <span className="ml-1 text-gray-700">· {formatTime(clip.media.duration)}</span>
                    )}
                  </p>
                </div>

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
