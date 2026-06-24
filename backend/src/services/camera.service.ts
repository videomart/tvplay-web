import { spawn, ChildProcess } from 'child_process'
import { config } from '../config'

interface CameraSession {
  proc: ChildProcess
  port: number
  stopped: boolean
  restartTimer: ReturnType<typeof setTimeout> | null
}

const sessions   = new Map<string, CameraSession>()
const portMap    = new Map<string, number>()
let   nextPort   = 13050   // portas reservadas para SRT de câmera

const RESTART_DELAY_MS = 2_000

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

// Câmera → SRT local (listener) — o playout lê daqui ao fazer CUT
function buildArgs(port: number): string[] {
  return [
    '-hide_banner', '-loglevel', 'warning',
    '-analyzeduration', '0', '-probesize', '32768',
    '-f', 'webm', '-i', 'pipe:0',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
    '-g', '60', '-keyint_min', '60',
    '-b:v', '2500k', '-maxrate', '3000k', '-bufsize', '2500k',
    '-c:a', 'aac', '-ar', '44100', '-b:a', '128k',
    '-f', 'mpegts', `srt://0.0.0.0:${port}?mode=listener&pkt_size=1316`,
  ]
}

// Sobe o processo FFmpeg da sessão e registra os listeners de stderr/exit.
// O caller (startCamera ou o auto-restart) já garante que `session` está
// presente em `sessions` antes de chamar esta função.
function spawnCameraProcess(channelId: string, session: CameraSession): void {
  const proc = spawn(config.ffmpeg.path, buildArgs(session.port), {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  session.proc = proc

  proc.stderr?.on('data', (d: Buffer) => {
    const msg = d.toString().trim()
    if (msg) console.log(`[camera/${channelId}] ${msg}`)
  })

  proc.on('exit', (code) => {
    const cur = sessions.get(channelId)
    if (cur?.proc !== proc) return  // já substituído por outra via (stop/restart manual)
    if (session.stopped) { sessions.delete(channelId); return }
    // Auto-restart: o WebSocket do browser continua mandando frames para
    // getCameraProc(channelId) — como a sessão permanece no map, a próxima
    // mensagem já escreve no processo novo automaticamente, sem o usuário
    // precisar reabrir o modal de câmera. Confirmado em produção (2026-06-24):
    // o FFmpeg da câmera pode morrer (I/O error) quando o relay de saída
    // reinicia por troca de modo de conteúdo — sem isso, a sessão ficava
    // morta indefinidamente e todo CUT subsequente falhava com "câmera não
    // está ativa".
    console.log(`[camera/${channelId}] FFmpeg encerrou (código ${code}) — reiniciando em ${RESTART_DELAY_MS / 1000}s`)
    session.restartTimer = setTimeout(() => {
      session.restartTimer = null
      if (session.stopped) return
      spawnCameraProcess(channelId, session)
    }, RESTART_DELAY_MS)
  })
}

export async function startCamera(channelId: string): Promise<void> {
  // Para sessão existente antes de iniciar nova
  const existing = sessions.get(channelId)
  if (existing) {
    existing.stopped = true
    if (existing.restartTimer) clearTimeout(existing.restartTimer)
    try { existing.proc.kill('SIGTERM') } catch {}
    sessions.delete(channelId)
  }

  const port = getOrAllocPort(channelId)
  const session: CameraSession = { proc: null as any, port, stopped: false, restartTimer: null }
  sessions.set(channelId, session)
  spawnCameraProcess(channelId, session)

  console.log(`[camera/${channelId}] Câmera SRT listener em :${port}`)
}

export function stopCamera(channelId: string): void {
  const session = sessions.get(channelId)
  if (!session) return
  session.stopped = true
  if (session.restartTimer) clearTimeout(session.restartTimer)
  try { session.proc.kill('SIGTERM') } catch {}
  sessions.delete(channelId)
  console.log(`[camera/${channelId}] Parado`)
}
