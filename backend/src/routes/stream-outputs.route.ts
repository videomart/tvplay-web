import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { StreamOutputType } from '@prisma/client'
import { prisma } from '../lib/prisma'

const schema = z.object({
  name:            z.string().min(1),
  description:     z.string().optional().nullable(),
  type:            z.nativeEnum(StreamOutputType),
  url:             z.string().optional().nullable(),
  streamKey:       z.string().optional().nullable(),
  device:          z.string().optional().nullable(),
  videoResolution: z.string().optional().nullable(),
  videoBitrate:    z.number().int().positive().optional().nullable(),
  audioBitrate:    z.number().int().positive().optional().nullable(),
  graphicId:       z.string().optional().nullable(),
  channelId:       z.string().min(1),
  active:          z.boolean().optional(),
})

const include = {
  channel: { select: { id: true, name: true, number: true } },
  graphic: true,
}

export default async function streamOutputRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] }

  app.get('/', auth, async () =>
    prisma.streamOutput.findMany({ include, orderBy: { name: 'asc' } })
  )

  app.post('/', auth, async (request, reply) => {
    const body = schema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })
    const output = await prisma.streamOutput.create({ data: body.data, include })
    return reply.status(201).send(output)
  })

  app.put('/:id', auth, async (request: any, reply) => {
    const body = schema.partial().safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })
    const output = await prisma.streamOutput.update({
      where: { id: request.params.id },
      data: body.data,
      include,
    }).catch(() => null)
    if (!output) return reply.status(404).send({ error: 'Saída não encontrada' })
    return output
  })

  app.delete('/:id', auth, async (request: any, reply) => {
    await prisma.streamOutput.delete({ where: { id: request.params.id } }).catch(() => null)
    return reply.status(204).send()
  })
}
