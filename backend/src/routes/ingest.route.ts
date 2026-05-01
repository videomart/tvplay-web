import { FastifyInstance } from 'fastify'
import path from 'path'
import fs from 'fs'
import { prisma } from '../lib/prisma'
import { storageService } from '../services/storage.service'
import { transcodeQueue } from '../jobs/transcode.worker'
import { config } from '../config'

export default async function ingestRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] }

  // Upload de arquivo de mídia
  app.post('/upload', auth, async (request, reply) => {
    const data = await request.file()
    if (!data) return reply.status(400).send({ error: 'Nenhum arquivo enviado' })

    const allowedMimes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/mpeg', 'video/webm']
    if (!allowedMimes.includes(data.mimetype)) {
      return reply.status(415).send({ error: 'Formato de arquivo não suportado' })
    }

    // Salva temporariamente no disco
    const tmpDir = path.join(config.storage.transcodeOutputPath, 'tmp')
    fs.mkdirSync(tmpDir, { recursive: true })
    const tmpPath = path.join(tmpDir, `${Date.now()}-${data.filename}`)

    await new Promise<void>((resolve, reject) => {
      const ws = fs.createWriteStream(tmpPath)
      data.file.pipe(ws)
      ws.on('finish', resolve)
      ws.on('error', reject)
    })

    const stat = fs.statSync(tmpPath)

    // Cria registro no banco
    const mediaFile = await prisma.mediaFile.create({
      data: {
        originalName: data.filename,
        storagePath: tmpPath,
        mimeType: data.mimetype,
        sizeBytes: BigInt(stat.size),
        ingestStatus: 'PENDING',
      },
    })

    // Enfileira transcodificação
    await transcodeQueue.add('transcode', { mediaId: mediaFile.id, tmpPath })

    return reply.status(202).send({
      mediaId: mediaFile.id,
      message: 'Upload recebido. Transcodificação iniciada.',
    })
  })

  // Status do arquivo de mídia
  app.get('/status/:mediaId', auth, async (request: any, reply) => {
    const media = await prisma.mediaFile.findUnique({
      where: { id: request.params.mediaId },
      select: { id: true, originalName: true, ingestStatus: true, duration: true, hlsPath: true, errorMsg: true },
    })
    if (!media) return reply.status(404).send({ error: 'Arquivo não encontrado' })
    return media
  })

  // Lista arquivos de mídia
  app.get('/media', auth, async (request: any) => {
    const { status } = request.query
    return prisma.mediaFile.findMany({
      where: status ? { ingestStatus: status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, originalName: true, ingestStatus: true, duration: true, sizeBytes: true, createdAt: true },
    })
  })
}
