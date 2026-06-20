import { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { z } from 'zod'
import { UserLevel } from '@prisma/client'
import { prisma } from '../lib/prisma'

const createSchema = z.object({
  name:     z.string().min(1),
  username: z.string().min(3).max(32).regex(/^[a-z0-9_]+$/, 'Apenas letras minúsculas, números e _'),
  email:    z.string().email().optional().nullable(),
  password: z.string().min(6),
  level:    z.nativeEnum(UserLevel).default('OPERATOR'),
  active:   z.boolean().optional(),
})

const updateSchema = createSchema.partial().omit({ password: true }).extend({
  password: z.string().min(6).optional(),
})

function requireAdmin(request: any, reply: any, done: () => void) {
  if (request.user?.level !== 'ADMIN') {
    return reply.status(403).send({ error: 'Acesso restrito a administradores' })
  }
  done()
}

export default async function usersRoutes(app: FastifyInstance) {
  const auth  = { preHandler: [app.authenticate] }
  const admin = { preHandler: [app.authenticate, requireAdmin] }

  app.get('/', auth, async () =>
    prisma.user.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, username: true, email: true, level: true, active: true, createdAt: true, updatedAt: true },
    })
  )

  app.get('/:id', auth, async (request: any, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.params.id },
      select: { id: true, name: true, username: true, email: true, level: true, active: true, createdAt: true, updatedAt: true },
    })
    if (!user) return reply.status(404).send({ error: 'Usuário não encontrado' })
    return user
  })

  app.post('/', admin, async (request, reply) => {
    const body = createSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const exists = await prisma.user.findUnique({ where: { username: body.data.username } })
    if (exists) return reply.status(409).send({ error: 'Username já em uso' })

    const hashed = await bcrypt.hash(body.data.password, 10)
    const user = await prisma.user.create({
      data: { ...body.data, password: hashed },
      select: { id: true, name: true, username: true, level: true, active: true, createdAt: true },
    })
    return reply.status(201).send(user)
  })

  app.put('/:id', admin, async (request: any, reply) => {
    const body = updateSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const data: any = { ...body.data }
    if (data.password) {
      data.password = await bcrypt.hash(data.password, 10)
    } else {
      delete data.password
    }

    if (data.username) {
      const conflict = await prisma.user.findFirst({
        where: { username: data.username, NOT: { id: request.params.id } },
      })
      if (conflict) return reply.status(409).send({ error: 'Username já em uso' })
    }

    const user = await prisma.user.update({
      where: { id: request.params.id },
      data,
      select: { id: true, name: true, username: true, level: true, active: true, updatedAt: true },
    }).catch(() => null)

    if (!user) return reply.status(404).send({ error: 'Usuário não encontrado' })
    return user
  })

  app.delete('/:id', admin, async (request: any, reply) => {
    const me = (request as any).user?.sub
    if (request.params.id === me) return reply.status(400).send({ error: 'Não é possível remover o próprio usuário' })
    await prisma.user.update({
      where: { id: request.params.id },
      data: { active: false },
    }).catch(() => null)
    return reply.status(204).send()
  })

  // Admin gera uma senha temporária para o usuário — útil quando ele esqueceu
  // a senha e não tem (ou não consegue usar) email cadastrado para reset.
  app.post('/:id/reset-password', admin, async (request: any, reply) => {
    const tempPassword = crypto.randomBytes(6).toString('hex')
    const hashed = await bcrypt.hash(tempPassword, 10)

    const user = await prisma.user.update({
      where: { id: request.params.id },
      data: { password: hashed, resetToken: null, resetTokenExpiry: null },
      select: { id: true, name: true, username: true },
    }).catch(() => null)

    if (!user) return reply.status(404).send({ error: 'Usuário não encontrado' })
    return reply.send({ ...user, tempPassword })
  })
}
