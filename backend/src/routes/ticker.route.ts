import { FastifyInstance } from 'fastify'
import { fetchRssHeadlines } from '../services/ticker.service'

export default async function tickerRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] }

  // Proxy RSS → evita CORS no browser do operador
  app.get('/rss', auth, async (request: any, reply) => {
    const url = request.query?.url as string | undefined
    if (!url) return reply.status(400).send({ error: 'Parâmetro url obrigatório' })
    try {
      const headlines = await fetchRssHeadlines(url)
      return { headlines, text: headlines.join('   |   ') }
    } catch (e: any) {
      return reply.status(502).send({ error: `Falha ao buscar RSS: ${e.message}` })
    }
  })
}
