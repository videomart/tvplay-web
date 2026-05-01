import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Search, Upload, CheckCircle2, Clock, XCircle, Play } from 'lucide-react'
import toast from 'react-hot-toast'
import { clipsApi, type Clip, MODALITY_LABELS, type ClipModality } from '../../api/clips.api'
import { clientsApi } from '../../api/clients.api'
import { clipTypesApi } from '../../api/clip-types.api'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Table, Thead, Th, Tbody, Tr, Td } from '../../components/ui/Table'
import { Badge, StatusBadge } from '../../components/ui/Badge'
import { VideoPlayer } from '../../components/ui/VideoPlayer'

const emptyForm = { code: '', title: '', modality: 'CP' as ClipModality, cueIn: '0', cueOut: '', clientId: '', typeId: '', notes: '' }

function hlsStreamUrl(hlsPath: string) {
  // hlsPath = "hls/{mediaId}/index.m3u8"
  // Extrai o mediaId e monta a URL do proxy
  const mediaId = hlsPath.split('/')[1]
  return `/api/media/stream/${mediaId}/index.m3u8`
}

function IngestBadge({ status }: { status: string }) {
  if (status === 'READY') return <span className="flex items-center gap-1 text-emerald-400 text-xs"><CheckCircle2 className="h-3.5 w-3.5" />Pronto</span>
  if (status === 'PROCESSING') return <span className="flex items-center gap-1 text-amber-400 text-xs"><Clock className="h-3.5 w-3.5" />Transcodificando</span>
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
  const [open, setOpen] = useState(false)
  const [previewClip, setPreviewClip] = useState<Clip | null>(null)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [editing, setEditing] = useState<Clip | null>(null)
  const [search, setSearch] = useState('')
  const [modalityFilter, setModalityFilter] = useState('')
  const [page, setPage] = useState(1)
  const [form, setForm] = useState(emptyForm)
  const fileRef = useRef<HTMLInputElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['clips', search, modalityFilter, page],
    queryFn: () => clipsApi.list({ search: search || undefined, modality: modalityFilter || undefined, page }),
  })

  const { data: clients = [] } = useQuery({ queryKey: ['clients'], queryFn: () => clientsApi.list() })
  const { data: types = [] } = useQuery({ queryKey: ['clip-types'], queryFn: clipTypesApi.list })

  const save = useMutation({
    mutationFn: () => {
      const payload = { ...form, cueIn: parseFloat(form.cueIn) || 0, cueOut: form.cueOut ? parseFloat(form.cueOut) : undefined }
      return editing ? clipsApi.update(editing.id, payload) : clipsApi.create(payload)
    },
    onSuccess: () => {
      toast.success(editing ? 'Clipe atualizado' : 'Clipe criado')
      qc.invalidateQueries({ queryKey: ['clips'] })
      setOpen(false)
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao salvar'),
  })

  const remove = useMutation({
    mutationFn: clipsApi.delete,
    onSuccess: () => { toast.success('Clipe desativado'); qc.invalidateQueries({ queryKey: ['clips'] }) },
  })

  function f(k: keyof typeof emptyForm) { return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((v) => ({ ...v, [k]: e.target.value })) }
  function openNew() { setEditing(null); setForm(emptyForm); setOpen(true) }
  function openEdit(c: Clip) {
    setEditing(c)
    setForm({ code: c.code, title: c.title, modality: c.modality, cueIn: String(c.cueIn), cueOut: c.cueOut ? String(c.cueOut) : '', clientId: c.clientId ?? '', typeId: c.typeId ?? '', notes: c.notes ?? '' })
    setOpen(true)
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadProgress(0)
    try {
      const { mediaId } = await clipsApi.uploadMedia(file, setUploadProgress)
      toast.success(`Upload concluído — ID: ${mediaId}. Transcodificação em andamento.`)
      qc.invalidateQueries({ queryKey: ['clips'] })
    } catch {
      toast.error('Erro no upload')
    } finally {
      setUploadProgress(null)
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
          <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={handleFileUpload} />
          <Button variant="secondary" icon={<Upload className="h-4 w-4" />} onClick={() => fileRef.current?.click()} loading={uploadProgress !== null}>
            {uploadProgress !== null ? `${uploadProgress}%` : 'Upload Mídia'}
          </Button>
          <Button onClick={openNew} icon={<Plus className="h-4 w-4" />}>Novo Clipe</Button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex gap-3 flex-wrap">
        <div className="w-72">
          <Input placeholder="Buscar por título ou código..." value={search} onChange={(e) => setSearch(e.target.value)} icon={<Search className="h-4 w-4" />} />
        </div>
        <select
          value={modalityFilter}
          onChange={(e) => setModalityFilter(e.target.value)}
          className="rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm px-3 py-2 focus:outline-none focus:border-brand-500"
        >
          <option value="">Todos os tipos</option>
          {Object.entries(MODALITY_LABELS).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
        </select>
      </div>

      <div className="card">
        <Table>
          <Thead>
            <Th>Código</Th>
            <Th>Título</Th>
            <Th>Tipo</Th>
            <Th>Cliente</Th>
            <Th>Duração</Th>
            <Th>Mídia</Th>
            <Th>Situação</Th>
            <Th className="w-24 text-right">Ações</Th>
          </Thead>
          <Tbody>
            {isLoading ? (
              <Tr><Td colSpan={8} className="text-center text-gray-500 py-8">Carregando...</Td></Tr>
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
                  <Td><IngestBadge status={c.media?.ingestStatus ?? 'NONE'} /></Td>
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

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Editar Clipe' : 'Novo Clipe'} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Código *" value={form.code} onChange={f('code')} placeholder="0000001" />
            <Select label="Modalidade" value={form.modality} onChange={f('modality')}>
              {Object.entries(MODALITY_LABELS).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
            </Select>
            <Input label="Título *" value={form.title} onChange={f('title')} placeholder="Nome do clipe" className="col-span-2" />
            <Select label="Cliente" value={form.clientId} onChange={f('clientId')}>
              <option value="">Sem cliente</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Select label="Tipo" value={form.typeId} onChange={f('typeId')}>
              <option value="">Sem tipo</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
            </Select>
            <Input label="Cue-In (s)" type="number" step="0.001" value={form.cueIn} onChange={f('cueIn')} placeholder="0.000" />
            <Input label="Cue-Out (s)" type="number" step="0.001" value={form.cueOut} onChange={f('cueOut')} placeholder="Fim do arquivo" />
            <Input label="Observações" value={form.notes} onChange={f('notes')} placeholder="Opcional" className="col-span-2" />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button>
          </div>
        </div>
      </Modal>

      {/* Modal: preview de vídeo */}
      <Modal
        open={!!previewClip}
        onClose={() => setPreviewClip(null)}
        title={previewClip?.title ?? 'Preview'}
        size="lg"
      >
        {previewClip?.media?.hlsPath && (
          <div className="space-y-3">
            <VideoPlayer
              src={hlsStreamUrl(previewClip.media.hlsPath)}
              className="w-full aspect-video"
              autoPlay
            />
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
    </div>
  )
}
