import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { InputSourceType } from '@prisma/client'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { prisma } from '../lib/prisma'

const execFileAsync = promisify(execFile)

const schema = z.object({
  name:      z.string().min(1),
  type:      z.nativeEnum(InputSourceType),
  url:       z.string().optional().nullable(),
  device:    z.string().optional().nullable(),
  channelId: z.string().optional().nullable(),
  active:    z.boolean().optional(),
})

const include = { channel: { select: { id: true, name: true, number: true } } }

async function listVideoDevices(): Promise<{ path: string; name: string }[]> {
  try {
    // Tenta v4l2-ctl para listar dispositivos com nome legível
    const { stdout } = await execFileAsync('v4l2-ctl', ['--list-devices'], { timeout: 5000 })
    const devices: { path: string; name: string }[] = []
    let currentName = 'Dispositivo'
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim()
      if (!line.startsWith('\t') && trimmed.endsWith(':')) {
        currentName = trimmed.replace(/\s*\(.*\):$/, '').trim()
      } else if (line.startsWith('\t') && trimmed.startsWith('/dev/video')) {
        devices.push({ path: trimmed, name: currentName })
      }
    }
    return devices
  } catch {
    // Fallback: lista /dev/video*
    try {
      const { stdout } = await execFileAsync('sh', ['-c', 'ls /dev/video* 2>/dev/null'], { timeout: 3000 })
      return stdout.trim().split('\n').filter(Boolean).map((p) => ({ path: p, name: p }))
    } catch {
      return []
    }
  }
}

export default async function inputSourceRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] }

  // Lista todos os dispositivos de vídeo disponíveis no servidor
  app.get('/devices', auth, async (_req, reply) => {
    const devices = await listVideoDevices()
    return reply.send({ devices })
  })

  // Resolve URL do YouTube via yt-dlp (retorna URL de stream direto)
  app.post('/resolve-youtube', auth, async (request: any, reply) => {
    const { url } = request.body ?? {}
    if (!url) return reply.status(400).send({ error: 'URL obrigatória' })

    try {
      // Detecta se é live para escolher o melhor formato
      let isLive = false
      try {
        const { stdout: liveOut } = await execFileAsync(
          'yt-dlp', ['--print', 'is_live', '--no-warnings', url],
          { timeout: 15000 }
        )
        isLive = liveOut.trim() === 'True'
      } catch {}

      // Live → força HLS nativo; vídeo → melhor mp4 disponível
      const format = isLive
        ? 'best[protocol=m3u8_native]/best'
        : 'best[ext=mp4]/best[height<=1080]/best'

      const { stdout } = await execFileAsync(
        'yt-dlp',
        ['--no-playlist', '-g', '-f', format, '--no-warnings', url],
        { timeout: 30000 }
      )
      const streamUrl = stdout.trim().split('\n')[0]
      if (!streamUrl) throw new Error('Nenhum stream encontrado')
      return { streamUrl, isLive }
    } catch (e: any) {
      return reply.status(422).send({
        error: 'Não foi possível resolver o URL. Verifique se o link é válido e público.',
        detail: e.stderr?.toString()?.split('\n')[0] ?? e.message,
      })
    }
  })

  app.get('/', auth, async () =>
    prisma.inputSource.findMany({ include, orderBy: { name: 'asc' } })
  )

  app.post('/', auth, async (request, reply) => {
    const body = schema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })
    const source = await prisma.inputSource.create({ data: body.data, include })
    return reply.status(201).send(source)
  })

  app.put('/:id', auth, async (request: any, reply) => {
    const body = schema.partial().safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })
    const source = await prisma.inputSource.update({
      where: { id: request.params.id },
      data: body.data,
      include,
    }).catch(() => null)
    if (!source) return reply.status(404).send({ error: 'Fonte não encontrada' })
    return source
  })

  app.delete('/:id', auth, async (request: any, reply) => {
    await prisma.inputSource.delete({ where: { id: request.params.id } }).catch(() => null)
    return reply.status(204).send()
  })
}
