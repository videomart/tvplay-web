import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ClipModality, Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'

const clipSchema = z.object({
  code: z.string().min(1),
  title: z.string().min(1),
  modality: z.nativeEnum(ClipModality).optional(),
  cueIn: z.number().min(0).optional(),
  cueOut: z.number().min(0).optional().nullable(),
  validUntil: z.string().datetime().optional().nullable(),
  isLive: z.boolean().optional(),
  notes: z.string().optional().nullable(),
  clientId: z.string().optional().nullable(),
  typeId:    z.string().optional().nullable(),
  mediaId:   z.string().optional().nullable(),
  graphicId: z.string().optional().nullable(),
})

export default async function clipRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] }

  app.get('/', auth, async (request: any) => {
    const { search, modality, clientId, typeId, page = '1', limit = '50', sortBy = 'title', sortDir = 'asc' } = request.query
    const dir: 'asc' | 'desc' = sortDir === 'desc' ? 'desc' : 'asc'

    const where: any = { active: true }
    if (search) where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { code: { contains: search, mode: 'insensitive' } },
    ]
    if (modality) where.modality = modality
    if (clientId) where.clientId = clientId
    if (typeId) where.typeId = typeId

    const orderByMap: Record<string, any> = {
      code:     { code: dir },
      title:    { title: dir },
      modality: { modality: dir },
      client:   [{ client: { name: dir } }, { title: 'asc' }],
      duration: [{ media: { duration: dir } }, { title: 'asc' }],
      media:    { mediaId: { sort: dir, nulls: dir === 'asc' ? 'first' : 'last' } },
    }
    const orderBy = orderByMap[sortBy] ?? { title: 'asc' }

    const skip = (parseInt(page) - 1) * parseInt(limit)
    const take = parseInt(limit)

    const [items, total] = await prisma.$transaction([
      prisma.clip.findMany({
        where,
        include: { client: true, type: true, media: { select: { duration: true, hlsPath: true, ingestStatus: true } }, graphic: { select: { id: true, name: true, logoUrl: true, logoPosition: true, showClock: true, lowerText: true } } },
        orderBy,
        skip,
        take,
      }),
      prisma.clip.count({ where }),
    ])

    return { items, total, page: parseInt(page), limit: parseInt(limit) }
  })

  // Rota estática deve vir antes de /:id
  app.get('/next-code', auth, async (request: any, reply) => {
    const prefix = ((request.query.prefix as string) ?? '').toUpperCase()
    if (!prefix) return reply.status(400).send({ error: 'prefix é obrigatório' })

    const clips = await prisma.clip.findMany({
      where: { code: { startsWith: prefix } },
      select: { code: true },
    })

    let max = 0
    for (const c of clips) {
      const n = parseInt(c.code.slice(prefix.length), 10)
      if (!isNaN(n) && n > max) max = n
    }

    return { code: `${prefix}${String(max + 1).padStart(6, '0')}` }
  })

  app.get('/:id', auth, async (request: any, reply) => {
    const clip = await prisma.clip.findUnique({
      where: { id: request.params.id },
      include: { client: true, type: true, media: { select: { id: true, hlsPath: true, duration: true, ingestStatus: true } }, graphic: { select: { id: true, name: true, logoUrl: true, logoPosition: true, showClock: true, lowerText: true } } },
    })
    if (!clip) return reply.status(404).send({ error: 'Clipe não encontrado' })
    return clip
  })

  app.post('/', auth, async (request, reply) => {
    const body = clipSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const exists = await prisma.clip.findUnique({ where: { code: body.data.code } })
    if (exists) return reply.status(409).send({ error: 'Código de clipe já cadastrado' })

    const clip = await prisma.clip.create({
      data: {
        ...body.data,
        validUntil: body.data.validUntil ? new Date(body.data.validUntil) : undefined,
      },
      include: { client: true, type: true, media: { select: { id: true, hlsPath: true, duration: true, ingestStatus: true } } },
    })
    return reply.status(201).send(clip)
  })

  app.put('/:id', auth, async (request: any, reply) => {
    const body = clipSchema.partial().safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    try {
      const clip = await prisma.clip.update({
        where: { id: request.params.id },
        data: {
          ...body.data,
          validUntil: body.data.validUntil !== undefined
            ? (body.data.validUntil ? new Date(body.data.validUntil) : null)
            : undefined,
        },
        include: { client: true, type: true, media: { select: { id: true, hlsPath: true, duration: true, ingestStatus: true } } },
      })
      return clip
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') return reply.status(404).send({ error: 'Clipe não encontrado' })
        if (err.code === 'P2002') return reply.status(409).send({ error: 'Código de clipe já cadastrado' })
        if (err.code === 'P2003') return reply.status(400).send({ error: 'Referência inválida (cliente, tipo ou mídia não encontrado)' })
      }
      console.error('[PUT /clips/:id]', err)
      return reply.status(500).send({ error: 'Erro interno ao atualizar clipe' })
    }
  })

  app.delete('/:id', auth, async (request: any, reply) => {
    await prisma.clip.update({
      where: { id: request.params.id },
      data: { active: false },
    }).catch(() => null)
    return reply.status(204).send()
  })
}
