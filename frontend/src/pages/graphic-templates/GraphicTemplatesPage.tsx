import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Pencil, Trash2, Layers2, ToggleLeft, ToggleRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { graphicTemplatesApi, type GraphicTemplate } from '../../api/graphic-templates.api'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Table, Thead, Th, Tbody, Tr, Td } from '../../components/ui/Table'

export default function GraphicTemplatesPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<GraphicTemplate | null>(null)
  const [form, setForm] = useState({ name: '', description: '' })

  const { data = [], isLoading } = useQuery({
    queryKey: ['graphic-templates'],
    queryFn: graphicTemplatesApi.list,
  })

  const save = useMutation({
    mutationFn: () => editing
      ? graphicTemplatesApi.update(editing.id, form)
      : graphicTemplatesApi.create(form),
    onSuccess: () => {
      toast.success(editing ? 'Template atualizado' : 'Template criado')
      qc.invalidateQueries({ queryKey: ['graphic-templates'] })
      setOpen(false)
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao salvar'),
  })

  const toggle = useMutation({
    mutationFn: (t: GraphicTemplate) => graphicTemplatesApi.update(t.id, { active: !t.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['graphic-templates'] }),
  })

  const remove = useMutation({
    mutationFn: (id: string) => graphicTemplatesApi.delete(id),
    onSuccess: () => { toast.success('Template excluído'); qc.invalidateQueries({ queryKey: ['graphic-templates'] }) },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao excluir'),
  })

  function openNew() { setEditing(null); setForm({ name: '', description: '' }); setOpen(true) }
  function openEdit(t: GraphicTemplate) { setEditing(t); setForm({ name: t.name, description: t.description ?? '' }); setOpen(true) }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Layers2 className="h-6 w-6 text-brand-400" />
            Templates Gráficos
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Conjuntos de elementos posicionados para overlays de broadcast
          </p>
        </div>
        <Button onClick={openNew} icon={<Plus className="h-4 w-4" />}>Novo Template</Button>
      </div>

      <div className="card">
        <Table>
          <Thead>
            <Th>Nome</Th>
            <Th>Descrição</Th>
            <Th className="text-center w-20">Elementos</Th>
            <Th className="text-center w-20">Canais</Th>
            <Th className="w-24">Situação</Th>
            <Th className="w-32 text-right">Ações</Th>
          </Thead>
          <Tbody>
            {isLoading ? (
              <Tr><Td colSpan={6} className="text-center text-gray-500 py-8">Carregando...</Td></Tr>
            ) : data.length === 0 ? (
              <Tr><Td colSpan={6} className="text-center text-gray-600 py-10">Nenhum template criado.</Td></Tr>
            ) : data.map((t) => (
              <Tr key={t.id} onClick={() => navigate(`/graphic-templates/${t.id}`)}>
                <Td>
                  <span className="font-medium text-white">{t.name}</span>
                </Td>
                <Td>
                  <span className="text-gray-400 text-sm">{t.description ?? '—'}</span>
                </Td>
                <Td className="text-center">
                  <span className="text-sm text-gray-400">{t.elements?.length ?? 0}</span>
                </Td>
                <Td className="text-center">
                  <span className="text-sm text-gray-400">{t._count?.channels ?? 0}</span>
                </Td>
                <Td>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggle.mutate(t) }}
                    className={t.active ? 'text-emerald-400' : 'text-gray-600'}
                    title={t.active ? 'Ativo — clique para desativar' : 'Inativo — clique para ativar'}
                  >
                    {t.active
                      ? <ToggleRight className="h-5 w-5" />
                      : <ToggleLeft className="h-5 w-5" />}
                  </button>
                </Td>
                <Td className="text-right">
                  <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => openEdit(t)} />
                    <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />}
                      loading={remove.isPending}
                      onClick={() => { if (confirm(`Excluir "${t.name}"?`)) remove.mutate(t.id) }} />
                  </div>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Editar Template' : 'Novo Template'}>
        <div className="space-y-4">
          <Input label="Nome *" value={form.name} onChange={(e) => setForm(v => ({ ...v, name: e.target.value }))} placeholder="Ex: Template Principal ICL" />
          <Input label="Descrição" value={form.description} onChange={(e) => setForm(v => ({ ...v, description: e.target.value }))} placeholder="Opcional" />
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button loading={save.isPending} onClick={() => save.mutate()} disabled={!form.name}>
              {editing ? 'Salvar' : 'Criar e Editar Elementos'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
