import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma'

export default async function settingsRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] }

  app.get('/', auth, async () => {
    return prisma.systemSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton' },
      update: {},
    })
  })

  app.put('/', auth, async (request: any) => {
    const {
      companyName, logoUrl, email,
      defaultMonitorOpen, defaultFallbackOpen,
      defaultOutputsOpen, defaultPlaylistOpen,
    } = request.body as {
      companyName?: string
      logoUrl?: string | null
      email?: string | null
      defaultMonitorOpen?: boolean
      defaultFallbackOpen?: boolean
      defaultOutputsOpen?: boolean
      defaultPlaylistOpen?: boolean
    }

    return prisma.systemSettings.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        companyName: companyName ?? 'TVPlay',
        logoUrl: logoUrl ?? null,
        email: email ?? null,
        defaultMonitorOpen:  defaultMonitorOpen  ?? true,
        defaultFallbackOpen: defaultFallbackOpen ?? true,
        defaultOutputsOpen:  defaultOutputsOpen  ?? true,
        defaultPlaylistOpen: defaultPlaylistOpen ?? true,
      },
      update: {
        ...(companyName        !== undefined && { companyName }),
        ...(logoUrl            !== undefined && { logoUrl }),
        ...(email              !== undefined && { email }),
        ...(defaultMonitorOpen  !== undefined && { defaultMonitorOpen }),
        ...(defaultFallbackOpen !== undefined && { defaultFallbackOpen }),
        ...(defaultOutputsOpen  !== undefined && { defaultOutputsOpen }),
        ...(defaultPlaylistOpen !== undefined && { defaultPlaylistOpen }),
      },
    })
  })
}
