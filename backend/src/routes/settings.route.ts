import { FastifyInstance } from 'fastify'
import path from 'path'
import fs from 'fs'
import { prisma } from '../lib/prisma'
import { storageService } from '../services/storage.service'
import { setClockOffsetHours } from '../services/stream.service'
import { setYoutubeContentEnabled, isYoutubeContentEnabled } from '../services/playout.service'
import { config } from '../config'

export default async function settingsRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] }

  app.get('/', auth, async () => {
    return prisma.systemSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton' },
      update: {},
    })
  })

  app.put('/', auth, async (request: any) => {
    const {
      appTitle, companyName, logoUrl, email,
      defaultMonitorOpen, defaultFallbackOpen,
      defaultOutputsOpen, defaultPlaylistOpen,
      clockOffsetHours, defaultBreakDuration, defaultSlideDuration, defaultUrlDuration,
      youtubeContentEnabled,
    } = request.body as {
      appTitle?: string
      companyName?: string
      logoUrl?: string | null
      email?: string | null
      defaultMonitorOpen?: boolean
      defaultFallbackOpen?: boolean
      defaultOutputsOpen?: boolean
      defaultPlaylistOpen?: boolean
      clockOffsetHours?: number
      defaultBreakDuration?: number
      defaultSlideDuration?: number
      defaultUrlDuration?: number
      youtubeContentEnabled?: boolean
    }

    const result = await prisma.systemSettings.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        appTitle:     appTitle     ?? 'TVPlay Web',
        companyName:  companyName  ?? 'TVPlay',
        logoUrl: logoUrl ?? null,
        email: email ?? null,
        defaultMonitorOpen:   defaultMonitorOpen   ?? true,
        defaultFallbackOpen:  defaultFallbackOpen  ?? true,
        defaultOutputsOpen:   defaultOutputsOpen   ?? false,
        defaultPlaylistOpen:  defaultPlaylistOpen  ?? true,
        clockOffsetHours:     clockOffsetHours     ?? 0,
        defaultBreakDuration: defaultBreakDuration ?? 300,
        defaultSlideDuration: defaultSlideDuration ?? 15,
        defaultUrlDuration:   defaultUrlDuration   ?? 0,
        youtubeContentEnabled: youtubeContentEnabled ?? true,
      },
      update: {
        ...(appTitle              !== undefined && { appTitle }),
        ...(companyName           !== undefined && { companyName }),
        ...(logoUrl               !== undefined && { logoUrl }),
        ...(email                 !== undefined && { email }),
        ...(defaultMonitorOpen    !== undefined && { defaultMonitorOpen }),
        ...(defaultFallbackOpen   !== undefined && { defaultFallbackOpen }),
        ...(defaultOutputsOpen    !== undefined && { defaultOutputsOpen }),
        ...(defaultPlaylistOpen   !== undefined && { defaultPlaylistOpen }),
        ...(clockOffsetHours      !== undefined && { clockOffsetHours }),
        ...(defaultBreakDuration  !== undefined && { defaultBreakDuration }),
        ...(defaultSlideDuration  !== undefined && { defaultSlideDuration }),
        ...(defaultUrlDuration    !== undefined && { defaultUrlDuration }),
        ...(youtubeContentEnabled !== undefined && { youtubeContentEnabled }),
      },
    })

    // Aplica imediatamente no stream service (novos processos FFmpeg usarão o TZ atualizado)
    if (clockOffsetHours !== undefined) setClockOffsetHours(clockOffsetHours)
    // Aplica imediatamente — sem rebuild/restart — nas rotas que verificam yt-dlp
    if (youtubeContentEnabled !== undefined) setYoutubeContentEnabled(youtubeContentEnabled)

    return result
  })

  // Upload de logo a partir de arquivo local
  app.post('/upload-logo', auth, async (request: any, reply) => {
    const data = await request.file()
    if (!data) return reply.status(400).send({ error: 'Nenhum arquivo enviado' })

    const allowedMimes = ['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp']
    if (!allowedMimes.includes(data.mimetype)) {
      return reply.status(415).send({ error: 'Formato não suportado. Use PNG, SVG, JPEG ou WebP.' })
    }

    const ext = path.extname(data.filename).toLowerCase() || '.png'
    const objectName = `logos/logo-${Date.now()}${ext}`
    const buffer = await data.toBuffer()

    await storageService.uploadBuffer(objectName, buffer, data.mimetype)

    const logoUrl = `/api/settings/logo/${path.basename(objectName)}`

    await prisma.systemSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', logoUrl },
      update: { logoUrl },
    })

    return { logoUrl }
  })

  // Serve o arquivo de logo do MinIO (sem auth — usado pela sidebar)
  app.get('/logo/:filename', async (request: any, reply) => {
    const objectName = `logos/${request.params.filename}`
    try {
      const stat = await storageService.getObjectStat(objectName)
      const stream = await storageService.getObjectStream(objectName)

      const ext = path.extname(request.params.filename).toLowerCase()
      const mime: Record<string, string> = {
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
      }

      reply.header('Content-Type', mime[ext] ?? 'image/png')
      reply.header('Content-Length', stat.size)
      reply.header('Cache-Control', 'public, max-age=86400')
      return reply.send(stream)
    } catch {
      return reply.status(404).send({ error: 'Logo não encontrado' })
    }
  })

  // Upload do arquivo de cookies do YouTube — aceita qualquer nome de arquivo
  // (Chrome, Firefox e extensões exportam com nomes diferentes; o servidor sempre
  //  grava em YTDLP_COOKIES_FILE independentemente do nome enviado pelo browser)
  app.post('/upload-youtube-cookies', auth, async (request: any, reply) => {
    const data = await request.file()
    if (!data) return reply.status(400).send({ error: 'Nenhum arquivo enviado' })

    const cookiesPath = config.ytdlp?.cookiesFile
    if (!cookiesPath) return reply.status(400).send({ error: 'Caminho de cookies não configurado (YTDLP_COOKIES_FILE)' })

    const buffer = await data.toBuffer()
    if (!buffer.length) return reply.status(400).send({ error: 'Arquivo vazio' })

    const content = buffer.toString('utf-8')

    // Validação mínima — exige pelo menos uma linha que não seja comentário
    const dataLines = content.split('\n').filter((l: string) => l.trim() && !l.startsWith('#'))
    if (dataLines.length === 0) {
      return reply.status(400).send({ error: 'Arquivo de cookies vazio ou sem entradas válidas' })
    }

    try {
      fs.mkdirSync(path.dirname(cookiesPath), { recursive: true })
      fs.writeFileSync(cookiesPath, buffer)
    } catch (err: any) {
      console.error(`[settings] Erro ao gravar cookies em ${cookiesPath}:`, err.message)
      return reply.status(500).send({ error: `Erro ao gravar arquivo: ${err.message}` })
    }

    console.log(`[settings] YouTube cookies gravados: ${cookiesPath} (${dataLines.length} entradas, arquivo: ${data.filename})`)
    return { ok: true, cookies: dataLines.length }
  })

  // Status das cookies do YouTube + se a resolução yt-dlp está habilitada neste servidor
  app.get('/youtube-cookies-status', auth, async () => {
    const enabled = isYoutubeContentEnabled()
    const cookiesPath = config.ytdlp?.cookiesFile
    if (!cookiesPath || !fs.existsSync(cookiesPath)) return { exists: false, lines: 0, updatedAt: null, enabled }
    const stat = fs.statSync(cookiesPath)
    const content = fs.readFileSync(cookiesPath, 'utf-8')
    const lines = content.split('\n').filter((l: string) => l.trim() && !l.startsWith('#')).length
    return { exists: true, lines, updatedAt: stat.mtime.toISOString(), enabled }
  })
}
