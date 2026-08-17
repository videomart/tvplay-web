/**
 * SCTE-35 input watcher — detecta splice_insert em streams recebidos.
 *
 * Dois modos:
 *   1. Pipe (feedRawBuffer): ativo quando active-inputs usa tee muxer.
 *      FFmpeg escreve TS bruto (todos os PIDs) no stdout; Node.js alimenta
 *      feedRawBuffer() com cada chunk. Latência ≈ 0. Preferido.
 *   2. File (startWatcher): fallback legado — monitora seg*.ts via fs.watch.
 *      Requer -copy_unknown -map 0 no FFmpeg. Latência ~1 segmento (2 s).
 *
 * PID do SCTE-35: NÃO é fixo. Diferentes fontes usam PIDs diferentes (ex.:
 * o próprio injector deste repo usa 0x0200; um TVPlay SE+/Delphi via SDK
 * Medialooks pode escolher outro; o hls-scte35-server/TSDuck splicemonitor
 * também não fixam PID — detectam table_id=0xFC em qualquer PID). Hardcodar
 * um PID (era 0x0500, herdado da config de teste original) faz o watcher
 * ignorar silenciosamente cues legítimos vindos em qualquer outro PID — bug
 * confirmado como causa de "cues gerados não reconhecidos do outro lado".
 * `scanTsBuffer` varre todos os PIDs; `knownSctePids` (por sourceId) lembra
 * qual PID já carregou SCTE-35 nesta sessão, só para lidar com o caso PUSI=0
 * do remux duplo (ver comentário em scanTsBuffer).
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

// PID(s) que já carregaram um splice_insert válido (PUSI=1) nesta sessão --
// usado só para o workaround de PUSI=0 no remux duplo (não limita a detecção
// inicial, que escaneia qualquer PID com PUSI=1).
const knownSctePids = new Map<string, Set<number>>()

interface DiagState { pidsDone: boolean; sctePidsSeen: Set<number>; totalBytes: number; logCount: number }
const diagState  = new Map<string, DiagState>()

export function onScteInputEvent(cb: (sourceId: string, ev: ScteInputEvent) => void): void {
  callbacks.add(cb)
}

function emit(sourceId: string, ev: ScteInputEvent): void {
  lastEvent.set(sourceId, ev)
  for (const cb of callbacks) cb(sourceId, ev)
}

/**
 * Escaneia um buffer MPEG-TS em busca de pacotes SCTE-35 (table_id 0xFC),
 * em QUALQUER PID — não assume um PID fixo, já que diferentes encoders
 * (TVPlay SE+/Delphi, este próprio injector, hls-scte35-server) escolhem
 * PIDs diferentes para o SCTE-35.
 *
 * PUSI=1 obrigatório, exceto para um PID já confirmado (`knownPids`) como
 * portador de SCTE-35 nesta sessão: o duplo remux do pipeline (-copy_unknown
 * em dois hops) pode zerar o bit PUSI desse PID privado, mas preserva o
 * pointer_field do payload — daí a mesma fórmula de seção se aplicar mesmo
 * sem PUSI, uma vez que o PID já foi identificado por um pacote com PUSI=1.
 * `knownPids`, quando fornecido, é atualizado in-place ao encontrar um novo
 * PID válido.
 */
export function scanTsBuffer(buf: Buffer, knownPids?: Set<number>): ScteInputEvent | null {
  let i = 0
  while (i + TS_PACKET_SIZE <= buf.length) {
    if (buf[i] !== SYNC_BYTE) { i++; continue }

    const pusi               = (buf[i + 1] & 0x40) !== 0
    const pid                = ((buf[i + 1] & 0x1F) << 8) | buf[i + 2]
    const adaptCtrl          = (buf[i + 3] & 0x30) >> 4
    const hasAdaptation      = adaptCtrl === 3 || adaptCtrl === 2
    // adaptCtrl=00 é reservado/inválido pela spec, mas o muxer mpegts do FFmpeg
    // o produz ao reempacotar PIDs privados (-copy_unknown) — trata-se igual
    // a 01 (payload a partir do byte 4, sem adaptation field).
    const hasPayload         = adaptCtrl !== 2

    if (!hasPayload) { i += TS_PACKET_SIZE; continue }
    if (pid === 0x1FFF) { i += TS_PACKET_SIZE; continue } // null packet, nunca carrega SI

    const adaptLen  = hasAdaptation ? (buf[i + 4] + 1) : 0
    const payload   = i + 4 + adaptLen        // offset do início do payload no buffer

    let section: number
    if (pusi || knownPids?.has(pid)) {
      // pointer_field aponta o início da seção PSI dentro do payload (0 no
      // caso comum de a seção começar logo no primeiro byte do payload).
      const pf = buf[payload]
      section  = payload + 1 + pf
    } else {
      i += TS_PACKET_SIZE; continue
    }

    if (section + 18 >= buf.length) { i += TS_PACKET_SIZE; continue }
    if (buf[section] !== 0xFC) { i += TS_PACKET_SIZE; continue } // table_id

    // Verifica splice_command_type = 0x05 (splice_insert)
    // header (3) + body: protocol_version(1)+pts_adj(5)+cw_index(1)+tier+cmdlen(3) = 10 bytes → cmd_type em +13
    const cmdTypeOff = section + 3 + 10
    if (cmdTypeOff >= buf.length || buf[cmdTypeOff] !== 0x05) { i += TS_PACKET_SIZE; continue }

    // Pacote válido de SCTE-35 confirmado neste PID -- registra para tolerar
    // PUSI=0 em pacotes futuros do mesmo PID (remux duplo).
    knownPids?.add(pid)

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
    diagState.set(sourceId, { pidsDone: false, sctePidsSeen: new Set(), totalBytes: 0, logCount: 0 })
  }
  let buf = existing ?? Buffer.alloc(0)
  buf = Buffer.concat([buf, chunk])
  const aligned = Math.floor(buf.length / TS_PACKET_SIZE) * TS_PACKET_SIZE
  if (aligned === 0) { rawBuffers.set(sourceId, buf); return }
  const slice = buf.slice(0, aligned)

  // Diagnóstico: lista todos os PIDs vistos uma vez, e loga qualquer pacote
  // com table_id=0xFC (SCTE-35) em qualquer PID -- não assume PID fixo.
  const ds = diagState.get(sourceId) ?? { pidsDone: false, sctePidsSeen: new Set(), totalBytes: 0, logCount: 0 }
  ds.totalBytes += slice.length
  if (!ds.pidsDone && ds.totalBytes >= 100 * TS_PACKET_SIZE) {
    ds.pidsDone = true
    const pids = new Set<number>()
    for (let i = 0; i + TS_PACKET_SIZE <= slice.length; i += TS_PACKET_SIZE) {
      if (slice[i] !== SYNC_BYTE) continue
      pids.add(((slice[i + 1] & 0x1F) << 8) | slice[i + 2])
    }
    console.log(`[scte35-watcher/${sourceId}] PIDs no pipe: ${[...pids].map(p => '0x' + p.toString(16).padStart(4, '0')).join(', ')}`)
  }
  const knownPids = knownSctePids.get(sourceId) ?? new Set<number>()
  knownSctePids.set(sourceId, knownPids)
  const sizeBefore = knownPids.size

  const ev = scanTsBuffer(slice, knownPids)
  rawBuffers.set(sourceId, buf.slice(aligned))

  if (knownPids.size > sizeBefore) {
    for (const pid of knownPids) {
      if (!ds.sctePidsSeen.has(pid)) {
        ds.sctePidsSeen.add(pid)
        console.log(`[scte35-watcher/${sourceId}] SCTE-35 (table_id=0xFC) detectado no PID 0x${pid.toString(16).padStart(4, '0')}`)
      }
    }
  }
  diagState.set(sourceId, ds)

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
        const ev  = scanTsBuffer(buf, new Set())
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
  knownSctePids.delete(sourceId)
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
  lastEvent.delete(sourceId)
  rawBuffers.delete(sourceId)
  diagState.delete(sourceId)
  knownSctePids.delete(sourceId)
}

export function getLastEvent(sourceId: string): ScteInputEvent | null {
  return lastEvent.get(sourceId) ?? null
}
