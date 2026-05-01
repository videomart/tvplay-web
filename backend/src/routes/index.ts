import { FastifyInstance } from 'fastify'
import authRoutes from './auth.route'
import channelRoutes from './channels.route'
import clientRoutes from './clients.route'
import clipTypeRoutes from './clip-types.route'
import clipRoutes from './clips.route'
import ingestRoutes from './ingest.route'
import playlistRoutes from './playlists.route'
import playoutRoutes from './playout.route'
import mediaRoutes from './media.route'

export async function registerRoutes(app: FastifyInstance) {
  await app.register(authRoutes,    { prefix: '/api/auth' })
  await app.register(channelRoutes, { prefix: '/api/channels' })
  await app.register(clientRoutes,  { prefix: '/api/clients' })
  await app.register(clipTypeRoutes,{ prefix: '/api/clip-types' })
  await app.register(clipRoutes,    { prefix: '/api/clips' })
  await app.register(ingestRoutes,  { prefix: '/api/ingest' })
  await app.register(playlistRoutes,{ prefix: '/api/playlists' })
  await app.register(playoutRoutes, { prefix: '/api/playout' })
  await app.register(mediaRoutes,   { prefix: '/api/media' })
}
