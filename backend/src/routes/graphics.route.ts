import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import path from 'path'
import { prisma } from '../lib/prisma'
import { storageService } from '../services/storage.service'

const schema = z.object({
  name:        z.string().min(1),
  logoUrl:     z.string().optional().nullable(),
  logoPosition: z.string().optional().nullable(),
  showClock:   z.boolean().optional(),
  lowerText:   z.string().optional().nullable(),
  active:      z.boolean().optional(),
})

export default async function graphicRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] }

  app.get('/', auth, async () =>
    prisma.graphic.findMany({ orderBy: { name: 'asc' } })
  )

  app.post('/', auth, async (request, reply) => {
    const body = schema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })
    const graphic = await prisma.graphic.create({ data: body.data })
    return reply.status(201).send(graphic)
  })

  app.put('/:id', auth, async (request: any, reply) => {
    const body = schema.partial().safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })
    const graphic = await prisma.graphic.update({
      where: { id: request.params.id },
      data: body.data,
    }).catch(() => null)
    if (!graphic) return reply.status(404).send({ error: 'Gráfico não encontrado' })
    return graphic
  })

  app.delete('/:id', auth, async (request: any, reply) => {
    await prisma.graphic.delete({ where: { id: request.params.id } }).catch(() => null)
    return reply.status(204).send()
  })

  // Upload de imagem para uso como logo de gráfico
  app.post('/upload-image', auth, async (request: any, reply) => {
    const data = await request.file()
    if (!data) return reply.status(400).send({ error: 'Nenhum arquivo enviado' })

    const allowedMimes = ['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp']
    if (!allowedMimes.includes(data.mimetype)) {
      return reply.status(415).send({ error: 'Formato não suportado. Use PNG, SVG, JPEG ou WebP.' })
    }

    const ext = path.extname(data.filename).toLowerCase() || '.png'
    const objectName = `graphics/img-${Date.now()}${ext}`
    const buffer = await data.toBuffer()
    await storageService.uploadBuffer(objectName, buffer, data.mimetype)

    const imageUrl = `/api/graphics/image/${path.basename(objectName)}`
    return { imageUrl }
  })

  // Serve imagem de gráfico do MinIO (sem auth — usada pelo FFmpeg e pelo browser)
  app.get('/image/:filename', async (request: any, reply) => {
    const objectName = `graphics/${request.params.filename}`
    try {
      const stat = await storageService.getObjectStat(objectName)
      const stream = await storageService.getObjectStream(objectName)
      const ext = path.extname(request.params.filename).toLowerCase()
      const mime: Record<string, string> = {
        '.png': 'image/png', '.svg': 'image/svg+xml',
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
      }
      reply.header('Content-Type', mime[ext] ?? 'image/png')
      reply.header('Content-Length', stat.size)
      reply.header('Cache-Control', 'public, max-age=86400')
      return reply.send(stream)
    } catch {
      return reply.status(404).send({ error: 'Imagem não encontrada' })
    }
  })
}
