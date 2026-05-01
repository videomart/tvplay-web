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

const TYPE_ICONS: Record<InputSourceType, string> = {
  IP:      '🌐',
  YOUTUBE: '▶️',
  SRT:     '📡',
  SDI:     '🎬',
  USB:     '🔌',
}

const needsUrl    = (t: InputSourceType) => t === 'IP' || t === 'YOUTUBE' || t === 'SRT'
const needsDevice = (t: InputSourceType) => t === 'SDI' || t === 'USB'

export default function InputSourcesPage() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<InputSource | null>(null)
  const [form, setForm] = useState(empty)
  const [previewSource, setPreviewSource] = useState<InputSource | null>(null)
  const [previewStreamUrl, setPreviewStreamUrl] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)
  const [deviceDropdownOpen, setDeviceDropdownOpen] = useState(false)

  const { data = [], isLoading } = useQuery({ queryKey: ['input-sources'], queryFn: inputSourcesApi.list })
  const { data: channels = [] } = useQuery({ queryKey: ['channels'], queryFn: channelsApi.list })

  // Dispositivos disponíveis — só busca quando tipo é SDI ou USB e modal está aberto
  const { data: devicesData, isFetching: fetchingDevices } = useQuery({
    queryKey: ['input-devices'],
    queryFn: inputSourcesApi.listDevices,
    enabled: open && needsDevice(form.type),
    staleTime: 10_000,
  })
  const devices = devicesData?.devices ?? []

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name:      form.name,
        type:      form.type,
        url:       form.url    || undefined,
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

  function openNew() { setEditing(null); setForm(empty); setOpen(true) }
  function openEdit(s: InputSource) {
    setEditing(s)
    setForm({ name: s.name, type: s.type, url: s.url ?? '', device: s.device ?? '', channelId: s.channelId ?? '' })
    setOpen(true)
  }
  const f = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((v) => ({ ...v, [k]: e.target.value }))

  async function handlePreview(s: InputSource) {
    setPreviewSource(s)
    setPreviewStreamUrl(null)
    if (s.type === 'YOUTUBE' && s.url) {
      setResolving(true)
      try {
        const { streamUrl } = await inputSourcesApi.resolveYoutube(s.url)
        setPreviewStreamUrl(streamUrl)
      } catch (e: any) {
        toast.error(e.response?.data?.error ?? 'Erro ao resolver YouTube')
        setPreviewSource(null)
      } finally {
        setResolving(false)
      }
    } else if (s.url) {
      setPreviewStreamUrl(s.url)
    }
  }

  function canPreview(s: InputSource) {
    return (s.type === 'IP' || s.type === 'YOUTUBE') && !!s.url
  }

  // URL placeholder por tipo
  const urlPlaceholders: Partial<Record<InputSourceType, string>> = {
    IP:      'http://... · rtsp://... · rtmp://...',
    YOUTUBE: 'https://www.youtube.com/watch?v=... · https://youtu.be/...',
    SRT:     'srt://hostname:port',
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
                    {s.url ?? s.device ?? <span className="text-gray-600">—</span>}
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
                        title="Preview"
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
            <Select label="Tipo *" value={form.type} onChange={(e) => {
              setForm((v) => ({ ...v, type: e.target.value as InputSourceType, url: '', device: '' }))
            }}>
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

          {/* URL para tipos IP, YOUTUBE, SRT */}
          {needsUrl(form.type) && (
            <Input
              label={form.type === 'YOUTUBE' ? 'Link do YouTube *' : form.type === 'SRT' ? 'URL SRT *' : 'URL *'}
              value={form.url}
              onChange={f('url')}
              placeholder={urlPlaceholders[form.type] ?? ''}
            />
          )}

          {/* Dispositivo para SDI e USB */}
          {needsDevice(form.type) && (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-gray-400">
                Dispositivo {form.type} *
              </label>

              {/* Dropdown de dispositivos detectados */}
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

              {/* Input manual sempre disponível como fallback */}
              <Input
                value={form.device}
                onChange={f('device')}
                placeholder="/dev/video0"
              />
              <p className="text-[10px] text-gray-600">Ou digite o caminho do dispositivo manualmente.</p>
            </div>
          )}

          {/* Dica por tipo */}
          {form.type === 'YOUTUBE' && (
            <div className="p-3 bg-gray-800/50 rounded-lg text-xs text-gray-500 space-y-1">
              <p className="font-medium text-gray-400">YouTube via yt-dlp</p>
              <p>Cole o link do vídeo ou transmissão ao vivo. O servidor resolverá o stream automaticamente no momento do preview e da exibição.</p>
              <p className="text-amber-500/80">Atenção: funciona apenas para vídeos e streams públicos.</p>
            </div>
          )}
          {form.type === 'SRT' && (
            <div className="p-3 bg-gray-800/50 rounded-lg text-xs text-gray-500">
              <p className="font-medium text-gray-400">SRT (Secure Reliable Transport)</p>
              <p>Formato: <span className="font-mono text-gray-300">srt://hostname:port</span> · Requer transcodificação para preview no navegador.</p>
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
        onClose={() => { setPreviewSource(null); setPreviewStreamUrl(null) }}
        title={`Preview — ${previewSource?.name ?? ''}`}
        size="lg"
      >
        {resolving ? (
          <div className="w-full aspect-video bg-black rounded-lg flex flex-col items-center justify-center gap-3">
            <RefreshCw className="h-8 w-8 text-gray-500 animate-spin" />
            <p className="text-sm text-gray-500">Resolvendo stream via yt-dlp...</p>
          </div>
        ) : previewStreamUrl ? (
          previewStreamUrl.match(/\.(m3u8)(\?|$)/i) || previewSource?.type === 'YOUTUBE' ? (
            <VideoPlayer src={previewStreamUrl} className="w-full aspect-video" autoPlay />
          ) : (
            <div className="space-y-2">
              <video src={previewStreamUrl} controls autoPlay className="w-full aspect-video rounded-lg bg-black" />
            </div>
          )
        ) : (
          <div className="w-full aspect-video bg-black rounded-lg flex flex-col items-center justify-center gap-2">
            <Antenna className="h-8 w-8 text-gray-600" />
            <p className="text-sm text-gray-500">Preview não disponível para este tipo de fonte.</p>
            <p className="text-xs text-gray-600">Requer transcodificação para HLS no servidor.</p>
          </div>
        )}
      </Modal>
    </div>
  )
}
