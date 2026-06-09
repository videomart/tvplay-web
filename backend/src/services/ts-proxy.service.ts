/**
 * UDP proxy MPEG-TS com injeção de pacotes SCTE-35.
 *
 * Arquitetura por canal:
 *   content-process → UDP:proxyPort → [proxy] → UDP:relayPort
 *
 * O proxy é transparente: repassa todos os pacotes 1:1 para o relay.
 * Quando injectPackets() é chamado, os bytes são enfileirados e enviados
 * no próximo flush, intercalados entre os pacotes de conteúdo.
 *
 * O proxy intercepta PMTs por table_id=0x02 (sem depender de descoberta via PAT),
 * inserindo imediatamente uma entrada para PID 0x0500 (stream_type=0x86 CUEI).
 * Isso garante que o relay FFmpeg veja o SCTE-35 no PMT desde o primeiro pacote,
 * sem janela de temporização.
 */

import dgram from 'dgram'

const TS_PACKET_SIZE     = 188
const SCTE35_PID         = 0x0500
const SCTE35_STREAM_TYPE = 0x86  // CUEI — digital program insertion

// CRC-32/MPEG-2 duplicado de scte35.service (evita dep. circular)
function crc32mpeg(buf: Buffer): number {
  let crc = 0xFFFFFFFF
  for (const byte of buf) {
    crc ^= byte << 24
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x80000000) ? ((crc << 1) ^ 0x04C11DB7) : (crc << 1)
      crc >>>= 0
    }
  }
  return crc >>> 0
}

// ─── PMT helper ──────────────────────────────────────────────────────────────

/**
 * Detecta PMTs por table_id=0x02 em qualquer PID (PUSI=1).
 * Insere entrada SCTE-35 (PID 0x0500) se ausente e incrementa version_number
 * para forçar re-parse pelo demuxer do relay FFmpeg.
 */
function rewritePmtInMessage(msg: Buffer): Buffer | null {
  let changed = false
  const out = Buffer.from(msg)

  for (let i = 0; i + TS_PACKET_SIZE <= out.length; i += TS_PACKET_SIZE) {
    if (out[i] !== 0x47) continue
    const pid = ((out[i + 1] & 0x1F) << 8) | out[i + 2]
    if (pid === 0x0000) continue                 // pula PAT (table_id 0x00)
    if ((out[i + 1] & 0x40) === 0) continue      // precisa de PUSI

    const adaptCtrl = (out[i + 3] & 0x30) >> 4
    const adaptLen  = (adaptCtrl === 3 || adaptCtrl === 2) ? out[i + 4] + 1 : 0
    const pf        = out[i + 4 + adaptLen]
    const s         = i + 4 + adaptLen + 1 + pf  // início da seção

    if (s + 12 >= out.length || out[s] !== 0x02) continue  // table_id = PMT

    const sectionLength     = ((out[s + 1] & 0x0F) << 8) | out[s + 2]
    const programInfoLength = ((out[s + 10] & 0x0F) << 8) | out[s + 11]
    const streamLoopStart   = s + 12 + programInfoLength
    const crcPos            = s + 3 + sectionLength - 4

    // Verifica se PID 0x0500 já está no loop de streams
    let already = false
    let j = streamLoopStart
    while (j + 5 <= crcPos) {
      const esPid     = ((out[j + 1] & 0x1F) << 8) | out[j + 2]
      const esInfoLen = ((out[j + 3] & 0x03) << 8) | out[j + 4]
      if (esPid === SCTE35_PID) { already = true; break }
      j += 5 + esInfoLen
    }
    if (already) continue

    // Verifica espaço sobrando no pacote TS de 188 bytes para +5 bytes
    const sectionTotalEnd = s + 3 + sectionLength
    if (i + TS_PACKET_SIZE - sectionTotalEnd < 5) continue

    // Incrementa version_number (bits 5:1 de s+5) → força re-parse pelo demuxer
    const vb = out[s + 5]
    out[s + 5] = (vb & 0xC1) | ((((vb >> 1) & 0x1F) + 1) & 0x1F) << 1

    // Desloca os 4 bytes do CRC-32 cinco posições para a frente
    out.copyWithin(crcPos + 5, crcPos, crcPos + 4)

    // Escreve entrada SCTE-35: stream_type(1) + PID(2) + ES_info_length(2)
    out[crcPos + 0] = SCTE35_STREAM_TYPE
    out[crcPos + 1] = 0xE0 | ((SCTE35_PID >> 8) & 0x1F)
    out[crcPos + 2] = SCTE35_PID & 0xFF
    out[crcPos + 3] = 0xF0
    out[crcPos + 4] = 0x00

    // Atualiza section_length (+5)
    const newLen = sectionLength + 5
    out[s + 1] = (out[s + 1] & 0xF0) | ((newLen >> 8) & 0x0F)
    out[s + 2] = newLen & 0xFF

    // Recalcula CRC-32 (cobre de table_id até fim da nova entrada SCTE-35)
    const newCrc = crc32mpeg(out.slice(s, crcPos + 5))
    out.writeUInt32BE(newCrc, crcPos + 5)

    changed = true
  }

  return changed ? out : null
}

// ─── Proxy ───────────────────────────────────────────────────────────────────

interface ProxyEntry {
  socket:    dgram.Socket
  relayPort: number
  pending:   Buffer[]
  pmtLogged: boolean  // loga apenas na primeira modificação de PMT
}

const proxies        = new Map<string, ProxyEntry>()
// Pacotes SCTE-35 pendentes sobrevivem ao restart do proxy (ex: transição para BREAK)
const savedPending   = new Map<string, Buffer[]>()

let nextProxyPort = 14100

export function allocProxyPort(channelId: string): number {
  const existing = proxies.get(channelId)
  if (existing) return (existing.socket.address() as any).port
  return nextProxyPort++
}

/**
 * Inicia o proxy para um canal.
 * @param channelId  identificador do canal
 * @param listenPort porta onde o content process envia (proxyPort)
 * @param relayPort  porta onde o relay process escuta
 */
export function startProxy(channelId: string, listenPort: number, relayPort: number): void {
  stopProxy(channelId)

  const socket = dgram.createSocket('udp4')
  // Restaura pacotes SCTE-35 que ficaram pendentes no proxy anterior (ex: transição para BREAK)
  const restored = savedPending.get(channelId) ?? []
  savedPending.delete(channelId)
  const entry: ProxyEntry = { socket, relayPort, pending: restored, pmtLogged: false }
  proxies.set(channelId, entry)

  socket.on('message', (msg) => {
    // 1. Modifica PMT para incluir PID 0x0500 (detecta por table_id=0x02, sem PAT)
    let outMsg: Buffer = msg
    const rewritten = rewritePmtInMessage(msg)
    if (rewritten !== null) {
      outMsg = rewritten
      if (!entry.pmtLogged) {
        console.log(`[ts-proxy/${channelId}] PMT modificado: PID 0x0500 (SCTE-35) adicionado ao stream`)
        entry.pmtLogged = true
      }
    }

    // 2. Flush de pacotes SCTE-35 pendentes ANTES do próximo pacote de conteúdo
    const toInject = entry.pending.splice(0)
    for (const buf of toInject) {
      socket.send(buf, 0, buf.length, relayPort, '127.0.0.1')
    }

    // 3. Repassa mensagem (com PMT modificado se aplicável) ao relay
    socket.send(outMsg, 0, outMsg.length, relayPort, '127.0.0.1')
  })

  socket.on('error', (err) => {
    console.warn(`[ts-proxy/${channelId}] Erro: ${err.message}`)
    stopProxy(channelId)
  })

  socket.bind(listenPort, '0.0.0.0', () => {
    console.log(`[ts-proxy/${channelId}] Proxy TS ativo: 0.0.0.0:${listenPort} → 127.0.0.1:${relayPort}`)
  })
}

/**
 * Enfileira pacotes SCTE-35 para serem enviados na próxima oportunidade.
 * Os bytes devem estar pré-formatados em múltiplos de 188 bytes.
 */
export function injectPackets(channelId: string, tsPackets: Buffer): void {
  const entry = proxies.get(channelId)
  if (!entry) {
    console.warn(`[ts-proxy/${channelId}] injectPackets: proxy não ativo`)
    return
  }

  for (let i = 0; i < tsPackets.length; i += TS_PACKET_SIZE) {
    entry.pending.push(tsPackets.slice(i, i + TS_PACKET_SIZE))
  }

  console.log(`[ts-proxy/${channelId}] SCTE-35: ${tsPackets.length / TS_PACKET_SIZE} pkt(s) enfileirado(s)`)
}

export function stopProxy(channelId: string): void {
  const entry = proxies.get(channelId)
  if (!entry) return
  // Preserva pacotes pendentes para o próximo proxy com a mesma chave
  if (entry.pending.length > 0) savedPending.set(channelId, [...entry.pending])
  try { entry.socket.close() } catch {}
  proxies.delete(channelId)
  console.log(`[ts-proxy/${channelId}] Proxy encerrado`)
}

export function stopAllProxies(): void {
  for (const [id] of proxies) stopProxy(id)
  savedPending.clear()
}

export function isProxyActive(channelId: string): boolean {
  return proxies.has(channelId)
}
