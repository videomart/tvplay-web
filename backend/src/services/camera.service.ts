import { spawn, ChildProcess } from 'child_process'
import { prisma } from '../lib/prisma'
import { config } from '../config'
import { stopStreaming } from './stream.service'

interface CameraSession {
  proc: ChildProcess
  stopped: boolean
}

const sessions = new Map<string, CameraSession>()

// Callbacks registrados pelo playout — sem importação circular
let onCameraStartCb: ((channelId: string) => void) | null = null
let onCameraStopCb:  ((channelId: string) => void) | null = null

export function setOnCameraStart(cb: (channelId: string) => void) { onCameraStartCb = cb }
export function setOnCameraStop (cb: (channelId: string) => void) { onCameraStopCb  = cb }

function buildArgs(outputs: any[]): string[] | null {
  const outputArgs: string[] = []

  for (const o of outputs) {
    if (!o.active) continue

    const aBitrate = o.audioBitrate ?? 128
    const vBitrate = o.videoBitrate ?? 2500
    const res = o.videoResolution ?? null

    const encode = [
      ...(res ? ['-vf', `scale=${res}`] : []),
      '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
      '-g', '60',
      '-b:v', `${vBitrate}k`, '-maxrate', `${Math.round(vBitrate * 1.5)}k`, '-bufsize', `${vBitrate * 2}k`,
      '-c:a', 'aac', '-ar', '44100', '-b:a', `${aBitrate}k`,
    ]

    switch (o.type) {
      case 'RTMP': {
        if (!o.url) continue
        const dest = o.streamKey ? `${o.url}/${o.streamKey}` : o.url
        outputArgs.push(...encode, '-f', 'flv', dest)
        break
      }
      case 'SRT': {
        if (!o.url) continue
        const sep = o.url.includes('?') ? '&' : '?'
        const dest = o.streamKey ? `${o.url}${sep}passphrase=${encodeURIComponent(o.streamKey)}` : o.url
        outputArgs.push(...encode, '-f', 'mpegts', dest)
        break
      }
      case 'UDP': {
        if (!o.url) continue
        outputArgs.push(...encode, '-f', 'mpegts', o.url)
        break
      }
      case 'RTP': {
        if (!o.url) continue
        outputArgs.push(...encode, '-f', 'rtp', o.url)
        break
      }
    }
  }

  if (outputArgs.length === 0) return null

  return [
    '-hide_banner', '-loglevel', 'warning',
    // Reduz buffering inicial para menor latência
    '-analyzeduration', '0', '-probesize', '32768',
    '-f', 'webm', '-i', 'pipe:0',
    ...outputArgs,
  ]
}

export async function startCamera(channelId: string): Promise<ChildProcess> {
  // Para o timer do playout E o streaming antes de iniciar câmera.
  // Sem isso, o timer continua avançando clips e matando o FFmpeg da câmera em loop.
  onCameraStartCb?.(channelId)
  await stopStreaming(channelId)

  const outputs = await prisma.streamOutput.findMany({
    where: { channelId, active: true },
    orderBy: { name: 'asc' },
  })

  const args = buildArgs(outputs)
  if (!args) throw new Error('Nenhuma saída de streaming ativa configurada para este canal')

  const existing = sessions.get(channelId)
  if (existing) {
    existing.stopped = true
    try { existing.proc.kill('SIGTERM') } catch {}
  }

  const proc = spawn(config.ffmpeg.path, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const session: CameraSession = { proc, stopped: false }
  sessions.set(channelId, session)

  proc.stderr?.on('data', (d: Buffer) => {
    const msg = d.toString().trim()
    if (msg) console.log(`[camera/${channelId}] ${msg}`)
  })

  proc.on('exit', (code) => {
    const cur = sessions.get(channelId)
    if (cur?.proc === proc) sessions.delete(channelId)
    if (!session.stopped) {
      console.log(`[camera/${channelId}] FFmpeg encerrou (código ${code}) — retomando playout`)
      onCameraStopCb?.(channelId)
    }
  })

  console.log(`[camera/${channelId}] Iniciado — ${outputs.length} saída(s)`)
  return proc
}

export function stopCamera(channelId: string): void {
  const session = sessions.get(channelId)
  if (!session) return
  session.stopped = true
  try { session.proc.kill('SIGTERM') } catch {}
  sessions.delete(channelId)
  console.log(`[camera/${channelId}] Parado`)
  onCameraStopCb?.(channelId)
}

export function getCameraProc(channelId: string): ChildProcess | null {
  return sessions.get(channelId)?.proc ?? null
}

export function isCameraActive(channelId: string): boolean {
  return sessions.has(channelId)
}
