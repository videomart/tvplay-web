import { useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Plus, Trash2, Search, GripVertical,
  Clock, ListVideo, ChevronRight, Repeat2, Lock, Upload, Timer
} from 'lucide-react'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import { playlistsApi, type PlaylistItem } from '../../api/playlists.api'
import { clipsApi, type Clip, MODALITY_LABELS } from '../../api/clips.api'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Badge } from '../../components/ui/Badge'

function getItemMediaType(clip: any): string {
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
  if (!clip.media) return '!ARQ'
  if (clip.media.ingestStatus === 'READY') return 'ARQ'
  if (clip.media.ingestStatus === 'ERROR') return '!ARQ'
  return '⏳'
}

const ITEM_MEDIA_STYLE: Record<string, string> = {
  YT:    'bg-red-900/50 text-red-400 border-red-700/40',
  LIVE:  'bg-purple-900/50 text-purple-400 border-purple-700/40',
  SRT:   'bg-blue-900/50 text-blue-300 border-blue-700/40',
  RTMP:  'bg-orange-900/50 text-orange-400 border-orange-700/40',
  RTSP:  'bg-sky-900/50 text-sky-400 border-sky-700/40',
  UDP:   'bg-gray-800 text-gray-500 border-gray-600/40',
  URL:   'bg-sky-900/50 text-sky-400 border-sky-700/40',
  ARQ:   'bg-emerald-500/10 text-emerald-400 border-emerald-700/30',
  '!ARQ':'bg-orange-900/50 text-orange-400 border-orange-700/40',
  '⏳':  'bg-amber-500/10 text-amber-400 border-amber-700/30',
}

function formatDur(sec?: number) {
  if (!sec && sec !== 0) return '?'
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function totalDuration(items: PlaylistItem[]) {
  return items.reduce((acc, item) => {
    const clip = item.clip
    const isUrlClip = (clip as any).sourceType === 'URL'
    const cueIn = item.overrideCueIn ?? clip.cueIn
    const cueOut = item.overrideCueOut ?? clip.cueOut ?? (clip as any).media?.duration ?? clip.duration
    const dur = cueOut ? cueOut - cueIn : ((clip as any).media?.duration ?? clip.duration ?? (isUrlClip ? 3600 : 0))
    return acc + (dur ?? 0)
  }, 0)
}

export default function PlaylistEditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  const [uploadingClipId, setUploadingClipId] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const uploadClipIdRef = useRef<string | null>(null)
  const uploadFileRef = useRef<HTMLInputElement>(null)
  const [timerEditId, setTimerEditId] = useState<string | null>(null)
  const [timerEditVal, setTimerEditVal] = useState('')

  function startUpload(clipId: string) {
    uploadClipIdRef.current = clipId
    uploadFileRef.current?.click()
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const clipId = uploadClipIdRef.current
    if (!file || !clipId) return
    setUploadingClipId(clipId)
    setUploadProgress(0)
    try {
      await clipsApi.uploadMedia(file, clipId, setUploadProgress)
      toast.success('Upload concluído — transcodificação em andamento')
      qc.invalidateQueries({ queryKey: ['playlist', id] })
    } catch {
      toast.error('Erro no upload')
    } finally {
      setUploadingClipId(null)
      uploadClipIdRef.current = null
      if (uploadFileRef.current) uploadFileRef.current.value = ''
    }
  }

  const { data: playlist, isLoading } = useQuery({
    queryKey: ['playlist', id],
    queryFn: () => playlistsApi.get(id!),
    enabled: !!id,
  })

  const { data: clipsData } = useQuery({
    queryKey: ['clips-search', search],
    queryFn: () => clipsApi.list({ search: search || undefined, limit: 30 } as any),
    enabled: addOpen,
  })

  const addItem = useMutation({
    mutationFn: (clip: Clip) => playlistsApi.addItem(id!, { clipId: clip.id }),
    onSuccess: () => {
      toast.success('Clipe adicionado')
      qc.invalidateQueries({ queryKey: ['playlist', id] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro'),
  })

  const removeItem = useMutation({
    mutationFn: (itemId: string) => playlistsApi.removeItem(id!, itemId),
    onSuccess: () => {
      toast.success('Clipe removido')
      qc.invalidateQueries({ queryKey: ['playlist', id] })
    },
  })

  const reorderMut = useMutation({
    mutationFn: (items: { id: string; order: number }[]) => playlistsApi.reorder(id!, items),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['playlist', id] }),
  })

  const toggleLoop = useMutation({
    mutationFn: (item: PlaylistItem) => playlistsApi.updateItem(id!, item.id, { loop: !item.loop }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['playlist', id] }),
  })

  const setMaxDuration = useMutation({
    mutationFn: ({ itemId, maxDuration }: { itemId: string; maxDuration: number | null }) =>
      playlistsApi.updateItem(id!, itemId, { maxDuration }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['playlist', id] }),
  })

  function openTimerEdit(item: PlaylistItem) {
    setTimerEditId(item.id)
    const v = item.maxDuration
    setTimerEditVal(v ? `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}` : '')
  }

  function commitTimer(itemId: string) {
    const raw = timerEditVal.trim()
    let secs: number | null = null
    if (raw) {
      if (raw.includes(':')) {
        const [m, s] = raw.split(':').map(Number)
        secs = (m || 0) * 60 + (s || 0)
      } else {
        secs = parseInt(raw, 10) * 60
      }
      if (!secs || secs <= 0) secs = null
    }
    setMaxDuration.mutate({ itemId, maxDuration: secs })
    setTimerEditId(null)
  }

  const items: PlaylistItem[] = playlist?.items ?? []
  const isLocked = !!playlist?.locked

  // ─── Drag and drop ────────────────────────────────────────────────────────
  function handleDragStart(idx: number) { if (isLocked) return; setDragIdx(idx) }
  function handleDragOver(e: React.DragEvent, idx: number) { e.preventDefault(); setOverIdx(idx) }
  function handleDrop(targetIdx: number) {
    if (dragIdx == null || dragIdx === targetIdx) { setDragIdx(null); setOverIdx(null); return }
    const newItems = [...items]
    const [moved] = newItems.splice(dragIdx, 1)
    newItems.splice(targetIdx, 0, moved)
    const reordered = newItems.map((item, i) => ({ id: item.id, order: i }))
    reorderMut.mutate(reordered)
    setDragIdx(null)
    setOverIdx(null)
  }

  if (isLoading) return (
    <div className="p-6">
      <div className="h-8 w-48 bg-gray-800 rounded animate-pulse" />
    </div>
  )
  if (!playlist) return (
    <div className="p-6 text-gray-500">Playlist não encontrada.</div>
  )

  const total = totalDuration(items)
  const breakGroups = [...new Set(items.map((i) => i.breakNum))].sort((a, b) => a - b)

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/roteiros')}>
            Playlists
          </Button>
          <ChevronRight className="h-4 w-4 text-gray-600" />
          <div>
            <h1 className="text-base font-bold text-white">{playlist.name}</h1>
            <p className="text-[11px] text-gray-500">
              {playlist.channel ? `Canal ${playlist.channel.number} — ` : ''}
              {new Date(playlist.date).toLocaleDateString('pt-BR')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-sm text-gray-500">
            <Clock className="h-4 w-4" />
            <span className="font-mono">{formatDur(total)}</span>
            <span className="text-gray-600">·</span>
            <ListVideo className="h-4 w-4" />
            <span>{items.length} clipes</span>
          </div>
          {isLocked ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-amber-500/10 text-amber-400 text-xs font-medium">
              <Lock className="h-3.5 w-3.5" />
              Bloqueada
            </div>
          ) : (
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setAddOpen(true)}>
              Adicionar Clipe
            </Button>
          )}
          <input ref={uploadFileRef} type="file" accept="video/*,.mxf,.mts,.m2ts" className="hidden" onChange={handleFileUpload} />
        </div>
      </div>

      {/* Lista de itens */}
      <div className="flex-1 overflow-y-auto p-6">
        {items.length === 0 ? (
          <div className="card p-12 text-center">
            <ListVideo className="h-10 w-10 text-gray-700 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">Playlist vazia. Adicione clipes para começar.</p>
            <Button className="mt-4" size="sm" onClick={() => setAddOpen(true)} icon={<Plus className="h-4 w-4" />}>
              Adicionar Clipe
            </Button>
          </div>
        ) : (
          <>
          {/* Cabeçalho das colunas */}
          <div className="flex items-center gap-3 px-3 py-1.5 mb-1 border-b border-gray-800/60">
            <span className="w-4 shrink-0" />
            <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-wide w-6 text-right shrink-0">#</span>
            <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-wide w-8 shrink-0">Bloco</span>
            <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-wide w-10 shrink-0">Tipo</span>
            <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-wide flex-1">Título / Código / Cliente</span>
            <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-wide shrink-0 w-14 text-right">Duração</span>
            <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-wide shrink-0 w-12 text-center">Mídia</span>
            <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-wide shrink-0 w-16 text-center">Loop</span>
            <span className="w-16 shrink-0" />
          </div>

          <div className="space-y-1">
            {items.map((item, idx) => {
              const clip = item.clip
              const type = (clip as any).type
              const media = (clip as any).media
              const cueIn = item.overrideCueIn ?? clip.cueIn
              const cueOut = item.overrideCueOut ?? clip.cueOut ?? media?.duration
              const dur = cueOut ? cueOut - cueIn : (media?.duration ?? clip.duration)
              const isOver = overIdx === idx

              return (
                <div
                  key={item.id}
                  draggable={!isLocked}
                  onDragStart={() => handleDragStart(idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDrop={() => handleDrop(idx)}
                  onDragEnd={() => { setDragIdx(null); setOverIdx(null) }}
                  className={clsx(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg bg-gray-900 border transition-all',
                    isOver ? 'border-brand-500/50 bg-brand-500/5' : 'border-gray-800',
                    dragIdx === idx && 'opacity-40'
                  )}
                >
                  {/* Drag handle */}
                  <GripVertical className={clsx('h-4 w-4 shrink-0', isLocked ? 'text-gray-700 cursor-not-allowed' : 'text-gray-600 cursor-grab')} />

                  {/* Número */}
                  <span className="text-[11px] font-mono text-gray-600 w-6 text-right shrink-0">{idx + 1}</span>

                  {/* Break badge */}
                  <span className="text-[10px] bg-gray-800 text-gray-500 px-1.5 py-0.5 rounded shrink-0">
                    BK{item.breakNum}
                  </span>

                  {/* Tipo */}
                  {type && (
                    <Badge bg={type.fontBackColor} color={type.fontColor} className="text-[10px] shrink-0">
                      {type.code}
                    </Badge>
                  )}

                  {/* Título */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{clip.title}</p>
                    <p className="text-[11px] text-gray-500 truncate">
                      {clip.code}
                      {(clip as any).client?.name && ` · ${(clip as any).client.name}`}
                    </p>
                  </div>

                  {/* Duração */}
                  <span className="text-xs font-mono text-gray-400 shrink-0">{formatDur(dur)}</span>

                  {/* Tipo de mídia */}
                  {(() => {
                    const mt = getItemMediaType(clip)
                    const style = ITEM_MEDIA_STYLE[mt] ?? 'bg-gray-800 text-gray-500 border-gray-600/40'
                    return (
                      <span className={clsx('text-[10px] px-1.5 py-0.5 rounded shrink-0 border font-mono font-medium w-12 text-center', style)}>
                        {mt}
                      </span>
                    )
                  })()}

                  {/* Timer — só para URL clips */}
                  {(['URL', 'YOUTUBE'].includes((clip as any).sourceType)) && (
                    timerEditId === item.id ? (
                      <input
                        autoFocus
                        className="w-16 bg-gray-700 text-gray-100 text-[10px] font-mono rounded px-1.5 py-0.5 border border-brand-500/60 outline-none"
                        placeholder="mm:ss"
                        value={timerEditVal}
                        onChange={(e) => setTimerEditVal(e.target.value)}
                        onBlur={() => commitTimer(item.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter') commitTimer(item.id); if (e.key === 'Escape') setTimerEditId(null) }}
                      />
                    ) : (
                      <button
                        onClick={() => !isLocked && openTimerEdit(item)}
                        disabled={isLocked}
                        title={item.maxDuration ? `Timer: avança após ${Math.floor(item.maxDuration/60)}:${String(item.maxDuration%60).padStart(2,'0')}` : 'Definir timer de avanço'}
                        className={clsx(
                          'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors',
                          isLocked
                            ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                            : item.maxDuration
                              ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40'
                              : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                        )}
                      >
                        <Timer className="h-3 w-3" />
                        {item.maxDuration
                          ? `${Math.floor(item.maxDuration/60)}:${String(item.maxDuration%60).padStart(2,'0')}`
                          : 'Timer'}
                      </button>
                    )
                  )}

                  {/* Loop */}
                  <button
                    onClick={() => !isLocked && toggleLoop.mutate(item)}
                    disabled={isLocked}
                    title={isLocked ? 'Playlist bloqueada' : item.loop ? 'Desativar loop' : 'Ativar loop'}
                    className={clsx(
                      'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors',
                      isLocked
                        ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                        : item.loop
                          ? 'bg-brand-500/20 text-brand-300 ring-1 ring-brand-500/40'
                          : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                    )}
                  >
                    <Repeat2 className="h-3 w-3" />
                    {item.loop ? 'Loop ON' : 'Loop'}
                  </button>

                  {/* Upload — só aparece para clipes FILE sem arquivo */}
                  {(clip as any).sourceType !== 'URL' && !media && (
                    <Button
                      size="sm" variant="ghost"
                      loading={uploadingClipId === clip.id}
                      disabled={uploadingClipId !== null && uploadingClipId !== clip.id}
                      icon={<Upload className="h-3.5 w-3.5 text-orange-400" />}
                      onClick={() => startUpload(clip.id)}
                      title={uploadingClipId === clip.id ? `${uploadProgress}%` : 'Enviar arquivo de mídia'}
                    />
                  )}

                  {/* Remover */}
                  <Button
                    size="sm" variant="ghost"
                    disabled={isLocked}
                    icon={<Trash2 className={clsx('h-3.5 w-3.5', isLocked ? 'text-gray-600' : 'text-red-500')} />}
                    onClick={() => removeItem.mutate(item.id)}
                  />
                </div>
              )
            })}
          </div>
          </>
        )}
      </div>

      {/* Modal: adicionar clipe */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Adicionar Clipe" size="lg">
        <div className="space-y-3">
          <Input
            placeholder="Buscar por título ou código..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            icon={<Search className="h-4 w-4" />}
            autoFocus
          />
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {clipsData?.items.map((clip) => {
              const type = (clip as any).type
              return (
                <button
                  key={clip.id}
                  onClick={() => addItem.mutate(clip)}
                  disabled={addItem.isPending}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/5 text-left transition-colors"
                >
                  {type && (
                    <Badge bg={type.fontBackColor} color={type.fontColor} className="text-[10px] shrink-0">
                      {type.code}
                    </Badge>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{clip.title}</p>
                    <p className="text-[11px] text-gray-500">
                      {clip.code} · {MODALITY_LABELS[clip.modality]}
                      {clip.client && ` · ${clip.client.name}`}
                    </p>
                  </div>
                  <span className="text-xs font-mono text-gray-500 shrink-0">
                    {formatDur(clip.media?.duration ?? clip.duration ?? undefined)}
                  </span>
                </button>
              )
            })}
            {clipsData?.items.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-6">Nenhum clipe encontrado.</p>
            )}
          </div>
        </div>
      </Modal>
    </div>
  )
}
