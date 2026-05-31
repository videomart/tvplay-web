/**
 * UDP proxy MPEG-TS com injeção de pacotes SCTE-35.
 *
 * Arquitetura por canal:
 *   content-process → UDP:proxyPort → [proxy] → UDP:relayPort
 *
 * O proxy é transparente: repassa todos os pacotes 1:1 para o relay.
 * Quando injectPackets() é chamado, os bytes são enfileirados e enviados
 * no próximo flush, intercalados entre os pacotes de conteúdo.
 */

import dgram from 'dgram'

const TS_PACKET_SIZE = 188

interface ProxyEntry {
  socket:     dgram.Socket
  relayPort:  number
  pending:    Buffer[]       // pacotes SCTE-35 aguardando envio
}

const proxies = new Map<string, ProxyEntry>()   // channelId → ProxyEntry

let nextProxyPort = 14100

export function allocProxyPort(channelId: string): number {
  // Reutiliza porta se já existe
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
  stopProxy(channelId)   // garante limpeza antes de (re)iniciar

  const socket = dgram.createSocket('udp4')
  const entry: ProxyEntry = { socket, relayPort, pending: [] }
  proxies.set(channelId, entry)

  socket.on('message', (msg) => {
    // Flush pacotes SCTE-35 pendentes ANTES do próximo pacote de conteúdo
    const toInject = entry.pending.splice(0)
    for (const buf of toInject) {
      socket.send(buf, 0, buf.length, relayPort, '127.0.0.1')
    }

    // Repassa pacote original ao relay (pode ser multi-packet, mas mantemos atomic)
    socket.send(msg, 0, msg.length, relayPort, '127.0.0.1')
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

  // Divide em blocos individuais de 188 bytes para envio
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
