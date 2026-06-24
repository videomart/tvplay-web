import { spawn, ChildProcess } from 'child_process'
import { config } from '../config'

interface CameraSession {
  proc: ChildProcess
  port: number
  stopped: boolean
  gotStdinData: boolean      // true assim que o WebSocket escreveu o 1º frame
  sawListenerIOError: boolean // true se o stderr mostrou o padrão de listener perdendo o caller
  restartTimer: ReturnType<typeof setTimeout> | null
}

const sessions   = new Map<string, CameraSession>()
const portMap    = new Map<string, number>()
let   nextPort   = 13050   // portas reservadas para SRT de câmera

const RESTART_DELAY_MS = 1_000

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

// Marca que o WebSocket já entregou dados ao stdin desta sessão — usado para
// distinguir um crash "a frio" (sem dados ainda, não vale reiniciar — era o
// loop destrutivo da v1.1.7) de um crash em pleno funcionamento (vale
// reiniciar automaticamente).
export function markStdinData(channelId: string): void {
  const s = sessions.get(channelId)
  if (s) s.gotStdinData = true
}

function buildArgs(port: number): string[] {
  return [
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
}

// Padrão de stderr quando o listener SRT perde o caller anterior (ex.: um
// novo CUT para a câmera reconecta, ou o relay de saída reinicia e abre uma
// nova conexão SRT) — confirmado em produção (2026-06-24): o processo recebe
// "Error submitting a packet to the muxer: I/O error" e sai com código 251.
// Diferente do crash a frio (EBML header parsing failed, sem dados ainda),
// este padrão ocorre em pleno funcionamento e é seguro reiniciar.
const LISTENER_IO_ERROR_PATTERN = /Error submitting a packet to the muxer: I\/O error/

function spawnCameraProcess(channelId: string, session: CameraSession): void {
  const proc = spawn(config.ffmpeg.path, buildArgs(session.port), {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  session.proc = proc
  session.sawListenerIOError = false

  proc.stderr?.on('data', (d: Buffer) => {
    const msg = d.toString().trim()
    if (msg) console.log(`[camera/${channelId}] ${msg}`)
    if (LISTENER_IO_ERROR_PATTERN.test(msg)) session.sawListenerIOError = true
  })

  proc.on('exit', (code) => {
    const cur = sessions.get(channelId)
    if (cur?.proc !== proc) return  // já substituído por outra via (stop/restart manual)
    if (session.stopped) { sessions.delete(channelId); return }

    const shouldRestart = session.gotStdinData && session.sawListenerIOError
    if (!shouldRestart) {
      sessions.delete(channelId)
      console.log(`[camera/${channelId}] FFmpeg encerrou (código ${code}) — sessão finalizada (reabra o modal para reiniciar)`)
      return
    }

    // Sessão estava funcionando e perdeu o caller SRT — reinicia automaticamente,
    // mantendo a entrada no map para o WebSocket continuar alimentando o
    // processo novo via getCameraProc() sem qualquer ação do usuário.
    console.log(`[camera/${channelId}] FFmpeg encerrou (código ${code}) após perder o caller SRT — reiniciando em ${RESTART_DELAY_MS / 1000}s`)
    session.gotStdinData = false
    session.restartTimer = setTimeout(() => {
      session.restartTimer = null
      if (session.stopped) return
      spawnCameraProcess(channelId, session)
    }, RESTART_DELAY_MS)
  })

  console.log(`[camera/${channelId}] Câmera SRT listener em :${session.port}`)
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
  const session: CameraSession = {
    proc: null as any, port, stopped: false,
    gotStdinData: false, sawListenerIOError: false, restartTimer: null,
  }
  sessions.set(channelId, session)
  spawnCameraProcess(channelId, session)
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
