import { FastifyInstance } from 'fastify'
import * as playout from '../services/playout.service'
import * as streamService from '../services/stream.service'
import { prisma } from '../lib/prisma'

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

  // Corta imediatamente para uma fonte de entrada (interrompe playlist se ativa)
  app.post('/:channelId/cut-to-input', auth, async (request: any, reply) => {
    const { sourceId } = request.body as { sourceId: string }
    if (!sourceId) return reply.status(400).send({ error: 'sourceId é obrigatório' })
    return playout.cutToInput(request.params.channelId, sourceId).catch((e) =>
      reply.status(400).send({ error: e.message })
    )
  })

  // Saídas do canal com status de streaming em tempo real
  app.get('/:channelId/outputs', auth, async (request: any) => {
    const { channelId } = request.params
    const outputs = await prisma.streamOutput.findMany({
      where: { channelId },
      orderBy: { name: 'asc' },
    })
    const streaming = streamService.getStreamingStatus()
    const activeForChannel = new Set((streaming[channelId] ?? []).map((s) => s.outputId))
    return outputs.map((o) => ({
      id:          o.id,
      name:        o.name,
      description: o.description,
      type:        o.type,
      url:         o.url,
      streamKey:   o.streamKey,
      active:      o.active,
      streaming:   activeForChannel.has(o.id),
    }))
  })

  // Toggle ativo/inativo de uma saída — para o FFmpeg se estiver rodando
  app.post('/:channelId/outputs/:outputId/toggle', auth, async (request: any, reply) => {
    const { channelId, outputId } = request.params
    const output = await prisma.streamOutput.findUnique({ where: { id: outputId } })
    if (!output || output.channelId !== channelId)
      return reply.status(404).send({ error: 'Saída não encontrada neste canal' })

    const newActive = !output.active
    await prisma.streamOutput.update({ where: { id: outputId }, data: { active: newActive } })

    if (!newActive) {
      // Desativando — para o processo FFmpeg
      streamService.stopOutput(channelId, outputId)
    } else {
      // Ativando — inicia se o canal estiver reproduzindo
      const state = playout.getState(channelId)
      if (state.status === 'PLAYING' && state.currentItem?.mediaId) {
        await streamService.startOutput(channelId, outputId, state.currentItem.mediaId, state.currentItem.cueIn)
      }
    }

    return { id: outputId, active: newActive }
  })

  // Reconectar uma saída — reinicia o processo FFmpeg com o clipe atual
  app.post('/:channelId/outputs/:outputId/reconnect', auth, async (request: any, reply) => {
    const { channelId, outputId } = request.params
    const output = await prisma.streamOutput.findUnique({ where: { id: outputId } })
    if (!output || output.channelId !== channelId)
      return reply.status(404).send({ error: 'Saída não encontrada neste canal' })
    if (!output.active)
      return reply.status(400).send({ error: 'Saída está desativada' })

    const state = playout.getState(channelId)
    if (state.status !== 'PLAYING' && state.status !== 'PAUSED')
      return reply.status(400).send({ error: 'Canal não está em reprodução' })
    if (!state.currentItem?.mediaId)
      return reply.status(400).send({ error: 'Nenhuma mídia em reprodução' })

    await streamService.reconnectOutput(channelId, outputId, state.currentItem.mediaId, state.currentItem.cueIn)
    return { ok: true }
  })

  // Itens da playlist ativa — para exibição no painel operacional
  app.get('/:channelId/items', auth, async (request: any) => {
    const state = playout.getState(request.params.channelId)
    if (!state.playlistId) return []

    const items = await prisma.playlistItem.findMany({
      where: { playlistId: state.playlistId },
      include: {
        clip: {
          include: {
            client: { select: { name: true } },
            type: { select: { code: true, fontColor: true, fontBackColor: true } },
            media: { select: { duration: true } },
          },
        },
      },
      orderBy: { order: 'asc' },
    })

    return items.map((item, idx) => {
      const clip = item.clip
      const cueIn = item.overrideCueIn ?? clip.cueIn
      const cueOut = item.overrideCueOut ?? clip.cueOut ?? clip.media?.duration ?? null
      const duration = cueOut ? cueOut - cueIn : (clip.media?.duration ?? clip.duration ?? 30)
      return {
        id: item.id,
        index: idx,
        order: item.order,
        code: clip.code,
        title: clip.title,
        typeCode: clip.type?.code ?? null,
        typeBg: clip.type?.fontBackColor ?? null,
        typeColor: clip.type?.fontColor ?? null,
        duration,
        loop: item.loop,
        clientName: clip.client?.name ?? null,
        breakNum: item.breakNum,
      }
    })
  })

  // Insere clipe ao vivo após o item atual
  app.post('/:channelId/insert', auth, async (request: any, reply) => {
    const { clipId } = request.body as { clipId: string }
    if (!clipId) return reply.status(400).send({ error: 'clipId é obrigatório' })
    return playout.insertClip(request.params.channelId, clipId).catch((e) =>
      reply.status(400).send({ error: e.message })
    )
  })

  // Remove item da playlist ativa
  app.delete('/:channelId/items/:itemId', auth, async (request: any, reply) =>
    playout.removeItem(request.params.channelId, request.params.itemId).catch((e) =>
      reply.status(400).send({ error: e.message })
    )
  )

  // Toggle loop de um item da playlist — atualiza DB e estado em memória
  app.post('/:channelId/items/:itemId/toggle-loop', auth, async (request: any, reply) => {
    const { channelId, itemId } = request.params
    const item = await prisma.playlistItem.findUnique({ where: { id: itemId } })
    if (!item) return reply.status(404).send({ error: 'Item não encontrado' })

    const newLoop = !item.loop
    await prisma.playlistItem.update({ where: { id: itemId }, data: { loop: newLoop } })
    playout.updateCurrentItemLoop(channelId, itemId, newLoop)

    return { id: itemId, loop: newLoop }
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
