import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Cast, Terminal } from 'lucide-react'
import toast from 'react-hot-toast'
import { streamOutputsApi, type StreamOutput, type StreamOutputType, TYPE_LABELS, TYPE_DESCRIPTIONS } from '../../api/stream-outputs.api'
import { channelsApi } from '../../api/channels.api'
import { graphicsApi } from '../../api/graphics.api'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Table, Thead, Th, Tbody, Tr, Td } from '../../components/ui/Table'
import { StatusBadge } from '../../components/ui/Badge'

const RESOLUTION_PRESETS = [
  { value: '',          label: 'Resolução original da fonte' },
  { value: '1920x1080', label: '1920×1080 — Full HD' },
  { value: '1280x720',  label: '1280×720 — HD' },
  { value: '854x480',   label: '854×480 — SD' },
  { value: '640x360',   label: '640×360 — Low' },
]

const LOGO_POSITIONS = [
  { value: 'top-right',    label: 'Superior direito' },
  { value: 'top-left',     label: 'Superior esquerdo' },
  { value: 'bottom-right', label: 'Inferior direito' },
  { value: 'bottom-left',  label: 'Inferior esquerdo' },
]

const empty = {
  name: '', description: '', type: 'RTMP' as StreamOutputType,
  url: '', streamKey: '', device: '', channelId: '',
  videoResolution: '', videoBitrate: '', audioBitrate: '',
  graphicId: '', outputNumber: '',
}

type SrtConfig    = { host: string; port: string; mode: 'caller' | 'listener'; passphrase: string }
type UdpConfig    = { address: string; port: string }
type AgentConfig  = { deviceOs: 'WINDOWS' | 'LINUX'; deviceDriver: string; deviceName: string; srtPort: string; serverIp: string }

const emptySrt:   SrtConfig   = { host: '', port: '', mode: 'caller', passphrase: '' }
const emptyUdp:   UdpConfig   = { address: '', port: '' }
const emptyAgent: AgentConfig = { deviceOs: 'WINDOWS', deviceDriver: 'DECKLINK', deviceName: '', srtPort: '4010', serverIp: '' }

function buildAgentSrtListenerUrl(port: string): string {
  if (!port) return ''
  return `srt://:${port}?mode=listener&timeout=15000000`
}

function buildAgentFfmpegCmd(cfg: AgentConfig, serverIp: string): string {
  if (!cfg.deviceName || !serverIp || !cfg.srtPort) return ''
  const { deviceOs, deviceDriver, deviceName } = cfg
  const srtDest = `srt://${serverIp}:${cfg.srtPort}?mode=caller`
  if (deviceOs === 'WINDOWS') {
    const driverFlag = deviceDriver === 'DECKLINK' ? 'decklink' : 'dshow'
    const deviceArg  = deviceDriver === 'DECKLINK'
      ? `"${deviceName}"`
      : `video="${deviceName}"`
    return `ffmpeg -f ${driverFlag} -i ${deviceArg} -c:v libx264 -preset ultrafast -tune zerolatency -b:v 4000k -c:a aac -ar 48000 -b:a 128k -f mpegts "${srtDest}"`
  }
  const driverFlag = deviceDriver === 'DECKLINK' ? 'decklink' : 'v4l2'
  return `ffmpeg -f ${driverFlag} -i "${deviceName}" -c:v libx264 -preset ultrafast -tune zerolatency -b:v 4000k -c:a aac -ar 48000 -b:a 128k -f mpegts "${srtDest}"`
}

const AGENT_DRIVERS: Record<'WINDOWS' | 'LINUX', { value: string; label: string }[]> = {
  WINDOWS: [
    { value: 'DECKLINK', label: 'Blackmagic DeckLink (decklink)' },
    { value: 'DSHOW',    label: 'DirectShow — USB / captura' },
  ],
  LINUX: [
    { value: 'DECKLINK', label: 'Blackmagic DeckLink (decklink)' },
    { value: 'V4L2',     label: 'V4L2 — USB / captura' },
  ],
}

const AGENT_DEVICE_PLACEHOLDER: Record<string, string> = {
  DECKLINK: 'DeckLink SDI',
  DSHOW:    'USB Video Capture',
  V4L2:     '/dev/video0',
}

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
  const [agentCfg, setAgentCfg] = useState<AgentConfig>(emptyAgent)

  const { data = [], isLoading } = useQuery({ queryKey: ['stream-outputs'], queryFn: streamOutputsApi.list })
  const { data: channels = [] } = useQuery({ queryKey: ['channels'], queryFn: channelsApi.list })
  const { data: graphics = [] } = useQuery({ queryKey: ['graphics'], queryFn: graphicsApi.list })

  function getUrlForSave(): string | undefined {
    if (form.type === 'SRT') return buildSrtUrl(srtCfg) || undefined
    if (form.type === 'UDP') return buildUdpUrl(udpCfg) || undefined
    return form.url || undefined
  }

  const save = useMutation({
    mutationFn: () => {
      const noTranscode = ['HLS_PUSH', 'SDI', 'LOCAL_DEVICE'].includes(form.type)
      const isAgent = form.type === 'LOCAL_DEVICE'
      const payload: any = {
        name:            form.name,
        description:     form.description || undefined,
        type:            form.type,
        url:             isAgent ? buildAgentSrtListenerUrl(agentCfg.srtPort) : getUrlForSave(),
        streamKey:       (!isAgent && form.type !== 'SRT' && form.streamKey) ? form.streamKey : undefined,
        device:          isAgent ? undefined : (form.device || undefined),
        deviceOs:        isAgent ? agentCfg.deviceOs : null,
        deviceDriver:    isAgent ? agentCfg.deviceDriver : null,
        deviceName:      isAgent ? (agentCfg.deviceName || null) : null,
        channelId:       form.channelId,
        videoResolution: (!noTranscode && form.videoResolution) ? form.videoResolution : null,
        videoBitrate:    (!noTranscode && form.videoBitrate)    ? parseInt(form.videoBitrate, 10) : null,
        audioBitrate:    (!noTranscode && form.audioBitrate)    ? parseInt(form.audioBitrate, 10) : null,
        graphicId:       form.graphicId || null,
        outputNumber:    form.outputNumber ? parseInt(form.outputNumber, 10) : null,
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

  function openNew() { setEditing(null); setForm(empty); setSrtCfg(emptySrt); setUdpCfg(emptyUdp); setAgentCfg(emptyAgent); setOpen(true) }
  function openEdit(o: StreamOutput) {
    setEditing(o)
    setForm({
      name: o.name, description: o.description ?? '', type: o.type,
      url: o.url ?? '', streamKey: o.streamKey ?? '', device: o.device ?? '', channelId: o.channelId ?? '',
      videoResolution: o.videoResolution ?? '', videoBitrate: o.videoBitrate?.toString() ?? '', audioBitrate: o.audioBitrate?.toString() ?? '',
      graphicId: o.graphicId ?? '', outputNumber: o.outputNumber != null ? String(o.outputNumber) : '',
    })
    if (o.type === 'SRT' && o.url)  setSrtCfg(parseSrtUrl(o.url, o.streamKey))
    else setSrtCfg(emptySrt)
    if (o.type === 'UDP' && o.url)  setUdpCfg(parseUdpUrl(o.url))
    else setUdpCfg(emptyUdp)
    if (o.type === 'LOCAL_DEVICE') {
      const portMatch = o.url?.match(/:(\d+)/)
      setAgentCfg({
        deviceOs:     (o.deviceOs as 'WINDOWS' | 'LINUX') ?? 'WINDOWS',
        deviceDriver: o.deviceDriver ?? 'DECKLINK',
        deviceName:   o.deviceName ?? '',
        srtPort:      portMatch?.[1] ?? '4010',
        serverIp:     '',
      })
    } else setAgentCfg(emptyAgent)
    setOpen(true)
  }

  function handleTypeChange(type: StreamOutputType) {
    setForm((v) => ({ ...v, type, url: '', streamKey: '', device: '' }))
    setSrtCfg(emptySrt)
    setUdpCfg(emptyUdp)
    setAgentCfg(emptyAgent)
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
            <Th className="w-10 text-center">Idx</Th>
            <Th>Nome</Th>
            <Th>Tipo</Th>
            <Th>Destino</Th>
            <Th>Codificação</Th>
            <Th>Canal</Th>
            <Th>Situação</Th>
            <Th className="w-24 text-right">Ações</Th>
          </Thead>
          <Tbody>
            {isLoading ? (
              <Tr><Td colSpan={8} className="text-center text-gray-500 py-8">Carregando...</Td></Tr>
            ) : data.length === 0 ? (
              <Tr><Td colSpan={8} className="text-center text-gray-500 py-8">Nenhuma saída configurada.</Td></Tr>
            ) : [...data].sort((a, b) => (a.outputNumber ?? 999) - (b.outputNumber ?? 999)).map((o) => (
              <Tr key={o.id}>
                <Td className="text-center">
                  {o.outputNumber != null
                    ? <span className="text-[11px] font-black text-brand-400 bg-brand-900/30 px-1.5 py-0.5 rounded">{o.outputNumber}</span>
                    : <span className="text-gray-700">—</span>}
                </Td>
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
                <Td>
                  {(o.videoResolution || o.videoBitrate || o.audioBitrate) ? (
                    <div className="text-[11px] text-gray-500 font-mono space-y-0.5">
                      {o.videoResolution && <div>{o.videoResolution}</div>}
                      {o.videoBitrate && <div>{o.videoBitrate}k v</div>}
                      {o.audioBitrate && <div>{o.audioBitrate}k a</div>}
                    </div>
                  ) : (
                    <span className="text-gray-700 text-xs">automático</span>
                  )}
                  {o.graphic && (
                    <span className="text-[10px] bg-violet-900/50 text-violet-300 px-1.5 py-0.5 rounded font-mono mt-1 inline-block">
                      {o.graphic.name}
                    </span>
                  )}
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

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Editar Saída' : 'Nova Saída'} size="2xl">
        <div className="flex flex-col">
          {/* Área rolável */}
          <div className="overflow-y-auto max-h-[78vh] pr-3 space-y-3">

            {/* Nome + Nº Painel + Descrição */}
            <div className="flex gap-3">
              <div className="flex-1"><Input label="Nome *" value={form.name} onChange={f('name')} placeholder="YouTube Live Show" /></div>
              <div className="w-24"><Input label="Nº Painel" type="number" min="1" value={form.outputNumber} onChange={f('outputNumber')} placeholder="1" /></div>
            </div>

            {/* Tipo + Canal */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Select label="Tipo *" value={form.type} onChange={(e) => handleTypeChange(e.target.value as StreamOutputType)}>
                {(Object.keys(TYPE_LABELS) as StreamOutputType[]).map((k) => (
                  <option key={k} value={k}>{TYPE_LABELS[k]}</option>
                ))}
              </Select>
              <Select label="Canal *" value={form.channelId} onChange={f('channelId')}>
                <option value="" disabled>Selecione o canal</option>
                {channels.filter((c) => c.active).map((c) => (
                  <option key={c.id} value={c.id}>Canal {c.number} — {c.name}</option>
                ))}
              </Select>
            </div>

            {form.type && TYPE_DESCRIPTIONS[form.type] && (
              <p className="text-xs text-gray-500 -mt-1">{TYPE_DESCRIPTIONS[form.type]}</p>
            )}

            {/* RTMP: URL + Key na mesma linha */}
            {showUrl && showKey && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input label="URL de destino *" value={form.url} onChange={f('url')} placeholder={urlPlaceholder[form.type] ?? 'URL...'} />
                <Input label="Stream Key" value={form.streamKey} onChange={f('streamKey')} placeholder="xxxx-xxxx-xxxx-xxxx" />
              </div>
            )}
            {showUrl && !showKey && (
              <Input label="URL de destino *" value={form.url} onChange={f('url')} placeholder={urlPlaceholder[form.type] ?? 'URL...'} />
            )}

            {/* SRT */}
            {form.type === 'SRT' && (
              <div className="space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Select label="Modo" value={srtCfg.mode} onChange={(e) => setSrtCfg((v) => ({ ...v, mode: e.target.value as 'caller' | 'listener' }))}>
                    <option value="caller">Caller</option>
                    <option value="listener">Listener</option>
                  </Select>
                  <Input label="Passphrase (criptografia)" value={srtCfg.passphrase} onChange={(e) => setSrtCfg((v) => ({ ...v, passphrase: e.target.value }))} placeholder="Vazio = sem criptografia" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div className="col-span-3">
                    <Input
                      label={srtCfg.mode === 'listener' ? 'Host / IP (não usado)' : 'Host / IP *'}
                      value={srtCfg.mode === 'listener' ? '' : srtCfg.host}
                      onChange={(e) => setSrtCfg((v) => ({ ...v, host: e.target.value }))}
                      placeholder={srtCfg.mode === 'listener' ? '0.0.0.0' : '192.168.1.100'}
                      disabled={srtCfg.mode === 'listener'}
                    />
                  </div>
                  <div className="col-span-2">
                    <Input label="Porta *" value={srtCfg.port} onChange={(e) => setSrtCfg((v) => ({ ...v, port: e.target.value }))} placeholder="4000" />
                  </div>
                </div>
                {buildSrtUrl(srtCfg) && (
                  <div className="text-[11px] font-mono text-gray-500 bg-gray-800/60 rounded px-2.5 py-1">{buildSrtUrl(srtCfg)}</div>
                )}
              </div>
            )}

            {/* UDP */}
            {form.type === 'UDP' && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div className="col-span-3">
                    <Input label="Endereço *" value={udpCfg.address} onChange={(e) => setUdpCfg((v) => ({ ...v, address: e.target.value }))} placeholder="239.0.0.1" />
                  </div>
                  <div className="col-span-2">
                    <Input label="Porta *" value={udpCfg.port} onChange={(e) => setUdpCfg((v) => ({ ...v, port: e.target.value }))} placeholder="1234" />
                  </div>
                </div>
                {buildUdpUrl(udpCfg) && (
                  <div className="text-[11px] font-mono text-gray-500 bg-gray-800/60 rounded px-2.5 py-1">{buildUdpUrl(udpCfg)}</div>
                )}
              </div>
            )}

            {/* SDI local (Cenários 2 e 3) */}
            {showDevice && (
              <div className="space-y-2">
                <Input label="Nome do dispositivo DeckLink *" value={form.device} onChange={f('device')} placeholder="DeckLink SDI" />
                <p className="text-[11px] text-gray-500">
                  <strong className="text-gray-400">Cenário 2</strong> — Docker local: passe o dispositivo com <code className="bg-gray-800 px-1 rounded">--device /dev/video0</code> no docker-compose.{' '}
                  <strong className="text-gray-400">Cenário 3</strong> — Driver DeckLink instalado diretamente no container.
                </p>
              </div>
            )}

            {/* Agente Remoto LOCAL_DEVICE (Cenário 1 — Cloud ou máquina separada) */}
            {form.type === 'LOCAL_DEVICE' && (
              <div className="space-y-3 rounded-lg border border-gray-700 p-3 bg-gray-800/40">
                <p className="text-xs font-medium text-gray-300">Configuração do Agente Externo</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Select label="Sistema operacional" value={agentCfg.deviceOs} onChange={(e) => setAgentCfg((v) => ({ ...v, deviceOs: e.target.value as 'WINDOWS' | 'LINUX', deviceDriver: 'DECKLINK', deviceName: '' }))}>
                    <option value="WINDOWS">Windows</option>
                    <option value="LINUX">Linux</option>
                  </Select>
                  <Select label="Driver / captura" value={agentCfg.deviceDriver} onChange={(e) => setAgentCfg((v) => ({ ...v, deviceDriver: e.target.value, deviceName: '' }))}>
                    {AGENT_DRIVERS[agentCfg.deviceOs].map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </Select>
                </div>
                <Input
                  label="Nome do dispositivo *"
                  value={agentCfg.deviceName}
                  onChange={(e) => setAgentCfg((v) => ({ ...v, deviceName: e.target.value }))}
                  placeholder={AGENT_DEVICE_PLACEHOLDER[agentCfg.deviceDriver] ?? 'DeckLink SDI'}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input label="Porta SRT (listener)" type="number" value={agentCfg.srtPort} onChange={(e) => setAgentCfg((v) => ({ ...v, srtPort: e.target.value }))} placeholder="4010" />
                  <Input
                    label="IP deste servidor (para o agente)"
                    value={agentCfg.serverIp}
                    onChange={(e) => setAgentCfg((v) => ({ ...v, serverIp: e.target.value }))}
                    placeholder="192.168.1.10 ou IP público"
                  />
                </div>
                {agentCfg.deviceName && agentCfg.serverIp && (
                  <div className="space-y-1">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide font-medium">Comando FFmpeg para o agente</p>
                    <div className="flex items-start gap-2 bg-gray-900 rounded-lg p-2.5 border border-gray-700">
                      <Terminal className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
                      <code className="text-[11px] font-mono text-emerald-300 break-all leading-relaxed">
                        {buildAgentFfmpegCmd(agentCfg, agentCfg.serverIp)}
                      </code>
                    </div>
                    <p className="text-[10px] text-gray-600">Execute este comando na máquina com a placa DeckLink instalada. O TVPlay ficará aguardando a conexão SRT.</p>
                  </div>
                )}
              </div>
            )}

            {/* Codificação + Overlay — só para tipos com transcodificação */}
            {!['HLS_PUSH', 'SDI', 'LOCAL_DEVICE'].includes(form.type) && (
              <div className="border-t border-gray-800 pt-3 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Select label="Resolução" value={form.videoResolution} onChange={f('videoResolution')}>
                    {RESOLUTION_PRESETS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </Select>
                  <Input label="Vídeo (kbps)" type="number" min={200} max={50000} value={form.videoBitrate} onChange={f('videoBitrate')} placeholder="2000" />
                  <Input label="Áudio (kbps)" type="number" min={32} max={320} value={form.audioBitrate} onChange={f('audioBitrate')} placeholder="128" />
                </div>
              </div>
            )}

            {/* Gráfico de sobreposição */}
            <div className="border-t border-gray-800 pt-3">
              <Select label="Gráfico padrão desta saída" value={form.graphicId} onChange={f('graphicId')}>
                <option value="">Nenhum</option>
                {graphics.filter(g => g.active).map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </Select>
              <p className="text-[11px] text-gray-600 mt-1">Aplicado quando o clipe/playlist não tiver gráfico próprio.</p>
            </div>
          </div>

          {/* Botões fixos fora da área de scroll */}
          <div className="flex gap-3 justify-end pt-3 mt-3 border-t border-gray-800">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button loading={save.isPending} onClick={() => {
              if (!form.channelId) { toast.error('Canal é obrigatório'); return }
              save.mutate()
            }}>Salvar</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
