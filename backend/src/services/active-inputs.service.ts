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
  relayProc:  ChildProcess | null
  ports:      { hls: number; scte: number } | null
  outputDir:  string
  stopped:    boolean
  retryTimer: ReturnType<typeof setTimeout> | null
  retryDelay: number
}

const sessions = new Map<string, Session>()        // sourceId → session
const BASE_DIR        = '/tmp/tvplay-active-inputs'
const INITIAL_RETRY   = 5_000
const MAX_RETRY       = 300_000   // 5 min — evita martelar YouTube durante rate-limit de 1h

// ─── Portas UDP locais para o relay SCTE-35 (loopback, par hls/scte por fonte) ─

const UDP_PORT_BASE = 20000
const UDP_PORT_MAX  = 20998
const usedPorts = new Set<number>()

function allocatePortPair(): { hls: number; scte: number } {
  for (let p = UDP_PORT_BASE; p <= UDP_PORT_MAX; p += 2) {
    if (!usedPorts.has(p) && !usedPorts.has(p + 1)) {
      usedPorts.add(p); usedPorts.add(p + 1)
      return { hls: p, scte: p + 1 }
    }
  }
  throw new Error('[active-inputs] Sem portas UDP locais disponíveis para relay SCTE-35')
}

function releasePortPair(ports: { hls: number; scte: number } | null): void {
  if (!ports) return
  usedPorts.delete(ports.hls)
  usedPorts.delete(ports.scte)
}

// ─── FFmpeg ───────────────────────────────────────────────────────────────────

/** Garante parâmetro timeout para SRT listener (aguarda sender reconectar). */
function withSrtTimeout(url: string): string {
  const lo = url.toLowerCase()
  if (lo.startsWith('srt://') && !lo.includes('timeout=')) {
    return url + (lo.includes('?') ? '&' : '?') + 'timeout=30000000'
  }
  return url
}

function buildArgs(inputUrl: string, outputDir: string): string[] {
  const hlsPath = path.join(outputDir, 'index.m3u8')
  const segPat  = path.join(outputDir, 'seg%03d.ts')
  const lo = inputUrl.toLowerCase()
  const isRtmp = lo.startsWith('rtmp://')
  const isRtsp = lo.startsWith('rtsp://')
  const isHls  = lo.includes('.m3u8') || lo.includes('/api/media/') || lo.includes('/api/input-sources/')

  const url = withSrtTimeout(inputUrl)

  const base = [
    '-hide_banner', '-loglevel', 'warning',
    // Descarta pacotes corrompidos em vez de abortar com "I/O error" — entradas SRT/RTMP
    // sofrem perda/jitter ocasional e o demuxer não deve derrubar o processo por isso.
    '-err_detect', 'ignore_err',
    '-fflags', '+discardcorrupt+genpts',
    ...(isRtmp ? ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5'] : []),
    ...(isRtsp ? ['-rtsp_transport', 'tcp', '-stimeout', '15000000'] : []),
    ...(isHls  ? ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5', '-timeout', '30000000'] : []),
    '-i', url,
  ]

  // Streams broadcast (SRT/RTMP/RTSP) já vêm em H.264/AAC — copy direto.
  return [
    ...base,
    '-c', 'copy',
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_list_size', '6',
    '-hls_flags', 'delete_segments+append_list',
    '-hls_segment_filename', segPat,
    hlsPath,
  ]
}

/**
 * Args do relay dedicado para entradas SRT com SCTE-35 habilitado.
 *
 * `-map 0 -copy_unknown` ao vivo a partir de SRT com bin_data (PID 0x0500) é
 * estável em saída ÚNICA e contínua (sem `-t`), mas crasha quando combinado
 * num mesmo processo com um segundo muxer HLS (dois-outputs, v1.0.53/55).
 * Por isso este processo faz SOMENTE a leitura do SRT + replicação via `tee`
 * para dois destinos UDP locais (loopback): um para o FFmpeg do active-input
 * (HLS, mapeamento padrão — descarta bin_data) e outro para o scte35-watcher
 * (Node, lê bin_data via dgram).
 */
function buildRelayArgs(srtUrl: string, ports: { hls: number; scte: number }): string[] {
  return [
    '-hide_banner', '-loglevel', 'warning',
    '-err_detect', 'ignore_err',
    '-fflags', '+discardcorrupt+genpts',
    '-i', withSrtTimeout(srtUrl),
    '-map', '0', '-copy_unknown',
    '-c', 'copy',
    '-f', 'tee',
    `[f=mpegts]udp://127.0.0.1:${ports.hls}|[f=mpegts]udp://127.0.0.1:${ports.scte}`,
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

  const useRelay = url.toLowerCase().startsWith('srt://') && !!source.scteWatchEnabled

  let mainInputUrl = url
  let relayProc: ChildProcess | null = null
  let ports: { hls: number; scte: number } | null = null

  if (useRelay) {
    ports = allocatePortPair()
    relayProc = spawn(config.ffmpeg.path, buildRelayArgs(url, ports), { stdio: ['ignore', 'pipe', 'pipe'] })
    relayProc.stdout?.on('data', () => {})
    relayProc.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim()
      if (msg) console.log(`[active-input/${source.id}/relay] ${msg}`)
    })
    mainInputUrl = `udp://127.0.0.1:${ports.hls}?overrun_nonfatal=1&fifo_size=10000000`
    scteWatcher.startUdpWatcher(source.id, ports.scte)
  }

  const args = buildArgs(mainInputUrl, session.outputDir)
  const proc = spawn(config.ffmpeg.path, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  session.proc = proc
  session.relayProc = relayProc
  session.ports = ports
  session.retryDelay = INITIAL_RETRY   // reset backoff após sucesso na resolução

  proc.stdout?.on('data', () => {})  // drena stdout para não bloquear FFmpeg

  proc.stderr?.on('data', (d: Buffer) => {
    const msg = d.toString().trim()
    if (msg) console.log(`[active-input/${source.id}] ${msg}`)
  })

  // proc principal e relay (se houver) formam uma unidade — se um cair, reinicia os dois juntos
  let restarted = false
  const restart = (origin: string, code: number | string | null) => {
    if (session.stopped || restarted) return
    restarted = true
    console.log(`[active-input/${source.id}] ${origin} saiu (code=${code ?? 'signal'}) — reiniciando em ${session.retryDelay / 1000}s`)
    if (relayProc && !relayProc.killed) { try { relayProc.kill('SIGTERM') } catch {} }
    if (!proc.killed) { try { proc.kill('SIGTERM') } catch {} }
    if (ports) { releasePortPair(ports); scteWatcher.stopUdpWatcher(source.id) }
    scheduleRetry(source, session)
  }

  proc.on('exit', (code) => restart('processo principal', code))
  if (relayProc) relayProc.on('exit', (code) => restart('relay SRT', code))

  console.log(`[active-input/${source.id}] Relay iniciado → ${session.outputDir}${useRelay ? ' (com relay SCTE-35 via UDP local)' : ''}`)
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
  const session: Session = { proc: null, relayProc: null, ports: null, outputDir, stopped: false, retryTimer: null, retryDelay: INITIAL_RETRY }
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
  try { s.relayProc?.kill('SIGTERM') } catch {}
  if (s.ports) releasePortPair(s.ports)
  try { fs.rmSync(s.outputDir, { recursive: true, force: true }) } catch {}
  sessions.delete(sourceId)
  scteWatcher.stopWatcher(sourceId)
  scteWatcher.stopUdpWatcher(sourceId)
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
