import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma'

const elementSchema = z.object({
  type:      z.enum(['LOGO', 'CLOCK', 'TEXT', 'TICKER', 'LOWER_THIRD']),
  position:  z.enum(['TL', 'TC', 'TR', 'ML', 'MC', 'MR', 'BL', 'BC', 'BR', 'BAR_TOP', 'BAR_BOTTOM']),
  imageUrl:  z.string().url().optional().nullable(),
  text:      z.string().optional().nullable(),
  subtitle:  z.string().optional().nullable(),
  fontColor: z.string().default('#FFFFFF'),
  bgColor:   z.string().optional().nullable(),
  fontSize:  z.number().int().min(8).max(200).default(32),
  opacity:   z.number().min(0).max(1).default(1),
  bold:      z.boolean().default(false),
  width:     z.number().int().optional().nullable(),
  height:    z.number().int().optional().nullable(),
  padding:   z.number().int().min(0).default(10),
  tickerSpeed: z.number().min(1).max(400).default(5),
  tickerLoop:  z.boolean().default(true),
  rssUrl:      z.string().url().optional().nullable(),
  active:      z.boolean().default(true),
  order:       z.number().int().default(0),
})

const templateSchema = z.object({
  name:        z.string().min(1),
  description: z.string().optional().nullable(),
  active:      z.boolean().optional(),
})

export default async function graphicTemplatesRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] }

  // Lista todos os templates com seus elementos
  app.get('/', auth, async () => {
    return prisma.graphicTemplate.findMany({
      include: {
        elements: { orderBy: { order: 'asc' } },
        _count: { select: { channels: true } },
      },
      orderBy: { name: 'asc' },
    })
  })

  // Busca um template
  app.get('/:id', auth, async (request: any, reply) => {
    const template = await prisma.graphicTemplate.findUnique({
      where: { id: request.params.id },
      include: { elements: { orderBy: { order: 'asc' } } },
    })
    if (!template) return reply.status(404).send({ error: 'Template não encontrado' })
    return template
  })

  // Cria template (sem elementos — adicionados separadamente)
  app.post('/', auth, async (request, reply) => {
    const body = templateSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })
    const template = await prisma.graphicTemplate.create({
      data: body.data,
      include: { elements: true },
    })
    return reply.status(201).send(template)
  })

  // Atualiza template
  app.put('/:id', auth, async (request: any, reply) => {
    const body = templateSchema.partial().safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })
    const template = await prisma.graphicTemplate.update({
      where: { id: request.params.id },
      data: body.data,
      include: { elements: { orderBy: { order: 'asc' } } },
    }).catch(() => null)
    if (!template) return reply.status(404).send({ error: 'Template não encontrado' })
    return template
  })

  // Exclui template
  app.delete('/:id', auth, async (request: any, reply) => {
    await prisma.graphicTemplate.delete({ where: { id: request.params.id } }).catch(() => null)
    return reply.status(204).send()
  })

  // ─── Elementos ───────────────────────────────────────────────────────────────

  // Adiciona elemento ao template
  app.post('/:id/elements', auth, async (request: any, reply) => {
    const body = elementSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })
    const exists = await prisma.graphicTemplate.findUnique({ where: { id: request.params.id }, select: { id: true } })
    if (!exists) return reply.status(404).send({ error: 'Template não encontrado' })
    const element = await prisma.graphicElement.create({
      data: { ...body.data, templateId: request.params.id },
    })
    await prisma.graphicTemplate.update({ where: { id: request.params.id }, data: { updatedAt: new Date() } })
    return reply.status(201).send(element)
  })

  // Atualiza elemento
  app.put('/:id/elements/:elemId', auth, async (request: any, reply) => {
    const body = elementSchema.partial().safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })
    const element = await prisma.graphicElement.update({
      where: { id: request.params.elemId },
      data: body.data,
    }).catch(() => null)
    if (!element) return reply.status(404).send({ error: 'Elemento não encontrado' })
    await prisma.graphicTemplate.update({ where: { id: request.params.id }, data: { updatedAt: new Date() } })
    return element
  })

  // Remove elemento
  app.delete('/:id/elements/:elemId', auth, async (request: any, reply) => {
    await prisma.graphicElement.delete({ where: { id: request.params.elemId } }).catch(() => null)
    await prisma.graphicTemplate.update({ where: { id: request.params.id }, data: { updatedAt: new Date() } }).catch(() => null)
    return reply.status(204).send()
  })

  // Reordena/substitui todos os elementos de uma vez (bulk update para o editor)
  app.put('/:id/elements', auth, async (request: any, reply) => {
    const elements = z.array(elementSchema.extend({ id: z.string().optional() })).safeParse(request.body)
    if (!elements.success) return reply.status(400).send({ error: elements.error.flatten() })

    // Apaga todos e recria — simples e confiável para o editor de template
    await prisma.graphicElement.deleteMany({ where: { templateId: request.params.id } })
    const created = await prisma.graphicElement.createMany({
      data: elements.data.map((el, i) => ({
        ...el,
        id: undefined, // gera novo id
        templateId: request.params.id,
        order: el.order ?? i,
      })),
    })
    await prisma.graphicTemplate.update({ where: { id: request.params.id }, data: { updatedAt: new Date() } })

    const updated = await prisma.graphicTemplate.findUnique({
      where: { id: request.params.id },
      include: { elements: { orderBy: { order: 'asc' } } },
    })
    return updated
  })
}
