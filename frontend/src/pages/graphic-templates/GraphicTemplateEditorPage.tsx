import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Trash2, Save, Eye, EyeOff, Pencil, GripVertical } from 'lucide-react'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import {
  graphicTemplatesApi,
  type GraphicElement, type GraphicElementType, type GraphicPosition,
  POSITION_LABELS, ELEMENT_TYPE_LABELS,
} from '../../api/graphic-templates.api'
import { api } from '../../api/client'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'

// Grid de posições 3×3 + barras
const POSITION_GRID: GraphicPosition[][] = [
  ['TL', 'TC', 'TR'],
  ['ML', 'MC', 'MR'],
  ['BL', 'BC', 'BR'],
]

const ELEMENT_TYPE_ICON: Record<GraphicElementType, string> = {
  LOGO: '🖼️', CLOCK: '🕐', TEXT: '🔤', TICKER: '📜', LOWER_THIRD: '📺',
}

const emptyElement: Omit<GraphicElement, 'id' | 'templateId' | 'createdAt' | 'updatedAt'> = {
  type: 'TEXT', position: 'TL',
  imageUrl: null, text: '', subtitle: null,
  fontColor: '#FFFFFF', bgColor: null, fontSize: 32,
  opacity: 1, bold: false, width: null, height: null, padding: 10,
  tickerSpeed: 50, rssUrl: null,
  active: true, order: 0,
}

export default function GraphicTemplateEditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [editingElement, setEditingElement] = useState<GraphicElement | null>(null)
  const [form, setForm] = useState<typeof emptyElement>(emptyElement)

  const { data: template, isLoading } = useQuery({
    queryKey: ['graphic-template', id],
    queryFn: () => graphicTemplatesApi.get(id!),
    enabled: !!id,
  })

  const saveElements = useMutation({
    mutationFn: (elements: typeof emptyElement[]) => graphicTemplatesApi.saveElements(id!, elements),
    onSuccess: () => {
      toast.success('Elementos salvos')
      qc.invalidateQueries({ queryKey: ['graphic-template', id] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao salvar'),
  })

  const removeElement = useMutation({
    mutationFn: (elemId: string) => graphicTemplatesApi.deleteElement(id!, elemId),
    onSuccess: () => {
      toast.success('Elemento removido')
      qc.invalidateQueries({ queryKey: ['graphic-template', id] })
    },
  })

  function openAdd(position: GraphicPosition) {
    setEditingElement(null)
    setForm({ ...emptyElement, position })
    setAddOpen(true)
  }

  function openEdit(el: GraphicElement) {
    setEditingElement(el)
    setForm({ ...el })
    setAddOpen(true)
  }

  function handleSaveElement() {
    if (!template) return
    const elements = template.elements.map(el =>
      editingElement && el.id === editingElement.id ? { ...el, ...form } : el
    )
    if (!editingElement) elements.push({ ...form, order: template.elements.length } as any)
    saveElements.mutate(elements.map(({ id: _id, templateId: _tid, createdAt: _c, updatedAt: _u, ...rest }) => rest))
    setAddOpen(false)
  }

  function toggleActive(el: GraphicElement) {
    if (!template) return
    const elements = template.elements.map(e =>
      e.id === el.id ? { ...e, active: !e.active } : e
    )
    saveElements.mutate(elements.map(({ id: _id, templateId: _tid, createdAt: _c, updatedAt: _u, ...rest }) => rest))
  }

  function handleMove(elemId: string, newPos: GraphicPosition) {
    if (!template) return
    const elements = template.elements.map(el =>
      el.id === elemId ? { ...el, position: newPos } : el
    )
    saveElements.mutate(elements.map(({ id: _id, templateId: _tid, createdAt: _c, updatedAt: _u, ...rest }) => rest))
  }

  if (isLoading) return <div className="p-6 text-gray-500">Carregando...</div>
  if (!template) return <div className="p-6 text-red-400">Template não encontrado</div>

  const byPosition = (pos: GraphicPosition) => template.elements.filter(el => el.position === pos)

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/graphics')}>
          Gráficos
        </Button>
        <span className="text-gray-700">/</span>
        <Button variant="ghost" size="sm" onClick={() => navigate('/graphic-templates')}>
          Templates
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white">{template.name}</h1>
          {template.description && <p className="text-gray-500 text-sm">{template.description}</p>}
        </div>
        <span className={clsx('text-xs px-2 py-1 rounded font-medium', template.active ? 'bg-emerald-900/40 text-emerald-400' : 'bg-gray-800 text-gray-500')}>
          {template.active ? 'Ativo' : 'Inativo'}
        </span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Grid de posições */}
        <div className="card p-4 space-y-3">
          <p className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Posições do overlay</p>
          <PositionCell pos="BAR_TOP" elements={byPosition('BAR_TOP')} onAdd={openAdd} onEdit={openEdit} onToggle={toggleActive} onDelete={(el) => removeElement.mutate(el.id)} onMove={handleMove} />
          <div className="grid grid-cols-3 gap-2">
            {POSITION_GRID.map(row => row.map(pos => (
              <PositionCell key={pos} pos={pos} elements={byPosition(pos)} onAdd={openAdd} onEdit={openEdit} onToggle={toggleActive} onDelete={(el) => removeElement.mutate(el.id)} onMove={handleMove} />
            )))}
          </div>
          <PositionCell pos="BAR_BOTTOM" elements={byPosition('BAR_BOTTOM')} onAdd={openAdd} onEdit={openEdit} onToggle={toggleActive} onDelete={(el) => removeElement.mutate(el.id)} onMove={handleMove} />
        </div>

        {/* Preview visual 16:9 */}
        <div className="card p-4 space-y-3">
          <p className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Preview visual</p>
          <TemplatePreview elements={template.elements} />
        </div>
      </div>

      {/* Lista de todos os elementos */}
      {template.elements.length > 0 && (
        <div className="card p-4 space-y-2">
          <p className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Todos os elementos ({template.elements.length})</p>
          {template.elements.map(el => (
            <div key={el.id} className={clsx('flex items-center gap-3 px-3 py-2 rounded-lg border', el.active ? 'bg-gray-900 border-gray-800' : 'bg-gray-900/40 border-gray-800/40 opacity-50')}>
              <span className="text-lg flex-shrink-0">{ELEMENT_TYPE_ICON[el.type]}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-brand-300">{ELEMENT_TYPE_LABELS[el.type]}</span>
                  <span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">{POSITION_LABELS[el.position]}</span>
                </div>
                <p className="text-xs text-gray-400 truncate mt-0.5">
                  {el.imageUrl ?? el.text ?? el.subtitle ?? '—'}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => toggleActive(el)} className="p-1 rounded text-gray-600 hover:text-gray-300 transition-colors">
                  {el.active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                </button>
                <button onClick={() => openEdit(el)} className="p-1 rounded text-gray-600 hover:text-brand-400 transition-colors">
                  <Save className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => removeElement.mutate(el.id)} className="p-1 rounded text-gray-600 hover:text-red-400 transition-colors">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal adicionar / editar elemento */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title={editingElement ? 'Editar Elemento' : `Adicionar em ${POSITION_LABELS[form.position]}`} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Tipo *</label>
              <select value={form.type} onChange={e => setForm(v => ({ ...v, type: e.target.value as GraphicElementType }))}
                className="w-full rounded-lg bg-gray-800 border border-gray-700 text-white text-sm px-3 py-2 focus:outline-none focus:border-brand-500">
                {Object.entries(ELEMENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Posição *</label>
              <select value={form.position} onChange={e => setForm(v => ({ ...v, position: e.target.value as GraphicPosition }))}
                className="w-full rounded-lg bg-gray-800 border border-gray-700 text-white text-sm px-3 py-2 focus:outline-none focus:border-brand-500">
                {Object.entries(POSITION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>

          {(form.type === 'LOGO') && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">URL da Imagem</label>
              <input value={form.imageUrl ?? ''} onChange={e => setForm(v => ({ ...v, imageUrl: e.target.value || null }))}
                placeholder="https://..." className="w-full rounded-lg bg-gray-800 border border-gray-700 text-white text-sm px-3 py-2 focus:outline-none focus:border-brand-500" />
            </div>
          )}

          {(['TEXT', 'TICKER', 'LOWER_THIRD'].includes(form.type)) && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                {form.type === 'LOWER_THIRD' ? 'Título (linha 1)' : form.type === 'TICKER' ? 'Texto padrão (quando sem RSS)' : 'Texto'}
              </label>
              <input value={form.text ?? ''} onChange={e => setForm(v => ({ ...v, text: e.target.value || null }))}
                placeholder={form.type === 'TICKER' ? 'Texto que será exibido no ticker...' : 'Texto...'}
                className="w-full rounded-lg bg-gray-800 border border-gray-700 text-white text-sm px-3 py-2 focus:outline-none focus:border-brand-500" />
            </div>
          )}

          {/* Controles exclusivos do Ticker */}
          {form.type === 'TICKER' && (
            <div className="space-y-4 p-4 rounded-lg bg-gray-800/40 border border-gray-700">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Configurações do Ticker</p>

              {/* Velocidade */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Velocidade</label>
                  <span className="text-sm font-bold text-brand-300">{form.tickerSpeed ?? 50} px/s</span>
                </div>
                <input
                  type="range" min={5} max={400} step={5}
                  value={form.tickerSpeed ?? 50}
                  onChange={e => setForm(v => ({ ...v, tickerSpeed: +e.target.value }))}
                  className="w-full accent-brand-500 cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-gray-600">
                  <span>5 (lento)</span><span>50 (normal)</span><span>400 (rápido)</span>
                </div>
              </div>

              {/* Feed RSS */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                  Feed RSS <span className="text-gray-600 font-normal normal-case">(opcional — substitui o texto padrão)</span>
                </label>
                <input
                  type="url"
                  value={form.rssUrl ?? ''}
                  onChange={e => setForm(v => ({ ...v, rssUrl: e.target.value || null }))}
                  placeholder="https://feeds.example.com/noticias.rss"
                  className="w-full rounded-lg bg-gray-800 border border-gray-700 text-white text-sm px-3 py-2 focus:outline-none focus:border-brand-500"
                />
                {form.rssUrl && (
                  <p className="text-[11px] text-emerald-400/80">
                    ✓ Manchetes atualizadas a cada 5 min. Texto padrão usado se o feed falhar.
                  </p>
                )}
              </div>
            </div>
          )}

          {form.type === 'LOWER_THIRD' && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Subtítulo (linha 2)</label>
              <input value={form.subtitle ?? ''} onChange={e => setForm(v => ({ ...v, subtitle: e.target.value || null }))}
                className="w-full rounded-lg bg-gray-800 border border-gray-700 text-white text-sm px-3 py-2 focus:outline-none focus:border-brand-500" />
            </div>
          )}

          {/* Cores + tamanho */}
          <div className="grid grid-cols-2 gap-4">
            {/* Cor da letra */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Cor da letra</label>
              <div className="flex items-center gap-2">
                <ColorSwatch color={form.fontColor} onChange={c => setForm(v => ({ ...v, fontColor: c }))} />
                <input value={form.fontColor} onChange={e => setForm(v => ({ ...v, fontColor: e.target.value }))}
                  className="flex-1 min-w-0 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm px-2 py-2 focus:outline-none focus:border-brand-500 font-mono" />
              </div>
            </div>

            {/* Cor de fundo */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Cor de fundo</label>
              <div className="flex items-center gap-2">
                <ColorSwatch
                  color={form.bgColor ?? '#000000'}
                  onChange={c => setForm(v => ({ ...v, bgColor: c }))}
                  disabled={!form.bgColor}
                />
                {form.bgColor
                  ? <input value={form.bgColor} onChange={e => setForm(v => ({ ...v, bgColor: e.target.value }))}
                      className="flex-1 min-w-0 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm px-2 py-2 focus:outline-none focus:border-brand-500 font-mono" />
                  : <span className="flex-1 text-xs text-gray-600 italic">sem fundo</span>
                }
                <button
                  onClick={() => setForm(v => ({ ...v, bgColor: form.bgColor ? null : '#000000' }))}
                  className="text-[10px] text-gray-500 hover:text-gray-300 whitespace-nowrap px-1.5 py-1 rounded border border-gray-700 hover:border-gray-500 transition-colors"
                >
                  {form.bgColor ? '✕' : '+ fundo'}
                </button>
              </div>
            </div>
          </div>

          {/* Tamanho + opacidade */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Tamanho fonte</label>
              <input type="number" value={form.fontSize} onChange={e => setForm(v => ({ ...v, fontSize: +e.target.value }))}
                min={8} max={200}
                className="w-full rounded-lg bg-gray-800 border border-gray-700 text-white text-sm px-3 py-2 focus:outline-none focus:border-brand-500" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Opacidade (0–1)</label>
              <input type="number" value={form.opacity} onChange={e => setForm(v => ({ ...v, opacity: +e.target.value }))}
                min={0} max={1} step={0.1}
                className="w-full rounded-lg bg-gray-800 border border-gray-700 text-white text-sm px-3 py-2 focus:outline-none focus:border-brand-500" />
            </div>
            {form.type === 'LOGO' && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Largura (px)</label>
                <input type="number" value={form.width ?? ''} onChange={e => setForm(v => ({ ...v, width: +e.target.value || null }))}
                  className="w-full rounded-lg bg-gray-800 border border-gray-700 text-white text-sm px-3 py-2 focus:outline-none focus:border-brand-500" />
              </div>
            )}
          </div>
          {form.type === 'LOGO' && (
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Altura (px)</label>
                <input type="number" value={form.height ?? ''} onChange={e => setForm(v => ({ ...v, height: +e.target.value || null }))}
                  className="w-full rounded-lg bg-gray-800 border border-gray-700 text-white text-sm px-3 py-2 focus:outline-none focus:border-brand-500" />
              </div>
            </div>
          )}

          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input type="checkbox" checked={form.active} onChange={e => setForm(v => ({ ...v, active: e.target.checked }))}
              className="h-4 w-4 rounded border-gray-700 bg-gray-800 text-brand-600 focus:ring-brand-500" />
            <span className="text-sm text-gray-300">Elemento ativo (visível no ar)</span>
          </label>

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="secondary" onClick={() => setAddOpen(false)}>Cancelar</Button>
            <Button loading={saveElements.isPending} onClick={handleSaveElement}>
              {editingElement ? 'Salvar alterações' : 'Adicionar elemento'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// Swatch de cor: div colorida + input transparente sobreposto (funciona em todos os browsers)
function ColorSwatch({ color, onChange, disabled = false }: { color: string; onChange: (c: string) => void; disabled?: boolean }) {
  return (
    <div
      className="relative h-9 w-10 flex-shrink-0 rounded-lg border border-gray-700 overflow-hidden cursor-pointer"
      style={{ backgroundColor: disabled ? '#374151' : color }}
      title={disabled ? 'Sem fundo' : color}
    >
      {!disabled && (
        <input
          type="color"
          value={color}
          onChange={e => onChange(e.target.value)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          style={{ transform: 'scale(2)' }}
        />
      )}
    </div>
  )
}

// Célula de posição no grid — com drag & drop
function PositionCell({ pos, elements, onAdd, onEdit, onToggle, onDelete, onMove }: {
  pos: GraphicPosition
  elements: GraphicElement[]
  onAdd: (pos: GraphicPosition) => void
  onEdit: (el: GraphicElement) => void
  onToggle: (el: GraphicElement) => void
  onDelete: (el: GraphicElement) => void
  onMove: (elemId: string, newPos: GraphicPosition) => void
}) {
  const [dragOver, setDragOver] = useState(false)
  const dragElemId = useRef<string | null>(null)

  function handleDragStart(e: React.DragEvent, el: GraphicElement) {
    dragElemId.current = el.id
    e.dataTransfer.setData('elemId', el.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(true)
  }

  function handleDragLeave() { setDragOver(false) }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const elemId = e.dataTransfer.getData('elemId')
    if (elemId) onMove(elemId, pos)
  }

  const isBar = pos.startsWith('BAR')
  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={clsx(
        'rounded-lg border border-dashed p-2 min-h-[64px] transition-colors',
        isBar ? 'col-span-3' : '',
        dragOver
          ? 'border-brand-500 bg-brand-900/20'
          : elements.length === 0 ? 'border-gray-700 hover:border-gray-500' : 'border-gray-700/60',
      )}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] text-gray-600 uppercase tracking-wide font-semibold">{POSITION_LABELS[pos]}</span>
        <button onClick={() => onAdd(pos)} className="p-0.5 rounded text-gray-700 hover:text-brand-400 hover:bg-brand-900/20 transition-colors">
          <Plus className="h-3 w-3" />
        </button>
      </div>
      <div className="space-y-1">
        {elements.map(el => (
          <div
            key={el.id}
            className={clsx(
              'flex items-center gap-1.5 px-1.5 py-1 rounded text-[10px]',
              el.active ? 'bg-gray-800' : 'bg-gray-900 opacity-50',
            )}>
            {/* Grip: único ponto de drag — isola cliques nos botões */}
            <div
              draggable
              onDragStart={e => handleDragStart(e, el)}
              className="cursor-grab active:cursor-grabbing flex-shrink-0 select-none"
            >
              <GripVertical className="h-2.5 w-2.5 text-gray-600" />
            </div>
            <span className="flex-shrink-0">{ELEMENT_TYPE_ICON[el.type]}</span>
            <span className="flex-1 text-gray-300 truncate">
              {el.text || el.imageUrl || ELEMENT_TYPE_LABELS[el.type]}
            </span>
            <button onClick={() => onToggle(el)} className="text-gray-600 hover:text-gray-300 flex-shrink-0">
              {el.active ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            </button>
            <button onClick={() => onEdit(el)} className="text-gray-600 hover:text-brand-400 flex-shrink-0">
              <Pencil className="h-3 w-3" />
            </button>
            <button onClick={() => onDelete(el)} className="text-gray-600 hover:text-red-400 flex-shrink-0">
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
        {elements.length === 0 && (
          <p className="text-[9px] text-gray-700 text-center py-1">{dragOver ? '⬇ solte aqui' : 'vazio'}</p>
        )}
      </div>
    </div>
  )
}

// ─── Preview visual do template (simulação CSS 16:9) ─────────────────────────
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

function TemplatePreview({ elements }: { elements: GraphicElement[] }) {
  const active = elements.filter(el => el.active)

  // Busca títulos RSS para cada ticker com rssUrl
  const [rssTexts, setRssTexts] = useState<Record<string, string>>({})
  useEffect(() => {
    const tickers = active.filter(el => el.type === 'TICKER' && el.rssUrl)
    if (!tickers.length) return
    tickers.forEach(el => {
      api.get(`/ticker/rss?url=${encodeURIComponent(el.rssUrl!)}`)
        .then(r => { if (r.data?.text) setRssTexts(prev => ({ ...prev, [el.id]: r.data.text })) })
        .catch(() => {})
    })
  }, [elements.map(e => e.id + e.rssUrl).join(',')])  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative w-full bg-black rounded-lg overflow-hidden" style={{ aspectRatio: '16/9' }}>
      <style>{`@keyframes tmpl-ticker{0%{transform:translateX(0)}100%{transform:translateX(-100%)}}`}</style>
      <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center">
        <span className="text-gray-700 text-xs uppercase tracking-widest">Vídeo</span>
      </div>
      {active.map((el) => {
        const posStyle = POS_STYLE[el.position] ?? { top: 8, left: 8 }
        const isBar = el.position.startsWith('BAR')
        const fs = Math.max(7, Math.round((el.fontSize ?? 32) * 0.35))
        const base: React.CSSProperties = {
          position: 'absolute',
          ...posStyle,
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
            return <div key={el.id} style={base}>{el.text ?? 'Texto'}</div>
          case 'TICKER': {
            const speed    = Math.max(5, el.tickerSpeed ?? 50)
            const duration = Math.max(2, Math.round(3000 / speed))
            const tickerText = el.rssUrl
              ? (rssTexts[el.id] ?? '⏳ carregando RSS...')
              : (el.text ?? 'Ticker...')
            const isBot = el.position.startsWith('B')
            return (
              <div key={el.id} style={{
                position: 'absolute', left: 0, right: 0,
                ...(isBot ? { bottom: 8 } : { top: 8 }),
                overflow: 'hidden', zIndex: 10,
                backgroundColor: el.bgColor ?? undefined,
                opacity: el.opacity ?? 1,
              }}>
                <span style={{
                  display: 'inline-block', paddingLeft: '100%', whiteSpace: 'nowrap',
                  color: el.fontColor ?? '#fff',
                  fontSize: Math.max(7, Math.round((el.fontSize ?? 32) * 0.35)),
                  fontWeight: el.bold ? 'bold' : 'normal',
                  animation: `tmpl-ticker ${duration}s linear infinite`,
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
                <div style={{ fontWeight: 'bold' }}>{el.text ?? 'Título'}</div>
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
  )
}
