import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Layers, Upload, ToggleLeft, ToggleRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import { api } from '../../api/client'
import { graphicsApi, type Graphic, FACTORY_TEMPLATE_SIMPLES, TEMPLATE_SIMPLES_ELEM_LOGO, TEMPLATE_SIMPLES_ELEM_CLOCK, TEMPLATE_SIMPLES_ELEM_TEXT } from '../../api/graphics.api'
import { graphicTemplatesApi, type GraphicTemplate, type GraphicElement, ELEMENT_TYPE_LABELS, POSITION_LABELS } from '../../api/graphic-templates.api'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Table, Thead, Th, Tbody, Tr, Td } from '../../components/ui/Table'

export default function GraphicsPage() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Graphic | null>(null)
  const [name, setName] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(FACTORY_TEMPLATE_SIMPLES)
  const [elementValues, setElementValues] = useState<Record<string, Record<string, any>>>({})
  const [uploadingFor, setUploadingFor] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const uploadTargetElemId = useRef<string | null>(null)

  const { data: graphics = [], isLoading } = useQuery({ queryKey: ['graphics'], queryFn: graphicsApi.list })
  const { data: templates = [] } = useQuery({ queryKey: ['graphic-templates'], queryFn: graphicTemplatesApi.list })

  // Template selecionado no modal
  const currentTemplate = templates.find(t => t.id === selectedTemplateId) ?? null

  function setElemValue(elemId: string, field: string, value: any) {
    setElementValues(v => ({ ...v, [elemId]: { ...(v[elemId] ?? {}), [field]: value } }))
  }

  function getElemValue(elemId: string, field: string, fallback: any = '') {
    return elementValues[elemId]?.[field] ?? fallback
  }

  const save = useMutation({
    mutationFn: () => {
      const payload: Partial<Graphic> = {
        name,
        templateId: selectedTemplateId,
        elementValues,
        active: true,
      }
      // Se for template "Simples", popula também os campos legados para compatibilidade
      if (selectedTemplateId === FACTORY_TEMPLATE_SIMPLES) {
        payload.logoUrl      = getElemValue(TEMPLATE_SIMPLES_ELEM_LOGO,  'imageUrl', null) || null
        payload.logoPosition = getElemValue(TEMPLATE_SIMPLES_ELEM_LOGO,  'position', 'top-right')
        payload.showClock    = !!getElemValue(TEMPLATE_SIMPLES_ELEM_CLOCK, 'active', true)
        payload.lowerText    = getElemValue(TEMPLATE_SIMPLES_ELEM_TEXT,  'text', null) || null
      }
      return editing ? graphicsApi.update(editing.id, payload) : graphicsApi.create(payload)
    },
    onSuccess: () => {
      toast.success(editing ? 'Gráfico atualizado' : 'Gráfico criado')
      qc.invalidateQueries({ queryKey: ['graphics'] })
      setOpen(false)
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
    setEditing(null)
    setName('')
    setSelectedTemplateId(FACTORY_TEMPLATE_SIMPLES)
    setElementValues({})
    setOpen(true)
  }

  function openEdit(g: Graphic) {
    setEditing(g)
    setName(g.name)
    setSelectedTemplateId(g.templateId ?? FACTORY_TEMPLATE_SIMPLES)
    // Popula elementValues — para template Simples, usa campos legados como fallback
    const ev: Record<string, Record<string, any>> = { ...(g.elementValues ?? {}) }
    if (!g.templateId || g.templateId === FACTORY_TEMPLATE_SIMPLES) {
      if (!ev[TEMPLATE_SIMPLES_ELEM_LOGO])  ev[TEMPLATE_SIMPLES_ELEM_LOGO]  = { imageUrl: g.logoUrl ?? '', position: g.logoPosition ?? 'TR' }
      if (!ev[TEMPLATE_SIMPLES_ELEM_CLOCK]) ev[TEMPLATE_SIMPLES_ELEM_CLOCK] = { active: g.showClock }
      if (!ev[TEMPLATE_SIMPLES_ELEM_TEXT])  ev[TEMPLATE_SIMPLES_ELEM_TEXT]  = { text: g.lowerText ?? '' }
    }
    setElementValues(ev)
    setOpen(true)
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>, elemId: string) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingFor(elemId)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await api.post<{ imageUrl: string }>('/graphics/upload-image', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setElemValue(elemId, 'imageUrl', res.data.imageUrl)
      toast.success('Imagem enviada')
    } catch {
      toast.error('Erro ao enviar imagem')
    } finally {
      setUploadingFor(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // Resumo dos elementos ativos de um gráfico
  function elementSummary(g: Graphic): string[] {
    const tags: string[] = []
    if (g.templateId && g.template?.elements) {
      const ev = g.elementValues ?? {}
      g.template.elements.forEach(el => {
        const v = ev[el.id] ?? {}
        if (v.active !== false) tags.push(el.type)
      })
    } else {
      if (g.logoUrl) tags.push('LOGO')
      if (g.showClock) tags.push('CLOCK')
      if (g.lowerText) tags.push('TEXT')
    }
    return [...new Set(tags)]
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Layers className="h-6 w-6 text-brand-400" />
            Gráficos
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Sobreposições visuais baseadas em templates gráficos.
          </p>
        </div>
        <Button onClick={openNew} icon={<Plus className="h-4 w-4" />}>Novo Gráfico</Button>
      </div>

      <div className="card">
        <Table>
          <Thead>
            <Th>Nome</Th>
            <Th>Template</Th>
            <Th>Elementos</Th>
            <Th>Situação</Th>
            <Th className="w-24 text-right">Ações</Th>
          </Thead>
          <Tbody>
            {isLoading ? (
              <Tr><Td colSpan={5} className="text-center text-gray-500 py-8">Carregando...</Td></Tr>
            ) : graphics.length === 0 ? (
              <Tr><Td colSpan={5} className="text-center text-gray-500 py-8">Nenhum gráfico criado.</Td></Tr>
            ) : graphics.map((g) => (
              <Tr key={g.id}>
                <Td><span className="font-medium text-white">{g.name}</span></Td>
                <Td>
                  <span className="text-xs text-gray-400 bg-gray-800 px-1.5 py-0.5 rounded">
                    {g.template?.name ?? 'Legado'}
                  </span>
                </Td>
                <Td>
                  <div className="flex gap-1 flex-wrap">
                    {elementSummary(g).map(t => (
                      <span key={t} className="text-[10px] bg-violet-900/50 text-violet-300 px-1.5 py-0.5 rounded font-mono">{t}</span>
                    ))}
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

      {/* Modal de criação/edição — layout duas colunas */}
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Editar Gráfico' : 'Novo Gráfico'} size="2xl">
        <div className="space-y-4">
          <Input label="Nome *" value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Branding Principal" />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Coluna esquerda: seletor de template */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wide block">Template</label>
              <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                {[...templates].sort((a) => a.id === FACTORY_TEMPLATE_SIMPLES ? -1 : 1).map(t => (
                  <button
                    key={t.id}
                    onClick={() => { setSelectedTemplateId(t.id); setElementValues({}) }}
                    className={clsx(
                      'w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-colors',
                      selectedTemplateId === t.id
                        ? 'border-brand-500 bg-brand-600/20 text-brand-300'
                        : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600'
                    )}
                  >
                    <div className="font-medium">{t.name}</div>
                    {t.description && <div className="text-[11px] text-gray-500 mt-0.5">{t.description}</div>}
                    <div className="text-[10px] text-gray-600 mt-1">{t.elements?.length ?? 0} elemento(s)</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Coluna direita: campos dos elementos */}
            <div className="space-y-3">
              {currentTemplate ? (
                <>
                  <label className="text-xs font-medium text-gray-400 uppercase tracking-wide block">
                    Elementos — {currentTemplate.name}
                  </label>
                  <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                    {currentTemplate.elements.map(el => (
                      <ElementField
                        key={el.id}
                        element={el}
                        value={elementValues[el.id] ?? {}}
                        onChange={(field, val) => setElemValue(el.id, field, val)}
                        onUpload={(elemId) => { uploadTargetElemId.current = elemId; fileRef.current?.click() }}
                        isUploading={uploadingFor === el.id}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-600 text-sm">
                  Selecione um template à esquerda
                </div>
              )}
            </div>
          </div>

          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden"
            onChange={e => { if (uploadTargetElemId.current) handleLogoUpload(e, uploadTargetElemId.current) }} />

          <div className="flex gap-3 justify-end pt-2 border-t border-gray-800">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button loading={save.isPending} onClick={() => {
              if (!name.trim()) { toast.error('Nome é obrigatório'); return }
              save.mutate()
            }}>Salvar</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// Campo dinâmico para cada elemento do template
function ElementField({ element, value, onChange, onUpload, isUploading }: {
  element: GraphicElement
  value: Record<string, any>
  onChange: (field: string, val: any) => void
  onUpload: (elemId: string) => void
  isUploading: boolean
}) {
  const isActive = value.active !== false
  const label = `${ELEMENT_TYPE_LABELS[element.type]} — ${POSITION_LABELS[element.position]}`

  return (
    <div className={clsx('space-y-2 p-3 rounded-lg border', isActive ? 'border-gray-700 bg-gray-900/40' : 'border-gray-800 bg-gray-900/20 opacity-60')}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-300">{label}</span>
        <label className="flex items-center gap-2 cursor-pointer">
          <span className="text-xs text-gray-500">Ativo</span>
          <div
            onClick={() => onChange('active', !isActive)}
            className={clsx('relative w-8 h-4 rounded-full transition-colors cursor-pointer', isActive ? 'bg-brand-500' : 'bg-gray-700')}
          >
            <span className={clsx('absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform', isActive ? 'translate-x-4' : '')} />
          </div>
        </label>
      </div>

      {isActive && (
        <>
          {element.type === 'LOGO' && (
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={value.imageUrl ?? ''}
                onChange={e => onChange('imageUrl', e.target.value)}
                placeholder="URL da imagem..."
                className="flex-1 rounded bg-gray-800 border border-gray-700 text-white text-sm px-2.5 py-1.5 focus:outline-none focus:border-brand-500"
              />
              <Button size="sm" variant="secondary" loading={isUploading}
                icon={<Upload className="h-3.5 w-3.5" />}
                onClick={() => onUpload(element.id)}>
                Upload
              </Button>
            </div>
          )}

          {(element.type === 'TEXT' || element.type === 'TICKER') && (
            <input
              type="text"
              value={value.text ?? ''}
              onChange={e => onChange('text', e.target.value)}
              placeholder={element.type === 'TICKER' ? 'Texto do ticker rolante...' : 'Texto...'}
              className="w-full rounded bg-gray-800 border border-gray-700 text-white text-sm px-2.5 py-1.5 focus:outline-none focus:border-brand-500"
            />
          )}

          {element.type === 'LOWER_THIRD' && (
            <div className="space-y-2">
              <input type="text" value={value.text ?? ''} onChange={e => onChange('text', e.target.value)}
                placeholder="Título (linha 1)"
                className="w-full rounded bg-gray-800 border border-gray-700 text-white text-sm px-2.5 py-1.5 focus:outline-none focus:border-brand-500" />
              <input type="text" value={value.subtitle ?? ''} onChange={e => onChange('subtitle', e.target.value)}
                placeholder="Subtítulo (linha 2)"
                className="w-full rounded bg-gray-800 border border-gray-700 text-white text-sm px-2.5 py-1.5 focus:outline-none focus:border-brand-500" />
            </div>
          )}

          {element.type === 'CLOCK' && (
            <p className="text-[11px] text-gray-500">Relógio em tempo real — exibido automaticamente na posição {POSITION_LABELS[element.position]}.</p>
          )}

          {/* Cor da fonte (sempre disponível) */}
          <div className="flex items-center gap-3">
            <label className="text-[11px] text-gray-500">Cor:</label>
            <div className="flex items-center gap-1.5">
              <input type="color" value={value.fontColor ?? element.fontColor ?? '#FFFFFF'}
                onChange={e => onChange('fontColor', e.target.value)}
                className="h-6 w-8 rounded border border-gray-700 bg-gray-800 cursor-pointer" />
              <span className="text-[10px] text-gray-600">{value.fontColor ?? element.fontColor ?? '#FFFFFF'}</span>
            </div>
            {(element.bgColor !== null || value.bgColor) && <>
              <label className="text-[11px] text-gray-500">Fundo:</label>
              <input type="color" value={value.bgColor ?? element.bgColor ?? '#000000'}
                onChange={e => onChange('bgColor', e.target.value)}
                className="h-6 w-8 rounded border border-gray-700 bg-gray-800 cursor-pointer" />
            </>}
          </div>
        </>
      )}
    </div>
  )
}
