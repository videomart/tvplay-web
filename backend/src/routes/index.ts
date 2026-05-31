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
import streamOutputRoutes from './stream-outputs.route'
import inputSourceRoutes from './input-sources.route'
import logsRoutes from './logs.route'
import usersRoutes from './users.route'
import settingsRoutes from './settings.route'
import graphicRoutes from './graphics.route'
import graphicTemplateRoutes from './graphic-templates.route'
import cameraRoutes from './camera.route'
import tickerRoutes from './ticker.route'

export async function registerRoutes(app: FastifyInstance) {
  await app.register(authRoutes,         { prefix: '/api/auth' })
  await app.register(channelRoutes,      { prefix: '/api/channels' })
  await app.register(clientRoutes,       { prefix: '/api/clients' })
  await app.register(clipTypeRoutes,     { prefix: '/api/clip-types' })
  await app.register(clipRoutes,         { prefix: '/api/clips' })
  await app.register(ingestRoutes,       { prefix: '/api/ingest' })
  await app.register(playlistRoutes,     { prefix: '/api/playlists' })
  await app.register(playoutRoutes,      { prefix: '/api/playout' })
  await app.register(mediaRoutes,        { prefix: '/api/media' })
  await app.register(streamOutputRoutes, { prefix: '/api/stream-outputs' })
  await app.register(inputSourceRoutes,  { prefix: '/api/input-sources' })
  await app.register(logsRoutes,         { prefix: '/api/logs' })
  await app.register(usersRoutes,        { prefix: '/api/users' })
  await app.register(settingsRoutes,     { prefix: '/api/settings' })
  await app.register(graphicRoutes,          { prefix: '/api/graphics' })
  await app.register(graphicTemplateRoutes,  { prefix: '/api/graphic-templates' })
  await app.register(cameraRoutes,           { prefix: '/api/camera' })
  await app.register(tickerRoutes,           { prefix: '/api/ticker' })
}
