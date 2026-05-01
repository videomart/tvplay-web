import { Queue, Worker } from 'bullmq'
import path from 'path'
import fs from 'fs'
import { config } from '../config'
import { prisma } from '../lib/prisma'
import { probeMedia, transcodeToHLS, generateThumbnail } from '../services/ffmpeg.service'
import { storageService } from '../services/storage.service'

const connection = { host: new URL(config.redis.url).hostname, port: parseInt(new URL(config.redis.url).port || '6379') }

export const transcodeQueue = new Queue('transcode', { connection })

const worker = new Worker(
  'transcode',
  async (job) => {
    const { mediaId, tmpPath } = job.data

    await prisma.mediaFile.update({ where: { id: mediaId }, data: { ingestStatus: 'PROCESSING' } })

    try {
      // 1. Probe
      const probe = await probeMedia(tmpPath)

      // 2. Thumbnail
      const thumbDir = path.join(config.storage.transcodeOutputPath, 'thumbs')
      const thumbPath = await generateThumbnail(tmpPath, thumbDir)
      const thumbObjectName = `thumbs/${mediaId}.jpg`
      await storageService.uploadFile(thumbObjectName, thumbPath, 'image/jpeg')
      fs.unlinkSync(thumbPath)

      // 3. HLS
      const hlsOutputDir = config.storage.hlsOutputPath
      const playlistPath = await transcodeToHLS(tmpPath, hlsOutputDir, mediaId)
      const hlsDir = path.dirname(playlistPath)

      // Upload de todos os segmentos HLS para MinIO
      const hlsFiles = fs.readdirSync(hlsDir)
      for (const file of hlsFiles) {
        const filePath = path.join(hlsDir, file)
        const mimeType = file.endsWith('.m3u8') ? 'application/x-mpegURL' : 'video/MP2T'
        await storageService.uploadFile(`hls/${mediaId}/${file}`, filePath, mimeType)
      }

      // Limpa arquivos locais
      fs.rmSync(hlsDir, { recursive: true })
      fs.unlinkSync(tmpPath)

      // 4. Atualiza banco
      await prisma.mediaFile.update({
        where: { id: mediaId },
        data: {
          ingestStatus: 'READY',
          duration: probe.duration,
          width: probe.width,
          height: probe.height,
          fps: probe.fps,
          bitrate: probe.bitrate,
          videoCodec: probe.videoCodec,
          audioCodec: probe.audioCodec,
          thumbnail: thumbObjectName,
          hlsPath: `hls/${mediaId}/index.m3u8`,
          storagePath: `hls/${mediaId}`,
        },
      })

      return { success: true, mediaId }
    } catch (err: any) {
      await prisma.mediaFile.update({
        where: { id: mediaId },
        data: { ingestStatus: 'ERROR', errorMsg: err.message },
      })
      throw err
    }
  },
  { connection, concurrency: 2 },
)

worker.on('completed', (job) => console.log(`[Transcode] Job ${job.id} concluído`))
worker.on('failed', (job, err) => console.error(`[Transcode] Job ${job?.id} falhou:`, err.message))

export default worker
