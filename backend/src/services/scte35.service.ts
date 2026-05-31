/**
 * SCTE-35 splice_insert builder + MPEG-TS packet wrapper.
 *
 * Gera a seção SIT (Splice Information Table) completa e a empacota
 * em pacotes MPEG-TS de 188 bytes prontos para injeção no stream.
 *
 * Referências: ANSI/SCTE 35 2019 · ISO 13818-1 (MPEG-TS)
 */

// ─── CRC-32/MPEG-2 (polinômio 0x04C11DB7) ────────────────────────────────────

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

// ─── SCTE-35 Section Builder ─────────────────────────────────────────────────

export interface SpliceInsertOpts {
  eventId:        number   // ID único do evento (1–0xFFFFFFFE)
  outOfNetwork:   boolean  // true = início do break, false = retorno
  durationPts?:   number   // duração em unidades 90kHz (omitir = sem duração fixa)
  programId?:     number   // unique_program_id (default 1)
}

/**
 * Constrói a seção SIT (SCTE-35 Splice Information Table) em binário.
 * Retorna um Buffer com a seção completa incluindo CRC-32.
 */
export function buildSpliceInsertSection(opts: SpliceInsertOpts): Buffer {
  const {
    eventId,
    outOfNetwork,
    durationPts,
    programId = 1,
  } = opts

  const hasDuration = durationPts !== undefined && outOfNetwork

  // ── Splice command: splice_insert ──────────────────────────────────────────
  // Tamanho: 4 (event_id) + 1 (cancel+flags) + 1 (flags2) + [5 duration] + 2 (program_id) + 2 (avail)
  const cmdLen = 4 + 1 + 1 + (hasDuration ? 5 : 0) + 2 + 1 + 1
  const cmd = Buffer.alloc(cmdLen)
  let o = 0

  cmd.writeUInt32BE(eventId, o); o += 4                       // splice_event_id
  cmd[o++] = 0x7F                                             // splice_event_cancel=0, reserved=1111111
  // out_of_network(1) + program_splice(1) + duration_flag(1) + splice_immediate(1) + reserved(4)
  cmd[o++] = ((outOfNetwork ? 1 : 0) << 7) | (1 << 6) | ((hasDuration ? 1 : 0) << 5) | (1 << 4) | 0x0F

  if (hasDuration && durationPts !== undefined) {
    // auto_return(1) + reserved(6) + duration_33bits
    const high = Math.floor(durationPts / 0x100000000) & 0x01
    const low  = durationPts >>> 0
    cmd[o++] = 0xFE | high                                    // auto_return=1, reserved, high bit
    cmd.writeUInt32BE(low, o); o += 4
  }

  cmd.writeUInt16BE(programId & 0xFFFF, o); o += 2            // unique_program_id
  cmd[o++] = 0x01                                             // avail_num
  cmd[o++] = 0x01                                             // avails_expected

  // ── Section body (depois do campo section_length) ─────────────────────────
  // protocol_version(8) + encrypted_packet(1)+encryption_alg(6)+pts_adjustment(33) = 6 bytes
  // cw_index(8) + tier(12) + splice_command_length(12) + splice_command_type(8) = 5 bytes
  const bodyLen = 6 + 5 + cmdLen + 2       // +2 = descriptor_loop_length
  const body = Buffer.alloc(bodyLen)
  let bo = 0

  // protocol_version
  body[bo++] = 0x00

  // encrypted_packet=0, encryption_algorithm=000000, pts_adjustment=0 (33 bits = 5 bytes com 1 bit antes)
  // 1+6+33 = 40 bits = 5 bytes
  body[bo++] = 0x00; body[bo++] = 0x00; body[bo++] = 0x00; body[bo++] = 0x00; body[bo++] = 0x00

  // cw_index
  body[bo++] = 0x00

  // tier(12)=0xFFF + splice_command_length(12)
  body[bo++] = 0xFF
  body[bo++] = 0xF0 | ((cmdLen >> 8) & 0x0F)
  body[bo++] = cmdLen & 0xFF

  // splice_command_type
  body[bo++] = 0x05

  // splice command bytes
  cmd.copy(body, bo); bo += cmdLen

  // descriptor_loop_length = 0
  body[bo++] = 0x00
  body[bo++] = 0x00

  // ── Header: table_id + section_length ────────────────────────────────────
  const sectionLength = body.length + 4   // +4 = CRC
  const header = Buffer.alloc(3)
  header[0] = 0xFC                        // table_id = SCTE-35 SIT
  // section_syntax_indicator=0, private_indicator=0, reserved=11, section_length(12)
  header.writeUInt16BE(0xC000 | (sectionLength & 0x0FFF), 1)

  // ── CRC-32 ────────────────────────────────────────────────────────────────
  const preSection = Buffer.concat([header, body])
  const crc = crc32mpeg(preSection)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc, 0)

  return Buffer.concat([preSection, crcBuf])
}

// ─── MPEG-TS Packet Builder ───────────────────────────────────────────────────

export const SCTE35_PID = 0x0500   // PID 1280 — convencional para SCTE-35

let continuityCounter = 0

/**
 * Empacota uma seção SCTE-35 em um ou mais pacotes MPEG-TS de 188 bytes.
 */
export function wrapInTsPackets(section: Buffer): Buffer {
  const TS_PACKET_SIZE = 188
  const HEADER_SIZE    = 4
  const POINTER_SIZE   = 1  // pointer_field no primeiro pacote

  const packets: Buffer[] = []
  let remaining = section
  let firstPacket = true

  while (remaining.length > 0) {
    const pkt = Buffer.alloc(TS_PACKET_SIZE, 0xFF)

    // 4-byte TS header
    pkt[0] = 0x47  // sync byte
    pkt[1] = (firstPacket ? 0x40 : 0x00) | ((SCTE35_PID >> 8) & 0x1F)
    pkt[2] = SCTE35_PID & 0xFF
    pkt[3] = 0x10 | (continuityCounter & 0x0F)  // payload only, no adaptation
    continuityCounter = (continuityCounter + 1) & 0x0F

    let payloadStart = HEADER_SIZE

    if (firstPacket) {
      pkt[payloadStart++] = 0x00  // pointer_field = 0 (seção começa aqui)
      firstPacket = false
    }

    const available = TS_PACKET_SIZE - payloadStart
    const chunk     = remaining.slice(0, available)
    chunk.copy(pkt, payloadStart)
    // Restante já é 0xFF (stuffing)

    packets.push(pkt)
    remaining = remaining.slice(available)
  }

  return Buffer.concat(packets)
}

// ─── API de alto nível ────────────────────────────────────────────────────────

let eventIdCounter = 1

/**
 * Gera os pacotes TS prontos para injeção no stream para um evento de break.
 * @param outOfNetwork true = início do intervalo; false = retorno da programação
 * @param durationSecs duração do intervalo em segundos (opcional)
 */
export function buildBreakPackets(outOfNetwork: boolean, durationSecs?: number): Buffer {
  const eventId    = eventIdCounter++
  const durationPts = durationSecs !== undefined ? Math.round(durationSecs * 90000) : undefined
  const section    = buildSpliceInsertSection({ eventId, outOfNetwork, durationPts })
  return wrapInTsPackets(section)
}
