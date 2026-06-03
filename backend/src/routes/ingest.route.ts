import { FastifyInstance } from 'fastify'
import path from 'path'
import fs from 'fs'
import { prisma } from '../lib/prisma'
import { storageService } from '../services/storage.service'
import { transcodeQueue } from '../jobs/transcode.worker'
import { config } from '../config'
import * as playout from '../services/playout.service'

export default async function ingestRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] }

  // Upload de arquivo de mídia
  app.post('/upload', auth, async (request: any, reply) => {
    const { clipId } = request.query as { clipId?: string }

    if (clipId) {
      const clip = await prisma.clip.findUnique({ where: { id: clipId } })
      if (!clip) return reply.status(404).send({ error: 'Clipe não encontrado' })
    }

    const data = await request.file()
    if (!data) return reply.status(400).send({ error: 'Nenhum arquivo enviado' })

    const allowedMimes = [
      'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/mpeg', 'video/webm',
      'application/mxf', 'video/mxf',
      'video/mp2t', 'video/mts',                        // MPEG-TS / MTS
      'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff',
      'application/octet-stream',                        // fallback genérico de browsers
    ]
    const allowedExts = ['.mp4', '.mov', '.avi', '.mpeg', '.mpg', '.webm', '.mxf', '.ts', '.mts', '.m2ts', '.wmv', '.mkv',
                         '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.tif']
    const fileExt = path.extname(data.filename).toLowerCase()
    if (!allowedMimes.includes(data.mimetype) && !allowedExts.includes(fileExt)) {
      return reply.status(415).send({ error: `Formato não suportado: ${data.mimetype} (${fileExt})` })
    }

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

    const mediaFile = await prisma.mediaFile.create({
      data: {
        originalName: data.filename,
        storagePath: tmpPath,
        mimeType: data.mimetype,
        sizeBytes: BigInt(stat.size),
        ingestStatus: 'PENDING',
      },
    })

    if (clipId) {
      await prisma.clip.update({ where: { id: clipId }, data: { mediaId: mediaFile.id } })
    }

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

  // Lista arquivos de mídia com contagem de clipes e tamanho
  app.get('/media', auth, async (request: any) => {
    const { status, orphan } = request.query
    const where: any = {}
    if (status) where.ingestStatus = status
    if (orphan === 'true') where.clips = { none: {} }
    const files = await prisma.mediaFile.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        originalName: true,
        ingestStatus: true,
        duration: true,
        sizeBytes: true,
        width: true,
        height: true,
        hlsPath: true,
        thumbnail: true,
        errorMsg: true,
        createdAt: true,
        _count: { select: { clips: true } },
        clips: {
          select: {
            id: true, title: true, code: true,
            sourceType: true, duration: true,
            type: { select: { id: true, code: true, name: true, fontColor: true, fontBackColor: true } },
          },
          take: 3,
        },
      },
    })
    // BigInt não serializa em JSON — converter para string
    return files.map((f) => ({ ...f, sizeBytes: f.sizeBytes?.toString() ?? null }))
  })

  // Exclui arquivo de mídia do MinIO e do banco
  app.delete('/media/:id', auth, async (request: any, reply) => {
    const { id } = request.params

    const media = await prisma.mediaFile.findUnique({
      where: { id },
      select: { id: true, hlsPath: true, thumbnail: true, storagePath: true },
    })
    if (!media) return reply.status(404).send({ error: 'Arquivo não encontrado' })

    // Bloqueia se algum canal estiver reproduzindo este arquivo agora
    const activeStates = playout.getAllStates()
    const inUse = activeStates.some(
      (s) => s.status === 'PLAYING' && s.currentItem?.mediaId === id
    )
    if (inUse) return reply.status(409).send({ error: 'Arquivo em uso no playout — pare a transmissão antes de excluir' })

    // Apaga objetos do MinIO
    let deletedObjects = 0
    if (media.hlsPath) {
      // hlsPath = "hls/{mediaId}/index.m3u8" → prefixo é "hls/{mediaId}/"
      const folder = media.hlsPath.split('/').slice(0, 2).join('/') + '/'
      deletedObjects += await storageService.deleteFolder(folder).catch(() => 0)
    }
    if (media.thumbnail) {
      await storageService.deleteFile(media.thumbnail).catch(() => {})
      deletedObjects++
    }
    // Apaga arquivo temporário original se ainda existir
    if (media.storagePath && fs.existsSync(media.storagePath)) {
      fs.unlink(media.storagePath, () => {})
    }

    // Desvincula clipes (set mediaId = null) e apaga o registro
    await prisma.clip.updateMany({ where: { mediaId: id }, data: { mediaId: null } })
    await prisma.mediaFile.delete({ where: { id } })

    return { ok: true, deletedObjects }
  })

  // Escaneia o MinIO em busca de arquivos não registrados e enfileira transcodificação
  const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.mxf', '.ts', '.m2ts', '.flv', '.wmv',
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.tif'])

  app.post('/scan-minio', auth, async (_request, reply) => {
    const allObjects = await storageService.listObjects()

    // Ignora prefixos internos do sistema
    const rawFiles = allObjects.filter(
      (o) => !o.name.startsWith('hls/') && !o.name.startsWith('thumbs/') &&
              VIDEO_EXTS.has(path.extname(o.name).toLowerCase())
    )

    // Busca storagePaths já registrados para evitar duplicatas
    const existing = await prisma.mediaFile.findMany({ select: { storagePath: true } })
    const existingPaths = new Set(existing.map((m) => m.storagePath))

    const queued: string[] = []
    for (const obj of rawFiles) {
      if (existingPaths.has(obj.name)) continue

      const ext = path.extname(obj.name).toLowerCase()
      const mimeType = ext === '.mp4' ? 'video/mp4' : ext === '.mov' ? 'video/quicktime'
        : ext === '.mkv' ? 'video/x-matroska' : ext === '.avi' ? 'video/x-msvideo'
        : ext === '.webm' ? 'video/webm' : ext.match(/\.(png|jpg|jpeg|gif|webp|bmp|tiff?)$/) ? `image/${ext.slice(1)}`
        : 'video/mp4'

      const media = await prisma.mediaFile.create({
        data: {
          originalName: path.basename(obj.name),
          ingestStatus: 'PENDING',
          sizeBytes: obj.size,
          storagePath: obj.name,
          mimeType,
        },
      })

      await transcodeQueue.add('transcode', { mediaId: media.id, minioObjectName: obj.name })
      queued.push(obj.name)
    }

    return { scanned: rawFiles.length, queued: queued.length, files: queued }
  })
}
