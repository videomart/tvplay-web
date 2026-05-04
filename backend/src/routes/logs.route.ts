import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma'

const querySchema = z.object({
  search:    z.string().optional(),
  channelId: z.string().optional(),
  dateFrom:  z.string().optional(),
  dateTo:    z.string().optional(),
  exhibited: z.enum(['true', 'false']).optional(),
  page:      z.coerce.number().int().positive().default(1),
  limit:     z.coerce.number().int().positive().max(200).default(100),
})

export default async function logsRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] }

  app.get('/', auth, async (request, reply) => {
    const q = querySchema.safeParse(request.query)
    if (!q.success) return reply.status(400).send({ error: q.error.flatten() })

    const { search, channelId, dateFrom, dateTo, exhibited, page, limit } = q.data
    const skip = (page - 1) * limit

    const where: any = {}

    if (search) {
      where.OR = [
        { title:   { contains: search, mode: 'insensitive' } },
        { program: { contains: search, mode: 'insensitive' } },
        { client:  { contains: search, mode: 'insensitive' } },
      ]
    }

    if (exhibited !== undefined) where.exhibited = exhibited === 'true'

    if (dateFrom || dateTo) {
      where.startedAt = {}
      if (dateFrom) where.startedAt.gte = new Date(dateFrom)
      if (dateTo)   where.startedAt.lte = new Date(dateTo + 'T23:59:59.999Z')
    }

    if (channelId) {
      where.playlist = { channelId }
    }

    const [total, items] = await prisma.$transaction([
      prisma.log.count({ where }),
      prisma.log.findMany({
        where,
        skip,
        take: limit,
        orderBy: { startedAt: 'desc' },
        include: {
          playlist: { select: { id: true, name: true, channel: { select: { id: true, name: true, number: true } } } },
          user:     { select: { id: true, name: true } },
        },
      }),
    ])

    return { total, page, limit, items }
  })

  app.delete('/:id', auth, async (request: any, reply) => {
    await prisma.log.delete({ where: { id: request.params.id } }).catch(() => null)
    return reply.status(204).send()
  })
}
