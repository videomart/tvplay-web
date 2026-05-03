import { spawn, ChildProcess } from 'child_process'
import { prisma } from '../lib/prisma'
import { config } from '../config'

interface StreamProcess {
  proc:     ChildProcess
  outputId: string
  type:     string
  name:     string
  stopped:  boolean   // true quando parado manualmente — cancela auto-reconexão
}

// Map: channelId → Map<outputId, StreamProcess>
const channelProcs = new Map<string, Map<string, StreamProcess>>()

// Adiciona passphrase na query string da URL SRT (evita duplicar ? quando já há params)
function appendSrtPassphrase(url: string, passphrase: string | null | undefined): string {
  if (!passphrase) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}passphrase=${encodeURIComponent(passphrase)}`
}

function buildArgs(inputUrl: string, cueIn: number, output: {
  type: string; url?: string | null; streamKey?: string | null; device?: string | null
}, isLive = false): string[] | null {
  // -re só para arquivos (controla velocidade de leitura); fontes ao vivo já são real-time
  const input: string[] = [
    '-hide_banner', '-loglevel', 'warning',
    ...(isLive ? [] : ['-re']),
    ...(cueIn > 0 && !isLive ? ['-ss', String(Math.floor(cueIn))] : []),
    '-i', inputUrl,
  ]
  // Para fontes ao vivo usamos -c copy (passthrough sem transcodar)
  const videoCodec = isLive
    ? ['-c', 'copy']
    : ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-c:a', 'aac', '-ar', '44100', '-b:a', '128k']

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
      const url = appendSrtPassphrase(output.url, output.streamKey)
      return [...input, ...videoCodec, '-f', 'mpegts', url]
    }
    case 'UDP': {
      if (!output.url) return null
      return [...input, ...videoCodec, '-f', 'mpegts', output.url]
    }
    case 'RTP': {
      if (!output.url) return null
      return [...input, ...videoCodec, '-f', 'rtp', output.url]
    }
    case 'SDI':
      return null
    default:
      return null
  }
}

function hlsUrlForMedia(mediaId: string): string {
  return `http://localhost:${config.port}/api/media/stream/${mediaId}/index.m3u8`
}

function spawnOutput(
  channelId: string,
  output: { id: string; name: string; type: string; url?: string | null; streamKey?: string | null; device?: string | null },
  hlsUrl: string,
  cueIn: number,
  isLive = false,
): StreamProcess | null {
  const args = buildArgs(hlsUrl, cueIn, output, isLive)
  if (!args) return null

  const proc = spawn(config.ffmpeg.path, args, { stdio: ['ignore', 'pipe', 'pipe'] })

  // sp é criado antes dos handlers para que o closure o capture por referência
  const sp: StreamProcess = { proc, outputId: output.id, type: output.type, name: output.name, stopped: false }

  proc.stdout?.on('data', () => {})
  proc.stderr?.on('data', (d: Buffer) => {
    const msg = d.toString().trim()
    if (msg) console.log(`[stream/${channelId}/${output.name}] ${msg}`)
  })

  proc.on('exit', (code) => {
    // Remove do map independente do motivo
    channelProcs.get(channelId)?.delete(output.id)

    const isError = code !== null && code !== 0 && code !== 255
    if (isError && !sp.stopped) {
      // Auto-reconexão: aguarda 5s e reinicia (útil para SRT listener aguardando peer)
      console.warn(`[stream/${channelId}/${output.name}] Saiu com código ${code} — reconectando em 5s...`)
      setTimeout(async () => {
        if (sp.stopped) return   // cancelado durante a espera
        const dbOutput = await prisma.streamOutput.findUnique({ where: { id: output.id } })
        if (!dbOutput?.active) return  // saída foi desativada

        const newSp = spawnOutput(channelId, dbOutput, hlsUrl, 0)
        if (!newSp) return
        if (!channelProcs.has(channelId)) channelProcs.set(channelId, new Map())
        channelProcs.get(channelId)!.set(output.id, newSp)
      }, 5000)
    }
  })

  console.log(`[stream/${channelId}] Iniciando ${output.type} → ${output.name}`)
  return sp
}

// ─── Controle por canal ───────────────────────────────────────────────────────

export async function startStreaming(channelId: string, mediaId: string | null, cueIn = 0) {
  await stopStreaming(channelId)
  if (!mediaId) return

  const outputs = await prisma.streamOutput.findMany({ where: { channelId, active: true } })
  if (!outputs.length) return

  const hlsUrl = hlsUrlForMedia(mediaId)
  const map = new Map<string, StreamProcess>()

  for (const output of outputs) {
    const sp = spawnOutput(channelId, output, hlsUrl, cueIn)
    if (sp) map.set(output.id, sp)
  }

  if (map.size) channelProcs.set(channelId, map)
}

export function stopStreaming(channelId: string) {
  const map = channelProcs.get(channelId)
  if (!map?.size) return Promise.resolve()
  for (const sp of map.values()) {
    sp.stopped = true   // cancela auto-reconexão pendente
    try { sp.proc.kill('SIGTERM') } catch {}
    console.log(`[stream/${channelId}] Parando ${sp.type}/${sp.name}`)
  }
  channelProcs.delete(channelId)
  return Promise.resolve()
}

export async function restartStreaming(channelId: string, mediaId: string | null, cueIn = 0) {
  await startStreaming(channelId, mediaId, cueIn)
}

// ─── Controle por output individual ──────────────────────────────────────────

export function stopOutput(channelId: string, outputId: string) {
  const map = channelProcs.get(channelId)
  const sp = map?.get(outputId)
  if (!sp) return
  sp.stopped = true   // cancela auto-reconexão pendente
  try { sp.proc.kill('SIGTERM') } catch {}
  map?.delete(outputId)
  console.log(`[stream/${channelId}] Output ${sp.name} parado manualmente`)
}

export async function startOutput(channelId: string, outputId: string, mediaId: string, cueIn = 0) {
  stopOutput(channelId, outputId)

  const output = await prisma.streamOutput.findUnique({ where: { id: outputId } })
  if (!output || !output.active) return

  const hlsUrl = hlsUrlForMedia(mediaId)
  const sp = spawnOutput(channelId, output, hlsUrl, cueIn)
  if (!sp) return

  if (!channelProcs.has(channelId)) channelProcs.set(channelId, new Map())
  channelProcs.get(channelId)!.set(outputId, sp)
}

export async function reconnectOutput(channelId: string, outputId: string, mediaId: string, cueIn = 0) {
  await startOutput(channelId, outputId, mediaId, cueIn)
}

// Passthrough ao vivo — inicia streaming a partir de uma URL de entrada (SRT, YouTube, IP, etc.)
export async function startStreamingFromUrl(channelId: string, inputUrl: string) {
  await stopStreaming(channelId)
  const outputs = await prisma.streamOutput.findMany({ where: { channelId, active: true } })
  if (!outputs.length) return

  const map = new Map<string, StreamProcess>()
  for (const output of outputs) {
    const sp = spawnOutput(channelId, output, inputUrl, 0, true)
    if (sp) map.set(output.id, sp)
  }
  if (map.size) channelProcs.set(channelId, map)
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
