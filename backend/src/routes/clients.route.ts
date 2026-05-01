import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma'

const clientSchema = z.object({
  name: z.string().min(1),
  document: z.string().optional(),
  contact: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  active: z.boolean().optional(),
})

export default async function clientRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] }

  app.get('/', auth, async (request: any) => {
    const search = request.query.search as string | undefined
    return prisma.client.findMany({
      where: search
        ? { name: { contains: search, mode: 'insensitive' }, active: true }
        : { active: true },
      orderBy: { name: 'asc' },
    })
  })

  app.get('/:id', auth, async (request: any, reply) => {
    const client = await prisma.client.findUnique({ where: { id: request.params.id } })
    if (!client) return reply.status(404).send({ error: 'Cliente não encontrado' })
    return client
  })

  app.post('/', auth, async (request, reply) => {
    const body = clientSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const client = await prisma.client.create({ data: body.data })
    return reply.status(201).send(client)
  })

  app.put('/:id', auth, async (request: any, reply) => {
    const body = clientSchema.partial().safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const client = await prisma.client.update({
      where: { id: request.params.id },
      data: body.data,
    }).catch(() => null)

    if (!client) return reply.status(404).send({ error: 'Cliente não encontrado' })
    return client
  })

  app.delete('/:id', auth, async (request: any, reply) => {
    await prisma.client.update({
      where: { id: request.params.id },
      data: { active: false },
    }).catch(() => null)
    return reply.status(204).send()
  })
}
