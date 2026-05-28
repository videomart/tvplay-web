import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma'

const playlistSchema = z.object({
  date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name:      z.string().optional().nullable(),
  channelId: z.string().optional().nullable(),
  locked:    z.boolean().optional(),
  loop:      z.boolean().optional(),
  autoStart: z.boolean().optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  notes:     z.string().optional(),
  graphicId: z.string().optional().nullable(),
})

// Gera identificador automático no formato DDMMYY-N (ex: 040526-1)
async function generateName(date: Date): Promise<string> {
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const yy = String(date.getUTCFullYear()).slice(-2)
  const prefix = `${dd}${mm}${yy}`
  const count = await prisma.playlist.count({ where: { name: { startsWith: prefix } } })
  return `${prefix}-${count + 1}`
}

async function assertNotLocked(playlistId: string, reply: any): Promise<boolean> {
  const pl = await prisma.playlist.findUnique({ where: { id: playlistId }, select: { locked: true } })
  if (pl?.locked) {
    reply.status(403).send({ error: 'Playlist bloqueada. Desbloqueie antes de editar.' })
    return true
  }
  return false
}

const itemSchema = z.object({
  clipId:        z.string().min(1),
  order:         z.number().int().min(0).optional(),
  breakNum:      z.number().int().min(1).optional(),
  blockOrder:    z.number().int().min(1).optional(),
  scheduledAt:   z.string().datetime().optional().nullable(),
  overrideCueIn:  z.number().min(0).optional().nullable(),
  overrideCueOut: z.number().min(0).optional().nullable(),
  loop:          z.boolean().optional(),
  maxDuration:   z.number().int().min(1).optional().nullable(),
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

    const playlists = await prisma.playlist.findMany({
      where,
      include: {
        channel: { select: { id: true, name: true, number: true } },
        graphic: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
      orderBy: [{ date: 'desc' }, { name: 'asc' }],
    })

    const ids = playlists.map((p) => p.id)
    const noMediaItems = ids.length > 0
      ? await prisma.playlistItem.findMany({
          // Só conta clips FILE sem arquivo — clips URL (sourceType=URL) são considerados prontos
          where: { playlistId: { in: ids }, clip: { mediaId: null, sourceType: 'FILE' } },
          select: { playlistId: true },
        })
      : []
    const noMediaMap = noMediaItems.reduce(
      (m, i) => m.set(i.playlistId, (m.get(i.playlistId) ?? 0) + 1),
      new Map<string, number>()
    )

    return playlists.map((p) => ({ ...p, _noMediaCount: noMediaMap.get(p.id) ?? 0 }))
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
    const { date, name, channelId, notes, autoStart, startTime, locked, loop, graphicId } = body.data
    const dateObj = new Date(date)
    const resolvedName = name?.trim() ? name.trim() : await generateName(dateObj)
    const playlist = await prisma.playlist.create({
      data: { date: dateObj, name: resolvedName, channelId, notes, autoStart, startTime, locked, loop, graphicId },
      include: { channel: { select: { id: true, name: true, number: true } }, graphic: { select: { id: true, name: true } } },
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
      include: { channel: { select: { id: true, name: true, number: true } }, graphic: { select: { id: true, name: true } } },
    }).catch(() => null)
    if (!playlist) return reply.status(404).send({ error: 'Playlist não encontrada' })
    return playlist
  })

  app.delete('/:id', auth, async (request: any, reply) => {
    await prisma.playlist.delete({ where: { id: request.params.id } }).catch(() => null)
    return reply.status(204).send()
  })

  // Clona uma playlist (todos os itens) com um nome novo
  app.post('/:id/clone', auth, async (request: any, reply) => {
    const { name } = (request.body ?? {}) as { name?: string }
    const source = await prisma.playlist.findUnique({
      where: { id: request.params.id },
      include: { items: { orderBy: { order: 'asc' } } },
    })
    if (!source) return reply.status(404).send({ error: 'Playlist não encontrada' })

    const resolvedName = name?.trim() ? name.trim() : await generateName(new Date(source.date))
    const clone = await prisma.playlist.create({
      data: {
        date: source.date,
        name: resolvedName,
        channelId: source.channelId,
        notes: source.notes ?? undefined,
        autoStart: source.autoStart,
        startTime: source.startTime,
        loop: source.loop,
        graphicId: source.graphicId,
        items: {
          create: source.items.map((item) => ({
            clipId:         item.clipId ?? undefined,
            order:          item.order,
            breakNum:       item.breakNum,
            blockOrder:     item.blockOrder,
            isBreak:        item.isBreak,
            maxDuration:    item.maxDuration,
            loop:           item.loop,
            overrideCueIn:  item.overrideCueIn,
            overrideCueOut: item.overrideCueOut,
          })),
        },
      },
      include: { channel: { select: { id: true, name: true, number: true } }, _count: { select: { items: true } } },
    })
    return reply.status(201).send(clone)
  })

  // Adiciona ao final os itens de outro roteiro (append-from)
  app.post('/:id/append-from/:sourceId', auth, async (request: any, reply) => {
    const { id, sourceId } = request.params as { id: string; sourceId: string }
    if (await assertNotLocked(id, reply)) return

    const sourceItems = await prisma.playlistItem.findMany({
      where: { playlistId: sourceId },
      orderBy: { order: 'asc' },
    })
    if (sourceItems.length === 0) return reply.send({ appended: 0 })

    const maxPos = await prisma.playlistItem.aggregate({
      where: { playlistId: id },
      _max: { order: true },
    })
    const startOrder = (maxPos._max.order ?? -1) + 1

    await prisma.playlistItem.createMany({
      data: sourceItems.map((item, idx) => ({
        playlistId:     id,
        order:          startOrder + idx,
        breakNum:       item.breakNum,
        blockOrder:     item.blockOrder,
        clipId:         item.clipId ?? undefined,
        isBreak:        item.isBreak,
        maxDuration:    item.maxDuration,
        loop:           item.loop,
        overrideCueIn:  item.overrideCueIn,
        overrideCueOut: item.overrideCueOut,
        graphicId:      (item as any).graphicId ?? null,
      })),
    })
    return reply.send({ appended: sourceItems.length })
  })

  // Remove todos os itens de uma playlist sem deletar a playlist
  app.delete('/:id/items', auth, async (request: any, reply) => {
    if (await assertNotLocked(request.params.id, reply)) return
    await prisma.playlistItem.deleteMany({ where: { playlistId: request.params.id } })
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
