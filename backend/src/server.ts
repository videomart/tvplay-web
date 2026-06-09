import Fastify from 'fastify'
import fastifyMultipart from '@fastify/multipart'
import fastifyWs from '@fastify/websocket'
import { config } from './config'
import authPlugin from './plugins/auth.plugin'
import corsPlugin from './plugins/cors.plugin'
import { registerRoutes } from './routes'
import { initFromDb, handleStreamFailure, resolveSourceUrl, handleScteInputEvent } from './services/playout.service'
import { setStreamFailureCallback, setClockOffsetHours, startRelayCycleWatcher } from './services/stream.service'
import { setUrlResolver, initActiveInputs } from './services/active-inputs.service'
import { onScteInputEvent } from './services/scte35-watcher.service'
import { startScheduler } from './services/scheduler.service'
import { prisma } from './lib/prisma'

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

  setStreamFailureCallback(handleStreamFailure)
  // Câmera é fonte persistente — NÃO para ao trocar clipes ou comutar saídas

  // Carrega offset do relógio das configurações do sistema
  const sysSettings = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } })
  if (sysSettings?.clockOffsetHours) setClockOffsetHours(sysSettings.clockOffsetHours)

  // Injeta resolver de URL no serviço de entradas ativas (quebra dep. circular)
  setUrlResolver(resolveSourceUrl)

  await initFromDb()
  await initActiveInputs()

  // Registra callback para eventos SCTE-35 detectados nas entradas monitoradas
  onScteInputEvent(async (sourceId, ev) => {
    const src = await prisma.inputSource.findUnique({
      where: { id: sourceId },
      select: { scteAction: true },
    }).catch(() => null)
    handleScteInputEvent(sourceId, ev.outOfNetwork, ev.durationSecs, src?.scteAction ?? 'LOG').catch(() => {})
  })

  startScheduler()
  startRelayCycleWatcher()
}

bootstrap().catch((err) => {
  console.error(err)
  process.exit(1)
})
