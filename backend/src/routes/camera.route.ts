import { FastifyInstance } from 'fastify'
import * as cameraService from '../services/camera.service'

export default async function cameraRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] }

  app.get('/:channelId/status', auth, async (request: any) => ({
    active: cameraService.isCameraActive(request.params.channelId),
  }))

  app.delete('/:channelId', auth, async (request: any) => {
    cameraService.stopCamera(request.params.channelId)
    return { ok: true }
  })

  // WebSocket — handler NÃO é async para não bloquear o handshake do WS.
  // startCamera roda em background; mensagens chegam depois do FFmpeg estar pronto.
  app.get('/:channelId/ws', { websocket: true }, (socket, request: any) => {
    const { channelId } = request.params

    cameraService.startCamera(channelId)
      .catch((e: any) => {
        console.error(`[camera/${channelId}] Falha ao iniciar:`, e.message)
        try { socket.close(1011, e.message) } catch {}
      })

    socket.on('message', (data: Buffer) => {
      const proc = cameraService.getCameraProc(channelId)
      if (proc?.stdin?.writable) {
        proc.stdin.write(data, (err) => {
          if (err) console.warn(`[camera/${channelId}] stdin write:`, err.message)
        })
      }
    })

    socket.on('close', () => cameraService.stopCamera(channelId))
    socket.on('error', () => cameraService.stopCamera(channelId))
  })
}
