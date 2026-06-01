import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { HardDrive, Trash2, AlertTriangle, CheckCircle, Clock, XCircle, Filter, Upload, ChevronUp, ChevronDown, Copy } from 'lucide-react'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import { clipsApi, type MediaFile } from '../../api/clips.api'
import { Button } from '../../components/ui/Button'

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

const STATUS_BADGE: Record<string, { label: string; cls: string; icon: JSX.Element }> = {
  READY:       { label: 'Pronto',       cls: 'bg-emerald-900/40 text-emerald-400 border-emerald-700/40', icon: <CheckCircle className="h-3 w-3" /> },
  PENDING:     { label: 'Pendente',     cls: 'bg-gray-800 text-gray-500 border-gray-700/40',             icon: <Clock className="h-3 w-3" /> },
  PROCESSING:  { label: 'Transcodando', cls: 'bg-amber-900/40 text-amber-400 border-amber-700/40',       icon: <Clock className="h-3 w-3 animate-spin" /> },
  TRANSCODING: { label: 'Transcodando', cls: 'bg-amber-900/40 text-amber-400 border-amber-700/40',       icon: <Clock className="h-3 w-3 animate-spin" /> },
  ERROR:       { label: 'Erro',         cls: 'bg-red-900/40 text-red-400 border-red-700/40',             icon: <XCircle className="h-3 w-3" /> },
}

export default function MediaFilesPage() {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [filterOrphan, setFilterOrphan] = useState(false)
  const [filterStatus, setFilterStatus] = useState('')
  const [confirmId,    setConfirmId]    = useState<string | null>(null)
  const [sortBy,       setSortBy]       = useState('originalName')
  const [sortDir,      setSortDir]      = useState<'asc' | 'desc'>('asc')
  const [uploadLoading, setUploadLoading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadCount, setUploadCount] = useState({ done: 0, total: 0 })

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

  const { data: files = [], isLoading, refetch } = useQuery({
    queryKey: ['media-files', filterOrphan, filterStatus],
    queryFn: () => clipsApi.listMedia({ orphan: filterOrphan || undefined, status: filterStatus || undefined }),
    staleTime: 15_000,
    refetchInterval: (q) => q.state.data?.some((f: any) => ['PENDING','PROCESSING','TRANSCODING'].includes(f.ingestStatus)) ? 3000 : false,
  })

  const sorted = [...files].sort((a, b) => {
    let av: any, bv: any
    switch (sortBy) {
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

  const deleteMut = useMutation({
    mutationFn: (id: string) => clipsApi.deleteMedia(id),
    onSuccess: (data) => {
      toast.success(`Arquivo excluído — ${data.deletedObjects} objeto(s) removidos do storage`)
      qc.invalidateQueries({ queryKey: ['media-files'] })
      qc.invalidateQueries({ queryKey: ['clips'] })
      qc.invalidateQueries({ queryKey: ['clips-library'] })
      setConfirmId(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao excluir'),
  })

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setUploadLoading(true); setUploadCount({ done: 0, total: files.length }); setUploadProgress(0)
    let errors = 0
    for (let i = 0; i < files.length; i++) {
      try { await clipsApi.uploadMediaDirect(files[i], setUploadProgress); setUploadCount({ done: i + 1, total: files.length }) }
      catch { errors++ }
    }
    errors === 0 ? toast.success(`${files.length} arquivo(s) enviado(s). Transcodificação em andamento.`) : toast.error(`${errors} arquivo(s) falharam.`)
    setUploadLoading(false); setUploadCount({ done: 0, total: 0 })
    if (fileRef.current) fileRef.current.value = ''
    refetch()
  }

  const orphanCount = files.filter(f => f._count.clips === 0).length
  const totalSize   = files.reduce((acc, f) => acc + Number(f.sizeBytes ?? 0), 0)

  return (
    <div className="p-6 space-y-4">
      <input ref={fileRef} type="file" multiple accept="video/*,image/*,.mxf,.mts,.m2ts" className="hidden" onChange={handleUpload} />

      {/* ── Cabeçalho ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <HardDrive className="h-6 w-6 text-brand-400" />
            Mídias
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {files.length} arquivo(s) · {formatSize(String(totalSize))} total
            {orphanCount > 0 && <span className="ml-2 text-orange-400">· {orphanCount} sem clipe vinculado</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {uploadLoading && (
            <span className="text-xs text-gray-400">
              {uploadCount.done}/{uploadCount.total} · {uploadProgress}%
            </span>
          )}
          <Button
            variant="secondary"
            loading={uploadLoading}
            onClick={() => fileRef.current?.click()}
            icon={<Upload className="h-4 w-4 text-purple-400" />}
          >
            Upload de Mídia
          </Button>
        </div>
      </div>

      {/* ── Filtros ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-4 w-4 text-gray-500 flex-shrink-0" />
        <button
          onClick={() => setFilterOrphan(v => !v)}
          className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
            filterOrphan ? 'bg-orange-600/30 text-orange-300 ring-1 ring-orange-500/40' : 'bg-gray-800 text-gray-400 hover:bg-gray-700')}>
          <AlertTriangle className="h-3.5 w-3.5" />Somente órfãos
        </button>
        {['', 'READY', 'ERROR', 'PENDING', 'PROCESSING'].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)}
            className={clsx('px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              filterStatus === s ? 'bg-brand-600/30 text-brand-300 ring-1 ring-brand-500/40' : 'bg-gray-800 text-gray-400 hover:bg-gray-700')}>
            {s || 'Todos'}
          </button>
        ))}
      </div>

      {/* ── Tabela ──────────────────────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-gray-500">Carregando...</div>
        ) : sorted.length === 0 ? (
          <div className="p-12 text-center">
            <HardDrive className="h-10 w-10 text-gray-700 mx-auto mb-3" />
            <p className="text-gray-500">Nenhum arquivo encontrado.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th onClick={() => toggleSort('originalName')} className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-300">
                  Arquivo{si('originalName')}
                </th>
                <th onClick={() => toggleSort('ingestStatus')} className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-300">
                  Status{si('ingestStatus')}
                </th>
                <th onClick={() => toggleSort('duration')} className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-300">
                  Duração{si('duration')}
                </th>
                <th onClick={() => toggleSort('sizeBytes')} className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-300">
                  Tamanho{si('sizeBytes')}
                </th>
                <th onClick={() => toggleSort('clips')} className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-300">
                  Clipes{si('clips')}
                </th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                  Path HLS
                </th>
                <th className="w-24 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60">
              {sorted.map(file => {
                const badge = STATUS_BADGE[file.ingestStatus] ?? STATUS_BADGE.PENDING
                const isOrphan = file._count.clips === 0
                const isConfirming = confirmId === file.id
                const hlsPath = (file as any).hlsPath ?? (file as any).storagePath ?? null
                return (
                  <tr key={file.id} className={clsx('transition-colors',
                    isOrphan ? 'bg-orange-950/10 hover:bg-orange-950/20' : 'hover:bg-gray-800/30')}>

                    {/* Arquivo */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {isOrphan && <AlertTriangle className="h-3.5 w-3.5 text-orange-400 flex-shrink-0" />}
                        <div className="min-w-0">
                          <p className="text-white font-medium truncate max-w-xs">{file.originalName}</p>
                          {file.clips.length > 0 && (
                            <p className="text-[11px] text-gray-500 truncate">
                              {file.clips.map(c => c.code).join(', ')}
                              {file._count.clips > 3 && ` +${file._count.clips - 3}`}
                            </p>
                          )}
                          {file.errorMsg && (
                            <p className="text-[11px] text-red-400 truncate max-w-xs" title={file.errorMsg}>{file.errorMsg}</p>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <span className={clsx('flex items-center gap-1.5 w-fit px-2 py-0.5 rounded border text-[11px] font-medium', badge.cls)}>
                        {badge.icon}{badge.label}
                      </span>
                    </td>

                    {/* Duração */}
                    <td className="px-4 py-3 font-mono text-gray-400 text-xs">{formatDur(file.duration)}</td>

                    {/* Tamanho */}
                    <td className="px-4 py-3 text-gray-400 text-xs">{formatSize(file.sizeBytes)}</td>

                    {/* Clipes */}
                    <td className="px-4 py-3">
                      {file._count.clips === 0
                        ? <span className="text-[11px] text-orange-400 font-medium">nenhum</span>
                        : <span className="text-[11px] text-gray-400">{file._count.clips}</span>}
                    </td>

                    {/* Path HLS */}
                    <td className="px-4 py-3">
                      {hlsPath ? (
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className="text-[10px] font-mono text-gray-600 truncate max-w-[180px] cursor-help"
                            title={hlsPath}
                          >
                            {hlsPath}
                          </span>
                          <button
                            onClick={() => { navigator.clipboard.writeText(hlsPath); toast.success('Path copiado') }}
                            className="flex-shrink-0 p-0.5 rounded text-gray-700 hover:text-gray-400 transition-colors"
                            title="Copiar path"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-gray-700 text-xs">—</span>
                      )}
                    </td>

                    {/* Ações */}
                    <td className="px-4 py-3 text-right">
                      {isConfirming ? (
                        <div className="flex items-center gap-1 justify-end">
                          <span className="text-[11px] text-red-400 mr-1">Confirmar?</span>
                          <Button size="sm" variant="danger" loading={deleteMut.isPending} onClick={() => deleteMut.mutate(file.id)}>Sim</Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>Não</Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5 text-red-500" />}
                          onClick={() => setConfirmId(file.id)} title="Excluir arquivo" />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
