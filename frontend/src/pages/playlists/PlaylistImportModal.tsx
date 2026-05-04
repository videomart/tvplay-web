import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload, FileText, CheckCircle2, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import { clipsApi, type Clip, type ClipModality, MODALITY_LABELS } from '../../api/clips.api'
import { clipTypesApi } from '../../api/clip-types.api'
import { clientsApi } from '../../api/clients.api'
import { channelsApi } from '../../api/channels.api'
import { playlistsApi } from '../../api/playlists.api'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Input'

// ── Parser ─────────────────────────────────────────────────────────────────

interface ParsedRow {
  code: string
  dur: number
  tipo: string
  titulo: string
  cliente: string
  programa: string
  breakNum: number
}

interface ProgramGroup {
  name: string
  items: ParsedRow[]
}

interface ParsedFile {
  date: string
  programs: ProgramGroup[]
}

function parseHeaderCols(header: string): { name: string; start: number }[] {
  const cols: { name: string; start: number }[] = []
  let i = 0
  while (i < header.length) {
    if (header[i] !== ' ') {
      const start = i
      while (i < header.length && header[i] !== ' ') i++
      cols.push({ name: header.slice(start, i), start })
    } else {
      i++
    }
  }
  return cols
}

function extractFields(line: string, cols: { name: string; start: number }[]): Record<string, string> {
  const r: Record<string, string> = {}
  for (let i = 0; i < cols.length; i++) {
    const s = cols[i].start
    const e = i + 1 < cols.length ? cols[i + 1].start : line.length
    r[cols[i].name] = line.slice(s, Math.min(e, line.length)).trim()
  }
  return r
}

function parseRoteiro(text: string): ParsedFile {
  const clean = text.replace(/^﻿/, '').replace(/\r/g, '')
  const lines = clean.split('\n')

  const dateLine = lines[0]?.trim() ?? ''
  const parts = dateLine.split('/')
  const date = parts.length === 3
    ? `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
    : new Date().toISOString().slice(0, 10)

  let headerIdx = lines.findIndex((l) => l.includes('CODIGO'))
  if (headerIdx === -1) headerIdx = 1
  const cols = parseHeaderCols(lines[headerIdx])

  const rows: ParsedRow[] = []
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim() || line.trim().startsWith('=')) continue
    const f = extractFields(line, cols)
    if (!f['CODIGO'] || f['CODIGO'] === 'BLOCO') continue
    rows.push({
      code:     f['CODIGO'] ?? '',
      dur:      parseInt(f['DUR'] ?? '0') || 0,
      tipo:     f['TIPO'] ?? '',
      titulo:   f['TITULO'] ?? '',
      cliente:  f['CLIENTE'] ?? '',
      programa: f['PROGRAMA'] ?? 'SEM PROGRAMA',
      breakNum: parseInt(f['BREAK'] ?? '1') || 1,
    })
  }

  const seen = new Map<string, ParsedRow[]>()
  for (const row of rows) {
    if (!seen.has(row.programa)) seen.set(row.programa, [])
    seen.get(row.programa)!.push(row)
  }

  return {
    date,
    programs: Array.from(seen.entries()).map(([name, items]) => ({ name, items })),
  }
}

const VALID_MODALITIES = new Set<string>(['BK','AR','PT','VH','CP','CA','LV','ID','MT'])

// ── Component ──────────────────────────────────────────────────────────────

// ── Formatos suportados ────────────────────────────────────────────────────

const FORMATS = [
  { id: 'playlist-builder', label: 'Playlist-Builder', enabled: true },
  { id: 'media-plus',       label: 'Media+',           enabled: true },
  { id: 'syscom',           label: 'SYSCOM — Globo',   enabled: false },
  { id: 'sbt',              label: 'SBT',               enabled: false },
  { id: 'record',           label: 'RECORD',            enabled: false },
  { id: 'csv-excel',        label: 'CSV / Excel',       enabled: false },
  { id: 'ical',             label: 'iCal',              enabled: false },
  { id: 'mos-xml',          label: 'MOS / XML',         enabled: false },
]

export default function PlaylistImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [format, setFormat] = useState('playlist-builder')
  const [parsed, setParsed] = useState<ParsedFile | null>(null)
  const [channelId, setChannelId] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)

  const { data: allClips = [] } = useQuery<Clip[]>({
    queryKey: ['clips-all-import'],
    queryFn: async () => {
      const clips: Clip[] = []
      let page = 1
      while (true) {
        const res = await clipsApi.list({ page })
        clips.push(...res.items)
        if (clips.length >= res.total) break
        page++
      }
      return clips
    },
    enabled: open,
    staleTime: 60_000,
  })
  const { data: channels = [] } = useQuery({ queryKey: ['channels'], queryFn: channelsApi.list })

  const clipByCode = new Map<string, Clip>(allClips.map((c) => [c.code, c]))

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const result = parseRoteiro(ev.target?.result as string)
        setParsed(result)
        setExpanded(new Set(result.programs.map((p) => p.name)))
      } catch {
        toast.error('Não foi possível analisar o arquivo.')
      }
    }
    reader.readAsText(file, 'utf-8')
    e.target.value = ''
  }

  function toggleExpand(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  async function handleImport() {
    if (!parsed) return
    setImporting(true)
    let totalAdded = 0
    let totalCreated = 0

    try {
      // Snapshot atual de tipos e clientes para "find or create"
      const [currentTypes, currentClients] = await Promise.all([
        clipTypesApi.list(),
        clientsApi.list(),
      ])
      const typeByCode  = new Map(currentTypes.map((t) => [t.code.toUpperCase(), t]))
      const clientByName = new Map(currentClients.map((c) => [c.name.toUpperCase(), c]))
      const localClipMap = new Map<string, Clip>(allClips.map((c) => [c.code, c]))

      for (const prog of parsed.programs) {
        if (prog.items.length === 0) continue

        const playlist = await playlistsApi.create({
          date:      parsed.date,
          channelId: channelId || null,
          // name omitido: backend gera DDMMAA-N baseado na data do roteiro
        })

        for (let i = 0; i < prog.items.length; i++) {
          const row = prog.items[i]
          let clip = localClipMap.get(row.code)

          if (!clip) {
            // Encontra ou cria o tipo de clipe
            const typeCode = row.tipo.toUpperCase()
            let typeId: string | undefined
            if (typeCode) {
              if (!typeByCode.has(typeCode)) {
                const newType = await clipTypesApi.create({
                  name: MODALITY_LABELS[typeCode as ClipModality] ?? typeCode,
                  code: typeCode,
                  fontColor: '#FFFFFF',
                  fontBackColor: '#374151',
                })
                typeByCode.set(typeCode, newType)
              }
              typeId = typeByCode.get(typeCode)?.id
            }

            // Encontra ou cria o cliente
            const clientName = row.cliente.trim()
            let clientId: string | undefined
            if (clientName) {
              if (!clientByName.has(clientName.toUpperCase())) {
                const newClient = await clientsApi.create({ name: clientName })
                clientByName.set(clientName.toUpperCase(), newClient)
              }
              clientId = clientByName.get(clientName.toUpperCase())?.id
            }

            // Cria o clipe (sem arquivo de mídia)
            const modality = VALID_MODALITIES.has(row.tipo.toUpperCase())
              ? (row.tipo.toUpperCase() as ClipModality)
              : 'AR'
            clip = await clipsApi.create({
              code:      row.code,
              title:     row.titulo || row.code,
              modality,
              cueIn:     0,
              cueOut:    row.dur > 0 ? row.dur : undefined,
              duration:  row.dur > 0 ? row.dur : undefined,
              typeId,
              clientId,
            })
            localClipMap.set(row.code, clip)
            totalCreated++
          }

          await playlistsApi.addItem(playlist.id, {
            clipId: clip.id,
            order: i,
            breakNum: row.breakNum,
          })
          totalAdded++
        }
      }

      const parts = [`${totalAdded} clipe(s) adicionado(s)`]
      if (totalCreated > 0) parts.push(`${totalCreated} criado(s) automaticamente sem arquivo`)
      toast.success(parts.join(' — '), { duration: 6000 })
      qc.invalidateQueries({ queryKey: ['playlists'] })
      qc.invalidateQueries({ queryKey: ['clips'] })
      qc.invalidateQueries({ queryKey: ['clip-types'] })
      qc.invalidateQueries({ queryKey: ['clients'] })
      handleClose()
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? 'Erro ao importar')
    } finally {
      setImporting(false)
    }
  }

  function handleClose() {
    setParsed(null)
    setChannelId('')
    setExpanded(new Set())
    setFormat('playlist-builder')
    onClose()
  }

  const totalRows = parsed?.programs.reduce((acc, p) => acc + p.items.length, 0) ?? 0
  const totalNew  = parsed?.programs.reduce((acc, p) =>
    acc + p.items.filter((r) => !clipByCode.has(r.code)).length, 0) ?? 0

  return (
    <Modal open={open} onClose={handleClose} title="Importar Roteiro de Programação" size="lg">
      <div className="space-y-4">

        {/* Seletor de formato */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Formato do arquivo</p>
          <div className="flex flex-wrap gap-1.5">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                disabled={!f.enabled}
                onClick={() => { if (f.enabled) { setFormat(f.id); setParsed(null) } }}
                className={clsx(
                  'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors border',
                  f.enabled
                    ? format === f.id
                      ? 'bg-brand-600/30 border-brand-500/50 text-brand-300'
                      : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500'
                    : 'bg-gray-900 border-gray-800 text-gray-600 cursor-not-allowed'
                )}
              >
                {f.label}
                {!f.enabled && (
                  <span className="text-[9px] px-1 py-0.5 rounded bg-gray-800 text-gray-600 border border-gray-700">
                    em breve
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Seletor de arquivo */}
        {!parsed ? (
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full border-2 border-dashed border-gray-700 rounded-xl py-12 flex flex-col items-center gap-3 text-gray-500 hover:border-brand-500 hover:text-brand-400 transition-colors"
          >
            <Upload className="h-8 w-8" />
            <span className="text-sm font-medium">Clique para selecionar o arquivo de roteiro</span>
            <span className="text-xs text-gray-600">Formatos: PLAYLIST-BUILDER / Media+ (.txt)</span>
          </button>
        ) : (
          <div className="flex items-center justify-between rounded-lg bg-gray-800/60 px-3 py-2">
            <div className="flex items-center gap-2 text-sm text-gray-300">
              <FileText className="h-4 w-4 text-brand-400" />
              <span className="font-medium">{new Date(parsed.date + 'T12:00:00').toLocaleDateString('pt-BR')}</span>
              <span className="text-gray-600">·</span>
              <span>{parsed.programs.length} programa(s)</span>
              <span className="text-gray-600">·</span>
              <span>{totalRows} itens</span>
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              Trocar arquivo
            </button>
          </div>
        )}

        <input ref={fileRef} type="file" accept=".txt,.log,.rpt" className="hidden" onChange={handleFileChange} />

        {parsed && (
          <>
            <Select label="Canal (opcional)" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
              <option value="">Ambos os canais</option>
              {channels.filter((c) => c.active).map((ch) => (
                <option key={ch.id} value={ch.id}>Canal {ch.number} — {ch.name}</option>
              ))}
            </Select>

            {/* Preview dos programas */}
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {parsed.programs.map((prog) => {
                const newCount = prog.items.filter((r) => !clipByCode.has(r.code)).length
                const isOpen = expanded.has(prog.name)
                return (
                  <div key={prog.name} className="border border-gray-800 rounded-lg overflow-hidden">
                    <button
                      onClick={() => toggleExpand(prog.name)}
                      className="w-full flex items-center justify-between px-3 py-2 bg-gray-800/60 hover:bg-gray-800 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-gray-500" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-500" />}
                        <span className="text-sm font-medium text-white">{prog.name}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-emerald-400">{prog.items.length - newCount} no sistema</span>
                        {newCount > 0 && (
                          <span className="text-orange-400">{newCount} serão criados</span>
                        )}
                      </div>
                    </button>

                    {isOpen && (
                      <div className="divide-y divide-gray-800/60">
                        {prog.items.map((row, idx) => {
                          const inSystem = clipByCode.has(row.code)
                          return (
                            <div key={idx} className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300">
                              {inSystem
                                ? <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                                : <AlertCircle  className="h-3 w-3 text-orange-400 shrink-0" />
                              }
                              <span className="font-mono w-20 shrink-0">{row.code}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 bg-gray-700 text-gray-400">
                                {row.tipo}
                              </span>
                              <span className="flex-1 truncate">{row.titulo}</span>
                              {!inSystem && (
                                <span className="text-[9px] px-1 py-0.5 rounded bg-orange-900/40 text-orange-400 border border-orange-700/40 shrink-0">
                                  sem arquivo
                                </span>
                              )}
                              <span className="text-gray-600 shrink-0 w-8 text-right">
                                {row.dur > 0 ? `${row.dur}s` : '—'}
                              </span>
                              <span className="text-gray-700 shrink-0 w-6 text-right">B{row.breakNum}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {totalNew > 0 && (
              <p className="text-xs text-orange-400/80 bg-orange-950/30 border border-orange-800/40 rounded px-2.5 py-1.5">
                {totalNew} clipe(s) não encontrado(s) serão criados automaticamente sem arquivo de mídia.
                Aparecerão com indicação <strong>"sem arquivo"</strong> nas playlists e devem receber upload antes da exibição.
              </p>
            )}
          </>
        )}

        <div className="flex gap-3 justify-end pt-2">
          <Button variant="secondary" onClick={handleClose}>Cancelar</Button>
          {parsed && totalRows > 0 && (
            <Button loading={importing} onClick={handleImport}>
              Importar {parsed.programs.length} playlist(s) · {totalRows} clipe(s)
              {totalNew > 0 && ` (${totalNew} novos)`}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
