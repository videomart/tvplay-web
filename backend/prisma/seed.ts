import { PrismaClient, UserLevel, ClipModality } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  // Usuários padrão
  const adminHash = await bcrypt.hash('admin123', 10)
  const opHash = await bcrypt.hash('op123', 10)

  await prisma.user.upsert({
    where: { username: 'admin' },
    update: { password: adminHash },
    create: { name: 'Administrador', username: 'admin', password: adminHash, level: UserLevel.ADMIN },
  })

  await prisma.user.upsert({
    where: { username: 'operador' },
    update: { password: opHash },
    create: { name: 'Operador', username: 'operador', password: opHash, level: UserLevel.OPERATOR },
  })

  // Tipos de clipe padrão (espelhando os do TVPlay-SE+)
  const types = [
    { code: 'CP', name: 'Comercial / Publicidade',  fontColor: '#FFFFFF', fontBackColor: '#1565C0' },
    { code: 'CA', name: 'Campanha',                  fontColor: '#FFFFFF', fontBackColor: '#6A1B9A' },
    { code: 'PT', name: 'Vinheta Promocional',       fontColor: '#000000', fontBackColor: '#F9A825' },
    { code: 'BK', name: 'Bloco de Programa',         fontColor: '#FFFFFF', fontBackColor: '#1B5E20' },
    { code: 'AR', name: 'Arquivo / Reprisa',         fontColor: '#FFFFFF', fontBackColor: '#37474F' },
    { code: 'VH', name: 'VT Humorístico',            fontColor: '#000000', fontBackColor: '#80DEEA' },
    { code: 'LV', name: 'Ao Vivo',                   fontColor: '#FFFFFF', fontBackColor: '#B71C1C' },
    { code: 'ID', name: 'ID de Canal',               fontColor: '#FFFFFF', fontBackColor: '#4A148C' },
    { code: 'MT', name: 'Material Teaser',           fontColor: '#000000', fontBackColor: '#FFF9C4' },
  ]

  for (const t of types) {
    await prisma.clipType.upsert({
      where: { code: t.code },
      update: {},
      create: t,
    })
  }

  // Canais de exemplo
  const channels = [
    { name: 'Canal 1 - Principal', number: 1, description: 'Canal principal de playout' },
    { name: 'Canal 2 - Secundário', number: 2, description: 'Canal secundário / backup' },
  ]

  for (const ch of channels) {
    const exists = await prisma.channel.findUnique({ where: { number: ch.number } })
    if (!exists) await prisma.channel.create({ data: ch })
  }

  // Cliente de exemplo
  await prisma.client.upsert({
    where: { id: 'demo-client-1' },
    update: {},
    create: {
      id: 'demo-client-1',
      name: 'Anunciante Demo',
      contact: 'Contato Demo',
      email: 'demo@anunciante.com',
      phone: '(11) 99999-0000',
    },
  })

  console.log('Seed concluído.')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
