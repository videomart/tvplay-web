import { Queue, Worker } from 'bullmq'
import path from 'path'
import fs from 'fs'
import { config } from '../config'
import { prisma } from '../lib/prisma'
import { probeMedia, transcodeToHLS, transcodeImageToHLS, generateThumbnail } from '../services/ffmpeg.service'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.tif'])
import { storageService } from '../services/storage.service'

const connection = { host: new URL(config.redis.url).hostname, port: parseInt(new URL(config.redis.url).port || '6379') }

export const transcodeQueue = new Queue('transcode', { connection })

const worker = new Worker(
  'transcode',
  async (job) => {
    const { mediaId, tmpPath: jobTmpPath, minioObjectName } = job.data

    await prisma.mediaFile.update({ where: { id: mediaId }, data: { ingestStatus: 'PROCESSING' } })

    let tmpPath = jobTmpPath
    let downloadedFromMinio = false

    try {
      // Se o arquivo veio direto do MinIO (sem tmpPath local), baixa primeiro
      if (!tmpPath && minioObjectName) {
        const ext = path.extname(minioObjectName) || '.bin'
        tmpPath = path.join(config.storage.transcodeOutputPath, `minio-${mediaId}${ext}`)
        await storageService.downloadFile(minioObjectName, tmpPath)
        downloadedFromMinio = true
      }

      const isImage = IMAGE_EXTS.has(path.extname(tmpPath).toLowerCase())
      const hlsOutputDir = config.storage.hlsOutputPath
      const thumbDir = path.join(config.storage.transcodeOutputPath, 'thumbs')

      let dbData: Record<string, any>

      if (isImage) {
        // ── Imagem estática: converte para vídeo loop de 30s ────────────────
        console.log(`[Transcode] Imagem detectada — convertendo para HLS loop: ${tmpPath}`)
        const { playlistPath, width, height } = await transcodeImageToHLS(tmpPath, hlsOutputDir, mediaId)
        const hlsDir = path.dirname(playlistPath)

        // Usa a própria imagem como thumbnail (copia para MinIO)
        const thumbObjectName = `thumbs/${mediaId}.jpg`
        await storageService.uploadFile(thumbObjectName, tmpPath, 'image/jpeg').catch(() => {})

        // Upload HLS
        for (const file of fs.readdirSync(hlsDir)) {
          const mimeType = file.endsWith('.m3u8') ? 'application/x-mpegURL' : 'video/MP2T'
          await storageService.uploadFile(`hls/${mediaId}/${file}`, path.join(hlsDir, file), mimeType)
        }
        fs.rmSync(hlsDir, { recursive: true })
        fs.unlinkSync(tmpPath)

        dbData = { ingestStatus: 'READY', duration: 30, width, height, thumbnail: thumbObjectName, hlsPath: `hls/${mediaId}/index.m3u8`, storagePath: `hls/${mediaId}` }
      } else {
        // ── Vídeo: pipeline padrão ──────────────────────────────────────────
        const probe = await probeMedia(tmpPath)

        const thumbOffset = probe.duration > 0 ? probe.duration / 2 : 2
        const thumbPath = await generateThumbnail(tmpPath, thumbDir, thumbOffset)
        const thumbObjectName = `thumbs/${mediaId}.jpg`
        await storageService.uploadFile(thumbObjectName, thumbPath, 'image/jpeg')
        fs.unlinkSync(thumbPath)

        const playlistPath = await transcodeToHLS(tmpPath, hlsOutputDir, mediaId)
        const hlsDir = path.dirname(playlistPath)

        for (const file of fs.readdirSync(hlsDir)) {
          const mimeType = file.endsWith('.m3u8') ? 'application/x-mpegURL' : 'video/MP2T'
          await storageService.uploadFile(`hls/${mediaId}/${file}`, path.join(hlsDir, file), mimeType)
        }
        fs.rmSync(hlsDir, { recursive: true })
        fs.unlinkSync(tmpPath)

        dbData = { ingestStatus: 'READY', duration: probe.duration, width: probe.width, height: probe.height, fps: probe.fps, bitrate: probe.bitrate, videoCodec: probe.videoCodec, audioCodec: probe.audioCodec, thumbnail: thumbObjectName, hlsPath: `hls/${mediaId}/index.m3u8`, storagePath: `hls/${mediaId}` }
      }

      await prisma.mediaFile.update({ where: { id: mediaId }, data: dbData })

      if (downloadedFromMinio && minioObjectName) {
        await storageService.deleteFile(minioObjectName).catch(() => {})
      }

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
