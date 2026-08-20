/**
 * Injeção SCTE-35 real no transport stream via TSDuck (tsp).
 *
 * Arquitetura por saída SRT com scteEnabled:
 *
 *   FFmpeg relay → UDP local (porta relay) → tsp spliceinject → SRT externo
 *
 * O tsp lê o TS do UDP local, insere splice_insert (cue_in / cue_out) no PID
 * SCTE-35 via `spliceinject` com comando enviado por UDP, e retransmite via
 * SRT caller para o destino final.
 *
 * Quando scteEnabled=false ou a saída não é SRT, este serviço não é usado e o
 * relay FFmpeg continua apontando direto ao destino.
 */

import { spawn, ChildProcess } from 'child_process'
import dgram from 'dgram'
import fs from 'fs'

const TSP_PATH = process.env.TSP_PATH ?? 'tsp'

interface InjectorSession {
  proc:        ChildProcess
  stopped:     boolean
  srtUrl:      string
  relayPort:   number   // porta UDP onde o FFmpeg relay envia o TS (tsp escuta aqui)
  cmdPort:     number   // porta UDP local onde o tsp spliceinject escuta comandos XML
  eventId:     number
}

const sessions  = new Map<string, InjectorSession>()
const portMap   = new Map<string, { relay: number; cmd: number }>()
const usedPorts = new Set<number>()
const PORT_BASE = 21000
const PORT_MAX  = 21998

function allocPorts(key: string): { relay: number; cmd: number } {
  if (portMap.has(key)) return portMap.get(key)!
  for (let p = PORT_BASE; p <= PORT_MAX; p += 2) {
    if (!usedPorts.has(p) && !usedPorts.has(p + 1)) {
      usedPorts.add(p)
      usedPorts.add(p + 1)
      const ports = { relay: p, cmd: p + 1 }
      portMap.set(key, ports)
      return ports
    }
  }
  throw new Error('[scte35-injector] Sem portas UDP locais disponíveis')
}

function releasePorts(key: string): void {
  const ports = portMap.get(key)
  if (ports) {
    usedPorts.delete(ports.relay)
    usedPorts.delete(ports.cmd)
    portMap.delete(key)
  }
}

function sessionKey(channelId: string, outputId: string): string {
  return `${channelId}:${outputId}`
}

function killAndWait(p: ChildProcess | null): Promise<void> {
  if (!p || p.exitCode !== null || p.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const t = setTimeout(() => { try { p.kill('SIGKILL') } catch {} }, 3_000)
    p.once('exit', () => { clearTimeout(t); resolve() })
    try { p.kill('SIGTERM') } catch { clearTimeout(t); resolve() }
  })
}

/** Extrai host:port de uma URL srt://host:port?... */
function stripSrtProtocol(url: string): string {
  return url.replace(/^srt:\/\//i, '').split('?')[0]
}

/** Extrai passphrase da query string */
function extractPassphrase(url: string): string | null {
  try {
    const normalized = url.startsWith('srt://') ? url : `srt://${url}`
    const u = new URL(normalized)
    return u.searchParams.get('passphrase') ?? u.searchParams.get('pbkeylen') ? u.searchParams.get('passphrase') : null
  } catch {
    const m = url.match(/[?&]passphrase=([^&]+)/)
    return m ? decodeURIComponent(m[1]) : null
  }
}

/** Extrai streamid da query string e retorna args do tsp (--streamid) */
function buildStreamIdArgs(url: string): string[] {
  try {
    const normalized = url.startsWith('srt://') ? url : `srt://${url}`
    const u = new URL(normalized)
    const sid = u.searchParams.get('streamid')
    if (sid) return ['--streamid', decodeURIComponent(sid)]
  } catch {
    const m = url.match(/[?&]streamid=([^&]+)/)
    if (m) return ['--streamid', decodeURIComponent(m[1])]
  }
  return []
}

/**
 * Constrói os args do tsp:
 *   -I ip relayPort        — recebe TS bruto do FFmpeg relay via UDP
 *   -P spliceinject --udp  — injeta splice_insert via comandos XML recebidos por UDP
 *   -O srt --caller ...    — retransmite ao SRT externo
 */
function buildTspArgs(relayPort: number, cmdPort: number, srtUrl: string): string[] {
  const passphrase = extractPassphrase(srtUrl)
  const srtTarget  = stripSrtProtocol(srtUrl)

  const ppArgs = passphrase ? ['--passphrase', passphrase] : []

  return [
    // Flag global (não é plugin): insere 1 pacote null artificial a cada 200
    // pacotes de entrada (~0.5% de overhead de bitrate). O relay FFmpeg -c copy
    // não carrega nenhum pacote null natural -- sem isso, o spliceinject nunca
    // tem de onde tirar espaço para criar o PID 0x0200: o log mostra "enqueuing
    // SpliceInsert" normalmente, mas nenhum pacote é de fato escrito (0
    // nullified sempre). Confirmado por testes isolados em 2026-08-20 --
    // --min-bitrate abaixo sozinho NÃO resolve, precisa dos dois juntos.
    '-a', '1/200',

    // Input: TS vindo do FFmpeg relay via UDP local (unicast: só porta no parâmetro,
    // --local-address vincula ao loopback para não aceitar tráfego externo).
    // --buffer-size 4MB: evita drops UDP quando o spliceinject processa pacotes.
    '-I', 'ip', `${relayPort}`,
    '--local-address', '127.0.0.1',
    '--buffer-size', '4194304',

    // Plugin: injeta splice_insert SCTE-35 via comandos XML recebidos por UDP.
    // --pts-pid 0x0100: referência de clock (PID de vídeo do FFmpeg).
    // --min-bitrate: mantém o PID 0x0200 ativo consumindo os nulos artificiais
    // do -a acima -- sem isso, o -a sozinho também não é suficiente.
    // Nota: NÃO usamos -P pmt --add-pid aqui porque o receptor (scte_monitor)
    // remove o PID SCTE-35 do PMT e substitui os pacotes por nulos antes de
    // repassar ao MediaMTX, evitando o "max recorded size exceeded" do astits.
    '-P', 'spliceinject',
    '--udp', `127.0.0.1:${cmdPort}`,
    '--poll-interval', '100',
    '--pid', '0x0200',
    '--pts-pid', '0x0100',
    '--min-bitrate', '50000',

    // Output: SRT caller para o scte_monitor (porta dedicada por cliente).
    // O scte_monitor detecta SCTE-35, remove os pacotes, e faz relay ao MediaMTX.
    '-O', 'srt',
    '--caller', srtTarget,
    ...ppArgs,
    ...buildStreamIdArgs(srtUrl),
  ]
}

/**
 * Inicia o processo tsp para uma saída SRT com SCTE-35.
 * Retorna a porta relay UDP onde o FFmpeg deve enviar o TS.
 */
export async function startInjector(
  channelId: string,
  outputId:  string,
  srtUrl:    string,
): Promise<number> {
  const key = sessionKey(channelId, outputId)
  await stopInjector(channelId, outputId)

  const { relay: relayPort, cmd: cmdPort } = allocPorts(key)
  const args = buildTspArgs(relayPort, cmdPort, srtUrl)
  const proc = spawn(TSP_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] })

  const session: InjectorSession = { proc, stopped: false, srtUrl, relayPort, cmdPort, eventId: 0 }
  sessions.set(key, session)

  proc.stdout?.on('data', () => {})
  proc.stderr?.on('data', (d: Buffer) => {
    const msg = d.toString().trim()
    if (msg) console.log(`[scte35-injector/${channelId}/${outputId}] ${msg}`)
  })
  proc.on('exit', (code, sig) => {
    const current = sessions.get(key)
    if (current?.proc !== proc) return
    sessions.delete(key)
    if (!current.stopped) {
      console.warn(`[scte35-injector/${channelId}/${outputId}] tsp saiu (code=${code ?? sig}) — reiniciando em 3s`)
      setTimeout(() => startInjector(channelId, outputId, srtUrl), 3_000)
    }
  })

  console.log(`[scte35-injector/${channelId}] tsp iniciado — relay UDP :${relayPort} → spliceinject UDP :${cmdPort} → SRT ${srtUrl}`)
  return relayPort
}

/** Para e remove a sessão tsp para a saída. */
export async function stopInjector(channelId: string, outputId: string): Promise<void> {
  const key = sessionKey(channelId, outputId)
  const s = sessions.get(key)
  if (!s) return
  s.stopped = true
  sessions.delete(key)
  await killAndWait(s.proc)
  releasePorts(key)
  console.log(`[scte35-injector/${channelId}/${outputId}] parado`)
}

/** Para todos os injetores do canal. */
export async function stopAllInjectors(channelId: string): Promise<void> {
  const prefix = `${channelId}:`
  const keys = [...sessions.keys()].filter(k => k.startsWith(prefix))
  await Promise.all(keys.map(k => {
    const outputId = k.slice(prefix.length)
    return stopInjector(channelId, outputId)
  }))
}

/**
 * Envia um cue_out (início de break) ao tsp via UDP.
 * O spliceinject injeta o splice_insert no PTS mais próximo do stream (≤100ms).
 */
export function sendCueOut(channelId: string, outputId: string, durationSecs?: number): void {
  const key = sessionKey(channelId, outputId)
  const s = sessions.get(key)
  if (!s) return
  s.eventId++

  // Formato XML exato do modelo TSDuck (tsduck.tables.model.xml):
  // splice_event_cancel="false", out_of_network="true", splice_immediate="true"
  // break_duration em ticks de 90kHz (90000 ticks/s)
  const breakDur = durationSecs != null
    ? `<break_duration auto_return="true" duration="${Math.round(durationSecs * 90000)}"/>`
    : ''

  // TSDuck spliceinject exige <tsduck> como elemento raiz (não <splice_information_table>)
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\
<tsduck>\
<splice_information_table protocol_version="0" pts_adjustment="0" tier="0xFFF">\
<splice_insert splice_event_id="${s.eventId}" splice_event_cancel="false" out_of_network="true" splice_immediate="true" unique_program_id="1" avail_num="0" avails_expected="0">\
${breakDur}</splice_insert></splice_information_table>\
</tsduck>`

  sendUdpCmd(s.cmdPort, xml)
  console.log(`[scte35-injector/${channelId}/${outputId}] CUE-OUT eventId=${s.eventId}${durationSecs ? ` dur=${durationSecs}s` : ''}`)
}

/**
 * Envia um cue_in (retorno da rede) ao tsp.
 */
export function sendCueIn(channelId: string, outputId: string): void {
  const key = sessionKey(channelId, outputId)
  const s = sessions.get(key)
  if (!s) return
  s.eventId++

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\
<tsduck>\
<splice_information_table protocol_version="0" pts_adjustment="0" tier="0xFFF">\
<splice_insert splice_event_id="${s.eventId}" splice_event_cancel="false" out_of_network="false" splice_immediate="true" unique_program_id="1" avail_num="0" avails_expected="0"/>\
</splice_information_table>\
</tsduck>`

  sendUdpCmd(s.cmdPort, xml)
  console.log(`[scte35-injector/${channelId}/${outputId}] CUE-IN eventId=${s.eventId}`)
}

function sendUdpCmd(port: number, xml: string): void {
  const sock = dgram.createSocket('udp4')
  const buf  = Buffer.from(xml, 'utf8')
  sock.send(buf, 0, buf.length, port, '127.0.0.1', (err) => {
    if (err) console.warn(`[scte35-injector] Falha ao enviar cue UDP: ${err.message}`)
    sock.close()
  })
}

/** Retorna a porta relay UDP se a sessão estiver ativa (para o FFmpeg relay usar). */
export function getInjectorPort(channelId: string, outputId: string): number | null {
  const key = sessionKey(channelId, outputId)
  return sessions.get(key)?.relayPort ?? null
}

/** true se o tsp está ativo para a saída. */
export function isInjectorActive(channelId: string, outputId: string): boolean {
  return sessions.has(sessionKey(channelId, outputId))
}
