import { spawn, ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import { config } from '../config'

interface PreviewSession {
  proc:      ChildProcess
  outputDir: string
  sourceId:  string
  timer:     ReturnType<typeof setTimeout>
}

const sessions  = new Map<string, PreviewSession>()
const failures  = new Map<string, number>()  // sourceId → exit code
const PREVIEW_BASE = '/tmp/tvplay-previews'
const TTL_MS = 5 * 60 * 1000   // auto-cleanup após 5 min sem atividade

function cleanup(sourceId: string) {
  const s = sessions.get(sourceId)
  if (!s) return
  try { s.proc.kill('SIGTERM') } catch {}
  try { fs.rmSync(s.outputDir, { recursive: true, force: true }) } catch {}
  sessions.delete(sourceId)
  failures.delete(sourceId)
  console.log(`[preview/${sourceId}] Sessão encerrada`)
}

function resetTimer(session: PreviewSession) {
  clearTimeout(session.timer)
  session.timer = setTimeout(() => cleanup(session.sourceId), TTL_MS)
}

function addUrlParams(url: string, params: string[]): string {
  if (!params.length) return url
  return url + (url.includes('?') ? '&' : '?') + params.join('&')
}

function prepareSrtUrl(url: string): string {
  const params: string[] = []
  if (!url.includes('timeout=')) params.push('timeout=15000000')
  if (!url.includes('mode='))    params.push('mode=caller')
  return addUrlParams(url, params)
}

function prepareUdpUrl(url: string): string {
  const params: string[] = []
  if (!url.includes('timeout='))  params.push('timeout=5000000')
  if (!url.includes('pkt_size=')) params.push('pkt_size=1316')
  return addUrlParams(url, params)
}

export function startPreview(sourceId: string, inputUrl: string): string {
  if (sessions.has(sourceId)) cleanup(sourceId)
  failures.delete(sourceId)

  const outputDir = path.join(PREVIEW_BASE, sourceId)
  fs.mkdirSync(outputDir, { recursive: true })

  const hlsPath = path.join(outputDir, 'index.m3u8')

  const lowerUrl = inputUrl.toLowerCase()
  const isSrt  = lowerUrl.startsWith('srt://')
  const isUdp  = lowerUrl.startsWith('udp://')
  const isRtmp = lowerUrl.startsWith('rtmp://')
  const isRtsp = lowerUrl.startsWith('rtsp://')
  // HLS source (YouTube live, IP HLS): stream copy — sem transcodar, só remux
  const isHlsSrc = lowerUrl.includes('googlevideo.com') || /\.m3u8/.test(lowerUrl)

  const resolvedUrl = isSrt ? prepareSrtUrl(inputUrl)
                    : isUdp ? prepareUdpUrl(inputUrl)
                    : inputUrl

  const codecArgs = isHlsSrc
    ? ['-c', 'copy']
    : ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-c:a', 'aac', '-ar', '44100']

  const args = [
    '-hide_banner', '-loglevel', 'warning',
    ...(isSrt  ? ['-rw_timeout', '15000000'] : []),
    ...(isUdp  ? ['-timeout',    '5000000']  : []),
    // RTMP: reconnect automático se a fonte cair
    ...(isRtmp ? ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5'] : []),
    // RTSP: força TCP (mais estável que UDP) e define timeout
    ...(isRtsp ? ['-rtsp_transport', 'tcp', '-stimeout', '10000000'] : []),
    '-i', resolvedUrl,
    ...codecArgs,
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_list_size', '4',
    '-hls_flags', 'delete_segments+append_list',
    '-hls_segment_filename', path.join(outputDir, 'seg%03d.ts'),
    hlsPath,
  ]

  const proc = spawn(config.ffmpeg.path, args, { stdio: ['ignore', 'pipe', 'pipe'] })

  const session: PreviewSession = {
    proc,
    outputDir,
    sourceId,
    timer: setTimeout(() => cleanup(sourceId), TTL_MS),
  }
  sessions.set(sourceId, session)

  let stderr = ''
  proc.stderr?.on('data', (d: Buffer) => {
    const msg = d.toString().trim()
    if (msg) { console.log(`[preview/${sourceId}] ${msg}`); stderr += msg + '\n' }
  })

  proc.on('exit', (code) => {
    if (code !== null && code !== 0 && code !== 255) {
      failures.set(sourceId, code)
      console.warn(`[preview/${sourceId}] FFmpeg saiu com código ${code}. Stderr: ${stderr.slice(-300)}`)
    }
    if (code !== null) sessions.delete(sourceId)
  })

  console.log(`[preview/${sourceId}] Iniciando preview de ${resolvedUrl}`)
  return hlsPath
}

export function stopPreview(sourceId: string) {
  cleanup(sourceId)
}

export function touchPreview(sourceId: string) {
  const s = sessions.get(sourceId)
  if (s) resetTimer(s)
}

export function getPreviewDir(sourceId: string): string | null {
  return sessions.has(sourceId) ? path.join(PREVIEW_BASE, sourceId) : null
}

export function isPreviewRunning(sourceId: string): boolean {
  return sessions.has(sourceId)
}

// Retorna true se o FFmpeg encerrou com erro (código não-zero, não SIGTERM)
export function hasPreviewFailed(sourceId: string): boolean {
  return failures.has(sourceId)
}
