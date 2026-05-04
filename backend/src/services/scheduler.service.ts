import { prisma } from '../lib/prisma'
import * as playoutService from './playout.service'

let schedulerTimer: ReturnType<typeof setInterval> | null = null

function todayUtcMidnight(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
}

function currentHHMM(): string {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

async function checkSchedule() {
  const hhmm = currentHHMM()
  const today = todayUtcMidnight()

  const playlists = await prisma.playlist.findMany({
    where: {
      autoStart: true,
      startTime: hhmm,
      date: today,
      channelId: { not: null },
    },
    select: { id: true, channelId: true, programName: true },
  }).catch(() => [])

  for (const pl of playlists) {
    const channelId = pl.channelId as string
    const state = playoutService.getState(channelId)
    if (state.status === 'PLAYING' || state.status === 'PAUSED') continue

    console.log(`[scheduler] Auto-iniciando "${pl.programName}" (canal ${channelId}) às ${hhmm}`)
    playoutService.play(channelId, pl.id).catch((e: Error) =>
      console.error(`[scheduler] Falha ao iniciar "${pl.programName}": ${e.message}`)
    )
  }
}

export function startScheduler() {
  if (schedulerTimer) return
  // Roda a cada minuto exato (sincroniza com o início do próximo minuto)
  const now = new Date()
  const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds()
  setTimeout(() => {
    checkSchedule()
    schedulerTimer = setInterval(checkSchedule, 60_000)
  }, msUntilNextMinute)
  console.log(`[scheduler] Iniciado — primeiro tick em ${Math.round(msUntilNextMinute / 1000)}s`)
}
