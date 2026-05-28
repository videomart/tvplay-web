import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Film } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { clipTypesApi, type ClipType } from '../../api/clip-types.api'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Table, Thead, Th, Tbody, Tr, Td } from '../../components/ui/Table'
import { Badge, StatusBadge } from '../../components/ui/Badge'

const empty = { name: '', code: '', fontColor: '#FFFFFF', fontBackColor: '#1A1A2E' }

export default function ClipTypesPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ClipType | null>(null)
  const [form, setForm] = useState(empty)

  // Estado do modal de exclusão
  const [deleteTarget, setDeleteTarget] = useState<ClipType | null>(null)
  const [replacementTypeId, setReplacementTypeId] = useState('')

  const { data = [], isLoading } = useQuery({ queryKey: ['clip-types'], queryFn: clipTypesApi.list })

  const save = useMutation({
    mutationFn: () => editing ? clipTypesApi.update(editing.id, form) : clipTypesApi.create(form),
    onSuccess: () => {
      toast.success(editing ? 'Tipo atualizado' : 'Tipo criado')
      qc.invalidateQueries({ queryKey: ['clip-types'] })
      setOpen(false)
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao salvar'),
  })

  const remove = useMutation({
    mutationFn: ({ id, replacementTypeId }: { id: string; replacementTypeId?: string }) =>
      clipTypesApi.delete(id, replacementTypeId),
    onSuccess: () => {
      toast.success('Tipo excluído')
      qc.invalidateQueries({ queryKey: ['clip-types'] })
      setDeleteTarget(null)
      setReplacementTypeId('')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao excluir'),
  })

  function f(k: keyof typeof empty) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setForm((v) => ({ ...v, [k]: e.target.value }))
  }
  function openNew() { setEditing(null); setForm(empty); setOpen(true) }
  function openEdit(t: ClipType) {
    setEditing(t)
    setForm({ name: t.name, code: t.code, fontColor: t.fontColor, fontBackColor: t.fontBackColor })
    setOpen(true)
  }

  function handleDeleteClick(t: ClipType) {
    const clipCount = t._count?.clips ?? 0
    if (clipCount === 0) {
      // Sem clipes — exclui direto com confirmação simples
      if (!confirm(`Excluir o tipo "${t.name}"?`)) return
      remove.mutate({ id: t.id })
    } else {
      // Com clipes — abre modal de substituição
      setReplacementTypeId('')
      setDeleteTarget(t)
    }
  }

  function confirmDeleteWithReplacement() {
    if (!deleteTarget) return
    if (!replacementTypeId) { toast.error('Selecione um tipo substituto'); return }
    remove.mutate({ id: deleteTarget.id, replacementTypeId })
  }

  const deleteTargetCount = deleteTarget?._count?.clips ?? 0
  const replacementOptions = data.filter((t) => t.id !== deleteTarget?.id && t.active)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Tipos de Clipe</h1>
          <p className="text-gray-500 text-sm mt-1">{data.length} tipo(s)</p>
        </div>
        <Button onClick={openNew} icon={<Plus className="h-4 w-4" />}>Novo Tipo</Button>
      </div>

      <div className="card">
        <Table>
          <Thead>
            <Th className="w-20">Código</Th>
            <Th>Nome</Th>
            <Th>Preview</Th>
            <Th>Fonte</Th>
            <Th>Fundo</Th>
            <Th className="w-20 text-center">Clipes</Th>
            <Th>Situação</Th>
            <Th className="w-24 text-right">Ações</Th>
          </Thead>
          <Tbody>
            {isLoading ? (
              <Tr><Td colSpan={8} className="text-center text-gray-500 py-8">Carregando...</Td></Tr>
            ) : data.map((t) => {
              const clipCount = t._count?.clips ?? 0
              return (
                <Tr key={t.id}>
                  <Td><span className="font-mono font-bold text-gray-300">{t.code}</span></Td>
                  <Td><span className="font-medium text-white">{t.name}</span></Td>
                  <Td>
                    <Badge color={t.fontColor} bg={t.fontBackColor}>{t.code} — {t.name}</Badge>
                  </Td>
                  <Td><span className="font-mono text-xs">{t.fontColor}</span></Td>
                  <Td><span className="font-mono text-xs">{t.fontBackColor}</span></Td>
                  <Td className="text-center">
                    {clipCount > 0 ? (
                      <button
                        onClick={() => navigate(`/clips?typeId=${t.id}`)}
                        title={`Ver ${clipCount} clipe(s) deste tipo`}
                        className="inline-flex items-center gap-1 text-brand-400 hover:text-brand-300 text-sm font-semibold transition-colors"
                      >
                        <Film className="h-3.5 w-3.5" />
                        {clipCount}
                      </button>
                    ) : (
                      <span className="text-gray-600 text-sm">—</span>
                    )}
                  </Td>
                  <Td><StatusBadge active={t.active} /></Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => openEdit(t)} />
                      <Button
                        size="sm"
                        variant="danger"
                        icon={<Trash2 className="h-3.5 w-3.5" />}
                        onClick={() => handleDeleteClick(t)}
                        loading={remove.isPending && (remove.variables as any)?.id === t.id}
                      />
                    </div>
                  </Td>
                </Tr>
              )
            })}
          </Tbody>
        </Table>
      </div>

      {/* Modal: criar / editar tipo */}
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Editar Tipo' : 'Novo Tipo'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Nome *" value={form.name} onChange={f('name')} placeholder="Comercial" className="col-span-2" />
            <Input label="Código *" value={form.code} onChange={f('code')} placeholder="CP" maxLength={4} />
            <div className="col-span-1" />
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Cor da Fonte</label>
              <div className="flex gap-2 items-center">
                <input type="color" value={form.fontColor} onChange={f('fontColor')} className="h-9 w-12 rounded bg-gray-800 border border-gray-700 cursor-pointer" />
                <Input value={form.fontColor} onChange={f('fontColor')} placeholder="#FFFFFF" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Cor de Fundo</label>
              <div className="flex gap-2 items-center">
                <input type="color" value={form.fontBackColor} onChange={f('fontBackColor')} className="h-9 w-12 rounded bg-gray-800 border border-gray-700 cursor-pointer" />
                <Input value={form.fontBackColor} onChange={f('fontBackColor')} placeholder="#1A1A2E" />
              </div>
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Preview</p>
            <Badge color={form.fontColor} bg={form.fontBackColor} className="text-sm px-4 py-1.5">
              {form.code || 'XX'} — {form.name || 'Nome do Tipo'}
            </Badge>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button>
          </div>
        </div>
      </Modal>

      {/* Modal: excluir tipo com clipes vinculados */}
      <Modal
        open={!!deleteTarget}
        onClose={() => { setDeleteTarget(null); setReplacementTypeId('') }}
        title="Excluir Tipo com Clipes Vinculados"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-300">
            O tipo <span className="font-bold text-white">"{deleteTarget?.name}"</span> possui{' '}
            <span className="font-bold text-yellow-400">{deleteTargetCount} clipe(s)</span> vinculado(s).
          </p>
          <p className="text-sm text-gray-400">
            Selecione um tipo substituto. Todos os clipes serão migrados para ele antes da exclusão.
          </p>

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Tipo substituto *</label>
            <select
              value={replacementTypeId}
              onChange={(e) => setReplacementTypeId(e.target.value)}
              className="w-full rounded-lg bg-gray-800 border border-gray-700 text-gray-100 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 transition-colors text-sm px-3 py-2"
            >
              <option value="">Selecione...</option>
              {replacementOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  [{t.code}] {t.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="secondary" onClick={() => { setDeleteTarget(null); setReplacementTypeId('') }}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={confirmDeleteWithReplacement}
            >
              Migrar e Excluir
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
