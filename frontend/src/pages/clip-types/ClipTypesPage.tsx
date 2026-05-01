import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2 } from 'lucide-react'
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
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ClipType | null>(null)
  const [form, setForm] = useState(empty)

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
    mutationFn: clipTypesApi.delete,
    onSuccess: () => { toast.success('Tipo desativado'); qc.invalidateQueries({ queryKey: ['clip-types'] }) },
  })

  function f(k: keyof typeof empty) { return (e: React.ChangeEvent<HTMLInputElement>) => setForm((v) => ({ ...v, [k]: e.target.value })) }
  function openNew() { setEditing(null); setForm(empty); setOpen(true) }
  function openEdit(t: ClipType) { setEditing(t); setForm({ name: t.name, code: t.code, fontColor: t.fontColor, fontBackColor: t.fontBackColor }); setOpen(true) }

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
            <Th>Situação</Th>
            <Th className="w-24 text-right">Ações</Th>
          </Thead>
          <Tbody>
            {isLoading ? (
              <Tr><Td colSpan={7 as any} className="text-center text-gray-500 py-8">Carregando...</Td></Tr>
            ) : data.map((t) => (
              <Tr key={t.id}>
                <Td><span className="font-mono font-bold text-gray-300">{t.code}</span></Td>
                <Td><span className="font-medium text-white">{t.name}</span></Td>
                <Td>
                  <Badge color={t.fontColor} bg={t.fontBackColor}>{t.code} — {t.name}</Badge>
                </Td>
                <Td><span className="font-mono text-xs">{t.fontColor}</span></Td>
                <Td><span className="font-mono text-xs">{t.fontBackColor}</span></Td>
                <Td><StatusBadge active={t.active} /></Td>
                <Td className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => openEdit(t)} />
                    <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => remove.mutate(t.id)} />
                  </div>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>

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
          {/* Preview */}
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
    </div>
  )
}
