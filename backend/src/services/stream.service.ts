import { spawn, ChildProcess } from 'child_process'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { prisma } from '../lib/prisma'
import { config } from '../config'
import { tickerFilePath } from './ticker.service'
import { computeBarLayout, computeElementXY, type BarLayout, type LayoutElement } from './graphicLayout'

// Hook registrado pelo camera.service para parar câmera quando qualquer
// operação de streaming iniciar — evita dois FFmpeg escrevendo na mesma saída.
let _stopCameraHook: ((channelId: string) => void) | null = null
export function registerStopCameraHook(fn: (channelId: string) => void) {
  _stopCameraHook = fn
}

// Elemento individual de um template gráfico
export type GraphicElementConfig = {
  id?:          string           // presente quando vem do DB; usado pelo ticker RSS
  type:         'LOGO' | 'CLOCK' | 'TEXT' | 'TICKER' | 'LOWER_THIRD'
  position:     'TL' | 'TC' | 'TR' | 'ML' | 'MC' | 'MR' | 'BL' | 'BC' | 'BR' | 'BAR_TOP' | 'BAR_BOTTOM'
  imageUrl?:    string | null
  text?:        string | null
  subtitle?:    string | null
  fontColor:    string
  bgColor?:     string | null
  fontSize:     number
  opacity:      number
  bold:         boolean
  width?:       number | null
  height?:      number | null
  padding:      number
  marginX?:     number | null  // px — distância da borda esquerda/direita do quadro
  marginY?:     number | null  // px — distância da borda superior/inferior (ou deslocamento da barra)
  anchorRef?:   'FRAME' | 'BAR' | null  // TL/TC/TR/BL/BC/BR: referência vertical
  order?:       number         // ordem de empilhamento dentro da barra
  tickerSpeed?: number | null  // pixels/segundo (default 5)
  tickerLoop?:  boolean | null // false = exibe uma vez e para (default true)
  rssUrl?:      string | null  // feed RSS — usa textfile quando preenchido
}

export type GraphicConfig = {
  // Sistema legado (Graphic simples)
  logoUrl?: string | null
  logoPosition?: string | null
  showClock?: boolean
  lowerText?: string | null
  // Sistema novo: template com múltiplos elementos (sobrescreve legado quando presente)
  templateElements?: GraphicElementConfig[]
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

// Map: channelId → Map<outputId, StreamProcess> (content processes)
const channelProcs = new Map<string, Map<string, StreamProcess>>()

// ─── Relay architecture ───────────────────────────────────────────────────────
// Content processes encode → UDP loopback → relay processes forward to RTMP/SRT.
// Relay processes never restart during clip switches, keeping the external connection alive.

interface RelayProcess {
  proc:      ChildProcess
  port:      number
  stopped:   boolean
  startedAt: number
}

// YouTube (e outras plataformas RTMP) encerram sessões de ingest contínuas após ~12h.
// Reciclamos a conexão proativamente um pouco antes para evitar corte abrupto em transmissões 24/7.
const RTMP_RELAY_MAX_AGE_MS = 11 * 60 * 60 * 1000

const relayProcs  = new Map<string, Map<string, RelayProcess>>()
const relayPortMap  = new Map<string, number>()
let   nextRelayPort  = 13100

// O relay opera em `-c copy`: nunca decodifica, só copia bytes do H.264/AAC que
// chega no socket UDP. Por isso TODOS os caminhos de conteúdo (concat, clip URL
// reencodado, entrada cortada via CUT, fallback BARS/BLACK) usam o MESMO
// codec/GOP/CFR (libx264, profile high, -g 60 -keyint_min 60 -sc_threshold 0,
// 29.97fps CFR — ver buildArgs/buildConcatArgs/buildFallbackArgs). Isso garante
// que o relay nunca precisa reabrir a conexão RTMP/SRT externa ao trocar de
// fonte — o decoder do lado receptor trata um novo SPS/PPS inline no meio do
// -c copy como uma troca de cena normal (mesmo padrão já usado entre clipes
// dentro do concat). Antes de unificar esses parâmetros, bitstreams incompatíveis
// entre os modos forçavam restart do relay a cada troca, causando ~20s de
// interrupção do stream externo, ou exigindo refresh manual do lado do receptor
// (2026-06-29). Se algum caminho novo de conteúdo for adicionado, mantenha os
// mesmos parâmetros de GOP/profile/framerate ou ele vai reintroduzir esse bug.

function getOrAllocRelayPort(outputId: string): number {
  if (!relayPortMap.has(outputId)) relayPortMap.set(outputId, nextRelayPort++)
  return relayPortMap.get(outputId)!
}

// Only RTMP, SRT, and LOCAL_DEVICE outputs have persistent connections worth relaying.
function isRelayCapable(type: string): boolean {
  return ['RTMP', 'SRT', 'LOCAL_DEVICE'].includes(type)
}

function buildRelayArgs(output: OutputConfig, port: number): string[] | null {
  if (!isRelayCapable(output.type)) return null
  // -re: lê o buffer UDP na taxa nativa do stream (evita burst ao vivo para o YouTube/RTMP).
  // Restrito a RTMP — em relays SRT/LOCAL_DEVICE de longa duração, pequena diferença de
  // clock entre encoder e relay (~rate 1.05x observado) acumula drift até estourar o fifo
  // e derrubar pacotes, gerando discontinuidades de timestamp propagadas a quem recebe o stream.
  // fifo_size NÃO especificado: é em pacotes de 188 bytes (default ffmpeg = 28672 ≈ 5.1MB),
  // não em bytes. O valor anterior (1000000 = ~188MB) pretendia "reduzir" o buffer mas na
  // verdade alocava 37x o default — mesma confusão de unidade do bug corrigido em
  // active-inputs.service.ts. Sem o parâmetro, usa o default do ffmpeg.
  // timeout=15s: ao trocar para um clip URL/YouTube, o processo concat encerra e
  // o yt-dlp leva alguns segundos para resolver a nova URL antes do próximo processo
  // retomar a escrita no UDP. Um timeout curto (3s, valor anterior) fazia o relay
  // RTMP sair e reabrir uma NOVA conexão com o YouTube nessa janela — o YouTube
  // interpretava isso como fim da transmissão a cada troca de clipe. 15s cobre essa
  // janela de resolução sem deixar o relay "pendurado" por muito tempo em caso de crash real.
  // buffer_size: aumenta o SO_RCVBUF do socket (padrão do kernel ~208KB) para o
  // máximo permitido (net.core.rmem_max) — reduz descarte de datagramas em picos
  // fifo_size=86016 (3x o default 28672, ~15.3MB — pacotes de 188 bytes, NÃO bytes):
  // confirmado em produção (2026-06-21) que mesmo com CFR forçado na origem (-r
  // 30000/1001 -fps_mode cfr) o relay final ainda apresenta "Resumed reading ...
  // rate 1.050 ... lag" crescente e "Circular buffer overrun" — o -re necessário
  // para RTMP/YouTube não absorve variações de timing reais entre o encode local
  // e o socket UDP, independente da fonte upstream (reproduzido com M1 E M3 como
  // origem). Mais margem de fifo reduz a chance de overrun antes do offset saltar.
  const udpUrl    = `udp://0.0.0.0:${port}?overrun_nonfatal=1&timeout=15000000&buffer_size=4194304&fifo_size=86016`
  // -readrate_catchup: quando o lag acumulado cresce (fonte upstream ~5% mais rápida
  // que o pacing nominal do -re — "rate 1.050" observado em produção), o FFmpeg
  // troca temporariamente para 1.5x de velocidade até zerar o atraso, em vez de
  // deixá-lo crescer indefinidamente (visto chegar a 30s+ em poucos minutos antes
  // desta correção, culminando em "Circular buffer overrun" e descarte de pacotes
  // em massa). Confirmado disponível no binário static-ffmpeg em uso (2026-06-24).
  const readRate  = output.type === 'RTMP' ? ['-re', '-readrate_catchup', '1.5'] : []
  // -err_detect ignore_err + -fflags +discardcorrupt: o probe do demuxer mpegts roda SEMPRE
  // (mesmo com -map explícito na saída) e tenta determinar codec parameters de TODOS os
  // streams do input — se qualquer um falhar ("could not find codec parameters"), o processo
  // inteiro aborta, mesmo que esse stream nunca fosse usado no output. Essas flags já evitam
  // esse abort no relay de entrada (active-inputs.service); replicado aqui (2026-06-22).
  // -use_wallclock_as_timestamps (testado em v1.1.15, REVERTIDO): a ideia era dar ao
  // relay um clock contínuo independente do PTS embutido em cada content process, mas em
  // produção (2026-06-29) o wallclock — baseado em quando os pacotes chegam no socket
  // UDP, sujeito a jitter de rede/scheduling — diverge do DTS original do stream em
  // -c copy (sem decodificar para reconciliar), gerando "timestamp discontinuity" e
  // offsets negativos crescentes continuamente, degradando o datarate até a transmissão
  // cair. NÃO reintroduzir sem decodificar o stream para ter um clock real (o que tornaria
  // o relay um re-encode, perdendo a vantagem de baixa latência do -c copy).
  const inputArgs = ['-hide_banner', '-loglevel', 'warning', '-stats', '-err_detect', 'ignore_err', '-fflags', '+discardcorrupt', ...readRate, '-f', 'mpegts', '-i', udpUrl]
  const codec     = ['-c', 'copy']
  // Sem -copy_unknown/-map 0: mapeamento padrão do ffmpeg (vídeo+áudio conhecidos).
  // Injeção de SCTE-35 no transport stream via FFmpeg foi removida (2026-06-22) —
  // confirmado por teste real que o FFmpeg descarta o PID 0x0500/stream_type=0x86
  // no probe do demuxer, então a injeção nunca chegava de fato a sistemas terceiros;
  // o código que tentava (-copy_unknown -map 0 + ts-proxy) ainda causava crash loop
  // em cadeias multi-hop ("could not find codec parameters"). Sinalização de
  // BREAK entre instâncias do TVPlay continua via bypass HTTP (signalRemoteScte35).
  const copyAll: string[] = []
  switch (output.type) {
    case 'RTMP': {
      if (!output.url) return null
      const dest = output.streamKey ? `${output.url}/${output.streamKey}` : output.url
      // UDP input does not support -reconnect flags — reconnect is handled at app level (exit handler)
      // RTMP/FLV não suporta PIDs privados — sem copyAll (FLV container rejeitaria streams desconhecidos)
      // -map 0:v:0 -map 0:a:0 explícito: sem mapeamento, o FFmpeg ainda faz probe de TODOS os
      // streams do input antes de decidir o que copiar — se qualquer stream desconhecido falhar
      // o probe ("could not find codec parameters"), o processo morre mesmo sem usá-lo no
      // output. Mapeamento explícito por índice evita esse probe completo (2026-06-22).
      const mapExplicit = ['-map', '0:v:0', '-map', '0:a:0']
      return [...inputArgs, ...codec, ...mapExplicit, '-f', 'flv', dest]
    }
    case 'SRT': {
      if (!output.url) return null
      return [...inputArgs, ...copyAll, ...codec, '-f', 'mpegts', appendSrtPassphrase(output.url, output.streamKey)]
    }
    case 'LOCAL_DEVICE': {
      if (!output.url) return null
      return [...inputArgs, ...copyAll, ...codec, '-f', 'mpegts', appendSrtPassphrase(output.url, output.streamKey)]
    }
    default:
      return null
  }
}

function spawnRelay(channelId: string, output: OutputConfig, port: number): RelayProcess | null {
  const args = buildRelayArgs(output, port)
  if (!args) return null

  const entry: RelayProcess = { proc: null as any, port, stopped: false, startedAt: Date.now() }
  const proc = spawn(config.ffmpeg.path, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, TZ: clockTz() },
  })
  entry.proc = proc

  proc.stdout?.on('data', () => {})
  proc.stderr?.on('data', (d: Buffer) => {
    const raw = d.toString()
    if (raw.includes('bitrate=')) {
      parseStats(channelId, output.id, raw)
    } else {
      const msg = raw.replace(/\r/g, '\n').trim()
      if (msg) console.log(`[relay/${channelId}/${output.name}] ${msg}`)
    }
  })

  proc.on('exit', (code) => {
    const channel = relayProcs.get(channelId)
    const registered = channel?.get(output.id)
    if (registered?.proc === proc) channel?.delete(output.id)
    const isError = code !== null && code !== 0 && code !== 255
    if (isError && !entry.stopped) {
      console.warn(`[relay/${channelId}/${output.name}] Saiu com código ${code} — reconectando relay em 2s...`)
      setTimeout(async () => {
        if (entry.stopped) return
        // If the channel relay map was deleted (stopRelays called), don't resurrect
        if (!relayProcs.has(channelId)) return
        const current = relayProcs.get(channelId)?.get(output.id)
        if (current && current.proc !== proc) return
        const dbOutput = await prisma.streamOutput.findUnique({ where: { id: output.id }, include: { graphic: { include: { template: { include: { elements: { where: { active: true }, orderBy: { order: 'asc' } } } } } } } })
        if (!dbOutput?.active) return
        const newEntry = spawnRelay(channelId, dbOutput, port)
        if (!newEntry) return
        relayProcs.get(channelId)!.set(output.id, newEntry)
      }, 2000)
    }
  })

  console.log(`[relay/${channelId}] Relay ${output.type} → ${output.name} (UDP :${port})`)
  console.log(`[relay/${channelId}] args: ${args.join(' ')}`)
  return entry
}

async function ensureRelays(channelId: string, outputs: OutputConfig[]): Promise<void> {
  if (!relayProcs.has(channelId)) relayProcs.set(channelId, new Map())
  const relayMap = relayProcs.get(channelId)!

  for (const output of outputs) {
    if (!isRelayCapable(output.type) || !output.url) continue

    const relayPort = getOrAllocRelayPort(output.id)  // sempre aloca (idempotente)
    const existing = relayMap.get(output.id)
    const relayAlive = !!existing && !existing.stopped && existing.proc.exitCode === null

    if (!relayAlive) {
      const relay = spawnRelay(channelId, output, relayPort)
      if (relay) relayMap.set(output.id, relay)
    }
  }
}

/**
 * Envia SIGTERM e aguarda o processo sair; escala para SIGKILL após `escalateMs`
 * se ele não responder. Necessário porque FFmpeg bloqueado em recvfrom() numa UDP
 * sem dados pode ignorar SIGTERM indefinidamente, deixando um processo órfão
 * segurando a porta e quebrando o próximo bind ("Address in use" em loop) — mesmo
 * padrão já usado em active-inputs.service.ts.
 */
function killAndWait(p: ChildProcess | null, escalateMs = 2_000): Promise<void> {
  if (!p || p.exitCode !== null || p.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const t = setTimeout(() => { try { p.kill('SIGKILL') } catch {} }, escalateMs)
    p.once('exit', () => { clearTimeout(t); resolve() })
    try { p.kill('SIGTERM') } catch { clearTimeout(t); resolve() }
  })
}

// Async + aguarda os processos saírem de fato antes de retornar — sem isso, um
// ensureRelays() chamado logo depois (ex.: stop()/cutToFallbackType seguido de
// reativação do fallback) pode tentar abrir a mesma porta UDP antes do processo
// antigo liberar o socket, causando "Address in use" e o relay ficar preso até
// o próximo retry de 2s ou um toggle manual (2026-06-22).
async function stopRelays(channelId: string): Promise<void> {
  const map = relayProcs.get(channelId)
  if (!map?.size) return
  const procs: ChildProcess[] = []
  for (const entry of map.values()) {
    entry.stopped = true
    procs.push(entry.proc)
  }
  relayProcs.delete(channelId)
  await Promise.all(procs.map((p) => killAndWait(p)))
  console.log(`[relay/${channelId}] Todos os relays parados`)
}

// Recicla a conexão RTMP de um relay específico: mata o processo atual e sobe um novo
// na mesma porta UDP. O conteúdo (proxy/UDP) continua fluindo sem interrupção — apenas
// a sessão externa (RTMP → YouTube) é renovada, evitando o corte forçado por limite de duração.
async function recycleRelay(channelId: string, outputId: string): Promise<void> {
  const relayMap = relayProcs.get(channelId)
  const entry = relayMap?.get(outputId)
  if (!entry || entry.stopped) return

  const dbOutput = await prisma.streamOutput.findUnique({
    where: { id: outputId },
    include: { graphic: { include: { template: { include: { elements: { where: { active: true }, orderBy: { order: 'asc' } } } } } } },
  })
  if (!dbOutput?.active || dbOutput.type !== 'RTMP') return

  const ageHours = (Date.now() - entry.startedAt) / 3_600_000
  console.log(`[relay/${channelId}/${dbOutput.name}] Reciclando conexão RTMP proativamente (${ageHours.toFixed(1)}h ativa) — evita corte de sessão por limite de duração (YouTube ~12h)`)

  const oldProc = entry.proc
  const port = entry.port
  entry.stopped = true
  try { oldProc.kill('SIGTERM') } catch {}

  setTimeout(() => {
    if (!relayProcs.has(channelId)) return
    const current = relayProcs.get(channelId)?.get(outputId)
    if (current && current.proc !== oldProc) return // já foi substituído por outra via
    const newEntry = spawnRelay(channelId, dbOutput, port)
    if (newEntry) relayProcs.get(channelId)!.set(outputId, newEntry)
  }, 1500)
}

let relayCycleTimer: NodeJS.Timeout | null = null

// Varre periodicamente todos os relays RTMP ativos e recicla os que estão
// próximos do limite de sessão contínua das plataformas (ex.: YouTube ~12h).
// Essencial para transmissões 24/7 — sem isso a plataforma encerraria a sessão
// abruptamente e a reconexão automática poderia falhar (stream key/sessão inválida).
export function startRelayCycleWatcher(): void {
  if (relayCycleTimer) return
  relayCycleTimer = setInterval(() => {
    for (const [channelId, relayMap] of relayProcs) {
      for (const [outputId, entry] of relayMap) {
        if (entry.stopped) continue
        if (Date.now() - entry.startedAt >= RTMP_RELAY_MAX_AGE_MS) {
          recycleRelay(channelId, outputId).catch(() => {})
        }
      }
    }
  }, 5 * 60 * 1000)
  console.log(`[relay] Watcher de reciclagem RTMP ativo (limite: ${RTMP_RELAY_MAX_AGE_MS / 3_600_000}h)`)
}

// ─────────────────────────────────────────────────────────────────────────────

// Callback global chamado quando FFmpeg sai com erro sem ter sido parado manualmente.
// Permite que o playout avance para o próximo clipe sem depender de importação circular.
let onUnexpectedExitCb: ((channelId: string) => void) | null = null

export function setStreamFailureCallback(cb: (channelId: string) => void) {
  onUnexpectedExitCb = cb
}

// Offset do relógio (horas em relação ao UTC). Atualizado pelas configurações do sistema.
let clockOffsetHours = 0

export function setClockOffsetHours(offset: number) {
  clockOffsetHours = Math.round(offset)
}

// Converte offset inteiro para string TZ POSIX inline.
// Formato "UTC+N" funciona sem tzdata instalado (musl/glibc interpretam direto).
// Sinal INVERTIDO em relação à notação UTC: UTC+3 = 3h a oeste = UTC-3 (Brasil).
function clockTz(): string {
  if (clockOffsetHours === 0) return 'UTC'
  // clockOffsetHours=-3 (UTC-3, Brasil) → posixOffset=3 → "UTC+3" ✓
  const posixOffset = -clockOffsetHours
  return `UTC${posixOffset >= 0 ? '+' : ''}${posixOffset}`
}

interface OutputStats {
  bitrate: number   // kbits/s
  fps: number
  speed: number     // 1.00 = tempo real
  updatedAt: number
}
const outputStats = new Map<string, Map<string, OutputStats>>()

function parseStats(channelId: string, outputId: string, data: string) {
  const br = data.match(/bitrate=\s*(\d+(?:\.\d+)?)kbits\/s/)
  if (!br) return
  const fps   = data.match(/fps=\s*(\d+(?:\.\d+)?)/)
  const speed = data.match(/speed=\s*(\d+(?:\.\d+)?)x/)
  if (!outputStats.has(channelId)) outputStats.set(channelId, new Map())
  outputStats.get(channelId)!.set(outputId, {
    bitrate:   parseFloat(br[1]),
    fps:       fps   ? parseFloat(fps[1])   : 0,
    speed:     speed ? parseFloat(speed[1]) : 1,
    updatedAt: Date.now(),
  })
}

export function getOutputStats(): Record<string, Record<string, OutputStats>> {
  const result: Record<string, Record<string, OutputStats>> = {}
  for (const [ch, map] of outputStats) {
    result[ch] = {}
    for (const [id, s] of map) result[ch][id] = s
  }
  return result
}

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

// Caminho da fonte para drawtext — necessário para FFmpeg estático (mwader/static-ffmpeg)
// Alpine Linux com ttf-freefont instala em /usr/share/fonts/freefont/
const DRAWTEXT_FONT = 'fontfile=/usr/share/fonts/freefont/FreeSans.otf:'

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
  const clockFilter = `drawtext=${DRAWTEXT_FONT}text='%{localtime\\:%T}':fontsize=48:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=8:x=w-tw-20:y=20`
  const lowerFilter = hasText
    ? `drawtext=${DRAWTEXT_FONT}text='${escapeText(graphic!.lowerText!.trim())}':fontsize=32:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8:x=(w-tw)/2:y=h-th-30`
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

// ─── Template filter builder ──────────────────────────────────────────────────
// Constrói filter_complex a partir dos elementos de um GraphicTemplate
// Retorna { extraInputs, filterArgs, mapArgs }
export function buildTemplateFilter(
  elements: GraphicElementConfig[],
  videoResolution: string | null | undefined,
): { extraInputs: string[]; filterArgs: string[]; mapArgs: string[] } {
  const escTxt = (t: string) => t.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:')
  const active = elements.filter(el => el !== null && el !== undefined)
  if (active.length === 0 && !videoResolution) return { extraInputs: [], filterArgs: [], mapArgs: [] }

  const logos = active.filter(el => el.type === 'LOGO' && el.imageUrl)
  const texts  = active.filter(el => el.type !== 'LOGO')

  // Passo 1 — calcula altura/empilhamento das barras (evita sobreposição entre seus membros)
  const topBar    = computeBarLayout(active.filter(el => el.position === 'BAR_TOP') as LayoutElement[])
  const bottomBar = computeBarLayout(active.filter(el => el.position === 'BAR_BOTTOM') as LayoutElement[])
  const barCtx = { topBar, bottomBar }

  const segs: string[] = []
  const extraInputs: string[] = []
  let cur = '[0:v]'
  let n   = 0
  const nxt = () => `[vt${n++}]`

  // Scale
  if (videoResolution) { const o = nxt(); segs.push(`${cur}scale=${videoResolution}${o}`); cur = o }

  // Logos (overlay, um por input extra)
  for (const logo of logos) {
    const inputIdx = 1 + extraInputs.length
    extraInputs.push(logo.imageUrl!)
    const wFilter = logo.width  ? `:w=${logo.width}`  : ''
    const hFilter = logo.height ? `:h=${logo.height}` : ''
    const scaleTag = logo.width || logo.height ? `[logo${inputIdx}scaled]` : `[${inputIdx}:v]`
    let logoSrc = `[${inputIdx}:v]`
    if (logo.width || logo.height) {
      const sOut = `[logo${inputIdx}s]`
      segs.push(`[${inputIdx}:v]scale${wFilter}${hFilter}${sOut}`)
      logoSrc = sOut
    }
    const pos = computeElementXY(logo as LayoutElement, barCtx, 'overlay', logo.width, logo.height)
    const xy  = `${pos.x}:${pos.y}`
    const o   = nxt()
    segs.push(`${cur}${logoSrc}overlay=${xy}${o}`)
    cur = o
  }

  // Elementos de texto
  for (const el of texts) {
    const fc   = el.fontColor ?? '#FFFFFF'
    const bg   = el.bgColor ? `box=1:boxcolor=${el.bgColor}:boxborderw=${el.padding ?? 10}:` : ''
    const bold = el.bold ? ':style=Bold' : ''
    const fs   = el.fontSize ?? 32
    const font = `${DRAWTEXT_FONT}`
    const pos  = computeElementXY(el as LayoutElement, barCtx, 'drawtext')
    const xy   = `${pos.x}:${pos.y}`

    const makeDrawtext = (txt: string, yOff = 0) => {
      const xyAdj = yOff !== 0 ? xy.replace(/y=([^:]+)/, `y=$1+${yOff}`) : xy
      return `drawtext=${font}text='${escTxt(txt)}':fontsize=${fs}:fontcolor=${fc}:${bg}${xyAdj}${bold}`
    }

    const o = nxt()
    let pushed = false
    switch (el.type) {
      case 'CLOCK':
        segs.push(`${cur}drawtext=${font}text='%{localtime\\:%T}':fontsize=${fs}:fontcolor=${fc}:${bg}${xy}${bold}${o}`)
        pushed = true
        break
      case 'TEXT':
        if (el.text) { segs.push(`${cur}${makeDrawtext(el.text)}${o}`); pushed = true }
        break
      case 'TICKER': {
        // t = tempo em segundos (framerate-independent); speed em px/seg
        const speed    = Math.max(1, Math.min(400, el.tickerSpeed ?? 5))
        const loop     = el.tickerLoop !== false   // default true
        const tickerY  = pos.y.replace(/^y=/, '')
        // loop=true: mod (cicla); loop=false: max(-tw, ...) (para ao sair)
        const scrollX  = loop
          ? `x=w-mod(t*${speed}\\,w+tw):y=${tickerY}`
          : `x=max(-tw\\,w-t*${speed}):y=${tickerY}`
        if (el.rssUrl) {
          // Feed RSS: usa textfile com reload periódico (a cada 300 frames ≈ 12s)
          const file = tickerFilePath(el.id ?? 'default').replace(/'/g, "\\'")
          segs.push(`${cur}drawtext=${font}textfile='${file}':reload=300:fontsize=${fs}:fontcolor=${fc}:${bg}${scrollX}${bold}${o}`)
          pushed = true
        } else if (el.text) {
          segs.push(`${cur}drawtext=${font}text='${escTxt(el.text)}':fontsize=${fs}:fontcolor=${fc}:${bg}${scrollX}${bold}${o}`)
          pushed = true
        }
        break
      }
      case 'LOWER_THIRD': {
        const title = el.text?.trim()
        const sub   = el.subtitle?.trim()
        if (!title && !sub) break
        if (title) {
          const out2 = sub ? nxt() : o
          segs.push(`${cur}${makeDrawtext(title, 0)}${out2}`)
          if (sub) { segs.push(`${out2}${makeDrawtext(sub, fs + 8)}${o}`) }
          else { /* o já é o output */ }
          pushed = true
        } else if (sub) {
          segs.push(`${cur}${makeDrawtext(sub, 0)}${o}`)
          pushed = true
        }
        break
      }
    }
    if (pushed) cur = o
  }

  if (segs.length === 0) return { extraInputs: [], filterArgs: [], mapArgs: [] }

  return {
    extraInputs,
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
  relayPort: number | null = null,
): string[] | null {
  // Resolve URL do logo: relativa → http://localhost:PORT/... (acessível dentro do container)
  const logoUrl = (!isLive && effectiveGraphic?.logoUrl) ? resolveLogoUrl(effectiveGraphic.logoUrl) : null

  // DASH: yt-dlp retornou video+audio separados (separados por \n)
  const dashUrls = inputUrl.includes('\n') ? inputUrl.split('\n').filter(u => u.startsWith('http')) : null
  const primaryUrl = dashUrls ? dashUrls[0] : inputUrl
  const audioUrl   = dashUrls ? dashUrls[1] : null

  const lowerInputUrl = primaryUrl.toLowerCase()
  const isRtmpInput = lowerInputUrl.startsWith('rtmp://')
  const isRtspInput = lowerInputUrl.startsWith('rtsp://')
  const isHttpInput = lowerInputUrl.startsWith('http://') || lowerInputUrl.startsWith('https://')
  const isSrtInput  = lowerInputUrl.startsWith('srt://')
  // HLS ao vivo (YouTube live, manifests): não aplicar -re (o HLS já controla a taxa)
  const isHlsLive   = isHttpInput && (lowerInputUrl.includes('.m3u8') || lowerInputUrl.includes('/api/manifest/hls'))
  // URL remota resolvida via yt-dlp (CDN do YouTube/Twitch, ex.: googlevideo.com/videoplayback) —
  // NÃO usar -re aqui: a CDN aplica throttling agressivo em leituras pausadas/intermitentes,
  // o que trava o FFmpeg antes do primeiro frame (saída fica só em PAT/PMT, ~24 Kbps).
  // Tratamos como fonte ao vivo: lê o mais rápido possível e deixa o pacing por conta do relay.
  const isRemoteCdnInput = isHttpInput && !lowerInputUrl.includes('/api/media/') && !isHlsLive

  // Se output.graphic (raw Prisma) tem templateId mas não templateElements, converte inline
  let resolvedGraphic = effectiveGraphic as any
  if (resolvedGraphic && resolvedGraphic.templateId && !resolvedGraphic.templateElements) {
    const tmplElems = resolvedGraphic.template?.elements
    if (tmplElems?.length) {
      const values: Record<string, any> = resolvedGraphic.elementValues ?? {}
      const merged = tmplElems
        .map((el: any) => ({ ...el, ...(values[el.id] ?? {}) }))
        .filter((el: any) => el.active !== false)
      resolvedGraphic = { templateElements: merged }
    }
  }

  // Decide qual sistema gráfico usar: template (novo) ou legado (Graphic simples)
  const useTemplate = !isLive && !!(resolvedGraphic?.templateElements?.length)
  console.log(`[stream/${output.name}] gfx: isLive=${isLive} useTemplate=${useTemplate} tmplElems=${resolvedGraphic?.templateElements?.length ?? 0}`)
  const templateResult = useTemplate
    ? buildTemplateFilter(resolvedGraphic.templateElements, output.videoResolution)
    : null

  // Inputs extras: logos do template OU logo legado
  const legacyLogoUrl = (!isLive && resolvedGraphic?.logoUrl) ? resolveLogoUrl(resolvedGraphic.logoUrl) : null
  const extraLogoInputs: string[] = templateResult
    ? templateResult.extraInputs.flatMap((url: string) => ['-stream_loop', '-1', '-i', resolveLogoUrl(url)])
    : (legacyLogoUrl ? ['-stream_loop', '-1', '-i', legacyLogoUrl] : [])

  const input: string[] = [
    '-hide_banner', '-loglevel', 'warning', '-stats',
    ...(isLive && isRtmpInput ? ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5'] : []),
    ...(isLive && isRtspInput ? ['-rtsp_transport', 'tcp', '-stimeout', '10000000'] : []),
    ...(isLive && isHttpInput ? ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '10', '-timeout', '30000000'] : []),
    // HLS ao vivo (YouTube) ou CDN remota (googlevideo etc.): reconnect para sustentar a leitura
    ...(isHlsLive || isRemoteCdnInput ? ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5', '-timeout', '30000000'] : []),
    ...(isSrtInput ? ['-timeout', '10000000'] : []),
    // -re só para VOD local (FILE clips); HLS ao vivo e CDN remota controlam sua própria taxa
    // (CDN do YouTube faz throttling agressivo em leituras pausadas pelo -re — ver isRemoteCdnInput acima)
    ...(!isLive && !isHlsLive && !isRemoteCdnInput ? ['-re'] : []),
    ...(cueIn > 0 && !isLive ? ['-ss', String(Math.floor(cueIn))] : []),
    '-i', primaryUrl,
    // DASH: segundo input de áudio separado
    ...(audioUrl ? ['-i', audioUrl] : []),
    ...extraLogoInputs,
  ]

  const aBitrate = output.audioBitrate ?? 128
  const vBitrate = output.videoBitrate || 4000
  const videoBitrateArgs = !isLive
    ? ['-b:v', `${vBitrate}k`, '-maxrate', `${Math.round(vBitrate * 1.2)}k`, '-bufsize', `${vBitrate}k`]
    : []

  // CFR fixo em 29.97fps (NTSC, padrão da maioria do conteúdo broadcast BR):
  // evita drift entre o framerate nominal da fonte e o -re do relay final, que
  // acumula lag e causa timestamp discontinuity no destino RTMP/SRT.
  const cfrArgs = ['-r', '30000/1001', '-fps_mode', 'cfr']

  let videoCodec: string[]
  if (isLive) {
    videoCodec = ['-c', 'copy', '-map', '0:v:0', '-map', '0:a:0']
  } else if (useTemplate && templateResult) {
    // Sistema novo: template com múltiplos elementos
    videoCodec = [
      ...templateResult.filterArgs,
      '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high',
      ...videoBitrateArgs,
      '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', ...cfrArgs,
      '-c:a', 'aac', '-ar', '44100', '-b:a', `${aBitrate}k`,
      ...templateResult.mapArgs,
    ]
  } else {
    // Sistema legado: Graphic simples
    const { filterArgs, mapArgs } = buildVideoFilter(output.videoResolution, resolvedGraphic, !!legacyLogoUrl)
    // DASH (video+audio separados): mapa explícito 0:v + 1:a
    const dashMap = audioUrl ? ['-map', '0:v:0', '-map', '1:a:0'] : mapArgs
    videoCodec = [
      ...filterArgs,
      '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high',
      ...videoBitrateArgs,
      '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', ...cfrArgs,
      '-c:a', 'aac', '-ar', '44100', '-b:a', `${aBitrate}k`,
      ...dashMap,
    ]
  }

  // Relay mode: redirect encoded stream to UDP loopback instead of external destination.
  // The relay process picks it up and forwards to RTMP/SRT without restarting on clip change.
  if (relayPort !== null && isRelayCapable(output.type)) {
    return [...input, ...videoCodec, '-f', 'mpegts', `udp://127.0.0.1:${relayPort}?pkt_size=1316`]
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
  relayPort: number | null = null,
): StreamProcess | null {
  // Prioridade: gráfico do conteúdo (clip/playlist) > gráfico da saída
  const effectiveGraphic = contentGraphic ?? output.graphic ?? null
  const args = buildArgs(hlsUrl, cueIn, output, isLive, effectiveGraphic, relayPort)
  if (!args) return null

  const proc = spawn(config.ffmpeg.path, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, TZ: clockTz() },
  })
  const sp: StreamProcess = {
    proc, outputId: output.id, type: output.type, name: output.name,
    stopped: false, contentGraphic,
  }

  proc.stdout?.on('data', () => {})
  proc.stderr?.on('data', (d: Buffer) => {
    const raw = d.toString()
    // In relay mode, relay process tracks stats (external output); skip stats from content process
    if (!relayPort && raw.includes('bitrate=')) {
      parseStats(channelId, output.id, raw)
    } else if (!raw.includes('bitrate=')) {
      const msg = raw.replace(/\r/g, '\n').trim()
      if (msg) console.log(`[stream/${channelId}/${output.name}] ${msg}`)
    }
  })

  proc.on('exit', (code) => {
    // Só remove do mapa se este processo ainda for o registrado — evita apagar novo processo ao trocar clipe
    const registered = channelProcs.get(channelId)?.get(output.id)
    if (registered?.proc === proc) {
      channelProcs.get(channelId)?.delete(output.id)
    }
    const isError = code !== null && code !== 0 && code !== 255
    if (isError && !sp.stopped) {
      console.warn(`[stream/${channelId}/${output.name}] Saiu com código ${code} — notificando playout e reconectando em 5s...`)
      // Notifica o playout service para avançar ao próximo clipe (sem importação circular)
      onUnexpectedExitCb?.(channelId)
      setTimeout(async () => {
        if (sp.stopped) return
        // Aborta reconnect se um processo mais novo já foi registrado pelo playout
        const current = channelProcs.get(channelId)?.get(output.id)
        if (current && current.proc !== proc) return
        const dbOutput = await prisma.streamOutput.findUnique({
          where: { id: output.id },
          include: { graphic: { include: { template: { include: { elements: { where: { active: true }, orderBy: { order: 'asc' } } } } } } },
        })
        if (!dbOutput?.active) return
        const newSp = spawnOutput(channelId, dbOutput, hlsUrl, 0, false, sp.contentGraphic, relayPort)
        if (!newSp) return
        if (!channelProcs.has(channelId)) channelProcs.set(channelId, new Map())
        channelProcs.get(channelId)!.set(output.id, newSp)
      }, 5000)
    }
  })

  const gfxInfo = effectiveGraphic
    ? ` | GFX: logo=${effectiveGraphic.logoUrl ?? 'none'} clock=${effectiveGraphic.showClock} text="${effectiveGraphic.lowerText ?? ''}"`
    : ' | GFX: nenhum'
  const relayInfo = relayPort ? ` → UDP:${relayPort} (relay)` : ''
  console.log(`[stream/${channelId}] Iniciando ${output.type} → ${output.name}${relayInfo}${gfxInfo}`)
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
  if (!mediaId) return

  const outputs = await prisma.streamOutput.findMany({
    where: { channelId, active: true },
    include: { graphic: { include: { template: { include: { elements: { where: { active: true }, orderBy: { order: 'asc' } } } } } } },
  })
  if (!outputs.length) return

  // Ensure relay processes are running before restarting content
  await ensureRelays(channelId, outputs)
  await stopStreaming(channelId)

  const hlsUrl = hlsUrlForMedia(mediaId)
  const map = new Map<string, StreamProcess>()
  for (const output of outputs) {
    const port = isRelayCapable(output.type) ? relayPortMap.get(output.id) ?? null : null
    const sp = spawnOutput(channelId, output, hlsUrl, cueIn, false, contentGraphic, port)
    if (sp) map.set(output.id, sp)
  }
  if (map.size) channelProcs.set(channelId, map)
}

// Para só o content process — preserva o relay (conexão RTMP/SRT externa) vivo.
// Também para a câmera ativa, já que ela escreve no mesmo channelProcs/output.
export function stopStreaming(channelId: string) {
  _stopCameraHook?.(channelId)
  const map = channelProcs.get(channelId)
  if (!map?.size) return Promise.resolve()
  for (const sp of map.values()) {
    sp.stopped = true
    try { sp.proc.kill('SIGTERM') } catch {}
    console.log(`[stream/${channelId}] Parando ${sp.type}/${sp.name}`)
  }
  channelProcs.delete(channelId)
  outputStats.delete(channelId)
  return Promise.resolve()
}

// Stops both content processes and relay processes — use apenas quando NENHUM
// startStreamingFrom* for chamado em seguida (ex.: ao desativar uma saída, ou ao
// desligar o canal por completo sem fallback). Se um start* for chamado depois,
// prefira stopStreaming(): o relay já é garantido por ensureRelays() dentro de cada
// start*, e matá-lo aqui só para recriá-lo no próximo start* deixa o socket UDP do
// relay momentaneamente sem um content process escrevendo nele, gerando corrupção
// de bitstream H.264 ("non-existing PPS referenced", DTS fora de ordem) detectada
// pelo player de terceiro que consome o RTMP de saída (confirmado em produção,
// 2026-06-29, ao reproduzir play()/stop() chamando isso antes de reiniciar).
// Async e aguarda stopRelays liberar as portas UDP antes de retornar — ver killAndWait.
export async function stopAllStreaming(channelId: string): Promise<void> {
  stopStreaming(channelId)
  await stopRelays(channelId)
}

/**
 * Sinaliza um evento SCTE-35 (splice_insert) via bypass HTTP direto ao receptor
 * remoto configurado (signalRemoteScte35) — usado entre instâncias do próprio
 * TVPlay (ex.: M3→M1) para acionar avanço automático de BREAK e badge na UI.
 *
 * Injeção real do PID 0x0500/stream_type=0x86 no transport stream via FFmpeg
 * foi removida (2026-06-22): confirmado por teste de bytes que o FFmpeg
 * descarta esse PID no probe do demuxer mesmo com -copy_unknown -map 0 — a
 * injeção nunca chegava de fato a sistemas terceiros, e o código que tentava
 * ainda causava crash loop em relays multi-hop ("could not find codec
 * parameters"). Sem uma ferramenta dedicada de manipulação de TS (ex.:
 * TSDuck), não há caminho viável para SCTE-35 real no stream via FFmpeg.
 *
 * @param outOfNetwork true = início do break (saída da rede), false = retorno
 * @param durationSecs duração do break em segundos (opcional)
 */
export function injectScte35(channelId: string, outOfNetwork: boolean, durationSecs?: number): void {
  signalRemoteScte35(outOfNetwork, durationSecs)
  console.log(`[scte35/${channelId}] splice_insert out_of_network=${outOfNetwork}${durationSecs ? ` dur=${durationSecs}s` : ''} (sinalização HTTP apenas)`)
}

function signalRemoteScte35(outOfNetwork: boolean, durationSecs?: number): void {
  const { url, sourceId, secret } = config.scteSignal
  if (!url || !sourceId || !secret) return
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-scte-secret': secret },
    body: JSON.stringify({ sourceId, outOfNetwork, durationSecs }),
  })
    .then(res => { if (!res.ok) console.warn(`[scte-signal] resposta inesperada: ${res.status}`) })
    .catch(err => console.warn(`[scte-signal] falha ao sinalizar remoto: ${err.message}`))
}

export async function restartStreaming(
  channelId: string,
  mediaId: string | null,
  cueIn = 0,
  contentGraphic: GraphicConfig | null = null,
) {
  await startStreaming(channelId, mediaId, cueIn, contentGraphic)
}

// ─── Concat demuxer: playlist inteira num único processo FFmpeg ───────────────

export interface PlaylistStreamItem {
  hlsUrl: string
  cueIn:  number
  cueOut?: number | null
}

// Canais em modo concat: o FFmpeg gerencia as transições internamente
const concatRunEnd = new Map<string, number>()

export function getConcatRunEnd(channelId: string): number | undefined {
  return concatRunEnd.get(channelId)
}

export function clearConcatRun(channelId: string) {
  concatRunEnd.delete(channelId)
}

async function writeConcatFile(channelId: string, items: PlaylistStreamItem[]): Promise<string> {
  const lines = ['ffconcat version 1.0']
  for (const item of items) {
    lines.push(`file '${item.hlsUrl}'`)
    if (item.cueIn > 0)                          lines.push(`inpoint ${item.cueIn.toFixed(3)}`)
    if (item.cueOut != null && item.cueOut > 0)  lines.push(`outpoint ${item.cueOut.toFixed(3)}`)
  }
  const filePath = join(tmpdir(), `tvplay_concat_${channelId}.txt`)
  await writeFile(filePath, lines.join('\n') + '\n', 'utf8')
  return filePath
}

function buildConcatArgs(
  concatFilePath: string,
  output: OutputConfig,
  contentGraphic: GraphicConfig | null = null,
  relayPort: number | null = null,
): string[] | null {
  const effectiveGraphic = contentGraphic ?? output.graphic ?? null

  // Se graphic (raw Prisma) tem templateId mas não templateElements, converte inline
  let resolvedGraphic = effectiveGraphic as any
  if (resolvedGraphic && resolvedGraphic.templateId && !resolvedGraphic.templateElements) {
    const tmplElems = resolvedGraphic.template?.elements
    if (tmplElems?.length) {
      const values: Record<string, any> = resolvedGraphic.elementValues ?? {}
      const merged = tmplElems
        .map((el: any) => ({ ...el, ...(values[el.id] ?? {}) }))
        .filter((el: any) => el.active !== false)
      resolvedGraphic = { templateElements: merged }
    }
  }

  // Decide sistema gráfico: template (novo) ou legado
  const useTemplate = !!resolvedGraphic?.templateElements?.length
  const templateResult = useTemplate
    ? buildTemplateFilter(resolvedGraphic.templateElements, output.videoResolution)
    : null

  // Inputs extras: logos do template OU logo legado
  const logoUrl = (!useTemplate && resolvedGraphic?.logoUrl) ? resolveLogoUrl(resolvedGraphic.logoUrl) : null
  const extraLogoInputs: string[] = templateResult
    ? templateResult.extraInputs.flatMap((url: string) => ['-stream_loop', '-1', '-i', resolveLogoUrl(url)])
    : (logoUrl ? ['-stream_loop', '-1', '-i', logoUrl] : [])

  console.log(`[stream/concat/${output.name}] gfx: useTemplate=${useTemplate} tmplElems=${resolvedGraphic?.templateElements?.length ?? 0} logoUrl=${resolvedGraphic?.logoUrl ?? 'none'}`)

  const input: string[] = [
    '-hide_banner', '-loglevel', 'warning', '-stats',
    '-re',
    '-f', 'concat', '-safe', '0',
    '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
    '-i', concatFilePath,
    ...extraLogoInputs,
  ]

  const aBitrate = output.audioBitrate ?? 128
  const vBitrate = output.videoBitrate || 4000
  const videoBitrateArgs = [
    '-b:v', `${vBitrate}k`,
    '-maxrate', `${Math.round(vBitrate * 1.2)}k`,
    '-bufsize', `${vBitrate}k`,
  ]

  // CFR fixo em 29.97fps (NTSC, padrão da maioria do conteúdo broadcast BR):
  // sem isso, clipes concatenados com framerates ligeiramente diferentes (29.97
  // vs 30 vs 25) não são normalizados pelo concat demuxer, e o drift acumula no
  // -re do relay final (rate 1.05x, lag crescente até estourar timestamp
  // discontinuity no destino RTMP/YouTube).
  const cfrArgs = ['-r', '30000/1001', '-fps_mode', 'cfr']

  let videoCodec: string[]
  if (useTemplate && templateResult) {
    videoCodec = [
      ...templateResult.filterArgs,
      // ultrafast: concat lê fontes 1080p e reescala — em VPS de 1 vCPU o decode
      // já consome a maior parte da CPU, veryfast fazia o lag de -re crescer continuamente
      '-c:v', 'libx264', '-preset', 'ultrafast', '-profile:v', 'high',
      ...videoBitrateArgs,
      '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', ...cfrArgs,
      '-c:a', 'aac', '-ar', '44100', '-b:a', `${aBitrate}k`,
      ...templateResult.mapArgs,
    ]
  } else {
    const { filterArgs, mapArgs } = buildVideoFilter(output.videoResolution, resolvedGraphic, !!logoUrl)
    videoCodec = [
      ...filterArgs,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-profile:v', 'high',
      ...videoBitrateArgs,
      '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', ...cfrArgs,
      '-c:a', 'aac', '-ar', '44100', '-b:a', `${aBitrate}k`,
      ...mapArgs,
    ]
  }

  // Relay mode: redirect to UDP loopback
  if (relayPort !== null && isRelayCapable(output.type)) {
    return [...input, ...videoCodec, '-f', 'mpegts', `udp://127.0.0.1:${relayPort}?pkt_size=1316`]
  }

  switch (output.type) {
    case 'RTMP': {
      if (!output.url) return null
      const dest = output.streamKey ? `${output.url}/${output.streamKey}` : output.url
      return [...input, ...videoCodec, '-f', 'flv', dest]
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
    default:
      return null
  }
}

function spawnOutputFromConcat(
  channelId: string,
  output: OutputConfig,
  concatFilePath: string,
  contentGraphic: GraphicConfig | null = null,
  relayPort: number | null = null,
): StreamProcess | null {
  const effectiveGraphic = contentGraphic ?? output.graphic ?? null
  const args = buildConcatArgs(concatFilePath, output, contentGraphic, relayPort)
  if (!args) return null

  const proc = spawn(config.ffmpeg.path, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, TZ: clockTz() },
  })
  const sp: StreamProcess = {
    proc, outputId: output.id, type: output.type, name: output.name,
    stopped: false, contentGraphic,
  }

  proc.stdout?.on('data', () => {})
  proc.stderr?.on('data', (d: Buffer) => {
    const raw = d.toString()
    if (!relayPort && raw.includes('bitrate=')) {
      parseStats(channelId, output.id, raw)
    } else if (!raw.includes('bitrate=')) {
      const msg = raw.replace(/\r/g, '\n').trim()
      if (msg) console.log(`[stream/${channelId}/${output.name}] ${msg}`)
    }
  })

  proc.on('exit', (code) => {
    const registered = channelProcs.get(channelId)?.get(output.id)
    if (registered?.proc === proc) {
      channelProcs.get(channelId)?.delete(output.id)
    }
    // Código 0 = fim natural da playlist concat — o playout service gerencia o estado
    const isError = code !== null && code !== 0 && code !== 255
    if (isError && !sp.stopped) {
      console.warn(`[stream/${channelId}/${output.name}] Concat saiu com código ${code} — notificando playout...`)
      onUnexpectedExitCb?.(channelId)
    }
  })

  const gfxInfo = effectiveGraphic
    ? ` | GFX: logo=${effectiveGraphic.logoUrl ?? 'none'} clock=${effectiveGraphic.showClock}`
    : ' | GFX: nenhum'
  const relayInfo = relayPort ? ` → UDP:${relayPort} (relay)` : ''
  console.log(`[stream/${channelId}] Iniciando CONCAT ${output.type} → ${output.name}${relayInfo}${gfxInfo}`)
  console.log(`[stream/${channelId}] FFmpeg concat args: ${args.join(' ')}`)
  return sp
}

export async function startStreamingFromPlaylist(
  channelId: string,
  items: PlaylistStreamItem[],
  endIndex: number,
  contentGraphic: GraphicConfig | null = null,
): Promise<void> {
  if (!items.length) return

  const outputs = await prisma.streamOutput.findMany({
    where: { channelId, active: true },
    include: { graphic: { include: { template: { include: { elements: { where: { active: true }, orderBy: { order: 'asc' } } } } } } },
  })
  if (!outputs.length) return

  // Ensure relay processes are running before restarting content
  await ensureRelays(channelId, outputs)
  await stopStreaming(channelId)

  const concatFilePath = await writeConcatFile(channelId, items)

  const map = new Map<string, StreamProcess>()
  for (const output of outputs) {
    const port = isRelayCapable(output.type) ? relayPortMap.get(output.id) ?? null : null
    const sp = spawnOutputFromConcat(channelId, output, concatFilePath, contentGraphic, port)
    if (sp) map.set(output.id, sp)
  }
  if (map.size) {
    channelProcs.set(channelId, map)
    concatRunEnd.set(channelId, endIndex)
  }
}

// ─── Controle por output individual ──────────────────────────────────────────

export function stopOutput(channelId: string, outputId: string) {
  const sp = channelProcs.get(channelId)?.get(outputId)
  if (sp) {
    sp.stopped = true
    try { sp.proc.kill('SIGTERM') } catch {}
    channelProcs.get(channelId)?.delete(outputId)
    outputStats.get(channelId)?.delete(outputId)
    console.log(`[stream/${channelId}] Output ${sp.name} parado manualmente`)
  }
  // Also stop relay for this output if running
  const relayEntry = relayProcs.get(channelId)?.get(outputId)
  if (relayEntry) {
    relayEntry.stopped = true
    try { relayEntry.proc.kill('SIGTERM') } catch {}
    relayProcs.get(channelId)?.delete(outputId)
    console.log(`[relay/${channelId}] Relay de output ${outputId} parado`)
  }
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
    include: { graphic: { include: { template: { include: { elements: { where: { active: true }, orderBy: { order: 'asc' } } } } } } },
  })
  if (!output || !output.active) return

  // If other outputs in this channel have active relays, start relay for this one too
  const channelRelays = relayProcs.get(channelId)
  const isRelayMode = (channelRelays?.size ?? 0) > 0

  let port: number | null = null
  if (isRelayMode && isRelayCapable(output.type) && output.url) {
    port = getOrAllocRelayPort(outputId)
    const relay = spawnRelay(channelId, output, port)
    if (relay) {
      if (!relayProcs.has(channelId)) relayProcs.set(channelId, new Map())
      relayProcs.get(channelId)!.set(outputId, relay)
    }
  }

  const sp = spawnOutput(channelId, output, hlsUrlForMedia(mediaId), cueIn, false, contentGraphic, port)
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
// Stops relays first (full streaming reset), then starts direct output.
// Sempre re-encoda (nunca -c copy) quando há saída relay-capable: o relay copia bytes
// H.264 crus (-c copy) e não pode receber um bitstream com SPS/PPS diferente do que a
// playlist (concat/reencode) produz sem reabrir a conexão externa — forçar o mesmo
// encoder/GOP aqui (ver comentário acima de isRelayCapable) elimina o restart do relay
// ao alternar entre CUT de entrada e PLAY de playlist (2026-06-29).
export async function startStreamingFromUrl(
  channelId: string,
  inputUrl: string,
  contentGraphic: GraphicConfig | null = null,
) {
  const outputs = await prisma.streamOutput.findMany({
    where: { channelId, active: true },
    include: { graphic: { include: { template: { include: { elements: { where: { active: true }, orderBy: { order: 'asc' } } } } } } },
  })
  if (!outputs.length) return

  // Ensure relay processes are running before restarting content — sem isso o
  // FFmpeg escreve direto na URL final (RTMP/YouTube) sem o relay intermediário
  // que mantém a conexão viva durante gaps/transições (causa de "conexão ok
  // mas tela preta" até o primeiro PLAY da playlist reiniciar via relay).
  await ensureRelays(channelId, outputs)
  await stopStreaming(channelId)

  const map = new Map<string, StreamProcess>()
  for (const output of outputs) {
    const port = isRelayCapable(output.type) ? relayPortMap.get(output.id) ?? null : null
    // isLive=false → sempre re-encode (libx264/aac) quando passa pelo relay, mantendo
    // o mesmo bitstream que startStreamingFromUrlReencode/concat usam na mesma saída
    const live = port === null
    const sp = spawnOutput(channelId, output, inputUrl, 0, live, contentGraphic, port)
    if (sp) map.set(output.id, sp)
  }
  if (map.size) channelProcs.set(channelId, map)
}

// Modo re-encode (-re + libx264): para clips URL na playlist
// Usa relay para manter conexão RTMP/SRT viva durante transições de clipe.
export async function startStreamingFromUrlReencode(
  channelId: string,
  inputUrl: string,
  contentGraphic: GraphicConfig | null = null,
) {
  const outputs = await prisma.streamOutput.findMany({
    where: { channelId, active: true },
    include: { graphic: { include: { template: { include: { elements: { where: { active: true }, orderBy: { order: 'asc' } } } } } } },
  })
  if (!outputs.length) return

  // Ensure relay processes are running before restarting content
  await ensureRelays(channelId, outputs)
  await stopStreaming(channelId)

  const map = new Map<string, StreamProcess>()
  for (const output of outputs) {
    const port = isRelayCapable(output.type) ? relayPortMap.get(output.id) ?? null : null
    // isLive=false → usa -re + re-encode (libx264/aac) em vez de -c copy
    const sp = spawnOutput(channelId, output, inputUrl, 0, false, contentGraphic, port)
    if (sp) map.set(output.id, sp)
  }
  if (map.size) channelProcs.set(channelId, map)
}

// Inicia streaming com fonte gerada (BLACK ou COLORBARS).
// Preserva o relay ativo para manter a conexão RTMP/SRT sem dropout.
export async function startStreamingFromFallback(channelId: string, fallbackType: 'BLACK' | 'COLORBARS' | string) {
  const outputs = await prisma.streamOutput.findMany({
    where: { channelId, active: true },
    include: { graphic: { include: { template: { include: { elements: { where: { active: true }, orderBy: { order: 'asc' } } } } } } },
  })
  if (!outputs.length) return

  // Garante que os relays estão ativos ANTES de parar o content process
  await ensureRelays(channelId, outputs)
  await stopStreaming(channelId)   // para só o content — relay continua vivo

  const map = new Map<string, StreamProcess>()
  for (const output of outputs) {
    const size = output.videoResolution ?? '1280x720'
    // rate=30000/1001 (29.97fps, CFR) — mesmo framerate nominal do modo 'reencode'
    // (concat/direct-reencode), para que o bitstream H.264 gerado aqui seja compatível
    // com o que o relay já está repassando, evitando precisar reiniciar o relay ao
    // alternar entre BARS/BLACK e entrada/playlist (mesma causa do bug corrigido em v1.1.13).
    const videoInput = fallbackType === 'COLORBARS'
      ? `smptehdbars=size=${size}:rate=30000/1001`
      : `color=c=black:size=${size}:rate=30000/1001`

    // Usa proxy port se relay-capable (mantém RTMP vivo via relay)
    const port = isRelayCapable(output.type) ? relayPortMap.get(output.id) ?? null : null
    const args = buildFallbackArgs(videoInput, output, output.graphic ?? null, port)
    if (!args) continue

    const proc = spawn(config.ffmpeg.path, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, TZ: clockTz() },
    })
    const sp: StreamProcess = { proc, outputId: output.id, type: output.type, name: output.name, stopped: false, contentGraphic: null }
    proc.stdout?.on('data', () => {})
    proc.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim()
      if (msg) console.log(`[stream/${channelId}/${output.name}/fallback] ${msg}`)
    })
    proc.on('exit', (code) => {
      const registeredFb = channelProcs.get(channelId)?.get(output.id)
      if (registeredFb?.proc === proc) channelProcs.get(channelId)?.delete(output.id)
      if (code !== null && code !== 0 && code !== 255 && !sp.stopped) {
        console.warn(`[stream/${channelId}/${output.name}/fallback] Saiu com código ${code} — reconectando em 2s...`)
        setTimeout(() => {
          if (sp.stopped) return
          startStreamingFromFallback(channelId, fallbackType).catch(() => {})
        }, 2000)
      }
    })
    console.log(`[stream/${channelId}] Fallback ${fallbackType} (${size}) → ${output.name}${port ? ` via relay:${port}` : ' direto'}`)
    map.set(output.id, sp)
  }
  if (map.size) channelProcs.set(channelId, map)
}

// Dois inputs: [0] padrão de vídeo lavfi, [1] áudio silencioso lavfi
// Mapeamento explícito -map 0:v -map 1:a para evitar ambiguidade
function buildFallbackArgs(videoInput: string, output: OutputConfig, graphic: GraphicConfig | null, relayPort: number | null = null): string[] | null {
  const aBitrate = output.audioBitrate ?? 128
  // Sem logo no fallback (não há segundo input de imagem)
  const { filterArgs } = buildVideoFilter(output.videoResolution, graphic, false)

  const inputArgs = [
    '-hide_banner', '-loglevel', 'warning',
    '-re',                                          // gera em tempo real, não sobrecarrega relay
    '-f', 'lavfi', '-i', videoInput,
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
  ]

  const encodeArgs = [
    ...filterArgs,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high',
    ...(output.videoBitrate ? ['-b:v', `${output.videoBitrate}k`, '-maxrate', `${Math.round(output.videoBitrate * 1.5)}k`, '-bufsize', `${output.videoBitrate * 2}k`] : []),
    // -g/-keyint_min 60 a 29.97fps: mesmo GOP do modo 'reencode' (concat/direct-reencode) —
    // ver buildArgs/buildConcatArgs. Manter o mesmo GOP/profile/framerate entre os modos
    // evita misturar bitstreams H.264 incompatíveis no -c copy do relay (mesma causa do
    // restart de relay corrigido em v1.1.13, agora também entre BARS/BLACK e SRT/playlist).
    '-g', '60', '-keyint_min', '60', '-sc_threshold', '0',
    '-c:a', 'aac', '-ar', '44100', '-b:a', `${aBitrate}k`,
  ]

  // Relay-capable: roteia pelo proxy para manter RTMP/SRT vivo sem dropout
  if (relayPort !== null && isRelayCapable(output.type)) {
    return [...inputArgs, ...encodeArgs, '-f', 'mpegts', `udp://127.0.0.1:${relayPort}?pkt_size=1316`]
  }

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
