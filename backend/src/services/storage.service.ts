import { Client as MinioClient } from 'minio'
import { config } from '../config'
import fs from 'fs'

class StorageService {
  private client: MinioClient

  constructor() {
    this.client = new MinioClient({
      endPoint: config.minio.endpoint,
      port: config.minio.port,
      useSSL: config.minio.useSSL,
      accessKey: config.minio.accessKey,
      secretKey: config.minio.secretKey,
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

  async fileExists(objectName: string): Promise<boolean> {
    try {
      await this.client.statObject(config.minio.bucket, objectName)
      return true
    } catch {
      return false
    }
  }
}

export const storageService = new StorageService()
