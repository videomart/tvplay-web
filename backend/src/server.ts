import Fastify from 'fastify'
import fastifyMultipart from '@fastify/multipart'
import fastifyWs from '@fastify/websocket'
import { config } from './config'
import authPlugin from './plugins/auth.plugin'
import corsPlugin from './plugins/cors.plugin'
import { registerRoutes } from './routes'

const app = Fastify({
  logger: {
    transport:
      config.nodeEnv === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
})

async function bootstrap() {
  await app.register(corsPlugin)
  await app.register(authPlugin)
  await app.register(fastifyMultipart, {
    limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10 GB
  })
  await app.register(fastifyWs)

  await registerRoutes(app)

  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

  await app.listen({ port: config.port, host: '0.0.0.0' })
  app.log.info(`TVPlay API rodando na porta ${config.port}`)
}

bootstrap().catch((err) => {
  console.error(err)
  process.exit(1)
})
