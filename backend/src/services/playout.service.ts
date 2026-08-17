import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import { prisma } from '../lib/prisma'
import { config } from '../config'
import * as streamService from './stream.service'
import type { GraphicConfig } from './stream.service'
import * as tickerService from './ticker.service'
import * as previewService from './preview.service'
import * as activeInputs from './active-inputs.service'

// ─── Cache de URLs resolvidas para fallback INPUT_SOURCE ──────────────────────
// Pré-resolve via yt-dlp em background para que a entrada esteja pronta
// imediatamente quando o fallback for ativado (stop, break, fim de playlist).
// URLs do YouTube duram ~6h; refresh a cada 90 min garante que nunca expiram.

interface FallbackCacheEntry { url: string; ts: number }
const fallbackUrlCache = new Map<string, FallbackCacheEntry>()   // sourceId → entry
const FALLBACK_CACHE_TTL_MS = 90 * 60 * 1000                    // 90 min

function cacheFallbackUrl(sourceId: string, url: string) {
  fallbackUrlCache.set(sourceId, { url, ts: Date.now() })
}

function getCachedFallbackUrl(sourceId: string): string | null {
  const e = fallbackUrlCache.get(sourceId)
  if (!e) return null
  if (Date.now() - e.ts > FALLBACK_CACHE_TTL_MS) { fallbackUrlCache.delete(sourceId); return null }
  return e.url
}

// Resolve com cache — usa entrada em cache se disponível e fresca
async function resolveFallbackUrl(
  source: { id: string; type: string; url: string | null; device: string | null },
): Promise<string | null> {
  const cached = getCachedFallbackUrl(source.id)
  if (cached) {
    console.log(`[playout] fallback cache hit: ${source.id}`)
    return cached
  }
  const url = await resolveInputUrl(source)
  if (url) cacheFallbackUrl(source.id, url)
  return url
}

// Pré-resolve em background sem bloquear (chama logo após configurar o fallback)
function preFetchFallbackUrl(
  source: { id: string; type: string; url: string | null; device: string | null },
) {
  resolveInputUrl(source)
    .then(url => { if (url) { cacheFallbackUrl(source.id, url); console.log(`[playout] fallback pré-resolvido: ${source.id}`) } })
    .catch(() => {})
}

// Refresh periódico para manter URLs frescas (YouTube expira ~6h; refresh a cada 90 min)
setInterval(async () => {
  if (fallbackUrlCache.size === 0) return
  const channels = await prisma.channel.findMany({
    where: { fallbackType: 'INPUT_SOURCE', fallbackSourceId: { not: null } },
    include: { fallbackSource: true },
  }).catch(() => [] as any[])
  for (const ch of channels) {
    if (ch.fallbackSource) preFetchFallbackUrl(ch.fallbackSource)
  }
}, FALLBACK_CACHE_TTL_MS)

// Exportado para injeção no active-inputs.service (evita dependência circular)
export async function resolveSourceUrl(
  src: { id: string; type: string; url: string | null; device: string | null },
): Promise<string | null> {
  return resolveInputUrl(src)
}

// Helper: ativa streaming de uma InputSource como fallback.
// Usa HLS relay pré-existente se disponível (instantâneo), senão resolve on-demand.
async function activateFallbackSource(
  channelId: string,
  source: { id: string; type: string; url: string | null; device: string | null },
  graphic: GraphicConfig | null,
): Promise<void> {
  previewService.stopPreview(source.id)

  if (activeInputs.isActive(source.id)) {
    // Relay ativo configurado para esta fonte — espera o primeiro segmento HLS
    // (evita conectar direto na URL crua, que pode conflitar com a porta usada
    // pelo relay, ex.: SRT mode=listener só aceita um listener por porta).
    const ready = activeInputs.isReady(source.id) || await activeInputs.waitUntilReady(source.id)
    if (ready) {
      const hlsUrl = `http://localhost:${config.port}/api/input-sources/${source.id}/active-stream/index.m3u8`
      console.log(`[playout] Fallback ch=${channelId} — relay ativo disponível: ${source.id}`)
      streamService.startStreamingFromUrl(channelId, hlsUrl, graphic).catch(() => {})
      return
    }
    // SRT/RTSP em modo listener só aceita UM listener por porta — cair para a URL crua
    // aqui sempre falha com "Address in use" (o active-inputs.service já está ouvindo
    // essa porta), gerando um loop infinito de erro/reconnect a cada 5s sem nunca
    // recuperar o canal (confirmado em produção, 2026-06-30). Em vez de tentar a URL
    // crua, insiste no HLS local com uma segunda espera — o relay pode estar passando
    // por um restart momentâneo, não significa que parou de existir.
    if (/^srt:.*mode=listener/i.test(source.url ?? '')) {
      console.warn(`[playout] Fallback ch=${channelId} — relay SRT-listener de ${source.id} não ficou pronto, tentando novamente (URL crua sempre falharia: porta já em uso)`)
      const readyRetry = await activeInputs.waitUntilReady(source.id, 15_000)
      if (readyRetry) {
        const hlsUrl = `http://localhost:${config.port}/api/input-sources/${source.id}/active-stream/index.m3u8`
        streamService.startStreamingFromUrl(channelId, hlsUrl, graphic).catch(() => {})
      } else {
        console.error(`[playout] Fallback ch=${channelId} — relay SRT-listener de ${source.id} não recuperou; canal permanece no fallback de fundo (BLACK/COLORBARS)`)
      }
      return
    }
    console.warn(`[playout] Fallback ch=${channelId} — relay ativo de ${source.id} não ficou pronto a tempo, usando URL direta`)
  }

  const url = await resolveFallbackUrl(source).catch(() => null)
  if (url) streamService.startStreamingFromUrl(channelId, url, graphic).catch(() => {})
}

/**
 * Re-resolve a fonte de conteúdo dos canais atualmente cortados (CUT) para
 * `sourceId`, após essa InputSource ser ativada/desativada como entrada ativa
 * (relay). Permite migrar entre URL direta e HLS do relay sem exigir um novo
 * cut-to-input manual.
 */
export async function refreshInputSourceConsumers(sourceId: string): Promise<void> {
  for (const [channelId, state] of states.entries()) {
    if (state.activeCut?.type !== 'INPUT_SOURCE' || state.activeCut.sourceId !== sourceId) continue
    const source = await prisma.inputSource.findUnique({ where: { id: sourceId } }).catch(() => null)
    if (!source) continue
    const graphic = await resolveGraphic(null, null, channelId).catch(() => null)
    console.log(`[playout] Re-resolvendo fonte ${sourceId} para ch=${channelId} (relay ativo mudou)`)
    activateFallbackSource(channelId, source, graphic).catch(() => {})
  }
}

// ─────────────────────────────────────────────────────────────────────────────

const execFileAsync = promisify(execFile)

// Controle (via Configurações do sistema) se este servidor resolve fontes/clipes
// YouTube/Twitch via yt-dlp. YouTube bloqueia quase todas as requisições de IPs de
// datacenter ("Sign in to confirm you're not a bot") — em VPS, o operador desliga
// este toggle para pular as tentativas (evita até 5min de timeouts fadados) e
// degradar direto para fallback. Carregado do banco no boot (server.ts) e atualizado
// ao salvar Configurações (settings.route.ts).
let youtubeContentEnabled = true

export function setYoutubeContentEnabled(v: boolean) {
  youtubeContentEnabled = v
}

export function isYoutubeContentEnabled(): boolean {
  return youtubeContentEnabled
}

const YT_DLP_PATTERN = /youtube\.com|youtu\.be|twitch\.tv/i

// Detecta se uma URL deve ser resolvida via yt-dlp (YouTube, Twitch, etc.)
function needsYtDlp(type: string, url: string): boolean {
  if (type === 'YOUTUBE') return true
  return YT_DLP_PATTERN.test(url)
}

// Detecta se um clip URL é do tipo yt-dlp mesmo quando sourceType está desatualizado (fallback)
function isUrlClip(sourceType: string | null | undefined, sourceUrl: string | null | undefined): boolean {
  if (sourceType === 'URL') return true
  if (sourceUrl && YT_DLP_PATTERN.test(sourceUrl)) return true
  return false
}

// Clientes a tentar em ordem — ios é o mais confiável em 2025 (bypassa bot-check do YouTube)
const YT_CLIENTS = ['ios', 'tv_embedded', 'android', 'mweb', ''] as const

// ─── Cache de falha de resolução (resolveViaYtDlp) ────────────────────────────
// Quando todas as tentativas falham (ex.: bloqueio de IP de datacenter — "Sign in
// to confirm you're not a bot" —, persistente e não relacionado a cookies), evita
// repetir as 5 tentativas sequenciais (até ~300s de bloqueio) a cada vez que o
// mesmo clipe/URL é tocado novamente em sequência rápida (ex.: loop de playlist).
// TTL curto (2 min): se o bloqueio for transitório, ainda tenta de novo em breve;
// se for persistente, poupa o pipeline de conteúdo de travar repetidamente — o
// gap de silêncio no relay RTMP/SRT durante essa espera é o que faz plataformas
// como o YouTube ocasionalmente encerrar a sessão de transmissão (2026-06-24).
const ytResolveFailureCache = new Map<string, number>()  // url → timestamp da última falha
const YT_RESOLVE_FAILURE_TTL_MS = 2 * 60 * 1000           // 2 min

function recentlyFailedToResolve(url: string): boolean {
  const ts = ytResolveFailureCache.get(url)
  if (ts === undefined) return false
  if (Date.now() - ts > YT_RESOLVE_FAILURE_TTL_MS) { ytResolveFailureCache.delete(url); return false }
  return true
}

function ytClientArgs(client: string): string[] {
  return client ? ['--extractor-args', `youtube:player_client=${client}`] : []
}

// Retorna ['--cookies', '/tmp/yt-cookies-tmp.txt'] copiando o arquivo original.
// yt-dlp reescreve o arquivo de cookies após cada execução (comportamento padrão),
// o que reduziria o arquivo de N→poucas linhas. A cópia temporária preserva o original.
function ytCookiesArgs(): string[] {
  const f = config.ytdlp?.cookiesFile
  if (!f || !fs.existsSync(f)) return []
  const tmp = path.join('/tmp', 'yt-cookies-tmp.txt')
  try { fs.copyFileSync(f, tmp) } catch { return ['--cookies', f] }
  return ['--cookies', tmp]
}

// Verifica se URL YouTube/Twitch é stream ao vivo (true) ou VOD (false)
// Retorna null se yt-dlp falhar
export async function checkIsLive(url: string): Promise<{ isLive: boolean | null; title?: string; duration?: number }> {
  if (!youtubeContentEnabled) {
    console.log(`[yt-dlp] desabilitado nas Configurações deste servidor — pulando checkIsLive: ${url}`)
    return { isLive: null }
  }
  const base = ['--no-playlist', '--no-warnings', '--socket-timeout', '15', '--print', '%(is_live)s|%(title)s|%(duration)s']
  const cookies = ytCookiesArgs()
  for (const client of YT_CLIENTS) {
    try {
      const { stdout } = await execFileAsync('yt-dlp', [...base, ...cookies, ...ytClientArgs(client), url], { timeout: 20000 })
      const [isLiveStr, title, durStr] = stdout.trim().split('|')
      const isLive = isLiveStr === 'True' ? true : isLiveStr === 'False' ? false : null
      const duration = durStr && durStr !== 'NA' ? parseFloat(durStr) : undefined
      console.log(`[yt-dlp] checkIsLive OK (client=${client || 'default'}): live=${isLive}`)
      return { isLive, title: title === 'NA' ? undefined : title, duration }
    } catch (err: any) {
      console.error(`[yt-dlp] checkIsLive falha (client=${client || 'default'}): ${String(err?.message ?? err).slice(0, 200)}`)
    }
  }
  return { isLive: null }
}

// Resolve via yt-dlp — tenta múltiplos player_client para contornar bot-check do YouTube
async function resolveViaYtDlp(rawUrl: string): Promise<string | null> {
  if (!youtubeContentEnabled) {
    console.log(`[yt-dlp] desabilitado nas Configurações deste servidor — não resolvendo: ${rawUrl}`)
    return null
  }
  if (recentlyFailedToResolve(rawUrl)) {
    console.log(`[yt-dlp] falha recente em cache (<2min) — pulando novas tentativas: ${rawUrl}`)
    return null
  }
  const base = [
    '--no-playlist', '-g', '--no-warnings', '--socket-timeout', '15',
    '--js-runtimes', 'node',          // usa Node.js para resolver n-challenge do YouTube
    '--remote-components', 'ejs:github', // baixa o solver EJS do GitHub se necessário
  ]
  // itag=18: combined MP4 360p (sempre tem video+audio) — fallback confiável
  const fmt  = '18/best[protocol=m3u8_native]/best[vcodec!=none][acodec!=none][height<=720]/best[vcodec!=none][acodec!=none]/best'
  const cookies = ytCookiesArgs()
  for (const client of YT_CLIENTS) {
    try {
      const { stdout } = await execFileAsync('yt-dlp', [...base, '-f', fmt, ...cookies, ...ytClientArgs(client), rawUrl], { timeout: 60000 })
      const lines = stdout.trim().split('\n').filter(l => l.startsWith('http'))
      if (lines.length === 0) continue
      if (lines.length === 2) {
        // DASH: video e audio separados — combina com separador para buildArgs tratar
        const combined = `${lines[0]}\n${lines[1]}`
        console.log(`[yt-dlp] DASH URL resolvida OK (client=${client || 'default'}): video+audio separados`)
        return combined
      }
      const url = lines[0]
      // Manifest "ao vivo"/DVR (hls_playlist, playlist_type=DVR, source=yt_live_broadcast):
      // sem cookies válidos para autenticar o formato progressivo normal, alguns clientes
      // (ex.: tv_embedded) ainda retornam esse manifest genérico de fallback em vez de
      // erro — mas ele é sabidamente instável (keepalive falha, segmentos somem) e nunca
      // deveria ser usado para um clip de playlist. Rejeitamos e seguimos tentando o
      // próximo client, em vez de transmitir um stream que vai cair sozinho minutos depois
      // (confirmado em produção, 2026-06-30 — corte recorrente exigindo refresh).
      if (url && /\/api\/manifest\/hls_playlist\/|playlist_type\/DVR|source\/yt_live_broadcast/.test(url)) {
        console.warn(`[yt-dlp] client=${client || 'default'} retornou manifest ao vivo/DVR instável — rejeitando, provável cookie inválido/expirado`)
        continue
      }
      if (url) {
        console.log(`[yt-dlp] URL resolvida OK (client=${client || 'default'}): ${url.slice(0, 80)}`)
        return url
      }
    } catch (err: any) {
      const msg = String(err?.message ?? err)
      const stderr = (err as any)?.stderr ? String((err as any).stderr).slice(0, 400) : ''
      console.error(`[yt-dlp] Falha (client=${client || 'default'}): ${msg.slice(0, 300)}`)
      if (stderr) console.error(`[yt-dlp] stderr: ${stderr}`)
    }
  }
  console.error(`[yt-dlp] TODAS as tentativas falharam para: ${rawUrl}`)
  ytResolveFailureCache.set(rawUrl, Date.now())
  return null
}

// Resolve a URL real de uma fonte de entrada (YouTube/Twitch via yt-dlp; outros direto)
// Suporta tipo CLIP: resolve a partir do clipe cadastrado
async function resolveInputUrl(
  src: { type: string; url: string | null; device: string | null; clipId?: string | null },
  channelId?: string,
): Promise<string | null> {
  // Tipo WEBCAM: usa o SRT local da câmera browser
  if (src.type === 'WEBCAM') {
    if (!channelId) return null
    const { getCameraInputUrl } = await import('./camera.service')
    return getCameraInputUrl(channelId)
  }

  // Tipo CLIP: resolve via clipe cadastrado
  if (src.type === 'CLIP' && src.clipId) {
    const clip = await prisma.clip.findUnique({
      where: { id: src.clipId },
      include: { media: { select: { hlsPath: true } } },
    })
    if (!clip) return null
    if (isUrlClip(clip.sourceType, clip.sourceUrl) && clip.sourceUrl) {
      // SRT, RTMP, RTSP: usa a URL diretamente (yt-dlp não suporta esses protocolos)
      if (/^srt:|^rtmps?:|^rtsp:/i.test(clip.sourceUrl)) {
        console.log(`[playout] CLIP input — URL direta (sem yt-dlp): ${clip.sourceUrl}`)
        return clip.sourceUrl
      }
      console.log(`[playout] CLIP input — resolvendo URL via yt-dlp: ${clip.sourceUrl}`)
      return resolveViaYtDlp(clip.sourceUrl)
    }
    if (clip.media?.hlsPath) {
      const { config } = await import('../config')
      const mediaId = clip.media.hlsPath.split('/')[1]
      return `http://localhost:${config.port}/api/media/stream/${mediaId}/index.m3u8`
    }
    return null
  }

  const raw = src.url ?? src.device ?? null
  if (!raw) return null
  if (!needsYtDlp(src.type, raw)) return raw
  return resolveViaYtDlp(raw)
}

export type PlayoutStatus = 'IDLE' | 'PLAYING' | 'PAUSED' | 'STOPPED'

export interface ActiveGraphic {
  logoUrl?: string | null
  logoPosition?: string | null
  showClock?: boolean
  lowerText?: string | null
  templateElements?: import('./stream.service').GraphicElementConfig[]
}

export interface PlayoutState {
  channelId: string
  status: PlayoutStatus
  playlistId: string | null
  name: string | null
  playlistIsAutoSave: boolean
  loop: boolean
  currentIndex: number
  currentItem: CurrentItem | null
  position: number              // segundos decorridos no clip atual
  totalElapsed: number          // segundos decorridos na playlist
  totalPlaylistDuration: number // soma das durações de todos os itens
  itemCount: number             // total de itens na playlist
  updatedAt: number             // timestamp epoch ms
  activeGraphic: ActiveGraphic | null
  // Rastreia o sinal atualmente no ar (para iluminação do switcher)
  activeCut: { type: 'INPUT_SOURCE' | 'BLACK' | 'COLORBARS'; sourceId?: string | null } | null
  scteEnabled: boolean
  scteLastEvent: { outOfNetwork: boolean; durationSecs?: number; sentAt: number } | null
  scteInputLastEvent: { sourceId: string; outOfNetwork: boolean; durationSecs?: number; sentAt: number } | null
  audioLevels: { l: number; r: number } | null
}

export interface CurrentItem {
  playlistItemId: string
  clipId: string
  mediaId: string | null
  code: string
  title: string
  modality: string
  sourceType: string      // FILE | URL | BREAK
  sourceUrl: string | null
  clientName: string | null
  typeName: string | null
  typeCode: string | null
  typeBg: string | null
  typeColor: string | null
  duration: number        // duração efetiva (cueOut - cueIn)
  cueIn: number
  cueOut: number | null
  hlsPath: string | null
  order: number
  breakNum: number
  loop: boolean
  maxDuration: number | null
  isBreak: boolean
}

// Clients WebSocket por canal
type WSClient = { send(data: string): void; readyState: number }
const wsClients = new Map<string, Set<WSClient>>()

// Estado em memória por canal
const states = new Map<string, PlayoutState>()
const timers = new Map<string, ReturnType<typeof setInterval>>()
// Guard: impede execução concorrente da lógica de avanço de clipe por canal
const advancing = new Set<string>()

async function computePlaylistMeta(playlistId: string): Promise<{ totalDuration: number; count: number }> {
  const items = await prisma.playlistItem.findMany({
    where: { playlistId },
    select: {
      isBreak: true,
      maxDuration: true,
      overrideCueIn: true,
      overrideCueOut: true,
      clip: { select: { cueIn: true, cueOut: true, duration: true, media: { select: { duration: true } } } },
    },
  })
  const totalDuration = (items as any[]).reduce((sum: number, item) => {
    if (item.isBreak) return sum + (item.maxDuration ?? 0)
    if (!item.clip) return sum
    // maxDuration por item (ex: imagens/slides) tem precedência sobre cueIn/cueOut
    if (item.maxDuration && item.maxDuration > 0) return sum + item.maxDuration
    const cueIn = item.overrideCueIn ?? item.clip.cueIn
    const cueOut = item.overrideCueOut ?? item.clip.cueOut ?? item.clip.media?.duration ?? null
    const dur = cueOut ? cueOut - cueIn : (item.clip.media?.duration ?? item.clip.duration ?? 30)
    return sum + dur
  }, 0)
  return { totalDuration, count: items.length }
}

function defaultState(channelId: string): PlayoutState {
  return {
    channelId,
    status: 'IDLE',
    playlistId: null,
    name: null,
    playlistIsAutoSave: false,
    loop: false,
    currentIndex: 0,
    currentItem: null,
    position: 0,
    totalElapsed: 0,
    totalPlaylistDuration: 0,
    itemCount: 0,
    updatedAt: Date.now(),
    activeGraphic: null,
    activeCut: null,
    scteEnabled: false,
    scteLastEvent: null,
    scteInputLastEvent: null,
    audioLevels: null,
  }
}

// Persiste o estado do playout no registro do canal (playlist ativa + índice)
async function persistState(channelId: string, playlistId: string | null, index: number) {
  await prisma.channel.update({
    where: { id: channelId },
    data: { activePlaylistId: playlistId, playlistIndex: index },
  }).catch(() => {})
}

export function getState(channelId: string): PlayoutState {
  return states.get(channelId) ?? defaultState(channelId)
}

export function getAllStates(): PlayoutState[] {
  return Array.from(states.values())
}

// Ativa uma playlist sem iniciar playback — usado pelo autosave ao inserir o primeiro clipe
export function setPlaylistIfIdle(channelId: string, playlistId: string, name?: string | null, isAutoSave?: boolean): void {
  if (!states.has(channelId)) states.set(channelId, defaultState(channelId))
  const state = states.get(channelId)!
  if (state.playlistId) return
  state.playlistId = playlistId
  state.name = name ?? null
  state.playlistIsAutoSave = isAutoSave ?? false
  state.status = 'STOPPED'
  state.currentIndex = 0
  state.currentItem = null
  state.updatedAt = Date.now()
  persistState(channelId, playlistId, 0).catch(console.error)
  // Não broadcast aqui — insertClip/insertBreak farão broadcast após gravar no DB
}

// Remove referência a uma playlist deletada de todos os estados em memória
export function detachPlaylist(playlistId: string): void {
  for (const [channelId, state] of states.entries()) {
    if (state.playlistId !== playlistId) continue
    if (state.status === 'PLAYING' || state.status === 'PAUSED') continue
    state.playlistId = null
    state.name = null
    state.playlistIsAutoSave = false
    state.currentIndex = 0
    state.currentItem = null
    state.updatedAt = Date.now()
    broadcast(channelId, state)
  }
}

export function subscribeWS(channelId: string, ws: WSClient) {
  if (!wsClients.has(channelId)) wsClients.set(channelId, new Set())
  wsClients.get(channelId)!.add(ws)
}

export function unsubscribeWS(channelId: string, ws: WSClient) {
  wsClients.get(channelId)?.delete(ws)
}

function broadcast(channelId: string, state: PlayoutState) {
  const clients = wsClients.get(channelId)
  if (!clients?.size) return
  // Injeta níveis de áudio atuais (lidos do stderr do content process via ebur128)
  state.audioLevels = streamService.getAudioLevels(channelId)
  const msg = JSON.stringify({ event: 'state', data: state })
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg)
  }
}

function makeBreakItem(item: { id: string; order: number; breakNum: number; maxDuration: number | null }): CurrentItem {
  return {
    playlistItemId: item.id,
    clipId: '',
    mediaId: null,
    code: 'BREAK',
    title: 'BREAK',
    modality: 'BK',
    sourceType: 'BREAK',
    sourceUrl: null,
    clientName: null,
    typeName: null,
    typeCode: null,
    typeBg: null,
    typeColor: null,
    // MAX_SAFE_INTEGER when no maxDuration: never auto-advances, only manual
    duration: item.maxDuration ?? Number.MAX_SAFE_INTEGER,
    cueIn: 0,
    cueOut: null,
    hlsPath: null,
    order: item.order,
    breakNum: item.breakNum,
    loop: false,
    maxDuration: item.maxDuration ?? null,
    isBreak: true,
  }
}

async function loadItem(playlistId: string, index: number): Promise<CurrentItem | null> {
  const items = await prisma.playlistItem.findMany({
    where: { playlistId },
    include: {
      clip: {
        include: {
          media: { select: { id: true, hlsPath: true, duration: true } },
          client: { select: { name: true } },
          type: { select: { name: true, code: true, fontColor: true, fontBackColor: true } },
        },
      },
    },
    orderBy: { order: 'asc' },
  })
  if (index >= items.length) return null
  const item = items[index]
  if ((item as any).isBreak) return makeBreakItem(item as any)
  const clip = item.clip
  if (!clip) return null
  const cueIn = item.overrideCueIn ?? clip.cueIn
  const urlClip = isUrlClip(clip.sourceType, clip.sourceUrl)
  const cueOut = item.overrideCueOut ?? clip.cueOut ?? clip.media?.duration ?? null
  // maxDuration pode ser usado em qualquer tipo (URL, FILE, imagens) para controlar duração por item
  const duration = item.maxDuration && item.maxDuration > 0
    ? item.maxDuration
    : urlClip
      ? Number.MAX_SAFE_INTEGER
      : cueOut ? cueOut - cueIn : (clip.media?.duration ?? clip.duration ?? 30)
  return {
    playlistItemId: item.id,
    clipId: clip.id,
    mediaId: clip.media ? (clip.media as any).id ?? null : null,
    code: clip.code,
    title: clip.title,
    modality: clip.modality,
    sourceType: urlClip ? 'URL' : (clip.sourceType ?? 'FILE'),
    sourceUrl: clip.sourceUrl ?? null,
    clientName: clip.client?.name ?? null,
    typeName: clip.type?.name ?? null,
    typeCode: clip.type?.code ?? null,
    typeBg: clip.type?.fontBackColor ?? null,
    typeColor: clip.type?.fontColor ?? null,
    duration,
    cueIn,
    cueOut,
    hlsPath: clip.media?.hlsPath ?? null,
    order: item.order,
    breakNum: item.breakNum,
    loop: item.loop,
    maxDuration: item.maxDuration ?? null,
    isBreak: false,
  }
}

async function countItems(playlistId: string): Promise<number> {
  return prisma.playlistItem.count({ where: { playlistId } })
}

// Retorna o primeiro item pronto a partir de fromIndex.
// BREAK items are always ready. FILE clips need hlsPath. URL clips need sourceUrl.
async function findNextReadyFrom(
  playlistId: string,
  fromIndex: number
): Promise<{ index: number; item: CurrentItem } | null> {
  const items = await prisma.playlistItem.findMany({
    where: { playlistId },
    include: {
      clip: {
        include: {
          media: { select: { id: true, hlsPath: true, duration: true } },
          client: { select: { name: true } },
          type: { select: { name: true, code: true, fontColor: true, fontBackColor: true } },
        },
      },
    },
    orderBy: { order: 'asc' },
  })
  for (let i = fromIndex; i < items.length; i++) {
    const item = items[i]
    if ((item as any).isBreak) return { index: i, item: makeBreakItem(item as any) }
    const clip = item.clip
    if (!clip) continue
    const urlClip = isUrlClip(clip.sourceType, clip.sourceUrl)
    if (!urlClip && !clip.media?.hlsPath) continue // FILE sem arquivo — pula
    if (urlClip && !clip.sourceUrl) continue        // URL sem URL — pula
    const cueIn  = item.overrideCueIn  ?? clip.cueIn
    const cueOut = item.overrideCueOut ?? clip.cueOut ?? clip.media?.duration ?? null
    const duration = (urlClip && item.maxDuration)
      ? item.maxDuration
      : cueOut ? cueOut - cueIn : (clip.media?.duration ?? clip.duration ?? (urlClip ? 3600 : 30))
    return {
      index: i,
      item: {
        playlistItemId: item.id,
        clipId: clip.id,
        mediaId: clip.media ? (clip.media as any).id : null,
        code: clip.code,
        title: clip.title,
        modality: clip.modality,
        sourceType: urlClip ? 'URL' : (clip.sourceType ?? 'FILE'),
        sourceUrl: clip.sourceUrl ?? null,
        clientName: clip.client?.name ?? null,
        typeName: clip.type?.name ?? null,
        typeCode: clip.type?.code ?? null,
        typeBg: clip.type?.fontBackColor ?? null,
        typeColor: clip.type?.fontColor ?? null,
        duration,
        cueIn,
        cueOut,
        hlsPath: clip.media?.hlsPath ?? null,
        order: item.order,
        breakNum: item.breakNum,
        loop: item.loop,
        maxDuration: item.maxDuration ?? null,
        isBreak: false,
      },
    }
  }
  return null
}

// Resolve o gráfico ativo por cascata: clip → playlist → saída de streaming
async function resolveGraphic(
  clipId: string | null,
  playlistId: string | null,
  channelId: string,
): Promise<GraphicConfig | null> {
  // Converte Graphic (com ou sem template) em GraphicConfig unificado
  async function graphicToConfig(graphic: any): Promise<GraphicConfig | null> {
    if (!graphic?.active) return null
    if (graphic.templateId) {
      const tmpl = await prisma.graphicTemplate.findUnique({
        where: { id: graphic.templateId },
        include: { elements: { where: { active: true }, orderBy: { order: 'asc' } } },
      })
      if (!tmpl?.active || !tmpl.elements.length) return null
      const values = (graphic.elementValues ?? {}) as Record<string, any>
      const merged = tmpl.elements
        .map((el: any) => ({ ...el, ...(values[el.id] ?? {}) }))
        .filter((el: any) => el.active !== false)
      return { templateElements: merged }
    }
    return graphic  // legado (logoUrl, showClock, lowerText)
  }

  // Hierarquia: Clipe → Saída → Entrada → Roteiro → Canal (maior→menor prioridade)

  // Select explícito para garantir que elementValues (JSON) é retornado
  const gfxSelect = {
    id: true, name: true, active: true,
    templateId: true, elementValues: true,
    logoUrl: true, logoPosition: true, showClock: true, lowerText: true,
  } as const

  // 1. Clipe
  if (clipId) {
    const clip = await prisma.clip.findUnique({
      where: { id: clipId },
      select: { graphic: { select: gfxSelect } },
    })
    const cfg = await graphicToConfig(clip?.graphic)
    if (cfg) { console.log(`[playout] resolveGraphic → CLIPE`); return cfg }
  }

  // 2. Saída de streaming com gráfico associado
  const output = await prisma.streamOutput.findFirst({
    where: { channelId, active: true, graphicId: { not: null } },
    select: { graphic: { select: gfxSelect } },
  })
  const outCfg = await graphicToConfig(output?.graphic)
  if (outCfg) { console.log(`[playout] resolveGraphic → SAIDA (${output?.graphic?.name})`); return outCfg }

  // 3. Entrada ativa com gráfico (ativo ao fazer CUT para a entrada)
  const chFallback = await prisma.channel.findUnique({
    where: { id: channelId },
    select: {
      fallbackType: true,
      fallbackSource: { select: { graphic: { select: gfxSelect } } },
      graphicTemplate: {
        select: {
          active: true,
          elements: { where: { active: true }, orderBy: { order: 'asc' } },
        },
      },
    },
  }).catch(() => null)

  if (chFallback?.fallbackType === 'INPUT_SOURCE' && chFallback.fallbackSource?.graphic) {
    const inCfg = await graphicToConfig(chFallback.fallbackSource.graphic)
    if (inCfg) { console.log(`[playout] resolveGraphic → ENTRADA`); return inCfg }
  }

  // 4. Roteiro
  if (playlistId) {
    const pl = await prisma.playlist.findUnique({
      where: { id: playlistId },
      select: { graphic: { select: gfxSelect } },
    })
    const cfg = await graphicToConfig(pl?.graphic)
    if (cfg) { console.log(`[playout] resolveGraphic → ROTEIRO`); return cfg }
  }

  // 5. Canal — template global (menor prioridade / fallback)
  const tmpl = chFallback?.graphicTemplate
  if (tmpl?.active && tmpl.elements.length > 0) {
    console.log(`[playout] resolveGraphic → CANAL (template, ${tmpl.elements.length} elem)`)
    return { templateElements: tmpl.elements as any }
  }

  console.log(`[playout] resolveGraphic → NENHUM`)
  return null
}

// Retorna itens FILE consecutivos a partir de fromIndex para uso no concat demuxer.
// Para quando encontra um clip URL ou o fim da playlist.
async function fetchConcatItems(
  playlistId: string,
  fromIndex: number,
): Promise<{ items: streamService.PlaylistStreamItem[]; endIndex: number }> {
  const rows = await prisma.playlistItem.findMany({
    where: { playlistId },
    include: {
      clip: {
        include: { media: { select: { id: true, hlsPath: true, duration: true } } },
      },
    },
    orderBy: { order: 'asc' },
  })

  const items: streamService.PlaylistStreamItem[] = []
  let endIndex = fromIndex

  for (let i = fromIndex; i < rows.length; i++) {
    const row = rows[i]
    if ((row as any).isBreak) break                          // BREAK item interrompe o concat run
    const clip = row.clip
    if (!clip) continue
    if (isUrlClip(clip.sourceType, clip.sourceUrl)) break   // para no primeiro URL clip
    if (!clip.media?.hlsPath) continue                       // sem HLS, pula

    const mediaId = (clip.media as any).id as string
    const cueIn  = row.overrideCueIn  ?? clip.cueIn
    const cueOut = row.overrideCueOut ?? clip.cueOut ?? clip.media?.duration ?? null

    items.push({
      hlsUrl: `http://localhost:${config.port}/api/media/stream/${mediaId}/index.m3u8`,
      cueIn,
      cueOut,
    })
    endIndex = i
  }

  return { items, endIndex }
}

// Garante que todos os arquivos de ticker estão escritos ANTES de spawnar o FFmpeg
async function startTickerFeeds(graphic: GraphicConfig | null): Promise<void> {
  const elements = graphic?.templateElements
  if (!elements?.length) return
  await Promise.all(elements.map(el => {
    if (el.type === 'TICKER' && el.rssUrl && el.id)
      return tickerService.startFeed(el.id, el.rssUrl).catch(() => {})
    if (el.type === 'TICKER' && el.text && el.id)
      tickerService.ensureStaticFile(el.id, el.text)
    return Promise.resolve()
  }))
}

// Inicia streaming para um item da playlist, tratando URL clips e FILE clips
async function startStreamingForItem(
  channelId: string,
  item: CurrentItem | null,
  graphic: GraphicConfig | null,
): Promise<void> {
  if (!item) return
  await startTickerFeeds(graphic)
  if (isUrlClip(item.sourceType, item.sourceUrl) && item.sourceUrl) {
    const clipUrl = item.sourceUrl
    console.log(`[playout] startStreamingForItem ch=${channelId} — URL clip, resolvendo: ${clipUrl}`)
    resolveInputUrl({ type: 'YOUTUBE', url: clipUrl, device: null })
      .then(async (url) => {
        if (url) {
          streamService.startStreamingFromUrlReencode(channelId, url, graphic).catch((err) => {
            console.error(`[playout] startStreamingForItem ch=${channelId} — falha re-encode:`, err)
          })
        } else {
          console.warn(`[playout] startStreamingForItem ch=${channelId} — yt-dlp sem URL (${clipUrl}), ativando fallback`)
          const ch = await prisma.channel.findUnique({
            where: { id: channelId },
            select: { fallbackType: true, fallbackSourceId: true },
          }).catch(() => null)
          streamService.startStreamingFromFallback(channelId, ch?.fallbackType ?? 'BLACK').catch(() => {})
        }
      })
      .catch((err) => {
        console.error(`[playout] startStreamingForItem ch=${channelId} — erro resolve:`, err)
        streamService.startStreamingFromFallback(channelId, 'BLACK').catch(() => {})
      })
  } else {
    streamService.restartStreaming(channelId, item.mediaId, item.cueIn, graphic).catch(() => {})
  }
}

function stopTimer(channelId: string) {
  const t = timers.get(channelId)
  if (t) { clearInterval(t); timers.delete(channelId) }
  advancing.delete(channelId)
}

function startTimer(channelId: string) {
  stopTimer(channelId)
  const interval = setInterval(async () => {
    try {
      const state = states.get(channelId)
      if (!state || state.status !== 'PLAYING') return

      state.position += 1
      state.totalElapsed += 1
      state.updatedAt = Date.now()

      const dur = state.currentItem?.duration ?? Infinity
      if (state.position >= dur) {
        // Impede execução concorrente: se outro tick já está avançando, ignora este
        if (advancing.has(channelId)) {
          broadcast(channelId, state)
          return
        }
        advancing.add(channelId)
        try {
          // Loop: reinicia o clip atual
          if (state.currentItem?.loop) {
            state.position = 0
            broadcast(channelId, state)
            return
          }
          // Avança para o próximo clip com arquivo pronto
          const total = state.playlistId ? await countItems(state.playlistId) : 0
          const nextIndex = state.currentIndex + 1

          // Tenta próximo clip dentro da playlist
          let next = state.playlistId && nextIndex < total
            ? await findNextReadyFrom(state.playlistId, nextIndex)
            : null
          let isLoopRestart = false

          // Fim da playlist + loop ativo → reinicia do primeiro clip
          if (!next && state.loop && state.playlistId) {
            next = await findNextReadyFrom(state.playlistId, 0)
            if (next) { state.totalElapsed = 0; isLoopRestart = true }
          }

          if (next) {
            // Registra log do clip que terminou
            if (state.currentItem) {
              await prisma.log.create({
                data: {
                  program: state.name ?? 'Sem Programa',
                  title: state.currentItem.title,
                  duration: state.currentItem.duration,
                  exhibited: true,
                  startedAt: new Date(state.updatedAt - state.position * 1000),
                  finishedAt: new Date(),
                  client: state.currentItem.clientName,
                },
              }).catch(() => {})
            }
            state.currentIndex = next.index
            state.position = 0
            state.currentItem = next.item
            persistState(channelId, state.playlistId!, next.index)
            // BREAK items have no clip — pass null to resolveGraphic
            const nextClipId = next.item.isBreak ? null : (next.item.clipId || null)
            const newGraphic = await resolveGraphic(nextClipId, state.playlistId, channelId).catch(() => state.activeGraphic)
            state.activeGraphic = newGraphic

            if (next.item.isBreak) {
              // SCTE-35: sinaliza início do intervalo (saída da rede) — apenas se habilitado no canal
              if (state.scteEnabled) {
                streamService.injectScte35(channelId, true, next.item.maxDuration ?? undefined)
                state.scteLastEvent = { outOfNetwork: true, durationSecs: next.item.maxDuration ?? undefined, sentAt: Date.now() }
              }
              // BREAK: switch to fallback/input, keep timer running so maxDuration is respected
              streamService.clearConcatRun(channelId)
              console.log(`[playout] BREAK ch=${channelId} — comutando para fallback/entrada`)
              prisma.channel.findUnique({ where: { id: channelId }, include: { fallbackSource: true } })
                .then(async (ch) => {
                  if (ch?.fallbackType === 'INPUT_SOURCE' && ch.fallbackSource) {
                    activateFallbackSource(channelId, ch.fallbackSource, newGraphic).catch(() => {})
                  } else {
                    streamService.startStreamingFromFallback(channelId, ch?.fallbackType ?? 'BLACK').catch(() => {})
                  }
                })
                .catch(() => streamService.startStreamingFromFallback(channelId, 'BLACK').catch(() => {}))
            } else {
              // SCTE-35: retorno da programação (se veio de um BREAK) — apenas se habilitado no canal
              if (state.scteEnabled && state.currentItem?.isBreak) {
                streamService.injectScte35(channelId, false)
                state.scteLastEvent = { outOfNetwork: false, sentAt: Date.now() }
              }
              const concatEnd = streamService.getConcatRunEnd(channelId)
              const isInsideConcat = !isLoopRestart
                && concatEnd !== undefined && next.index <= concatEnd
                && !isUrlClip(next.item.sourceType, next.item.sourceUrl)

              if (isInsideConcat) {
                // FFmpeg já está gerenciando esta transição via concat — apenas atualiza estado
                console.log(`[playout] Auto-avanço ch=${channelId} → #${next.index} via concat (sem restart FFmpeg)`)
              } else if (isUrlClip(next.item.sourceType, next.item.sourceUrl) && next.item.sourceUrl) {
                streamService.clearConcatRun(channelId)
                const clipUrl = next.item.sourceUrl
                console.log(`[playout] Avançando para clip URL ch=${channelId} — resolvendo: ${clipUrl}`)
                resolveInputUrl({ type: 'YOUTUBE', url: clipUrl, device: null })
                  .then((url) => {
                    if (url) {
                      streamService.startStreamingFromUrlReencode(channelId, url, newGraphic).catch((err) => {
                        console.error(`[playout] Clip URL ch=${channelId} — falha ao reiniciar streaming:`, err)
                      })
                    } else {
                      console.warn(`[playout] Clip URL ch=${channelId} — yt-dlp não retornou URL (${clipUrl})`)
                    }
                  })
                  .catch((err) => console.error(`[playout] Clip URL ch=${channelId} — erro ao resolver URL:`, err))
              } else {
                // Fora do concat (ex: clip adicionado após o fim do run original) — inicia novo concat
                streamService.clearConcatRun(channelId)
                fetchConcatItems(state.playlistId!, next.index).then(({ items, endIndex }) => {
                  if (items.length > 0) {
                    streamService.startStreamingFromPlaylist(channelId, items, endIndex, newGraphic).catch(() => {})
                  } else {
                    streamService.restartStreaming(channelId, next.item.mediaId, next.item.cueIn, newGraphic).catch(() => {})
                  }
                }).catch(() => {
                  streamService.restartStreaming(channelId, next.item.mediaId, next.item.cueIn, newGraphic).catch(() => {})
                })
              }
            }
          } else {
            // Fim da playlist sem loop
            state.status = 'STOPPED'
            state.position = 0
            state.currentItem = null
            stopTimer(channelId)
            persistState(channelId, null, 0)
            await prisma.channel.update({ where: { id: channelId }, data: { status: 'STOPPED' } }).catch(() => {})
            broadcast(channelId, state)

            // Auto-switch para entrada de fallback configurada
            const channel = await prisma.channel.findUnique({
              where: { id: channelId },
              include: { fallbackSource: true },
            }).catch(() => null)

            if (channel?.fallbackType === 'INPUT_SOURCE' && channel.fallbackSource) {
              resolveGraphic(null, null, channelId).catch(() => null).then(fbGraphic => {
                activateFallbackSource(channelId, channel.fallbackSource!, fbGraphic).catch(() => {})
              })
            } else {
              streamService.startStreamingFromFallback(channelId, channel?.fallbackType ?? 'BLACK').catch(() => {})
            }
            return   // broadcast já foi feito acima
          }
        } finally {
          advancing.delete(channelId)
        }
      }

      broadcast(channelId, state)
    } catch (err) {
      console.error(`[playout] Erro no timer ch=${channelId}:`, err)
    }
  }, 1000)
  timers.set(channelId, interval)
}

export async function play(channelId: string, playlistId: string, startItemId?: string | null): Promise<PlayoutState> {
  console.log(`[playout] play ch=${channelId} playlist=${playlistId} startItem=${startItemId ?? 'primeiro'}`)
  stopTimer(channelId)
  // Para só o content process — o relay (conexão RTMP/SRT externa) permanece vivo.
  // Logo abaixo sempre chamamos uma das startStreamingFrom* (playlist/url/fallback),
  // que já garante o relay via ensureRelays() antes de reiniciar o content. Usar
  // stopAllStreaming() aqui era redundante e causava o relay reabrir com o
  // bitstream do content process anterior ainda "preso" no buffer UDP, gerando
  // corrupção H.264 ("non-existing PPS referenced", DTS fora de ordem) detectada
  // pelo player de terceiro que consome o RTMP de saída (2026-06-29).
  streamService.stopStreaming(channelId)
  const playlist = await prisma.playlist.findUnique({ where: { id: playlistId } })
  if (!playlist) throw new Error('Playlist não encontrada')

  // Descobre o índice do item selecionado (se informado)
  let fromIndex = 0
  if (startItemId) {
    const items = await prisma.playlistItem.findMany({
      where: { playlistId },
      orderBy: { order: 'asc' },
      select: { id: true },
    })
    const idx = items.findIndex(i => i.id === startItemId)
    if (idx >= 0) fromIndex = idx
  }

  const [firstReady, { totalDuration, count }, chSettings] = await Promise.all([
    findNextReadyFrom(playlistId, fromIndex),
    computePlaylistMeta(playlistId),
    prisma.channel.findUnique({ where: { id: channelId }, select: { scteEnabled: true } }),
  ])
  const startIndex = firstReady?.index ?? fromIndex
  const firstItem  = firstReady?.item ?? await loadItem(playlistId, fromIndex)
  const activeGraphic = await resolveGraphic(firstItem?.clipId ?? null, playlistId, channelId).catch(() => null)
  const state: PlayoutState = {
    channelId,
    status: 'PLAYING',
    playlistId,
    name: playlist.name,
    playlistIsAutoSave: (playlist as any).isAutoSave ?? false,
    loop: playlist.loop,
    currentIndex: startIndex,
    currentItem: firstItem,
    position: 0,
    totalElapsed: 0,
    totalPlaylistDuration: totalDuration,
    itemCount: count,
    updatedAt: Date.now(),
    activeGraphic,
    activeCut: null,
    scteEnabled: chSettings?.scteEnabled ?? false,
    scteLastEvent: null,
    scteInputLastEvent: null,
    audioLevels: null,
  }
  states.set(channelId, state)
  await prisma.channel.update({ where: { id: channelId }, data: { status: 'PLAYING' } }).catch(() => {})
  persistState(channelId, playlistId, startIndex)
  await startTickerFeeds(activeGraphic)
  startTimer(channelId)
  if (isUrlClip(firstItem?.sourceType, firstItem?.sourceUrl) && firstItem?.sourceUrl) {
    const clipUrl = firstItem.sourceUrl
    checkIsLive(clipUrl).then(({ isLive }) => {
      if (isLive === false) {
        console.warn(`[playout] AVISO ch=${channelId}: clip URL eh VOD — YouTube faz throttle, use canal LIVE.`)
      }
    }).catch(() => {})
    console.log(`[playout] Clip URL ch=${channelId} — resolvendo via yt-dlp: ${clipUrl}`)
    resolveInputUrl({ type: 'YOUTUBE', url: clipUrl, device: null })
      .then((url) => {
        if (url) {
          streamService.startStreamingFromUrlReencode(channelId, url, activeGraphic).catch((err) => {
            console.error(`[playout] Clip URL ch=${channelId} — falha ao iniciar streaming:`, err)
          })
        } else {
          console.warn(`[playout] Clip URL ch=${channelId} — yt-dlp não retornou URL (${clipUrl})`)
        }
      })
      .catch((err) => console.error(`[playout] Clip URL ch=${channelId} — erro ao resolver URL:`, err))
  } else {
    // Usa concat demuxer: carrega todos os clips FILE consecutivos num único FFmpeg
    fetchConcatItems(playlistId, startIndex).then(({ items, endIndex }) => {
      if (items.length > 0) {
        console.log(`[playout] play ch=${channelId} — concat com ${items.length} clips (idx ${startIndex}→${endIndex})`)
        streamService.startStreamingFromPlaylist(channelId, items, endIndex, activeGraphic).catch(() => {})
      } else {
        streamService.startStreaming(channelId, firstItem?.mediaId ?? null, firstItem?.cueIn ?? 0, activeGraphic).catch(() => {})
      }
    }).catch(() => {
      streamService.startStreaming(channelId, firstItem?.mediaId ?? null, firstItem?.cueIn ?? 0, activeGraphic).catch(() => {})
    })
  }
  broadcast(channelId, state)
  return state
}

export async function pause(channelId: string): Promise<PlayoutState> {
  const state = states.get(channelId)
  if (!state || state.status !== 'PLAYING') throw new Error('Canal não está em reprodução')
  stopTimer(channelId)
  state.status = 'PAUSED'
  state.updatedAt = Date.now()
  await prisma.channel.update({ where: { id: channelId }, data: { status: 'PAUSED' } }).catch(() => {})
  broadcast(channelId, state)
  return state
}

export async function resume(channelId: string): Promise<PlayoutState> {
  const state = states.get(channelId)
  if (!state || state.status !== 'PAUSED') throw new Error('Canal não está pausado')
  state.status = 'PLAYING'
  state.updatedAt = Date.now()
  await prisma.channel.update({ where: { id: channelId }, data: { status: 'PLAYING' } }).catch(() => {})
  startTimer(channelId)
  broadcast(channelId, state)
  return state
}

export async function stop(channelId: string): Promise<PlayoutState> {
  stopTimer(channelId)
  streamService.clearConcatRun(channelId)
  // Para só o content process — abaixo sempre comutamos para um fallback
  // (activateFallbackSource ou startStreamingFromFallback), que já garante o
  // relay vivo via ensureRelays(). Ver comentário em stopAllStreaming sobre por
  // que matar o relay aqui causava corrupção de bitstream H.264 (2026-06-29).
  streamService.stopStreaming(channelId)
  tickerService.stopAll()
  const state = states.get(channelId) ?? defaultState(channelId)
  state.status = 'STOPPED'
  state.position = 0
  state.currentItem = null
  state.updatedAt = Date.now()
  states.set(channelId, state)
  persistState(channelId, null, 0)
  await prisma.channel.update({ where: { id: channelId }, data: { status: 'STOPPED' } }).catch(() => {})

  // Comuta para o fallback configurado, que agora É a última fonte selecionada
  // via CUT — reconstrói activeCut a partir dele para o botão CUT correspondente
  // continuar "acesso" na UI (em vez de zerar e perder a indicação visual).
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: { fallbackSource: true },
  }).catch(() => null)
  state.activeCut = channel?.fallbackType === 'INPUT_SOURCE' && channel.fallbackSourceId
    ? { type: 'INPUT_SOURCE', sourceId: channel.fallbackSourceId }
    : { type: (channel?.fallbackType ?? 'BLACK') as 'BLACK' | 'COLORBARS' }
  broadcast(channelId, state)

  if (channel?.fallbackType === 'INPUT_SOURCE' && channel.fallbackSource) {
    resolveGraphic(null, null, channelId).catch(() => null).then(fallbackGraphic => {
      activateFallbackSource(channelId, channel!.fallbackSource!, fallbackGraphic).catch(() => {})
    })
  } else {
    streamService.startStreamingFromFallback(channelId, channel?.fallbackType ?? 'BLACK').catch(() => {})
  }

  return state
}

// Inicia streaming manual (next/prev/jump): limpa concat run e reinicia com nova lista
async function restartFromIndex(channelId: string, index: number, playlistId: string, graphic: GraphicConfig | null): Promise<void> {
  streamService.clearConcatRun(channelId)
  const item = await loadItem(playlistId, index)
  if (!item) return

  if (item.isBreak) {
    const s = states.get(channelId)
    if (s?.scteEnabled) {
      streamService.injectScte35(channelId, true, item.maxDuration ?? undefined)
      s.scteLastEvent = { outOfNetwork: true, durationSecs: item.maxDuration ?? undefined, sentAt: Date.now() }
    }
    console.log(`[playout] BREAK manual ch=${channelId} — comutando para fallback/entrada`)
    const ch = await prisma.channel.findUnique({ where: { id: channelId }, include: { fallbackSource: true } }).catch(() => null)
    if (ch?.fallbackType === 'INPUT_SOURCE' && ch.fallbackSource) {
      const url = await resolveInputUrl(ch.fallbackSource).catch(() => null)
      if (url) streamService.startStreamingFromUrl(channelId, url, graphic).catch(() => {})
    } else {
      streamService.startStreamingFromFallback(channelId, ch?.fallbackType ?? 'BLACK').catch(() => {})
    }
    return
  }

  if (isUrlClip(item.sourceType, item.sourceUrl) && item.sourceUrl) {
    await startStreamingForItem(channelId, item, graphic)
    return
  }
  const { items, endIndex } = await fetchConcatItems(playlistId, index)
  if (items.length > 0) {
    await streamService.startStreamingFromPlaylist(channelId, items, endIndex, graphic)
  } else {
    await startStreamingForItem(channelId, item, graphic)
  }
}

export async function nextClip(channelId: string): Promise<PlayoutState> {
  const state = states.get(channelId)
  if (!state || !state.playlistId) throw new Error('Nenhuma playlist ativa')
  const total = await countItems(state.playlistId)
  const nextIndex = state.currentIndex + 1
  if (nextIndex >= total) throw new Error('Já está no último clipe')
  state.currentIndex = nextIndex
  state.position = 0
  state.currentItem = await loadItem(state.playlistId, nextIndex)
  state.updatedAt = Date.now()
  persistState(channelId, state.playlistId, nextIndex)
  const g_next = await resolveGraphic(state.currentItem?.clipId ?? null, state.playlistId, channelId).catch(() => null)
  state.activeGraphic = g_next
  await restartFromIndex(channelId, nextIndex, state.playlistId, g_next)
  broadcast(channelId, state)
  return state
}

export async function prevClip(channelId: string): Promise<PlayoutState> {
  const state = states.get(channelId)
  if (!state || !state.playlistId) throw new Error('Nenhuma playlist ativa')
  const prevIndex = Math.max(0, state.currentIndex - 1)
  state.currentIndex = prevIndex
  state.position = 0
  state.currentItem = await loadItem(state.playlistId, prevIndex)
  state.updatedAt = Date.now()
  persistState(channelId, state.playlistId, prevIndex)
  const g_prev = await resolveGraphic(state.currentItem?.clipId ?? null, state.playlistId, channelId).catch(() => null)
  state.activeGraphic = g_prev
  await restartFromIndex(channelId, prevIndex, state.playlistId, g_prev)
  broadcast(channelId, state)
  return state
}

export async function jumpTo(channelId: string, itemIndex: number): Promise<PlayoutState> {
  const state = states.get(channelId)
  if (!state || !state.playlistId) throw new Error('Nenhuma playlist ativa')
  const total = await countItems(state.playlistId)
  if (itemIndex < 0 || itemIndex >= total) throw new Error('Índice inválido')
  state.currentIndex = itemIndex
  state.position = 0
  state.currentItem = await loadItem(state.playlistId, itemIndex)
  state.updatedAt = Date.now()
  persistState(channelId, state.playlistId, itemIndex)
  const g_jump = await resolveGraphic(state.currentItem?.clipId ?? null, state.playlistId, channelId).catch(() => null)
  state.activeGraphic = g_jump
  await restartFromIndex(channelId, itemIndex, state.playlistId, g_jump)
  broadcast(channelId, state)
  return state
}

// Corta imediatamente para uma fonte de entrada (interrompe playlist se ativa)
export async function cutToInput(channelId: string, sourceId: string): Promise<PlayoutState> {
  stopTimer(channelId)

  const source = await prisma.inputSource.findUnique({ where: { id: sourceId } })
  if (!source) throw new Error('Fonte de entrada não encontrada')

  const state = states.get(channelId) ?? defaultState(channelId)
  state.status = 'STOPPED'
  state.currentItem = null
  state.position = 0
  state.activeCut = { type: 'INPUT_SOURCE', sourceId }
  state.updatedAt = Date.now()
  states.set(channelId, state)

  persistState(channelId, null, 0)
  await prisma.channel.update({
    where: { id: channelId },
    data: { status: 'STOPPED', fallbackType: 'INPUT_SOURCE', fallbackSourceId: sourceId },
  }).catch(() => {})

  // Inicia streaming da entrada com gráfico ativo do canal (cascata de saídas)
  resolveGraphic(null, null, channelId).catch(() => null).then(cutGraphic => {
    activateFallbackSource(channelId, source, cutGraphic).catch(() => {})
  })

  broadcast(channelId, state)
  return state
}

// CUT imediato para BLACK ou COLORBARS — também grava como fallback configurado
// do canal (igual cutToInput), para que STOP/BREAK/fim de playlist comutem para
// o último sinal selecionado via CUT em vez de exigir configuração separada de FB.
export async function cutToFallbackType(channelId: string, type: 'BLACK' | 'COLORBARS'): Promise<void> {
  stopTimer(channelId)

  const state = states.get(channelId) ?? defaultState(channelId)
  state.status = 'STOPPED'
  state.currentItem = null
  state.position = 0
  state.activeCut = { type }
  state.updatedAt = Date.now()
  states.set(channelId, state)

  persistState(channelId, null, 0)
  await prisma.channel.update({
    where: { id: channelId },
    data: { fallbackType: type, fallbackSourceId: null },
  }).catch(() => {})

  broadcast(channelId, state)
  streamService.startStreamingFromFallback(channelId, type).catch(() => {})
}

// CUT para câmera (browser webcam via SRT local) — grava a InputSource WEBCAM
// como fallback do canal, mesmo padrão de cutToFallbackType/cutToInput.
export async function cutToCamera(channelId: string): Promise<PlayoutState> {
  const { getCameraInputUrl, isCameraActive } = await import('./camera.service')
  if (!isCameraActive(channelId)) throw new Error('Câmera não está ativa neste canal')

  stopTimer(channelId)
  const url = getCameraInputUrl(channelId)
  if (!url) throw new Error('URL da câmera não disponível')

  // Aceita tanto a entrada WEBCAM vinculada a este canal quanto uma global
  // ("Todos os canais", channelId: null) — confirmado em produção (2026-06-24)
  // que entradas globais não eram encontradas aqui, deixando o fallback do
  // canal sem ser persistido mesmo com o streaming iniciando corretamente.
  const webcamSource = await prisma.inputSource.findFirst({
    where: { type: 'WEBCAM', OR: [{ channelId }, { channelId: null }] },
    select: { id: true },
  }).catch(() => null)

  const state = states.get(channelId) ?? defaultState(channelId)
  state.status = 'STOPPED'
  state.currentItem = null
  state.position = 0
  if (webcamSource) state.activeCut = { type: 'INPUT_SOURCE', sourceId: webcamSource.id }
  state.updatedAt = Date.now()
  states.set(channelId, state)

  persistState(channelId, null, 0)
  if (webcamSource) {
    await prisma.channel.update({
      where: { id: channelId },
      data: { fallbackType: 'INPUT_SOURCE', fallbackSourceId: webcamSource.id },
    }).catch(() => {})
  }

  const cutGraphic = await resolveGraphic(null, null, channelId).catch(() => null)
  streamService.startStreamingFromUrl(channelId, url, cutGraphic).catch(() => {})

  broadcast(channelId, state)
  return state
}

// Reaplica a fonte atualmente "no ar" (CUT manual ou fallback configurado) em
// todos os outputs ativos do canal. Usado quando o canal está parado (sem
// playlist tocando) e o operador liga uma saída pelo toggle individual — sem
// isso, o output ficava marcado active=true no banco mas nenhum processo
// FFmpeg era de fato iniciado, e a transmissão só "pegava" depois de um PLAY.
export async function reapplyCurrentSource(channelId: string): Promise<void> {
  const state = states.get(channelId)
  const cut = state?.activeCut

  if (cut?.type === 'INPUT_SOURCE' && cut.sourceId) {
    const source = await prisma.inputSource.findUnique({ where: { id: cut.sourceId } })
    if (source) {
      const graphic = await resolveGraphic(null, null, channelId).catch(() => null)
      await activateFallbackSource(channelId, source, graphic)
      return
    }
  }
  if (cut?.type === 'BLACK' || cut?.type === 'COLORBARS') {
    await streamService.startStreamingFromFallback(channelId, cut.type)
    return
  }

  // Sem CUT manual ativo — usa o fallback configurado no canal (mesmo caminho do stop())
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: { fallbackSource: true },
  }).catch(() => null)
  if (channel?.fallbackType === 'INPUT_SOURCE' && channel.fallbackSource) {
    const graphic = await resolveGraphic(null, null, channelId).catch(() => null)
    await activateFallbackSource(channelId, channel.fallbackSource, graphic)
  } else {
    await streamService.startStreamingFromFallback(channelId, channel?.fallbackType ?? 'BLACK')
  }
}

// Chamado pelo camera.service quando a câmera INICIA — para o timer para não interferir.
export function pauseForCamera(channelId: string): void {
  stopTimer(channelId)
  console.log(`[playout] Câmera iniciada ch=${channelId} — timer pausado`)
}

// Chamado pelo camera.service quando a câmera PARA — retoma playout ou fallback.
export async function resumeAfterCamera(channelId: string): Promise<void> {
  const state = states.get(channelId)
  if (!state) return
  console.log(`[playout] Câmera encerrada ch=${channelId} — retomando playout`)
  if (state.status === 'PLAYING' && state.currentItem) {
    // Reinicia o timer E o streaming do clip atual
    startTimer(channelId)
    await startStreamingForItem(channelId, state.currentItem, state.activeGraphic)
  } else {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: { fallbackSource: true },
    }).catch(() => null)
    if (channel?.fallbackType === 'INPUT_SOURCE' && channel.fallbackSource) {
      resolveGraphic(null, null, channelId).catch(() => null).then(fbGraphic => {
        activateFallbackSource(channelId, channel!.fallbackSource!, fbGraphic).catch(() => {})
      })
    } else {
      streamService.startStreamingFromFallback(channelId, channel?.fallbackType ?? 'BLACK').catch(() => {})
    }
  }
}

// Chamado pelo stream.service quando FFmpeg morre inesperadamente.
// Força o avanço para o próximo clipe — "o show deve continuar".
export function handleStreamFailure(channelId: string): void {
  const state = states.get(channelId)
  if (!state || state.status !== 'PLAYING') return
  if (advancing.has(channelId)) return
  console.warn(`[playout] Falha de streaming ch=${channelId} — forçando avanço de clipe`)
  // Posição no fim do clipe atual → o próximo tick do timer dispara o avanço normal
  state.position = Math.max(state.position, state.currentItem?.duration ?? 0)
}

// Chamado quando uma fonte ao vivo (INPUT_SOURCE) falhou repetidamente e o stream
// desistiu de reconectar. Ativa o fallback de canal (BLACK/COLORBARS) para não deixar
// o operador sem sinal — o active-inputs service tentará reconectar em background.
export function handleInputSourceGaveUp(channelId: string): void {
  const state = states.get(channelId)
  if (!state) return
  // Só age se o canal ainda está em modo CUT para INPUT_SOURCE (nada mudou manualmente)
  if (state.activeCut?.type !== 'INPUT_SOURCE') return
  console.warn(`[playout] Fonte ao vivo desistiu ch=${channelId} — ativando fallback BLACK`)
  streamService.startStreamingFromFallback(channelId, 'BLACK').catch(() => {})
}

// Atualiza o flag de loop do item atual em memória (chamado após toggle no DB)
export function updateCurrentItemLoop(channelId: string, itemId: string, loop: boolean) {
  const state = states.get(channelId)
  if (state?.currentItem?.playlistItemId === itemId) {
    state.currentItem.loop = loop
  }
}

// Atualiza o loop da playlist ativa em memória (chamado após toggle no DB)
export function updatePlaylistLoop(channelId: string, loop: boolean) {
  const state = states.get(channelId)
  if (state) state.loop = loop
}

// Insere um item BREAK imediatamente após o item atual na playlist ativa
export async function insertBreak(channelId: string, afterItemId?: string | null): Promise<PlayoutState> {
  const state = states.get(channelId)
  if (!state || !state.playlistId) throw new Error('Nenhuma playlist ativa')

  let insertOrder: number
  const ref = afterItemId ? await prisma.playlistItem.findUnique({ where: { id: afterItemId } }) : null
  if (ref) {
    // Impede BREAK imediatamente após outro BREAK
    if (ref.isBreak) throw new Error('Não é possível inserir dois BREAKs consecutivos')
    insertOrder = ref.order + 1
  } else {
    // afterItemId não encontrado (stale/deletado) ou ausente → insere no final
    const last = await prisma.playlistItem.findFirst({
      where: { playlistId: state.playlistId },
      orderBy: { order: 'desc' },
    })
    if (last?.isBreak) throw new Error('Não é possível inserir dois BREAKs consecutivos')
    insertOrder = last ? last.order + 1 : 0
  }

  // Impede BREAK antes de outro BREAK (o item que ficaria logo após a nova posição)
  const nextItem = await prisma.playlistItem.findFirst({
    where: { playlistId: state.playlistId, order: { gte: insertOrder } },
    orderBy: { order: 'asc' },
  })
  if (nextItem?.isBreak) throw new Error('Não é possível inserir dois BREAKs consecutivos')

  await prisma.playlistItem.updateMany({
    where: { playlistId: state.playlistId, order: { gte: insertOrder } },
    data: { order: { increment: 1 } },
  })

  const sysSettings = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } })
  const defaultBreakDuration = sysSettings?.defaultBreakDuration ?? 300

  await prisma.playlistItem.create({
    data: { playlistId: state.playlistId, order: insertOrder, loop: false, breakNum: 0, isBreak: true, maxDuration: defaultBreakDuration },
  })

  const { totalDuration, count } = await computePlaylistMeta(state.playlistId)
  state.totalPlaylistDuration = totalDuration
  state.itemCount = count
  state.updatedAt = Date.now()
  broadcast(channelId, state)
  return state
}

// Insere um clipe imediatamente após o item atual na playlist ativa
export async function insertClip(channelId: string, clipId: string, afterItemId?: string | null): Promise<PlayoutState> {
  const state = states.get(channelId)
  if (!state || !state.playlistId) throw new Error('Nenhuma playlist ativa')

  const clip = await prisma.clip.findUnique({ where: { id: clipId }, include: { media: { select: { mimeType: true } } } })
  if (!clip) throw new Error('Clipe não encontrado')

  const refItem = afterItemId ? await prisma.playlistItem.findUnique({ where: { id: afterItemId } }) : null
  let insertOrder: number
  if (refItem) {
    insertOrder = refItem.order + 1
  } else {
    // afterItemId não encontrado (stale/deletado) ou ausente → insere no final
    const last = await prisma.playlistItem.findFirst({
      where: { playlistId: state.playlistId },
      orderBy: { order: 'desc' },
    })
    insertOrder = last ? last.order + 1 : 0
  }

  await prisma.playlistItem.updateMany({
    where: { playlistId: state.playlistId, order: { gte: insertOrder } },
    data: { order: { increment: 1 } },
  })

  // Aplica duração padrão conforme tipo do clipe (slide/imagem ou URL)
  const sysSettings = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } })
  let defaultMaxDuration: number | null = null
  const isUrlClipType = isUrlClip(clip.sourceType, clip.sourceUrl)
  const isImageClip   = !isUrlClipType && clip.media?.mimeType?.startsWith('image/')

  if (isImageClip && (sysSettings?.defaultSlideDuration ?? 0) > 0)
    defaultMaxDuration = sysSettings!.defaultSlideDuration
  else if (isUrlClipType && (sysSettings?.defaultUrlDuration ?? 0) > 0)
    defaultMaxDuration = sysSettings!.defaultUrlDuration

  await prisma.playlistItem.create({
    data: { playlistId: state.playlistId, clipId, order: insertOrder, loop: false, breakNum: 0,
            ...(defaultMaxDuration ? { maxDuration: defaultMaxDuration } : {}) },
  })

  const { totalDuration, count } = await computePlaylistMeta(state.playlistId)
  state.totalPlaylistDuration = totalDuration
  state.itemCount = count
  state.updatedAt = Date.now()
  broadcast(channelId, state)
  return state
}

// Remove um item da playlist ativa; se for o clipe atual, avança para o próximo
export async function removeItem(channelId: string, itemId: string): Promise<PlayoutState> {
  const state = states.get(channelId)
  if (!state || !state.playlistId) throw new Error('Nenhuma playlist ativa')

  const items = await prisma.playlistItem.findMany({
    where: { playlistId: state.playlistId },
    orderBy: { order: 'asc' },
  })

  const removeIdx = items.findIndex((i: { id: string }) => i.id === itemId)
  if (removeIdx === -1) throw new Error('Item não encontrado na playlist ativa')

  const isActive = state.status === 'PLAYING' || state.status === 'PAUSED'
  const isCurrentItem = removeIdx === state.currentIndex

  if (isCurrentItem && isActive && items.length === 1) {
    throw new Error('Não é possível remover o único clipe enquanto o canal está em reprodução')
  }

  const removedOrder = items[removeIdx].order

  await prisma.playlistItem.delete({ where: { id: itemId } })
  await prisma.playlistItem.updateMany({
    where: { playlistId: state.playlistId, order: { gt: removedOrder } },
    data: { order: { decrement: 1 } },
  })

  let newIndex = state.currentIndex
  if (removeIdx < state.currentIndex) {
    newIndex = state.currentIndex - 1
  } else if (isCurrentItem) {
    // items.length - 2 seria -1 se só havia 1 item; Math.max(0,...) evita índice negativo
    newIndex = Math.max(0, Math.min(state.currentIndex, items.length - 2))
  }

  state.currentIndex = newIndex

  if (isCurrentItem && isActive) {
    state.position = 0
    state.currentItem = await loadItem(state.playlistId, newIndex)
    persistState(channelId, state.playlistId, newIndex)
    const g_rem = await resolveGraphic(state.currentItem?.clipId ?? null, state.playlistId, channelId).catch(() => null)
    state.activeGraphic = g_rem
    await startStreamingForItem(channelId, state.currentItem, g_rem)
  }

  const { totalDuration, count } = await computePlaylistMeta(state.playlistId)
  state.totalPlaylistDuration = totalDuration
  state.itemCount = count
  state.updatedAt = Date.now()
  broadcast(channelId, state)
  return state
}

// Define fallback do canal — apenas grava a configuração, nunca comuta o sinal
// Para comutar imediatamente use cutToFallbackType ou cutToInput
export async function setFallback(
  channelId: string,
  fallbackType: 'BLACK' | 'COLORBARS' | 'INPUT_SOURCE',
  fallbackSourceId?: string | null,
): Promise<void> {
  await prisma.channel.update({
    where: { id: channelId },
    data: { fallbackType, fallbackSourceId: fallbackSourceId ?? null },
  })

  // Pré-resolve URL sempre que INPUT_SOURCE é configurado para que esteja
  // pronta quando o sistema ativar o fallback automaticamente (sem atraso yt-dlp)
  if (fallbackType === 'INPUT_SOURCE' && fallbackSourceId) {
    const source = await prisma.inputSource.findUnique({ where: { id: fallbackSourceId } })
    if (source) preFetchFallbackUrl(source)
  }
}

// Restaura estado dos canais que estavam em PLAYING ou PAUSED antes do restart
export async function initFromDb(): Promise<void> {
  const channels = await prisma.channel.findMany({
    where: { status: { in: ['PLAYING', 'PAUSED'] } },
    select: { id: true, status: true, activePlaylistId: true, playlistIndex: true, scteEnabled: true },
  })

  for (const ch of channels) {
    if (!ch.activePlaylistId) {
      // Estado inválido: limpa no DB
      await prisma.channel.update({ where: { id: ch.id }, data: { status: 'STOPPED' } }).catch(() => {})
      continue
    }

    const playlist = await prisma.playlist.findUnique({ where: { id: ch.activePlaylistId } })
    if (!playlist) {
      await prisma.channel.update({ where: { id: ch.id }, data: { status: 'STOPPED' } }).catch(() => {})
      continue
    }

    const [item, { totalDuration, count }] = await Promise.all([
      loadItem(ch.activePlaylistId, ch.playlistIndex),
      computePlaylistMeta(ch.activePlaylistId),
    ])
    const activeGraphic = ch.status === 'PLAYING'
      ? await resolveGraphic(item?.clipId ?? null, ch.activePlaylistId, ch.id).catch(() => null)
      : null
    const state: PlayoutState = {
      channelId: ch.id,
      status: ch.status as PlayoutStatus,
      playlistId: ch.activePlaylistId,
      name: playlist.name,
      playlistIsAutoSave: (playlist as any).isAutoSave ?? false,
      loop: playlist.loop,
      currentIndex: ch.playlistIndex,
      currentItem: item,
      position: 0,
      totalElapsed: 0,
      totalPlaylistDuration: totalDuration,
      itemCount: count,
      updatedAt: Date.now(),
      activeGraphic,
      activeCut: null,
      scteEnabled: ch.scteEnabled ?? false,
      scteLastEvent: null,
      scteInputLastEvent: null,
      audioLevels: null,
    }
    states.set(ch.id, state)

    if (ch.status === 'PLAYING') {
      startTimer(ch.id)
      // Garante o textfile do ticker ANTES de spawnar o FFmpeg — sua ausência
      // (ex.: /tmp limpo num rebuild) quebra o filter_complex inteiro (código 254 em loop)
      await startTickerFeeds(activeGraphic)
      // Trata URL clips corretamente — caso contrario, startStreaming(null) nao faz nada
      if (isUrlClip(item?.sourceType, item?.sourceUrl) && item?.sourceUrl) {
        const clipUrl = item.sourceUrl
        console.log(`[playout] Restauracao URL clip ch=${ch.id} — resolvendo: ${clipUrl}`)
        resolveInputUrl({ type: 'YOUTUBE', url: clipUrl, device: null })
          .then(async (url) => {
            if (url) {
              console.log(`[playout] Restauracao URL clip ch=${ch.id} — iniciando streaming: ${url.slice(0, 80)}`)
              streamService.startStreamingFromUrlReencode(ch.id, url, activeGraphic).catch(() => {})
            } else {
              console.warn(`[playout] Restauracao URL clip ch=${ch.id} — yt-dlp nao retornou URL, ativando fallback`)
              const chFb = await prisma.channel.findUnique({
                where: { id: ch.id },
                select: { fallbackType: true },
              }).catch(() => null)
              streamService.startStreamingFromFallback(ch.id, chFb?.fallbackType ?? 'BLACK').catch(() => {})
            }
          })
          .catch((err) => {
            console.error(`[playout] Restauracao URL clip ch=${ch.id} — erro:`, err)
            streamService.startStreamingFromFallback(ch.id, 'BLACK').catch(() => {})
          })
      } else {
        streamService.startStreaming(ch.id, item?.mediaId ?? null, item?.cueIn ?? 0, activeGraphic).catch(() => {})
      }
    }

    console.log(`[playout] Canal ${ch.id} restaurado: status=${ch.status} playlist=${playlist.name} idx=${ch.playlistIndex}`)
  }

  // Pré-resolve URLs de fallback de todos os canais (garante prontidão ao reiniciar o servidor)
  const fallbackChannels = await prisma.channel.findMany({
    where: { fallbackType: 'INPUT_SOURCE', fallbackSourceId: { not: null } },
    include: { fallbackSource: true },
  }).catch(() => [] as any[])
  for (const ch of fallbackChannels) {
    if (ch.fallbackSource) preFetchFallbackUrl(ch.fallbackSource)
  }
}

// ─── SCTE-35 input actions ────────────────────────────────────────────────────

/** Busca o índice do próximo item BREAK após currentIndex na playlist. */
async function findNextBreakIndex(playlistId: string, fromIndex: number): Promise<number | null> {
  const items = await prisma.playlistItem.findMany({
    where: { playlistId },
    orderBy: { order: 'asc' },
    select: { id: true, isBreak: true },
  })
  for (let i = fromIndex + 1; i < items.length; i++) {
    if (items[i].isBreak) return i
  }
  return null
}

/** Busca o próximo item não-BREAK após o currentIndex. */
async function findNextNonBreakIndex(playlistId: string, fromIndex: number): Promise<number | null> {
  const items = await prisma.playlistItem.findMany({
    where: { playlistId },
    orderBy: { order: 'asc' },
    select: { id: true },
  })
  for (let i = fromIndex + 1; i < items.length; i++) {
    const row = await prisma.playlistItem.findUnique({ where: { id: items[i].id }, select: { breakNum: true } })
    if (row && row.breakNum === 0) return i
  }
  return null
}

/**
 * Chamado pelo scte35-watcher quando splice_insert é detectado em uma InputSource monitorada.
 * Aplica a ação configurada nos canais que estão exibindo esta entrada ou em playlist.
 */
export async function handleScteInputEvent(
  sourceId: string,
  outOfNetwork: boolean,
  durationSecs: number | undefined,
  action: string,
): Promise<void> {
  // O canal dono desta InputSource pode não estar em `states` ainda --
  // initFromDb só carrega no boot os canais com status PLAYING/PAUSED
  // (getState() para um canal IDLE devolve um defaultState() descartável,
  // nunca inserido no Map). Sem isso, um canal parado nunca recebe o
  // badge de SCTE-35 mesmo com o watcher detectando cues normalmente --
  // bug confirmado em produção (2026-08-16).
  const source = await prisma.inputSource.findUnique({
    where: { id: sourceId },
    select: { channelId: true },
  }).catch(() => null)
  if (source?.channelId && !states.has(source.channelId)) {
    states.set(source.channelId, defaultState(source.channelId))
  }

  // Registra o evento em todos os canais que têm esta fonte como activeCut
  for (const [channelId, state] of states.entries()) {
    state.scteInputLastEvent = { sourceId, outOfNetwork, durationSecs, sentAt: Date.now() }
    broadcast(channelId, state)
  }

  if (action !== 'BREAK') return

  for (const [channelId, state] of states.entries()) {
    if (!state.playlistId) continue

    if (outOfNetwork) {
      // SCTE OUT: avança para o próximo BREAK do canal (inserção de conteúdo local)
      if (state.status !== 'PLAYING' || state.currentItem?.isBreak) continue
      const breakIdx = await findNextBreakIndex(state.playlistId, state.currentIndex).catch(() => null)
      if (breakIdx == null) continue

      // Atualiza maxDuration do BREAK com a duração sinalizada pelo cue SCTE-35
      if (durationSecs && durationSecs > 0) {
        const allItems = await prisma.playlistItem.findMany({
          where: { playlistId: state.playlistId },
          orderBy: { order: 'asc' },
          select: { id: true },
        }).catch(() => [] as { id: string }[])
        const breakItemId = allItems[breakIdx]?.id
        if (breakItemId) {
          await prisma.playlistItem.update({
            where: { id: breakItemId },
            data: { maxDuration: Math.round(durationSecs) },
          }).catch(() => {})
          console.log(`[playout/scte-in] ch=${channelId} — BREAK #${breakIdx} maxDuration → ${Math.round(durationSecs)}s`)
        }
      }

      console.log(`[playout/scte-in] ch=${channelId} — SCTE OUT (src=${sourceId}) → jumping to BREAK #${breakIdx}`)
      jumpTo(channelId, breakIdx).catch((err) =>
        console.error(`[playout/scte-in] Falha ao pular para BREAK: ${err.message}`)
      )
    } else {
      // SCTE IN: retorna à programação normal (sai do BREAK atual)
      if (!state.currentItem?.isBreak) continue
      const nextIdx = await findNextNonBreakIndex(state.playlistId, state.currentIndex).catch(() => null)
      if (nextIdx == null) continue
      console.log(`[playout/scte-in] ch=${channelId} — SCTE IN (src=${sourceId}) → resuming at #${nextIdx}`)
      jumpTo(channelId, nextIdx).catch((err) =>
        console.error(`[playout/scte-in] Falha ao retomar após BREAK: ${err.message}`)
      )
    }
  }
}
