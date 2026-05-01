import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Pencil, Trash2, ListVideo, CalendarDays } from 'lucide-react'
import toast from 'react-hot-toast'
import { playlistsApi, type Playlist } from '../../api/playlists.api'
import { channelsApi } from '../../api/channels.api'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Table, Thead, Th, Tbody, Tr, Td } from '../../components/ui/Table'

const today = new Date().toISOString().slice(0, 10)
const empty = { programName: '', date: today, channelId: '', notes: '' }

export default function PlaylistsListPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Playlist | null>(null)
  const [filterChannel, setFilterChannel] = useState('')
  const [form, setForm] = useState(empty)

  const { data: channels = [] } = useQuery({ queryKey: ['channels'], queryFn: channelsApi.list })
  const { data = [], isLoading } = useQuery({
    queryKey: ['playlists', filterChannel],
    queryFn: () => playlistsApi.list(filterChannel ? { channelId: filterChannel } : undefined),
  })

  const save = useMutation({
    mutationFn: () =>
      editing
        ? playlistsApi.update(editing.id, form)
        : playlistsApi.create({ programName: form.programName, date: form.date, channelId: form.channelId, notes: form.notes }),
    onSuccess: () => {
      toast.success(editing ? 'Playlist atualizada' : 'Playlist criada')
      qc.invalidateQueries({ queryKey: ['playlists'] })
      setOpen(false)
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro'),
  })

  const remove = useMutation({
    mutationFn: playlistsApi.delete,
    onSuccess: () => { toast.success('Playlist removida'); qc.invalidateQueries({ queryKey: ['playlists'] }) },
  })

  function f(k: keyof typeof empty) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((v) => ({ ...v, [k]: e.target.value }))
  }
  function openNew() { setEditing(null); setForm(empty); setOpen(true) }
  function openEdit(pl: Playlist) {
    setEditing(pl)
    setForm({ programName: pl.programName, date: pl.date.slice(0, 10), channelId: pl.channelId, notes: pl.notes ?? '' })
    setOpen(true)
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Playlists</h1>
          <p className="text-gray-500 text-sm mt-1">{data.length} playlist(s)</p>
        </div>
        <Button onClick={openNew} icon={<Plus className="h-4 w-4" />}>Nova Playlist</Button>
      </div>

      <div className="flex gap-3">
        <select
          value={filterChannel}
          onChange={(e) => setFilterChannel(e.target.value)}
          className="rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm px-3 py-2 focus:outline-none focus:border-brand-500"
        >
          <option value="">Todos os canais</option>
          {channels.map((ch) => <option key={ch.id} value={ch.id}>{ch.number} — {ch.name}</option>)}
        </select>
      </div>

      <div className="card">
        <Table>
          <Thead>
            <Th>Programa</Th>
            <Th>Canal</Th>
            <Th>Data</Th>
            <Th>Clipes</Th>
            <Th className="w-24 text-right">Ações</Th>
          </Thead>
          <Tbody>
            {isLoading ? (
              <Tr><Td colSpan={5} className="text-center text-gray-500 py-8">Carregando...</Td></Tr>
            ) : data.map((pl) => (
              <Tr key={pl.id} onClick={() => navigate(`/playlists/${pl.id}`)}>
                <Td>
                  <div className="flex items-center gap-2">
                    <ListVideo className="h-4 w-4 text-gray-600 shrink-0" />
                    <span className="font-medium text-white">{pl.programName}</span>
                    {pl.locked && <span className="text-[10px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">Bloqueada</span>}
                  </div>
                </Td>
                <Td>
                  <span className="text-xs text-gray-400">
                    {pl.channel ? `${pl.channel.number} — ${pl.channel.name}` : '—'}
                  </span>
                </Td>
                <Td>
                  <div className="flex items-center gap-1.5 text-sm">
                    <CalendarDays className="h-3.5 w-3.5 text-gray-600" />
                    {new Date(pl.date).toLocaleDateString('pt-BR')}
                  </div>
                </Td>
                <Td>
                  <span className="text-sm text-gray-400">{pl._count?.items ?? 0} clipes</span>
                </Td>
                <Td className="text-right">
                  <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => openEdit(pl)} />
                    <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => remove.mutate(pl.id)} />
                  </div>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Editar Playlist' : 'Nova Playlist'}>
        <div className="space-y-4">
          <Input label="Nome do Programa *" value={form.programName} onChange={f('programName')} placeholder="JORNAL DA MANHÃ" />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Data *" type="date" value={form.date} onChange={f('date')} />
            <Select label="Canal *" value={form.channelId} onChange={f('channelId')}>
              <option value="">Selecione...</option>
              {channels.map((ch) => <option key={ch.id} value={ch.id}>{ch.number} — {ch.name}</option>)}
            </Select>
          </div>
          <Input label="Observações" value={form.notes} onChange={f('notes')} placeholder="Opcional" />
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}
              disabled={!form.programName || !form.date || !form.channelId}>
              Salvar
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
