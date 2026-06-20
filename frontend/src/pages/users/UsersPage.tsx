import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, UserCog, KeyRound } from 'lucide-react'
import toast from 'react-hot-toast'
import { usersApi, type UserRecord, type UserLevel, LEVEL_LABELS } from '../../api/users.api'
import { useAuthStore } from '../../stores/auth.store'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Table, Thead, Th, Tbody, Tr, Td } from '../../components/ui/Table'
import { StatusBadge } from '../../components/ui/Badge'

const emptyForm = { name: '', username: '', email: '', password: '', level: 'OPERATOR' as UserLevel, active: true }

export default function UsersPage() {
  const qc = useQueryClient()
  const me = useAuthStore((s) => s.user)
  const isAdmin = me?.level === 'ADMIN'

  const [open, setOpen]       = useState(false)
  const [editing, setEditing] = useState<UserRecord | null>(null)
  const [form, setForm]       = useState(emptyForm)

  const { data = [], isLoading } = useQuery({ queryKey: ['users'], queryFn: usersApi.list })

  const save = useMutation({
    mutationFn: () => {
      if (editing) {
        const payload: any = { name: form.name, username: form.username, email: form.email || null, level: form.level, active: form.active }
        if (form.password) payload.password = form.password
        return usersApi.update(editing.id, payload)
      }
      return usersApi.create({ name: form.name, username: form.username, email: form.email || null, password: form.password, level: form.level })
    },
    onSuccess: () => {
      toast.success(editing ? 'Usuário atualizado' : 'Usuário criado')
      qc.invalidateQueries({ queryKey: ['users'] })
      setOpen(false)
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao salvar'),
  })

  const resetPassword = useMutation({
    mutationFn: usersApi.resetPassword,
    onSuccess: (data) => {
      toast.success(
        (t) => (
          <span>
            Senha temporária de <strong>{data.username}</strong>: <code className="font-mono bg-gray-800 px-1.5 py-0.5 rounded">{data.tempPassword}</code>
          </span>
        ),
        { duration: 15000 },
      )
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao redefinir senha'),
  })

  const remove = useMutation({
    mutationFn: usersApi.delete,
    onSuccess: () => { toast.success('Usuário desativado'); qc.invalidateQueries({ queryKey: ['users'] }) },
    onError:   (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao remover'),
  })

  const toggle = useMutation({
    mutationFn: (u: UserRecord) => usersApi.update(u.id, { active: !u.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  function openNew() {
    setEditing(null); setForm(emptyForm); setOpen(true)
  }
  function openEdit(u: UserRecord) {
    setEditing(u)
    setForm({ name: u.name, username: u.username, email: u.email ?? '', password: '', level: u.level, active: u.active })
    setOpen(true)
  }

  const f = (k: keyof typeof emptyForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((v) => ({ ...v, [k]: e.target.value }))

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <UserCog className="h-6 w-6 text-brand-400" />
            Usuários
          </h1>
          <p className="text-gray-500 text-sm mt-1">{data.length} usuário(s)</p>
        </div>
        {isAdmin && (
          <Button onClick={openNew} icon={<Plus className="h-4 w-4" />}>Novo Usuário</Button>
        )}
      </div>

      {!isAdmin && (
        <div className="bg-yellow-900/20 border border-yellow-700/40 rounded-lg px-4 py-3 text-yellow-400 text-sm">
          Somente administradores podem criar ou alterar usuários.
        </div>
      )}

      <div className="card">
        <Table>
          <Thead>
            <Th>Nome</Th>
            <Th>Username</Th>
            <Th>Nível</Th>
            <Th>Situação</Th>
            <Th>Criado em</Th>
            {isAdmin && <Th className="w-24 text-right">Ações</Th>}
          </Thead>
          <Tbody>
            {isLoading ? (
              <Tr><Td colSpan={6} className="text-center text-gray-500 py-8">Carregando...</Td></Tr>
            ) : data.length === 0 ? (
              <Tr><Td colSpan={6} className="text-center text-gray-500 py-8">Nenhum usuário.</Td></Tr>
            ) : data.map((u) => (
              <Tr key={u.id}>
                <Td>
                  <span className="font-medium text-white flex items-center gap-1.5">
                    {u.name}
                    {u.id === me?.id && (
                      <span className="text-[10px] bg-brand-700/40 text-brand-300 px-1.5 py-0.5 rounded">você</span>
                    )}
                  </span>
                </Td>
                <Td><span className="font-mono text-sm text-gray-300">@{u.username}</span></Td>
                <Td>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                    u.level === 'ADMIN'    ? 'bg-red-900/40 text-red-300' :
                    u.level === 'OPERATOR' ? 'bg-blue-900/40 text-blue-300' :
                                             'bg-gray-700 text-gray-300'
                  }`}>
                    {LEVEL_LABELS[u.level]}
                  </span>
                </Td>
                <Td>
                  {isAdmin
                    ? <button onClick={() => toggle.mutate(u)} className="focus:outline-none"><StatusBadge active={u.active} /></button>
                    : <StatusBadge active={u.active} />}
                </Td>
                <Td>
                  <span className="text-xs text-gray-500">
                    {new Date(u.createdAt).toLocaleDateString('pt-BR')}
                  </span>
                </Td>
                {isAdmin && (
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm" variant="ghost"
                        title="Redefinir senha (gera senha temporária)"
                        icon={<KeyRound className="h-3.5 w-3.5" />}
                        loading={resetPassword.isPending && resetPassword.variables === u.id}
                        onClick={() => { if (confirm(`Gerar senha temporária para "${u.name}"?`)) resetPassword.mutate(u.id) }}
                      />
                      <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => openEdit(u)} />
                      {u.id !== me?.id && (
                        <Button
                          size="sm" variant="danger"
                          icon={<Trash2 className="h-3.5 w-3.5" />}
                          onClick={() => { if (confirm(`Desativar "${u.name}"?`)) remove.mutate(u.id) }}
                        />
                      )}
                    </div>
                  </Td>
                )}
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Editar Usuário' : 'Novo Usuário'} size="md">
        <div className="space-y-4">
          <Input label="Nome completo *" value={form.name} onChange={f('name')} placeholder="João da Silva" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Username *"
              value={form.username}
              onChange={f('username')}
              placeholder="joao"
              disabled={!!editing}
            />
            <Select label="Nível *" value={form.level} onChange={f('level')}>
              {(Object.keys(LEVEL_LABELS) as UserLevel[]).map((k) => (
                <option key={k} value={k}>{LEVEL_LABELS[k]}</option>
              ))}
            </Select>
          </div>
          <Input
            label="Email (para recuperação de senha)"
            type="email"
            value={form.email}
            onChange={f('email')}
            placeholder="usuario@email.com"
          />
          <Input
            label={editing ? 'Nova senha (deixe em branco para manter)' : 'Senha *'}
            type="password"
            value={form.password}
            onChange={f('password')}
            placeholder={editing ? '••••••' : 'Mínimo 6 caracteres'}
          />
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
