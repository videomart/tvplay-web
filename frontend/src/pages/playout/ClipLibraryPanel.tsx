import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Library, Loader2, Plus, Search, Trash2, Copy, Play, ListPlus } from 'lucide-react'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import { clipsApi } from '../../api/clips.api'
import { clipTypesApi } from '../../api/clip-types.api'
import { playoutApi } from '../../api/playout.api'
import { playlistsApi } from '../../api/playlists.api'
import { Badge } from '../../components/ui/Badge'
import { Modal } from '../../components/ui/Modal'
import type { Channel } from '../../api/channels.api'
import { usePlayoutSelection } from '../../stores/playoutSelection.store'

function formatTime(sec: number) {
  const abs = Math.floor(sec)
  const m = Math.floor(abs / 60)
  const s = abs % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function getClipMediaType(clip: any): string {
  if (clip.sourceType === 'URL') {
    const url = clip.sourceUrl ?? ''
    if (/youtube\.com|youtu\.be/i.test(url)) return 'YT'
    if (/twitch\.tv/i.test(url)) return 'LIVE'
    if (/^srt:/i.test(url)) return 'SRT'
    if (/^rtmps?:/i.test(url)) return 'RTMP'
    if (/^rtsp:/i.test(url)) return 'RTSP'
    if (/^udp:/i.test(url)) return 'UDP'
    return 'URL'
  }
  if (!clip.media) return 'ERR'
  if (clip.media.ingestStatus === 'READY') return 'FILE'
  if (clip.media.ingestStatus === 'ERROR') return 'ERR'
  return 'PROC'
}

const CLIP_MEDIA_STYLE: Record<string, string> = {
  YT:   'bg-red-900/50 text-red-400 border-red-700/40',
  LIVE: 'bg-purple-900/50 text-purple-400 border-purple-700/40',
  SRT:  'bg-blue-900/50 text-blue-300 border-blue-700/40',
  RTMP: 'bg-orange-900/50 text-orange-400 border-orange-700/40',
  RTSP: 'bg-sky-900/50 text-sky-400 border-sky-700/40',
  UDP:  'bg-gray-800 text-gray-500 border-gray-600/40',
  URL:  'bg-sky-900/50 text-sky-400 border-sky-700/40',
  FILE: 'bg-gray-800 text-gray-400 border-gray-700/50',
  ERR:  'bg-orange-900/50 text-orange-400 border-orange-700/40',
  PROC: 'bg-amber-500/10 text-amber-400 border-amber-700/30',
}

interface ClipLibraryPanelProps {
  channels: Channel[]
}

export default function ClipLibraryPanel({ channels }: ClipLibraryPanelProps) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [typeId, setTypeId] = useState('')
  const [targetChannelId, setTargetChannelId] = useState(channels[0]?.id ?? '')
  const [selectedRoteiroId, setSelectedRoteiroId] = useState<string | null>(null)
  const [insertModal, setInsertModal] = useState<{ sourceId: string; name: string } | null>(null)
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

  const { data: allPlaylists = [] } = useQuery({
    queryKey: ['playlists-panel', targetChannelId],
    queryFn: () => playlistsApi.list({ channelId: targetChannelId, excludeAutoSave: false }),
    enabled: !!targetChannelId,
    staleTime: 10_000,
  })
  const roteiros = allPlaylists.filter((pl) => !pl.isAutoSave)
  const autoSavePlaylist = allPlaylists.find((pl) => pl.isAutoSave) ?? null

  const { data: activeItems = [] } = useQuery({
    queryKey: ['playout-items', targetChannelId],
    queryFn: () => playoutApi.getItems(targetChannelId),
    enabled: !!targetChannelId && hasActivePlaylist,
    staleTime: 5_000,
  })

  // Conta quantas vezes cada clip aparece no roteiro ativo (para exibir ×N)
  const activeClipCounts = activeItems
    .filter((i) => !i.isBreak && i.clipId)
    .reduce((acc, i) => { acc.set(i.clipId!, (acc.get(i.clipId!) ?? 0) + 1); return acc }, new Map<string, number>())

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
      qc.invalidateQueries({ queryKey: ['playout-state', targetChannelId] })
      qc.invalidateQueries({ queryKey: ['playlists-panel', targetChannelId] })
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
      qc.invalidateQueries({ queryKey: ['playout-state', channelId] })
      qc.invalidateQueries({ queryKey: ['playlists-panel', channelId] })
      clearSelected(channelId)
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao inserir clipe'),
  })

  const newPlaylistMut = useMutation({
    mutationFn: () => playlistsApi.create({ date: new Date().toISOString().slice(0, 10), channelId: targetChannelId }),
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
      qc.invalidateQueries({ queryKey: ['playlists-panel'] })
      setInsertModal(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao iniciar roteiro'),
  })

  const appendFromMut = useMutation({
    mutationFn: ({ targetId, sourceId }: { targetId: string; sourceId: string }) =>
      playlistsApi.appendFrom(targetId, sourceId),
    onSuccess: (data) => {
      toast.success(`${data.appended} item(s) inserido(s) no final`)
      qc.invalidateQueries({ queryKey: ['playout-items', targetChannelId] })
      setInsertModal(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao inserir itens'),
  })

  function handleInsertRoteiro(sourceId: string, name: string) {
    if (!hasActivePlaylist) {
      playRotMut.mutate(sourceId)
      return
    }
    if (playoutStatus === 'PLAYING' || playoutStatus === 'PAUSED') {
      appendFromMut.mutate({ targetId: activePlaylistId!, sourceId })
    } else {
      setInsertModal({ sourceId, name })
    }
  }

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
    insertMut.mutate({ channelId: targetChannelId, clipId })
  }

  const clips = data?.items ?? []
  const activeTypes = types.filter((t) => t.active)

  return (
    <div className="card flex flex-col gap-0 overflow-hidden h-full">
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
          {roteiros.length === 0 && !autoSavePlaylist ? (
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
              {/* Roteiro de trabalho (autosave) */}
              {autoSavePlaylist && (
                <div
                  className={clsx(
                    'flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none border-b border-amber-900/30',
                    autoSavePlaylist.id === activePlaylistId ? 'bg-amber-900/20' : 'bg-amber-950/10 hover:bg-amber-900/15',
                  )}
                  onClick={() => setSelectedRoteiroId(autoSavePlaylist.id === selectedRoteiroId ? null : autoSavePlaylist.id)}
                  onDoubleClick={() => handleInsertRoteiro(autoSavePlaylist.id, 'Roteiro de trabalho')}
                  title="Roteiro de trabalho — clipes inseridos diretamente no canal"
                >
                  <span className={clsx(
                    'h-1.5 w-1.5 rounded-full flex-shrink-0',
                    autoSavePlaylist.id === activePlaylistId ? 'bg-amber-400' : 'bg-amber-700'
                  )} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold text-amber-400 truncate leading-tight">Roteiro de trabalho</p>
                    <p className="text-[10px] text-amber-700 leading-tight">{autoSavePlaylist._count?.items ?? 0} itens · não salvo</p>
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); playRotMut.mutate(autoSavePlaylist.id) }}
                      disabled={playRotMut.isPending}
                      title="Iniciar roteiro de trabalho"
                      className="p-1 rounded text-amber-700 hover:text-amber-400 disabled:opacity-30 transition-colors"
                    >
                      <Play className="h-3 w-3" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); cloneRotMut.mutate(autoSavePlaylist.id) }}
                      disabled={cloneRotMut.isPending}
                      title="Salvar como roteiro nomeado"
                      className="p-1 rounded text-amber-700 hover:text-amber-400 disabled:opacity-30 transition-colors"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); if (!confirm('Limpar roteiro de trabalho?')) return; deleteRotMut.mutate(autoSavePlaylist.id) }}
                      disabled={deleteRotMut.isPending}
                      title="Limpar roteiro de trabalho"
                      className="p-1 rounded text-amber-700 hover:text-red-400 disabled:opacity-20 transition-colors"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              )}

              {roteiros.map((pl) => {
                const isCurrent = pl.id === activePlaylistId
                const isLocked = isCurrent && (playoutStatus === 'PLAYING' || playoutStatus === 'PAUSED')
                return (
                  <div
                    key={pl.id}
                    onClick={() => setSelectedRoteiroId(pl.id === selectedRoteiroId ? null : pl.id)}
                    onDoubleClick={() => handleInsertRoteiro(pl.id, pl.name)}
                    className={clsx(
                      'flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none',
                      isCurrent ? 'bg-emerald-900/15' : 'hover:bg-gray-800/30',
                      selectedRoteiroId === pl.id && !isCurrent ? 'ring-1 ring-inset ring-cyan-500/40 bg-cyan-900/10' : ''
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
                        onClick={(e) => { e.stopPropagation(); playRotMut.mutate(pl.id) }}
                        disabled={playRotMut.isPending}
                        title="Usar este roteiro (substitui o atual)"
                        className="p-1 rounded text-gray-600 hover:text-brand-400 disabled:opacity-30 transition-colors"
                      >
                        <Play className="h-3 w-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleInsertRoteiro(pl.id, pl.name) }}
                        disabled={appendFromMut.isPending || playRotMut.isPending}
                        title={
                          !hasActivePlaylist ? 'Usar este roteiro' :
                          (playoutStatus === 'PLAYING' || playoutStatus === 'PAUSED')
                            ? 'Inserir itens no final (canal em andamento)'
                            : 'Inserir no roteiro ativo (substituir ou no final)'
                        }
                        className="p-1 rounded text-gray-600 hover:text-emerald-400 disabled:opacity-30 transition-colors"
                      >
                        <ListPlus className="h-3 w-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); cloneRotMut.mutate(pl.id) }}
                        disabled={cloneRotMut.isPending}
                        title="Salvar cópia"
                        className="p-1 rounded text-gray-600 hover:text-sky-400 disabled:opacity-30 transition-colors"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); if (!confirm(`Excluir "${pl.name}"?`)) return; deleteRotMut.mutate(pl.id) }}
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

      {/* Cabeçalho das colunas da biblioteca */}
      <div className="flex items-center gap-1.5 px-3 py-1 border-b border-gray-800 bg-gray-900/90 sticky top-0 z-10">
        <span className="text-[9px] font-bold text-gray-600 uppercase tracking-wide w-6 flex-shrink-0">Tipo</span>
        <span className="text-[9px] font-bold text-gray-600 uppercase tracking-wide w-16 flex-shrink-0">Código</span>
        <span className="text-[9px] font-bold text-gray-600 uppercase tracking-wide flex-1 min-w-0">Título</span>
        <span className="text-[9px] font-bold text-emerald-700 uppercase tracking-wide w-5 text-center flex-shrink-0">✓</span>
        <span className="text-[9px] font-bold text-gray-600 uppercase tracking-wide w-10 text-center flex-shrink-0">Mídia</span>
        <span className="text-[9px] font-bold text-gray-600 uppercase tracking-wide w-10 text-right flex-shrink-0">Dur.</span>
        <span className="w-5 flex-shrink-0" />
      </div>

      {/* Lista de clipes */}
      <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-gray-800/50">
        {clips.length === 0 ? (
          <p className="text-[11px] text-gray-600 text-center py-5">
            {isFetching ? 'Buscando...' : 'Nenhum clipe encontrado'}
          </p>
        ) : (
          clips.map((clip) => {
            const isPending =
              insertMut.isPending &&
              (insertMut.variables as any)?.clipId === clip.id &&
              (insertMut.variables as any)?.channelId === targetChannelId
            const mt = getClipMediaType(clip)
            const mtStyle = CLIP_MEDIA_STYLE[mt] ?? 'bg-gray-800 text-gray-500 border-gray-600/40'
            const inPlaylistCount = activeClipCounts.get(clip.id) ?? 0
            return (
              <div
                key={clip.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-clip-id', clip.id)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onDoubleClick={() => navigate('/clips', { state: { editClipId: clip.id, returnTo: '/playout' } })}
                title="Duplo clique para editar o clipe"
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-2 transition-colors cursor-grab active:cursor-grabbing',
                  inPlaylistCount > 0
                    ? 'bg-emerald-950/20 hover:bg-emerald-950/30 border-l-2 border-emerald-700/40'
                    : 'hover:bg-gray-800/30 border-l-2 border-transparent'
                )}
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

                {/* Coluna fixa: indicador de presença no roteiro ativo */}
                <span className="w-5 flex-shrink-0 text-center">
                  {inPlaylistCount > 0 && (
                    <span
                      title={inPlaylistCount === 1 ? 'Já está no roteiro ativo' : `Está ${inPlaylistCount}× no roteiro ativo`}
                      className="text-[9px] font-bold text-emerald-400"
                    >
                      {inPlaylistCount === 1 ? '✓' : `×${inPlaylistCount}`}
                    </span>
                  )}
                </span>

                {/* Badge tipo de mídia */}
                <span className={clsx('text-[9px] px-1 py-0.5 rounded border flex-shrink-0 font-mono font-medium w-10 text-center', mtStyle)}>
                  {mt}
                </span>

                {clip.media?.duration != null ? (
                  <span className="text-[10px] font-mono text-gray-600 flex-shrink-0 w-10 text-right">
                    {formatTime(clip.media.duration)}
                  </span>
                ) : (
                  <span className="w-10 flex-shrink-0" />
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

      {/* Modal: inserir roteiro no roteiro ativo */}
      <Modal open={!!insertModal} onClose={() => setInsertModal(null)} title="Inserir Roteiro">
        {insertModal && (
          <div className="space-y-4">
            <p className="text-sm text-gray-400">
              Como deseja inserir o roteiro <strong className="text-white">"{insertModal.name}"</strong>?
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => playRotMut.mutate(insertModal.sourceId)}
                disabled={playRotMut.isPending}
                className="w-full px-4 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {playRotMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Substituir roteiro atual e iniciar
              </button>
              <button
                onClick={() => activePlaylistId && appendFromMut.mutate({ targetId: activePlaylistId, sourceId: insertModal.sourceId })}
                disabled={appendFromMut.isPending || !activePlaylistId}
                className="w-full px-4 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {appendFromMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListPlus className="h-4 w-4" />}
                Inserir no final do roteiro ativo
              </button>
            </div>
            <button
              onClick={() => setInsertModal(null)}
              className="w-full text-center text-xs text-gray-600 hover:text-gray-400 transition-colors pt-1"
            >
              Cancelar
            </button>
          </div>
        )}
      </Modal>
    </div>
  )
}
