import { FastifyInstance } from 'fastify'
import { getSystemMetrics } from '../services/system-metrics.service'

export default async function systemRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] }

  app.get('/metrics', auth, async () => getSystemMetrics())
}
