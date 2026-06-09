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
 * O proxy também intercepta pacotes PMT (Program Map Table) e insere
 * uma entrada para o PID 0x0500 (stream_type=0x86 CUEI / SCTE-35).
 * Isso garante que o relay FFmpeg (SRT/RTMP) inclua o PID no output,
 * permitindo detecção downstream mesmo após re-mux pelo FFmpeg.
 */

import dgram from 'dgram'

const TS_PACKET_SIZE   = 188
const SCTE35_PID       = 0x0500
const SCTE35_STREAM_TYPE = 0x86  // CUEI — digital program insertion

// ─── CRC-32/MPEG-2 (duplicado de scte35.service para evitar dep. circular) ───
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

// ─── PMT helpers ─────────────────────────────────────────────────────────────

/**
 * Percorre os pacotes TS no buffer procurando um PAT (PID 0x0000) e retorna
 * o PID do PMT do primeiro programa não-NIT encontrado. Retorna -1 se não achou.
 */
function findPmtPidInMessage(msg: Buffer): number {
  for (let i = 0; i + TS_PACKET_SIZE <= msg.length; i += TS_PACKET_SIZE) {
    if (msg[i] !== 0x47) continue
    const pid = ((msg[i + 1] & 0x1F) << 8) | msg[i + 2]
    if (pid !== 0x0000) continue
    if ((msg[i + 1] & 0x40) === 0) continue  // precisa de PUSI

    const adaptCtrl = (msg[i + 3] & 0x30) >> 4
    const adaptLen  = (adaptCtrl === 3 || adaptCtrl === 2) ? msg[i + 4] + 1 : 0
    const pf        = msg[i + 4 + adaptLen]
    const s         = i + 4 + adaptLen + 1 + pf  // início da seção

    if (s + 8 >= msg.length || msg[s] !== 0x00) continue  // table_id PAT
    const sectionLength = ((msg[s + 1] & 0x0F) << 8) | msg[s + 2]
    const entriesEnd    = s + 3 + sectionLength - 4       // exclui CRC-32

    // PAT: fixed header = table_id(1)+section_length(2)+transport_stream_id(2)+version(1)+section_num(1)+last_section(1) = 8 bytes
    let j = s + 8
    while (j + 4 <= entriesEnd) {
      const programNum = (msg[j] << 8) | msg[j + 1]
      const pmtPid     = ((msg[j + 2] & 0x1F) << 8) | msg[j + 3]
      if (programNum !== 0) return pmtPid  // ignora programa 0 (NIT)
      j += 4
    }
  }
  return -1
}

/**
 * Percorre o buffer procurando pacotes PMT com o PID informado. Se encontrar
 * um PMT que NÃO tem o PID 0x0500, insere uma entrada SCTE-35 antes do CRC-32,
 * atualiza section_length e recalcula o CRC. Retorna um novo Buffer se alguma
 * modificação foi feita, ou null se nenhuma alteração foi necessária.
 */
function rewritePmtInMessage(msg: Buffer, pmtPid: number): Buffer | null {
  let changed = false
  const out = Buffer.from(msg)

  for (let i = 0; i + TS_PACKET_SIZE <= out.length; i += TS_PACKET_SIZE) {
    if (out[i] !== 0x47) continue
    const pid = ((out[i + 1] & 0x1F) << 8) | out[i + 2]
    if (pid !== pmtPid) continue
    if ((out[i + 1] & 0x40) === 0) continue  // precisa de PUSI (início da seção)

    const adaptCtrl = (out[i + 3] & 0x30) >> 4
    const adaptLen  = (adaptCtrl === 3 || adaptCtrl === 2) ? out[i + 4] + 1 : 0
    const pf        = out[i + 4 + adaptLen]
    const s         = i + 4 + adaptLen + 1 + pf  // início da seção PMT

    if (s + 12 >= out.length || out[s] !== 0x02) continue  // table_id PMT

    const sectionLength     = ((out[s + 1] & 0x0F) << 8) | out[s + 2]
    const programInfoLength = ((out[s + 10] & 0x0F) << 8) | out[s + 11]
    const streamLoopStart   = s + 12 + programInfoLength
    const crcPos            = s + 3 + sectionLength - 4   // posição do CRC-32

    // Verifica se PID 0x0500 já está no loop de streams
    let already = false
    let j = streamLoopStart
    while (j + 5 <= crcPos) {
      const esPid    = ((out[j + 1] & 0x1F) << 8) | out[j + 2]
      const esInfoLen = ((out[j + 3] & 0x03) << 8) | out[j + 4]
      if (esPid === SCTE35_PID) { already = true; break }
      j += 5 + esInfoLen
    }
    if (already) continue

    // Verifica se há espaço sobrando no pacote TS de 188 bytes para +5 bytes
    const sectionTotalEnd = s + 3 + sectionLength
    if (i + TS_PACKET_SIZE - sectionTotalEnd < 5) continue

    // Desloca os 4 bytes do CRC-32 cinco posições para a frente
    out.copyWithin(crcPos + 5, crcPos, crcPos + 4)

    // Escreve entrada SCTE-35: stream_type(1) + PID(2) + ES_info_length(2)
    out[crcPos + 0] = SCTE35_STREAM_TYPE              // 0x86
    out[crcPos + 1] = 0xE0 | ((SCTE35_PID >> 8) & 0x1F)  // reserved(3)+PID[12:8]
    out[crcPos + 2] = SCTE35_PID & 0xFF               // PID[7:0]
    out[crcPos + 3] = 0xF0                            // reserved(6)+ES_info_length[9:8]=0
    out[crcPos + 4] = 0x00                            // ES_info_length[7:0]=0

    // Atualiza section_length (+5)
    const newLen = sectionLength + 5
    out[s + 1] = (out[s + 1] & 0xF0) | ((newLen >> 8) & 0x0F)
    out[s + 2] = newLen & 0xFF

    // Recalcula CRC-32 (cobre de table_id até o fim da nova entrada SCTE-35)
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
  pending:   Buffer[]    // pacotes SCTE-35 aguardando envio
  pmtPid:    number      // PID do PMT descoberto via PAT; -1 = ainda não descoberto
}

const proxies = new Map<string, ProxyEntry>()

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
  const entry: ProxyEntry = { socket, relayPort, pending: [], pmtPid: -1 }
  proxies.set(channelId, entry)

  socket.on('message', (msg) => {
    // 1. Descobre PMT PID a partir do PAT (uma vez apenas)
    if (entry.pmtPid < 0) {
      const found = findPmtPidInMessage(msg)
      if (found >= 0) entry.pmtPid = found
    }

    // 2. Modifica PMT para incluir entrada SCTE-35 (PID 0x0500, stream_type 0x86)
    let outMsg: Buffer = msg
    if (entry.pmtPid >= 0) {
      const rewritten = rewritePmtInMessage(msg, entry.pmtPid)
      if (rewritten !== null) outMsg = rewritten
    }

    // 3. Flush de pacotes SCTE-35 pendentes ANTES do próximo pacote de conteúdo
    const toInject = entry.pending.splice(0)
    for (const buf of toInject) {
      socket.send(buf, 0, buf.length, relayPort, '127.0.0.1')
    }

    // 4. Repassa mensagem (possivelmente com PMT modificado) ao relay
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
  try { entry.socket.close() } catch {}
  proxies.delete(channelId)
  console.log(`[ts-proxy/${channelId}] Proxy encerrado`)
}

export function stopAllProxies(): void {
  for (const [id] of proxies) stopProxy(id)
}

export function isProxyActive(channelId: string): boolean {
  return proxies.has(channelId)
}
