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
  deviceOs:        z.string().optional().nullable(),
  deviceDriver:    z.string().optional().nullable(),
  deviceName:      z.string().optional().nullable(),
  videoResolution: z.string().optional().nullable(),
  videoBitrate:    z.number().int().positive().optional().nullable(),
  audioBitrate:    z.number().int().positive().optional().nullable(),
  graphicId:       z.string().optional().nullable(),
  channelId:       z.string().min(1),
  active:          z.boolean().optional(),
  outputNumber:    z.number().int().positive().optional().nullable(),
})

async function resolveOutputNumber(channelId: string, desiredNumber: number, excludeId?: string) {
  const conflict = await prisma.streamOutput.findFirst({
    where: { channelId, outputNumber: desiredNumber, ...(excludeId ? { id: { not: excludeId } } : {}) },
  })
  if (!conflict) return
  const others = await prisma.streamOutput.findMany({
    where: { channelId, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { outputNumber: true },
  })
  const used = new Set(others.map((o: any) => o.outputNumber).filter(Boolean))
  let n = 1
  while (used.has(n)) n++
  await prisma.streamOutput.update({ where: { id: conflict.id }, data: { outputNumber: n } })
}

const include = {
  channel: { select: { id: true, name: true, number: true } },
  graphic: true,
}

export default async function streamOutputRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] }

  app.get('/', auth, async () =>
    prisma.streamOutput.findMany({ include, orderBy: [{ outputNumber: 'asc' }, { name: 'asc' }] })
  )

  app.post('/', auth, async (request, reply) => {
    const body = schema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })
    if (body.data.outputNumber != null) await resolveOutputNumber(body.data.channelId, body.data.outputNumber)
    const output = await prisma.streamOutput.create({ data: body.data, include })
    return reply.status(201).send(output)
  })

  app.put('/:id', auth, async (request: any, reply) => {
    const body = schema.partial().safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })
    if (body.data.outputNumber != null) {
      const cur = await prisma.streamOutput.findUnique({ where: { id: request.params.id }, select: { channelId: true } })
      const cid = body.data.channelId ?? cur?.channelId
      if (cid) await resolveOutputNumber(cid, body.data.outputNumber, request.params.id)
    }
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
