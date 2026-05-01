import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { clientsApi, type Client } from '../../api/clients.api'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Table, Thead, Th, Tbody, Tr, Td } from '../../components/ui/Table'
import { StatusBadge } from '../../components/ui/Badge'

const empty = { name: '', document: '', contact: '', email: '', phone: '' }

export default function ClientsPage() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Client | null>(null)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState(empty)

  const { data = [], isLoading } = useQuery({
    queryKey: ['clients', search],
    queryFn: () => clientsApi.list(search || undefined),
  })

  const save = useMutation({
    mutationFn: () => editing ? clientsApi.update(editing.id, form) : clientsApi.create(form),
    onSuccess: () => {
      toast.success(editing ? 'Cliente atualizado' : 'Cliente criado')
      qc.invalidateQueries({ queryKey: ['clients'] })
      setOpen(false)
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao salvar'),
  })

  const remove = useMutation({
    mutationFn: clientsApi.delete,
    onSuccess: () => { toast.success('Cliente desativado'); qc.invalidateQueries({ queryKey: ['clients'] }) },
  })

  function f(k: keyof typeof empty) { return (e: React.ChangeEvent<HTMLInputElement>) => setForm((v) => ({ ...v, [k]: e.target.value })) }
  function openNew() { setEditing(null); setForm(empty); setOpen(true) }
  function openEdit(c: Client) { setEditing(c); setForm({ name: c.name, document: c.document ?? '', contact: c.contact ?? '', email: c.email ?? '', phone: c.phone ?? '' }); setOpen(true) }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Clientes</h1>
          <p className="text-gray-500 text-sm mt-1">{data.length} cliente(s)</p>
        </div>
        <Button onClick={openNew} icon={<Plus className="h-4 w-4" />}>Novo Cliente</Button>
      </div>

      <div className="flex gap-3">
        <div className="w-72">
          <Input placeholder="Buscar cliente..." value={search} onChange={(e) => setSearch(e.target.value)} icon={<Search className="h-4 w-4" />} />
        </div>
      </div>

      <div className="card">
        <Table>
          <Thead>
            <Th>Nome</Th>
            <Th>Documento</Th>
            <Th>Contato</Th>
            <Th>E-mail</Th>
            <Th>Telefone</Th>
            <Th>Situação</Th>
            <Th className="w-24 text-right">Ações</Th>
          </Thead>
          <Tbody>
            {isLoading ? (
              <Tr><Td colSpan={7 as any} className="text-center text-gray-500 py-8">Carregando...</Td></Tr>
            ) : data.map((c) => (
              <Tr key={c.id}>
                <Td><span className="font-medium text-white">{c.name}</span></Td>
                <Td>{c.document ?? <span className="text-gray-600">—</span>}</Td>
                <Td>{c.contact ?? <span className="text-gray-600">—</span>}</Td>
                <Td>{c.email ?? <span className="text-gray-600">—</span>}</Td>
                <Td>{c.phone ?? <span className="text-gray-600">—</span>}</Td>
                <Td><StatusBadge active={c.active} /></Td>
                <Td className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => openEdit(c)} />
                    <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => remove.mutate(c.id)} />
                  </div>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Editar Cliente' : 'Novo Cliente'} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Nome *" value={form.name} onChange={f('name')} placeholder="Nome do anunciante" className="col-span-2" />
            <Input label="Documento" value={form.document} onChange={f('document')} placeholder="CNPJ / CPF" />
            <Input label="Contato" value={form.contact} onChange={f('contact')} placeholder="Nome do contato" />
            <Input label="E-mail" type="email" value={form.email} onChange={f('email')} placeholder="email@empresa.com" />
            <Input label="Telefone" value={form.phone} onChange={f('phone')} placeholder="(11) 99999-0000" />
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
