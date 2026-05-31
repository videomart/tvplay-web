import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const FEED_DIR   = join(tmpdir(), 'tvplay-tickers')
const INTERVAL   = 5 * 60 * 1000   // 5 minutos
const SEPARATOR  = '   |   '        // separador entre manchetes
const MAX_ITEMS  = 20

const intervals = new Map<string, ReturnType<typeof setInterval>>()

export function tickerFilePath(elementId: string): string {
  return join(FEED_DIR, `ticker_${elementId}.txt`)
}

// ─── Parse RSS/Atom simples (sem dependências externas) ──────────────────────

function extractTitle(block: string): string | null {
  const cdata = block.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i)
  if (cdata) return cdata[1].trim()
  const plain = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!plain) return null
  return plain[1]
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#\d+;/g, '')
    .trim()
}

function parseRss(xml: string): string[] {
  const titles: string[] = []
  // RSS 2.0 <item>
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const t = extractTitle(m[0]); if (t) titles.push(t)
  }
  // Atom <entry>
  if (titles.length === 0) {
    for (const m of xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)) {
      const t = extractTitle(m[0]); if (t) titles.push(t)
    }
  }
  return titles.slice(0, MAX_ITEMS)
}

// Busca RSS e retorna títulos — usado pelo endpoint de preview
export async function fetchRssHeadlines(rssUrl: string): Promise<string[]> {
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const resp = await fetch(rssUrl, { signal: ctrl.signal })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    return parseRss(await resp.text())
  } finally {
    clearTimeout(timer)
  }
}

// ─── Busca RSS e escreve no arquivo ─────────────────────────────────────────

async function fetchAndWrite(elementId: string, rssUrl: string): Promise<void> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10_000)
    const resp = await fetch(rssUrl, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const xml    = await resp.text()
    const titles = parseRss(xml)
    const text   = titles.length
      ? titles.join(SEPARATOR) + SEPARATOR          // trailing sep para loop suave
      : `[RSS indisponível: ${rssUrl}]`
    mkdirSync(FEED_DIR, { recursive: true })
    writeFileSync(tickerFilePath(elementId), text, 'utf8')
    console.log(`[ticker/${elementId}] RSS atualizado — ${titles.length} manchetes`)
  } catch (err: any) {
    console.warn(`[ticker/${elementId}] Falha ao buscar RSS (${rssUrl}): ${err.message}`)
  }
}

// ─── API pública ─────────────────────────────────────────────────────────────

export async function startFeed(elementId: string, rssUrl: string): Promise<void> {
  if (intervals.has(elementId)) return  // já ativo
  await fetchAndWrite(elementId, rssUrl)
  const id = setInterval(() => fetchAndWrite(elementId, rssUrl), INTERVAL)
  intervals.set(elementId, id)
}

export function stopFeed(elementId: string): void {
  const id = intervals.get(elementId)
  if (id !== undefined) { clearInterval(id); intervals.delete(elementId) }
}

export function stopAll(): void {
  for (const id of intervals.values()) clearInterval(id)
  intervals.clear()
}

// Garante que o arquivo existe para um ticker sem RSS (texto estático)
export function ensureStaticFile(elementId: string, text: string): void {
  mkdirSync(FEED_DIR, { recursive: true })
  const path = tickerFilePath(elementId)
  writeFileSync(path, text || ' ', 'utf8')
}
