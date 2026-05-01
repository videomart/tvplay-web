import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma'

const typeSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1).max(4).toUpperCase(),
  fontColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  fontBackColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  active: z.boolean().optional(),
})

export default async function clipTypeRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] }

  app.get('/', auth, async () => {
    return prisma.clipType.findMany({ orderBy: { name: 'asc' } })
  })

  app.get('/:id', auth, async (request: any, reply) => {
    const type = await prisma.clipType.findUnique({ where: { id: request.params.id } })
    if (!type) return reply.status(404).send({ error: 'Tipo não encontrado' })
    return type
  })

  app.post('/', auth, async (request, reply) => {
    const body = typeSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const exists = await prisma.clipType.findUnique({ where: { code: body.data.code } })
    if (exists) return reply.status(409).send({ error: 'Código já cadastrado' })

    const type = await prisma.clipType.create({ data: body.data })
    return reply.status(201).send(type)
  })

  app.put('/:id', auth, async (request: any, reply) => {
    const body = typeSchema.partial().safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const type = await prisma.clipType.update({
      where: { id: request.params.id },
      data: body.data,
    }).catch(() => null)

    if (!type) return reply.status(404).send({ error: 'Tipo não encontrado' })
    return type
  })

  app.delete('/:id', auth, async (request: any, reply) => {
    await prisma.clipType.update({
      where: { id: request.params.id },
      data: { active: false },
    }).catch(() => null)
    return reply.status(204).send()
  })
}
