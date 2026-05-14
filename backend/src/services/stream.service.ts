import { spawn, ChildProcess } from 'child_process'
import { prisma } from '../lib/prisma'
import { config } from '../config'

export type GraphicConfig = {
  logoUrl?: string | null
  logoPosition?: string | null
  showClock?: boolean
  lowerText?: string | null
}

interface StreamProcess {
  proc:           ChildProcess
  outputId:       string
  type:           string
  name:           string
  stopped:        boolean
  contentGraphic: GraphicConfig | null
}

type OutputConfig = {
  id: string
  name: string
  type: string
  url?: string | null
  streamKey?: string | null
  device?: string | null
  deviceOs?: string | null
  deviceDriver?: string | null
  deviceName?: string | null
  videoResolution?: string | null
  videoBitrate?: number | null
  audioBitrate?: number | null
  graphic?: GraphicConfig | null
}

// Map: channelId → Map<outputId, StreamProcess>
const channelProcs = new Map<string, Map<string, StreamProcess>>()

function appendSrtPassphrase(url: string, passphrase: string | null | undefined): string {
  if (!passphrase) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}passphrase=${encodeURIComponent(passphrase)}`
}

// Garante URL absoluta acessível pelo FFmpeg dentro do container
function resolveLogoUrl(url: string | null | undefined): string {
  if (!url) return ''
  if (url.startsWith('/')) return `http://localhost:${config.port}${url}`
  return url
}

function logoPositionExpr(pos: string): string {
  switch (pos) {
    case 'top-left':     return '10:10'
    case 'bottom-left':  return '10:H-h-10'
    case 'bottom-right': return 'W-w-10:H-h-10'
    default:             return 'W-w-10:10'   // top-right (padrão)
  }
}

// Constrói o filtro de vídeo. hasLogoInput=true significa que o logo já foi
// adicionado como segundo input (-i logo), disponível como [1:v].
function buildVideoFilter(
  videoResolution: string | null | undefined,
  graphic: GraphicConfig | null | undefined,
  hasLogoInput: boolean,
): { filterArgs: string[]; mapArgs: string[] } {
  const hasScale = !!videoResolution
  const hasLogo  = hasLogoInput
  const hasClock = graphic?.showClock === true
  const hasText  = !!(graphic?.lowerText?.trim())

  if (!hasScale && !hasLogo && !hasClock && !hasText) return { filterArgs: [], mapArgs: [] }

  const escapeText = (t: string) => t.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const clockFilter = `drawtext=text='%{localtime\\:%T}':fontsize=48:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=8:x=w-tw-20:y=20`
  const lowerFilter = hasText
    ? `drawtext=text='${escapeText(graphic!.lowerText!.trim())}':fontsize=32:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8:x=(w-tw)/2:y=h-th-30`
    : null

  if (!hasLogo) {
    const parts: string[] = []
    if (hasScale)    parts.push(`scale=${videoResolution}`)
    if (hasClock)    parts.push(clockFilter)
    if (lowerFilter) parts.push(lowerFilter)
    return { filterArgs: ['-vf', parts.join(',')], mapArgs: [] }
  }

  // filter_complex: logo como [1:v] (segundo input, com -stream_loop -1)
  const segs: string[] = []
  let cur = '[0:v]'
  let n = 0
  const nxt = () => `[v${n++}]`

  if (hasScale) {
    const out = nxt()
    segs.push(`${cur}scale=${videoResolution}${out}`)
    cur = out
  }

  const overOut = nxt()
  segs.push(`${cur}[1:v]overlay=${logoPositionExpr(graphic!.logoPosition ?? 'top-right')}${overOut}`)
  cur = overOut

  if (hasClock) { const out = nxt(); segs.push(`${cur}${clockFilter}${out}`); cur = out }
  if (lowerFilter) { const out = nxt(); segs.push(`${cur}${lowerFilter}${out}`); cur = out }

  return {
    filterArgs: ['-filter_complex', segs.join(';')],
    mapArgs:    ['-map', cur, '-map', '0:a?'],
  }
}

function buildArgs(
  inputUrl: string,
  cueIn: number,
  output: OutputConfig,
  isLive = false,
  effectiveGraphic: GraphicConfig | null = null,
): string[] | null {
  // Resolve URL do logo: relativa → http://localhost:PORT/... (acessível dentro do container)
  const logoUrl = (!isLive && effectiveGraphic?.logoUrl) ? resolveLogoUrl(effectiveGraphic.logoUrl) : null

  const lowerInputUrl = inputUrl.toLowerCase()
  const isRtmpInput = lowerInputUrl.startsWith('rtmp://')
  const isRtspInput = lowerInputUrl.startsWith('rtsp://')
  const isHttpInput = lowerInputUrl.startsWith('http://') || lowerInputUrl.startsWith('https://')

  const input: string[] = [
    '-hide_banner', '-loglevel', 'warning',
    // RTMP input: reconnect automático se a fonte cair
    ...(isLive && isRtmpInput ? ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5'] : []),
    // RTSP input: força TCP (mais estável) e define timeout de 10s
    ...(isLive && isRtspInput ? ['-rtsp_transport', 'tcp', '-stimeout', '10000000'] : []),
    // HTTP/HLS input (yt-dlp resolve URLs): reconnect + timeout longo — evita corte por timeout padrão (~20s)
    ...(isLive && isHttpInput ? ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '10', '-timeout', '30000000'] : []),
    ...(isLive ? [] : ['-re']),
    ...(cueIn > 0 && !isLive ? ['-ss', String(Math.floor(cueIn))] : []),
    '-i', inputUrl,
    // Logo como segundo input com loop infinito (imagem estática)
    ...(logoUrl ? ['-stream_loop', '-1', '-i', logoUrl] : []),
  ]

  const aBitrate = output.audioBitrate ?? 128
  const videoBitrateArgs = (!isLive && output.videoBitrate)
    ? ['-b:v', `${output.videoBitrate}k`,
       '-maxrate', `${Math.round(output.videoBitrate * 1.5)}k`,
       '-bufsize', `${output.videoBitrate * 2}k`]
    : []

  let videoCodec: string[]
  if (isLive) {
    // -map 0:v:0 -map 0:a:0 garante seleção de uma única faixa de vídeo e áudio
    // necessário para HLS do YouTube que pode ter múltiplas faixas
    videoCodec = ['-c', 'copy', '-map', '0:v:0', '-map', '0:a:0']
  } else {
    const { filterArgs, mapArgs } = buildVideoFilter(output.videoResolution, effectiveGraphic, !!logoUrl)
    videoCodec = [
      ...filterArgs,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
      ...videoBitrateArgs,
      '-c:a', 'aac', '-ar', '44100', '-b:a', `${aBitrate}k`,
      ...mapArgs,
    ]
  }

  switch (output.type) {
    case 'RTMP': {
      if (!output.url) return null
      const dest = output.streamKey ? `${output.url}/${output.streamKey}` : output.url
      return [...input, ...videoCodec, '-f', 'flv', dest]
    }
    case 'HLS_PUSH': {
      if (!output.url) return null
      return [...input,
        '-c', 'copy', '-f', 'hls',
        '-hls_time', '4', '-hls_list_size', '5',
        '-hls_flags', 'delete_segments+append_list',
        output.url,
      ]
    }
    case 'SRT': {
      if (!output.url) return null
      return [...input, ...videoCodec, '-f', 'mpegts', appendSrtPassphrase(output.url, output.streamKey)]
    }
    case 'UDP': {
      if (!output.url) return null
      return [...input, ...videoCodec, '-f', 'mpegts', output.url]
    }
    case 'RTP': {
      if (!output.url) return null
      return [...input, ...videoCodec, '-f', 'rtp', output.url]
    }
    case 'SDI': {
      // Saída direta para placa Blackmagic DeckLink instalada no host/container
      const deckDevice = output.device ?? 'DeckLink'
      return [...input, ...videoCodec, '-f', 'decklink', deckDevice]
    }
    case 'LOCAL_DEVICE': {
      // Envia via SRT para agente remoto (Windows/Linux com DeckLink ou USB) — Cenário 1
      if (!output.url) return null
      return [...input, ...videoCodec, '-f', 'mpegts', appendSrtPassphrase(output.url, output.streamKey)]
    }
    default:
      return null
  }
}

function hlsUrlForMedia(mediaId: string): string {
  return `http://localhost:${config.port}/api/media/stream/${mediaId}/index.m3u8`
}

function spawnOutput(
  channelId: string,
  output: OutputConfig,
  hlsUrl: string,
  cueIn: number,
  isLive = false,
  contentGraphic: GraphicConfig | null = null,
): StreamProcess | null {
  // Prioridade: gráfico do conteúdo (clip/playlist) > gráfico da saída
  const effectiveGraphic = contentGraphic ?? output.graphic ?? null
  const args = buildArgs(hlsUrl, cueIn, output, isLive, effectiveGraphic)
  if (!args) return null

  const proc = spawn(config.ffmpeg.path, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  const sp: StreamProcess = {
    proc, outputId: output.id, type: output.type, name: output.name,
    stopped: false, contentGraphic,
  }

  proc.stdout?.on('data', () => {})
  proc.stderr?.on('data', (d: Buffer) => {
    const msg = d.toString().trim()
    if (msg) console.log(`[stream/${channelId}/${output.name}] ${msg}`)
  })

  proc.on('exit', (code) => {
    // Só remove do mapa se este processo ainda for o registrado — evita apagar novo processo ao trocar clipe
    const registered = channelProcs.get(channelId)?.get(output.id)
    if (registered?.proc === proc) {
      channelProcs.get(channelId)?.delete(output.id)
    }
    const isError = code !== null && code !== 0 && code !== 255
    if (isError && !sp.stopped) {
      console.warn(`[stream/${channelId}/${output.name}] Saiu com código ${code} — reconectando em 5s...`)
      setTimeout(async () => {
        if (sp.stopped) return
        const dbOutput = await prisma.streamOutput.findUnique({
          where: { id: output.id },
          include: { graphic: true },
        })
        if (!dbOutput?.active) return
        const newSp = spawnOutput(channelId, dbOutput, hlsUrl, 0, false, sp.contentGraphic)
        if (!newSp) return
        if (!channelProcs.has(channelId)) channelProcs.set(channelId, new Map())
        channelProcs.get(channelId)!.set(output.id, newSp)
      }, 5000)
    }
  })

  console.log(`[stream/${channelId}] Iniciando ${output.type} → ${output.name}${contentGraphic?.logoUrl ? ` | logo: ${resolveLogoUrl(contentGraphic.logoUrl)}` : ''}`)
  console.log(`[stream/${channelId}] FFmpeg args: ${args.join(' ')}`)
  return sp
}

// ─── Controle por canal ───────────────────────────────────────────────────────

export async function startStreaming(
  channelId: string,
  mediaId: string | null,
  cueIn = 0,
  contentGraphic: GraphicConfig | null = null,
) {
  await stopStreaming(channelId)
  if (!mediaId) return

  const outputs = await prisma.streamOutput.findMany({
    where: { channelId, active: true },
    include: { graphic: true },
  })
  if (!outputs.length) return

  const hlsUrl = hlsUrlForMedia(mediaId)
  const map = new Map<string, StreamProcess>()
  for (const output of outputs) {
    const sp = spawnOutput(channelId, output, hlsUrl, cueIn, false, contentGraphic)
    if (sp) map.set(output.id, sp)
  }
  if (map.size) channelProcs.set(channelId, map)
}

export function stopStreaming(channelId: string) {
  const map = channelProcs.get(channelId)
  if (!map?.size) return Promise.resolve()
  for (const sp of map.values()) {
    sp.stopped = true
    try { sp.proc.kill('SIGTERM') } catch {}
    console.log(`[stream/${channelId}] Parando ${sp.type}/${sp.name}`)
  }
  channelProcs.delete(channelId)
  return Promise.resolve()
}

export async function restartStreaming(
  channelId: string,
  mediaId: string | null,
  cueIn = 0,
  contentGraphic: GraphicConfig | null = null,
) {
  await startStreaming(channelId, mediaId, cueIn, contentGraphic)
}

// ─── Controle por output individual ──────────────────────────────────────────

export function stopOutput(channelId: string, outputId: string) {
  const sp = channelProcs.get(channelId)?.get(outputId)
  if (!sp) return
  sp.stopped = true
  try { sp.proc.kill('SIGTERM') } catch {}
  channelProcs.get(channelId)?.delete(outputId)
  console.log(`[stream/${channelId}] Output ${sp.name} parado manualmente`)
}

export async function startOutput(
  channelId: string,
  outputId: string,
  mediaId: string,
  cueIn = 0,
  contentGraphic: GraphicConfig | null = null,
) {
  stopOutput(channelId, outputId)
  const output = await prisma.streamOutput.findUnique({
    where: { id: outputId },
    include: { graphic: true },
  })
  if (!output || !output.active) return
  const sp = spawnOutput(channelId, output, hlsUrlForMedia(mediaId), cueIn, false, contentGraphic)
  if (!sp) return
  if (!channelProcs.has(channelId)) channelProcs.set(channelId, new Map())
  channelProcs.get(channelId)!.set(outputId, sp)
}

export async function reconnectOutput(
  channelId: string, outputId: string, mediaId: string, cueIn = 0,
  contentGraphic: GraphicConfig | null = null,
) {
  await startOutput(channelId, outputId, mediaId, cueIn, contentGraphic)
}

// Para corte de entrada / fallback INPUT_SOURCE.
// Se contentGraphic estiver presente, usa re-encode para aplicar o overlay.
// Caso contrário, usa -c copy (baixa latência).
export async function startStreamingFromUrl(
  channelId: string,
  inputUrl: string,
  contentGraphic: GraphicConfig | null = null,
) {
  await stopStreaming(channelId)
  const outputs = await prisma.streamOutput.findMany({
    where: { channelId, active: true },
    include: { graphic: true },
  })
  if (!outputs.length) return
  const map = new Map<string, StreamProcess>()
  for (const output of outputs) {
    // Re-encode quando há gráfico ativo (necessário para aplicar filtros de overlay)
    const effectiveGraphic = contentGraphic ?? output.graphic ?? null
    const live = !effectiveGraphic  // sem gráfico → copy; com gráfico → re-encode
    const sp = spawnOutput(channelId, output, inputUrl, 0, live, contentGraphic)
    if (sp) map.set(output.id, sp)
  }
  if (map.size) channelProcs.set(channelId, map)
}

// Modo re-encode (-re + libx264): para clips URL na playlist
// Garante compatibilidade com qualquer codec de entrada (VP9, AV1, etc.)
// e respeita a velocidade natural do stream (-re)
export async function startStreamingFromUrlReencode(
  channelId: string,
  inputUrl: string,
  contentGraphic: GraphicConfig | null = null,
) {
  await stopStreaming(channelId)
  const outputs = await prisma.streamOutput.findMany({
    where: { channelId, active: true },
    include: { graphic: true },
  })
  if (!outputs.length) return
  const map = new Map<string, StreamProcess>()
  for (const output of outputs) {
    // isLive=false → usa -re + re-encode (libx264/aac) em vez de -c copy
    const sp = spawnOutput(channelId, output, inputUrl, 0, false, contentGraphic)
    if (sp) map.set(output.id, sp)
  }
  if (map.size) channelProcs.set(channelId, map)
}

// Inicia streaming com fonte gerada (BLACK ou COLORBARS) para manter saída ativa enquanto parado
export async function startStreamingFromFallback(channelId: string, fallbackType: 'BLACK' | 'COLORBARS' | string) {
  await stopStreaming(channelId)
  const outputs = await prisma.streamOutput.findMany({
    where: { channelId, active: true },
    include: { graphic: true },
  })
  if (!outputs.length) return

  const map = new Map<string, StreamProcess>()
  for (const output of outputs) {
    // Usa resolução configurada da saída ou padrão SD
    const size = output.videoResolution ?? '1280x720'
    // Input lavfi correto: sem prefixo 'lavfi:' pois -f lavfi já define o formato
    const videoInput = fallbackType === 'COLORBARS'
      ? `smptehdbars=size=${size}:rate=25`
      : `color=c=black:size=${size}:rate=25`
    const args = buildFallbackArgs(videoInput, output, output.graphic ?? null)
    if (!args) continue
    const proc = spawn(config.ffmpeg.path, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const sp: StreamProcess = { proc, outputId: output.id, type: output.type, name: output.name, stopped: false, contentGraphic: null }
    proc.stdout?.on('data', () => {})
    proc.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim()
      if (msg) console.log(`[stream/${channelId}/${output.name}/fallback] ${msg}`)
    })
    proc.on('exit', (code) => {
      const registeredFb = channelProcs.get(channelId)?.get(output.id)
      if (registeredFb?.proc === proc) {
        channelProcs.get(channelId)?.delete(output.id)
      }
      if (code !== null && code !== 0 && code !== 255 && !sp.stopped) {
        console.warn(`[stream/${channelId}/${output.name}/fallback] Saiu com código ${code} — reconectando em 5s...`)
        setTimeout(() => {
          if (sp.stopped) return
          startStreamingFromFallback(channelId, fallbackType).catch(() => {})
        }, 5000)
      }
    })
    console.log(`[stream/${channelId}] Fallback ${fallbackType} (${size}) → ${output.name}`)
    console.log(`[stream/${channelId}] FFmpeg args: ${args.join(' ')}`)
    map.set(output.id, sp)
  }
  if (map.size) channelProcs.set(channelId, map)
}

// Dois inputs: [0] padrão de vídeo lavfi, [1] áudio silencioso lavfi
// Mapeamento explícito -map 0:v -map 1:a para evitar ambiguidade
function buildFallbackArgs(videoInput: string, output: OutputConfig, graphic: GraphicConfig | null): string[] | null {
  const aBitrate = output.audioBitrate ?? 128
  // Sem logo no fallback (não há segundo input de imagem)
  const { filterArgs } = buildVideoFilter(output.videoResolution, graphic, false)

  const inputArgs = [
    '-hide_banner', '-loglevel', 'warning',
    '-f', 'lavfi', '-i', videoInput,
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
  ]

  const encodeArgs = [
    ...filterArgs,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
    ...(output.videoBitrate ? ['-b:v', `${output.videoBitrate}k`, '-maxrate', `${Math.round(output.videoBitrate * 1.5)}k`, '-bufsize', `${output.videoBitrate * 2}k`] : []),
    '-c:a', 'aac', '-ar', '44100', '-b:a', `${aBitrate}k`,
  ]

  switch (output.type) {
    case 'RTMP': {
      if (!output.url) return null
      const dest = output.streamKey ? `${output.url}/${output.streamKey}` : output.url
      return [...inputArgs, ...encodeArgs, '-f', 'flv', dest]
    }
    case 'SRT': {
      if (!output.url) return null
      return [...inputArgs, ...encodeArgs, '-f', 'mpegts', appendSrtPassphrase(output.url, output.streamKey)]
    }
    case 'UDP': {
      if (!output.url) return null
      return [...inputArgs, ...encodeArgs, '-f', 'mpegts', output.url]
    }
    case 'RTP': {
      if (!output.url) return null
      return [...inputArgs, ...encodeArgs, '-f', 'rtp', output.url]
    }
    case 'SDI': {
      const deckDevice = output.device ?? 'DeckLink'
      return [...inputArgs, ...encodeArgs, '-f', 'decklink', deckDevice]
    }
    case 'LOCAL_DEVICE': {
      if (!output.url) return null
      return [...inputArgs, ...encodeArgs, '-f', 'mpegts', appendSrtPassphrase(output.url, output.streamKey)]
    }
    default:
      return null
  }
}

// ─── Status ───────────────────────────────────────────────────────────────────

export function isStreaming(channelId: string): boolean {
  return (channelProcs.get(channelId)?.size ?? 0) > 0
}

export function getStreamingStatus(): Record<string, { outputId: string; type: string }[]> {
  const result: Record<string, { outputId: string; type: string }[]> = {}
  for (const [channelId, map] of channelProcs) {
    result[channelId] = Array.from(map.values()).map(({ outputId, type }) => ({ outputId, type }))
  }
  return result
}
