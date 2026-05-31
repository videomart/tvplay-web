const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')

const prisma = new PrismaClient()

async function main() {
  // ─── Usuários ────────────────────────────────────────────────────────────────
  const adminHash = await bcrypt.hash('admin123', 10)
  const opHash    = await bcrypt.hash('op123', 10)

  await prisma.user.upsert({
    where:  { username: 'admin' },
    update: { password: adminHash },
    create: { name: 'Administrador', username: 'admin', password: adminHash, level: 'ADMIN' },
  })
  await prisma.user.upsert({
    where:  { username: 'operador' },
    update: { password: opHash },
    create: { name: 'Operador', username: 'operador', password: opHash, level: 'OPERATOR' },
  })

  // ─── Tipos de clipe ──────────────────────────────────────────────────────────
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
    await prisma.clipType.upsert({ where: { code: t.code }, update: {}, create: t })
  }

  // ─── Canais ──────────────────────────────────────────────────────────────────
  const channels = [
    { name: 'Canal 1 - Principal',  number: 1, description: 'Canal principal de playout' },
    { name: 'Canal 2 - Secundário', number: 2, description: 'Canal secundário / backup' },
  ]
  for (const ch of channels) {
    const exists = await prisma.channel.findUnique({ where: { number: ch.number } })
    if (!exists) await prisma.channel.create({ data: ch })
  }

  // ─── Templates gráficos ──────────────────────────────────────────────────────

  // Template 1: REDES SOCIAIS — logo + relógio + hashtag
  await prisma.graphicTemplate.upsert({
    where:  { id: 'template-simples-factory' },
    update: {},
    create: {
      id: 'template-simples-factory',
      name: 'REDES SOCIAIS',
      description: 'Template padrão: logo, relógio e texto. Compatível com o sistema legado.',
      active: true,
    },
  })
  for (const el of [
    { id: 'tpl-simples-logo',  type: 'LOGO',  position: 'BR', imageUrl: 'https://avideomart.com.br/wp-content/uploads/2025/02/LogoPretoNovo.png', bgColor: '#e10505', fontColor: '#FFFFFF', fontSize: 32, opacity: 1,   bold: false, padding: 10, tickerSpeed: 5, tickerLoop: true, active: true,  order: 0 },
    { id: 'tpl-simples-clock', type: 'CLOCK', position: 'TR', bgColor: '#1020f9',                                                                                          fontColor: '#FFFFFF', fontSize: 48, opacity: 1,   bold: false, padding: 10, tickerSpeed: 5, tickerLoop: true, active: true,  order: 1 },
    { id: 'tpl-simples-text',  type: 'TEXT',  position: 'TL', text: '#VideomartBroadcast',                                                                                 fontColor: '#FFFFFF', fontSize: 32, opacity: 0.5, bold: false, padding: 10, tickerSpeed: 5, tickerLoop: true, active: true,  order: 2 },
  ]) {
    await prisma.graphicElement.upsert({ where: { id: el.id }, update: {}, create: { ...el, templateId: 'template-simples-factory' } })
  }

  // Template 2: NEWS — overlay completo de telejornal
  await prisma.graphicTemplate.upsert({
    where:  { id: 'tpl-news-factory' },
    update: {},
    create: { id: 'tpl-news-factory', name: 'NEWS', description: 'Overlay completo de telejornal.', active: true },
  })
  for (const el of [
    { id: 'tpl-news-title',   type: 'TEXT',        position: 'TC', text: 'TVPLAY-WEB',                                                         fontColor: '#FFFFFF', bgColor: '#f00000', fontSize: 32, opacity: 1, bold: false, padding: 10, tickerSpeed: 5, tickerLoop: true, active: true, order: 0 },
    { id: 'tpl-news-social',  type: 'TEXT',        position: 'TL', text: '#VideomartBroadcast',                                                 fontColor: '#a8a3a3',                    fontSize: 32, opacity: 1, bold: false, padding: 10, tickerSpeed: 5, tickerLoop: true, active: true, order: 1 },
    { id: 'tpl-news-clock-r', type: 'CLOCK',       position: 'TR',                                                                              fontColor: '#FFFFFF', bgColor: '#061aac', fontSize: 32, opacity: 1, bold: false, padding: 10, tickerSpeed: 5, tickerLoop: true, active: true, order: 2 },
    { id: 'tpl-news-clock-l', type: 'CLOCK',       position: 'BL',                                                                              fontColor: '#FFFFFF', bgColor: '#0db2d3', fontSize: 32, opacity: 1, bold: false, padding: 10, tickerSpeed: 5, tickerLoop: true, active: true, order: 3 },
    { id: 'tpl-news-lower',   type: 'LOWER_THIRD', position: 'BC', text: 'TVPLAY-WEB PLAYOUT ON CLOUD ON PROMISE', subtitle: 'A plataforma que transforma canais digitais em redes de televisão', fontColor: '#FFFFFF', bgColor: '#c11010', fontSize: 32, opacity: 1, bold: false, padding: 10, tickerSpeed: 5, tickerLoop: true, active: true, order: 4 },
  ]) {
    await prisma.graphicElement.upsert({ where: { id: el.id }, update: {}, create: { ...el, templateId: 'tpl-news-factory' } })
  }

  // Template 3: RSS — ticker de manchetes com feed RSS
  await prisma.graphicTemplate.upsert({
    where:  { id: 'tpl-rss-factory' },
    update: {},
    create: { id: 'tpl-rss-factory', name: 'RSS', description: 'Ticker de manchetes via feed RSS.', active: true },
  })
  await prisma.graphicElement.upsert({
    where:  { id: 'tpl-rss-ticker' },
    update: {},
    create: {
      id: 'tpl-rss-ticker', templateId: 'tpl-rss-factory',
      type: 'TICKER', position: 'BAR_BOTTOM',
      rssUrl: 'https://avideomart.com.br/feed/',
      fontColor: '#FFFFFF', bgColor: '#000000',
      fontSize: 32, opacity: 1, bold: false, padding: 10,
      tickerSpeed: 5, tickerLoop: true, active: true, order: 0,
    },
  })

  // ─── Gráficos de fábrica ─────────────────────────────────────────────────────

  await prisma.graphic.upsert({
    where:  { id: 'graphic-redes-factory' },
    update: {},
    create: {
      id: 'graphic-redes-factory', name: 'REDES SOCIAIS',
      templateId: 'template-simples-factory',
      elementValues: {},
      active: true,
    },
  })

  await prisma.graphic.upsert({
    where:  { id: 'graphic-news-factory' },
    update: {},
    create: {
      id: 'graphic-news-factory', name: 'NEWS',
      templateId: 'tpl-news-factory',
      elementValues: {},
      active: true,
    },
  })

  await prisma.graphic.upsert({
    where:  { id: 'graphic-rss-factory' },
    update: {},
    create: {
      id: 'graphic-rss-factory', name: 'TICKER RSS',
      templateId: 'tpl-rss-factory',
      elementValues: {},
      active: true,
    },
  })

  console.log('✅ Seed concluído.')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
