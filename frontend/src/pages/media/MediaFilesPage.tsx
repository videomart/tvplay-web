import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  HardDrive, Trash2, AlertTriangle, CheckCircle, Clock, XCircle,
  Filter, Upload, ChevronUp, ChevronDown, Copy, Play, ExternalLink, Loader2, Plus, Film,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import { clipsApi } from '../../api/clips.api'
import { clipTypesApi } from '../../api/clip-types.api'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { VideoPlayer } from '../../components/ui/VideoPlayer'
import { Badge } from '../../components/ui/Badge'
import { api } from '../../api/client'

function formatSize(bytes?: string | null) {
  if (!bytes) return '—'
  const n = Number(bytes)
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`
  return `${(n / 1e3).toFixed(0)} KB`
}

function formatDur(sec?: number | null) {
  if (!sec) return '—'
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60)
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`
}

function mediaStreamUrl(hlsPath?: string | null): string | null {
  if (!hlsPath) return null
  const mediaId = hlsPath.split('/')[1]
  if (!mediaId) return null
  return `/api/media/stream/${mediaId}/index.m3u8`
}

const STATUS_BADGE: Record<string, { label: string; cls: string; icon: JSX.Element }> = {
  READY:       { label: 'Pronto',       cls: 'bg-emerald-900/40 text-emerald-400 border-emerald-700/40', icon: <CheckCircle className="h-3 w-3" /> },
  PENDING:     { label: 'Pendente',     cls: 'bg-gray-800 text-gray-500 border-gray-700/40',             icon: <Clock className="h-3 w-3" /> },
  PROCESSING:  { label: 'Transcodando', cls: 'bg-amber-900/40 text-amber-400 border-amber-700/40',       icon: <Clock className="h-3 w-3 animate-spin" /> },
  TRANSCODING: { label: 'Transcodando', cls: 'bg-amber-900/40 text-amber-400 border-amber-700/40',       icon: <Clock className="h-3 w-3 animate-spin" /> },
  ERROR:       { label: 'Erro',         cls: 'bg-red-900/40 text-red-400 border-red-700/40',             icon: <XCircle className="h-3 w-3" /> },
}

const MEDIA_TYPE: Record<string, { label: string; cls: string }> = {
  FILE: { label: 'FILE', cls: 'bg-gray-800 text-gray-400 border-gray-700/50' },
  URL:  { label: 'URL',  cls: 'bg-sky-900/50 text-sky-400 border-sky-700/40' },
}

export default function MediaFilesPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const cookiesFileRef = useRef<HTMLInputElement>(null)

  const [filterOrphan,   setFilterOrphan]   = useState(false)
  const [filterStatus,   setFilterStatus]   = useState('')
  const [filterTypeId,   setFilterTypeId]   = useState('')
  const [confirmId,      setConfirmId]      = useState<string | null>(null)
  const [sortBy,         setSortBy]         = useState('originalName')
  const [sortDir,        setSortDir]        = useState<'asc' | 'desc'>('asc')
  const [uploadLoading,  setUploadLoading]  = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadCount,    setUploadCount]    = useState({ done: 0, total: 0 })
  const [selected,       setSelected]       = useState<any | null>(null)
  const [previewFile,    setPreviewFile]    = useState<any | null>(null)
  const [cookiesUploading, setCookiesUploading] = useState(false)

  function toggleSort(col: string) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('asc') }
  }
  function si(col: string) {
    if (sortBy !== col) return <span className="text-gray-700 ml-0.5">↕</span>
    return sortDir === 'asc'
      ? <ChevronUp className="h-2.5 w-2.5 inline ml-0.5" />
      : <ChevronDown className="h-2.5 w-2.5 inline ml-0.5" />
  }

  const { data: types = [] } = useQuery({ queryKey: ['clip-types'], queryFn: clipTypesApi.list, staleTime: 60_000 })

  const { data: files = [], isLoading, refetch } = useQuery({
    queryKey: ['media-files', filterOrphan, filterStatus],
    queryFn: () => clipsApi.listMedia({ orphan: filterOrphan || undefined, status: filterStatus || undefined }),
    staleTime: 15_000,
    refetchInterval: (q) =>
      q.state.data?.some((f: any) => ['PENDING','PROCESSING','TRANSCODING'].includes(f.ingestStatus)) ? 3000 : false,
  })

  // Filtra por tipo de clipe (client-side)
  const filteredFiles = filterTypeId
    ? files.filter(f => f.clips.some(c => c.type?.id === filterTypeId))
    : files

  const sorted = [...filteredFiles].sort((a, b) => {
    let av: any, bv: any
    const ac = a.clips?.[0], bc = b.clips?.[0]
    switch (sortBy) {
      case 'code':         av = ac?.code?.toLowerCase() ?? ''; bv = bc?.code?.toLowerCase() ?? ''; break
      case 'title':        av = ac?.title?.toLowerCase() ?? ''; bv = bc?.title?.toLowerCase() ?? ''; break
      case 'type':         av = ac?.type?.code ?? ''; bv = bc?.type?.code ?? ''; break
      case 'originalName': av = a.originalName?.toLowerCase(); bv = b.originalName?.toLowerCase(); break
      case 'ingestStatus': av = a.ingestStatus; bv = b.ingestStatus; break
      case 'duration':     av = a.duration ?? -1; bv = b.duration ?? -1; break
      case 'sizeBytes':    av = Number(a.sizeBytes ?? 0); bv = Number(b.sizeBytes ?? 0); break
      case 'clips':        av = a._count?.clips ?? 0; bv = b._count?.clips ?? 0; break
      default:             av = a.originalName?.toLowerCase(); bv = b.originalName?.toLowerCase()
    }
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  // Tipos presentes nos arquivos (para filtro)
  const activeTypes = types.filter(t => files.some(f => f.clips.some(c => c.type?.id === t.id)))

  const deleteMut = useMutation({
    mutationFn: (id: string) => clipsApi.deleteMedia(id),
    onSuccess: (data) => {
      toast.success(`Arquivo excluído — ${data.deletedObjects} objeto(s) removidos`)
      qc.invalidateQueries({ queryKey: ['media-files'] })
      qc.invalidateQueries({ queryKey: ['clips'] })
      qc.invalidateQueries({ queryKey: ['clips-library'] })
      setConfirmId(null); setSelected(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao excluir'),
  })

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const fs = Array.from(e.target.files ?? [])
    if (!fs.length) return
    setUploadLoading(true); setUploadCount({ done: 0, total: fs.length }); setUploadProgress(0)
    let errors = 0
    for (let i = 0; i < fs.length; i++) {
      try { await clipsApi.uploadMediaDirect(fs[i], setUploadProgress); setUploadCount({ done: i + 1, total: fs.length }) }
      catch { errors++ }
    }
    errors === 0 ? toast.success(`${fs.length} arquivo(s) enviado(s).`) : toast.error(`${errors} arquivo(s) falharam.`)
    setUploadLoading(false); setUploadCount({ done: 0, total: 0 })
    if (fileRef.current) fileRef.current.value = ''
    refetch()
  }

  async function handleCookiesUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setCookiesUploading(true)
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await api.post<{ ok: boolean; cookies: number }>('/settings/upload-youtube-cookies', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      toast.success(`Cookies YouTube atualizadas — ${res.data.cookies} entradas`)
    } catch (err: any) { toast.error(err.response?.data?.error ?? 'Erro ao enviar cookies') }
    finally { setCookiesUploading(false); if (cookiesFileRef.current) cookiesFileRef.current.value = '' }
  }

  function copyStreamUrl(file: any) {
    const url = mediaStreamUrl(file.hlsPath)
    if (!url) { toast.error('Arquivo sem URL disponível'); return }
    navigator.clipboard.writeText(`${window.location.origin}${url}`).then(() => toast.success('URL copiada'))
  }

  const orphanCount = files.filter(f => f._count.clips === 0).length
  const totalSize   = files.reduce((acc, f) => acc + Number(f.sizeBytes ?? 0), 0)

  return (
    <div className="p-6 space-y-4">
      <input ref={fileRef} type="file" multiple accept="video/*,image/*,.mxf,.mts,.m2ts" className="hidden" onChange={handleUpload} />
      <input ref={cookiesFileRef} type="file" accept=".txt" className="hidden" onChange={handleCookiesUpload} />

      {/* ── Título ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <HardDrive className="h-6 w-6 text-brand-400 flex-shrink-0" />
        <span className="text-xl font-bold text-white">Mídias</span>
        <span className="text-gray-500 text-sm">
          {files.length} arquivo(s) · {formatSize(String(totalSize))}
          {orphanCount > 0 && <span className="ml-2 text-orange-400">· {orphanCount} órfã(s)</span>}
        </span>
      </div>

      {/* ── Filtros + botões — tudo numa linha ──────────────────────────────── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Filter className="h-3.5 w-3.5 text-gray-500 flex-shrink-0" />

        {/* Todos — limpa todos os filtros */}
        {(() => {
          const allClear = !filterOrphan && !filterStatus && !filterTypeId
          return (
            <button onClick={() => { setFilterOrphan(false); setFilterStatus(''); setFilterTypeId('') }}
              className={clsx('px-2 py-1 rounded text-xs font-medium transition-colors',
                allClear ? 'bg-brand-600/30 text-brand-300 ring-1 ring-brand-500/40' : 'bg-gray-800 text-gray-400 hover:bg-gray-700')}>
              Todos
            </button>
          )
        })()}

        {/* Órfãos */}
        <button onClick={() => setFilterOrphan(v => !v)}
          className={clsx('flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors',
            filterOrphan ? 'bg-orange-600/30 text-orange-300 ring-1 ring-orange-500/40' : 'bg-gray-800 text-gray-400 hover:bg-gray-700')}>
          <AlertTriangle className="h-3 w-3" />Órfãos
        </button>

        {/* Status do storage */}
        {['READY', 'ERROR', 'PENDING', 'PROCESSING'].map(s => (
          <button key={s} onClick={() => setFilterStatus(filterStatus === s ? '' : s)}
            className={clsx('px-2 py-1 rounded text-xs font-medium transition-colors',
              filterStatus === s ? 'bg-brand-600/30 text-brand-300 ring-1 ring-brand-500/40' : 'bg-gray-800 text-gray-400 hover:bg-gray-700')}>
            {s}
          </button>
        ))}

        {/* Modalidade do conteúdo */}
        {activeTypes.map(t => (
          <button key={t.id} onClick={() => setFilterTypeId(filterTypeId === t.id ? '' : t.id)}
            className={clsx('px-2 py-1 rounded text-xs font-medium transition-colors', filterTypeId === t.id ? 'ring-1 ring-white/20' : 'bg-gray-800 text-gray-500 hover:bg-gray-700')}
            style={filterTypeId === t.id ? { backgroundColor: t.fontBackColor + '44', color: t.fontColor } : {}}>
            {t.code}
          </button>
        ))}

        {/* Separador */}
        <div className="w-px h-4 bg-gray-700 mx-0.5 flex-shrink-0" />

        {/* Upload + Novo */}
        {uploadLoading && (
          <span className="text-[11px] text-gray-400 flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />{uploadCount.done}/{uploadCount.total} · {uploadProgress}%
          </span>
        )}
        <button onClick={() => fileRef.current?.click()} disabled={uploadLoading}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-gray-800 text-purple-400 hover:bg-gray-700 transition-colors disabled:opacity-50 border border-gray-700">
          <Upload className="h-3 w-3" />Upload
        </button>
        <button onClick={() => navigate('/playout?newClip=1')}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-brand-600/30 text-brand-300 hover:bg-brand-600/50 transition-colors border border-brand-700/40">
          <Plus className="h-3 w-3" />Novo
        </button>

        {/* Cookies YT — sempre no canto direito */}
        <div className="flex-1" />
        <button onClick={() => cookiesFileRef.current?.click()} disabled={cookiesUploading}
          title="Renovar cookies YouTube"
          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-gray-800 text-red-400 hover:bg-gray-700 transition-colors disabled:opacity-50 border border-gray-700">
          <Film className="h-3 w-3" />Cookies YT
        </button>

        {/* Contexto selecionado */}
        {selected && (
          <>
            <div className="flex-1" />
            <div className="w-px h-4 bg-gray-700 flex-shrink-0" />
            <span className="text-sm font-medium text-brand-300 truncate max-w-[180px]" title={selected.originalName}>
              {selected.clips?.[0]?.code || selected.originalName}
            </span>
            {selected.ingestStatus === 'READY' && selected.hlsPath && (
              <button onClick={() => setPreviewFile(selected)} title="Preview"
                className="p-1.5 rounded text-gray-500 hover:text-emerald-400 hover:bg-emerald-900/20 transition-colors">
                <Play className="h-4 w-4" />
              </button>
            )}
            <button onClick={() => copyStreamUrl(selected)} title="Copiar URL"
              className="p-1.5 rounded text-gray-500 hover:text-sky-400 hover:bg-sky-900/20 transition-colors">
              <Copy className="h-4 w-4" />
            </button>
            {selected.ingestStatus === 'READY' && selected.hlsPath && (
              <a href={`${window.location.origin}${mediaStreamUrl(selected.hlsPath)}`} target="_blank" rel="noopener noreferrer"
                className="p-1.5 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-700 transition-colors">
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
            {confirmId === selected.id ? (
              <div className="flex items-center gap-1">
                <span className="text-xs text-red-400">Confirmar?</span>
                <Button size="sm" variant="danger" loading={deleteMut.isPending} onClick={() => deleteMut.mutate(selected.id)}>Sim</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>Não</Button>
              </div>
            ) : (
              <button onClick={() => setConfirmId(selected.id)} title="Excluir arquivo"
                className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-red-900/20 transition-colors">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            <button onClick={() => { setSelected(null); setConfirmId(null) }} className="p-1.5 rounded text-gray-600 hover:text-gray-400 transition-colors text-xs">✕</button>
          </>
        )}
      </div>

      {/* ── Tabela ──────────────────────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-gray-500">Carregando...</div>
        ) : sorted.length === 0 ? (
          <div className="p-12 text-center"><HardDrive className="h-10 w-10 text-gray-700 mx-auto mb-3" /><p className="text-gray-500">Nenhum arquivo encontrado.</p></div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th onClick={() => toggleSort('code')} className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-300 select-none w-24">Código{si('code')}</th>
                <th onClick={() => toggleSort('title')} className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-300 select-none">Título{si('title')}</th>
                <th onClick={() => toggleSort('type')} className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-300 select-none w-20">Tipo{si('type')}</th>
                <th onClick={() => toggleSort('duration')} className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-300 select-none w-24">Duração{si('duration')}</th>
                <th onClick={() => toggleSort('ingestStatus')} className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-300 select-none w-28">Mídia{si('ingestStatus')}</th>
                <th onClick={() => toggleSort('originalName')} className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-300 select-none">Arquivo{si('originalName')}</th>
                <th onClick={() => toggleSort('sizeBytes')} className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-300 select-none w-24">Tamanho{si('sizeBytes')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60">
              {sorted.map(file => {
                const badge = STATUS_BADGE[file.ingestStatus] ?? STATUS_BADGE.PENDING
                const isOrphan = file._count.clips === 0
                const isSelected = selected?.id === file.id
                const clip = file.clips?.[0]
                return (
                  <tr key={file.id} onClick={() => setSelected(isSelected ? null : file)}
                    className={clsx('transition-colors cursor-pointer',
                      isSelected ? 'bg-brand-900/20 ring-1 ring-inset ring-brand-700/40' :
                      isOrphan   ? 'bg-orange-950/10 hover:bg-orange-950/20' :
                                   'hover:bg-gray-800/30')}>

                    {/* Código */}
                    <td className="px-4 py-2.5">
                      {clip ? (
                        <span style={{ fontFamily:'monospace', fontWeight:700, fontSize:11, padding:'1px 6px', borderRadius:3, background:'#1e3a5f', color:'#93c5fd', border:'1px solid #2563eb' }}>
                          {clip.code}
                        </span>
                      ) : <span className="text-gray-700 text-xs">—</span>}
                    </td>

                    {/* Título */}
                    <td className="px-4 py-2.5">
                      <div className="min-w-0">
                        <p className={clsx('font-medium truncate max-w-xs', isOrphan ? 'text-orange-300/70' : 'text-white')}>
                          {clip?.title || <span className="text-gray-600 italic text-xs">{file.originalName}</span>}
                        </p>
                        {isOrphan && <span className="text-[10px] text-orange-500">sem clipe vinculado</span>}
                        {file.errorMsg && <p className="text-[11px] text-red-400 truncate" title={file.errorMsg}>{file.errorMsg}</p>}
                      </div>
                    </td>

                    {/* Tipo */}
                    <td className="px-4 py-2.5">
                      {clip?.type ? (
                        <Badge bg={clip.type.fontBackColor} color={clip.type.fontColor} className="text-[10px]">{clip.type.code}</Badge>
                      ) : clip?.sourceType ? (
                        <span className={clsx('text-[10px] px-1.5 py-0.5 rounded border font-mono', MEDIA_TYPE[clip.sourceType]?.cls)}>{clip.sourceType}</span>
                      ) : <span className="text-gray-700 text-xs">—</span>}
                    </td>

                    {/* Duração */}
                    <td className="px-4 py-2.5 font-mono text-gray-400 text-xs">{formatDur(file.duration)}</td>

                    {/* Mídia (status ingest) */}
                    <td className="px-4 py-2.5">
                      <span className={clsx('flex items-center gap-1.5 w-fit px-2 py-0.5 rounded border text-[11px] font-medium', badge.cls)}>
                        {badge.icon}{badge.label}
                      </span>
                    </td>

                    {/* Arquivo original */}
                    <td className="px-4 py-2.5">
                      <p className="text-gray-500 text-xs truncate max-w-[180px]" title={file.originalName}>{file.originalName}</p>
                    </td>

                    {/* Tamanho */}
                    <td className="px-4 py-2.5 text-gray-400 text-xs">{formatSize(file.sizeBytes)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Modal preview ────────────────────────────────────────────────────── */}
      <Modal open={!!previewFile} onClose={() => setPreviewFile(null)} title={previewFile?.clips?.[0]?.title || previewFile?.originalName || 'Preview'} size="lg">
        {previewFile && mediaStreamUrl(previewFile.hlsPath) && (
          <div className="space-y-3">
            <div className="relative w-full aspect-video">
              <VideoPlayer src={mediaStreamUrl(previewFile.hlsPath)!} className="w-full h-full" autoPlay />
            </div>
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span>Duração: <span className="font-mono text-gray-300">{formatDur(previewFile.duration)}</span></span>
              <span>Tamanho: <span className="text-gray-300">{formatSize(previewFile.sizeBytes)}</span></span>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
