import { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '../lib/prisma'

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

export default async function authRoutes(app: FastifyInstance) {
  app.post('/login', async (request, reply) => {
    const body = loginSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos' })

    const user = await prisma.user.findUnique({ where: { username: body.data.username } })
    if (!user || !user.active) return reply.status(401).send({ error: 'Credenciais inválidas' })

    const valid = await bcrypt.compare(body.data.password, user.password)
    if (!valid) return reply.status(401).send({ error: 'Credenciais inválidas' })

    const token = app.jwt.sign({ sub: user.id, username: user.username, level: user.level })

    return reply.send({
      token,
      user: { id: user.id, name: user.name, username: user.username, level: user.level },
    })
  })

  app.get(
    '/me',
    { preHandler: [app.authenticate] },
    async (request: any) => {
      const user = await prisma.user.findUnique({
        where: { id: request.user.sub },
        select: { id: true, name: true, username: true, level: true, active: true, createdAt: true },
      })
      return user
    },
  )
}
