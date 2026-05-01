import { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import fastifyCors from '@fastify/cors'

async function corsPlugin(app: FastifyInstance) {
  await app.register(fastifyCors, {
    origin: ['http://localhost:3000', 'http://localhost:5173'],
    credentials: true,
  })
}

export default fp(corsPlugin)
