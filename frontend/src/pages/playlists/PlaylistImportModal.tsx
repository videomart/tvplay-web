import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload, FileText, CheckCircle2, XCircle, ChevronDown, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import { clipsApi, type Clip } from '../../api/clips.api'
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
  arquivo: string
  inicio: string
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

  // Find header line (contains "CODIGO")
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
      arquivo:  f['ARQUIVO'] ?? '',
      inicio:   f['INICIO'] ?? '',
    })
  }

  // Group by PROGRAMA preserving order
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

// ── Component ──────────────────────────────────────────────────────────────

export default function PlaylistImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
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
    let totalCreated = 0
    let totalSkipped = 0
    try {
      for (const prog of parsed.programs) {
        const found = prog.items.filter((r) => clipByCode.has(r.code))
        totalSkipped += prog.items.length - found.length
        if (found.length === 0) continue

        const playlist = await playlistsApi.create({
          date: parsed.date,
          programName: prog.name,
          channelId: channelId || null,
        })

        for (let i = 0; i < found.length; i++) {
          const row = found[i]
          await playlistsApi.addItem(playlist.id, {
            clipId: clipByCode.get(row.code)!.id,
            order: i,
            breakNum: row.breakNum,
          })
          totalCreated++
        }
      }

      const msg = totalSkipped > 0
        ? `${totalCreated} clipe(s) importado(s) — ${totalSkipped} código(s) não encontrado(s) no sistema`
        : `${totalCreated} clipe(s) importado(s) com sucesso`
      toast.success(msg, { duration: 5000 })
      qc.invalidateQueries({ queryKey: ['playlists'] })
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
    onClose()
  }

  const totalFound = parsed?.programs.reduce((acc, p) => acc + p.items.filter((r) => clipByCode.has(r.code)).length, 0) ?? 0
  const totalRows = parsed?.programs.reduce((acc, p) => acc + p.items.length, 0) ?? 0

  return (
    <Modal open={open} onClose={handleClose} title="Importar Roteiro de Programação" size="lg">
      <div className="space-y-4">

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

        {/* Configurações de importação */}
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
                const foundCount = prog.items.filter((r) => clipByCode.has(r.code)).length
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
                        <span className="text-emerald-400">{foundCount} encontrado(s)</span>
                        {prog.items.length - foundCount > 0 && (
                          <span className="text-amber-400">{prog.items.length - foundCount} não encontrado(s)</span>
                        )}
                      </div>
                    </button>

                    {isOpen && (
                      <div className="divide-y divide-gray-800/60">
                        {prog.items.map((row, idx) => {
                          const found = clipByCode.has(row.code)
                          return (
                            <div key={idx} className={clsx(
                              'flex items-center gap-2 px-3 py-1.5 text-xs',
                              found ? 'text-gray-300' : 'text-gray-600'
                            )}>
                              {found
                                ? <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                                : <XCircle className="h-3 w-3 text-amber-600 shrink-0" />
                              }
                              <span className="font-mono w-20 shrink-0">{row.code}</span>
                              <span className={clsx('text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0',
                                found ? 'bg-gray-700 text-gray-400' : 'bg-gray-800 text-gray-700'
                              )}>{row.tipo}</span>
                              <span className="flex-1 truncate">{row.titulo}</span>
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

            {totalRows - totalFound > 0 && (
              <p className="text-xs text-amber-400/80 bg-amber-950/30 border border-amber-800/40 rounded px-2.5 py-1.5">
                {totalRows - totalFound} clipe(s) com código não cadastrado no sistema serão ignorados na importação.
              </p>
            )}
          </>
        )}

        <div className="flex gap-3 justify-end pt-2">
          <Button variant="secondary" onClick={handleClose}>Cancelar</Button>
          {parsed && (
            <Button
              loading={importing}
              disabled={totalFound === 0}
              onClick={handleImport}
            >
              Importar {parsed.programs.length} playlist(s) · {totalFound} clipe(s)
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
