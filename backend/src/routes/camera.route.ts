import { FastifyInstance } from 'fastify'
import * as cameraService from '../services/camera.service'

export default async function cameraRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] }

  // Status da câmera no canal
  app.get('/:channelId/status', auth, async (request: any) => ({
    active: cameraService.isCameraActive(request.params.channelId),
  }))

  // Para câmera manualmente via REST (alternativa ao fechar o WS)
  app.delete('/:channelId', auth, async (request: any) => {
    cameraService.stopCamera(request.params.channelId)
    return { ok: true }
  })

  // WebSocket — recebe chunks de vídeo do browser (MediaRecorder WebM)
  app.get('/:channelId/ws', { websocket: true }, async (socket, request: any) => {
    const { channelId } = request.params
    let proc: ReturnType<typeof cameraService.getCameraProc> = null

    try {
      proc = await cameraService.startCamera(channelId)
    } catch (e: any) {
      console.error(`[camera/${channelId}] Falha ao iniciar:`, e.message)
      socket.close(1011, e.message)
      return
    }

    socket.on('message', (data: Buffer) => {
      const current = cameraService.getCameraProc(channelId)
      if (current?.stdin?.writable) {
        current.stdin.write(data, (err) => {
          if (err) console.warn(`[camera/${channelId}] Erro ao escrever no stdin:`, err.message)
        })
      }
    })

    socket.on('close', () => {
      cameraService.stopCamera(channelId)
    })

    socket.on('error', () => {
      cameraService.stopCamera(channelId)
    })
  })
}
