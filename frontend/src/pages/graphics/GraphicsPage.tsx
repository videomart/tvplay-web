import { useRef, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Layers, Layers2, Upload, ToggleLeft, ToggleRight, ArrowLeft, Eye } from 'lucide-react'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import { api } from '../../api/client'
import { graphicsApi, type Graphic, FACTORY_TEMPLATE_SIMPLES, TEMPLATE_SIMPLES_ELEM_LOGO, TEMPLATE_SIMPLES_ELEM_CLOCK, TEMPLATE_SIMPLES_ELEM_TEXT } from '../../api/graphics.api'
import { graphicTemplatesApi, type GraphicTemplate, type GraphicElement, type GraphicPosition, ELEMENT_TYPE_LABELS, POSITION_LABELS } from '../../api/graphic-templates.api'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Table, Thead, Th, Tbody, Tr, Td } from '../../components/ui/Table'

// ─── Grid de posições (mesmo layout do editor de templates) ─────────────────

const POSITION_GRID_ROWS: GraphicPosition[][] = [
  ['TL', 'TC', 'TR'],
  ['ML', 'MC', 'MR'],
  ['BL', 'BC', 'BR'],
]

// ─── Preview visual 16:9 ────────────────────────────────────────────────────

const POS_STYLE: Record<GraphicPosition, React.CSSProperties> = {
  TL: { top: 8, left: 8 },
  TC: { top: 8, left: '50%', transform: 'translateX(-50%)' },
  TR: { top: 8, right: 8 },
  ML: { top: '50%', left: 8, transform: 'translateY(-50%)' },
  MC: { top: '50%', left: '50%', transform: 'translate(-50%,-50%)' },
  MR: { top: '50%', right: 8, transform: 'translateY(-50%)' },
  BL: { bottom: 8, left: 8 },
  BC: { bottom: 8, left: '50%', transform: 'translateX(-50%)' },
  BR: { bottom: 8, right: 8 },
  BAR_TOP:    { top: 0, left: 0, right: 0 },
  BAR_BOTTOM: { bottom: 0, left: 0, right: 0 },
}

function GraphicPreview({
  template,
  elementValues,
}: {
  template: GraphicTemplate | null
  elementValues: Record<string, Record<string, any>>
}) {
  const merged = (template?.elements ?? []).map(el => ({
    ...el,
    ...(elementValues[el.id] ?? {}),
  }))
  const active = merged.filter(el => el.active !== false)

  const [rssTexts, setRssTexts] = useState<Record<string, string>>({})
  useEffect(() => {
    const tickers = active.filter(el => el.type === 'TICKER' && el.rssUrl)
    if (!tickers.length) return
    tickers.forEach((el: any) => {
      api.get(`/ticker/rss?url=${encodeURIComponent(el.rssUrl)}`)
        .then(r => { if (r.data?.text) setRssTexts(prev => ({ ...prev, [el.id]: r.data.text })) })
        .catch(() => {})
    })
  }, [active.map((e: any) => e.id + (e.rssUrl ?? '')).join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
    <style>{`@keyframes gfx-ticker{0%{transform:translateX(0)}100%{transform:translateX(-100%)}}`}</style>
    <div className="relative w-full bg-black rounded-t-lg overflow-hidden" style={{ aspectRatio: '16/9' }}>
      <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center">
        <span className="text-gray-700 text-xs uppercase tracking-widest">Vídeo</span>
      </div>
      {active.map((el) => {
        const posStyle = POS_STYLE[el.position as GraphicPosition] ?? { top: 8, left: 8 }
        const isBar = (el.position as string).startsWith('BAR')
        const fs = Math.max(7, Math.round((el.fontSize ?? 32) * 0.35))
        const base: React.CSSProperties = {
          position: 'absolute', ...posStyle,
          backgroundColor: el.bgColor ?? 'transparent',
          color: el.fontColor ?? '#fff',
          fontSize: fs,
          fontWeight: el.bold ? 'bold' : 'normal',
          padding: isBar ? '3px 6px' : '2px 5px',
          borderRadius: isBar ? 0 : 3,
          overflow: 'hidden',
          maxWidth: isBar ? '100%' : '45%',
          opacity: el.opacity ?? 1,
          whiteSpace: 'nowrap',
          zIndex: 10,
        }
        switch (el.type) {
          case 'LOGO':
            return el.imageUrl
              ? <img key={el.id} src={el.imageUrl} style={{ ...base, backgroundColor: 'transparent', width: el.width ? el.width * 0.35 : 60, height: 'auto' }} alt="logo" />
              : <div key={el.id} style={base} className="text-[7px] bg-gray-700/80 text-gray-300">🖼️ LOGO</div>
          case 'CLOCK':
            return <div key={el.id} style={base}>{new Date().toLocaleTimeString('pt-BR')}</div>
          case 'TEXT':
            return <div key={el.id} style={base}>{el.text || 'Texto'}</div>
          case 'TICKER': {
            const speed    = Math.max(1, (el as any).tickerSpeed ?? 5)
            const loop     = (el as any).tickerLoop !== false
            const previewSpeed = Math.max(speed, 30)
            const duration = Math.max(2, Math.round(3000 / previewSpeed))
            const tickerText = el.rssUrl
              ? (rssTexts[el.id] ?? '⏳ carregando RSS...')
              : (el.text || 'Ticker...')
            const isBot = (el.position as string).startsWith('B')
            const isBar = el.position === 'BAR_BOTTOM' || el.position === 'BAR_TOP'
            return (
              <div key={el.id} style={{
                position: 'absolute', left: 0, right: 0,
                ...(isBot ? { bottom: isBar ? 0 : 8 } : { top: isBar ? 0 : 8 }),
                overflow: 'hidden', zIndex: 10,
                backgroundColor: (el as any).bgColor ?? undefined,
              }}>
                <span style={{
                  display: 'inline-block', paddingLeft: '100%', whiteSpace: 'nowrap',
                  color: (el as any).fontColor ?? '#fff',
                  fontSize: Math.max(7, Math.round(((el as any).fontSize ?? 32) * 0.35)),
                  fontWeight: (el as any).bold ? 'bold' : 'normal',
                  animation: `gfx-ticker ${duration}s linear ${loop ? 'infinite' : '1 forwards'}`,
                }}>
                  {tickerText}
                  {el.rssUrl && rssTexts[el.id] && <span style={{ opacity: 0.5, fontSize: '75%', marginLeft: 4 }}>[RSS]</span>}
                </span>
              </div>
            )
          }
          case 'LOWER_THIRD':
            return (
              <div key={el.id} style={{ ...base, whiteSpace: 'normal' }}>
                <div style={{ fontWeight: 'bold' }}>{el.text || 'Título'}</div>
                {el.subtitle && <div style={{ fontSize: fs * 0.8, opacity: 0.85 }}>{el.subtitle}</div>}
              </div>
            )
          default: return null
        }
      })}
      {active.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-gray-600 text-xs">Nenhum elemento ativo</p>
        </div>
      )}
    </div>
    </>
  )
}

// ─── Célula posicional no formulário ────────────────────────────────────────

function PositionCell({
  pos, elements, elementValues, onChange, onUpload, uploadingFor,
}: {
  pos: GraphicPosition
  elements: GraphicElement[]
  elementValues: Record<string, Record<string, any>>
  onChange: (elemId: string, field: string, val: any) => void
  onUpload: (elemId: string) => void
  uploadingFor: string | null
}) {
  const label = POSITION_LABELS[pos]

  if (elements.length === 0) {
    return (
      <div className="self-start rounded-lg border border-dashed border-gray-700 bg-gray-900/30 p-3 flex flex-col items-center gap-1.5">
        <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">{label}</span>
        <span className="text-[9px] text-gray-600 bg-gray-800/60 px-2 py-0.5 rounded">não utilizado</span>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <span className="text-[9px] text-gray-500 uppercase tracking-wide font-semibold block px-0.5">{label}</span>
      {elements.map(el => (
        <ElementField
          key={el.id}
          element={el}
          value={elementValues[el.id] ?? {}}
          onChange={(field, val) => onChange(el.id, field, val)}
          onUpload={onUpload}
          isUploading={uploadingFor === el.id}
        />
      ))}
    </div>
  )
}

// ─── Página principal ────────────────────────────────────────────────────────

export default function GraphicsPage() {
  const navigate  = useNavigate()
  const qc        = useQueryClient()
  const [editing, setEditing]           = useState<Graphic | null>(null)
  const [formOpen, setFormOpen]         = useState(false)
  const [name, setName]                 = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(FACTORY_TEMPLATE_SIMPLES)
  const [elementValues, setElementValues]           = useState<Record<string, Record<string, any>>>({})
  const [uploadingFor, setUploadingFor]             = useState<string | null>(null)
  const fileRef            = useRef<HTMLInputElement>(null)
  const uploadTargetElemId = useRef<string | null>(null)

  const { data: graphics = [], isLoading } = useQuery({ queryKey: ['graphics'],          queryFn: graphicsApi.list })
  const { data: templates = [] }           = useQuery({ queryKey: ['graphic-templates'], queryFn: graphicTemplatesApi.list })

  const currentTemplate = templates.find(t => t.id === selectedTemplateId) ?? null

  function byPos(pos: GraphicPosition): GraphicElement[] {
    return currentTemplate?.elements.filter(el => el.position === pos) ?? []
  }

  function setElemValue(elemId: string, field: string, value: any) {
    setElementValues(v => ({ ...v, [elemId]: { ...(v[elemId] ?? {}), [field]: value } }))
  }

  function getElemValue(elemId: string, field: string, fallback: any = '') {
    return elementValues[elemId]?.[field] ?? fallback
  }

  const save = useMutation({
    mutationFn: () => {
      const payload: Partial<Graphic> = { name, templateId: selectedTemplateId, elementValues, active: true }
      if (selectedTemplateId === FACTORY_TEMPLATE_SIMPLES) {
        payload.logoUrl      = getElemValue(TEMPLATE_SIMPLES_ELEM_LOGO,  'imageUrl', null) || null
        payload.logoPosition = getElemValue(TEMPLATE_SIMPLES_ELEM_LOGO,  'position', 'TR')
        payload.showClock    = !!getElemValue(TEMPLATE_SIMPLES_ELEM_CLOCK, 'active', true)
        payload.lowerText    = getElemValue(TEMPLATE_SIMPLES_ELEM_TEXT,  'text', null) || null
      }
      return editing ? graphicsApi.update(editing.id, payload) : graphicsApi.create(payload)
    },
    onSuccess: () => {
      toast.success(editing ? 'Gráfico atualizado' : 'Gráfico criado')
      qc.invalidateQueries({ queryKey: ['graphics'] })
      closeForm()
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao salvar'),
  })

  const remove = useMutation({
    mutationFn: graphicsApi.delete,
    onSuccess: () => { toast.success('Gráfico removido'); qc.invalidateQueries({ queryKey: ['graphics'] }) },
  })

  const toggle = useMutation({
    mutationFn: (g: Graphic) => graphicsApi.update(g.id, { active: !g.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['graphics'] }),
  })

  function openNew() {
    setEditing(null); setName(''); setSelectedTemplateId(FACTORY_TEMPLATE_SIMPLES); setElementValues({}); setFormOpen(true)
  }

  function openEdit(g: Graphic) {
    setEditing(g); setName(g.name)
    setSelectedTemplateId(g.templateId ?? FACTORY_TEMPLATE_SIMPLES)
    const ev: Record<string, Record<string, any>> = { ...(g.elementValues ?? {}) }
    if (!g.templateId || g.templateId === FACTORY_TEMPLATE_SIMPLES) {
      if (!ev[TEMPLATE_SIMPLES_ELEM_LOGO])  ev[TEMPLATE_SIMPLES_ELEM_LOGO]  = { imageUrl: g.logoUrl ?? '', position: g.logoPosition ?? 'TR' }
      if (!ev[TEMPLATE_SIMPLES_ELEM_CLOCK]) ev[TEMPLATE_SIMPLES_ELEM_CLOCK] = { active: g.showClock }
      if (!ev[TEMPLATE_SIMPLES_ELEM_TEXT])  ev[TEMPLATE_SIMPLES_ELEM_TEXT]  = { text: g.lowerText ?? '' }
    }
    setElementValues(ev); setFormOpen(true)
  }

  function closeForm() { setFormOpen(false); setEditing(null) }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>, elemId: string) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingFor(elemId)
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await api.post<{ imageUrl: string }>('/graphics/upload-image', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setElemValue(elemId, 'imageUrl', res.data.imageUrl)
      toast.success('Imagem enviada')
    } catch { toast.error('Erro ao enviar imagem') }
    finally { setUploadingFor(null); if (fileRef.current) fileRef.current.value = '' }
  }

  function elementSummary(g: Graphic): string[] {
    const tags: string[] = []
    if (g.templateId && g.template?.elements) {
      const ev = g.elementValues ?? {}
      g.template.elements.forEach(el => { if ((ev[el.id] ?? {}).active !== false) tags.push(el.type) })
    } else {
      if (g.logoUrl)   tags.push('LOGO')
      if (g.showClock) tags.push('CLOCK')
      if (g.lowerText) tags.push('TEXT')
    }
    return [...new Set(tags)]
  }

  // ── Cabeçalho ────────────────────────────────────────────────────────────
  const header = (
    <div className="flex items-center justify-between flex-wrap gap-3">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Layers className="h-6 w-6 text-brand-400" />Gráficos
        </h1>
        <p className="text-gray-500 text-sm mt-1">Sobreposições visuais baseadas em templates gráficos.</p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="secondary" icon={<Layers2 className="h-4 w-4" />} onClick={() => navigate('/graphic-templates')}>
          Gerenciar Templates
        </Button>
        {!formOpen && <Button onClick={openNew} icon={<Plus className="h-4 w-4" />}>Novo Gráfico</Button>}
      </div>
    </div>
  )

  // ── Lista ─────────────────────────────────────────────────────────────────
  if (!formOpen) {
    return (
      <div className="p-6 space-y-6">
        {header}
        <div className="card">
          <Table>
            <Thead><Th>Nome</Th><Th>Template</Th><Th>Elementos</Th><Th>Situação</Th><Th className="w-24 text-right">Ações</Th></Thead>
            <Tbody>
              {isLoading ? (
                <Tr><Td colSpan={5} className="text-center text-gray-500 py-8">Carregando...</Td></Tr>
              ) : graphics.length === 0 ? (
                <Tr><Td colSpan={5} className="text-center text-gray-500 py-8">Nenhum gráfico criado.</Td></Tr>
              ) : graphics.map((g) => (
                <Tr key={g.id}>
                  <Td><span className="font-medium text-white">{g.name}</span></Td>
                  <Td><span className="text-xs text-gray-400 bg-gray-800 px-1.5 py-0.5 rounded">{g.template?.name ?? 'Legado'}</span></Td>
                  <Td>
                    <div className="flex gap-1 flex-wrap">
                      {elementSummary(g).map(t => <span key={t} className="text-[10px] bg-violet-900/50 text-violet-300 px-1.5 py-0.5 rounded font-mono">{t}</span>)}
                      {elementSummary(g).length === 0 && <span className="text-gray-600 text-xs">vazio</span>}
                    </div>
                  </Td>
                  <Td>
                    <button onClick={() => toggle.mutate(g)} className={g.active ? 'text-emerald-400' : 'text-gray-600'}>
                      {g.active ? <ToggleRight className="h-5 w-5" /> : <ToggleLeft className="h-5 w-5" />}
                    </button>
                  </Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => openEdit(g)} />
                      <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />}
                        onClick={() => { if (confirm(`Excluir "${g.name}"?`)) remove.mutate(g.id) }} />
                    </div>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      </div>
    )
  }

  // ── Editor wide: form + preview ───────────────────────────────────────────
  return (
    <div className="p-6 space-y-6">
      {header}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">

        {/* Coluna esquerda: formulário */}
        <div className="card p-5 space-y-5">
          <div className="flex items-center gap-3">
            <button onClick={closeForm} className="text-gray-500 hover:text-gray-300 transition-colors">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <h2 className="text-base font-semibold text-white">
              {editing ? `Editando: ${editing.name}` : 'Novo Gráfico'}
            </h2>
          </div>

          <Input label="Nome *" value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Branding Principal" />

          {/* Seletor de template */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-400 uppercase tracking-wide block">Template</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[...templates].sort((a) => a.id === FACTORY_TEMPLATE_SIMPLES ? -1 : 1).map(t => (
                <button key={t.id}
                  onClick={() => { setSelectedTemplateId(t.id); setElementValues({}) }}
                  className={clsx(
                    'text-left px-3 py-2.5 rounded-lg border text-sm transition-colors',
                    selectedTemplateId === t.id
                      ? 'border-brand-500 bg-brand-600/20 text-brand-300'
                      : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600',
                  )}>
                  <div className="font-medium truncate">{t.name}</div>
                  <div className="text-[10px] text-gray-600 mt-0.5">{t.elements?.length ?? 0} elem.</div>
                </button>
              ))}
            </div>
          </div>

          {/* Grid positional de elementos */}
          {currentTemplate && (
            <div className="space-y-3 border-t border-gray-800 pt-4">
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wide block">
                Elementos — {currentTemplate.name}
              </label>

              {/* BAR_TOP */}
              <PositionCell
                pos="BAR_TOP" elements={byPos('BAR_TOP')}
                elementValues={elementValues}
                onChange={setElemValue} onUpload={(id) => { uploadTargetElemId.current = id; fileRef.current?.click() }}
                uploadingFor={uploadingFor}
              />

              {/* 3×3 grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {POSITION_GRID_ROWS.flat().map(pos => (
                  <PositionCell
                    key={pos} pos={pos} elements={byPos(pos)}
                    elementValues={elementValues}
                    onChange={setElemValue} onUpload={(id) => { uploadTargetElemId.current = id; fileRef.current?.click() }}
                    uploadingFor={uploadingFor}
                  />
                ))}
              </div>

              {/* BAR_BOTTOM */}
              <PositionCell
                pos="BAR_BOTTOM" elements={byPos('BAR_BOTTOM')}
                elementValues={elementValues}
                onChange={setElemValue} onUpload={(id) => { uploadTargetElemId.current = id; fileRef.current?.click() }}
                uploadingFor={uploadingFor}
              />
            </div>
          )}

          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden"
            onChange={e => { if (uploadTargetElemId.current) handleLogoUpload(e, uploadTargetElemId.current) }} />

          <div className="flex gap-3 justify-end pt-2 border-t border-gray-800">
            <Button variant="secondary" onClick={closeForm}>Cancelar</Button>
            <Button loading={save.isPending} onClick={() => {
              if (!name.trim()) { toast.error('Nome é obrigatório'); return }
              save.mutate()
            }}>Salvar</Button>
          </div>
        </div>

        {/* Coluna direita: preview */}
        <div className="space-y-3 xl:sticky xl:top-6">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-brand-400" />
            <span className="text-sm font-medium text-gray-300">Preview em tempo real</span>
            {currentTemplate && (
              <span className="ml-auto text-[10px] bg-gray-800 text-gray-500 px-2 py-0.5 rounded">{currentTemplate.name}</span>
            )}
          </div>
          <GraphicPreview template={currentTemplate} elementValues={elementValues} />
          <p className="text-[11px] text-gray-600 text-center">
            Representação aproximada — tamanhos e fontes são escalados para visualização.
          </p>
        </div>

      </div>
    </div>
  )
}

// ─── Campo dinâmico para cada elemento ──────────────────────────────────────

function ElementField({ element, value, onChange, onUpload, isUploading }: {
  element: GraphicElement
  value: Record<string, any>
  onChange: (field: string, val: any) => void
  onUpload: (elemId: string) => void
  isUploading: boolean
}) {
  const isActive = value.active !== false

  return (
    <div className={clsx(
      'space-y-2 p-3 rounded-lg border transition-opacity',
      isActive ? 'border-gray-700 bg-gray-900/40' : 'border-gray-800 bg-gray-900/20 opacity-60',
    )}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-300 truncate mr-2">{ELEMENT_TYPE_LABELS[element.type]}</span>
        <label className="flex items-center gap-1.5 cursor-pointer flex-shrink-0">
          <span className="text-[10px] text-gray-500">Ativo</span>
          <div onClick={() => onChange('active', !isActive)}
            className={clsx('relative w-7 h-3.5 rounded-full transition-colors cursor-pointer', isActive ? 'bg-brand-500' : 'bg-gray-700')}>
            <span className={clsx('absolute top-[1px] left-[1px] w-3 h-3 rounded-full bg-white shadow transition-transform', isActive ? 'translate-x-[14px]' : '')} />
          </div>
        </label>
      </div>

      {isActive && (
        <>
          {element.type === 'LOGO' && (
            <div className="flex gap-2 items-center">
              <input type="text" value={value.imageUrl ?? ''} onChange={e => onChange('imageUrl', e.target.value)}
                placeholder="URL da imagem..."
                className="flex-1 min-w-0 rounded bg-gray-800 border border-gray-700 text-white text-xs px-2 py-1.5 focus:outline-none focus:border-brand-500" />
              <Button size="sm" variant="secondary" loading={isUploading}
                icon={<Upload className="h-3 w-3" />} onClick={() => onUpload(element.id)}>
                Upload
              </Button>
            </div>
          )}

          {(element.type === 'TEXT' || element.type === 'TICKER') && (
            <input type="text" value={value.text ?? ''} onChange={e => onChange('text', e.target.value)}
              placeholder={element.type === 'TICKER' ? 'Ticker rolante...' : 'Texto...'}
              className="w-full rounded bg-gray-800 border border-gray-700 text-white text-xs px-2 py-1.5 focus:outline-none focus:border-brand-500" />
          )}

          {element.type === 'LOWER_THIRD' && (
            <div className="space-y-1.5">
              <input type="text" value={value.text ?? ''} onChange={e => onChange('text', e.target.value)}
                placeholder="Título (linha 1)"
                className="w-full rounded bg-gray-800 border border-gray-700 text-white text-xs px-2 py-1.5 focus:outline-none focus:border-brand-500" />
              <input type="text" value={value.subtitle ?? ''} onChange={e => onChange('subtitle', e.target.value)}
                placeholder="Subtítulo (linha 2)"
                className="w-full rounded bg-gray-800 border border-gray-700 text-white text-xs px-2 py-1.5 focus:outline-none focus:border-brand-500" />
            </div>
          )}

          {element.type === 'CLOCK' && (
            <p className="text-[10px] text-gray-500">Relógio automático — posição {POSITION_LABELS[element.position]}.</p>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-[10px] text-gray-500">Cor:</label>
            <input type="color" value={value.fontColor ?? element.fontColor ?? '#FFFFFF'}
              onChange={e => onChange('fontColor', e.target.value)}
              className="h-5 w-7 rounded border border-gray-700 bg-gray-800 cursor-pointer" />
            {(element.bgColor !== null || value.bgColor) && (
              <>
                <label className="text-[10px] text-gray-500">Fundo:</label>
                <input type="color" value={value.bgColor ?? element.bgColor ?? '#000000'}
                  onChange={e => onChange('bgColor', e.target.value)}
                  className="h-5 w-7 rounded border border-gray-700 bg-gray-800 cursor-pointer" />
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
