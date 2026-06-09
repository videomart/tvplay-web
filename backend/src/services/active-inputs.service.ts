/**
 * Relay persistente por entrada ativa (InputSource com active=true).
 *
 * Para cada entrada ativa mantém um processo FFmpeg que lê da fonte e gera HLS
 * em /tmp/tvplay-active-inputs/{sourceId}/. Quando o playout precisa do fallback,
 * usa esse HLS já pronto — sem reconexão nem atraso de yt-dlp.
 *
 * Auto-reinicia com backoff exponencial quando a fonte cai ou a URL expira.
 */

import { spawn, ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import { config } from '../config'
import * as scteWatcher from './scte35-watcher.service'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type InputSourceMeta = {
  id:              string
  type:            string
  url:             string | null
  device:          string | null
  scteWatchEnabled?: boolean
}

// Resolver de URL injetado de fora para evitar dependência circular com playout.service
type UrlResolver = (src: InputSourceMeta) => Promise<string | null>
let urlResolver: UrlResolver = async () => null
export function setUrlResolver(fn: UrlResolver) { urlResolver = fn }

// ─── Estado ───────────────────────────────────────────────────────────────────

interface Session {
  proc:       ChildProcess | null
  outputDir:  string
  stopped:    boolean
  retryTimer: ReturnType<typeof setTimeout> | null
  retryDelay: number
}

const sessions = new Map<string, Session>()        // sourceId → session
const BASE_DIR        = '/tmp/tvplay-active-inputs'
const INITIAL_RETRY   = 5_000
const MAX_RETRY       = 60_000

// ─── FFmpeg ───────────────────────────────────────────────────────────────────

function buildArgs(inputUrl: string, outputDir: string, scteWatch: boolean): string[] {
  const hlsPath = path.join(outputDir, 'index.m3u8')
  const segPat  = path.join(outputDir, 'seg%03d.ts')
  const lo = inputUrl.toLowerCase()
  const isSrt  = lo.startsWith('srt://')
  const isRtmp = lo.startsWith('rtmp://')
  const isRtsp = lo.startsWith('rtsp://')
  const isHls  = lo.includes('.m3u8') || lo.includes('/api/media/') || lo.includes('/api/input-sources/')

  // Garante parâmetro timeout para SRT listener (aguarda sender reconectar)
  let url = inputUrl
  if (isSrt && !lo.includes('timeout=')) url += (lo.includes('?') ? '&' : '?') + 'timeout=30000000'

  return [
    '-hide_banner', '-loglevel', 'warning',
    ...(isRtmp ? ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5'] : []),
    ...(isRtsp ? ['-rtsp_transport', 'tcp', '-stimeout', '15000000'] : []),
    ...(isHls  ? ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5', '-timeout', '30000000'] : []),
    '-i', url,
    // Quando SCTE-35 watch está habilitado: usa -copy_unknown -map 0 para preservar o
    // PID 0x0500 (SCTE-35) nos segmentos HLS gerados — necessário para detecção downstream.
    ...(scteWatch ? ['-copy_unknown', '-map', '0'] : []),
    // Usa copy em todos os casos — streams broadcast (SRT/RTMP/RTSP) já vêm em H.264/AAC.
    // Re-encodar com ultrafast causava dupla compressão e degradação severa de qualidade.
    // Se o codec da fonte for incompatível com MPEG-TS, o processo sai com erro e reinicia.
    '-c', 'copy',
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_list_size', '6',
    '-hls_flags', 'delete_segments+append_list',
    '-hls_segment_filename', segPat,
    hlsPath,
  ]
}

// ─── Ciclo de vida da sessão ──────────────────────────────────────────────────

async function launchSession(source: InputSourceMeta, session: Session): Promise<void> {
  if (session.stopped) return

  const url = await urlResolver(source).catch(() => null)
  if (!url) {
    console.warn(`[active-input/${source.id}] Não foi possível resolver URL — tentando novamente em ${session.retryDelay / 1000}s`)
    scheduleRetry(source, session)
    return
  }

  fs.mkdirSync(session.outputDir, { recursive: true })
  const args = buildArgs(url, session.outputDir, source.scteWatchEnabled ?? false)
  const proc = spawn(config.ffmpeg.path, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  session.proc = proc
  session.retryDelay = INITIAL_RETRY   // reset backoff após sucesso na resolução

  // Inicia watcher SCTE-35 após o diretório HLS estar pronto
  if (source.scteWatchEnabled) {
    scteWatcher.startWatcher(source.id, session.outputDir)
  }

  proc.stderr?.on('data', (d: Buffer) => {
    const msg = d.toString().trim()
    if (msg) console.log(`[active-input/${source.id}] ${msg}`)
  })

  proc.on('exit', (code) => {
    if (!session.stopped) {
      console.log(`[active-input/${source.id}] Saiu (code=${code ?? 'signal'}) — reiniciando em ${session.retryDelay / 1000}s`)
      scheduleRetry(source, session)
    }
  })

  console.log(`[active-input/${source.id}] Relay iniciado → ${session.outputDir}`)
}

function scheduleRetry(source: InputSourceMeta, session: Session): void {
  if (session.stopped) return
  session.retryTimer = setTimeout(() => {
    session.retryTimer = null
    launchSession(source, session)
  }, session.retryDelay)
  session.retryDelay = Math.min(session.retryDelay * 2, MAX_RETRY)
}

// ─── API pública ──────────────────────────────────────────────────────────────

/** Inicia (ou no-op se já ativa) a sessão relay para a fonte informada. */
export async function activateInput(source: InputSourceMeta): Promise<void> {
  if (sessions.has(source.id)) return
  const outputDir = path.join(BASE_DIR, source.id)
  const session: Session = { proc: null, outputDir, stopped: false, retryTimer: null, retryDelay: INITIAL_RETRY }
  sessions.set(source.id, session)
  await launchSession(source, session)
}

/** Para e remove a sessão relay da fonte. */
export function deactivateInput(sourceId: string): void {
  const s = sessions.get(sourceId)
  if (!s) return
  s.stopped = true
  if (s.retryTimer) { clearTimeout(s.retryTimer); s.retryTimer = null }
  try { s.proc?.kill('SIGTERM') } catch {}
  try { fs.rmSync(s.outputDir, { recursive: true, force: true }) } catch {}
  sessions.delete(sourceId)
  scteWatcher.stopWatcher(sourceId)
  console.log(`[active-input/${sourceId}] Sessão encerrada`)
}

/** Reinicia o relay de uma fonte (aplicando novas configurações como scteWatchEnabled). */
export async function restartInput(source: InputSourceMeta): Promise<void> {
  deactivateInput(source.id)
  await activateInput(source)
}

/** Retorna o diretório HLS se a sessão existe (independente de estar pronta). */
export function getHlsDir(sourceId: string): string | null {
  const s = sessions.get(sourceId)
  return s ? s.outputDir : null
}

/** true se o HLS já tem pelo menos um segmento (entrada pronta para uso). */
export function isReady(sourceId: string): boolean {
  const s = sessions.get(sourceId)
  if (!s) return false
  return fs.existsSync(path.join(s.outputDir, 'index.m3u8'))
}

export function isActive(sourceId: string): boolean {
  return sessions.has(sourceId)
}

/** Inicializa sessões para todas as InputSources ativas no banco. */
export async function initActiveInputs(): Promise<void> {
  const { prisma } = await import('../lib/prisma')
  const sources = await prisma.inputSource.findMany({ where: { active: true } }).catch(() => [] as any[])
  await Promise.all(sources.map((s: InputSourceMeta) => activateInput(s).catch(() => {})))
  console.log(`[active-inputs] ${sources.length} entradas ativas inicializadas`)
}
