import { useEffect, useRef, useState, useCallback } from 'react'
import type { PlayoutState } from '../api/playout.api'
import { useAuthStore } from '../stores/auth.store'

export function usePlayoutSocket(channelId: string) {
  const [state, setState] = useState<PlayoutState | null>(null)
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const token = useAuthStore((s) => s.token)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const host = import.meta.env.DEV ? 'localhost:3001' : window.location.host
    const url = `${protocol}://${host}/api/playout/${channelId}/ws?token=${token}`

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => setConnected(true)
    ws.onclose = () => {
      setConnected(false)
      // Reconecta após 3s
      setTimeout(connect, 3000)
    }
    ws.onerror = () => ws.close()
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.event === 'state') setState(msg.data as PlayoutState)
      } catch {}
    }
  }, [channelId, token])

  useEffect(() => {
    connect()
    return () => {
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [connect])

  return { state, connected }
}
