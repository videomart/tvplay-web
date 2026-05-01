import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Cast } from 'lucide-react'
import toast from 'react-hot-toast'
import { streamOutputsApi, type StreamOutput, type StreamOutputType, TYPE_LABELS } from '../../api/stream-outputs.api'
import { channelsApi } from '../../api/channels.api'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Table, Thead, Th, Tbody, Tr, Td } from '../../components/ui/Table'
import { StatusBadge } from '../../components/ui/Badge'

const empty = { name: '', type: 'RTMP' as StreamOutputType, url: '', streamKey: '', device: '', channelId: '' }

export default function StreamOutputsPage() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<StreamOutput | null>(null)
  const [form, setForm] = useState(empty)

  const { data = [], isLoading } = useQuery({ queryKey: ['stream-outputs'], queryFn: streamOutputsApi.list })
  const { data: channels = [] } = useQuery({ queryKey: ['channels'], queryFn: channelsApi.list })

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name,
        type: form.type,
        url: form.url || undefined,
        streamKey: form.streamKey || undefined,
        device: form.device || undefined,
        channelId: form.channelId || undefined,
      }
      return editing ? streamOutputsApi.update(editing.id, payload) : streamOutputsApi.create(payload)
    },
    onSuccess: () => {
      toast.success(editing ? 'Saída atualizada' : 'Saída criada')
      qc.invalidateQueries({ queryKey: ['stream-outputs'] })
      setOpen(false)
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao salvar'),
  })

  const remove = useMutation({
    mutationFn: streamOutputsApi.delete,
    onSuccess: () => { toast.success('Saída removida'); qc.invalidateQueries({ queryKey: ['stream-outputs'] }) },
  })

  const toggle = useMutation({
    mutationFn: (item: StreamOutput) => streamOutputsApi.update(item.id, { active: !item.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stream-outputs'] }),
  })

  function openNew() { setEditing(null); setForm(empty); setOpen(true) }
  function openEdit(o: StreamOutput) {
    setEditing(o)
    setForm({ name: o.name, type: o.type, url: o.url ?? '', streamKey: o.streamKey ?? '', device: o.device ?? '', channelId: o.channelId ?? '' })
    setOpen(true)
  }
  const f = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((v) => ({ ...v, [k]: e.target.value }))

  const showUrl    = form.type === 'RTMP' || form.type === 'HLS_PUSH'
  const showKey    = form.type === 'RTMP'
  const showDevice = form.type === 'SDI'

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Cast className="h-6 w-6 text-brand-400" />
            Saídas de Streaming
          </h1>
          <p className="text-gray-500 text-sm mt-1">{data.length} saída(s) configurada(s)</p>
        </div>
        <Button onClick={openNew} icon={<Plus className="h-4 w-4" />}>Nova Saída</Button>
      </div>

      <div className="card">
        <Table>
          <Thead>
            <Th>Nome</Th>
            <Th>Tipo</Th>
            <Th>URL / Dispositivo</Th>
            <Th>Canal</Th>
            <Th>Situação</Th>
            <Th className="w-24 text-right">Ações</Th>
          </Thead>
          <Tbody>
            {isLoading ? (
              <Tr><Td colSpan={6} className="text-center text-gray-500 py-8">Carregando...</Td></Tr>
            ) : data.length === 0 ? (
              <Tr><Td colSpan={6} className="text-center text-gray-500 py-8">Nenhuma saída configurada.</Td></Tr>
            ) : data.map((o) => (
              <Tr key={o.id}>
                <Td><span className="font-medium text-white">{o.name}</span></Td>
                <Td>
                  <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded font-mono">
                    {TYPE_LABELS[o.type]}
                  </span>
                </Td>
                <Td>
                  <span className="font-mono text-xs text-gray-400 truncate max-w-xs block">
                    {o.url ?? o.device ?? <span className="text-gray-600">—</span>}
                  </span>
                </Td>
                <Td>{o.channel ? `Canal ${o.channel.number} — ${o.channel.name}` : <span className="text-gray-600">—</span>}</Td>
                <Td>
                  <button onClick={() => toggle.mutate(o)} className="focus:outline-none">
                    <StatusBadge active={o.active} />
                  </button>
                </Td>
                <Td className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => openEdit(o)} />
                    <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => remove.mutate(o.id)} />
                  </div>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Editar Saída' : 'Nova Saída'} size="md">
        <div className="space-y-4">
          <Input label="Nome *" value={form.name} onChange={f('name')} placeholder="YouTube Principal" />
          <div className="grid grid-cols-2 gap-4">
            <Select label="Tipo *" value={form.type} onChange={f('type')}>
              {(Object.keys(TYPE_LABELS) as StreamOutputType[]).map((k) => (
                <option key={k} value={k}>{TYPE_LABELS[k]}</option>
              ))}
            </Select>
            <Select label="Canal" value={form.channelId} onChange={f('channelId')}>
              <option value="">Todos os canais</option>
              {channels.filter((c) => c.active).map((c) => (
                <option key={c.id} value={c.id}>Canal {c.number} — {c.name}</option>
              ))}
            </Select>
          </div>
          {showUrl && (
            <Input
              label={form.type === 'RTMP' ? 'URL RTMP *' : 'URL de Push *'}
              value={form.url}
              onChange={f('url')}
              placeholder={form.type === 'RTMP' ? 'rtmp://a.rtmp.youtube.com/live2' : 'https://...'}
            />
          )}
          {showKey && (
            <Input label="Stream Key" value={form.streamKey} onChange={f('streamKey')} placeholder="xxxx-xxxx-xxxx-xxxx" />
          )}
          {showDevice && (
            <Input label="Dispositivo SDI" value={form.device} onChange={f('device')} placeholder="/dev/video0 ou nome do dispositivo" />
          )}
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
