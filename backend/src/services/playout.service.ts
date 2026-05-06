import { execFile } from 'child_process'
import { promisify } from 'util'
import { prisma } from '../lib/prisma'
import * as streamService from './stream.service'
import type { GraphicConfig } from './stream.service'

const execFileAsync = promisify(execFile)

// Resolve a URL real de uma fonte de entrada (YouTube via yt-dlp; outros direto)
async function resolveInputUrl(src: { type: string; url: string | null; device: string | null }): Promise<string | null> {
  const raw = src.url ?? src.device ?? null
  if (!raw) return null
  if (src.type !== 'YOUTUBE') return raw
  // YouTube: resolve via yt-dlp com android client (mais confiável para lives)
  const base = ['--no-playlist', '-g', '--no-warnings', '--socket-timeout', '15']
  const fmt  = 'best[protocol=m3u8_native]/best[height<=720]/best'
  for (const extra of [['--extractor-args', 'youtube:player_client=android'], []]) {
    try {
      const { stdout } = await execFileAsync('yt-dlp', [...base, '-f', fmt, ...extra, raw], { timeout: 35000 })
      const url = stdout.trim().split('\n')[0]
      if (url) return url
    } catch { /* tenta próximo */ }
  }
  return null
}

export type PlayoutStatus = 'IDLE' | 'PLAYING' | 'PAUSED' | 'STOPPED'

export interface ActiveGraphic {
  logoUrl?: string | null
  logoPosition?: string | null
  showClock?: boolean
  lowerText?: string | null
}

export interface PlayoutState {
  channelId: string
  status: PlayoutStatus
  playlistId: string | null
  name: string | null
  currentIndex: number
  currentItem: CurrentItem | null
  position: number              // segundos decorridos no clip atual
  totalElapsed: number          // segundos decorridos na playlist
  totalPlaylistDuration: number // soma das durações de todos os itens
  itemCount: number             // total de itens na playlist
  updatedAt: number             // timestamp epoch ms
  activeGraphic: ActiveGraphic | null
}

export interface CurrentItem {
  playlistItemId: string
  clipId: string
  mediaId: string | null
  code: string
  title: string
  modality: string
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
}

// Clients WebSocket por canal
type WSClient = { send(data: string): void; readyState: number }
const wsClients = new Map<string, Set<WSClient>>()

// Estado em memória por canal
const states = new Map<string, PlayoutState>()
const timers = new Map<string, ReturnType<typeof setInterval>>()

async function computePlaylistMeta(playlistId: string): Promise<{ totalDuration: number; count: number }> {
  const items = await prisma.playlistItem.findMany({
    where: { playlistId },
    select: {
      overrideCueIn: true,
      overrideCueOut: true,
      clip: { select: { cueIn: true, cueOut: true, duration: true, media: { select: { duration: true } } } },
    },
  })
  const totalDuration = (items as any[]).reduce((sum: number, item) => {
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
    currentIndex: 0,
    currentItem: null,
    position: 0,
    totalElapsed: 0,
    totalPlaylistDuration: 0,
    itemCount: 0,
    updatedAt: Date.now(),
    activeGraphic: null,
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
  const msg = JSON.stringify({ event: 'state', data: state })
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg)
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
  const clip = item.clip
  const cueIn = item.overrideCueIn ?? clip.cueIn
  const cueOut = item.overrideCueOut ?? clip.cueOut ?? clip.media?.duration ?? null
  const duration = cueOut ? cueOut - cueIn : (clip.media?.duration ?? clip.duration ?? 30)
  return {
    playlistItemId: item.id,
    clipId: clip.id,
    mediaId: clip.media ? (clip.media as any).id ?? null : null,
    code: clip.code,
    title: clip.title,
    modality: clip.modality,
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
  }
}

async function countItems(playlistId: string): Promise<number> {
  return prisma.playlistItem.count({ where: { playlistId } })
}

// Retorna o primeiro item COM hlsPath a partir de fromIndex (pula clipes sem arquivo)
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
    const clip = item.clip
    if (!clip.media?.hlsPath) continue // sem arquivo — pula
    const cueIn  = item.overrideCueIn  ?? clip.cueIn
    const cueOut = item.overrideCueOut ?? clip.cueOut ?? clip.media.duration ?? null
    const duration = cueOut ? cueOut - cueIn : (clip.media.duration ?? clip.duration ?? 30)
    return {
      index: i,
      item: {
        playlistItemId: item.id,
        clipId: clip.id,
        mediaId: (clip.media as any).id,
        code: clip.code,
        title: clip.title,
        modality: clip.modality,
        clientName: clip.client?.name ?? null,
        typeName: clip.type?.name ?? null,
        typeCode: clip.type?.code ?? null,
        typeBg: clip.type?.fontBackColor ?? null,
        typeColor: clip.type?.fontColor ?? null,
        duration,
        cueIn,
        cueOut,
        hlsPath: clip.media.hlsPath,
        order: item.order,
        breakNum: item.breakNum,
        loop: item.loop,
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
  if (clipId) {
    const clip = await prisma.clip.findUnique({
      where: { id: clipId },
      select: { graphic: { select: { logoUrl: true, logoPosition: true, showClock: true, lowerText: true, active: true } } },
    })
    if (clip?.graphic?.active) {
      console.log(`[playout] resolveGraphic ch=${channelId} → CLIP logo=${clip.graphic.logoUrl} clk=${clip.graphic.showClock}`)
      return clip.graphic
    }
  }
  if (playlistId) {
    const pl = await prisma.playlist.findUnique({
      where: { id: playlistId },
      select: { graphic: { select: { logoUrl: true, logoPosition: true, showClock: true, lowerText: true, active: true } } },
    })
    if (pl?.graphic?.active) {
      console.log(`[playout] resolveGraphic ch=${channelId} → PLAYLIST logo=${pl.graphic.logoUrl} clk=${pl.graphic.showClock}`)
      return pl.graphic
    }
  }
  const output = await prisma.streamOutput.findFirst({
    where: { channelId, active: true, graphicId: { not: null } },
    select: { graphic: { select: { logoUrl: true, logoPosition: true, showClock: true, lowerText: true, active: true } } },
  })
  const result = (output?.graphic?.active ? output.graphic : null) ?? null
  console.log(`[playout] resolveGraphic ch=${channelId} → ${result ? `SAIDA logo=${result.logoUrl} clk=${result.showClock}` : 'NENHUM GRAFICO'}`)
  return result
}

function stopTimer(channelId: string) {
  const t = timers.get(channelId)
  if (t) { clearInterval(t); timers.delete(channelId) }
}

function startTimer(channelId: string) {
  stopTimer(channelId)
  const interval = setInterval(async () => {
    const state = states.get(channelId)
    if (!state || state.status !== 'PLAYING') return

    state.position += 1
    state.totalElapsed += 1
    state.updatedAt = Date.now()

    const dur = state.currentItem?.duration ?? Infinity
    if (state.position >= dur) {
      // Loop: reinicia o clip atual
      if (state.currentItem?.loop) {
        state.position = 0
        broadcast(channelId, state)
        return
      }
      // Avança para o próximo clip com arquivo pronto
      const total = state.playlistId ? await countItems(state.playlistId) : 0
      const nextIndex = state.currentIndex + 1
      const next = state.playlistId && nextIndex < total
        ? await findNextReadyFrom(state.playlistId, nextIndex)
        : null
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
        resolveGraphic(next.item.clipId, state.playlistId, channelId).then((g) => {
          state.activeGraphic = g
          return streamService.restartStreaming(channelId, next.item.mediaId, next.item.cueIn, g)
        }).catch(() => {})
      } else {
        // Fim da playlist
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
          resolveInputUrl(channel.fallbackSource).then((url) => {
            if (url) streamService.startStreamingFromUrl(channelId, url).catch(() => {})
          }).catch(() => {})
        } else {
          streamService.stopStreaming(channelId)
        }
        return   // broadcast já foi feito acima
      }
    }

    broadcast(channelId, state)
  }, 1000)
  timers.set(channelId, interval)
}

export async function play(channelId: string, playlistId: string): Promise<PlayoutState> {
  console.log(`[playout] play ch=${channelId} playlist=${playlistId}`)
  stopTimer(channelId)
  const playlist = await prisma.playlist.findUnique({ where: { id: playlistId } })
  if (!playlist) throw new Error('Playlist não encontrada')

  const [firstReady, { totalDuration, count }] = await Promise.all([
    findNextReadyFrom(playlistId, 0),
    computePlaylistMeta(playlistId),
  ])
  const startIndex = firstReady?.index ?? 0
  const firstItem  = firstReady?.item ?? await loadItem(playlistId, 0)
  const activeGraphic = await resolveGraphic(firstItem?.clipId ?? null, playlistId, channelId).catch(() => null)
  const state: PlayoutState = {
    channelId,
    status: 'PLAYING',
    playlistId,
    name: playlist.name,
    currentIndex: startIndex,
    currentItem: firstItem,
    position: 0,
    totalElapsed: 0,
    totalPlaylistDuration: totalDuration,
    itemCount: count,
    updatedAt: Date.now(),
    activeGraphic,
  }
  states.set(channelId, state)
  await prisma.channel.update({ where: { id: channelId }, data: { status: 'PLAYING' } }).catch(() => {})
  persistState(channelId, playlistId, startIndex)
  startTimer(channelId)
  streamService.startStreaming(channelId, firstItem?.mediaId ?? null, firstItem?.cueIn ?? 0, activeGraphic).catch(() => {})
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
  streamService.stopStreaming(channelId)
  const state = states.get(channelId) ?? defaultState(channelId)
  state.status = 'STOPPED'
  state.position = 0
  state.currentItem = null
  state.updatedAt = Date.now()
  states.set(channelId, state)
  persistState(channelId, null, 0)
  await prisma.channel.update({ where: { id: channelId }, data: { status: 'STOPPED' } }).catch(() => {})
  broadcast(channelId, state)

  // Comuta para fallback configurado (passthrough)
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: { fallbackSource: true },
  }).catch(() => null)
  if (channel?.fallbackType === 'INPUT_SOURCE' && channel.fallbackSource) {
    resolveInputUrl(channel.fallbackSource).then((url) => {
      if (url) streamService.startStreamingFromUrl(channelId, url).catch(() => {})
    }).catch(() => {})
  }

  return state
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
  streamService.restartStreaming(channelId, state.currentItem?.mediaId ?? null, state.currentItem?.cueIn ?? 0, g_next).catch(() => {})
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
  streamService.restartStreaming(channelId, state.currentItem?.mediaId ?? null, state.currentItem?.cueIn ?? 0, g_prev).catch(() => {})
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
  streamService.restartStreaming(channelId, state.currentItem?.mediaId ?? null, state.currentItem?.cueIn ?? 0, g_jump).catch(() => {})
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
  state.updatedAt = Date.now()
  states.set(channelId, state)

  persistState(channelId, null, 0)
  await prisma.channel.update({
    where: { id: channelId },
    data: { status: 'STOPPED', fallbackType: 'INPUT_SOURCE', fallbackSourceId: sourceId },
  }).catch(() => {})

  // Inicia streaming da entrada (assíncrono para não bloquear a resposta)
  resolveInputUrl(source).then((url) => {
    if (url) streamService.startStreamingFromUrl(channelId, url).catch(() => {})
  }).catch(() => {})

  broadcast(channelId, state)
  return state
}

// Atualiza o flag de loop do item atual em memória (chamado após toggle no DB)
export function updateCurrentItemLoop(channelId: string, itemId: string, loop: boolean) {
  const state = states.get(channelId)
  if (state?.currentItem?.playlistItemId === itemId) {
    state.currentItem.loop = loop
  }
}

// Insere um clipe imediatamente após o item atual na playlist ativa
export async function insertClip(channelId: string, clipId: string): Promise<PlayoutState> {
  const state = states.get(channelId)
  if (!state || !state.playlistId) throw new Error('Nenhuma playlist ativa')

  const clip = await prisma.clip.findUnique({ where: { id: clipId } })
  if (!clip) throw new Error('Clipe não encontrado')

  const insertOrder = state.currentIndex + 1

  await prisma.playlistItem.updateMany({
    where: { playlistId: state.playlistId, order: { gte: insertOrder } },
    data: { order: { increment: 1 } },
  })

  await prisma.playlistItem.create({
    data: { playlistId: state.playlistId, clipId, order: insertOrder, loop: false, breakNum: 0 },
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
    newIndex = Math.min(state.currentIndex, items.length - 2)
  }

  state.currentIndex = newIndex

  if (isCurrentItem && isActive) {
    state.position = 0
    state.currentItem = await loadItem(state.playlistId, newIndex)
    persistState(channelId, state.playlistId, newIndex)
    const g_rem = await resolveGraphic(state.currentItem?.clipId ?? null, state.playlistId, channelId).catch(() => null)
    state.activeGraphic = g_rem
    streamService.restartStreaming(channelId, state.currentItem?.mediaId ?? null, state.currentItem?.cueIn ?? 0, g_rem).catch(() => {})
  }

  const { totalDuration, count } = await computePlaylistMeta(state.playlistId)
  state.totalPlaylistDuration = totalDuration
  state.itemCount = count
  state.updatedAt = Date.now()
  broadcast(channelId, state)
  return state
}

// Define fallback do canal — aplica imediatamente se o canal estiver idle/stopped
export async function setFallback(
  channelId: string,
  fallbackType: 'BLACK' | 'COLORBARS' | 'INPUT_SOURCE',
  fallbackSourceId?: string | null,
): Promise<void> {
  await prisma.channel.update({
    where: { id: channelId },
    data: { fallbackType, fallbackSourceId: fallbackSourceId ?? null },
  })

  const state = states.get(channelId) ?? defaultState(channelId)
  if (state.status === 'PLAYING' || state.status === 'PAUSED') return // apenas salva para depois

  if (fallbackType === 'INPUT_SOURCE' && fallbackSourceId) {
    const source = await prisma.inputSource.findUnique({ where: { id: fallbackSourceId } })
    if (source) {
      resolveInputUrl(source).then((url) => {
        if (url) streamService.startStreamingFromUrl(channelId, url).catch(() => {})
      }).catch(() => {})
    }
  } else {
    streamService.stopStreaming(channelId)
  }
}

// Restaura estado dos canais que estavam em PLAYING ou PAUSED antes do restart
export async function initFromDb(): Promise<void> {
  const channels = await prisma.channel.findMany({
    where: { status: { in: ['PLAYING', 'PAUSED'] } },
    select: { id: true, status: true, activePlaylistId: true, playlistIndex: true },
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
      currentIndex: ch.playlistIndex,
      currentItem: item,
      position: 0,
      totalElapsed: 0,
      totalPlaylistDuration: totalDuration,
      itemCount: count,
      updatedAt: Date.now(),
      activeGraphic,
    }
    states.set(ch.id, state)

    if (ch.status === 'PLAYING') {
      startTimer(ch.id)
      streamService.startStreaming(ch.id, item?.mediaId ?? null, item?.cueIn ?? 0, activeGraphic).catch(() => {})
    }

    console.log(`[playout] Canal ${ch.id} restaurado: status=${ch.status} playlist=${playlist.name} idx=${ch.playlistIndex}`)
  }
}
