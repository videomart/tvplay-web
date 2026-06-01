import { FastifyInstance } from 'fastify'
import path from 'path'
import fs from 'fs'
import { prisma } from '../lib/prisma'
import { storageService } from '../services/storage.service'
import { setClockOffsetHours } from '../services/stream.service'
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
      companyName, logoUrl, email,
      defaultMonitorOpen, defaultFallbackOpen,
      defaultOutputsOpen, defaultPlaylistOpen,
      clockOffsetHours, defaultBreakDuration, defaultSlideDuration, defaultUrlDuration,
    } = request.body as {
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
    }

    const result = await prisma.systemSettings.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        companyName: companyName ?? 'TVPlay',
        logoUrl: logoUrl ?? null,
        email: email ?? null,
        defaultMonitorOpen:   defaultMonitorOpen   ?? true,
        defaultFallbackOpen:  defaultFallbackOpen  ?? true,
        defaultOutputsOpen:   defaultOutputsOpen   ?? true,
        defaultPlaylistOpen:  defaultPlaylistOpen  ?? true,
        clockOffsetHours:     clockOffsetHours     ?? 0,
        defaultBreakDuration: defaultBreakDuration ?? 300,
        defaultSlideDuration: defaultSlideDuration ?? 15,
        defaultUrlDuration:   defaultUrlDuration   ?? 0,
      },
      update: {
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
      },
    })

    // Aplica imediatamente no stream service (novos processos FFmpeg usarão o TZ atualizado)
    if (clockOffsetHours !== undefined) setClockOffsetHours(clockOffsetHours)

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

  // Upload do arquivo de cookies do YouTube (substitui /app/youtube-cookies.txt)
  app.post('/upload-youtube-cookies', auth, async (request: any, reply) => {
    const data = await request.file()
    if (!data) return reply.status(400).send({ error: 'Nenhum arquivo enviado' })

    const cookiesPath = config.ytdlp?.cookiesFile
    if (!cookiesPath) return reply.status(400).send({ error: 'Caminho de cookies não configurado (YTDLP_COOKIES_FILE)' })

    const buffer = await data.toBuffer()
    const content = buffer.toString('utf-8')

    // Valida que é um arquivo Netscape cookies (yt-dlp format)
    if (!content.includes('youtube.com') && !content.includes('# Netscape HTTP Cookie File')) {
      return reply.status(400).send({ error: 'Arquivo não parece ser um cookies.txt válido do YouTube' })
    }

    fs.writeFileSync(cookiesPath, buffer)
    const lines = content.split('\n').filter((l: string) => l.trim() && !l.startsWith('#')).length
    console.log(`[settings] YouTube cookies atualizados: ${cookiesPath} (${lines} cookies)`)
    return { ok: true, cookies: lines }
  })

  // Status das cookies do YouTube
  app.get('/youtube-cookies-status', auth, async () => {
    const cookiesPath = config.ytdlp?.cookiesFile
    if (!cookiesPath || !fs.existsSync(cookiesPath)) return { exists: false, lines: 0, updatedAt: null }
    const stat = fs.statSync(cookiesPath)
    const content = fs.readFileSync(cookiesPath, 'utf-8')
    const lines = content.split('\n').filter((l: string) => l.trim() && !l.startsWith('#')).length
    return { exists: true, lines, updatedAt: stat.mtime.toISOString() }
  })
}
