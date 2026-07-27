import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Antenna, Play, Youtube, RefreshCw, ChevronDown, Copy, Check, Monitor, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import { inputSourcesApi, type InputSource, type InputSourceType, SOURCE_TYPE_LABELS, resolveSourceType, urlNeedsYtDlp } from '../../api/input-sources.api'
import { useYoutubeEnabled } from '../../hooks/useYoutubeEnabled'
import { clipsApi, type Clip, MODALITY_LABELS } from '../../api/clips.api'
import { channelsApi } from '../../api/channels.api'
import { graphicsApi } from '../../api/graphics.api'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Table, Thead, Th, Tbody, Tr, Td } from '../../components/ui/Table'
import { StatusBadge } from '../../components/ui/Badge'
import { VideoPlayer } from '../../components/ui/VideoPlayer'

// IP e YOUTUBE são unificados na UI como "URL" — YOUTUBE fica como legado no banco
const SELECTABLE_TYPES: InputSourceType[] = ['IP', 'SRT', 'SDI', 'CLIP', 'WEBCAM']

const empty = { name: '', type: 'IP' as InputSourceType, url: '', device: '', channelId: '', clipId: '', graphicId: '', inputNumber: '', scteWatchEnabled: false, scteAction: 'LOG' as 'LOG' | 'BREAK' }
type SrtConfig = { host: string; port: string; mode: 'caller' | 'listener' }
type UdpConfig = { address: string; port: string }
type LocalDeviceConfig = {
  os: 'WINDOWS' | 'LINUX'
  driver: 'DSHOW' | 'V4L2' | 'DECKLINK'
  deviceName: string
  srtPort: string
  serverIp: string
}
const emptySrt: SrtConfig = { host: '', port: '', mode: 'caller' }
const emptyUdp: UdpConfig = { address: '', port: '' }
const emptyLocalDevice: LocalDeviceConfig = { os: 'WINDOWS', driver: 'DSHOW', deviceName: '', srtPort: '', serverIp: '' }

function buildLocalDeviceCommand(cfg: LocalDeviceConfig): string {
  if (!cfg.deviceName || !cfg.srtPort) return ''
  const dest = cfg.serverIp
    ? `srt://${cfg.serverIp}:${cfg.srtPort}?mode=caller`
    : `srt://IP_DO_SERVIDOR:${cfg.srtPort}?mode=caller`
  const encode = '-c:v libx264 -preset ultrafast -tune zerolatency -b:v 2000k -an -f mpegts'
  if (cfg.driver === 'DSHOW') {
    // -video_size e -framerate antes de -i forçam captura em 720p (evita buffer overflow com YUY2 1080p ~124MB/s)
    return `ffmpeg -f dshow -video_size 1280x720 -framerate 30 -rtbufsize 100M -i "video=${cfg.deviceName}" ${encode} "${dest}"`
  }
  if (cfg.driver === 'V4L2') {
    return `ffmpeg -f v4l2 -input_format yuyv422 -video_size 1280x720 -framerate 30 -i ${cfg.deviceName} ${encode} "${dest}"`
  }
  // DECKLINK
  return `ffmpeg -f decklink -i "${cfg.deviceName}" ${encode} "${dest}"`
}

function buildScript(cfg: LocalDeviceConfig): { content: string; filename: string; mimeType: string } | null {
  const cmd = buildLocalDeviceCommand(cfg)
  if (!cmd) return null
  const dest = cfg.serverIp
    ? `srt://${cfg.serverIp}:${cfg.srtPort}?mode=caller`
    : `srt://IP_DO_SERVIDOR:${cfg.srtPort}?mode=caller`

  if (cfg.os === 'WINDOWS') {
    const lines = [
      '@echo off',
      'chcp 65001 > nul',
      `title TVPlay — ${cfg.deviceName || 'Host Agent'}`,
      'cls',
      'echo.',
      'echo ================================================================',
      'echo  TVPlay - Host Agent de Camera',
      'echo ================================================================',
      'echo.',
      'where ffmpeg >nul 2>&1',
      'if %errorlevel% neq 0 (',
      '    echo [ERRO] FFmpeg nao foi encontrado no PATH.',
      '    echo.',
      '    echo Para instalar o FFmpeg no Windows:',
      '    echo   1. Acesse: https://www.gyan.dev/ffmpeg/builds/',
      '    echo   2. Baixe "ffmpeg-release-essentials.zip"',
      '    echo   3. Descompacte e adicione a pasta "bin" ao PATH do sistema.',
      '    echo.',
      '    pause',
      '    exit /b 1',
      ')',
      `echo Dispositivo : ${cfg.deviceName}`,
      `echo Destino SRT : ${dest}`,
      'echo.',
      'echo Pressione Ctrl+C para encerrar a transmissao.',
      'echo.',
      cmd,
      'echo.',
      'echo ================================================================',
      'echo  Transmissao encerrada.',
      'echo ================================================================',
      'echo.',
      'pause',
    ]
    return { content: lines.join('\r\n'), filename: 'tvplay-agent.bat', mimeType: 'application/x-bat' }
  } else {
    const lines = [
      '#!/bin/bash',
      'clear',
      'echo "================================================================"',
      'echo " TVPlay - Host Agent de Camera"',
      'echo "================================================================"',
      'echo ""',
      'if ! command -v ffmpeg &>/dev/null; then',
      '    echo "[ERRO] FFmpeg nao encontrado."',
      '    echo ""',
      '    echo "Para instalar:"',
      '    echo "  Ubuntu/Debian : sudo apt install ffmpeg"',
      '    echo "  Fedora/RHEL   : sudo dnf install ffmpeg"',
      '    echo "  Arch Linux    : sudo pacman -S ffmpeg"',
      '    echo ""',
      '    read -p "Pressione Enter para sair..."',
      '    exit 1',
      'fi',
      `echo "Dispositivo : ${cfg.deviceName}"`,
      `echo "Destino SRT : ${dest}"`,
      'echo ""',
      'echo "Pressione Ctrl+C para encerrar a transmissao."',
      'echo ""',
      cmd,
      'echo ""',
      'echo "================================================================"',
      'echo " Transmissao encerrada."',
      'echo "================================================================"',
      'echo ""',
      'read -p "Pressione Enter para sair..."',
    ]
    return { content: lines.join('\n'), filename: 'tvplay-agent.sh', mimeType: 'application/x-sh' }
  }
}

function downloadScript(cfg: LocalDeviceConfig) {
  const result = buildScript(cfg)
  if (!result) return
  const blob = new Blob([result.content], { type: result.mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = result.filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const DRIVER_OPTIONS: Record<'WINDOWS' | 'LINUX', { value: string; label: string }[]> = {
  WINDOWS: [
    { value: 'DSHOW',   label: 'DirectShow — USB / Webcam / Capturadora' },
    { value: 'DECKLINK', label: 'Decklink — Blackmagic Design (DeckLink SDK)' },
  ],
  LINUX: [
    { value: 'V4L2',    label: 'V4L2 — USB / Webcam / Capturadora (/dev/video*)' },
    { value: 'DECKLINK', label: 'Decklink — Blackmagic Design (DeckLink SDK)' },
  ],
}

const DEVICE_PLACEHOLDER: Record<string, string> = {
  DSHOW:    'USB Video Capture · Integrated Webcam · HDMI Capture Card',
  V4L2:     '/dev/video0',
  DECKLINK: 'Intensity Shuttle · DeckLink Mini Recorder · UltraStudio',
}

// Extrai URL de embed YouTube/Twitch — mesmo helper do ClipsPage
function embedUrl(sourceUrl: string): string | null {
  try {
    const u = new URL(sourceUrl)
    const ytMatch = sourceUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)
    if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1`
    if (u.hostname.includes('youtube.com') && !ytMatch) {
      return `https://www.youtube.com/embed/live_stream?channel=${u.pathname.split('/').pop()}&autoplay=1`
    }
    const twMatch = sourceUrl.match(/twitch\.tv\/([A-Za-z0-9_]+)/)
    if (twMatch) return `https://player.twitch.tv/?channel=${twMatch[1]}&parent=${window.location.hostname}&autoplay=true`
  } catch {}
  return null
}

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
  IP: '🌐', YOUTUBE: '▶️', SRT: '📡', SDI: '🎬', USB: '🔌', LOCAL_DEVICE: '🖥️', CLIP: '🎞️', WEBCAM: '📷',
}

const needsUrl         = (t: InputSourceType) => t === 'IP' || t === 'YOUTUBE'
const needsSrt         = (t: InputSourceType) => t === 'SRT'
const needsDevice      = (t: InputSourceType) => t === 'SDI' || t === 'USB'
const needsLocalDevice = (t: InputSourceType) => t === 'LOCAL_DEVICE'
const needsClip        = (t: InputSourceType) => t === 'CLIP'

export default function InputSourcesPage() {
  const qc = useQueryClient()
  const youtubeEnabled = useYoutubeEnabled()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<InputSource | null>(null)
  const [form, setForm] = useState(empty)
  const [srtCfg, setSrtCfg] = useState<SrtConfig>(emptySrt)
  const [udpCfg, setUdpCfg] = useState<UdpConfig>(emptyUdp)
  const [localDeviceCfg, setLocalDeviceCfg] = useState<LocalDeviceConfig>(emptyLocalDevice)
  const [cmdCopied, setCmdCopied] = useState(false)
  const cmdRef = useRef<HTMLTextAreaElement>(null)
  const [previewSource, setPreviewSource] = useState<InputSource | null>(null)
  const [previewStreamUrl, setPreviewStreamUrl] = useState<string | null>(null)
  const [previewEmbedUrl, setPreviewEmbedUrl] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)
  const [deviceDropdownOpen, setDeviceDropdownOpen] = useState(false)

  const [clipSearch, setClipSearch] = useState('')
  const [selectedClip, setSelectedClip] = useState<Clip | null>(null)

  const { data = [], isLoading } = useQuery({ queryKey: ['input-sources'], queryFn: inputSourcesApi.list })
  const { data: channels = [] } = useQuery({ queryKey: ['channels'], queryFn: channelsApi.list })
  const { data: graphics = [] } = useQuery({ queryKey: ['graphics'], queryFn: graphicsApi.list, staleTime: 30_000 })
  const { data: clipsData } = useQuery({
    queryKey: ['clips-search-src', clipSearch],
    queryFn: () => clipsApi.list({ search: clipSearch || undefined, limit: 30 } as any),
    enabled: open && form.type === 'CLIP',
  })

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
      const isLocal = form.type === 'LOCAL_DEVICE'
      const isClip  = form.type === 'CLIP'
      // Para URL: auto-detecta se precisa de yt-dlp e persiste o tipo correto
      const effectiveType = (form.type === 'IP' && form.url && urlNeedsYtDlp(form.url)) ? 'YOUTUBE' : form.type
      const payload = {
        name:         form.name,
        type:         effectiveType,
        url:          isLocal
          ? (localDeviceCfg.srtPort ? `srt://:${localDeviceCfg.srtPort}?mode=listener&timeout=15000000` : undefined)
          : isClip ? undefined
          : getUrlForSave(),
        device:       (!isLocal && !isClip && form.device) ? form.device : undefined,
        deviceOs:     isLocal ? localDeviceCfg.os : undefined,
        deviceDriver: isLocal ? localDeviceCfg.driver : undefined,
        deviceName:   isLocal ? localDeviceCfg.deviceName || undefined : undefined,
        serverIp:     isLocal ? localDeviceCfg.serverIp || undefined : undefined,
        clipId:       isClip ? (selectedClip?.id || form.clipId || undefined) : null,
        channelId:        form.channelId || undefined,
        graphicId:        form.graphicId || null,
        inputNumber:      form.inputNumber ? parseInt(form.inputNumber, 10) : null,
        scteWatchEnabled: form.scteWatchEnabled,
        scteAction:       form.scteAction,
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
    mutationFn: (item: InputSource) => inputSourcesApi.update(item.id, { enabled: !item.enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['input-sources'] }),
  })

  function openNew() {
    setEditing(null); setForm(empty); setSrtCfg(emptySrt); setUdpCfg(emptyUdp)
    setLocalDeviceCfg(emptyLocalDevice); setSelectedClip(null); setClipSearch(''); setCmdCopied(false); setOpen(true)
  }
  function openEdit(s: InputSource) {
    setEditing(s)
    // YOUTUBE legado → exibe como IP na UI (URL unificada)
    const uiType: InputSourceType = s.type === 'YOUTUBE' ? 'IP' : s.type
    setForm({ name: s.name, type: uiType, url: s.url ?? '', device: s.device ?? '', channelId: s.channelId ?? '', clipId: s.clipId ?? '', graphicId: (s as any).graphicId ?? '', inputNumber: s.inputNumber != null ? String(s.inputNumber) : '', scteWatchEnabled: s.scteWatchEnabled ?? false, scteAction: (s.scteAction as 'LOG' | 'BREAK') ?? 'LOG' })
    if (s.type === 'SRT' && s.url) setSrtCfg(parseSrtUrl(s.url))
    else setSrtCfg(emptySrt)
    setUdpCfg(emptyUdp)
    if (s.type === 'LOCAL_DEVICE') {
      const os = (s.deviceOs as LocalDeviceConfig['os']) || 'WINDOWS'
      const driver = (s.deviceDriver as LocalDeviceConfig['driver']) || 'DSHOW'
      const port = s.url ? (s.url.match(/^srt:\/\/:(\d+)/) ?? [])[1] ?? '' : ''
      setLocalDeviceCfg({ os, driver, deviceName: s.deviceName ?? '', srtPort: port, serverIp: s.serverIp ?? '' })
    } else {
      setLocalDeviceCfg(emptyLocalDevice)
    }
    if (s.type === 'CLIP' && s.clip) setSelectedClip(s.clip as any)
    else setSelectedClip(null)
    setClipSearch('')
    setCmdCopied(false)
    setOpen(true)
  }

  function handleTypeChange(type: InputSourceType) {
    setForm((v) => ({ ...v, type, url: '', device: '', clipId: '' }))
    setSrtCfg(emptySrt); setUdpCfg(emptyUdp); setLocalDeviceCfg(emptyLocalDevice)
    setSelectedClip(null); setClipSearch('')
  }

  const f = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((v) => ({ ...v, [k]: e.target.value }))

  async function handlePreview(s: InputSource) {
    setPreviewSource(s)
    setPreviewStreamUrl(null)
    setPreviewEmbedUrl(null)

    // Tipo CLIP: usa o clipe associado diretamente (sem ida ao backend)
    if (s.type === 'CLIP' && s.clip) {
      const clip = s.clip
      if (clip.sourceType === 'URL' && clip.sourceUrl) {
        const embed = embedUrl(clip.sourceUrl)
        if (embed) { setPreviewEmbedUrl(embed); return }
      }
      if (clip.media?.hlsPath && clip.media.ingestStatus === 'READY') {
        const mediaId = clip.media.hlsPath.split('/')[1]
        setPreviewStreamUrl(`/api/media/stream/${mediaId}/index.m3u8`)
        return
      }
      toast.error('Clipe sem mídia disponível para preview.')
      setPreviewSource(null)
      return
    }

    // Tipo YOUTUBE ou IP com URL YouTube/Twitch: usa embed iframe (mais confiável)
    const directUrl = s.url ?? ''
    if ((s.type === 'YOUTUBE' || (s.type === 'IP' && /youtube\.com|youtu\.be|twitch\.tv/i.test(directUrl)))) {
      const embed = embedUrl(directUrl)
      if (embed) { setPreviewEmbedUrl(embed); return }
    }

    if (s.type === 'IP' && s.url?.match(/^https?:\/\//i)) {
      setPreviewStreamUrl(s.url)
    } else if (s.type === 'WEBCAM' || s.url || s.device) {
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
    // Só pede stop ao backend se realmente iniciou preview server-side (não embed)
    if (previewSource && previewSource.type !== 'IP' && previewSource.type !== 'CLIP' && !previewEmbedUrl) {
      inputSourcesApi.stopPreview(previewSource.id).catch(() => {})
    }
    setPreviewSource(null)
    setPreviewStreamUrl(null)
    setPreviewEmbedUrl(null)
  }

  function canPreview(s: InputSource) {
    if (s.type === 'CLIP') return !!(s.clip) // CLIP: preview se tem clipe associado
    if (s.type === 'WEBCAM') return true // backend valida se há sessão ativa
    return !!(s.url || s.device)
  }

  // Detecta se a URL precisa de yt-dlp (YouTube/Twitch) para mostrar hint ao usuário
  const ytDlpDetected = form.type === 'IP' && /youtube\.com|youtu\.be|twitch\.tv/i.test(form.url)

  const urlPlaceholders: Partial<Record<InputSourceType, string>> = {
    IP:      'rtmp://servidor/live/stream · rtsp://camera/stream · http://servidor/stream.m3u8',
    YOUTUBE: 'https://www.youtube.com/watch?v=... · https://www.twitch.tv/...',
  }

  // URL de preview para mostrar na tabela
  function displayUrl(s: InputSource): string {
    if (s.type === 'CLIP') return s.clip ? `${s.clip.code} — ${s.clip.title}` : '(clipe não encontrado)'
    if (!s.url && !s.device) return '—'
    if (s.type === 'SRT' && s.url) {
      const cfg = parseSrtUrl(s.url)
      return cfg.host ? `${cfg.host}:${cfg.port} (${cfg.mode})` : s.url
    }
    return s.url ?? s.device ?? '—'
  }

  // Label unificado: YOUTUBE legado exibe como URL com badge yt-dlp
  function displayTypeLabel(s: InputSource): string {
    if (s.type === 'YOUTUBE') return 'URL (yt-dlp)'
    return SOURCE_TYPE_LABELS[s.type] ?? s.type
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
            <Th className="w-10 text-center">Idx</Th>
            <Th>Nome</Th>
            <Th>Tipo</Th>
            <Th>URL / Dispositivo</Th>
            <Th>Canal</Th>
            <Th>No playout</Th>
            <Th className="w-28 text-right">Ações</Th>
          </Thead>
          <Tbody>
            {isLoading ? (
              <Tr><Td colSpan={7} className="text-center text-gray-500 py-8">Carregando...</Td></Tr>
            ) : data.length === 0 ? (
              <Tr><Td colSpan={7} className="text-center text-gray-500 py-8">Nenhuma fonte configurada.</Td></Tr>
            ) : [...data].sort((a, b) => (a.inputNumber ?? 999) - (b.inputNumber ?? 999)).map((s) => (
              <Tr key={s.id}>
                <Td className="text-center">
                  {s.inputNumber != null
                    ? <span className="text-[11px] font-black text-brand-400 bg-brand-900/30 px-1.5 py-0.5 rounded">{s.inputNumber}</span>
                    : <span className="text-gray-700">—</span>}
                </Td>
                <Td><span className="font-medium text-white">{s.name}</span></Td>
                <Td>
                  <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded">
                    {TYPE_ICONS[s.type] ?? '🎬'} {displayTypeLabel(s)}
                  </span>
                </Td>
                <Td>
                  <span className="font-mono text-xs text-gray-400 truncate max-w-xs block">
                    {displayUrl(s)}
                  </span>
                </Td>
                <Td>{s.channel ? `Canal ${s.channel.number} — ${s.channel.name}` : <span className="text-gray-600">Todos</span>}</Td>
                <Td>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button onClick={() => toggle.mutate(s)} className="focus:outline-none">
                      <StatusBadge active={s.enabled} />
                    </button>
                    {s.scteWatchEnabled && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/15 text-amber-400 tracking-wider">
                        SCTE
                      </span>
                    )}
                  </div>
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
          <div className="flex gap-3">
            <div className="flex-1"><Input label="Nome *" value={form.name} onChange={f('name')} placeholder="YouTube Ao Vivo" /></div>
            <div className="w-24"><Input label="Nº Switcher" type="number" min="1" value={form.inputNumber} onChange={f('inputNumber')} placeholder="1" /></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select label="Tipo *" value={form.type} onChange={(e) => handleTypeChange(e.target.value as InputSourceType)}>
              {SELECTABLE_TYPES.map((k) => (
                <option key={k} value={k}>{SOURCE_TYPE_LABELS[k]}</option>
              ))}
            </Select>
            <Select label="Canal" value={form.channelId} onChange={f('channelId')}>
              <option value="">Todos os canais</option>
              {channels.filter((c) => c.active).map((c) => (
                <option key={c.id} value={c.id}>Canal {c.number} — {c.name}</option>
              ))}
            </Select>
            <Select label="Gráfico (ao comutar para esta entrada)" value={form.graphicId} onChange={f('graphicId')}>
              <option value="">Nenhum</option>
              {graphics.filter((g) => g.active).map((g) => (
                <option key={g.id} value={g.id}>{g.name}{g.template ? ` (${g.template.name})` : ''}</option>
              ))}
            </Select>
          </div>

          {/* IP / YOUTUBE — URL unificada */}
          {needsUrl(form.type) && (
            <div className="space-y-1.5">
              <Input
                label="URL *"
                value={form.url}
                onChange={f('url')}
                placeholder="rtmp://... · rtsp://... · http://... · https://youtube.com/... · https://twitch.tv/..."
              />
              {ytDlpDetected ? (
                <p className="text-[11px] text-amber-400/90 flex items-center gap-1">
                  <Youtube className="h-3 w-3" />
                  URL YouTube/Twitch detectada — será resolvida automaticamente via yt-dlp no momento da exibição.
                </p>
              ) : form.url ? (
                <p className="text-[11px] text-gray-500">
                  URL direta — passada ao FFmpeg sem processamento adicional (RTMP, RTSP, HLS, etc.)
                </p>
              ) : null}
            </div>
          )}

          {/* CLIP — seletor de clipe cadastrado */}
          {needsClip(form.type) && (
            <div className="space-y-2">
              <Input
                label="Buscar clipe"
                value={clipSearch}
                onChange={(e) => setClipSearch(e.target.value)}
                placeholder="Buscar por título ou código..."
                icon={<Play className="h-4 w-4" />}
              />
              {selectedClip && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600/20 border border-brand-500/40 text-sm">
                  <span className="text-xs bg-brand-700/50 text-brand-300 px-1.5 py-0.5 rounded font-mono">{selectedClip.sourceType === 'URL' ? 'URL' : 'FILE'}</span>
                  <span className="font-medium text-white flex-1 truncate">{selectedClip.title}</span>
                  <span className="text-xs font-mono text-gray-400">{selectedClip.code}</span>
                  <button type="button" onClick={() => { setSelectedClip(null); setForm((v) => ({ ...v, clipId: '' })) }} className="text-gray-500 hover:text-red-400 ml-1">✕</button>
                </div>
              )}
              <div className="max-h-48 overflow-y-auto space-y-1 rounded-lg border border-gray-700 p-1.5">
                {clipsData?.items.length === 0 && (
                  <p className="text-xs text-gray-500 text-center py-4">Nenhum clipe encontrado</p>
                )}
                {clipsData?.items.map((clip) => (
                  <button
                    key={clip.id}
                    type="button"
                    onClick={() => { setSelectedClip(clip); setForm((v) => ({ ...v, clipId: clip.id })) }}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded text-left text-sm transition-colors ${selectedClip?.id === clip.id ? 'bg-brand-600/20 border border-brand-500/40' : 'hover:bg-gray-700/50'}`}
                  >
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 ${clip.sourceType === 'URL' ? 'bg-sky-900/50 text-sky-400' : clip.media?.ingestStatus === 'READY' ? 'bg-emerald-900/50 text-emerald-400' : 'bg-orange-900/50 text-orange-400'}`}>
                      {clip.sourceType === 'URL' ? 'URL' : clip.media?.ingestStatus === 'READY' ? 'FILE' : 'SEM ARQ'}
                    </span>
                    <span className="text-white truncate flex-1">{clip.title}</span>
                    <span className="text-xs font-mono text-gray-500 shrink-0">{clip.code}</span>
                    <span className="text-[10px] text-gray-600 shrink-0">{MODALITY_LABELS[clip.modality]}</span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-gray-500">
                Clipes FILE usam o stream HLS interno. Clipes URL são resolvidos via yt-dlp no momento da exibição.
              </p>
            </div>
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
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="col-span-3">
                  <Input
                    label={srtCfg.mode === 'listener' ? 'Host / IP (não usado no listener)' : 'Host / IP *'}
                    value={srtCfg.mode === 'listener' ? '' : srtCfg.host}
                    onChange={(e) => setSrtCfg((v) => ({ ...v, host: e.target.value }))}
                    placeholder={srtCfg.mode === 'listener' ? '0.0.0.0 (todas as interfaces)' : window.location.hostname}
                    disabled={srtCfg.mode === 'listener'}
                  />
                </div>
                <div className="col-span-2">
                  <Input
                    label="Porta * (4100–4199)"
                    value={srtCfg.port}
                    onChange={(e) => setSrtCfg((v) => ({ ...v, port: e.target.value }))}
                    placeholder="4100–4199"
                  />
                </div>
              </div>
              {srtCfg.mode === 'listener' && (
                <p className="text-[11px] text-amber-400/80 bg-amber-950/30 border border-amber-800/40 rounded px-2.5 py-1.5">
                  Listener: aguarda o encoder/câmera enviar para esta porta. Use portas no range 4100–4199 (mapeado no docker-compose).
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

          {/* LOCAL_DEVICE — Host Agent */}
          {needsLocalDevice(form.type) && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Select
                  label="Sistema operacional do host"
                  value={localDeviceCfg.os}
                  onChange={(e) => {
                    const os = e.target.value as LocalDeviceConfig['os']
                    const driver = os === 'WINDOWS' ? 'DSHOW' : 'V4L2'
                    setLocalDeviceCfg((v) => ({ ...v, os, driver }))
                  }}
                >
                  <option value="WINDOWS">Windows</option>
                  <option value="LINUX">Linux</option>
                </Select>
                <Select
                  label="Driver / Interface de captura"
                  value={localDeviceCfg.driver}
                  onChange={(e) => setLocalDeviceCfg((v) => ({ ...v, driver: e.target.value as LocalDeviceConfig['driver'] }))}
                >
                  {DRIVER_OPTIONS[localDeviceCfg.os].map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
              </div>

              <Input
                label={localDeviceCfg.driver === 'V4L2' ? 'Caminho do dispositivo *' : 'Nome do dispositivo *'}
                value={localDeviceCfg.deviceName}
                onChange={(e) => setLocalDeviceCfg((v) => ({ ...v, deviceName: e.target.value }))}
                placeholder={DEVICE_PLACEHOLDER[localDeviceCfg.driver]}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Porta SRT — listener (4100–4199) *"
                  type="number"
                  min={4100}
                  max={4199}
                  value={localDeviceCfg.srtPort}
                  onChange={(e) => setLocalDeviceCfg((v) => ({ ...v, srtPort: e.target.value }))}
                  placeholder="4100–4199"
                />
                <Input
                  label="IP ou hostname do servidor TVPlay"
                  value={localDeviceCfg.serverIp}
                  onChange={(e) => {
                    // Remove protocolo (http://, https://) e barra final que o usuário possa colar
                    const clean = e.target.value.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
                    setLocalDeviceCfg((v) => ({ ...v, serverIp: clean }))
                  }}
                  placeholder="192.168.1.100 ou meuservidor.com.br"
                />
              </div>

              {localDeviceCfg.srtPort && (
                <div className="text-[11px] font-mono text-gray-500 bg-gray-800/60 rounded px-2.5 py-1.5">
                  TVPlay escutará em: <span className="text-gray-300">srt://:{localDeviceCfg.srtPort}?mode=listener</span>
                  <p className="text-gray-600 mt-0.5">Porta {localDeviceCfg.srtPort} deve estar mapeada no docker-compose (range 4000–4020/udp).</p>
                </div>
              )}

              {/* Comando FFmpeg gerado */}
              {buildLocalDeviceCommand(localDeviceCfg) && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-gray-400">Comando FFmpeg para executar no host</p>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => downloadScript(localDeviceCfg)}
                        className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-brand-400 transition-colors"
                        title={localDeviceCfg.os === 'WINDOWS' ? 'Baixar tvplay-agent.bat (duplo-clique para executar)' : 'Baixar tvplay-agent.sh'}
                      >
                        <Download className="h-3 w-3" />
                        {localDeviceCfg.os === 'WINDOWS' ? 'Baixar .bat' : 'Baixar .sh'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const cmd = buildLocalDeviceCommand(localDeviceCfg)
                          navigator.clipboard.writeText(cmd).then(() => {
                            setCmdCopied(true)
                            setTimeout(() => setCmdCopied(false), 2000)
                          })
                        }}
                        className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-brand-400 transition-colors"
                      >
                        {cmdCopied
                          ? <><Check className="h-3 w-3 text-emerald-400" /><span className="text-emerald-400">Copiado!</span></>
                          : <><Copy className="h-3 w-3" />Copiar</>}
                      </button>
                    </div>
                  </div>
                  <textarea
                    ref={cmdRef}
                    readOnly
                    rows={3}
                    value={buildLocalDeviceCommand(localDeviceCfg)}
                    className="w-full text-[11px] font-mono text-emerald-300 bg-gray-900 border border-gray-700 rounded px-3 py-2 resize-none focus:outline-none"
                  />
                  {!localDeviceCfg.serverIp && (
                    <p className="text-[10px] text-amber-500/80">
                      Substitua <span className="font-mono">IP_DO_SERVIDOR</span> pelo IP da máquina que executa o TVPlay (docker host).
                    </p>
                  )}
                </div>
              )}

              <div className="p-3 bg-gray-800/50 rounded-lg text-xs text-gray-500 space-y-1.5">
                <p className="font-medium text-gray-400 flex items-center gap-1.5">
                  <Monitor className="h-3.5 w-3.5" /> Como funciona o Host Agent
                </p>
                <p>O TVPlay abre um listener SRT na porta indicada. Execute o comando FFmpeg acima no host Windows ou Linux para capturar o dispositivo e enviar o stream via SRT.</p>
                <p className="text-gray-600">
                  {localDeviceCfg.driver === 'DSHOW' && 'Para listar câmeras no Windows: ffmpeg -list_devices true -f dshow -i dummy'}
                  {localDeviceCfg.driver === 'V4L2'  && 'Para listar câmeras no Linux: v4l2-ctl --list-devices'}
                  {localDeviceCfg.driver === 'DECKLINK' && 'Para listar placas Decklink: ffmpeg -f decklink -list_devices 1 -i dummy'}
                </p>
              </div>
            </div>
          )}

          {/* Aviso: YouTube/Twitch desabilitado neste servidor (VPS) */}
          {!youtubeEnabled && (ytDlpDetected || form.type === 'YOUTUBE') && (
            <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-xs text-red-300 space-y-1">
              <p className="font-medium">⚠ YouTube/Twitch não disponível neste servidor</p>
              <p className="text-red-300/80">
                Este servidor (VPS) está com a resolução via yt-dlp desabilitada, pois o YouTube bloqueia
                quase todas as requisições de IPs de datacenter. Esta entrada será salva, mas ficará em
                fallback (preto) durante a transmissão. Use este tipo de fonte apenas em ambiente local.
              </p>
            </div>
          )}

          {/* Dica: tipo URL (IP) */}
          {form.type === 'IP' && !ytDlpDetected && (
            <div className="p-3 bg-gray-800/50 rounded-lg text-xs text-gray-500 space-y-1">
              <p className="font-medium text-gray-400">URL — protocolo direto (sem resolução)</p>
              <p>Use para fontes com URL direta: <span className="text-gray-300">RTMP · RTSP · HTTP · HLS (m3u8)</span></p>
              <p>Para YouTube ou Twitch ao vivo, use o tipo <span className="text-gray-300">YouTube / Twitch</span> para resolução automática via yt-dlp.</p>
            </div>
          )}
          {/* Dica: tipo YOUTUBE */}
          {form.type === 'YOUTUBE' && (
            <div className="p-3 bg-gray-800/50 rounded-lg text-xs text-gray-500 space-y-1">
              <p className="font-medium text-gray-400">YouTube / Twitch — yt-dlp</p>
              <p>Cole o link da transmissão ao vivo ou vídeo. O servidor resolve o stream automaticamente.</p>
              <p className="text-amber-500/80">Funciona apenas para streams e vídeos públicos.</p>
            </div>
          )}
          {form.type === 'SRT' && (
            <div className="p-3 bg-gray-800/50 rounded-lg text-xs text-gray-500 space-y-1">
              <p className="font-medium text-gray-400">Sobre o modo SRT</p>
              <p><span className="text-gray-300">Caller</span>: o servidor conecta ativamente ao endereço informado. Use quando há um encoder/servidor SRT esperando conexão.</p>
              <p><span className="text-gray-300">Listener</span>: o servidor aguarda conexão de entrada na porta indicada. Use quando o encoder é quem vai conectar aqui.</p>
            </div>
          )}

          {/* SCTE-35 watch — apenas para fontes de stream ao vivo */}
          {['IP', 'SRT', 'RTSP'].includes(form.type) && (
            <div className="space-y-2 border border-gray-700/60 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-200">Monitorar SCTE-35</p>
                  <p className="text-[11px] text-gray-500">Detecta splice_insert nesta entrada e exibe status em tempo real</p>
                </div>
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, scteWatchEnabled: !f.scteWatchEnabled }))}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ml-4 ${form.scteWatchEnabled ? 'bg-amber-500' : 'bg-gray-700'}`}
                >
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${form.scteWatchEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
              </div>
              {form.scteWatchEnabled && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Ação ao detectar cue</label>
                  <select
                    value={form.scteAction}
                    onChange={(e) => setForm((f) => ({ ...f, scteAction: e.target.value as 'LOG' | 'BREAK' }))}
                    className="w-full rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm px-3 py-2 focus:outline-none focus:border-brand-500"
                  >
                    <option value="LOG">Apenas registrar (sem ação automática)</option>
                    <option value="BREAK">BREAK automático — avança para o próximo bloco de break do roteiro</option>
                  </select>
                  {form.scteAction === 'BREAK' && (
                    <p className="text-[11px] text-amber-500/80">SCTE OUT → pula para o próximo BREAK do roteiro ativo · SCTE IN → retoma após o BREAK</p>
                  )}
                </div>
              )}
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
        {previewEmbedUrl ? (
          <iframe
            src={previewEmbedUrl}
            className="w-full aspect-video rounded-lg bg-black"
            allow="autoplay; fullscreen"
            allowFullScreen
            title={previewSource?.name ?? 'Preview'}
          />
        ) : resolving ? (
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
