import os from 'os'
import fs from 'fs'
import http from 'http'
import { prisma } from '../lib/prisma'

// ─── CPU — amostragem contínua em background ──────────────────────────────────
// %CPU precisa de duas leituras de os.cpus() com um intervalo entre elas; em vez
// de bloquear a requisição esperando esse intervalo, mantemos a última leitura
// e um snapshot anterior atualizados por um timer, e o endpoint só lê o cache.

let lastCpuTimes = os.cpus()
let lastCpuPercent = 0

function sampleCpu() {
  const current = os.cpus()
  let idleDiff = 0
  let totalDiff = 0
  for (let i = 0; i < current.length; i++) {
    const prev = lastCpuTimes[i].times
    const curr = current[i].times
    const prevTotal = prev.user + prev.nice + prev.sys + prev.idle + prev.irq
    const currTotal = curr.user + curr.nice + curr.sys + curr.idle + curr.irq
    totalDiff += currTotal - prevTotal
    idleDiff += curr.idle - prev.idle
  }
  lastCpuPercent = totalDiff > 0 ? Math.max(0, Math.min(100, 100 * (1 - idleDiff / totalDiff))) : 0
  lastCpuTimes = current
}

setInterval(sampleCpu, 3000)

function getCpuInfo() {
  return { percent: Math.round(lastCpuPercent * 10) / 10, cores: os.cpus().length, loadAvg: os.loadavg() }
}

function getMemoryInfo() {
  const total = os.totalmem()
  const free = os.freemem()
  return { totalBytes: total, freeBytes: free, usedBytes: total - free }
}

function getDiskInfo() {
  try {
    const stat = fs.statfsSync('/')
    const total = stat.blocks * stat.bsize
    const free = stat.bavail * stat.bsize
    return { totalBytes: total, freeBytes: free, usedBytes: total - free }
  } catch {
    return null
  }
}

async function getDatabaseSize(): Promise<number | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ size: bigint }>>`SELECT pg_database_size(current_database()) as size`
    return Number(rows[0]?.size ?? 0)
  } catch {
    return null
  }
}

async function getVideoStorageUsage(): Promise<number> {
  const sum = await prisma.mediaFile.aggregate({ _sum: { sizeBytes: true } })
  return Number(sum._sum.sizeBytes ?? 0)
}

// Docker Engine API via socket — só GET /system/df (leitura), nunca endpoints de escrita.
// Requer /var/run/docker.sock montado no container (ver docker-compose.yml).
// Timeout generoso (10s): /system/df recalcula uso de todas as imagens/containers/
// volumes do host — em produção, sob carga, medido em ~4.2s (confirmado 2026-10-17).
function dockerRequest(path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: '/var/run/docker.sock', path, method: 'GET', timeout: 10000 }, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(body)) } catch (e) { reject(e) }
        } else {
          reject(new Error(`Docker API HTTP ${res.statusCode}`))
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(new Error('Docker API timeout')) })
    req.end()
  })
}

// /system/df recalcula uso de disco de toda imagem/container/volume do host — caro
// o bastante (medido ~4.2s em produção sob carga) pra não vale a pena repetir a
// cada poll do dashboard (a cada poucos segundos). Cache simples de 30s.
type DockerUsage = {
  imagesBytes: number; containersBytes: number; volumesBytes: number; totalBytes: number
  imageCount: number; containerCount: number; volumeCount: number
}
let dockerCache: { data: DockerUsage | null; at: number } | null = null
const DOCKER_CACHE_TTL_MS = 30_000

async function getDockerUsage(): Promise<DockerUsage | null> {
  if (dockerCache && Date.now() - dockerCache.at < DOCKER_CACHE_TTL_MS) return dockerCache.data
  try {
    const df = await dockerRequest('/system/df')
    const imagesSize = (df.Images ?? []).reduce((s: number, i: any) => s + (i.Size ?? 0), 0)
    const containersSize = (df.Containers ?? []).reduce((s: number, c: any) => s + (c.SizeRw ?? 0), 0)
    const volumesSize = (df.Volumes ?? []).reduce((s: number, v: any) => s + (v.UsageData?.Size ?? 0), 0)
    const result: DockerUsage = {
      imagesBytes: imagesSize,
      containersBytes: containersSize,
      volumesBytes: volumesSize,
      totalBytes: imagesSize + containersSize + volumesSize,
      imageCount: (df.Images ?? []).length,
      containerCount: (df.Containers ?? []).length,
      volumeCount: (df.Volumes ?? []).length,
    }
    dockerCache = { data: result, at: Date.now() }
    return result
  } catch (err: any) {
    console.warn(`[system-metrics] Docker indisponível: ${err.message}`)
    dockerCache = { data: null, at: Date.now() }
    return null
  }
}

export async function getSystemMetrics() {
  const [database, videosUsedBytes, docker] = await Promise.all([
    getDatabaseSize(),
    getVideoStorageUsage(),
    getDockerUsage(),
  ])
  return {
    cpu: getCpuInfo(),
    memory: getMemoryInfo(),
    disk: getDiskInfo(),
    database: database != null ? { sizeBytes: database } : null,
    videos: { usedBytes: videosUsedBytes },
    docker,
  }
}
