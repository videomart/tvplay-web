import { spawn, ChildProcess } from 'child_process'
import { config } from '../config'

interface CameraSession {
  proc: ChildProcess
  port: number
  stopped: boolean
}

const sessions   = new Map<string, CameraSession>()
const portMap    = new Map<string, number>()
let   nextPort   = 13050   // portas reservadas para SRT de câmera

function getOrAllocPort(channelId: string): number {
  if (!portMap.has(channelId)) portMap.set(channelId, nextPort++)
  return portMap.get(channelId)!
}

// URL para o playout usar ao fazer CUT para a câmera
export function getCameraInputUrl(channelId: string): string | null {
  if (!sessions.has(channelId)) return null
  const port = portMap.get(channelId)
  return port ? `srt://127.0.0.1:${port}?mode=caller` : null
}

export function isCameraActive(channelId: string): boolean {
  return sessions.has(channelId)
}

export function getCameraProc(channelId: string): ChildProcess | null {
  return sessions.get(channelId)?.proc ?? null
}

export async function startCamera(channelId: string): Promise<void> {
  // Para sessão existente antes de iniciar nova
  const existing = sessions.get(channelId)
  if (existing) {
    existing.stopped = true
    try { existing.proc.kill('SIGTERM') } catch {}
    sessions.delete(channelId)
  }

  const port = getOrAllocPort(channelId)

  // Câmera → SRT local (listener) — o playout lê daqui ao fazer CUT
  // analyzeduration=0/probesize=32768 (valores anteriores) eram baixos demais para
  // detectar corretamente os parâmetros do WebM de entrada — o FFmpeg avisava
  // "not enough frames to estimate rate" e a decisão de encode ficava ruim,
  // produzindo vídeo visivelmente borrado mesmo com bitrate/resolução de captura
  // adequados no browser (confirmado em produção, 2026-06-24). 1M de probesize
  // ainda é baixo (poucos ms de buffer), suficiente para reduzir o atraso de
  // start sem cair no problema de detecção insuficiente.
  const args = [
    '-hide_banner', '-loglevel', 'warning',
    '-analyzeduration', '1000000', '-probesize', '1000000',
    '-f', 'webm', '-i', 'pipe:0',
    // scale força a saída em 1280x720 independente do que vier do browser —
    // sem isso, qualquer captura em resolução menor (ex.: webcam de baixa
    // qualidade, ou o navegador escolhendo um valor abaixo do "ideal" pedido)
    // saía sem upscale, e variações na fonte afetavam a qualidade percebida
    // no ar de forma inconsistente.
    '-vf', 'scale=1280:720',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
    '-g', '60', '-keyint_min', '60',
    // Acompanha o videoBitsPerSecond do MediaRecorder (useCameraStream.ts) — sem
    // isso o reencode aqui limitava a qualidade de novo mesmo após corrigir o
    // bitrate de captura no browser.
    '-b:v', '4000k', '-maxrate', '4800k', '-bufsize', '4000k',
    '-c:a', 'aac', '-ar', '44100', '-b:a', '128k',
    '-f', 'mpegts', `srt://0.0.0.0:${port}?mode=listener&pkt_size=1316`,
  ]

  const proc = spawn(config.ffmpeg.path, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const session: CameraSession = { proc, port, stopped: false }
  sessions.set(channelId, session)

  proc.stderr?.on('data', (d: Buffer) => {
    const msg = d.toString().trim()
    if (msg) console.log(`[camera/${channelId}] ${msg}`)
  })

  proc.on('exit', (code) => {
    const cur = sessions.get(channelId)
    if (cur?.proc === proc) sessions.delete(channelId)
    console.log(`[camera/${channelId}] FFmpeg encerrou (código ${code})`)
  })

  console.log(`[camera/${channelId}] Câmera SRT listener em :${port}`)
}

export function stopCamera(channelId: string): void {
  const session = sessions.get(channelId)
  if (!session) return
  session.stopped = true
  try { session.proc.kill('SIGTERM') } catch {}
  sessions.delete(channelId)
  console.log(`[camera/${channelId}] Parado`)
}
