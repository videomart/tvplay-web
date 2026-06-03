import { FastifyInstance } from 'fastify'
import path from 'path'
import fs from 'fs'
import { prisma } from '../lib/prisma'
import { storageService } from '../services/storage.service'
import { generateThumbnail } from '../services/ffmpeg.service'
import { config } from '../config'

export default async function mediaRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] }

  // Info do arquivo de mídia
  app.get('/:mediaId', auth, async (request: any, reply) => {
    const media = await prisma.mediaFile.findUnique({
      where: { id: request.params.mediaId },
      select: {
        id: true, originalName: true, ingestStatus: true,
        duration: true, width: true, height: true,
        hlsPath: true, thumbnail: true, errorMsg: true,
        createdAt: true,
      },
    })
    if (!media) return reply.status(404).send({ error: 'Mídia não encontrada' })
    return media
  })

  // Thumbnail assinado
  app.get('/:mediaId/thumbnail', auth, async (request: any, reply) => {
    const media = await prisma.mediaFile.findUnique({
      where: { id: request.params.mediaId },
      select: { thumbnail: true },
    })
    if (!media?.thumbnail) return reply.status(404).send({ error: 'Thumbnail não disponível' })
    const url = await storageService.getSignedUrl(media.thumbnail, 300)
    return { url }
  })

  // Gera (ou regenera) thumbnail a partir do HLS no MinIO
  app.post('/:mediaId/generate-thumbnail', auth, async (request: any, reply) => {
    const media = await prisma.mediaFile.findUnique({
      where: { id: request.params.mediaId },
      select: { id: true, hlsPath: true, ingestStatus: true },
    })
    if (!media) return reply.status(404).send({ error: 'Mídia não encontrada' })
    if (media.ingestStatus !== 'READY' || !media.hlsPath)
      return reply.status(400).send({ error: 'Mídia não está pronta para gerar thumbnail' })

    const hlsUrl = await storageService.getSignedUrl(media.hlsPath, 120)
    const thumbDir = path.join(config.storage.transcodeOutputPath, 'thumbs')
    const thumbPath = await generateThumbnail(hlsUrl, thumbDir)

    const thumbObjectName = `thumbs/${media.id}.jpg`
    await storageService.uploadBuffer(thumbObjectName, fs.readFileSync(thumbPath), 'image/jpeg')
    fs.unlinkSync(thumbPath)

    await prisma.mediaFile.update({ where: { id: media.id }, data: { thumbnail: thumbObjectName } })
    return { ok: true, thumbnail: thumbObjectName }
  })

  // Proxy de stream HLS — serve playlist e segmentos do MinIO sem expor credenciais
  // GET /api/media/stream/:mediaId/index.m3u8
  // GET /api/media/stream/:mediaId/seg001.ts
  app.get('/stream/:mediaId/*', async (request: any, reply) => {
    const { mediaId } = request.params
    const file: string = request.params['*']           // 'index.m3u8' | 'seg001.ts'
    const objectName = `hls/${mediaId}/${file}`

    try {
      const stat = await storageService.getObjectStat(objectName)
      const stream = await storageService.getObjectStream(objectName)

      const isPlaylist = file.endsWith('.m3u8')
      reply.header('Content-Type', isPlaylist ? 'application/x-mpegURL' : 'video/MP2T')
      reply.header('Content-Length', stat.size)
      reply.header('Cache-Control', 'public, max-age=3600')
      return reply.send(stream)
    } catch {
      return reply.status(404).send({ error: 'Arquivo não encontrado' })
    }
  })
}
