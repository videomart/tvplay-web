/**
 * Singleton de módulo que mantém a sessão de câmera viva fora do ciclo React.
 * MediaStream, MediaRecorder e WebSocket persistem mesmo quando componentes desmontam
 * ao navegar para outras páginas.
 */

export interface CameraSession {
  channelId: string
  stream: MediaStream
  recorder: MediaRecorder
  ws: WebSocket
}

type Listener = () => void

class CameraManager {
  private session: CameraSession | null = null
  private lastError: string | null = null
  private listeners = new Set<Listener>()

  // ── Leitura ────────────────────────────────────────────────────────────────

  getSession(): CameraSession | null {
    return this.session
  }

  isActive(channelId?: string): boolean {
    if (!this.session) return false
    return channelId ? this.session.channelId === channelId : true
  }

  getLastError(): string | null {
    return this.lastError
  }

  // ── Escrita ────────────────────────────────────────────────────────────────

  setSession(session: CameraSession): void {
    this.session = session
    this.lastError = null
    this.notify()
  }

  /** Para tudo e limpa a sessão sem erro (paragem voluntária). */
  clearSession(): void {
    this._stop()
    this.notify()
  }

  /** Para tudo, registra erro e notifica. */
  failSession(msg: string): void {
    this._stop()
    this.lastError = msg
    this.notify()
  }

  consumeError(): string | null {
    const e = this.lastError
    this.lastError = null
    return e
  }

  // ── Subscriptions ──────────────────────────────────────────────────────────

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  // ── Interno ────────────────────────────────────────────────────────────────

  private _stop(): void {
    const s = this.session
    if (!s) return
    this.session = null

    if (s.recorder.state !== 'inactive') {
      try { s.recorder.stop() } catch {}
    }
    s.stream.getTracks().forEach((t) => t.stop())
    if (s.ws.readyState !== WebSocket.CLOSED) {
      s.ws.onclose = null
      s.ws.onerror = null
      try { s.ws.close(1000) } catch {}
    }
  }

  private notify(): void {
    this.listeners.forEach((fn) => fn())
  }
}

export const cameraManager = new CameraManager()
