import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { FallbackType } from '@prisma/client'
import { prisma } from '../lib/prisma'

const channelSchema = z.object({
  name: z.string().min(1),
  number: z.number().int().positive(),
  description: z.string().optional(),
  logoUrl: z.string().url().optional(),
  active: z.boolean().optional(),
  fallbackType: z.nativeEnum(FallbackType).optional(),
  fallbackSourceId: z.string().optional().nullable(),
  graphicTemplateId: z.string().optional().nullable(),
  scteEnabled: z.boolean().optional(),
})

const include = {
  fallbackSource:   { select: { id: true, name: true, type: true, url: true } },
  graphicTemplate:  { select: { id: true, name: true, active: true } },
}

export default async function channelRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] }

  app.get('/', auth, async () => {
    return prisma.channel.findMany({ include, orderBy: { number: 'asc' } })
  })

  app.get('/:id', auth, async (request: any, reply) => {
    const channel = await prisma.channel.findUnique({ where: { id: request.params.id }, include })
    if (!channel) return reply.status(404).send({ error: 'Canal não encontrado' })
    return channel
  })

  app.post('/', auth, async (request, reply) => {
    const body = channelSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const exists = await prisma.channel.findUnique({ where: { number: body.data.number } })
    if (exists) return reply.status(409).send({ error: 'Número de canal já cadastrado' })

    const channel = await prisma.channel.create({ data: body.data, include })
    return reply.status(201).send(channel)
  })

  app.put('/:id', auth, async (request: any, reply) => {
    const body = channelSchema.partial().safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const channel = await prisma.channel.update({
      where: { id: request.params.id },
      data: body.data,
      include,
    }).catch(() => null)

    if (!channel) return reply.status(404).send({ error: 'Canal não encontrado' })
    return channel
  })

  app.delete('/:id', auth, async (request: any, reply) => {
    await prisma.channel.delete({ where: { id: request.params.id } }).catch(() => null)
    return reply.status(204).send()
  })
}
