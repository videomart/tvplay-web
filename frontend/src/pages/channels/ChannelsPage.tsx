import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Tv2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { channelsApi, type Channel } from '../../api/channels.api'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Table, Thead, Th, Tbody, Tr, Td } from '../../components/ui/Table'
import { StatusBadge } from '../../components/ui/Badge'

const empty = { name: '', number: '' as any, description: '' }

export default function ChannelsPage() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Channel | null>(null)
  const [form, setForm] = useState(empty)

  const { data = [], isLoading } = useQuery({ queryKey: ['channels'], queryFn: channelsApi.list })

  const save = useMutation({
    mutationFn: () =>
      editing
        ? channelsApi.update(editing.id, { ...form, number: Number(form.number) })
        : channelsApi.create({ ...form, number: Number(form.number) }),
    onSuccess: () => {
      toast.success(editing ? 'Canal atualizado' : 'Canal criado')
      qc.invalidateQueries({ queryKey: ['channels'] })
      setOpen(false)
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao salvar'),
  })

  const remove = useMutation({
    mutationFn: channelsApi.delete,
    onSuccess: () => { toast.success('Canal removido'); qc.invalidateQueries({ queryKey: ['channels'] }) },
  })

  function openNew() { setEditing(null); setForm(empty); setOpen(true) }
  function openEdit(ch: Channel) { setEditing(ch); setForm({ name: ch.name, number: ch.number as any, description: ch.description ?? '' }); setOpen(true) }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Canais</h1>
          <p className="text-gray-500 text-sm mt-1">{data.length} canal(is) cadastrado(s)</p>
        </div>
        <Button onClick={openNew} icon={<Plus className="h-4 w-4" />}>Novo Canal</Button>
      </div>

      <div className="card">
        <Table>
          <Thead>
            <Th className="w-16">Nº</Th>
            <Th>Nome</Th>
            <Th>Descrição</Th>
            <Th>Status</Th>
            <Th>Situação</Th>
            <Th className="w-24 text-right">Ações</Th>
          </Thead>
          <Tbody>
            {isLoading ? (
              <Tr><Td colSpan={6} className="text-center text-gray-500 py-8">Carregando...</Td></Tr>
            ) : data.map((ch) => (
              <Tr key={ch.id}>
                <Td><span className="font-mono font-bold text-brand-300">{ch.number}</span></Td>
                <Td><span className="font-medium text-white">{ch.name}</span></Td>
                <Td>{ch.description ?? <span className="text-gray-600">—</span>}</Td>
                <Td>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                    ch.status === 'PLAYING' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-gray-700 text-gray-400'
                  }`}>{ch.status}</span>
                </Td>
                <Td><StatusBadge active={ch.active} /></Td>
                <Td className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => openEdit(ch)} />
                    <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => remove.mutate(ch.id)} />
                  </div>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Editar Canal' : 'Novo Canal'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Nome" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Canal Principal" />
            <Input label="Número" type="number" value={form.number} onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))} placeholder="1" />
          </div>
          <Input label="Descrição" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Opcional" />
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
