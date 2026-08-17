import { Client as MinioClient } from 'minio'
import { config } from '../config'
import fs from 'fs'
import http from 'http'
import https from 'https'

class StorageService {
  private client: MinioClient

  constructor() {
    // keepAlive evita reabrir a conexão TCP a cada request ao MinIO -- o
    // proxy de mídia (media/graphics/settings.route.ts) serve manifest +
    // cada segmento .ts de uma playlist HLS via chamadas separadas ao MinIO,
    // então isso soma vários handshakes TCP por vídeo carregado sem isso.
    const Agent = config.minio.useSSL ? https.Agent : http.Agent
    const transportAgent = new Agent({ keepAlive: true, maxSockets: 64 })

    this.client = new MinioClient({
      endPoint: config.minio.endpoint,
      port: config.minio.port,
      useSSL: config.minio.useSSL,
      accessKey: config.minio.accessKey,
      secretKey: config.minio.secretKey,
      transportAgent,
    })
  }

  async ensureBucket() {
    const exists = await this.client.bucketExists(config.minio.bucket)
    if (!exists) {
      await this.client.makeBucket(config.minio.bucket)
    }
  }

  async uploadFile(objectName: string, filePath: string, mimeType: string): Promise<string> {
    await this.ensureBucket()
    await this.client.fPutObject(config.minio.bucket, objectName, filePath, {
      'Content-Type': mimeType,
    })
    return objectName
  }

  async uploadBuffer(objectName: string, buffer: Buffer, mimeType: string): Promise<string> {
    await this.ensureBucket()
    await this.client.putObject(config.minio.bucket, objectName, buffer, buffer.length, {
      'Content-Type': mimeType,
    })
    return objectName
  }

  async getSignedUrl(objectName: string, expirySeconds = 3600): Promise<string> {
    return this.client.presignedGetObject(config.minio.bucket, objectName, expirySeconds)
  }

  async deleteFile(objectName: string): Promise<void> {
    await this.client.removeObject(config.minio.bucket, objectName)
  }

  // Apaga todos os objetos com determinado prefixo (ex: pasta HLS de uma mídia)
  async deleteFolder(prefix: string): Promise<number> {
    const objects: string[] = []
    await new Promise<void>((resolve, reject) => {
      const stream = this.client.listObjects(config.minio.bucket, prefix, true)
      stream.on('data', (obj) => { if (obj.name) objects.push(obj.name) })
      stream.on('end', resolve)
      stream.on('error', reject)
    })
    if (objects.length > 0) {
      await this.client.removeObjects(config.minio.bucket, objects)
    }
    return objects.length
  }

  async fileExists(objectName: string): Promise<boolean> {
    try {
      await this.client.statObject(config.minio.bucket, objectName)
      return true
    } catch {
      return false
    }
  }

  async getObjectStream(objectName: string) {
    return this.client.getObject(config.minio.bucket, objectName)
  }

  async getObjectStat(objectName: string) {
    return this.client.statObject(config.minio.bucket, objectName)
  }

  async listObjects(prefix = ''): Promise<{ name: string; size: number }[]> {
    const objects: { name: string; size: number }[] = []
    await new Promise<void>((resolve, reject) => {
      const stream = this.client.listObjects(config.minio.bucket, prefix, true)
      stream.on('data', (obj) => { if (obj.name) objects.push({ name: obj.name, size: obj.size ?? 0 }) })
      stream.on('end', resolve)
      stream.on('error', reject)
    })
    return objects
  }

  async downloadFile(objectName: string, destPath: string): Promise<void> {
    await this.client.fGetObject(config.minio.bucket, objectName, destPath)
  }

  async setBucketPublic() {
    const policy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [{
        Effect: 'Allow',
        Principal: { AWS: ['*'] },
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${config.minio.bucket}/*`],
      }],
    })
    await this.client.setBucketPolicy(config.minio.bucket, policy)
  }
}

export const storageService = new StorageService()
