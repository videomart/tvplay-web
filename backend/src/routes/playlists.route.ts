import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma'

const playlistSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  programName: z.string().min(1),
  channelId: z.string().min(1),
  locked: z.boolean().optional(),
  autoStart: z.boolean().optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  notes: z.string().optional(),
})

async function assertNotLocked(playlistId: string, reply: any): Promise<boolean> {
  const pl = await prisma.playlist.findUnique({ where: { id: playlistId }, select: { locked: true } })
  if (pl?.locked) {
    reply.status(403).send({ error: 'Playlist bloqueada. Desbloqueie antes de editar.' })
    return true
  }
  return false
}

const itemSchema = z.object({
  clipId: z.string().min(1),
  order: z.number().int().min(0).optional(),
  breakNum: z.number().int().min(1).optional(),
  blockOrder: z.number().int().min(1).optional(),
  scheduledAt: z.string().datetime().optional().nullable(),
  overrideCueIn: z.number().min(0).optional().nullable(),
  overrideCueOut: z.number().min(0).optional().nullable(),
  loop: z.boolean().optional(),
})

const reorderSchema = z.array(z.object({ id: z.string(), order: z.number().int() }))

export default async function playlistRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] }

  // ─── Playlists ────────────────────────────────────────────────────────────

  app.get('/', auth, async (request: any) => {
    const { channelId, date } = request.query
    const where: any = {}
    if (channelId) where.channelId = channelId
    if (date) where.date = new Date(date)
    return prisma.playlist.findMany({
      where,
      include: {
        channel: { select: { id: true, name: true, number: true } },
        _count: { select: { items: true } },
      },
      orderBy: [{ date: 'desc' }, { programName: 'asc' }],
    })
  })

  app.get('/:id', auth, async (request: any, reply) => {
    const playlist = await prisma.playlist.findUnique({
      where: { id: request.params.id },
      include: {
        channel: { select: { id: true, name: true, number: true } },
        items: {
          include: {
            clip: {
              include: {
                client: { select: { name: true } },
                type: { select: { name: true, code: true, fontColor: true, fontBackColor: true } },
                media: { select: { duration: true, hlsPath: true, ingestStatus: true } },
              },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
    })
    if (!playlist) return reply.status(404).send({ error: 'Playlist não encontrada' })
    return playlist
  })

  app.post('/', auth, async (request, reply) => {
    const body = playlistSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })
    const { date, programName, channelId, notes } = body.data
    const playlist = await prisma.playlist.create({
      data: { date: new Date(date), programName, channelId, notes },
      include: { channel: { select: { id: true, name: true, number: true } } },
    })
    return reply.status(201).send(playlist)
  })

  app.put('/:id', auth, async (request: any, reply) => {
    const body = playlistSchema.partial().safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })
    const data: any = { ...body.data }
    if (data.date) data.date = new Date(data.date)
    const playlist = await prisma.playlist.update({
      where: { id: request.params.id },
      data,
      include: { channel: { select: { id: true, name: true, number: true } } },
    }).catch(() => null)
    if (!playlist) return reply.status(404).send({ error: 'Playlist não encontrada' })
    return playlist
  })

  app.delete('/:id', auth, async (request: any, reply) => {
    await prisma.playlist.delete({ where: { id: request.params.id } }).catch(() => null)
    return reply.status(204).send()
  })

  // ─── Itens ────────────────────────────────────────────────────────────────

  app.post('/:id/items', auth, async (request: any, reply) => {
    if (await assertNotLocked(request.params.id, reply)) return
    const body = itemSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })
    const maxOrder = await prisma.playlistItem.aggregate({
      where: { playlistId: request.params.id },
      _max: { order: true },
    })
    const order = body.data.order ?? (maxOrder._max.order ?? -1) + 1
    const item = await prisma.playlistItem.create({
      data: {
        playlistId: request.params.id,
        clipId: body.data.clipId,
        order,
        breakNum: body.data.breakNum ?? 1,
        blockOrder: body.data.blockOrder ?? 1,
        scheduledAt: body.data.scheduledAt ? new Date(body.data.scheduledAt) : null,
        overrideCueIn: body.data.overrideCueIn,
        overrideCueOut: body.data.overrideCueOut,
      },
      include: {
        clip: {
          include: {
            client: { select: { name: true } },
            type: { select: { name: true, code: true, fontColor: true, fontBackColor: true } },
            media: { select: { duration: true, hlsPath: true, ingestStatus: true } },
          },
        },
      },
    })
    return reply.status(201).send(item)
  })

  app.put('/:id/items/:itemId', auth, async (request: any, reply) => {
    if (await assertNotLocked(request.params.id, reply)) return
    const body = itemSchema.partial().safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })
    const item = await prisma.playlistItem.update({
      where: { id: request.params.itemId },
      data: {
        ...body.data,
        scheduledAt: body.data.scheduledAt ? new Date(body.data.scheduledAt) : undefined,
      },
      include: {
        clip: {
          include: {
            client: { select: { name: true } },
            type: { select: { name: true, code: true, fontColor: true, fontBackColor: true } },
            media: { select: { duration: true, hlsPath: true } },
          },
        },
      },
    }).catch(() => null)
    if (!item) return reply.status(404).send({ error: 'Item não encontrado' })
    return item
  })

  app.delete('/:id/items/:itemId', auth, async (request: any, reply) => {
    if (await assertNotLocked(request.params.id, reply)) return
    await prisma.playlistItem.delete({ where: { id: request.params.itemId } }).catch(() => null)
    return reply.status(204).send()
  })

  // Reordenar itens em massa (drag-and-drop)
  app.put('/:id/reorder', auth, async (request: any, reply) => {
    if (await assertNotLocked(request.params.id, reply)) return
    const body = reorderSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })
    await prisma.$transaction(
      body.data.map(({ id, order }) => prisma.playlistItem.update({ where: { id }, data: { order } }))
    )
    return reply.status(204).send()
  })
}
