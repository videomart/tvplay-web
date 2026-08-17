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

const TSP_PATH = process.env.TSP_PATH ?? 'tsp'

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

/**
 * Envia SIGTERM e aguarda o processo sair; escala para SIGKILL após `escalateMs`
 * se ele não responder. Necessário porque FFmpeg bloqueado em recvfrom() numa UDP
 * sem dados pode ignorar SIGTERM indefinidamente, deixando um processo órfão
 * segurando a porta e quebrando o próximo bind (EADDRINUSE em loop).
 */
function killAndWait(p: ChildProcess | null, escalateMs = 2_000): Promise<void> {
  if (!p || p.exitCode !== null || p.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const t = setTimeout(() => { try { p.kill('SIGKILL') } catch {} }, escalateMs)
    p.once('exit', () => { clearTimeout(t); resolve() })
    try { p.kill('SIGTERM') } catch { clearTimeout(t); resolve() }
  })
}

// ─── Watchdog de memória ───────────────────────────────────────────────────────

const MEM_CHECK_INTERVAL = 30_000
// ~300MB — reinicia a sessão preventivamente antes que o OOM killer derrube
// processos aleatórios e cause swap thrashing (observado v1.0.66: o par
// relay+HLS de uma fonte SRT com SCTE-35 vazou até ~900MB em ~30min e foi
// morto pelo OOM, travando o host inteiro de 1-2GB de RAM).
const MEM_LIMIT_KB = 300_000

function readRssKb(pid: number | undefined | null): number {
  if (!pid) return 0
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8')
    const m = status.match(/VmRSS:\s+(\d+)\s+kB/)
    return m ? parseInt(m[1], 10) : 0
  } catch {
    return 0
  }
}

setInterval(() => {
  for (const [sourceId, session] of sessions) {
    if (session.stopped) continue
    const rss = readRssKb(session.proc?.pid) + readRssKb(session.relayProc?.pid)
    if (rss > MEM_LIMIT_KB) {
      console.warn(`[active-input/${sourceId}] RSS ${Math.round(rss / 1024)}MB acima do limite (${Math.round(MEM_LIMIT_KB / 1024)}MB) — reiniciando preventivamente`)
      session.proc?.kill('SIGTERM')
      session.relayProc?.kill('SIGTERM')
    }
  }
}, MEM_CHECK_INTERVAL)

// ─── Watchdog de corrupção H.264 ───────────────────────────────────────────────
// Esta sessão é um listener SRT de vida longa: o emissor remoto (ex.: outra
// instância do TVPlay) pode trocar de fonte internamente (ex.: arquivo local
// concat ↔ fallback) sem reiniciar a conexão SRT em si — o novo bitstream
// H.264 (SPS/PPS/frame_num diferentes) chega misturado no MESMO stream que
// este FFmpeg está copiando (`-c copy`) para o HLS local. Sem decodificar, não
// há como esse processo "saber" que a fonte trocou — só dá pra perceber pelos
// próprios erros de decoder que o FFmpeg já emite no stderr quando tenta
// remuxar dados incompatíveis. Confirmado em produção (2026-06-24): sem isso,
// a sessão fica indefinidamente corrompida até um restart manual completo.
const H264_CORRUPTION_PATTERN = /illegal (reordering|modification)_of_pic_nums_idc|cabac_init_idc \d+ overflow|reference count.*overflow|non-existing PPS \d+ referenced|Out of range weight is not implemented/
const CORRUPTION_WINDOW_MS    = 10_000   // janela deslizante de observação
const CORRUPTION_THRESHOLD    = 15       // ocorrências na janela para disparar restart

interface CorruptionTracker { count: number; windowStart: number }
const corruptionTrackers = new Map<string, CorruptionTracker>()

function noteCorruptionAndMaybeRestart(sourceId: string, session: Session, line: string): void {
  if (!H264_CORRUPTION_PATTERN.test(line)) return
  const now = Date.now()
  let tracker = corruptionTrackers.get(sourceId)
  if (!tracker || now - tracker.windowStart > CORRUPTION_WINDOW_MS) {
    tracker = { count: 0, windowStart: now }
    corruptionTrackers.set(sourceId, tracker)
  }
  tracker.count++
  if (tracker.count >= CORRUPTION_THRESHOLD) {
    corruptionTrackers.delete(sourceId)
    console.warn(`[active-input/${sourceId}] ${tracker.count} erros de decodificação H.264 em ${CORRUPTION_WINDOW_MS / 1000}s — fonte remota provavelmente trocou de bitstream sem reabrir a conexão; reiniciando sessão`)
    session.proc?.kill('SIGTERM')
    session.relayProc?.kill('SIGTERM')
  }
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

  // Remux com PIDs explícitos para corrigir streams SRT que emitem áudio com PID 0x0
  // (PID reservado/inválido no MPEG-TS, rejeitado pelo hls.js no browser).
  // -map explícito força o muxer a reatribuir PIDs normais mesmo com -c copy.
  return [
    ...base,
    '-map', '0:v:0', '-map', '0:a:0',
    '-c', 'copy',
    '-mpegts_pmt_start_pid', '0x1000',
    '-mpegts_start_pid', '0x0100',
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_list_size', '6',
    '-hls_flags', 'delete_segments+append_list',
    '-hls_segment_filename', segPat,
    hlsPath,
  ]
}

/**
 * Extrai host/porta/passphrase de uma URL srt://[host]:port?params para os
 * flags equivalentes do tsp (TSDuck), que não aceita query string na URL.
 * Não usa o parser `URL` nativo: `srt://:4100?...` (host vazio, comum em
 * listener local) é uma authority inválida e `new URL()` lança ERR_INVALID_URL.
 */
function parseSrtForTsp(srtUrl: string): { listenAddr: string; passphrase: string | null } {
  const m = srtUrl.match(/^srt:\/\/([^:/?]*):(\d+)/)
  const host = m?.[1] || ''
  const port = m?.[2] || '0'
  const qsIdx = srtUrl.indexOf('?')
  const qs = qsIdx >= 0 ? new URLSearchParams(srtUrl.slice(qsIdx)) : new URLSearchParams()
  const passphrase = qs.get('passphrase')
  return { listenAddr: host ? `${host}:${port}` : port, passphrase }
}

/**
 * Args do relay dedicado para entradas SRT com SCTE-35 habilitado.
 *
 * Usa `tsp` (TSDuck) como listener SRT em vez de FFmpeg -- o FFmpeg
 * (`-map 0 -copy_unknown -c copy`) declara o PID privado SCTE-35 no PMT de
 * saída (log "muxed as a private data stream and may not be recognized upon
 * reading") mas na prática não repassa os pacotes desse PID de forma
 * confiável: confirmado em produção (2026-08-17) com o TVPlay SE+ enviando
 * cues reais a cada 10s -- zero eventos chegavam ao watcher via o relay
 * FFmpeg, enquanto a MESMA conexão SRT apontada para o scte_monitor
 * (hls-scte35-server, que usa tsp puro como listener) detectava os cues
 * perfeitamente. tsp, sendo o processador nativo de MPEG-TS do TSDuck, não
 * faz esse tipo de remux/filtragem implícita de PIDs privados.
 *
 * Replica a topologia de dois destinos UDP (hls/scte) que o FFmpeg `tee`
 * fazia, usando o plugin `fork` do tsp para encadear um segundo processo tsp
 * que envia ao segundo destino -- tsp só suporta um `-O` por processo.
 */
function buildRelayArgs(srtUrl: string, ports: { hls: number; scte: number }): string[] {
  const { listenAddr, passphrase } = parseSrtForTsp(withSrtTimeout(srtUrl))
  const passphraseArgs = passphrase ? ['--passphrase', passphrase] : []
  const forkCmd = `${TSP_PATH} -I file - -O ip 127.0.0.1:${ports.scte}`
  return [
    '-I', 'srt', '--listener', listenAddr, ...passphraseArgs,
    '-P', 'fork', '-n', forkCmd,
    '-O', 'ip', `127.0.0.1:${ports.hls}`,
  ]
}

// ─── Ciclo de vida da sessão ──────────────────────────────────────────────────

async function launchSession(source: InputSourceMeta, session: Session): Promise<void> {
  if (session.stopped) return

  const url = await urlResolver(source).catch(() => null)
  if (!url) {
    console.warn(`[active-input/${source.id}] Não foi possível resolver URL — tentando novamente em ${session.retryDelay / 1000}s`)
    session.retryDelay = Math.min(session.retryDelay * 2, MAX_RETRY)
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
    relayProc = spawn(TSP_PATH, buildRelayArgs(url, ports), { stdio: ['ignore', 'pipe', 'pipe'] })
    relayProc.stdout?.on('data', () => {})
    relayProc.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim()
      if (msg) console.log(`[active-input/${source.id}/relay] ${msg}`)
    })
    mainInputUrl = `udp://127.0.0.1:${ports.hls}?overrun_nonfatal=1`
    scteWatcher.startUdpWatcher(source.id, ports.scte)
  }

  const args = buildArgs(mainInputUrl, session.outputDir)
  const proc = spawn(config.ffmpeg.path, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  session.proc = proc
  session.relayProc = relayProc
  session.ports = ports

  const startedAt = Date.now()

  proc.stdout?.on('data', () => {})  // drena stdout para não bloquear FFmpeg

  proc.stderr?.on('data', (d: Buffer) => {
    const msg = d.toString().trim()
    if (msg) console.log(`[active-input/${source.id}] ${msg}`)
    noteCorruptionAndMaybeRestart(source.id, session, msg)
  })

  // proc principal e relay (se houver) formam uma unidade — se um cair, reinicia os dois juntos
  let restarted = false
  const restart = (origin: string, code: number | string | null) => {
    if (session.stopped || restarted) return
    restarted = true
    // Backoff só reseta se rodou tempo suficiente para considerar "saudável";
    // falha imediata (ex.: EADDRINUSE) cresce o atraso em vez de martelar a cada 5s.
    const ranLongEnough = Date.now() - startedAt > 10_000
    session.retryDelay = ranLongEnough ? INITIAL_RETRY : Math.min(session.retryDelay * 2, MAX_RETRY)
    console.log(`[active-input/${source.id}] ${origin} saiu (code=${code ?? 'signal'}) — reiniciando em ${session.retryDelay / 1000}s`)
    if (ports) { releasePortPair(ports); scteWatcher.stopUdpWatcher(source.id) }
    // Aguarda os dois processos saírem de fato (com SIGKILL se necessário) antes de
    // relançar — evita que um FFmpeg preso em recvfrom() sem dados fique órfão
    // segurando a porta UDP/SRT e quebre o próximo bind em loop.
    Promise.all([killAndWait(relayProc), killAndWait(proc)]).then(() => {
      scheduleRetry(source, session)
    })
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

/**
 * Para e remove a sessão relay da fonte. Aguarda os processos saírem de fato
 * (com SIGKILL se necessário) para que as portas UDP/SRT fiquem livres antes de
 * retornar — essencial para `restartInput`, que reativa em seguida.
 */
export async function deactivateInput(sourceId: string): Promise<void> {
  const s = sessions.get(sourceId)
  if (!s) return
  s.stopped = true
  if (s.retryTimer) { clearTimeout(s.retryTimer); s.retryTimer = null }
  if (s.ports) releasePortPair(s.ports)
  sessions.delete(sourceId)
  corruptionTrackers.delete(sourceId)
  scteWatcher.stopWatcher(sourceId)
  scteWatcher.stopUdpWatcher(sourceId)
  await Promise.all([killAndWait(s.proc), killAndWait(s.relayProc)])
  try { fs.rmSync(s.outputDir, { recursive: true, force: true }) } catch {}
  console.log(`[active-input/${sourceId}] Sessão encerrada`)
}

/** Reinicia o relay de uma fonte (aplicando novas configurações como scteWatchEnabled). */
export async function restartInput(source: InputSourceMeta): Promise<void> {
  await deactivateInput(source.id)
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

/**
 * Aguarda até `timeoutMs` por `isReady(sourceId)` (poll a cada 500ms).
 * Usado por consumidores (ex.: cut-to-input) que preferem o HLS do relay ativo
 * em vez de conectar direto na fonte, mas o relay acabou de subir e ainda não
 * gerou o primeiro segmento.
 */
export async function waitUntilReady(sourceId: string, timeoutMs = 15_000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (isReady(sourceId)) return true
    await new Promise(r => setTimeout(r, 500))
  }
  return isReady(sourceId)
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

const SYNC_INTERVAL_MS = 5 * 60 * 1000  // 5 min

/**
 * Reconcilia as sessões em memória com o estado atual do banco — corrige
 * "sessões zumbi" (fonte deletada/recriada com novo id sem o servidor
 * reiniciar, ou qualquer outro caso em que `sessions` fica fora de sincronia).
 * Sem isso, uma sessão órfã pode segurar indefinidamente uma porta SRT
 * listener, impedindo a fonte (re)criada de ativar seu próprio relay.
 */
export async function syncActiveInputs(): Promise<void> {
  const { prisma } = await import('../lib/prisma')
  const sources = await prisma.inputSource.findMany({ where: { active: true } }).catch(() => [] as any[])
  const activeIds = new Set(sources.map((s: InputSourceMeta) => s.id))

  for (const sessionId of [...sessions.keys()]) {
    if (!activeIds.has(sessionId)) {
      console.log(`[active-inputs] Sessão órfã detectada (fonte ${sessionId} não existe mais/inativa) — encerrando`)
      await deactivateInput(sessionId)
    }
  }
  for (const source of sources) {
    if (!sessions.has(source.id)) {
      console.log(`[active-inputs] Fonte ativa sem sessão (${source.id}) — iniciando`)
      await activateInput(source).catch(() => {})
    }
  }
}

export function startActiveInputsSyncWatcher(): void {
  setInterval(() => { syncActiveInputs().catch(() => {}) }, SYNC_INTERVAL_MS)
}
