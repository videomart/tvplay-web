import { prisma } from '../lib/prisma'

export type PlayoutStatus = 'IDLE' | 'PLAYING' | 'PAUSED' | 'STOPPED'

export interface PlayoutState {
  channelId: string
  status: PlayoutStatus
  playlistId: string | null
  programName: string | null
  currentIndex: number
  currentItem: CurrentItem | null
  position: number        // segundos decorridos no clip atual
  totalElapsed: number    // segundos decorridos na playlist
  updatedAt: number       // timestamp epoch ms
}

export interface CurrentItem {
  playlistItemId: string
  clipId: string
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

function defaultState(channelId: string): PlayoutState {
  return {
    channelId,
    status: 'IDLE',
    playlistId: null,
    programName: null,
    currentIndex: 0,
    currentItem: null,
    position: 0,
    totalElapsed: 0,
    updatedAt: Date.now(),
  }
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
          media: { select: { hlsPath: true, duration: true } },
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
      // Avança para o próximo clip
      const total = state.playlistId ? await countItems(state.playlistId) : 0
      const nextIndex = state.currentIndex + 1
      if (state.playlistId && nextIndex < total) {
        // Registra log do clip que terminou
        if (state.currentItem) {
          await prisma.log.create({
            data: {
              program: state.programName ?? 'Sem Programa',
              title: state.currentItem.title,
              duration: state.currentItem.duration,
              exhibited: true,
              startedAt: new Date(state.updatedAt - state.position * 1000),
              finishedAt: new Date(),
              client: state.currentItem.clientName,
            },
          }).catch(() => {})
        }
        state.currentIndex = nextIndex
        state.position = 0
        state.currentItem = await loadItem(state.playlistId, nextIndex)
      } else {
        // Fim da playlist
        state.status = 'STOPPED'
        state.position = 0
        stopTimer(channelId)
        await prisma.channel.update({ where: { id: channelId }, data: { status: 'STOPPED' } }).catch(() => {})
      }
    }

    broadcast(channelId, state)
  }, 1000)
  timers.set(channelId, interval)
}

export async function play(channelId: string, playlistId: string): Promise<PlayoutState> {
  stopTimer(channelId)
  const playlist = await prisma.playlist.findUnique({ where: { id: playlistId } })
  if (!playlist) throw new Error('Playlist não encontrada')

  const firstItem = await loadItem(playlistId, 0)
  const state: PlayoutState = {
    channelId,
    status: 'PLAYING',
    playlistId,
    programName: playlist.programName,
    currentIndex: 0,
    currentItem: firstItem,
    position: 0,
    totalElapsed: 0,
    updatedAt: Date.now(),
  }
  states.set(channelId, state)
  await prisma.channel.update({ where: { id: channelId }, data: { status: 'PLAYING' } }).catch(() => {})
  startTimer(channelId)
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
  const state = states.get(channelId) ?? defaultState(channelId)
  state.status = 'STOPPED'
  state.position = 0
  state.updatedAt = Date.now()
  states.set(channelId, state)
  await prisma.channel.update({ where: { id: channelId }, data: { status: 'STOPPED' } }).catch(() => {})
  broadcast(channelId, state)
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
  broadcast(channelId, state)
  return state
}
