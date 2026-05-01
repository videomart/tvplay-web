import { FastifyInstance } from 'fastify'
import * as playout from '../services/playout.service'

export default async function playoutRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] }

  // Estado de todos os canais
  app.get('/states', auth, async () => playout.getAllStates())

  // Estado de um canal
  app.get('/:channelId/state', auth, async (request: any) =>
    playout.getState(request.params.channelId)
  )

  // Play
  app.post('/:channelId/play', auth, async (request: any, reply) => {
    const { playlistId } = request.body as { playlistId: string }
    if (!playlistId) return reply.status(400).send({ error: 'playlistId é obrigatório' })
    return playout.play(request.params.channelId, playlistId).catch((e) =>
      reply.status(400).send({ error: e.message })
    )
  })

  // Pause
  app.post('/:channelId/pause', auth, async (request: any, reply) =>
    playout.pause(request.params.channelId).catch((e) =>
      reply.status(400).send({ error: e.message })
    )
  )

  // Resume
  app.post('/:channelId/resume', auth, async (request: any, reply) =>
    playout.resume(request.params.channelId).catch((e) =>
      reply.status(400).send({ error: e.message })
    )
  )

  // Stop
  app.post('/:channelId/stop', auth, async (request: any, reply) =>
    playout.stop(request.params.channelId).catch((e) =>
      reply.status(400).send({ error: e.message })
    )
  )

  // Next
  app.post('/:channelId/next', auth, async (request: any, reply) =>
    playout.nextClip(request.params.channelId).catch((e) =>
      reply.status(400).send({ error: e.message })
    )
  )

  // Previous
  app.post('/:channelId/prev', auth, async (request: any, reply) =>
    playout.prevClip(request.params.channelId).catch((e) =>
      reply.status(400).send({ error: e.message })
    )
  )

  // Jump to item by index
  app.post('/:channelId/jump', auth, async (request: any, reply) => {
    const { index } = request.body as { index: number }
    if (index == null) return reply.status(400).send({ error: 'index é obrigatório' })
    return playout.jumpTo(request.params.channelId, index).catch((e) =>
      reply.status(400).send({ error: e.message })
    )
  })

  // WebSocket — subscribe ao estado de um canal em tempo real
  app.get('/:channelId/ws', { websocket: true }, (socket, request: any) => {
    const { channelId } = request.params
    playout.subscribeWS(channelId, socket)

    // Envia estado atual imediatamente ao conectar
    const state = playout.getState(channelId)
    socket.send(JSON.stringify({ event: 'state', data: state }))

    socket.on('close', () => playout.unsubscribeWS(channelId, socket))
  })
}
