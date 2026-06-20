import { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { config } from '../config'
import { sendPasswordResetEmail } from '../services/email.service'

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

const forgotPasswordSchema = z.object({
  email: z.string().email(),
})

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(6),
})

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hora

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

  // Solicita o reset de senha — envia email com link contendo token, se o
  // usuário com esse email existir. Resposta sempre genérica (não revela se o
  // email está cadastrado, evita enumeração de contas).
  app.post('/forgot-password', async (request, reply) => {
    const body = forgotPasswordSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: 'Email inválido' })

    const genericResponse = { message: 'Se o email estiver cadastrado, você receberá instruções para redefinir a senha.' }

    const user = await prisma.user.findUnique({ where: { email: body.data.email } })
    if (!user || !user.active) return reply.send(genericResponse)

    const resetToken = crypto.randomBytes(32).toString('hex')
    const resetTokenExpiry = new Date(Date.now() + RESET_TOKEN_TTL_MS)
    await prisma.user.update({ where: { id: user.id }, data: { resetToken, resetTokenExpiry } })

    const resetUrl = `${config.frontendUrl}/reset-password?token=${resetToken}`
    try {
      await sendPasswordResetEmail(user.email!, user.name, resetUrl)
    } catch (err: any) {
      app.log.error(`[auth/forgot-password] falha ao enviar email: ${err.message}`)
      return reply.status(503).send({ error: 'Não foi possível enviar o email — tente novamente mais tarde ou peça ao administrador para redefinir sua senha.' })
    }

    return reply.send(genericResponse)
  })

  // Redefine a senha a partir do token recebido por email.
  app.post('/reset-password', async (request, reply) => {
    const body = resetPasswordSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos — a senha deve ter ao menos 6 caracteres' })

    const user = await prisma.user.findUnique({ where: { resetToken: body.data.token } })
    if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
      return reply.status(400).send({ error: 'Link inválido ou expirado — solicite um novo reset de senha' })
    }

    const hashed = await bcrypt.hash(body.data.password, 10)
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashed, resetToken: null, resetTokenExpiry: null },
    })

    return reply.send({ message: 'Senha redefinida com sucesso' })
  })
}
