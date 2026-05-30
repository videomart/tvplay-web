import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Trash2, Save, Eye, EyeOff, Pencil } from 'lucide-react'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import {
  graphicTemplatesApi,
  type GraphicElement, type GraphicElementType, type GraphicPosition,
  POSITION_LABELS, ELEMENT_TYPE_LABELS,
} from '../../api/graphic-templates.api'
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

  if (isLoading) return <div className="p-6 text-gray-500">Carregando...</div>
  if (!template) return <div className="p-6 text-red-400">Template não encontrado</div>

  const byPosition = (pos: GraphicPosition) => template.elements.filter(el => el.position === pos)

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/graphic-templates')}>
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

      {/* Grid de posições */}
      <div className="card p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Posições do overlay</p>

        {/* Barra Superior */}
        <PositionCell pos="BAR_TOP" elements={byPosition('BAR_TOP')} onAdd={openAdd} onEdit={openEdit} onToggle={toggleActive} onDelete={(el) => removeElement.mutate(el.id)} />

        {/* Grid 3×3 */}
        <div className="grid grid-cols-3 gap-2">
          {POSITION_GRID.map(row => row.map(pos => (
            <PositionCell key={pos} pos={pos} elements={byPosition(pos)} onAdd={openAdd} onEdit={openEdit} onToggle={toggleActive} onDelete={(el) => removeElement.mutate(el.id)} />
          )))}
        </div>

        {/* Barra Inferior */}
        <PositionCell pos="BAR_BOTTOM" elements={byPosition('BAR_BOTTOM')} onAdd={openAdd} onEdit={openEdit} onToggle={toggleActive} onDelete={(el) => removeElement.mutate(el.id)} />
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
                {form.type === 'LOWER_THIRD' ? 'Título (linha 1)' : 'Texto'}
              </label>
              <input value={form.text ?? ''} onChange={e => setForm(v => ({ ...v, text: e.target.value || null }))}
                placeholder={form.type === 'CLOCK' ? 'ex: %H:%M:%S' : 'Texto...'}
                className="w-full rounded-lg bg-gray-800 border border-gray-700 text-white text-sm px-3 py-2 focus:outline-none focus:border-brand-500" />
            </div>
          )}

          {form.type === 'LOWER_THIRD' && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Subtítulo (linha 2)</label>
              <input value={form.subtitle ?? ''} onChange={e => setForm(v => ({ ...v, subtitle: e.target.value || null }))}
                className="w-full rounded-lg bg-gray-800 border border-gray-700 text-white text-sm px-3 py-2 focus:outline-none focus:border-brand-500" />
            </div>
          )}

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Cor da letra</label>
              <div className="flex gap-2 items-center">
                <input type="color" value={form.fontColor} onChange={e => setForm(v => ({ ...v, fontColor: e.target.value }))}
                  className="h-8 w-10 rounded bg-gray-800 border border-gray-700 cursor-pointer" />
                <input value={form.fontColor} onChange={e => setForm(v => ({ ...v, fontColor: e.target.value }))}
                  className="flex-1 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm px-2 py-1.5 focus:outline-none focus:border-brand-500" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Cor de fundo</label>
              <div className="flex gap-2 items-center">
                <input type="color" value={form.bgColor ?? '#000000'} onChange={e => setForm(v => ({ ...v, bgColor: e.target.value }))}
                  className="h-8 w-10 rounded bg-gray-800 border border-gray-700 cursor-pointer" />
                <button onClick={() => setForm(v => ({ ...v, bgColor: form.bgColor ? null : '#000000' }))}
                  className="text-[10px] text-gray-500 hover:text-gray-300 whitespace-nowrap">
                  {form.bgColor ? '✕ sem fundo' : '+ fundo'}
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Tamanho fonte</label>
              <input type="number" value={form.fontSize} onChange={e => setForm(v => ({ ...v, fontSize: +e.target.value }))}
                min={8} max={200}
                className="w-full rounded-lg bg-gray-800 border border-gray-700 text-white text-sm px-3 py-2 focus:outline-none focus:border-brand-500" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Opacidade (0–1)</label>
              <input type="number" value={form.opacity} onChange={e => setForm(v => ({ ...v, opacity: +e.target.value }))}
                min={0} max={1} step={0.1}
                className="w-full rounded-lg bg-gray-800 border border-gray-700 text-white text-sm px-3 py-2 focus:outline-none focus:border-brand-500" />
            </div>
            {form.type === 'LOGO' && <>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Largura (px)</label>
                <input type="number" value={form.width ?? ''} onChange={e => setForm(v => ({ ...v, width: +e.target.value || null }))}
                  className="w-full rounded-lg bg-gray-800 border border-gray-700 text-white text-sm px-3 py-2 focus:outline-none focus:border-brand-500" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Altura (px)</label>
                <input type="number" value={form.height ?? ''} onChange={e => setForm(v => ({ ...v, height: +e.target.value || null }))}
                  className="w-full rounded-lg bg-gray-800 border border-gray-700 text-white text-sm px-3 py-2 focus:outline-none focus:border-brand-500" />
              </div>
            </>}
          </div>

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

// Célula de posição no grid
function PositionCell({ pos, elements, onAdd, onEdit, onToggle, onDelete }: {
  pos: GraphicPosition
  elements: GraphicElement[]
  onAdd: (pos: GraphicPosition) => void
  onEdit: (el: GraphicElement) => void
  onToggle: (el: GraphicElement) => void
  onDelete: (el: GraphicElement) => void
}) {
  const isBar = pos === 'BAR_TOP' || pos === 'BAR_BOTTOM'
  return (
    <div className={clsx(
      'rounded-lg border border-dashed border-gray-700 p-2 min-h-[64px] transition-colors',
      isBar ? 'col-span-3' : '',
      elements.length === 0 ? 'hover:border-gray-500' : 'border-gray-700/60',
    )}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] text-gray-600 uppercase tracking-wide font-semibold">{POSITION_LABELS[pos]}</span>
        <button onClick={() => onAdd(pos)} className="p-0.5 rounded text-gray-700 hover:text-brand-400 hover:bg-brand-900/20 transition-colors">
          <Plus className="h-3 w-3" />
        </button>
      </div>
      <div className="space-y-1">
        {elements.map(el => (
          <div key={el.id} className={clsx('flex items-center gap-1.5 px-1.5 py-1 rounded text-[10px]', el.active ? 'bg-gray-800' : 'bg-gray-900 opacity-50')}>
            <span>{ELEMENT_TYPE_ICON[el.type]}</span>
            <span className="flex-1 text-gray-300 truncate">{el.text ?? el.imageUrl ?? el.type}</span>
            <button onClick={() => onToggle(el)} className="text-gray-600 hover:text-gray-300">
              {el.active ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            </button>
            <button onClick={() => onEdit(el)} className="text-gray-600 hover:text-brand-400">
              <Pencil className="h-3 w-3" />
            </button>
            <button onClick={() => onDelete(el)} className="text-gray-600 hover:text-red-400">
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
        {elements.length === 0 && (
          <p className="text-[9px] text-gray-700 text-center py-1">vazio</p>
        )}
      </div>
    </div>
  )
}
