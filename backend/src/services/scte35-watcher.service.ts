/**
 * SCTE-35 input watcher — detecta splice_insert em streams recebidos.
 *
 * Dois modos:
 *   1. Pipe (feedRawBuffer): ativo quando active-inputs usa tee muxer.
 *      FFmpeg escreve TS bruto (todos os PIDs) no stdout; Node.js alimenta
 *      feedRawBuffer() com cada chunk. Latência ≈ 0. Preferido.
 *   2. File (startWatcher): fallback legado — monitora seg*.ts via fs.watch.
 *      Requer -copy_unknown -map 0 no FFmpeg. Latência ~1 segmento (2 s).
 */

import fs from 'fs'
import path from 'path'
import dgram from 'dgram'

const TS_PACKET_SIZE = 188
const SYNC_BYTE = 0x47

export interface ScteInputEvent {
  outOfNetwork: boolean
  durationSecs?: number
  eventId?: number
  detectedAt: number
}

const lastEvent  = new Map<string, ScteInputEvent>()
const watchers   = new Map<string, fs.FSWatcher>()
const udpSockets = new Map<string, dgram.Socket>()
const callbacks  = new Set<(sourceId: string, ev: ScteInputEvent) => void>()
const rawBuffers = new Map<string, Buffer>()   // buffer de alinhamento para feedRawBuffer

interface DiagState { pidsDone: boolean; pid0500Seen: boolean; totalBytes: number; pid0500LogCount: number }
const diagState  = new Map<string, DiagState>()

/** Diagnóstico temporário: descreve um pacote TS no índice `i` que tem PID 0x0500. */
function describePid0500Packet(buf: Buffer, i: number): string {
  const pusi          = (buf[i + 1] & 0x40) !== 0
  const adaptCtrl     = (buf[i + 3] & 0x30) >> 4
  const hasAdaptation = adaptCtrl === 3 || adaptCtrl === 2
  const hasPayload    = adaptCtrl !== 2
  let info = `pusi=${pusi} adaptCtrl=${adaptCtrl}`
  if (pusi && hasPayload) {
    const adaptLen = hasAdaptation ? (buf[i + 4] + 1) : 0
    const payload  = i + 4 + adaptLen
    const pf       = buf[payload]
    const section  = payload + 1 + pf
    if (section < buf.length) {
      const tableId = buf[section]
      info += ` table_id=0x${tableId.toString(16)}`
      if (tableId === 0xFC && section + 13 < buf.length) {
        const cmdType = buf[section + 3 + 10]
        info += ` cmd_type=0x${cmdType.toString(16)}`
      }
    }
  }
  return info
}

export function onScteInputEvent(cb: (sourceId: string, ev: ScteInputEvent) => void): void {
  callbacks.add(cb)
}

function emit(sourceId: string, ev: ScteInputEvent): void {
  lastEvent.set(sourceId, ev)
  for (const cb of callbacks) cb(sourceId, ev)
}

/**
 * Escaneia um buffer MPEG-TS em busca de pacotes SCTE-35 (table_id 0xFC).
 * PUSI=1 obrigatório, exceto para PID 0x0500 (o duplo remux do pipeline pode
 * zerar o bit PUSI desse PID privado, mas preserva o pointer_field do payload).
 * Verifica table_id=0xFC e splice_command_type=0x05.
 */
export function scanTsBuffer(buf: Buffer): ScteInputEvent | null {
  let i = 0
  while (i + TS_PACKET_SIZE <= buf.length) {
    if (buf[i] !== SYNC_BYTE) { i++; continue }

    const pusi               = (buf[i + 1] & 0x40) !== 0
    const pid                = ((buf[i + 1] & 0x1F) << 8) | buf[i + 2]
    const adaptCtrl          = (buf[i + 3] & 0x30) >> 4
    const hasAdaptation      = adaptCtrl === 3 || adaptCtrl === 2
    // adaptCtrl=00 é reservado/inválido pela spec, mas o muxer mpegts do FFmpeg
    // o produz ao reempacotar PIDs privados (-copy_unknown, ex.: PID 0x0500) —
    // trata-se igual a 01 (payload a partir do byte 4, sem adaptation field).
    const hasPayload         = adaptCtrl !== 2

    if (!hasPayload) { i += TS_PACKET_SIZE; continue }

    const adaptLen  = hasAdaptation ? (buf[i + 4] + 1) : 0
    const payload   = i + 4 + adaptLen        // offset do início do payload no buffer

    let section: number
    if (pusi || pid === 0x0500) {
      // O remux duplo (relay M3 + active-input M1, ambos -copy_unknown) zera o
      // bit PUSI deste PID privado, mas preserva os bytes do payload — que
      // continuam começando pelo pointer_field original (0x00) seguido do
      // table_id. Por isso aplica-se a mesma fórmula independente do PUSI
      // quando o PID é 0x0500 (única PID que transporta SCTE-35 aqui).
      const pf = buf[payload]                 // pointer_field
      section  = payload + 1 + pf             // offset do início da seção PSI
    } else {
      i += TS_PACKET_SIZE; continue
    }

    if (section + 18 >= buf.length) { i += TS_PACKET_SIZE; continue }
    if (buf[section] !== 0xFC) { i += TS_PACKET_SIZE; continue } // table_id

    // Verifica splice_command_type = 0x05 (splice_insert)
    // header (3) + body: protocol_version(1)+pts_adj(5)+cw_index(1)+tier+cmdlen(3) = 10 bytes → cmd_type em +13
    const cmdTypeOff = section + 3 + 10
    if (cmdTypeOff >= buf.length || buf[cmdTypeOff] !== 0x05) { i += TS_PACKET_SIZE; continue }

    // Parse splice_insert: eventId(4) + cancel+reserved(1) + flags(1) ...
    const cmd = cmdTypeOff + 1
    if (cmd + 6 > buf.length) { i += TS_PACKET_SIZE; continue }

    const eventId       = buf.readUInt32BE(cmd)
    const cancelFlag    = (buf[cmd + 4] & 0x80) !== 0
    if (cancelFlag) { i += TS_PACKET_SIZE; continue }

    const flags2        = buf[cmd + 5]
    const outOfNetwork  = (flags2 & 0x80) !== 0
    const hasDuration   = (flags2 & 0x20) !== 0

    let durationSecs: number | undefined
    if (hasDuration && outOfNetwork && cmd + 11 <= buf.length) {
      const high = (buf[cmd + 6] & 0x01)
      const low  = buf.readUInt32BE(cmd + 7)
      durationSecs = (high * 0x100000000 + low) / 90000
    }

    return { outOfNetwork, durationSecs, eventId, detectedAt: Date.now() }
  }
  return null
}

/**
 * Alimenta o scanner com um chunk bruto de MPEG-TS vindo do stdout do FFmpeg.
 * Acumula bytes até completar pacotes de 188 bytes, depois escaneia e dispara
 * callbacks se um splice_insert for encontrado.
 * Usado quando active-inputs configura tee muxer com pipe:1.
 */
export function feedRawBuffer(sourceId: string, chunk: Buffer): void {
  const existing = rawBuffers.get(sourceId)
  if (!existing) {
    console.log(`[scte35-watcher/${sourceId}] pipe ativo — recebendo TS bruto (primeiro chunk: ${chunk.length} bytes)`)
    diagState.set(sourceId, { pidsDone: false, pid0500Seen: false, totalBytes: 0, pid0500LogCount: 0 })
  }
  let buf = existing ?? Buffer.alloc(0)
  buf = Buffer.concat([buf, chunk])
  const aligned = Math.floor(buf.length / TS_PACKET_SIZE) * TS_PACKET_SIZE
  if (aligned === 0) { rawBuffers.set(sourceId, buf); return }
  const slice = buf.slice(0, aligned)

  // Diagnóstico: lista de PIDs e detecção de PID 0x0500
  const ds = diagState.get(sourceId) ?? { pidsDone: false, pid0500Seen: false, totalBytes: 0, pid0500LogCount: 0 }
  ds.totalBytes += slice.length
  let found0500 = false
  if (!ds.pidsDone && ds.totalBytes >= 100 * TS_PACKET_SIZE) {
    ds.pidsDone = true
    const pids = new Set<number>()
    for (let i = 0; i + TS_PACKET_SIZE <= slice.length; i += TS_PACKET_SIZE) {
      if (slice[i] !== SYNC_BYTE) continue
      const pid = ((slice[i + 1] & 0x1F) << 8) | slice[i + 2]
      pids.add(pid)
      if (pid === 0x0500) {
        found0500 = true
        if (ds.pid0500LogCount < 8) {
          ds.pid0500LogCount++
          console.log(`[scte35-watcher/${sourceId}] pacote PID 0x0500: ${describePid0500Packet(slice, i)}`)
        }
      }
    }
    console.log(`[scte35-watcher/${sourceId}] PIDs no pipe: ${[...pids].map(p => '0x' + p.toString(16).padStart(4, '0')).join(', ')}`)
  } else {
    for (let i = 0; i + TS_PACKET_SIZE <= slice.length; i += TS_PACKET_SIZE) {
      if (slice[i] !== SYNC_BYTE) continue
      if ((((slice[i + 1] & 0x1F) << 8) | slice[i + 2]) === 0x0500) {
        found0500 = true
        if (ds.pid0500LogCount < 8) {
          ds.pid0500LogCount++
          console.log(`[scte35-watcher/${sourceId}] pacote PID 0x0500: ${describePid0500Packet(slice, i)}`)
        }
      }
    }
  }
  if (found0500 && !ds.pid0500Seen) {
    ds.pid0500Seen = true
    console.log(`[scte35-watcher/${sourceId}] PID 0x0500 (SCTE-35) detectado no pipe`)
  }

  const ev = scanTsBuffer(slice)
  rawBuffers.set(sourceId, buf.slice(aligned))
  if (!ev) return
  const last = lastEvent.get(sourceId)
  if (last && last.eventId === ev.eventId && last.outOfNetwork === ev.outOfNetwork) return
  console.log(`[scte35-watcher/${sourceId}] splice_insert out_of_network=${ev.outOfNetwork} eventId=${ev.eventId}${ev.durationSecs ? ` dur=${ev.durationSecs.toFixed(1)}s` : ''}`)
  emit(sourceId, ev)
}

/** Inicia monitoramento do diretório HLS de uma entrada. */
export function startWatcher(sourceId: string, hlsDir: string): void {
  if (watchers.has(sourceId)) return
  if (!fs.existsSync(hlsDir)) return

  const seen = new Set<string>()

  const watcher = fs.watch(hlsDir, (event, filename) => {
    if (!filename?.endsWith('.ts')) return
    if (seen.has(filename)) return
    seen.add(filename)

    const filePath = path.join(hlsDir, filename)
    // Pequeno delay para garantir que o arquivo foi totalmente escrito pelo FFmpeg
    setTimeout(() => {
      try {
        if (!fs.existsSync(filePath)) { seen.delete(filename); return }
        const buf = fs.readFileSync(filePath)
        const ev  = scanTsBuffer(buf)
        if (ev) {
          const last = lastEvent.get(sourceId)
          // Evita disparar evento duplicado com o mesmo eventId consecutivamente
          if (!last || last.eventId !== ev.eventId || last.outOfNetwork !== ev.outOfNetwork) {
            console.log(`[scte35-watcher/${sourceId}] splice_insert out_of_network=${ev.outOfNetwork} eventId=${ev.eventId}${ev.durationSecs ? ` dur=${ev.durationSecs.toFixed(1)}s` : ''}`)
            emit(sourceId, ev)
          }
        }
      } catch {}
      seen.delete(filename)
    }, 150)
  })

  watcher.on('error', () => stopWatcher(sourceId))
  watchers.set(sourceId, watcher)
  console.log(`[scte35-watcher/${sourceId}] Monitorando ${hlsDir}`)
}

export function stopWatcher(sourceId: string): void {
  const w = watchers.get(sourceId)
  if (w) { w.close(); watchers.delete(sourceId) }
  lastEvent.delete(sourceId)
  rawBuffers.delete(sourceId)
  diagState.delete(sourceId)
}

/**
 * Inicia monitoramento via UDP local (relay dedicado de active-inputs faz
 * `tee` do TS bruto, incluindo bin_data, para 127.0.0.1:port).
 */
export function startUdpWatcher(sourceId: string, port: number): void {
  if (udpSockets.has(sourceId)) return
  const sock = dgram.createSocket('udp4')
  sock.on('message', (msg) => feedRawBuffer(sourceId, msg))
  sock.on('error', (err) => {
    console.warn(`[scte35-watcher/${sourceId}] erro UDP: ${err.message}`)
  })
  sock.bind(port, '127.0.0.1', () => {
    console.log(`[scte35-watcher/${sourceId}] ouvindo UDP local 127.0.0.1:${port}`)
  })
  udpSockets.set(sourceId, sock)
}

export function stopUdpWatcher(sourceId: string): void {
  const sock = udpSockets.get(sourceId)
  if (sock) { try { sock.close() } catch {}; udpSockets.delete(sourceId) }
}

export function getLastEvent(sourceId: string): ScteInputEvent | null {
  return lastEvent.get(sourceId) ?? null
}
