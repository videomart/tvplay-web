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
const callbacks  = new Set<(sourceId: string, ev: ScteInputEvent) => void>()
const rawBuffers = new Map<string, Buffer>()   // buffer de alinhamento para feedRawBuffer

export function onScteInputEvent(cb: (sourceId: string, ev: ScteInputEvent) => void): void {
  callbacks.add(cb)
}

function emit(sourceId: string, ev: ScteInputEvent): void {
  lastEvent.set(sourceId, ev)
  for (const cb of callbacks) cb(sourceId, ev)
}

/**
 * Escaneia um buffer MPEG-TS em busca de pacotes SCTE-35 (table_id 0xFC).
 * Não filtra por PID fixo — o relay FFmpeg pode reatribuir o PID 0x0500 no output.
 * PUSI=1 obrigatório; verifica table_id=0xFC e splice_command_type=0x05.
 */
export function scanTsBuffer(buf: Buffer): ScteInputEvent | null {
  let i = 0
  while (i + TS_PACKET_SIZE <= buf.length) {
    if (buf[i] !== SYNC_BYTE) { i++; continue }

    const pusi               = (buf[i + 1] & 0x40) !== 0
    const adaptCtrl          = (buf[i + 3] & 0x30) >> 4
    const hasAdaptation      = adaptCtrl === 3 || adaptCtrl === 2
    const hasPayload         = adaptCtrl === 3 || adaptCtrl === 1

    if (!hasPayload || !pusi) { i += TS_PACKET_SIZE; continue }

    const adaptLen  = hasAdaptation ? (buf[i + 4] + 1) : 0
    const payload   = i + 4 + adaptLen        // offset do início do payload no buffer
    const pf        = buf[payload]             // pointer_field
    const section   = payload + 1 + pf        // offset do início da seção PSI

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
  let buf = rawBuffers.get(sourceId) ?? Buffer.alloc(0)
  buf = Buffer.concat([buf, chunk])
  const aligned = Math.floor(buf.length / TS_PACKET_SIZE) * TS_PACKET_SIZE
  if (aligned === 0) { rawBuffers.set(sourceId, buf); return }
  const ev = scanTsBuffer(buf.slice(0, aligned))
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
}

export function getLastEvent(sourceId: string): ScteInputEvent | null {
  return lastEvent.get(sourceId) ?? null
}
