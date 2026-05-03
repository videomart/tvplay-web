import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Antenna, Play, Youtube, RefreshCw, ChevronDown } from 'lucide-react'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import { inputSourcesApi, type InputSource, type InputSourceType, SOURCE_TYPE_LABELS } from '../../api/input-sources.api'
import { channelsApi } from '../../api/channels.api'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Table, Thead, Th, Tbody, Tr, Td } from '../../components/ui/Table'
import { StatusBadge } from '../../components/ui/Badge'
import { VideoPlayer } from '../../components/ui/VideoPlayer'

const empty = { name: '', type: 'IP' as InputSourceType, url: '', device: '', channelId: '' }
type SrtConfig = { host: string; port: string; mode: 'caller' | 'listener' }
type UdpConfig = { address: string; port: string }
const emptySrt: SrtConfig = { host: '', port: '', mode: 'caller' }
const emptyUdp: UdpConfig = { address: '', port: '' }

function buildSrtUrl(c: SrtConfig): string {
  if (!c.port) return ''
  if (c.mode === 'listener') {
    // Listener faz bind em 0.0.0.0 — sem host na URL
    return `srt://:${c.port}?mode=listener&timeout=15000000`
  }
  if (!c.host) return ''
  return `srt://${c.host}:${c.port}?mode=caller&timeout=15000000`
}

function buildUdpUrl(c: UdpConfig): string {
  if (!c.address || !c.port) return ''
  return `udp://${c.address}:${c.port}`
}

function parseSrtUrl(url: string): SrtConfig {
  if (url.includes('mode=listener')) {
    const m = url.match(/^srt:\/\/:(\d+)/)
    if (m) return { host: '', port: m[1], mode: 'listener' }
  }
  const m = url.match(/^srt:\/\/([^:?/]+):(\d+)/)
  if (!m) return emptySrt
  return { host: m[1], port: m[2], mode: 'caller' }
}

function parseUdpUrl(url: string): UdpConfig {
  const m = url.match(/^udp:\/\/([^:?/]+):(\d+)/)
  if (!m) return emptyUdp
  return { address: m[1], port: m[2] }
}

const TYPE_ICONS: Record<InputSourceType, string> = {
  IP: '🌐', YOUTUBE: '▶️', SRT: '📡', SDI: '🎬', USB: '🔌',
}

const needsUrl    = (t: InputSourceType) => t === 'IP' || t === 'YOUTUBE'
const needsSrt    = (t: InputSourceType) => t === 'SRT'
const needsUdp    = (t: InputSourceType) => false  // UDP não é tipo de entrada, mas mantemos pronto
const needsDevice = (t: InputSourceType) => t === 'SDI' || t === 'USB'

export default function InputSourcesPage() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<InputSource | null>(null)
  const [form, setForm] = useState(empty)
  const [srtCfg, setSrtCfg] = useState<SrtConfig>(emptySrt)
  const [udpCfg, setUdpCfg] = useState<UdpConfig>(emptyUdp)
  const [previewSource, setPreviewSource] = useState<InputSource | null>(null)
  const [previewStreamUrl, setPreviewStreamUrl] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)
  const [deviceDropdownOpen, setDeviceDropdownOpen] = useState(false)

  const { data = [], isLoading } = useQuery({ queryKey: ['input-sources'], queryFn: inputSourcesApi.list })
  const { data: channels = [] } = useQuery({ queryKey: ['channels'], queryFn: channelsApi.list })

  const { data: devicesData, isFetching: fetchingDevices } = useQuery({
    queryKey: ['input-devices'],
    queryFn: inputSourcesApi.listDevices,
    enabled: open && needsDevice(form.type),
    staleTime: 10_000,
  })
  const devices = devicesData?.devices ?? []

  function getUrlForSave(): string | undefined {
    if (form.type === 'SRT') return buildSrtUrl(srtCfg) || undefined
    return form.url || undefined
  }

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name:      form.name,
        type:      form.type,
        url:       getUrlForSave(),
        device:    form.device || undefined,
        channelId: form.channelId || undefined,
      }
      return editing ? inputSourcesApi.update(editing.id, payload) : inputSourcesApi.create(payload)
    },
    onSuccess: () => {
      toast.success(editing ? 'Fonte atualizada' : 'Fonte criada')
      qc.invalidateQueries({ queryKey: ['input-sources'] })
      setOpen(false)
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao salvar'),
  })

  const remove = useMutation({
    mutationFn: inputSourcesApi.delete,
    onSuccess: () => { toast.success('Fonte removida'); qc.invalidateQueries({ queryKey: ['input-sources'] }) },
  })

  const toggle = useMutation({
    mutationFn: (item: InputSource) => inputSourcesApi.update(item.id, { active: !item.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['input-sources'] }),
  })

  function openNew() { setEditing(null); setForm(empty); setSrtCfg(emptySrt); setUdpCfg(emptyUdp); setOpen(true) }
  function openEdit(s: InputSource) {
    setEditing(s)
    setForm({ name: s.name, type: s.type, url: s.url ?? '', device: s.device ?? '', channelId: s.channelId ?? '' })
    if (s.type === 'SRT' && s.url)  setSrtCfg(parseSrtUrl(s.url))
    else setSrtCfg(emptySrt)
    setUdpCfg(emptyUdp)
    setOpen(true)
  }

  function handleTypeChange(type: InputSourceType) {
    setForm((v) => ({ ...v, type, url: '', device: '' }))
    setSrtCfg(emptySrt)
    setUdpCfg(emptyUdp)
  }

  const f = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((v) => ({ ...v, [k]: e.target.value }))

  async function handlePreview(s: InputSource) {
    setPreviewSource(s)
    setPreviewStreamUrl(null)

    if (s.type === 'IP' && s.url?.match(/^https?:\/\//i)) {
      // IP HTTP/HLS direto — carrega sem transcodificação
      setPreviewStreamUrl(s.url)
    } else if (s.url || s.device) {
      // YouTube, SRT, SDI, USB, IP não-HTTP → FFmpeg → HLS local
      setResolving(true)
      try {
        const { hlsUrl } = await inputSourcesApi.startPreview(s.id)
        setPreviewStreamUrl(hlsUrl)
      } catch (e: any) {
        const msg = e.response?.data?.detail
          ? `${e.response.data.error} — ${e.response.data.detail}`
          : e.response?.data?.error ?? 'Falha ao iniciar preview.'
        toast.error(msg, { duration: 6000 })
        setPreviewSource(null)
      } finally {
        setResolving(false)
      }
    }
  }

  function handleClosePreview() {
    if (previewSource && previewSource.type !== 'IP') {
      inputSourcesApi.stopPreview(previewSource.id).catch(() => {})
    }
    setPreviewSource(null)
    setPreviewStreamUrl(null)
  }

  function canPreview(s: InputSource) { return !!(s.url || s.device) }

  const urlPlaceholders: Partial<Record<InputSourceType, string>> = {
    IP:      'http://... · rtsp://... · rtmp://...',
    YOUTUBE: 'https://www.youtube.com/watch?v=... · https://youtu.be/...',
  }

  // URL de preview para mostrar na tabela (SRT: monta string amigável)
  function displayUrl(s: InputSource): string {
    if (!s.url && !s.device) return '—'
    if (s.type === 'SRT' && s.url) {
      const cfg = parseSrtUrl(s.url)
      return cfg.host ? `${cfg.host}:${cfg.port} (${cfg.mode})` : s.url
    }
    return s.url ?? s.device ?? '—'
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Antenna className="h-6 w-6 text-brand-400" />
            Fontes de Entrada
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {data.length} fonte(s) configurada(s) · exibida(s) quando o canal está parado
          </p>
        </div>
        <Button onClick={openNew} icon={<Plus className="h-4 w-4" />}>Nova Fonte</Button>
      </div>

      <div className="card">
        <Table>
          <Thead>
            <Th>Nome</Th>
            <Th>Tipo</Th>
            <Th>URL / Dispositivo</Th>
            <Th>Canal</Th>
            <Th>Situação</Th>
            <Th className="w-28 text-right">Ações</Th>
          </Thead>
          <Tbody>
            {isLoading ? (
              <Tr><Td colSpan={6} className="text-center text-gray-500 py-8">Carregando...</Td></Tr>
            ) : data.length === 0 ? (
              <Tr><Td colSpan={6} className="text-center text-gray-500 py-8">Nenhuma fonte configurada.</Td></Tr>
            ) : data.map((s) => (
              <Tr key={s.id}>
                <Td><span className="font-medium text-white">{s.name}</span></Td>
                <Td>
                  <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded">
                    {TYPE_ICONS[s.type]} {SOURCE_TYPE_LABELS[s.type]}
                  </span>
                </Td>
                <Td>
                  <span className="font-mono text-xs text-gray-400 truncate max-w-xs block">
                    {displayUrl(s)}
                  </span>
                </Td>
                <Td>{s.channel ? `Canal ${s.channel.number} — ${s.channel.name}` : <span className="text-gray-600">Todos</span>}</Td>
                <Td>
                  <button onClick={() => toggle.mutate(s)} className="focus:outline-none">
                    <StatusBadge active={s.active} />
                  </button>
                </Td>
                <Td className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {canPreview(s) && (
                      <Button
                        size="sm" variant="ghost"
                        icon={s.type === 'YOUTUBE'
                          ? <Youtube className="h-3.5 w-3.5 text-red-400" />
                          : <Play className="h-3.5 w-3.5 text-emerald-400" />}
                        onClick={() => handlePreview(s)}
                        title={['SRT','SDI','USB'].includes(s.type) ? 'Preview (transcodificação server-side)' : 'Preview'}
                      />
                    )}
                    <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => openEdit(s)} />
                    <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => remove.mutate(s.id)} />
                  </div>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>

      {/* Modal: criar / editar */}
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Editar Fonte' : 'Nova Fonte de Entrada'} size="md">
        <div className="space-y-4">
          <Input label="Nome *" value={form.name} onChange={f('name')} placeholder="YouTube Ao Vivo" />
          <div className="grid grid-cols-2 gap-4">
            <Select label="Tipo *" value={form.type} onChange={(e) => handleTypeChange(e.target.value as InputSourceType)}>
              {(Object.keys(SOURCE_TYPE_LABELS) as InputSourceType[]).map((k) => (
                <option key={k} value={k}>{SOURCE_TYPE_LABELS[k]}</option>
              ))}
            </Select>
            <Select label="Canal" value={form.channelId} onChange={f('channelId')}>
              <option value="">Todos os canais</option>
              {channels.filter((c) => c.active).map((c) => (
                <option key={c.id} value={c.id}>Canal {c.number} — {c.name}</option>
              ))}
            </Select>
          </div>

          {/* IP / YOUTUBE */}
          {needsUrl(form.type) && (
            <Input
              label={form.type === 'YOUTUBE' ? 'Link do YouTube *' : 'URL *'}
              value={form.url}
              onChange={f('url')}
              placeholder={urlPlaceholders[form.type] ?? ''}
            />
          )}

          {/* SRT */}
          {needsSrt(form.type) && (
            <div className="space-y-3">
              <Select
                label="Modo"
                value={srtCfg.mode}
                onChange={(e) => setSrtCfg((v) => ({ ...v, mode: e.target.value as 'caller' | 'listener' }))}
              >
                <option value="caller">Caller — conecta ao servidor SRT remoto</option>
                <option value="listener">Listener — aguarda o encoder/câmera conectar-se à porta</option>
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
                  Listener: aguarda o encoder/câmera enviar para esta porta. A porta deve estar no range 4000–4100 (mapeado no docker-compose).
                </p>
              )}
              <div className="text-[11px] font-mono text-gray-500 bg-gray-800/60 rounded px-2.5 py-1.5 break-all">
                {buildSrtUrl(srtCfg) || <span className="text-gray-600">Preencha a porta para ver a URL</span>}
              </div>
            </div>
          )}

          {/* SDI / USB */}
          {needsDevice(form.type) && (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-gray-400">
                Dispositivo {form.type} *
              </label>
              {fetchingDevices ? (
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Detectando dispositivos...
                </div>
              ) : devices.length > 0 ? (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setDeviceDropdownOpen((v) => !v)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-200 hover:border-gray-600 transition-colors"
                  >
                    <span className="font-mono text-xs">{form.device || 'Selecionar dispositivo...'}</span>
                    <ChevronDown className="h-4 w-4 text-gray-500" />
                  </button>
                  {deviceDropdownOpen && (
                    <div className="absolute z-10 mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden">
                      {devices.map((d) => (
                        <button
                          key={d.path}
                          type="button"
                          onClick={() => { setForm((v) => ({ ...v, device: d.path })); setDeviceDropdownOpen(false) }}
                          className={clsx(
                            'w-full text-left px-3 py-2.5 text-sm transition-colors hover:bg-white/5',
                            form.device === d.path ? 'text-brand-300' : 'text-gray-200'
                          )}
                        >
                          <p className="font-mono text-xs text-gray-400">{d.path}</p>
                          {d.name !== d.path && <p className="text-xs text-gray-500 truncate">{d.name}</p>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-xs text-amber-500/80 bg-amber-500/10 rounded-lg px-3 py-2">
                  Nenhum dispositivo detectado. Verifique se o hardware está conectado e se o container tem acesso a <span className="font-mono">/dev/video*</span>.
                </div>
              )}
              <Input value={form.device} onChange={f('device')} placeholder="/dev/video0" />
              <p className="text-[10px] text-gray-600">Ou digite o caminho do dispositivo manualmente.</p>
            </div>
          )}

          {/* Dicas */}
          {form.type === 'YOUTUBE' && (
            <div className="p-3 bg-gray-800/50 rounded-lg text-xs text-gray-500 space-y-1">
              <p className="font-medium text-gray-400">YouTube via yt-dlp</p>
              <p>Cole o link do vídeo ou transmissão ao vivo. O servidor resolverá o stream automaticamente.</p>
              <p className="text-amber-500/80">Atenção: funciona apenas para vídeos e streams públicos.</p>
            </div>
          )}
          {form.type === 'SRT' && (
            <div className="p-3 bg-gray-800/50 rounded-lg text-xs text-gray-500 space-y-1">
              <p className="font-medium text-gray-400">Sobre o modo SRT</p>
              <p><span className="text-gray-300">Caller</span>: o servidor conecta ativamente ao endereço informado. Use quando há um encoder/servidor SRT esperando conexão.</p>
              <p><span className="text-gray-300">Listener</span>: o servidor aguarda conexão de entrada na porta indicada. Use quando o encoder é quem vai conectar aqui.</p>
            </div>
          )}

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button>
          </div>
        </div>
      </Modal>

      {/* Modal: preview */}
      <Modal
        open={!!previewSource}
        onClose={handleClosePreview}
        title={`Preview — ${previewSource?.name ?? ''}`}
        size="lg"
      >
        {resolving ? (
          <div className="w-full aspect-video bg-black rounded-lg flex flex-col items-center justify-center gap-3">
            <RefreshCw className="h-8 w-8 text-gray-500 animate-spin" />
            <p className="text-sm text-gray-500">Iniciando stream no servidor...</p>
            <p className="text-xs text-gray-600">
              {previewSource?.type === 'YOUTUBE'
                ? 'Resolvendo via yt-dlp e iniciando FFmpeg...'
                : 'Aguardando primeiros segmentos HLS'}
            </p>
          </div>
        ) : previewStreamUrl ? (
          previewStreamUrl.includes('proxy-hls') || previewStreamUrl.match(/\.m3u8(\?|$)/i) ? (
            <VideoPlayer src={previewStreamUrl} className="w-full aspect-video" autoPlay />
          ) : (
            <video src={previewStreamUrl} controls autoPlay className="w-full aspect-video rounded-lg bg-black" />
          )
        ) : (
          <div className="w-full aspect-video bg-black rounded-lg flex flex-col items-center justify-center gap-2">
            <Antenna className="h-8 w-8 text-gray-600" />
            <p className="text-sm text-gray-500">Preview não disponível para este tipo de fonte.</p>
          </div>
        )}
      </Modal>
    </div>
  )
}
