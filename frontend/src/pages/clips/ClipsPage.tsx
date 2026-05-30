import { useState, useRef, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Search, Upload, CheckCircle2, Clock, XCircle, Play, Scissors, Film, Link, HardDrive } from 'lucide-react'
import toast from 'react-hot-toast'
import { clipsApi, type Clip, type OrphanMedia, MODALITY_LABELS, type ClipModality, type ClipSourceType } from '../../api/clips.api'
import { clientsApi } from '../../api/clients.api'
import { clipTypesApi } from '../../api/clip-types.api'
import { graphicsApi } from '../../api/graphics.api'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Table, Thead, Th, Tbody, Tr, Td } from '../../components/ui/Table'
import { Badge, StatusBadge } from '../../components/ui/Badge'
import { VideoPlayer } from '../../components/ui/VideoPlayer'
import { GraphicOverlay } from '../../components/ui/GraphicOverlay'

const emptyForm = {
  code: '', title: '', modality: 'CP' as ClipModality,
  sourceType: 'FILE' as ClipSourceType, sourceUrl: '',
  cueIn: '0', cueOut: '', clientId: '', typeId: '', notes: '', graphicId: '',
}
type FormErrors = { code?: string; title?: string; sourceUrl?: string }

function hlsStreamUrl(hlsPath: string) {
  const mediaId = hlsPath.split('/')[1]
  return `/api/media/stream/${mediaId}/index.m3u8`
}

// Retorna URL de embed para YouTube/Twitch, ou null para outros
function embedUrl(sourceUrl: string): string | null {
  try {
    const u = new URL(sourceUrl)
    // YouTube
    const ytMatch = sourceUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)
    if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1`
    // YouTube live channels: youtube.com/channel/... ou youtube.com/@...
    if (u.hostname.includes('youtube.com') && !ytMatch) {
      return `https://www.youtube.com/embed/live_stream?channel=${u.pathname.split('/').pop()}&autoplay=1`
    }
    // Twitch channel
    const twMatch = sourceUrl.match(/twitch\.tv\/([A-Za-z0-9_]+)/)
    if (twMatch) return `https://player.twitch.tv/?channel=${twMatch[1]}&parent=${window.location.hostname}&autoplay=true`
  } catch {}
  return null
}

function fmtTime(sec: number) {
  const m = Math.floor(sec / 60)
  const s = (sec % 60).toFixed(3)
  return `${String(m).padStart(2, '0')}:${s.padStart(6, '0')}`
}

function IngestBadge({ status, sourceType }: { status: string; sourceType?: string }) {
  if (sourceType === 'URL') return <span className="flex items-center gap-1 text-sky-400 text-xs"><Link className="h-3.5 w-3.5" />YouTube/Twitch</span>
  if (status === 'READY') return <span className="flex items-center gap-1 text-emerald-400 text-xs"><CheckCircle2 className="h-3.5 w-3.5" />Pronto</span>
  if (status === 'PROCESSING') return <span className="flex items-center gap-1 text-amber-400 text-xs animate-pulse"><Clock className="h-3.5 w-3.5 animate-spin" />Transcodificando</span>
  if (status === 'ERROR') return <span className="flex items-center gap-1 text-red-400 text-xs"><XCircle className="h-3.5 w-3.5" />Erro</span>
  return <span className="text-gray-500 text-xs">Sem mídia</span>
}

function formatDur(sec?: number) {
  if (!sec) return '—'
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60)
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`
}

export default function ClipsPage() {
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [open, setOpen] = useState(false)
  const [previewClip, setPreviewClip] = useState<Clip | null>(null)
  const [urlPreviewClip, setUrlPreviewClip] = useState<Clip | null>(null)
  const [urlCheckLoading, setUrlCheckLoading] = useState(false)
  const [urlCheckResult, setUrlCheckResult] = useState<{ isLive: boolean | null; title?: string; duration?: number } | null>(null)
  const [uploadingClipId, setUploadingClipId] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<number>(0)
  const [editing, setEditing] = useState<Clip | null>(null)
  const [playerTime, setPlayerTime] = useState(0)
  const [search, setSearch] = useState('')
  const [modalityFilter, setModalityFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState(() => searchParams.get('typeId') ?? '')
  const [page, setPage] = useState(1)
  const [sortBy, setSortBy] = useState('title')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [form, setForm] = useState(emptyForm)

  function toggleSort(col: string) {
    if (sortBy === col) setSortDir((d: 'asc' | 'desc') => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('asc') }
    setPage(1)
  }

  function si(col: string) {
    if (sortBy !== col) return ' ↕'
    return sortDir === 'asc' ? ' ▲' : ' ▼'
  }
  const [formErrors, setFormErrors] = useState<FormErrors>({})
  const [codeAutoGenerated, setCodeAutoGenerated] = useState(false)
  const [uploadDirectLoading, setUploadDirectLoading] = useState(false)
  const [uploadDirectProgress, setUploadDirectProgress] = useState(0)
  const [uploadDirectCount, setUploadDirectCount] = useState({ done: 0, total: 0 })
  const [modalUploadLoading, setModalUploadLoading] = useState(false)
  const [modalUploadProgress, setModalUploadProgress] = useState(0)
  const [selectedOrphanId, setSelectedOrphanId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const fileRefDirect = useRef<HTMLInputElement>(null)
  const fileRefModal = useRef<HTMLInputElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['clips', search, modalityFilter, typeFilter, page, sortBy, sortDir],
    queryFn: () => clipsApi.list({ search: search || undefined, modality: modalityFilter || undefined, typeId: typeFilter || undefined, page, sortBy, sortDir }),
    refetchInterval: (query) =>
      query.state.data?.items.some((c) => c.media?.ingestStatus === 'PROCESSING') ? 3000 : false,
  })

  const { data: clients = [] } = useQuery({ queryKey: ['clients'], queryFn: () => clientsApi.list() })
  const { data: types = [] } = useQuery({ queryKey: ['clip-types'], queryFn: clipTypesApi.list })
  const { data: graphics = [] } = useQuery({ queryKey: ['graphics'], queryFn: graphicsApi.list })
  const { data: orphanMedia = [], refetch: refetchOrphan } = useQuery({
    queryKey: ['orphan-media'],
    queryFn: clipsApi.listOrphanMedia,
    enabled: open,
  })

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
      qc.invalidateQueries({ queryKey: ['clips'] })
      setOpen(false)
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao salvar'),
  })

  function handleSave() {
    const errors: FormErrors = {}
    if (!form.code.trim()) errors.code = 'Código é obrigatório'
    if (!form.title.trim()) errors.title = 'Título é obrigatório'
    if (form.sourceType === 'URL' && form.sourceUrl && !/^https?:\/\/.+/.test(form.sourceUrl))
      errors.sourceUrl = 'URL inválida'
    if (Object.keys(errors).length > 0) { setFormErrors(errors); return }
    setFormErrors({})
    save.mutate()
  }

  function handleCodeChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((v) => ({ ...v, code: e.target.value }))
    setCodeAutoGenerated(false)
    if (formErrors.code) setFormErrors((v) => ({ ...v, code: undefined }))
  }

  function handleTitleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((v) => ({ ...v, title: e.target.value }))
    if (formErrors.title) setFormErrors((v) => ({ ...v, title: undefined }))
  }

  async function handleTypeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const typeId = e.target.value
    setForm((v) => ({ ...v, typeId }))
    if (typeId && (form.code === '' || codeAutoGenerated)) {
      const selectedType = types.find((t) => t.id === typeId)
      if (selectedType?.code) {
        try {
          const result = await clipsApi.nextCode(selectedType.code)
          setForm((v) => ({ ...v, typeId, code: result.code }))
          setCodeAutoGenerated(true)
          setFormErrors((v) => ({ ...v, code: undefined }))
        } catch { /* ignore */ }
      }
    }
  }

  const remove = useMutation({
    mutationFn: clipsApi.delete,
    onSuccess: () => { toast.success('Clipe desativado'); qc.invalidateQueries({ queryKey: ['clips'] }) },
  })

  function f(k: keyof typeof emptyForm) { return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((v) => ({ ...v, [k]: e.target.value })) }
  function openNew() {
    setEditing(null); setForm(emptyForm); setFormErrors({}); setCodeAutoGenerated(false); setSelectedOrphanId(null); setOpen(true)
  }
  function openEdit(c: Clip) {
    setEditing(c)
    setForm({
      code: c.code, title: c.title, modality: c.modality,
      sourceType: c.sourceType ?? 'FILE', sourceUrl: c.sourceUrl ?? '',
      cueIn: String(c.cueIn), cueOut: c.cueOut ? String(c.cueOut) : '',
      clientId: c.clientId ?? '', typeId: c.typeId ?? '', notes: c.notes ?? '', graphicId: (c as any).graphicId ?? '',
    })
    setFormErrors({})
    setCodeAutoGenerated(false)
    setSelectedOrphanId(null)
    setOpen(true)
  }

  // Abre o modal de edição quando navega com ?edit=clipId (ex: duplo clique no roteiro)
  const editIdFromUrl = searchParams.get('edit')
  useEffect(() => {
    if (!editIdFromUrl) return
    clipsApi.get(editIdFromUrl)
      .then(c => {
        openEdit(c)
        setSearchParams(p => { p.delete('edit'); return p })
      })
      .catch(() => {})
  }, [editIdFromUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleDirectUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setUploadDirectLoading(true)
    setUploadDirectCount({ done: 0, total: files.length })
    setUploadDirectProgress(0)
    let errors = 0
    for (let i = 0; i < files.length; i++) {
      try {
        await clipsApi.uploadMediaDirect(files[i], setUploadDirectProgress)
        setUploadDirectCount({ done: i + 1, total: files.length })
      } catch {
        errors++
      }
    }
    if (errors === 0) toast.success(`${files.length} arquivo(s) enviado(s). Transcodificação em andamento.`)
    else toast.error(`${errors} arquivo(s) falharam no envio.`)
    refetchOrphan()
    setUploadDirectLoading(false)
    setUploadDirectCount({ done: 0, total: 0 })
    if (fileRefDirect.current) fileRefDirect.current.value = ''
  }

  async function handleModalUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setModalUploadLoading(true)
    setModalUploadProgress(0)
    let lastId: string | null = null
    let errors = 0
    for (const file of files) {
      try {
        const result = await clipsApi.uploadMediaDirect(file, setModalUploadProgress)
        lastId = result.mediaId
      } catch {
        errors++
      }
    }
    if (errors === 0) toast.success(`${files.length} arquivo(s) em transcodificação.`)
    else toast.error(`${errors} arquivo(s) falharam no envio.`)
    await refetchOrphan()
    if (lastId) setSelectedOrphanId(lastId)
    setModalUploadLoading(false)
    if (fileRefModal.current) fileRefModal.current.value = ''
  }

  const uploadClipIdRef = useRef<string | null>(null)

  function startUpload(clipId: string) {
    uploadClipIdRef.current = clipId
    fileRef.current?.click()
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const clipId = uploadClipIdRef.current
    if (!file || !clipId) return
    setUploadingClipId(clipId)
    setUploadProgress(0)
    try {
      await clipsApi.uploadMedia(file, clipId, setUploadProgress)
      toast.success('Upload concluído. Transcodificação em andamento.')
      qc.invalidateQueries({ queryKey: ['clips'] })
    } catch {
      toast.error('Erro no upload')
    } finally {
      setUploadingClipId(null)
      uploadClipIdRef.current = null
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const typeMap = Object.fromEntries(types.map((t) => [t.id, t]))

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Clipes</h1>
          <p className="text-gray-500 text-sm mt-1">{data?.total ?? 0} clipe(s)</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept="video/*,.mxf,.mts,.m2ts" className="hidden" onChange={handleFileUpload} />
          <input ref={fileRefDirect} type="file" multiple accept="video/*,.mxf,.mts,.m2ts" className="hidden" onChange={handleDirectUpload} />
          <Button
            variant="secondary"
            loading={uploadDirectLoading}
            onClick={() => fileRefDirect.current?.click()}
            icon={<Film className="h-4 w-4 text-purple-400" />}
            title="Upload em lote — múltiplos arquivos sem criar clipe"
          >
            {uploadDirectLoading
              ? uploadDirectCount.total > 1
                ? `${uploadDirectCount.done}/${uploadDirectCount.total} · ${uploadDirectProgress}%`
                : `${uploadDirectProgress}%`
              : 'Upload Direto'}
          </Button>
          <Button onClick={openNew} icon={<Plus className="h-4 w-4" />}>Novo Clipe</Button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="w-72">
          <Input placeholder="Buscar por título ou código..." value={search} onChange={(e) => setSearch(e.target.value)} icon={<Search className="h-4 w-4" />} />
        </div>
        <select
          value={modalityFilter}
          onChange={(e) => setModalityFilter(e.target.value)}
          className="rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm px-3 py-2 focus:outline-none focus:border-brand-500"
        >
          <option value="">Todas as modalidades</option>
          {Object.entries(MODALITY_LABELS).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); setSearchParams(e.target.value ? { typeId: e.target.value } : {}) }}
          className="rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm px-3 py-2 focus:outline-none focus:border-brand-500"
        >
          <option value="">Todos os tipos de clipe</option>
          {types.map((t) => <option key={t.id} value={t.id}>[{t.code}] {t.name}</option>)}
        </select>
        {typeFilter && (
          <button
            onClick={() => { setTypeFilter(''); setSearchParams({}); setPage(1) }}
            className="text-xs text-brand-400 hover:text-brand-300 transition-colors"
          >
            ✕ Limpar filtro de tipo
          </button>
        )}
      </div>

      {/* Barra de progresso de upload */}
      {uploadingClipId && (
        <div className="rounded-lg bg-gray-800 border border-gray-700 px-4 py-3 flex items-center gap-3">
          <Upload className="h-4 w-4 text-blue-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>Enviando arquivo…</span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <Table>
          <Thead>
            <Th onClick={() => toggleSort('code')} title="Ordenar por código">Código{si('code')}</Th>
            <Th onClick={() => toggleSort('title')} title="Ordenar por título">Título{si('title')}</Th>
            <Th onClick={() => toggleSort('modality')} title="Ordenar por tipo">Tipo{si('modality')}</Th>
            <Th onClick={() => toggleSort('client')} title="Ordenar por cliente">Cliente{si('client')}</Th>
            <Th onClick={() => toggleSort('duration')} title="Ordenar por duração">Duração{si('duration')}</Th>
            <Th onClick={() => toggleSort('media')} title="Ordenar por mídia — ▲ sem arquivo primeiro">Mídia{si('media')}</Th>
            <Th>Gráfico</Th>
            <Th>Situação</Th>
            <Th className="w-24 text-right">Ações</Th>
          </Thead>
          <Tbody>
            {isLoading ? (
              <Tr><Td colSpan={9} className="text-center text-gray-500 py-8">Carregando...</Td></Tr>
            ) : data?.items.map((c) => {
              const t = c.typeId ? typeMap[c.typeId] : null
              return (
                <Tr key={c.id}>
                  <Td><span className="font-mono text-xs text-gray-400">{c.code}</span></Td>
                  <Td><span className="font-medium text-white">{c.title}</span></Td>
                  <Td>
                    {t ? <Badge color={t.fontColor} bg={t.fontBackColor}>{t.code}</Badge>
                       : <Badge className="bg-gray-700 text-gray-400">{c.modality}</Badge>}
                  </Td>
                  <Td>{c.client?.name ?? <span className="text-gray-600">—</span>}</Td>
                  <Td><span className="font-mono text-xs">{formatDur(c.media?.duration ?? c.duration ?? undefined)}</span></Td>
                  <Td><IngestBadge status={c.media?.ingestStatus ?? 'NONE'} sourceType={c.sourceType} /></Td>
                  <Td>
                    {c.graphic
                      ? <span className="text-[10px] bg-violet-900/50 text-violet-300 px-1.5 py-0.5 rounded font-mono">{c.graphic.name}</span>
                      : <span className="text-gray-700 text-xs">—</span>}
                  </Td>
                  <Td><StatusBadge active={c.active} /></Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {c.media?.hlsPath && c.media.ingestStatus === 'READY' && (
                        <Button
                          size="sm" variant="ghost"
                          icon={<Play className="h-3.5 w-3.5 text-emerald-400" />}
                          onClick={() => setPreviewClip(c)}
                          title="Pré-visualizar"
                        />
                      )}
                      {c.sourceType === 'URL' && c.sourceUrl && (
                        <Button
                          size="sm" variant="ghost"
                          icon={<Link className="h-3.5 w-3.5 text-sky-400" />}
                          onClick={() => setUrlPreviewClip(c)}
                          title="Preview YouTube/Twitch"
                        />
                      )}
                      {c.sourceType !== 'URL' && (
                        <Button
                          size="sm" variant="ghost"
                          icon={<Upload className={`h-3.5 w-3.5 ${c.media?.ingestStatus === 'READY' ? 'text-amber-400' : 'text-blue-400'}`} />}
                          loading={uploadingClipId === c.id}
                          onClick={() => {
                            if (c.media?.ingestStatus === 'READY' && !window.confirm('Substituir o arquivo de mídia deste clipe? O arquivo atual será removido.')) return
                            startUpload(c.id)
                          }}
                          disabled={uploadingClipId !== null && uploadingClipId !== c.id}
                          title={uploadingClipId === c.id ? `Enviando… ${uploadProgress}%` : c.media?.ingestStatus === 'READY' ? 'Substituir arquivo' : 'Enviar mídia'}
                        />
                      )}
                      <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => openEdit(c)} />
                      <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => remove.mutate(c.id)} />
                    </div>
                  </Td>
                </Tr>
              )
            })}
          </Tbody>
        </Table>

        {/* Paginação */}
        {data && data.total > data.limit && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
            <p className="text-xs text-gray-500">
              {(page - 1) * data.limit + 1}–{Math.min(page * data.limit, data.total)} de {data.total}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
              <Button size="sm" variant="secondary" disabled={page * data.limit >= data.total} onClick={() => setPage((p) => p + 1)}>Próximo</Button>
            </div>
          </div>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Editar Clipe' : 'Novo Clipe'}
        size={editing?.media?.ingestStatus === 'READY' ? 'xl' : 'lg'}
      >
        <div className={editing?.media?.ingestStatus === 'READY' ? 'grid grid-cols-2 gap-6' : ''}>

          {/* Player de edição — só aparece quando o clipe tem mídia READY */}
          {editing?.media?.ingestStatus === 'READY' && editing.media.hlsPath && (
            <div className="space-y-3">
              <div className="relative w-full aspect-video">
              <VideoPlayer
                src={hlsStreamUrl(editing.media.hlsPath)}
                className="w-full h-full"
                onTimeUpdate={setPlayerTime}
              />
              {(() => { const g = form.graphicId ? graphics.find(gr => gr.id === form.graphicId) : null; return g ? <GraphicOverlay graphic={g} /> : null })()}
              </div>

              {/* Tempo atual */}
              <div className="flex items-center justify-between px-0.5">
                <span className="font-mono text-sm text-brand-400">{fmtTime(playerTime)}</span>
                {editing.media.duration && (
                  <span className="font-mono text-xs text-gray-500">/ {fmtTime(editing.media.duration)}</span>
                )}
              </div>

              {/* Botões de marcação */}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Scissors className="h-3.5 w-3.5 text-cyan-400" />}
                  onClick={() => setForm((v) => ({ ...v, cueIn: playerTime.toFixed(3) }))}
                >
                  Marcar Cue-In
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Scissors className="h-3.5 w-3.5 text-amber-400" />}
                  onClick={() => setForm((v) => ({ ...v, cueOut: playerTime.toFixed(3) }))}
                >
                  Marcar Cue-Out
                </Button>
              </div>

              {/* Barra de range visual */}
              {editing.media.duration && (
                <div className="space-y-1">
                  <div className="relative h-2 bg-gray-800 rounded-full overflow-hidden">
                    {/* Região ativa */}
                    <div
                      className="absolute h-full bg-brand-500/25"
                      style={{
                        left: `${((parseFloat(form.cueIn) || 0) / editing.media.duration) * 100}%`,
                        width: `${(((parseFloat(form.cueOut) || editing.media.duration) - (parseFloat(form.cueIn) || 0)) / editing.media.duration) * 100}%`,
                      }}
                    />
                    {/* Marcador Cue-In */}
                    <div
                      className="absolute top-0 h-full w-0.5 bg-cyan-400"
                      style={{ left: `${((parseFloat(form.cueIn) || 0) / editing.media.duration) * 100}%` }}
                    />
                    {/* Marcador Cue-Out */}
                    {form.cueOut && (
                      <div
                        className="absolute top-0 h-full w-0.5 bg-amber-400"
                        style={{ left: `${(parseFloat(form.cueOut) / editing.media.duration) * 100}%` }}
                      />
                    )}
                    {/* Posição atual */}
                    <div
                      className="absolute top-0 h-full w-0.5 bg-white/50"
                      style={{ left: `${(playerTime / editing.media.duration) * 100}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] font-mono">
                    <span className="text-cyan-500">IN {fmtTime(parseFloat(form.cueIn) || 0)}</span>
                    <span className="text-amber-500">OUT {fmtTime(parseFloat(form.cueOut) || editing.media.duration)}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Formulário */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input label="Código *" value={form.code} onChange={handleCodeChange} placeholder="COM000001" error={formErrors.code} />
              <Select label="Tipo" value={form.typeId} onChange={handleTypeChange}>
                <option value="">Sem tipo</option>
                {types.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
              </Select>
              <Input label="Título *" value={form.title} onChange={handleTitleChange} placeholder="Nome do clipe" className="col-span-2" error={formErrors.title} />
              <Select label="Cliente" value={form.clientId} onChange={f('clientId')}>
                <option value="">Sem cliente</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>

              {/* Toggle FILE / URL */}
              <div className="col-span-2">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">Fonte de mídia</p>
                <div className="flex rounded-lg overflow-hidden border border-gray-700 w-fit">
                  <button
                    type="button"
                    onClick={() => setForm((v) => ({ ...v, sourceType: 'FILE' }))}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${form.sourceType === 'FILE' ? 'bg-brand-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}
                  >
                    <HardDrive className="h-3.5 w-3.5" />Arquivo físico
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm((v) => ({ ...v, sourceType: 'URL' }))}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${form.sourceType === 'URL' ? 'bg-brand-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}
                  >
                    <Link className="h-3.5 w-3.5" />YouTube / Twitch (URL)
                  </button>
                </div>
              </div>

              {form.sourceType === 'URL' && (
                <div className="col-span-2 space-y-1">
                  <Input
                    label="URL do vídeo *"
                    value={form.sourceUrl}
                    onChange={(e) => { setForm((v) => ({ ...v, sourceUrl: e.target.value })); setUrlCheckResult(null) }}
                    placeholder="https://www.youtube.com/watch?v=... ou https://twitch.tv/..."
                    error={formErrors.sourceUrl}
                    icon={<Link className="h-4 w-4" />}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] text-gray-500">Resolvida via yt-dlp na exibição. Use canais LIVE para evitar throttle do YouTube.</p>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={urlCheckLoading}
                      disabled={!form.sourceUrl}
                      onClick={async () => {
                        setUrlCheckLoading(true); setUrlCheckResult(null)
                        try { setUrlCheckResult(await clipsApi.checkUrl(form.sourceUrl)) }
                        catch { toast.error('Falha ao verificar URL') }
                        finally { setUrlCheckLoading(false) }
                      }}
                    >Verificar</Button>
                  </div>
                  {urlCheckResult && (
                    <div className={`text-[11px] rounded px-2 py-1.5 mt-1 ${urlCheckResult.isLive === true ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/40' : urlCheckResult.isLive === false ? 'bg-amber-900/40 text-amber-300 border border-amber-700/40' : 'bg-gray-800 text-gray-400 border border-gray-700'}`}>
                      {urlCheckResult.isLive === true && <>✓ <strong>Stream LIVE</strong>{urlCheckResult.title && ` — ${urlCheckResult.title}`} (recomendado para playout)</>}
                      {urlCheckResult.isLive === false && <>⚠ <strong>VOD</strong>{urlCheckResult.title && ` — ${urlCheckResult.title}`}{urlCheckResult.duration && ` (${Math.round(urlCheckResult.duration)}s)`} — YouTube faz throttle no download, streaming pode travar/atrasar.</>}
                      {urlCheckResult.isLive === null && <>? Não foi possível determinar (URL inválida ou yt-dlp falhou)</>}
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
              <Select label="Gráfico" value={form.graphicId} onChange={f('graphicId')} className="col-span-2">
                <option value="">Nenhum</option>
                {graphics.filter(g => g.active).map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </Select>
            </div>
            {/* Upload de mídia no cadastro — só aparece quando clipe é FILE e não tem mídia ainda */}
            {form.sourceType === 'FILE' && !editing?.media && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Mídia</p>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={modalUploadLoading}
                    onClick={() => fileRefModal.current?.click()}
                    icon={<Upload className="h-3.5 w-3.5 text-purple-400" />}
                  >
                    {modalUploadLoading ? `${modalUploadProgress}%` : 'Enviar arquivo(s)'}
                  </Button>
                  <input ref={fileRefModal} type="file" multiple accept="video/*,.mxf,.mts,.m2ts" className="hidden" onChange={handleModalUpload} />
                </div>
                {orphanMedia.length > 0 && (
                  <div className="max-h-36 overflow-y-auto space-y-1 rounded-lg border border-gray-700 p-2">
                    {orphanMedia.map((m: OrphanMedia) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setSelectedOrphanId(selectedOrphanId === m.id ? null : m.id)}
                        className={`w-full text-left px-3 py-1.5 rounded text-sm transition-colors flex items-center justify-between ${
                          selectedOrphanId === m.id
                            ? 'bg-brand-600/30 border border-brand-500 text-white'
                            : 'hover:bg-gray-700 text-gray-300'
                        }`}
                      >
                        <span className="truncate">{m.originalName}</span>
                        {m.duration && <span className="ml-2 text-xs font-mono text-gray-500 shrink-0">{formatDur(m.duration)}</span>}
                      </button>
                    ))}
                  </div>
                )}
                {orphanMedia.length === 0 && !modalUploadLoading && (
                  <p className="text-xs text-gray-600 text-center py-2">Nenhuma mídia disponível. Envie um arquivo acima.</p>
                )}
                {selectedOrphanId && (
                  <p className="text-xs text-brand-400">Mídia selecionada será vinculada ao salvar.</p>
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

      {/* Modal: preview de vídeo HLS */}
      <Modal
        open={!!previewClip}
        onClose={() => setPreviewClip(null)}
        title={previewClip?.title ?? 'Preview'}
        size="lg"
      >
        {previewClip?.media?.hlsPath && (
          <div className="space-y-3">
            <div className="relative w-full aspect-video">
            <VideoPlayer
              src={hlsStreamUrl(previewClip.media.hlsPath)}
              className="w-full h-full"
              autoPlay
            />
            {previewClip.graphic && <GraphicOverlay graphic={previewClip.graphic} />}
            </div>
            <div className="flex items-center gap-4 text-xs text-gray-500 pt-1">
              <span>Código: <span className="font-mono text-gray-300">{previewClip.code}</span></span>
              {previewClip.media.duration && (
                <span>Duração: <span className="font-mono text-gray-300">{formatDur(previewClip.media.duration)}</span></span>
              )}
              <span>Cue-In: <span className="font-mono text-gray-300">{previewClip.cueIn}s</span></span>
              {previewClip.cueOut && (
                <span>Cue-Out: <span className="font-mono text-gray-300">{previewClip.cueOut}s</span></span>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Modal: preview YouTube / Twitch */}
      <Modal
        open={!!urlPreviewClip}
        onClose={() => setUrlPreviewClip(null)}
        title={urlPreviewClip?.title ?? 'Preview URL'}
        size="lg"
      >
        {urlPreviewClip?.sourceUrl && (() => {
          const embed = embedUrl(urlPreviewClip.sourceUrl!)
          return embed ? (
            <div className="space-y-2">
              <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-black">
                <iframe
                  src={embed}
                  className="w-full h-full"
                  allowFullScreen
                  allow="autoplay; fullscreen"
                  title={urlPreviewClip.title}
                />
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-500 pt-1">
                <span>Código: <span className="font-mono text-gray-300">{urlPreviewClip.code}</span></span>
                <a href={urlPreviewClip.sourceUrl!} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline flex items-center gap-1">
                  <Link className="h-3 w-3" />Abrir no navegador
                </a>
              </div>
            </div>
          ) : (
            <div className="space-y-3 py-4">
              <p className="text-gray-400 text-sm">Preview não disponível para esta URL diretamente no navegador.</p>
              <a
                href={urlPreviewClip.sourceUrl!}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sky-400 hover:underline text-sm"
              >
                <Link className="h-4 w-4" />Abrir URL externamente
              </a>
              <p className="text-xs text-gray-600 font-mono break-all">{urlPreviewClip.sourceUrl}</p>
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}
