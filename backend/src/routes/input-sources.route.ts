import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { InputSourceType } from '@prisma/client'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { prisma } from '../lib/prisma'
import * as previewService from '../services/preview.service'
import * as activeInputsService from '../services/active-inputs.service'
import { refreshInputSourceConsumers, isYoutubeContentEnabled } from '../services/playout.service'
import { getLastEvent } from '../services/scte35-watcher.service'
import { YTDLP_DISABLED_ERROR } from '../config'

const execFileAsync = promisify(execFile)

const schema = z.object({
  name:         z.string().min(1),
  type:         z.nativeEnum(InputSourceType),
  url:          z.string().optional().nullable(),
  device:       z.string().optional().nullable(),
  deviceOs:     z.string().optional().nullable(),
  deviceDriver: z.string().optional().nullable(),
  deviceName:   z.string().optional().nullable(),
  serverIp:     z.string().optional().nullable(),
  clipId:       z.string().optional().nullable(),
  channelId:    z.string().optional().nullable(),
  active:           z.boolean().optional(),
  inputNumber:      z.number().int().positive().optional().nullable(),
  scteWatchEnabled: z.boolean().optional(),
  scteAction:       z.enum(['LOG', 'BREAK']).optional(),
})

// Garante unicidade de inputNumber por canal: se houver conflito, move o existente
// para o primeiro número disponível.
async function resolveInputNumber(
  channelId: string | null | undefined,
  desiredNumber: number,
  excludeId?: string,
): Promise<void> {
  // Escopo de unicidade: por canal se channelId informado, global caso contrário
  const scope = channelId ? { channelId } : { channelId: null }
  const excludeFilter = excludeId ? { id: { not: excludeId } } : {}

  const conflict = await prisma.inputSource.findFirst({
    where: { ...scope, inputNumber: desiredNumber, ...excludeFilter },
  })
  if (!conflict) return

  // Libera o slot antes de recalcular para evitar cascade de conflitos
  await prisma.inputSource.update({ where: { id: conflict.id }, data: { inputNumber: null } })
  const others = await prisma.inputSource.findMany({
    where: { ...scope, id: { notIn: [conflict.id, ...(excludeId ? [excludeId] : [])] } },
    select: { inputNumber: true },
  })
  const used = new Set(others.map((o: any) => o.inputNumber).filter(Boolean))
  used.add(desiredNumber)
  let n = 1
  while (used.has(n)) n++
  await prisma.inputSource.update({ where: { id: conflict.id }, data: { inputNumber: n } })
}

const include = {
  channel: { select: { id: true, name: true, number: true } },
  clip: { select: { id: true, code: true, title: true, sourceType: true, sourceUrl: true, media: { select: { hlsPath: true, ingestStatus: true } } } },
}

async function listVideoDevices(): Promise<{ path: string; name: string }[]> {
  try {
    // Tenta v4l2-ctl para listar dispositivos com nome legível
    const { stdout } = await execFileAsync('v4l2-ctl', ['--list-devices'], { timeout: 5000 })
    const devices: { path: string; name: string }[] = []
    let currentName = 'Dispositivo'
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim()
      if (!line.startsWith('\t') && trimmed.endsWith(':')) {
        currentName = trimmed.replace(/\s*\(.*\):$/, '').trim()
      } else if (line.startsWith('\t') && trimmed.startsWith('/dev/video')) {
        devices.push({ path: trimmed, name: currentName })
      }
    }
    return devices
  } catch {
    // Fallback: lista /dev/video*
    try {
      const { stdout } = await execFileAsync('sh', ['-c', 'ls /dev/video* 2>/dev/null'], { timeout: 3000 })
      return stdout.trim().split('\n').filter(Boolean).map((p) => ({ path: p, name: p }))
    } catch {
      return []
    }
  }
}

function encodeProxyUrl(url: string) {
  return Buffer.from(url).toString('base64url')
}

function decodeProxyUrl(encoded: string) {
  return Buffer.from(encoded, 'base64url').toString('utf-8')
}

function toProxyPath(absoluteUrl: string) {
  return `/api/input-sources/proxy-hls?url=${encodeProxyUrl(absoluteUrl)}`
}

function rewriteM3u8(text: string, originalUrl: string): string {
  return text.split('\n').map(line => {
    const trimmed = line.trim()
    if (!trimmed) return line

    // Reescreve atributo URI="..." dentro de tags (#EXT-X-MAP, #EXT-X-MEDIA, etc.)
    if (trimmed.startsWith('#') && trimmed.includes('URI="')) {
      return trimmed.replace(/URI="([^"]+)"/g, (_match, uri) => {
        try {
          const abs = new URL(uri, originalUrl).href
          return `URI="${toProxyPath(abs)}"`
        } catch { return _match }
      })
    }

    // Linhas de segmento / sub-manifest (não começam com #)
    if (!trimmed.startsWith('#')) {
      try {
        const abs = new URL(trimmed, originalUrl).href
        return toProxyPath(abs)
      } catch { return line }
    }

    return line
  }).join('\n')
}

export default async function inputSourceRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] }

  // Proxy HLS — evita CORS ao buscar streams externos (YouTube CDN, etc.)
  app.get('/proxy-hls', auth, async (request: any, reply) => {
    const encoded = request.query.url as string
    if (!encoded) return reply.status(400).send({ error: 'url obrigatória' })

    let targetUrl: string
    try { targetUrl = decodeProxyUrl(encoded) } catch {
      return reply.status(400).send({ error: 'url inválida' })
    }

    const isYoutubeCdn = targetUrl.includes('googlevideo.com') || targetUrl.includes('youtube.com')

    const resp = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/x-mpegURL,application/vnd.apple.mpegurl,*/*;q=0.9',
        ...(isYoutubeCdn ? {
          'Origin':  'https://www.youtube.com',
          'Referer': 'https://www.youtube.com/',
        } : {}),
      },
      redirect: 'follow',
    }).catch((e) => { throw new Error(`Falha ao buscar stream: ${e.message}`) })

    if (!resp.ok) {
      console.error(`[proxy-hls] Upstream ${resp.status} para: ${targetUrl}`)
      return reply.status(502).send({ error: `Upstream retornou ${resp.status}` })
    }

    const ct = resp.headers.get('content-type') ?? ''

    const buf = Buffer.from(await resp.arrayBuffer())

    const isManifest =
      buf.slice(0, 7).toString('utf-8').trimStart().startsWith('#EXTM3U') ||
      targetUrl.includes('.m3u8') ||
      targetUrl.includes('googlevideo.com/api/manifest') ||
      ct.includes('mpegurl') ||
      ct.includes('x-mpegURL') ||
      ct.includes('vnd.apple.mpegurl')

    reply.header('Access-Control-Allow-Origin', '*')

    if (isManifest) {
      const rewritten = rewriteM3u8(buf.toString('utf-8'), targetUrl)
      reply.header('Content-Type', 'application/x-mpegURL')
      reply.header('Cache-Control', 'no-cache, no-store')
      return reply.send(rewritten)
    }

    // Segmento binário (.ts, .aac, .mp4, etc.)
    reply.header('Content-Type', ct || 'video/MP2T')
    reply.header('Content-Length', buf.length)
    reply.header('Cache-Control', 'public, max-age=3600')
    return reply.send(buf)
  })

  // Lista todos os dispositivos de vídeo disponíveis no servidor
  app.get('/devices', auth, async (_req, reply) => {
    const devices = await listVideoDevices()
    return reply.send({ devices })
  })

  // Resolve URL do YouTube via yt-dlp e retorna URL proxiada (evita CORS no browser)
  app.post('/resolve-youtube', auth, async (request: any, reply) => {
    const { url } = request.body ?? {}
    if (!url) return reply.status(400).send({ error: 'URL obrigatória' })
    if (!isYoutubeContentEnabled()) return reply.status(422).send({ error: YTDLP_DISABLED_ERROR })

    const base = ['--no-playlist', '-g', '--no-warnings', '--socket-timeout', '15']

    async function tryYtdlp(extraArgs: string[]): Promise<string | null> {
      try {
        const { stdout } = await execFileAsync('yt-dlp', [...base, ...extraArgs, url], { timeout: 35000 })
        return stdout.trim().split('\n')[0] || null
      } catch { return null }
    }

    try {
      // android: mais confiável para lives; web: VOD fallback; sem client: último recurso
      let rawUrl =
        await tryYtdlp(['-f', 'best[protocol=m3u8_native]/best[height<=720]/best', '--extractor-args', 'youtube:player_client=android']) ||
        await tryYtdlp(['-f', 'best[protocol=m3u8_native]/best[ext=mp4][vcodec!=none][acodec!=none]/best', '--extractor-args', 'youtube:player_client=web']) ||
        await tryYtdlp(['-f', 'best[ext=mp4][vcodec!=none][acodec!=none]/best[vcodec!=none]/best'])

      if (!rawUrl) throw new Error('Nenhum stream encontrado para este vídeo')

      // HLS (live) → proxia para contornar CORS; mp4/outros → URL direta (video tag nativa)
      const isHls = /\.m3u8/i.test(rawUrl) || rawUrl.includes('googlevideo.com/api/manifest')
      const streamUrl = isHls
        ? `/api/input-sources/proxy-hls?url=${encodeProxyUrl(rawUrl)}`
        : rawUrl

      return { streamUrl, isHls }
    } catch (e: any) {
      const detail = e.stderr?.toString()?.trim()?.split('\n').find((l: string) => l.includes('ERROR'))
        ?? e.message
      return reply.status(422).send({
        error: 'Não foi possível resolver o URL do YouTube.',
        detail,
      })
    }
  })

  app.get('/', auth, async () =>
    prisma.inputSource.findMany({ include, orderBy: [{ inputNumber: 'asc' }, { name: 'asc' }] })
  )

  app.post('/', auth, async (request, reply) => {
    const body = schema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })
    if (body.data.inputNumber != null) {
      await resolveInputNumber(body.data.channelId, body.data.inputNumber)
    }
    const source = await prisma.inputSource.create({ data: body.data, include })
    return reply.status(201).send(source)
  })

  app.put('/:id', auth, async (request: any, reply) => {
    const body = schema.partial().safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })
    if (body.data.inputNumber != null) {
      const current = await prisma.inputSource.findUnique({ where: { id: request.params.id }, select: { channelId: true } })
      await resolveInputNumber(body.data.channelId ?? current?.channelId, body.data.inputNumber, request.params.id)
    }
    const source = await prisma.inputSource.update({
      where: { id: request.params.id },
      data: body.data,
      include,
    }).catch(() => null)
    if (!source) return reply.status(404).send({ error: 'Fonte não encontrada' })
    // Gerencia relay ativo ao mudar campo active ou scteWatchEnabled
    if (body.data.active === false) {
      activeInputsService.deactivateInput(source.id)
        .then(() => refreshInputSourceConsumers(source.id))
        .catch(() => {})
    } else if (body.data.active === true) {
      activeInputsService.activateInput(source)
        .then(() => refreshInputSourceConsumers(source.id))
        .catch(() => {})
    } else if (body.data.scteWatchEnabled !== undefined && activeInputsService.isActive(source.id)) {
      // Reinicia relay para aplicar -copy_unknown -map 0 (ou removê-los)
      activeInputsService.restartInput(source)
        .then(() => refreshInputSourceConsumers(source.id))
        .catch(() => {})
    }
    return source
  })

  // Status do último evento SCTE-35 detectado nesta entrada
  app.get('/:id/scte-status', auth, async (request: any) => {
    const ev = getLastEvent(request.params.id)
    return ev ?? { detected: false }
  })

  app.delete('/:id', auth, async (request: any, reply) => {
    previewService.stopPreview(request.params.id)
    await activeInputsService.deactivateInput(request.params.id)
    await prisma.inputSource.delete({ where: { id: request.params.id } }).catch(() => null)
    return reply.status(204).send()
  })

  // ─── Relay ativo: serve segmentos HLS do active-inputs.service ───────────────
  app.get('/:id/active-stream/*', async (request: any, reply) => {
    const dir = activeInputsService.getHlsDir(request.params.id)
    if (!dir) return reply.status(404).send({ error: 'Entrada não ativa' })
    const filePath = path.join(dir, request.params['*'])
    if (!fs.existsSync(filePath)) return reply.status(404).send({ error: 'Segmento não encontrado' })
    const ct = filePath.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/MP2T'
    reply.header('Content-Type', ct).header('Cache-Control', 'no-cache')
    return reply.send(fs.createReadStream(filePath))
  })

  // ─── Preview ao vivo (SRT / RTSP / RTMP / UDP) via FFmpeg → HLS temp ─────────

  // Inicia transcodificação da fonte para HLS temporário
  app.post('/:id/preview/start', auth, async (request: any, reply) => {
    const source = await prisma.inputSource.findUnique({
      where: { id: request.params.id },
      include: { clip: { include: { media: { select: { hlsPath: true, ingestStatus: true } } } } },
    })
    if (!source) return reply.status(404).send({ error: 'Fonte não encontrada' })

    // Caminho rápido: relay ativo já tem HLS pronto — sem yt-dlp, sem espera
    if (activeInputsService.isReady(source.id)) {
      return reply.send({ hlsUrl: `/api/input-sources/${source.id}/active-stream/index.m3u8` })
    }

    // Relay ativo mas ainda aguardando primeiro segmento (ex: SRT listener esperando sender).
    // NÃO iniciar segundo FFmpeg — causaria conflito de porta. Aguarda o relay ficar pronto.
    if (activeInputsService.isActive(source.id)) {
      const MAX_WAIT = 60  // segundos
      for (let i = 0; i < MAX_WAIT * 2; i++) {
        await new Promise((r) => setTimeout(r, 500))
        if (activeInputsService.isReady(source.id)) {
          return reply.send({ hlsUrl: `/api/input-sources/${source.id}/active-stream/index.m3u8` })
        }
      }
      return reply.status(504).send({ error: `Timeout: a fonte SRT não enviou dados em ${MAX_WAIT}s. Verifique se vps1 está transmitindo.` })
    }

    // Tipo CLIP: resolve a URL a partir do clipe cadastrado
    if ((source as any).type === 'CLIP') {
      const clip = (source as any).clip
      if (!clip) return reply.status(400).send({ error: 'Clipe não encontrado na fonte' })
      // Clip FILE com HLS pronto: retorna URL diretamente sem FFmpeg
      if (clip.sourceType !== 'URL' && clip.media?.hlsPath && clip.media.ingestStatus === 'READY') {
        const mediaId = clip.media.hlsPath.split('/')[1]
        return reply.send({ hlsUrl: `/api/media/stream/${mediaId}/index.m3u8` })
      }
      // Clip URL (YouTube/Twitch): resolve via yt-dlp e inicia preview FFmpeg
      if (clip.sourceType === 'URL' && clip.sourceUrl) {
        const YT_PATTERN = /youtube\.com|youtu\.be|twitch\.tv/i
        const isYt = YT_PATTERN.test(clip.sourceUrl)
        if (isYt && !isYoutubeContentEnabled()) return reply.status(422).send({ error: YTDLP_DISABLED_ERROR })
        const base = ['--no-playlist', '-g', '--socket-timeout', '15', '--no-warnings']
        const fmt  = 'best[protocol=m3u8_native]/best[height<=720]/best'
        let resolvedUrl: string | null = null
        if (isYt) {
          const tryYt = async (...extra: string[]): Promise<string | null> => {
            try { const { stdout } = await execFileAsync('yt-dlp', [...base, '-f', fmt, ...extra, clip.sourceUrl], { timeout: 35000 }); return stdout.trim().split('\n')[0] || null } catch { return null }
          }
          resolvedUrl = await tryYt('--extractor-args', 'youtube:player_client=android') || await tryYt()
        } else {
          resolvedUrl = clip.sourceUrl
        }
        if (!resolvedUrl) return reply.status(422).send({ error: 'Não foi possível resolver a URL do clipe.' })
        const previewId = source.id + '_clip'
        previewService.startPreview(previewId, resolvedUrl)
        const maxAttempts = isYt ? 40 : 16
        const hlsFile = path.join('/tmp/tvplay-previews', previewId, 'index.m3u8')
        for (let i = 0; i < maxAttempts; i++) {
          if (fs.existsSync(hlsFile)) break
          if (previewService.hasPreviewFailed(previewId)) break
          await new Promise((r) => setTimeout(r, 500))
        }
        if (!fs.existsSync(hlsFile)) {
          previewService.stopPreview(previewId)
          return reply.status(504).send({ error: 'Timeout ao iniciar preview do clipe.' })
        }
        return { hlsUrl: `/api/input-sources/${previewId}/preview/stream/index.m3u8` }
      }
      return reply.status(400).send({ error: 'Clipe sem mídia disponível para preview' })
    }

    if (!source.url && !source.device) return reply.status(400).send({ error: 'Fonte sem URL ou dispositivo' })

    let inputUrl = source.url ?? source.device!

    // YouTube / Twitch via yt-dlp — também aplica quando tipo IP tem URL de plataforma compatível
    const needsYtDlp = source.type === 'YOUTUBE' ||
      (source.url ? /youtube\.com|youtu\.be|twitch\.tv/i.test(source.url) : false)

    if (needsYtDlp && !isYoutubeContentEnabled()) return reply.status(422).send({ error: YTDLP_DISABLED_ERROR })

    if (needsYtDlp) {
      const base = ['--no-playlist', '-g', '--socket-timeout', '15', '--no-warnings']
      const fmt  = 'best[protocol=m3u8_native]/best[height<=720]/best'

      const tryYt = async (...extra: string[]): Promise<string | null> => {
        try {
          const { stdout } = await execFileAsync('yt-dlp', [...base, '-f', fmt, ...extra, inputUrl], { timeout: 35000 })
          return stdout.trim().split('\n')[0] || null
        } catch { return null }
      }

      // Ordem: android (mais confiável para lives) → web → sem client (fallback)
      const resolved =
        await tryYt('--extractor-args', 'youtube:player_client=android') ||
        await tryYt('--extractor-args', 'youtube:player_client=web')     ||
        await tryYt()

      if (!resolved) {
        // Última tentativa sem filtro de formato — captura stderr para diagnóstico
        try {
          const { stdout } = await execFileAsync('yt-dlp', [...base, inputUrl], { timeout: 35000 })
          const url = stdout.trim().split('\n')[0]
          if (url) { inputUrl = url }
          else throw new Error('Nenhum stream encontrado')
        } catch (e: any) {
          const detail = e.stderr?.toString()?.trim()?.split('\n').find((l: string) => l.includes('ERROR')) ?? e.message
          return reply.status(422).send({ error: 'Não foi possível resolver o YouTube.', detail })
        }
      } else {
        inputUrl = resolved
      }
    }

    previewService.startPreview(source.id, inputUrl)

    // Listener SRT (LOCAL_DEVICE): até 120s para o agente externo conectar
    // YouTube/SRT caller: até 20s; RTMP/RTSP: até 15s; UDP: até 10s; outros: 8s
    const lowerUrl = inputUrl.toLowerCase()
    const isSrt         = lowerUrl.startsWith('srt://')
    const isSrtListener = isSrt && lowerUrl.includes('mode=listener')
    const isUdp  = lowerUrl.startsWith('udp://')
    const isRtmp = lowerUrl.startsWith('rtmp://')
    const isRtsp = lowerUrl.startsWith('rtsp://')
    const maxAttempts = isSrtListener ? 240 : (isSrt || needsYtDlp) ? 40 : (isRtmp || isRtsp) ? 30 : isUdp ? 20 : 16   // ×500ms
    const hlsFile = path.join('/tmp/tvplay-previews', source.id, 'index.m3u8')

    for (let i = 0; i < maxAttempts; i++) {
      if (fs.existsSync(hlsFile)) break
      if (previewService.hasPreviewFailed(source.id)) break   // falha antecipada
      await new Promise((r) => setTimeout(r, 500))
    }

    if (!fs.existsSync(hlsFile)) {
      const failed = previewService.hasPreviewFailed(source.id)
      previewService.stopPreview(source.id)
      return reply.status(504).send({
        error: failed
          ? 'Erro no FFmpeg ao conectar à fonte. Verifique a URL e se o protocolo é suportado pelo servidor.'
          : isSrtListener
            ? 'Timeout: nenhum agente conectou ao listener SRT em 120s. Inicie o comando FFmpeg no host e tente novamente.'
            : 'Timeout: a fonte não enviou dados no tempo esperado. Verifique se está transmitindo.',
      })
    }

    return { hlsUrl: `/api/input-sources/${source.id}/preview/stream/index.m3u8` }
  })

  // Para a transcodificação
  app.delete('/:id/preview/stop', auth, async (request: any, reply) => {
    previewService.stopPreview(request.params.id)
    return reply.status(204).send()
  })

  // Status da sessão de preview — inclui relay ativo como "running"
  app.get('/:id/preview/status', auth, async (request: any) => ({
    running: previewService.isPreviewRunning(request.params.id) || activeInputsService.isReady(request.params.id),
  }))

  // Serve os segmentos HLS gerados pelo FFmpeg
  app.get('/:id/preview/stream/*', async (request: any, reply) => {
    const { id } = request.params
    const file: string = request.params['*']
    const dir = previewService.getPreviewDir(id)

    if (!dir) return reply.status(404).send({ error: 'Preview não iniciado' })

    const filePath = path.join(dir, file)
    if (!fs.existsSync(filePath)) return reply.status(404).send({ error: 'Arquivo não encontrado' })

    previewService.touchPreview(id)

    const isPlaylist = file.endsWith('.m3u8')
    reply.header('Content-Type', isPlaylist ? 'application/x-mpegURL' : 'video/MP2T')
    reply.header('Cache-Control', isPlaylist ? 'no-cache, no-store' : 'public, max-age=10')
    reply.header('Access-Control-Allow-Origin', '*')
    return reply.send(fs.createReadStream(filePath))
  })
}
