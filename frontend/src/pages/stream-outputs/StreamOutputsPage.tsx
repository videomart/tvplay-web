import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Cast } from 'lucide-react'
import toast from 'react-hot-toast'
import { streamOutputsApi, type StreamOutput, type StreamOutputType, TYPE_LABELS, TYPE_DESCRIPTIONS } from '../../api/stream-outputs.api'
import { channelsApi } from '../../api/channels.api'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Table, Thead, Th, Tbody, Tr, Td } from '../../components/ui/Table'
import { StatusBadge } from '../../components/ui/Badge'

const empty = { name: '', description: '', type: 'RTMP' as StreamOutputType, url: '', streamKey: '', device: '', channelId: '' }

type SrtConfig = { host: string; port: string; mode: 'caller' | 'listener'; passphrase: string }
type UdpConfig = { address: string; port: string }
const emptySrt: SrtConfig = { host: '', port: '', mode: 'caller', passphrase: '' }
const emptyUdp: UdpConfig = { address: '', port: '' }

function buildSrtUrl(c: SrtConfig): string {
  if (!c.port) return ''
  if (c.mode === 'listener') {
    // Listener faz bind em 0.0.0.0 — sem host na URL
    let url = `srt://:${c.port}?mode=listener`
    if (c.passphrase) url += `&passphrase=${c.passphrase}`
    return url
  }
  if (!c.host) return ''
  let url = `srt://${c.host}:${c.port}?mode=caller`
  if (c.passphrase) url += `&passphrase=${c.passphrase}`
  return url
}

function buildUdpUrl(c: UdpConfig): string {
  if (!c.address || !c.port) return ''
  return `udp://${c.address}:${c.port}`
}

function parseSrtUrl(url: string, passphrase?: string): SrtConfig {
  if (url.includes('mode=listener')) {
    const m = url.match(/^srt:\/\/:(\d+)/)
    if (m) return { host: '', port: m[1], mode: 'listener', passphrase: '' }
  }
  const m = url.match(/^srt:\/\/([^:?/]+):(\d+)/)
  if (!m) return emptySrt
  const ppMatch = url.match(/passphrase=([^&]+)/)
  return { host: m[1], port: m[2], mode: 'caller', passphrase: ppMatch?.[1] ?? passphrase ?? '' }
}

function parseUdpUrl(url: string): UdpConfig {
  const m = url.match(/^udp:\/\/([^:?/]+):(\d+)/)
  if (!m) return emptyUdp
  return { address: m[1], port: m[2] }
}

export default function StreamOutputsPage() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<StreamOutput | null>(null)
  const [form, setForm] = useState(empty)
  const [srtCfg, setSrtCfg] = useState<SrtConfig>(emptySrt)
  const [udpCfg, setUdpCfg] = useState<UdpConfig>(emptyUdp)

  const { data = [], isLoading } = useQuery({ queryKey: ['stream-outputs'], queryFn: streamOutputsApi.list })
  const { data: channels = [] } = useQuery({ queryKey: ['channels'], queryFn: channelsApi.list })

  function getUrlForSave(): string | undefined {
    if (form.type === 'SRT') return buildSrtUrl(srtCfg) || undefined
    if (form.type === 'UDP') return buildUdpUrl(udpCfg) || undefined
    return form.url || undefined
  }

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name:        form.name,
        description: form.description || undefined,
        type:        form.type,
        url:         getUrlForSave(),
        streamKey:   (form.type !== 'SRT' && form.streamKey) ? form.streamKey : undefined,
        device:      form.device || undefined,
        channelId:   form.channelId || undefined,
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

  function openNew() { setEditing(null); setForm(empty); setSrtCfg(emptySrt); setUdpCfg(emptyUdp); setOpen(true) }
  function openEdit(o: StreamOutput) {
    setEditing(o)
    setForm({ name: o.name, description: o.description ?? '', type: o.type, url: o.url ?? '', streamKey: o.streamKey ?? '', device: o.device ?? '', channelId: o.channelId ?? '' })
    if (o.type === 'SRT' && o.url)  setSrtCfg(parseSrtUrl(o.url, o.streamKey))
    else setSrtCfg(emptySrt)
    if (o.type === 'UDP' && o.url)  setUdpCfg(parseUdpUrl(o.url))
    else setUdpCfg(emptyUdp)
    setOpen(true)
  }

  function handleTypeChange(type: StreamOutputType) {
    setForm((v) => ({ ...v, type, url: '', streamKey: '', device: '' }))
    setSrtCfg(emptySrt)
    setUdpCfg(emptyUdp)
  }

  const f = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((v) => ({ ...v, [k]: e.target.value }))

  const showUrl    = ['RTMP', 'HLS_PUSH', 'RTP'].includes(form.type)
  const showKey    = form.type === 'RTMP'
  const showDevice = form.type === 'SDI'

  const urlPlaceholder: Partial<Record<StreamOutputType, string>> = {
    RTMP:     'rtmp://a.rtmp.youtube.com/live2',
    HLS_PUSH: 'https://cdn.exemplo.com/hls/',
    RTP:      'rtp://239.0.0.1:5004',
  }

  function displayUrl(o: StreamOutput): string {
    if (!o.url && !o.device) return '—'
    if (o.type === 'SRT' && o.url) {
      if (o.url.includes('mode=listener')) {
        const m = o.url.match(/:(\d+)/)
        return m ? `listener :${m[1]}` : 'listener'
      }
      const cfg = parseSrtUrl(o.url)
      return cfg.host ? `${cfg.host}:${cfg.port} (caller)` : o.url
    }
    if (o.type === 'UDP' && o.url) {
      const cfg = parseUdpUrl(o.url)
      return cfg.address ? `${cfg.address}:${cfg.port}` : o.url
    }
    return o.url ?? o.device ?? '—'
  }

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
            <Th>Destino</Th>
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
                <Td>
                  <span className="font-medium text-white">{o.name}</span>
                  {o.description && <p className="text-[11px] text-gray-500 mt-0.5">{o.description}</p>}
                </Td>
                <Td>
                  <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded font-mono">
                    {TYPE_LABELS[o.type]}
                  </span>
                </Td>
                <Td>
                  <span className="font-mono text-xs text-gray-400 truncate max-w-xs block">
                    {displayUrl(o)}
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
          <Input label="Nome *" value={form.name} onChange={f('name')} placeholder="YouTube Live Show" />
          <Input label="Identificação / Descrição" value={form.description} onChange={f('description')} placeholder="Transmissão Live Show, Canal 2 Backup..." />
          <div className="grid grid-cols-2 gap-4">
            <Select label="Tipo *" value={form.type} onChange={(e) => handleTypeChange(e.target.value as StreamOutputType)}>
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

          {form.type && TYPE_DESCRIPTIONS[form.type] && (
            <p className="text-xs text-gray-500 -mt-1">{TYPE_DESCRIPTIONS[form.type]}</p>
          )}

          {/* RTMP / HLS_PUSH / RTP */}
          {showUrl && (
            <Input
              label="URL de destino *"
              value={form.url}
              onChange={f('url')}
              placeholder={urlPlaceholder[form.type] ?? 'URL...'}
            />
          )}
          {showKey && (
            <Input label="Stream Key" value={form.streamKey} onChange={f('streamKey')} placeholder="xxxx-xxxx-xxxx-xxxx" />
          )}

          {/* SRT */}
          {form.type === 'SRT' && (
            <div className="space-y-3">
              <Select
                label="Modo"
                value={srtCfg.mode}
                onChange={(e) => setSrtCfg((v) => ({ ...v, mode: e.target.value as 'caller' | 'listener' }))}
              >
                <option value="caller">Caller — conecta ao receptor SRT remoto</option>
                <option value="listener">Listener — aguarda o receptor conectar-se à porta</option>
              </Select>
              <div className="grid grid-cols-5 gap-3">
                <div className="col-span-3">
                  <Input
                    label={srtCfg.mode === 'listener' ? 'Host / IP (não usado no listener)' : 'Host / IP *'}
                    value={srtCfg.mode === 'listener' ? '' : srtCfg.host}
                    onChange={(e) => setSrtCfg((v) => ({ ...v, host: e.target.value }))}
                    placeholder={srtCfg.mode === 'listener' ? '0.0.0.0 (todas as interfaces)' : '192.168.1.100'}
                    disabled={srtCfg.mode === 'listener'}
                  />
                </div>
                <div className="col-span-2">
                  <Input
                    label="Porta *"
                    value={srtCfg.port}
                    onChange={(e) => setSrtCfg((v) => ({ ...v, port: e.target.value }))}
                    placeholder="4000"
                  />
                </div>
              </div>
              {srtCfg.mode === 'listener' && (
                <p className="text-[11px] text-amber-400/80 bg-amber-950/30 border border-amber-800/40 rounded px-2.5 py-1.5">
                  Listener: o servidor aguarda o receptor conectar nesta porta. A porta deve estar mapeada no docker-compose (range 4000–4100 já configurado).
                </p>
              )}
              <Input
                label="Passphrase (criptografia SRT)"
                value={srtCfg.passphrase}
                onChange={(e) => setSrtCfg((v) => ({ ...v, passphrase: e.target.value }))}
                placeholder="Deixe vazio para sem criptografia"
              />
              <div className="text-[11px] font-mono text-gray-500 bg-gray-800/60 rounded px-2.5 py-1.5 break-all">
                {buildSrtUrl(srtCfg) || <span className="text-gray-600">Preencha a porta para ver a URL</span>}
              </div>
            </div>
          )}

          {/* UDP */}
          {form.type === 'UDP' && (
            <div className="space-y-3">
              <div className="grid grid-cols-5 gap-3">
                <div className="col-span-3">
                  <Input
                    label="Endereço de destino *"
                    value={udpCfg.address}
                    onChange={(e) => setUdpCfg((v) => ({ ...v, address: e.target.value }))}
                    placeholder="239.0.0.1"
                  />
                </div>
                <div className="col-span-2">
                  <Input
                    label="Porta *"
                    value={udpCfg.port}
                    onChange={(e) => setUdpCfg((v) => ({ ...v, port: e.target.value }))}
                    placeholder="1234"
                  />
                </div>
              </div>
              <div className="text-[11px] font-mono text-gray-500 bg-gray-800/60 rounded px-2.5 py-1.5">
                {buildUdpUrl(udpCfg) || <span className="text-gray-600">Preencha endereço e porta para ver a URL</span>}
              </div>
              <p className="text-xs text-gray-600">Use endereço multicast (ex: 239.x.x.x) ou unicast.</p>
            </div>
          )}

          {/* SDI */}
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
