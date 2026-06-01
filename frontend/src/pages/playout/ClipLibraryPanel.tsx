import { useRef, useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Library, Loader2, Plus, Search, Trash2, Copy, Play, ListPlus,
  Pencil, Upload, Film, Link, HardDrive, Scissors, CheckCircle2,
  Clock, XCircle, ChevronUp, ChevronDown,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import { clipsApi, type Clip, type OrphanMedia, MODALITY_LABELS, type ClipModality, type ClipSourceType } from '../../api/clips.api'
import { clipTypesApi } from '../../api/clip-types.api'
import { clientsApi, type Client } from '../../api/clients.api'
import { graphicsApi } from '../../api/graphics.api'
import { playoutApi } from '../../api/playout.api'
import { playlistsApi } from '../../api/playlists.api'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { VideoPlayer } from '../../components/ui/VideoPlayer'
import { GraphicOverlay } from '../../components/ui/GraphicOverlay'
import type { Channel } from '../../api/channels.api'
import { usePlayoutSelection } from '../../stores/playoutSelection.store'

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTime(sec: number) {
  const abs = Math.floor(sec)
  const m = Math.floor(abs / 60)
  const s = abs % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatDur(sec?: number) {
  if (!sec) return '—'
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60)
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`
}

function fmtTimecode(sec: number) {
  const m = Math.floor(sec / 60)
  const s = (sec % 60).toFixed(3)
  return `${String(m).padStart(2,'0')}:${s.padStart(6,'0')}`
}

function hlsStreamUrl(hlsPath: string) {
  const mediaId = hlsPath.split('/')[1]
  return `/api/media/stream/${mediaId}/index.m3u8`
}

function embedUrl(sourceUrl: string): string | null {
  try {
    const u = new URL(sourceUrl)
    const ytMatch = sourceUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)
    if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1`
    if (u.hostname.includes('youtube.com') && !ytMatch)
      return `https://www.youtube.com/embed/live_stream?channel=${u.pathname.split('/').pop()}&autoplay=1`
    const twMatch = sourceUrl.match(/twitch\.tv\/([A-Za-z0-9_]+)/)
    if (twMatch) return `https://player.twitch.tv/?channel=${twMatch[1]}&parent=${window.location.hostname}&autoplay=true`
  } catch {}
  return null
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

function IngestBadge({ status, sourceType }: { status: string; sourceType?: string }) {
  if (sourceType === 'URL') return <span className="flex items-center gap-1 text-sky-400 text-xs"><Link className="h-3.5 w-3.5" />URL</span>
  if (status === 'READY') return <span className="flex items-center gap-1 text-emerald-400 text-xs"><CheckCircle2 className="h-3.5 w-3.5" />Pronto</span>
  if (status === 'PROCESSING') return <span className="flex items-center gap-1 text-amber-400 text-xs animate-pulse"><Clock className="h-3.5 w-3.5 animate-spin" />Transcodificando</span>
  if (status === 'ERROR') return <span className="flex items-center gap-1 text-red-400 text-xs"><XCircle className="h-3.5 w-3.5" />Erro</span>
  return <span className="text-gray-500 text-xs">Sem mídia</span>
}

// ─── Form state ──────────────────────────────────────────────────────────────

const emptyForm = {
  code: '', title: '', modality: 'CP' as ClipModality,
  sourceType: 'FILE' as ClipSourceType, sourceUrl: '',
  cueIn: '0', cueOut: '', clientId: '', typeId: '', notes: '', graphicId: '',
}
type FormErrors = { code?: string; title?: string; sourceUrl?: string }

// ─── Componente ─────────────────────────────────────────────────────────────

interface ClipLibraryPanelProps { channels: Channel[] }

export default function ClipLibraryPanel({ channels }: ClipLibraryPanelProps) {
  const qc = useQueryClient()
  const location = useLocation()

  // ── Estado do painel ──────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [typeId, setTypeId] = useState('')
  const [modalityFilter, setModalityFilter] = useState('')
  const [targetChannelId, setTargetChannelId] = useState(channels[0]?.id ?? '')
  const [selectedRoteiroId, setSelectedRoteiroId] = useState<string | null>(null)
  const [insertModal, setInsertModal] = useState<{ sourceId: string; name: string } | null>(null)
  const [roteiroSort,    setRoteiroSort]    = useState<'name' | 'date' | 'items'>('date')
  const [roteiroSortDir, setRoteiroSortDir] = useState<'asc' | 'desc'>('desc')
  const [sortBy,  setSortBy]  = useState('title')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)
  const [selectedLibraryClip, setSelectedLibraryClip] = useState<any | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Estado CRUD ──────────────────────────────────────────────────────────
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Clip | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [formErrors, setFormErrors] = useState<FormErrors>({})
  const [codeAutoGenerated, setCodeAutoGenerated] = useState(false)
  const [playerTime, setPlayerTime] = useState(0)
  const [selectedOrphanId, setSelectedOrphanId] = useState<string | null>(null)
  const [previewClip, setPreviewClip] = useState<Clip | null>(null)
  const [urlPreviewClip, setUrlPreviewClip] = useState<Clip | null>(null)
  const [urlCheckLoading, setUrlCheckLoading] = useState(false)
  const [urlCheckResult, setUrlCheckResult] = useState<{ isLive: boolean | null; title?: string; duration?: number } | null>(null)
  const [uploadingClipId, setUploadingClipId] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadDirectLoading, setUploadDirectLoading] = useState(false)
  const [uploadDirectProgress, setUploadDirectProgress] = useState(0)
  const [uploadDirectCount, setUploadDirectCount] = useState({ done: 0, total: 0 })
  const [modalUploadLoading, setModalUploadLoading] = useState(false)
  const [modalUploadProgress, setModalUploadProgress] = useState(0)
  const fileRef      = useRef<HTMLInputElement>(null)
  const fileRefDirect = useRef<HTMLInputElement>(null)
  const fileRefModal  = useRef<HTMLInputElement>(null)
  const uploadClipIdRef = useRef<string | null>(null)

  // ── Debounce busca ────────────────────────────────────────────────────────
  function handleSearchChange(v: string) {
    setSearch(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setDebouncedSearch(v); setPage(1) }, 400)
  }

  function toggleSort(col: string) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('asc') }
    setPage(1)
  }

  function si(col: string) {
    if (sortBy !== col) return null
    return sortDir === 'asc'
      ? <ChevronUp className="h-2.5 w-2.5 inline ml-0.5" />
      : <ChevronDown className="h-2.5 w-2.5 inline ml-0.5" />
  }

  function toggleRoteiroSort(col: 'name' | 'date' | 'items') {
    if (roteiroSort === col) setRoteiroSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setRoteiroSort(col); setRoteiroSortDir(col === 'date' ? 'desc' : 'asc') }
  }

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: playoutState } = useQuery({
    queryKey: ['playout-state', targetChannelId],
    queryFn: () => playoutApi.getState(targetChannelId),
    refetchInterval: 5000, enabled: !!targetChannelId,
  })
  const activePlaylistId = playoutState?.playlistId ?? null
  const hasActivePlaylist = !!activePlaylistId
  const playoutStatus = (playoutState as any)?.status ?? 'IDLE'

  const { data: allPlaylists = [] } = useQuery({
    queryKey: ['playlists-panel', targetChannelId],
    queryFn: () => playlistsApi.list({ channelId: targetChannelId, excludeAutoSave: false }),
    enabled: !!targetChannelId, staleTime: 10_000,
  })
  const roteiros = allPlaylists.filter((pl) => !pl.isAutoSave)
  const autoSavePlaylist = allPlaylists.find((pl) => pl.isAutoSave) ?? null

  const { data: activeItems = [] } = useQuery({
    queryKey: ['playout-items', targetChannelId],
    queryFn: () => playoutApi.getItems(targetChannelId),
    enabled: !!targetChannelId && hasActivePlaylist, staleTime: 5_000,
  })
  const activeClipCounts = activeItems
    .filter((i) => !i.isBreak && i.clipId)
    .reduce((acc, i) => { acc.set(i.clipId!, (acc.get(i.clipId!) ?? 0) + 1); return acc }, new Map<string, number>())

  const { data: allTypes = [] } = useQuery({ queryKey: ['clip-types'], queryFn: clipTypesApi.list, staleTime: 60_000 })
  const { data: clients = [] }  = useQuery<Client[]>({ queryKey: ['clients'],    queryFn: () => clientsApi.list(),   staleTime: 60_000 })
  const { data: graphics = [] } = useQuery({ queryKey: ['graphics'],   queryFn: graphicsApi.list,  staleTime: 60_000 })

  const { data, isFetching } = useQuery({
    queryKey: ['clips-library', debouncedSearch, typeId, modalityFilter, page, sortBy, sortDir],
    queryFn: () => clipsApi.list({
      search: debouncedSearch || undefined,
      typeId: typeId || undefined,
      modality: modalityFilter || undefined,
      page, sortBy, sortDir,
    }),
    staleTime: 10_000,
    refetchInterval: (q) => q.state.data?.items.some((c) => c.media?.ingestStatus === 'PROCESSING') ? 3000 : false,
  })
  const clips = data?.items ?? []

  const { data: orphanMedia = [], refetch: refetchOrphan } = useQuery({
    queryKey: ['orphan-media'], queryFn: clipsApi.listOrphanMedia, enabled: open,
  })

  const activeTypes = allTypes.filter((t) => clips.some((c) => c.typeId === t.id))
  const typeMap = Object.fromEntries(allTypes.map((t) => [t.id, t]))

  // ── Handle editClipId via location.state ─────────────────────────────────
  useEffect(() => {
    const editClipId = (location.state as any)?.editClipId
    if (!editClipId) return
    clipsApi.get(editClipId)
      .then(c => openEdit(c))
      .catch(() => toast.error('Clipe não encontrado'))
    window.history.replaceState({}, '')
  }, [location.state]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mutations playout ────────────────────────────────────────────────────
  const { selectedByChannel, clearSelected } = usePlayoutSelection()
  const selectedItemId = selectedByChannel[targetChannelId] ?? null

  const insertBreakMut = useMutation({
    mutationFn: () => playoutApi.insertBreak(targetChannelId, selectedItemId),
    onSuccess: () => { toast.success('BREAK inserido'); qc.invalidateQueries({ queryKey: ['playout-items', targetChannelId] }); qc.invalidateQueries({ queryKey: ['playout-state', targetChannelId] }); clearSelected(targetChannelId) },
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
    onSuccess: (playlist) => { toast.success(`Roteiro "${playlist.name}" criado`); qc.invalidateQueries({ queryKey: ['playlists-panel', targetChannelId] }) },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao criar roteiro'),
  })

  const playRotMut = useMutation({
    mutationFn: (playlistId: string) => playoutApi.play(targetChannelId, playlistId),
    onSuccess: () => { toast.success('Roteiro iniciado'); qc.invalidateQueries({ queryKey: ['playout-state', targetChannelId] }); qc.invalidateQueries({ queryKey: ['playout-items', targetChannelId] }); qc.invalidateQueries({ queryKey: ['playlists-panel', targetChannelId] }); setInsertModal(null) },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao iniciar roteiro'),
  })

  const appendFromMut = useMutation({
    mutationFn: ({ targetId, sourceId }: { targetId: string; sourceId: string }) => playlistsApi.appendFrom(targetId, sourceId),
    onSuccess: () => { toast.success('Itens inseridos no roteiro'); qc.invalidateQueries({ queryKey: ['playout-items', targetChannelId] }); qc.invalidateQueries({ queryKey: ['playlists-panel', targetChannelId] }); setInsertModal(null) },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao inserir roteiro'),
  })

  const cloneRotMut = useMutation({
    mutationFn: (id: string) => playlistsApi.clone(id),
    onSuccess: () => { toast.success('Cópia criada'); qc.invalidateQueries({ queryKey: ['playlists-panel', targetChannelId] }) },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao clonar'),
  })

  const deleteRotMut = useMutation({
    mutationFn: (id: string) => playlistsApi.delete(id),
    onSuccess: () => { toast.success('Roteiro excluído'); qc.invalidateQueries({ queryKey: ['playlists-panel', targetChannelId] }) },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao excluir'),
  })

  function handleInsertClick(clipId: string) {
    if (!targetChannelId) return
    insertMut.mutate({ channelId: targetChannelId, clipId })
  }

  function handleInsertRoteiro(sourceId: string, name: string) {
    if (!hasActivePlaylist || (playoutStatus !== 'PLAYING' && playoutStatus !== 'PAUSED')) {
      playRotMut.mutate(sourceId)
    } else {
      setInsertModal({ sourceId, name })
    }
  }

  // ── Mutations CRUD clipes ─────────────────────────────────────────────────
  const save = useMutation({
    mutationFn: () => {
      const isUrl = form.sourceType === 'URL'
      const payload = {
        ...form,
        sourceType: form.sourceType,
        sourceUrl:  isUrl ? (form.sourceUrl || null) : null,
        cueIn:    parseFloat(form.cueIn) || 0,
        cueOut:   form.cueOut   ? parseFloat(form.cueOut)   : undefined,
        clientId:  form.clientId  || null,
        typeId:    form.typeId    || null,
        graphicId: form.graphicId || null,
        mediaId:  isUrl ? null : (selectedOrphanId ?? undefined),
        notes:    form.notes    || undefined,
      }
      return editing ? clipsApi.update(editing.id, payload) : clipsApi.create(payload)
    },
    onSuccess: () => {
      toast.success(editing ? 'Clipe atualizado' : 'Clipe criado')
      qc.invalidateQueries({ queryKey: ['clips-library'] })
      qc.invalidateQueries({ queryKey: ['clips'] })
      setOpen(false)
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao salvar'),
  })

  const remove = useMutation({
    mutationFn: clipsApi.delete,
    onSuccess: () => { toast.success('Clipe desativado'); qc.invalidateQueries({ queryKey: ['clips-library'] }); qc.invalidateQueries({ queryKey: ['clips'] }) },
  })

  function f(k: keyof typeof emptyForm) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(v => ({ ...v, [k]: e.target.value }))
  }

  function handleSave() {
    const errors: FormErrors = {}
    if (!form.code.trim()) errors.code = 'Código é obrigatório'
    if (!form.title.trim()) errors.title = 'Título é obrigatório'
    if (form.sourceType === 'URL' && form.sourceUrl && !/^(https?|srt|rtmps?|rtsp):\/\/.+/i.test(form.sourceUrl))
      errors.sourceUrl = 'URL inválida (use https://, srt://, rtmp:// ou rtsp://)'
    if (Object.keys(errors).length > 0) { setFormErrors(errors); return }
    setFormErrors({})
    save.mutate()
  }

  async function handleTypeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const tid = e.target.value
    setForm(v => ({ ...v, typeId: tid }))
    if (tid && (form.code === '' || codeAutoGenerated)) {
      const selectedType = allTypes.find((t) => t.id === tid)
      if (selectedType?.code) {
        try { const r = await clipsApi.nextCode(selectedType.code); setForm(v => ({ ...v, typeId: tid, code: r.code })); setCodeAutoGenerated(true) }
        catch {}
      }
    }
  }

  function openNew() {
    setEditing(null); setForm(emptyForm); setFormErrors({}); setCodeAutoGenerated(false)
    setSelectedOrphanId(null); setUrlCheckResult(null); setOpen(true)
  }
  function openEdit(c: Clip) {
    setEditing(c)
    setForm({ code: c.code, title: c.title, modality: c.modality, sourceType: c.sourceType ?? 'FILE', sourceUrl: c.sourceUrl ?? '', cueIn: String(c.cueIn), cueOut: c.cueOut ? String(c.cueOut) : '', clientId: c.clientId ?? '', typeId: c.typeId ?? '', notes: c.notes ?? '', graphicId: (c as any).graphicId ?? '' })
    setFormErrors({}); setCodeAutoGenerated(false); setSelectedOrphanId(null); setUrlCheckResult(null); setOpen(true)
  }

  // ── Uploads ───────────────────────────────────────────────────────────────
  async function handleDirectUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setUploadDirectLoading(true); setUploadDirectCount({ done: 0, total: files.length }); setUploadDirectProgress(0)
    let errors = 0
    for (let i = 0; i < files.length; i++) {
      try { await clipsApi.uploadMediaDirect(files[i], setUploadDirectProgress); setUploadDirectCount({ done: i + 1, total: files.length }) }
      catch { errors++ }
    }
    errors === 0 ? toast.success(`${files.length} arquivo(s) enviado(s). Transcodificação em andamento.`) : toast.error(`${errors} arquivo(s) falharam.`)
    refetchOrphan(); setUploadDirectLoading(false); setUploadDirectCount({ done: 0, total: 0 })
    if (fileRefDirect.current) fileRefDirect.current.value = ''
  }

  async function handleModalUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setModalUploadLoading(true); setModalUploadProgress(0)
    let lastId: string | null = null; let errors = 0
    for (const file of files) {
      try { const r = await clipsApi.uploadMediaDirect(file, setModalUploadProgress); lastId = r.mediaId }
      catch { errors++ }
    }
    errors === 0 ? toast.success(`${files.length} arquivo(s) em transcodificação.`) : toast.error(`${errors} arquivo(s) falharam.`)
    await refetchOrphan()
    if (lastId) setSelectedOrphanId(lastId)
    setModalUploadLoading(false)
    if (fileRefModal.current) fileRefModal.current.value = ''
  }

  function startUpload(clipId: string) { uploadClipIdRef.current = clipId; fileRef.current?.click() }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; const clipId = uploadClipIdRef.current
    if (!file || !clipId) return
    setUploadingClipId(clipId); setUploadProgress(0)
    try { await clipsApi.uploadMedia(file, clipId, setUploadProgress); toast.success('Upload concluído.'); qc.invalidateQueries({ queryKey: ['clips-library'] }); qc.invalidateQueries({ queryKey: ['clips'] }) }
    catch { toast.error('Erro no upload') }
    finally { setUploadingClipId(null); uploadClipIdRef.current = null; if (fileRef.current) fileRef.current.value = '' }
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Inputs ocultos */}
      <input ref={fileRef}       type="file" accept="video/*,image/*,.mxf,.mts,.m2ts" className="hidden" onChange={handleFileUpload} />
      <input ref={fileRefDirect} type="file" accept="video/*,image/*,.mxf,.mts,.m2ts" multiple className="hidden" onChange={handleDirectUpload} />

      {/* ── Cabeçalho único: label + botões fixos + contexto do clipe selecionado ── */}
      <div className="px-3 py-2 flex items-center gap-1.5 border-b border-gray-800 flex-shrink-0 min-h-0">
        {/* Esquerda: label + Upload + Novo */}
        <Library className="h-3.5 w-3.5 text-gray-500 flex-shrink-0" />
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide flex-shrink-0">Mídias</span>
        <Button size="sm" variant="secondary" loading={uploadDirectLoading}
          onClick={() => fileRefDirect.current?.click()}
          icon={<Film className="h-3 w-3 text-purple-400" />}
          title="Upload em lote"
        >
          {uploadDirectLoading ? `${uploadDirectCount.done}/${uploadDirectCount.total}` : 'Upload'}
        </Button>
        <Button size="sm" onClick={openNew} icon={<Plus className="h-3 w-3" />}>Novo</Button>

        {/* Direita: contexto do clipe selecionado */}
        {selectedLibraryClip ? (
          <>
            <div className="w-px h-4 bg-gray-700 flex-shrink-0 mx-0.5" />
            <span className="text-[9px] text-brand-400 font-mono font-bold truncate flex-1 min-w-0" title={selectedLibraryClip.title}>
              {selectedLibraryClip.code}
            </span>
            {selectedLibraryClip.media?.hlsPath && selectedLibraryClip.media?.ingestStatus === 'READY' && (
              <button onClick={() => setPreviewClip(selectedLibraryClip)} title="Preview"
                className="p-1 rounded text-gray-500 hover:text-emerald-400 transition-colors flex-shrink-0">
                <Play className="h-3.5 w-3.5" />
              </button>
            )}
            {selectedLibraryClip.sourceType === 'URL' && selectedLibraryClip.sourceUrl && (
              <button onClick={() => setUrlPreviewClip(selectedLibraryClip)} title="Preview URL"
                className="p-1 rounded text-gray-500 hover:text-sky-400 transition-colors flex-shrink-0">
                <Link className="h-3.5 w-3.5" />
              </button>
            )}
            {selectedLibraryClip.sourceType !== 'URL' && (
              <button onClick={() => { if (selectedLibraryClip.media?.ingestStatus === 'READY' && !window.confirm('Substituir arquivo?')) return; startUpload(selectedLibraryClip.id) }}
                disabled={uploadingClipId !== null && uploadingClipId !== selectedLibraryClip.id}
                title={selectedLibraryClip.media?.ingestStatus === 'READY' ? 'Substituir mídia' : 'Enviar mídia'}
                className="p-1 rounded text-gray-500 hover:text-blue-400 transition-colors flex-shrink-0 disabled:opacity-30">
                {uploadingClipId === selectedLibraryClip.id
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
                  : <Upload className={`h-3.5 w-3.5 ${selectedLibraryClip.media?.ingestStatus === 'READY' ? 'text-amber-400' : ''}`} />}
              </button>
            )}
            <button onClick={() => openEdit(selectedLibraryClip)} title="Editar"
              className="p-1 rounded text-gray-500 hover:text-brand-400 transition-colors flex-shrink-0">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => { remove.mutate(selectedLibraryClip.id); setSelectedLibraryClip(null) }} title="Excluir"
              className="p-1 rounded text-gray-500 hover:text-red-400 transition-colors flex-shrink-0">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => setSelectedLibraryClip(null)} title="Desfazer seleção"
              className="p-1 rounded text-gray-600 hover:text-gray-400 transition-colors flex-shrink-0">
              <span className="text-[9px]">✕</span>
            </button>
          </>
        ) : (
          <span className="flex-1" />
        )}
      </div>

      {/* ── Seletor de canal ─────────────────────────────────────────────── */}
      {channels.length > 1 && (
        <div className="px-3 py-1.5 border-b border-gray-800 flex-shrink-0">
          <select
            value={targetChannelId}
            onChange={(e) => setTargetChannelId(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 px-2 py-1 focus:outline-none focus:border-brand-500"
          >
            {channels.map((ch) => <option key={ch.id} value={ch.id}>Canal {ch.number} — {ch.name}</option>)}
          </select>
        </div>
      )}

      {/* ── Barra de upload ───────────────────────────────────────────────── */}
      {uploadingClipId && (
        <div className="px-3 py-1.5 flex items-center gap-2 bg-gray-800/50 flex-shrink-0">
          <Upload className="h-3 w-3 text-blue-400 flex-shrink-0" />
          <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
          </div>
          <span className="text-[10px] text-gray-400 flex-shrink-0">{uploadProgress}%</span>
        </div>
      )}

      {/* ── Roteiros ─────────────────────────────────────────────────────── */}
      <div className="border-b border-gray-800/60 flex-shrink-0">
        {roteiros.length > 1 && (
          <div className="flex items-center gap-0 px-3 py-1 border-b border-gray-800/40 bg-gray-900/40">
            {(['name', 'date', 'items'] as const).map((col) => {
              const labels = { name: 'Nome', date: 'Data', items: 'Itens' }
              const active = roteiroSort === col
              return (
                <button key={col} onClick={() => toggleRoteiroSort(col)}
                  className={clsx('text-[9px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded transition-colors',
                    active ? 'text-brand-300 bg-brand-900/30' : 'text-gray-600 hover:text-gray-400')}>
                  {labels[col]}{active ? (roteiroSortDir === 'asc' ? ' ▲' : ' ▼') : ' ↕'}
                </button>
              )
            })}
          </div>
        )}
        <div className="max-h-40 overflow-y-auto">
          {roteiros.length === 0 && !autoSavePlaylist ? (
            <div className="flex items-center gap-2 px-3 py-1.5">
              <span className="h-1.5 w-1.5 flex-shrink-0" />
              <p className="flex-1 min-w-0 text-[11px] text-gray-600 italic truncate">Não há roteiros disponíveis, crie um novo...</p>
              <button onClick={() => newPlaylistMut.mutate()} disabled={newPlaylistMut.isPending}
                title="Criar novo roteiro" className="p-1 rounded text-gray-600 hover:text-brand-400 disabled:opacity-40 transition-colors">
                {newPlaylistMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              </button>
            </div>
          ) : (
            <>
              {autoSavePlaylist && (
                <div
                  className={clsx('flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none border-b border-amber-900/30',
                    autoSavePlaylist.id === activePlaylistId ? 'bg-amber-900/20' : 'bg-amber-950/10 hover:bg-amber-900/15')}
                  onClick={() => setSelectedRoteiroId(autoSavePlaylist.id === selectedRoteiroId ? null : autoSavePlaylist.id)}
                  onDoubleClick={() => handleInsertRoteiro(autoSavePlaylist.id, 'Roteiro de trabalho')}
                >
                  <span className={clsx('h-1.5 w-1.5 rounded-full flex-shrink-0', autoSavePlaylist.id === activePlaylistId ? 'bg-amber-400' : 'bg-amber-700')} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold text-amber-400 truncate leading-tight">Roteiro de trabalho</p>
                    <p className="text-[10px] text-amber-700 leading-tight">{autoSavePlaylist._count?.items ?? 0} itens · não salvo</p>
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button onClick={(e) => { e.stopPropagation(); playRotMut.mutate(autoSavePlaylist.id) }} disabled={playRotMut.isPending} title="Iniciar" className="p-1 rounded text-amber-700 hover:text-amber-400 disabled:opacity-30 transition-colors"><Play className="h-3 w-3" /></button>
                    <button onClick={(e) => { e.stopPropagation(); cloneRotMut.mutate(autoSavePlaylist.id) }} disabled={cloneRotMut.isPending} title="Salvar cópia" className="p-1 rounded text-amber-700 hover:text-amber-400 disabled:opacity-30 transition-colors"><Copy className="h-3 w-3" /></button>
                    <button onClick={(e) => { e.stopPropagation(); if (!confirm('Limpar roteiro de trabalho?')) return; deleteRotMut.mutate(autoSavePlaylist.id) }} disabled={deleteRotMut.isPending} title="Limpar" className="p-1 rounded text-amber-700 hover:text-red-400 disabled:opacity-20 transition-colors"><Trash2 className="h-3 w-3" /></button>
                  </div>
                </div>
              )}

              {[...roteiros].sort((a, b) => {
                let av: any, bv: any
                if (roteiroSort === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase() }
                else if (roteiroSort === 'date') { av = a.date; bv = b.date }
                else { av = a._count?.items ?? 0; bv = b._count?.items ?? 0 }
                if (av < bv) return roteiroSortDir === 'asc' ? -1 : 1
                if (av > bv) return roteiroSortDir === 'asc' ? 1 : -1
                return 0
              }).map((pl) => {
                const isCurrent = pl.id === activePlaylistId
                const isLocked = isCurrent && (playoutStatus === 'PLAYING' || playoutStatus === 'PAUSED')
                return (
                  <div key={pl.id}
                    onClick={() => setSelectedRoteiroId(pl.id === selectedRoteiroId ? null : pl.id)}
                    onDoubleClick={() => handleInsertRoteiro(pl.id, pl.name)}
                    className={clsx('flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none',
                      isCurrent ? 'bg-emerald-900/15' : 'hover:bg-gray-800/30',
                      selectedRoteiroId === pl.id && !isCurrent ? 'ring-1 ring-inset ring-cyan-500/40 bg-cyan-900/10' : '')}
                  >
                    <span className={clsx('h-1.5 w-1.5 rounded-full flex-shrink-0', isCurrent ? 'bg-emerald-400' : 'bg-gray-700')} />
                    <div className="flex-1 min-w-0">
                      <p className={clsx('text-[11px] font-medium truncate leading-tight', isCurrent ? 'text-white' : 'text-gray-300')}>{pl.name}</p>
                      <p className="text-[10px] text-gray-600 leading-tight">{new Date(pl.date).toLocaleDateString('pt-BR')} · {pl._count?.items ?? 0} itens</p>
                    </div>
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      <button onClick={(e) => { e.stopPropagation(); playRotMut.mutate(pl.id) }} disabled={playRotMut.isPending} title="Usar este roteiro" className="p-1 rounded text-gray-600 hover:text-brand-400 disabled:opacity-30 transition-colors"><Play className="h-3 w-3" /></button>
                      <button onClick={(e) => { e.stopPropagation(); handleInsertRoteiro(pl.id, pl.name) }} disabled={appendFromMut.isPending || playRotMut.isPending} className="p-1 rounded text-gray-600 hover:text-emerald-400 disabled:opacity-30 transition-colors"><ListPlus className="h-3 w-3" /></button>
                      <button onClick={(e) => { e.stopPropagation(); cloneRotMut.mutate(pl.id) }} disabled={cloneRotMut.isPending} title="Clonar" className="p-1 rounded text-gray-600 hover:text-sky-400 disabled:opacity-30 transition-colors"><Copy className="h-3 w-3" /></button>
                      <button onClick={(e) => { e.stopPropagation(); if (!confirm(`Excluir "${pl.name}"?`)) return; deleteRotMut.mutate(pl.id) }} disabled={isLocked || deleteRotMut.isPending} title={isLocked ? 'Em uso' : 'Excluir'} className="p-1 rounded text-gray-600 hover:text-red-400 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"><Trash2 className="h-3 w-3" /></button>
                    </div>
                  </div>
                )
              })}

              <div className="flex items-center gap-2 px-3 py-1.5 border-t border-gray-800/30 hover:bg-gray-800/20 transition-colors">
                <span className="h-1.5 w-1.5 flex-shrink-0" />
                <p className="flex-1 text-[11px] text-gray-600">Criar novo roteiro</p>
                <button onClick={() => newPlaylistMut.mutate()} disabled={newPlaylistMut.isPending} className="p-1 rounded text-gray-600 hover:text-brand-400 disabled:opacity-40 transition-colors">
                  {newPlaylistMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Busca + filtros ───────────────────────────────────────────────── */}
      <div className="px-3 pt-2 flex-shrink-0 space-y-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500 pointer-events-none" />
          <input value={search} onChange={(e) => handleSearchChange(e.target.value)} placeholder="Buscar clipe..."
            className="w-full bg-gray-800 border border-gray-700 rounded pl-7 pr-3 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-brand-500" />
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          {/* Filtros por tipo */}
          <button onClick={() => setTypeId('')}
            className={clsx('text-[10px] px-2 py-0.5 rounded transition-colors', !typeId ? 'bg-brand-600/30 text-brand-300 ring-1 ring-brand-500/30' : 'bg-gray-800 text-gray-500 hover:bg-gray-700')}>
            Todos
          </button>
          {allTypes.map((t) => (
            <button key={t.id} onClick={() => setTypeId(t.id === typeId ? '' : t.id)}
              className={clsx('text-[10px] px-2 py-0.5 rounded transition-colors', typeId === t.id ? 'ring-1 ring-white/20' : 'bg-gray-800 text-gray-500 hover:bg-gray-700')}
              style={typeId === t.id ? { backgroundColor: t.fontBackColor + '44', color: t.fontColor } : {}}>
              {t.code}
            </button>
          ))}

          {/* Botão BREAK */}
          <button onClick={() => insertBreakMut.mutate()} disabled={!hasActivePlaylist || insertBreakMut.isPending}
            title="Inserir BREAK" className="ml-auto flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded bg-black border-2 border-yellow-400 text-yellow-400 text-[10px] font-black hover:bg-yellow-400 hover:text-black disabled:opacity-30 disabled:cursor-not-allowed transition-all">
            {insertBreakMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : '⏸'} BREAK
          </button>
        </div>
      </div>

      {/* ── Cabeçalho colunas ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 px-3 py-1 border-y border-gray-800 bg-gray-900/90 sticky top-0 z-10 flex-shrink-0">
        <span className="text-[9px] font-bold text-gray-600 uppercase tracking-wide w-8 flex-shrink-0">Tipo</span>
        <button onClick={() => toggleSort('code')} className="text-[9px] font-bold text-gray-600 uppercase w-14 flex-shrink-0 text-left hover:text-gray-400 cursor-pointer">
          Cód{si('code')}
        </button>
        <button onClick={() => toggleSort('title')} className="text-[9px] font-bold text-gray-600 uppercase flex-1 min-w-0 text-left hover:text-gray-400 cursor-pointer">
          Título{si('title')}
        </button>
        <span className="text-[9px] font-bold text-emerald-700 uppercase w-4 text-center flex-shrink-0">✓</span>
        <button onClick={() => toggleSort('media')} className="text-[9px] font-bold text-gray-600 uppercase w-9 text-center flex-shrink-0 hover:text-gray-400 cursor-pointer">
          Mídia{si('media')}
        </button>
        <button onClick={() => toggleSort('duration')} className="text-[9px] font-bold text-gray-600 uppercase w-9 text-right flex-shrink-0 hover:text-gray-400 cursor-pointer">
          Dur{si('duration')}
        </button>
        <span className="w-6 flex-shrink-0" />
      </div>

      {/* ── Lista de clipes ───────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-gray-800/50">
        {clips.length === 0 ? (
          <p className="text-[11px] text-gray-600 text-center py-5">{isFetching ? 'Buscando...' : 'Nenhum clipe encontrado'}</p>
        ) : (
          clips.map((clip) => {
            const isPending = insertMut.isPending && (insertMut.variables as any)?.clipId === clip.id && (insertMut.variables as any)?.channelId === targetChannelId
            const mt = getClipMediaType(clip)
            const mtStyle = CLIP_MEDIA_STYLE[mt] ?? 'bg-gray-800 text-gray-500 border-gray-600/40'
            const inPlaylistCount = activeClipCounts.get(clip.id) ?? 0
            const t = clip.typeId ? typeMap[clip.typeId] : null
            return (
              <div key={clip.id}
                draggable
                onDragStart={(e) => { e.dataTransfer.setData('application/x-clip-id', clip.id); e.dataTransfer.effectAllowed = 'copy' }}
                onClick={() => setSelectedLibraryClip(selectedLibraryClip?.id === clip.id ? null : clip)}
                className={clsx(
                  'flex items-center gap-1 px-2 py-1.5 transition-colors cursor-pointer',
                  selectedLibraryClip?.id === clip.id
                    ? 'bg-brand-900/30 border-l-2 border-brand-500'
                    : inPlaylistCount > 0
                    ? 'bg-emerald-950/20 hover:bg-emerald-950/30 border-l-2 border-emerald-700/40'
                    : 'hover:bg-gray-800/30 border-l-2 border-transparent'
                )}>
                {/* Tipo badge */}
                {t ? <Badge bg={t.fontBackColor} color={t.fontColor} className="text-[8px] flex-shrink-0 w-8 text-center px-0.5">{t.code}</Badge>
                  : <span className="w-8 flex-shrink-0" />}

                {/* Código */}
                <span style={{ fontSize:9, fontFamily:'monospace', fontWeight:700, padding:'1px 4px', borderRadius:3, background:'#1e3a5f', color:'#93c5fd', border:'1px solid #2563eb', flexShrink:0, whiteSpace:'nowrap', width:56, overflow:'hidden', textOverflow:'ellipsis', display:'block' }}>
                  {clip.code}
                </span>

                {/* Título */}
                <p className="flex-1 min-w-0 text-xs text-gray-200 truncate leading-tight">{clip.title}</p>

                {/* Presença */}
                <span className="w-5 flex-shrink-0 text-center">
                  {inPlaylistCount > 0 && <span title={`×${inPlaylistCount}`} className="text-[9px] font-bold text-emerald-400">{inPlaylistCount === 1 ? '✓' : `×${inPlaylistCount}`}</span>}
                </span>

                {/* Mídia */}
                <span className={clsx('text-[8px] px-1 py-0.5 rounded border flex-shrink-0 font-mono font-medium w-9 text-center', mtStyle)}>{mt}</span>

                {/* Duração */}
                {clip.media?.duration != null
                  ? <span className="text-[9px] font-mono text-gray-600 flex-shrink-0 w-9 text-right">{formatTime(clip.media.duration)}</span>
                  : <span className="w-9 flex-shrink-0" />}

                {/* Apenas o botão inserir na linha */}
                <button
                  onClick={(e) => { e.stopPropagation(); handleInsertClick(clip.id) }}
                  disabled={isPending || !targetChannelId}
                  title="Inserir na playlist"
                  className="flex-shrink-0 p-1 rounded text-gray-600 hover:text-emerald-400 hover:bg-emerald-900/20 transition-colors disabled:opacity-40 w-6">
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin text-emerald-400" /> : <Plus className="h-4 w-4" />}
                </button>
              </div>
            )
          })
        )}
      </div>

      {/* ── Paginação ─────────────────────────────────────────────────────── */}
      {data && data.total > clips.length && (
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-gray-800/50 flex-shrink-0">
          <span className="text-[10px] text-gray-600">{(page-1)*(data.limit||20)+1}–{Math.min(page*(data.limit||20), data.total)} de {data.total}</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(p => p-1)} disabled={page === 1} className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-400 hover:bg-gray-700 disabled:opacity-30 transition-colors">‹</button>
            <button onClick={() => setPage(p => p+1)} disabled={page*(data.limit||20) >= data.total} className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-400 hover:bg-gray-700 disabled:opacity-30 transition-colors">›</button>
          </div>
        </div>
      )}

      {/* ── Modal CRUD Clipe ─────────────────────────────────────────────── */}
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Editar Clipe' : 'Novo Clipe'}
        size={editing?.media?.ingestStatus === 'READY' ? 'xl' : 'lg'}>
        <div className={editing?.media?.ingestStatus === 'READY' ? 'grid grid-cols-2 gap-6' : ''}>

          {/* Player — só quando tem mídia READY */}
          {editing?.media?.ingestStatus === 'READY' && editing.media.hlsPath && (
            <div className="space-y-3">
              <div className="relative w-full aspect-video">
                <VideoPlayer src={hlsStreamUrl(editing.media.hlsPath)} className="w-full h-full" onTimeUpdate={setPlayerTime} />
                {(() => { const g = form.graphicId ? graphics.find(gr => gr.id === form.graphicId) : null; return g ? <GraphicOverlay graphic={g} /> : null })()}
              </div>
              <div className="flex items-center justify-between px-0.5">
                <span className="font-mono text-sm text-brand-400">{fmtTimecode(playerTime)}</span>
                {editing.media.duration && <span className="font-mono text-xs text-gray-500">/ {fmtTimecode(editing.media.duration)}</span>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="secondary" icon={<Scissors className="h-3.5 w-3.5 text-cyan-400" />} onClick={() => setForm(v => ({ ...v, cueIn: playerTime.toFixed(3) }))}>Marcar Cue-In</Button>
                <Button size="sm" variant="secondary" icon={<Scissors className="h-3.5 w-3.5 text-amber-400" />} onClick={() => setForm(v => ({ ...v, cueOut: playerTime.toFixed(3) }))}>Marcar Cue-Out</Button>
              </div>
              {editing.media.duration && (
                <div className="space-y-1">
                  <div className="relative h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div className="absolute h-full bg-brand-500/25" style={{ left: `${((parseFloat(form.cueIn)||0)/editing.media.duration)*100}%`, width: `${(((parseFloat(form.cueOut)||editing.media.duration)-(parseFloat(form.cueIn)||0))/editing.media.duration)*100}%` }} />
                    <div className="absolute top-0 h-full w-0.5 bg-cyan-400" style={{ left: `${((parseFloat(form.cueIn)||0)/editing.media.duration)*100}%` }} />
                    {form.cueOut && <div className="absolute top-0 h-full w-0.5 bg-amber-400" style={{ left: `${(parseFloat(form.cueOut)/editing.media.duration)*100}%` }} />}
                    <div className="absolute top-0 h-full w-0.5 bg-white/50" style={{ left: `${(playerTime/editing.media.duration)*100}%` }} />
                  </div>
                  <div className="flex justify-between text-[10px] font-mono">
                    <span className="text-cyan-500">IN {fmtTimecode(parseFloat(form.cueIn)||0)}</span>
                    <span className="text-amber-500">OUT {fmtTimecode(parseFloat(form.cueOut)||editing.media.duration)}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Formulário */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input label="Código *" value={form.code} onChange={(e) => { setForm(v => ({ ...v, code: e.target.value })); setCodeAutoGenerated(false); if (formErrors.code) setFormErrors(v => ({ ...v, code: undefined })) }} placeholder="COM000001" error={formErrors.code} />
              <Select label="Tipo" value={form.typeId} onChange={handleTypeChange}>
                <option value="">Sem tipo</option>
                {allTypes.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
              </Select>
              <Input label="Título *" value={form.title} onChange={(e) => { setForm(v => ({ ...v, title: e.target.value })); if (formErrors.title) setFormErrors(v => ({ ...v, title: undefined })) }} placeholder="Nome do clipe" className="col-span-2" error={formErrors.title} />
              <Select label="Cliente" value={form.clientId} onChange={f('clientId')}>
                <option value="">Sem cliente</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              <Select label="Gráfico" value={form.graphicId} onChange={f('graphicId')}>
                <option value="">Nenhum</option>
                {graphics.filter(g => g.active).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </Select>

              <div className="col-span-2">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">Fonte de mídia</p>
                <div className="flex rounded-lg overflow-hidden border border-gray-700 w-fit">
                  <button type="button" onClick={() => setForm(v => ({ ...v, sourceType: 'FILE' }))}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${form.sourceType === 'FILE' ? 'bg-brand-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}>
                    <HardDrive className="h-3.5 w-3.5" />Arquivo
                  </button>
                  <button type="button" onClick={() => setForm(v => ({ ...v, sourceType: 'URL' }))}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${form.sourceType === 'URL' ? 'bg-brand-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}>
                    <Link className="h-3.5 w-3.5" />YouTube / Twitch
                  </button>
                </div>
              </div>

              {form.sourceType === 'URL' && (
                <div className="col-span-2 space-y-1">
                  <Input label="URL do vídeo *" value={form.sourceUrl}
                    onChange={(e) => { setForm(v => ({ ...v, sourceUrl: e.target.value })); setUrlCheckResult(null) }}
                    placeholder="https://youtube.com/... · srt://host:port · rtmp://..." error={formErrors.sourceUrl} icon={<Link className="h-4 w-4" />} />
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] text-gray-500">Use canais LIVE para evitar throttle.</p>
                    <Button size="sm" variant="secondary" loading={urlCheckLoading} disabled={!form.sourceUrl}
                      onClick={async () => { setUrlCheckLoading(true); setUrlCheckResult(null); try { setUrlCheckResult(await clipsApi.checkUrl(form.sourceUrl)) } catch { toast.error('Falha ao verificar') } finally { setUrlCheckLoading(false) } }}>
                      Verificar
                    </Button>
                  </div>
                  {urlCheckResult && (
                    <div className={`text-[11px] rounded px-2 py-1.5 ${urlCheckResult.isLive === true ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/40' : urlCheckResult.isLive === false ? 'bg-amber-900/40 text-amber-300 border border-amber-700/40' : 'bg-gray-800 text-gray-400 border border-gray-700'}`}>
                      {urlCheckResult.isLive === true && <>✓ <strong>Stream LIVE</strong>{urlCheckResult.title && ` — ${urlCheckResult.title}`}</>}
                      {urlCheckResult.isLive === false && <>⚠ <strong>VOD</strong>{urlCheckResult.title && ` — ${urlCheckResult.title}`}{urlCheckResult.duration && ` (${Math.round(urlCheckResult.duration)}s)`}</>}
                      {urlCheckResult.isLive === null && <>? Não foi possível determinar</>}
                    </div>
                  )}
                </div>
              )}

              {form.sourceType === 'FILE' && <>
                <Input label="Cue-In (s)" type="number" step="0.001" value={form.cueIn} onChange={f('cueIn')} placeholder="0.000" />
                <Input label="Cue-Out (s)" type="number" step="0.001" value={form.cueOut} onChange={f('cueOut')} placeholder="Fim do arquivo" />
              </>}
              {form.sourceType === 'URL' && <>
                <Input label="Duração máx. (s)" type="number" step="1" value={form.cueOut} onChange={f('cueOut')} placeholder="3600 (padrão para live)" />
                <div />
              </>}

              <Input label="Observações" value={form.notes} onChange={f('notes')} placeholder="Opcional" className="col-span-2" />
            </div>

            {form.sourceType === 'FILE' && !editing?.media && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Mídia</p>
                  <Button size="sm" variant="secondary" loading={modalUploadLoading} onClick={() => fileRefModal.current?.click()} icon={<Upload className="h-3.5 w-3.5 text-purple-400" />}>
                    {modalUploadLoading ? `${modalUploadProgress}%` : 'Enviar arquivo(s)'}
                  </Button>
                  <input ref={fileRefModal} type="file" multiple accept="video/*,image/*,.mxf,.mts,.m2ts" className="hidden" onChange={handleModalUpload} />
                </div>
                {orphanMedia.length > 0 && (
                  <div className="max-h-36 overflow-y-auto space-y-1 rounded-lg border border-gray-700 p-2">
                    {orphanMedia.map((m: OrphanMedia) => (
                      <button key={m.id} type="button" onClick={() => setSelectedOrphanId(selectedOrphanId === m.id ? null : m.id)}
                        className={`w-full text-left px-3 py-1.5 rounded text-sm transition-colors flex items-center justify-between ${selectedOrphanId === m.id ? 'bg-brand-600/30 border border-brand-500 text-white' : 'hover:bg-gray-700 text-gray-300'}`}>
                        <span className="truncate">{m.originalName}</span>
                        {m.duration && <span className="ml-2 text-xs font-mono text-gray-500 shrink-0">{formatDur(m.duration)}</span>}
                      </button>
                    ))}
                  </div>
                )}
                {orphanMedia.length === 0 && !modalUploadLoading && (
                  <p className="text-xs text-gray-600 text-center py-2">Nenhuma mídia disponível. Envie um arquivo acima.</p>
                )}
              </div>
            )}

            <div className="flex gap-3 justify-end pt-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button loading={save.isPending} onClick={handleSave}>Salvar</Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* ── Modal preview HLS ────────────────────────────────────────────── */}
      <Modal open={!!previewClip} onClose={() => setPreviewClip(null)} title={previewClip?.title ?? 'Preview'} size="lg">
        {previewClip?.media?.hlsPath && (
          <div className="space-y-3">
            <div className="relative w-full aspect-video">
              <VideoPlayer src={hlsStreamUrl(previewClip.media.hlsPath)} className="w-full h-full" autoPlay />
              {previewClip.graphic && <GraphicOverlay graphic={previewClip.graphic} />}
            </div>
            <div className="flex items-center gap-4 text-xs text-gray-500 pt-1">
              <span>Código: <span className="font-mono text-gray-300">{previewClip.code}</span></span>
              {previewClip.media.duration && <span>Duração: <span className="font-mono text-gray-300">{formatDur(previewClip.media.duration)}</span></span>}
              <span>Cue-In: <span className="font-mono text-gray-300">{previewClip.cueIn}s</span></span>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Modal preview URL ────────────────────────────────────────────── */}
      <Modal open={!!urlPreviewClip} onClose={() => setUrlPreviewClip(null)} title={urlPreviewClip?.title ?? 'Preview URL'} size="lg">
        {urlPreviewClip?.sourceUrl && (() => {
          const embed = embedUrl(urlPreviewClip.sourceUrl!)
          return embed ? (
            <div className="space-y-2">
              <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-black">
                <iframe src={embed} className="w-full h-full" allowFullScreen allow="autoplay; fullscreen" title={urlPreviewClip.title} />
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-500 pt-1">
                <span>Código: <span className="font-mono text-gray-300">{urlPreviewClip.code}</span></span>
                <a href={urlPreviewClip.sourceUrl!} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline flex items-center gap-1"><Link className="h-3 w-3" />Abrir</a>
              </div>
            </div>
          ) : (
            <div className="space-y-3 py-4">
              <p className="text-gray-400 text-sm">Preview não disponível para esta URL.</p>
              <a href={urlPreviewClip.sourceUrl!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sky-400 hover:underline text-sm"><Link className="h-4 w-4" />Abrir URL</a>
            </div>
          )
        })()}
      </Modal>

      {/* ── Modal inserir roteiro ────────────────────────────────────────── */}
      <Modal open={!!insertModal} onClose={() => setInsertModal(null)} title="Inserir Roteiro">
        {insertModal && (
          <div className="space-y-4">
            <p className="text-sm text-gray-400">Como deseja inserir o roteiro <strong className="text-white">"{insertModal.name}"</strong>?</p>
            <div className="flex flex-col gap-2">
              <button onClick={() => playRotMut.mutate(insertModal.sourceId)} disabled={playRotMut.isPending}
                className="w-full px-4 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                {playRotMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}Substituir roteiro atual e iniciar
              </button>
              <button onClick={() => activePlaylistId && appendFromMut.mutate({ targetId: activePlaylistId, sourceId: insertModal.sourceId })} disabled={appendFromMut.isPending || !activePlaylistId}
                className="w-full px-4 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                {appendFromMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListPlus className="h-4 w-4" />}Inserir no final do roteiro ativo
              </button>
            </div>
            <button onClick={() => setInsertModal(null)} className="w-full text-center text-xs text-gray-600 hover:text-gray-400 transition-colors pt-1">Cancelar</button>
          </div>
        )}
      </Modal>
    </div>
  )
}
