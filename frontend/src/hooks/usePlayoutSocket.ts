import { useEffect, useRef, useState, useCallback } from 'react'
import type { PlayoutState } from '../api/playout.api'
import { useAuthStore } from '../stores/auth.store'

const cacheKey = (id: string) => `tvplay-playout-state-${id}`

function readCache(channelId: string): PlayoutState | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(channelId))
    return raw ? (JSON.parse(raw) as PlayoutState) : null
  } catch { return null }
}

function writeCache(channelId: string, state: PlayoutState) {
  try { sessionStorage.setItem(cacheKey(channelId), JSON.stringify(state)) } catch {}
}

export function usePlayoutSocket(channelId: string) {
  const [state, setState] = useState<PlayoutState | null>(() => readCache(channelId))
  const [connected, setConnected] = useState(false)
  const wsRef    = useRef<WebSocket | null>(null)
  const mounted  = useRef(true)
  const token    = useAuthStore((s) => s.token)

  // Busca estado inicial via REST para garantir playlistId imediato sem cache
  useEffect(() => {
    if (!token || !channelId) return
    const base = import.meta.env.DEV ? 'http://localhost:3001' : ''
    fetch(`${base}/api/playout/${channelId}/state`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.ok ? r.json() : null)
      .then((data: PlayoutState | null) => {
        if (!data || !mounted.current) return
        writeCache(channelId, data)
        setState((prev) => prev ?? data)
      })
      .catch(() => {})
  }, [channelId, token])

  const connect = useCallback(() => {
    if (!mounted.current) return
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const host = import.meta.env.DEV ? 'localhost:3001' : window.location.host
    const ws = new WebSocket(`${protocol}://${host}/api/playout/${channelId}/ws?token=${token}`)
    wsRef.current = ws

    ws.onopen = () => { if (mounted.current) setConnected(true) }
    ws.onclose = () => {
      if (!mounted.current) return
      setConnected(false)
      setTimeout(connect, 3000)
    }
    ws.onerror = () => ws.close()
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.event === 'state') {
          const s = msg.data as PlayoutState
          writeCache(channelId, s)
          if (mounted.current) setState(s)
        }
      } catch {}
    }
  }, [channelId, token])

  useEffect(() => {
    mounted.current = true
    connect()
    return () => {
      mounted.current = false
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [connect])

  return { state, connected }
}
