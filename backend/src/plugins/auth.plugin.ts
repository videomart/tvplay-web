import { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import fastifyJwt from '@fastify/jwt'
import { config } from '../config'

async function authPlugin(app: FastifyInstance) {
  await app.register(fastifyJwt, {
    secret: config.jwtSecret,
    sign: { expiresIn: config.jwtExpiresIn },
  })

  app.decorate('authenticate', async (request: any, reply: any) => {
    try {
      await request.jwtVerify()
    } catch {
      reply.status(401).send({ error: 'Token inválido ou expirado' })
    }
  })
}

export default fp(authPlugin)
