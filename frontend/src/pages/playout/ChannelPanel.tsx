import { useState, useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Play, Pause, Square, SkipForward, SkipBack,
  Radio, Wifi, WifiOff, MonitorPlay, MonitorOff, Antenna,
  ChevronDown, ChevronUp, RefreshCw, RotateCcw, GripVertical, Trash2, Repeat,
  Camera, Timer, Copy, Eraser,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import { playoutApi, type ChannelOutput, type OutputStats, type PlaylistItemRow, type ActiveGraphic } from '../../api/playout.api'
import { GraphicOverlay } from '../../components/ui/GraphicOverlay'
import { CameraModal } from '../../components/ui/CameraModal'
import { useCameraStream } from '../../hooks/useCameraStream'
import { playlistsApi } from '../../api/playlists.api'
import { channelsApi, type Channel, type FallbackType } from '../../api/channels.api'
import { inputSourcesApi } from '../../api/input-sources.api'
import { settingsApi } from '../../api/settings.api'
import { usePlayoutSocket } from '../../hooks/usePlayoutSocket'
import { usePlayoutSelection } from '../../stores/playoutSelection.store'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Modal } from '../../components/ui/Modal'
import { VideoPlayer } from '../../components/ui/VideoPlayer'

function hlsStreamUrl(hlsPath: string) {
  const mediaId = hlsPath.split('/')[1]
  return `/api/media/stream/${mediaId}/index.m3u8`
}

function formatBitrate(stats: OutputStats | null): string | null {
  if (!stats || stats.bitrate <= 0) return null
  if (Date.now() - stats.updatedAt > 15000) return null
  return stats.bitrate >= 1000
    ? `${(stats.bitrate / 1000).toFixed(1)} Mb/s`
    : `${Math.round(stats.bitrate)} kb/s`
}

function embedUrlForMonitor(url: string | null | undefined): string | null {
  if (!url) return null
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1&mute=0`
  const twMatch = url.match(/twitch\.tv\/([a-zA-Z0-9_]+)/)
  if (twMatch) return `https://player.twitch.tv/?channel=${twMatch[1]}&parent=${location.hostname}&autoplay=true`
  return null
}

const OUTPUT_TYPE_SHORT: Record<string, string> = {
  RTMP: 'RTMP', HLS_PUSH: 'HLS', SDI: 'SDI', SRT: 'SRT', UDP: 'UDP', RTP: 'RTP',
}

// Extrai host:porta (e modo) de uma URL de saída para exibição compacta
function formatOutputEndpoint(type: string, url: string | null, streamKey: string | null): string | null {
  if (!url) return null
  try {
    if (type === 'SRT') {
      const u = new URL(url)
      const mode = u.searchParams.get('mode')
      if (mode === 'listener') return `listener :${u.port}`
      return u.hostname ? `${u.hostname}:${u.port} (caller)` : `:${u.port}`
    }
    if (type === 'UDP' || type === 'RTP') {
      // udp://host:port?... → host:port
      const u = new URL(url)
      return `${u.hostname}:${u.port}`
    }
    if (type === 'RTMP') {
      // rtmp://server/app + streamKey → server/app/key (truncado)
      const dest = streamKey ? `${url}/${streamKey}` : url
      return dest.replace(/^rtmps?:\/\//, '').slice(0, 40) + (dest.length > 47 ? '…' : '')
    }
    if (type === 'HLS_PUSH') {
      return url.replace(/^https?:\/\//, '').slice(0, 40) + (url.length > 47 ? '…' : '')
    }
  } catch {}
  return null
}

function formatTime(sec: number) {
  const abs = Math.abs(Math.floor(sec))
  const h = Math.floor(abs / 3600)
  const m = Math.floor((abs % 3600) / 60)
  const s = abs % 60
  const sign = sec < 0 ? '-' : ''
  return h > 0
    ? `${sign}${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${sign}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// Mostra o feed da câmera no monitor do playout (srcObject não é suportado como prop)
function CameraMonitorPreview({
  stream,
  graphic,
}: {
  stream: MediaStream
  graphic?: import('../../api/playout.api').ActiveGraphic | null
}) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream
    return () => { if (ref.current) ref.current.srcObject = null }
  }, [stream])
  return (
    <>
      <video ref={ref} autoPlay muted playsInline className="w-full h-full object-cover" />
      <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full pointer-events-none z-10">
        <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
        CÂMERA AO VIVO
      </div>
      {graphic && <GraphicOverlay graphic={graphic} />}
    </>
  )
}

function ColorBars() {
  const bars = ['#FFFFFF', '#FFFF00', '#00FFFF', '#00FF00', '#FF00FF', '#FF0000', '#0000FF', '#000000']
  return (
    <div className="w-full h-full flex rounded-lg overflow-hidden">
      {bars.map((c) => <div key={c} style={{ backgroundColor: c, flex: 1 }} />)}
    </div>
  )
}

// ─── Barra de progresso do clipe ─────────────────────────────────────────────

function ClipProgressBar({ position, duration }: { position: number; duration: number }) {
  const isInfinite = duration >= Number.MAX_SAFE_INTEGER / 2
  const pct = (!isInfinite && duration > 0) ? Math.min((position / duration) * 100, 100) : 0
  const remaining = isInfinite ? null : Math.max(0, duration - position)
  return (
    <div className="space-y-1">
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-brand-500 rounded-full transition-all duration-1000 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between gap-1 text-[11px] font-mono">
        <span className="flex items-center gap-1 text-gray-500 min-w-0">
          <span className="text-[9px] font-bold uppercase tracking-wide text-gray-600 flex-shrink-0">DUR</span>
          <span>{isInfinite ? '∞' : formatTime(duration)}</span>
        </span>
        <span className="flex items-center gap-0.5 text-emerald-400 flex-shrink-0">
          <ChevronUp className="h-3 w-3" />
          {formatTime(position)}
        </span>
        <span className="flex items-center gap-0.5 text-red-400 flex-shrink-0">
          <ChevronDown className="h-3 w-3" />
          {remaining !== null ? formatTime(remaining) : '—'}
        </span>
      </div>
    </div>
  )
}

// ─── Barra de progresso do playlist ──────────────────────────────────────────

function PlaylistProgressBar({
  elapsed, total,
}: { elapsed: number; total: number }) {
  const pct = total > 0 ? Math.min((elapsed / total) * 100, 100) : 0
  const remaining = Math.max(0, total - elapsed)
  return (
    <div className="space-y-1">
      <div className="h-1 bg-gray-800/60 rounded-full overflow-hidden">
        <div
          className="h-full bg-emerald-600/50 rounded-full transition-all duration-1000 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] font-mono text-gray-600">
        <span>{formatTime(elapsed)} decorrido</span>
        <span>total {formatTime(total)}</span>
        <span className="text-amber-500/70">-{formatTime(remaining)} fim</span>
      </div>
    </div>
  )
}

// ─── Linha de output ──────────────────────────────────────────────────────────

function OutputRow({
  output, channelId, isPlaying,
  onToggle, onReconnect, toggling, reconnecting,
}: {
  output: ChannelOutput
  channelId: string
  isPlaying: boolean
  onToggle: () => void
  onReconnect: () => void
  toggling: boolean
  reconnecting: boolean
}) {
  const isOn = output.streaming
  const isActive = output.active
  const bitrateLabel = formatBitrate(output.stats)
  const speedOk = !output.stats || output.stats.speed >= 0.95

  return (
    <div className={clsx(
      'flex items-center gap-2 px-2 py-1 rounded transition-colors',
      isOn ? 'bg-emerald-950/30' : 'bg-transparent'
    )}>
      <span className={clsx(
        'h-1.5 w-1.5 rounded-full flex-shrink-0',
        isOn ? 'bg-emerald-400 animate-pulse' : isActive ? 'bg-gray-600' : 'bg-gray-700'
      )} />
      <span className={clsx(
        'text-[10px] font-mono font-bold flex-shrink-0 w-8',
        isOn ? 'text-emerald-300' : 'text-gray-600'
      )}>
        {OUTPUT_TYPE_SHORT[output.type] ?? output.type}
      </span>
      <div className="flex-1 min-w-0">
        <p className={clsx('text-xs truncate', isActive ? 'text-gray-400' : 'text-gray-600 line-through')}>
          {output.name}
          {output.description && <span className="text-gray-600 ml-1">· {output.description}</span>}
        </p>
        {(() => {
          const ep = formatOutputEndpoint(output.type, output.url, output.streamKey)
          return ep ? (
            <p className="text-[10px] font-mono text-gray-600 truncate">{ep}</p>
          ) : null
        })()}
      </div>
      <div className="flex flex-col items-end flex-shrink-0 w-16">
        <span className={clsx(
          'text-[10px] font-semibold',
          isOn ? 'text-emerald-400' : isActive ? 'text-gray-600' : 'text-gray-700'
        )}>
          {isOn ? 'ON AIR' : isActive ? 'idle' : 'off'}
        </span>
        {isOn && bitrateLabel && (
          <span className={clsx(
            'text-[9px] font-mono',
            speedOk ? 'text-emerald-300/70' : 'text-amber-400'
          )}>
            {bitrateLabel}{!speedOk && ' ⚠'}
          </span>
        )}
      </div>
      {isPlaying && isActive && (
        <button
          onClick={onReconnect}
          disabled={reconnecting}
          title="Reconectar"
          className="flex-shrink-0 text-gray-600 hover:text-amber-400 transition-colors disabled:opacity-40"
        >
          {reconnecting
            ? <span className="text-[10px] text-amber-400">...</span>
            : <RefreshCw className="h-3 w-3" />}
        </button>
      )}
      <button
        onClick={onToggle}
        disabled={toggling}
        title={isActive ? 'Desativar' : 'Ativar'}
        className={clsx(
          'flex-shrink-0 relative inline-flex h-4 w-7 items-center rounded-full transition-colors disabled:opacity-40',
          isActive ? 'bg-emerald-600' : 'bg-gray-700'
        )}
      >
        <span className={clsx(
          'inline-block h-3 w-3 rounded-full bg-white shadow transition-transform',
          isActive ? 'translate-x-3.5' : 'translate-x-0.5'
        )} />
      </button>
    </div>
  )
}

// ─── Tipo de mídia da fonte ───────────────────────────────────────────────────

function getMediaType(item: PlaylistItemRow): string {
  if (item.isBreak) return ''
  if (item.sourceType === 'URL') {
    const url = item.sourceUrl ?? ''
    if (/youtube\.com|youtu\.be/i.test(url)) return 'YT'
    if (/twitch\.tv/i.test(url)) return 'LIVE'
    if (/^srt:/i.test(url)) return 'SRT'
    if (/^rtmps?:/i.test(url)) return 'RTMP'
    if (/^rtsp:/i.test(url)) return 'RTSP'
    if (/^udp:/i.test(url)) return 'UDP'
    return 'URL'
  }
  return item.mediaReady ? 'ARQ' : '!ARQ'
}

const MEDIA_STYLE: Record<string, string> = {
  YT:   'bg-red-900/50 text-red-400 border-red-700/40',
  LIVE: 'bg-purple-900/50 text-purple-400 border-purple-700/40',
  SRT:  'bg-blue-900/50 text-blue-300 border-blue-700/40',
  RTMP: 'bg-orange-900/50 text-orange-400 border-orange-700/40',
  RTSP: 'bg-sky-900/50 text-sky-400 border-sky-700/40',
  UDP:  'bg-gray-800 text-gray-500 border-gray-600/40',
  URL:  'bg-sky-900/50 text-sky-400 border-sky-700/40',
  ARQ:  'bg-gray-800/50 text-gray-600 border-gray-700/30',
  '!ARQ': 'bg-orange-900/50 text-orange-400 border-orange-700/40',
}

// ─── Linha de item do playlist (com drag-and-drop) ───────────────────────────

function PlaylistItemRow({
  item, isCurrent, isPlayed, isDragging, isDragOver,
  playoutStatus, rowIdx, isSelected,
  onJump, onSelect, onClipPlay, onClipStop, onToggleLoop, onDelete, onSetTimer,
  loopPending, clipPlayPending, clipStopPending, deletePending,
  timerEditId, timerEditVal, setTimerEditId, setTimerEditVal, commitTimer,
  onDragStart, onDragOver, onDragEnd, onDrop,
  liveElapsed,
}: {
  item: PlaylistItemRow
  isCurrent: boolean
  isPlayed: boolean
  isDragging: boolean
  isDragOver: boolean
  playoutStatus: string
  rowIdx: number
  isSelected: boolean
  onJump: () => void
  onSelect: () => void
  onClipPlay: () => void
  onClipStop: () => void
  onToggleLoop: () => void
  onDelete: () => void
  onSetTimer: () => void
  loopPending: boolean
  clipPlayPending: boolean
  clipStopPending: boolean
  deletePending: boolean
  graphicName: string | null
  timerEditId: string | null
  timerEditVal: string
  setTimerEditId: (id: string | null) => void
  setTimerEditVal: (v: string) => void
  commitTimer: (itemId: string) => void
  onDragStart: () => void
  onDragOver: (e: React.DragEvent) => void
  onDragEnd: () => void
  onDrop: () => void
  liveElapsed?: number | null
}) {
  // Drag só começa a partir do grip handle — evita interceptar clicks em botões
  const fromHandle = useRef(false)
  const lightRow = rowIdx % 2 !== 0 && !isCurrent

  // ─── BREAK item — renderização simplificada ───────────────────────────────
  if (item.isBreak) {
    return (
      <div
        draggable
        onDragStart={(e) => {
          if (!fromHandle.current) { e.preventDefault(); return }
          fromHandle.current = false
          onDragStart()
        }}
        onDragOver={onDragOver}
        onDragEnd={() => { fromHandle.current = false; onDragEnd() }}
        onDrop={(e) => { e.preventDefault(); onDrop() }}
        className={clsx(
          'flex items-center gap-1.5 px-2 py-1.5 rounded transition-all',
          isCurrent
            ? 'bg-black ring-2 ring-yellow-400/80 shadow-[inset_3px_0_0_0_rgb(250_204_21)]'
            : 'bg-black border-l-2 border-l-yellow-600/60',
          isDragging ? 'opacity-30' : '',
          isDragOver ? 'border-t-2 border-brand-400' : '',
        )}
      >
        <GripVertical
          onMouseDown={() => { fromHandle.current = true }}
          onMouseUp={() => { fromHandle.current = false }}
          className="h-3.5 w-3.5 flex-shrink-0 cursor-grab active:cursor-grabbing text-yellow-800"
        />
        <span className="w-5 flex-shrink-0 flex items-center justify-end">
          {isCurrent
            ? <span className="h-2 w-2 rounded-full bg-yellow-400 animate-pulse flex-shrink-0" />
            : <span className="text-[10px] font-mono text-yellow-700">{item.index + 1}</span>}
        </span>
        <span className="flex-1 text-center text-xs font-bold text-yellow-400 tracking-widest uppercase">
          ⏸ BREAK
        </span>
        {timerEditId === item.id ? (
          <input
            autoFocus
            className="w-14 bg-gray-900 text-yellow-300 text-[10px] font-mono rounded px-1 py-0.5 border border-yellow-600/60 outline-none flex-shrink-0"
            placeholder="mm:ss"
            value={timerEditVal}
            onChange={(e) => setTimerEditVal(e.target.value)}
            onBlur={() => commitTimer(item.id)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitTimer(item.id); if (e.key === 'Escape') setTimerEditId(null) }}
          />
        ) : (
          <button
            onClick={onSetTimer}
            title={item.maxDuration ? `Duração: ${Math.floor(item.maxDuration/60)}:${String(item.maxDuration%60).padStart(2,'0')}` : 'Definir duração do BREAK'}
            className={clsx(
              'flex-shrink-0 flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium transition-colors',
              item.maxDuration ? 'text-yellow-400 hover:text-yellow-300 bg-yellow-500/10' : 'text-yellow-800 hover:text-yellow-500'
            )}
          >
            <Timer className="h-3 w-3" />
            {item.maxDuration && `${Math.floor(item.maxDuration/60)}:${String(item.maxDuration%60).padStart(2,'0')}`}
          </button>
        )}
        {(!isCurrent || playoutStatus === 'STOPPED' || playoutStatus === 'IDLE') && (
          <button
            onClick={onDelete}
            disabled={deletePending}
            title="Remover BREAK"
            className="flex-shrink-0 p-0.5 rounded text-yellow-800 hover:text-red-400 transition-colors disabled:opacity-40"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div
      draggable
      onDragStart={(e) => {
        if (!fromHandle.current) { e.preventDefault(); return }
        fromHandle.current = false
        onDragStart()
      }}
      onDragOver={onDragOver}
      onDragEnd={() => { fromHandle.current = false; onDragEnd() }}
      onDrop={(e) => { e.preventDefault(); onDrop() }}
      className={clsx(
        'flex items-center gap-1.5 px-2 rounded transition-all',
        isCurrent  ? 'py-2 bg-emerald-600/40 ring-2 ring-emerald-400/80 shadow-[inset_3px_0_0_0_rgb(52_211_153)]' : 'py-1.5',
        isPlayed   ? 'opacity-35' : '',
        !isCurrent ? (lightRow ? 'bg-gray-200' : 'bg-gray-800') : '',
        !isCurrent && !isPlayed ? (lightRow ? 'hover:bg-gray-100' : 'hover:bg-gray-600') : '',
        isSelected ? 'ring-2 ring-cyan-500/70 ring-inset' : '',
        isDragging ? 'opacity-30' : '',
        isDragOver ? 'border-t-2 border-brand-400' : '',
      )}
    >
      {/* Drag handle — único ponto de início do drag */}
      <GripVertical
        onMouseDown={() => { fromHandle.current = true }}
        onMouseUp={() => { fromHandle.current = false }}
        className={clsx(
          'h-3.5 w-3.5 flex-shrink-0 cursor-grab active:cursor-grabbing',
          isCurrent ? 'text-emerald-600' : lightRow ? 'text-gray-500' : 'text-gray-700'
        )}
      />

      {/* Indicador de posição — pulsing dot + ▶ para item no ar */}
      <span className="w-5 flex-shrink-0 flex items-center justify-end gap-0.5">
        {isCurrent ? (
          <>
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
            <span className="text-[10px] font-bold text-emerald-300">▶</span>
          </>
        ) : (
          <span className={clsx('text-[10px] font-mono', lightRow ? 'text-gray-500' : 'text-gray-600')}>{item.index + 1}</span>
        )}
      </span>

      {/* Badge de tipo */}
      {item.typeCode ? (
        <Badge bg={item.typeBg ?? '#374151'} color={item.typeColor ?? '#fff'} className="text-[9px] flex-shrink-0">
          {item.typeCode}
        </Badge>
      ) : (
        <span className="w-6 flex-shrink-0" />
      )}

      {/* Código */}
      <span className={clsx(
        'text-[10px] font-mono flex-shrink-0 w-14 truncate pl-2',
        isCurrent ? 'text-emerald-300/80' : lightRow ? 'text-gray-700' : 'text-gray-600'
      )} title={item.code}>
        {item.code}
      </span>

      {/* Título — clique para selecionar posição, duplo-clique para pular */}
      <button
        onClick={onSelect}
        onDoubleClick={onJump}
        title={isSelected ? 'Clique para desselecionar · Duplo clique para ir para este clipe' : 'Clique para selecionar posição · Duplo clique para ir para este clipe'}
        className={clsx(
          'flex-1 text-left text-xs truncate transition-colors min-w-0 pl-1',
          isCurrent ? 'text-emerald-50 font-bold cursor-default' : isPlayed ? 'text-gray-500 cursor-pointer' : lightRow ? 'text-gray-900 hover:text-black cursor-pointer' : 'text-gray-300 hover:text-white cursor-pointer'
        )}
      >
        {item.title}
      </button>

      {/* Badge AO AR */}
      {isCurrent && (
        <span className="flex-shrink-0 text-[9px] font-bold px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 tracking-wide animate-pulse">
          AO AR
        </span>
      )}

      {/* Tipo de mídia — coluna fixa w-10 */}
      {(() => {
        const mt = getMediaType(item)
        const cls = MEDIA_STYLE[mt]
        return cls ? (
          <span className={clsx('text-[9px] px-0.5 py-0.5 rounded border flex-shrink-0 font-medium w-10 text-center', cls)}>
            {mt}
          </span>
        ) : <span className="w-10 flex-shrink-0" />
      })()}

      {/* Gráfico — coluna fixa w-8 */}
      <span
        title={item.graphicName ? `Gráfico: ${item.graphicName}` : undefined}
        className={clsx(
          'text-[9px] py-0.5 rounded flex-shrink-0 font-mono w-8 text-center',
          item.graphicName ? 'px-0.5 bg-violet-900/50 text-violet-400 border border-violet-700/40' : ''
        )}
      >
        {item.graphicName ? 'GFX' : ''}
      </span>

      {/* Duração / elapsed para itens URL ao vivo */}
      {isCurrent && item.sourceType === 'URL' && liveElapsed != null ? (
        <span className="text-[10px] font-mono flex-shrink-0 w-10 text-right text-sky-400 animate-pulse">
          {formatTime(liveElapsed)}
        </span>
      ) : (
        <span className={clsx('text-[10px] font-mono flex-shrink-0 w-10 text-right', lightRow ? 'text-gray-700' : 'text-gray-600')}>
          {item.sourceType === 'URL' && item.maxDuration
            ? formatTime(item.maxDuration)
            : item.sourceType === 'URL'
            ? '∞'
            : formatTime(item.duration)}
        </span>
      )}

      {/* Controles por clipe */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {isCurrent ? (
          <>
            {/* Clipe atual: play/pause toggle */}
            <button
              onClick={onClipPlay}
              disabled={clipPlayPending}
              title={playoutStatus === 'PLAYING' ? 'Pausar' : 'Reproduzir'}
              className={clsx(
                'p-0.5 rounded transition-colors disabled:opacity-40',
                playoutStatus === 'PLAYING'
                  ? 'text-amber-400 hover:text-amber-300'
                  : 'text-emerald-400 hover:text-emerald-300'
              )}
            >
              {playoutStatus === 'PLAYING'
                ? <Pause className="h-3 w-3" />
                : <Play className="h-3 w-3" />}
            </button>
            {/* Clipe atual: stop → passthrough */}
            <button
              onClick={onClipStop}
              disabled={clipStopPending}
              title="Stop — comuta para sinal passthrough"
              className="p-0.5 rounded text-red-500 hover:text-red-400 transition-colors disabled:opacity-40"
            >
              <Square className="h-3 w-3" />
            </button>
          </>
        ) : (
          <>
            {/* Outro clipe: play para pular e reproduzir */}
            <button
              onClick={onClipPlay}
              disabled={clipPlayPending || playoutStatus === 'STOPPED' || playoutStatus === 'IDLE'}
              title="Ir para este clipe e reproduzir"
              className="p-0.5 rounded text-gray-600 hover:text-emerald-400 transition-colors disabled:opacity-30"
            >
              <Play className="h-3 w-3" />
            </button>
            <span className="w-3.5" />
          </>
        )}
      </div>

      {/* Timer — só para URL clips */}
      {['URL', 'YOUTUBE'].includes(item.sourceType) && (
        timerEditId === item.id ? (
          <input
            autoFocus
            className="w-14 bg-gray-700 text-gray-100 text-[10px] font-mono rounded px-1 py-0.5 border border-amber-500/60 outline-none flex-shrink-0"
            placeholder="mm:ss"
            value={timerEditVal}
            onChange={(e) => setTimerEditVal(e.target.value)}
            onBlur={() => commitTimer(item.id)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitTimer(item.id); if (e.key === 'Escape') setTimerEditId(null) }}
          />
        ) : (
          <button
            onClick={onSetTimer}
            title={item.maxDuration ? `Timer: avança após ${Math.floor(item.maxDuration/60)}:${String(item.maxDuration%60).padStart(2,'0')}` : 'Definir timer de avanço'}
            className={clsx(
              'flex-shrink-0 flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium transition-colors',
              item.maxDuration ? 'text-amber-400 hover:text-amber-300 bg-amber-500/10' : 'text-gray-700 hover:text-gray-400'
            )}
          >
            <Timer className="h-3 w-3" />
            {item.maxDuration && `${Math.floor(item.maxDuration/60)}:${String(item.maxDuration%60).padStart(2,'0')}`}
          </button>
        )
      )}

      {/* Loop toggle */}
      <button
        onClick={onToggleLoop}
        disabled={loopPending}
        title={item.loop ? 'Desativar loop' : 'Ativar loop'}
        className={clsx(
          'flex-shrink-0 p-0.5 rounded transition-colors disabled:opacity-40',
          item.loop ? 'text-amber-500 hover:text-amber-400' : lightRow ? 'text-gray-500 hover:text-gray-700' : 'text-gray-700 hover:text-gray-400'
        )}
      >
        <RotateCcw className="h-3 w-3" />
      </button>

      {/* Excluir item — visível para não-atual, ou para qualquer item quando parado/idle */}
      {(!isCurrent || playoutStatus === 'STOPPED' || playoutStatus === 'IDLE') && (
        <button
          onClick={onDelete}
          disabled={deletePending}
          title="Remover da playlist"
          className={clsx('flex-shrink-0 p-0.5 rounded transition-colors disabled:opacity-40', lightRow ? 'text-gray-500 hover:text-red-600' : 'text-gray-700 hover:text-red-400')}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

// ─── Painel principal ─────────────────────────────────────────────────────────

interface ChannelPanelProps {
  channel: Channel
}

export default function ChannelPanel({ channel }: ChannelPanelProps) {
  const qc = useQueryClient()
  const { state, connected } = usePlayoutSocket(channel.id)

  const { data: sysSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
    staleTime: 60_000,
  })

  const camera = useCameraStream(channel.id)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [saveAsName, setSaveAsName] = useState('')
  const [monitorOpen, setMonitorOpen] = useState(true)
  const [fallbackOpen, setFallbackOpen] = useState(true)
  const [signalSelectorOpen, setSignalSelectorOpen] = useState(false)
  const [outputsOpen, setOutputsOpen] = useState(true)
  const [playlistOpen, setPlaylistOpen] = useState(true)
  const [defaultsApplied, setDefaultsApplied] = useState(false)
  const playlistScrollRef = useRef<HTMLDivElement>(null)
  const currentItemRef = useRef<HTMLDivElement>(null)

  // Aplica defaults do SystemSettings na primeira carga
  useEffect(() => {
    if (sysSettings && !defaultsApplied) {
      setMonitorOpen(sysSettings.defaultMonitorOpen)
      setFallbackOpen(sysSettings.defaultFallbackOpen)
      setOutputsOpen(sysSettings.defaultOutputsOpen)
      setPlaylistOpen(sysSettings.defaultPlaylistOpen)
      setDefaultsApplied(true)
    }
  }, [sysSettings, defaultsApplied])
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  const { selectedByChannel, setSelected, clearSelected } = usePlayoutSelection()
  const selectedItemId = selectedByChannel[channel.id] ?? null
  const setSelectedItemId = (id: string | null) => id === null ? clearSelected(channel.id) : setSelected(channel.id, id)
  const [monitorSrc, setMonitorSrc] = useState<string | null>(null)
  const [monitorStartAt, setMonitorStartAt] = useState(0)
  const [serverPreviewUrl, setServerPreviewUrl] = useState<string | null>(null)
  const [serverPreviewLoading, setServerPreviewLoading] = useState(false)
  const [serverPreviewError, setServerPreviewError] = useState<string | null>(null)
  const activeServerPreviewId = useRef<string | null>(null)

  const status = state?.status ?? 'IDLE'
  const item = state?.currentItem ?? null
  const position = state?.position ?? 0
  const totalElapsed = state?.totalElapsed ?? 0
  const totalPlaylistDuration = state?.totalPlaylistDuration ?? 0
  const currentIndex = state?.currentIndex ?? 0
  const itemCount = state?.itemCount ?? 0

  // Auto-scroll: mantém o clipe atual no topo da área visível do grid
  useEffect(() => {
    const container = playlistScrollRef.current
    const item = currentItemRef.current
    if (!container || !item || !playlistOpen) return
    const itemTop = item.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
    container.scrollTo({ top: Math.max(0, itemTop), behavior: 'smooth' })
  }, [currentIndex, playlistOpen])

  // Refetch items ao trocar de playlist (ex: "usar este roteiro" enquanto outro está ativo)
  const prevPlaylistIdRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (prevPlaylistIdRef.current !== undefined && prevPlaylistIdRef.current !== state?.playlistId && state?.playlistId) {
      refetchItems()
    }
    prevPlaylistIdRef.current = state?.playlistId
  }, [state?.playlistId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Atualiza o monitor quando o clipe muda
  useEffect(() => {
    if (monitorOpen && item?.hlsPath) {
      setMonitorSrc(hlsStreamUrl(item.hlsPath))
      setMonitorStartAt((item.cueIn ?? 0) + position)
    } else if (monitorOpen && !item?.hlsPath) {
      setMonitorSrc(null)
    }
  }, [item?.clipId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Preview server-side para fontes ao vivo (fallback quando parado)
  useEffect(() => {
    const src = channel.fallbackSource
    const isIdle = status === 'IDLE' || status === 'STOPPED'
    const needsServerPreview =
      monitorOpen && isIdle &&
      channel.fallbackType === 'INPUT_SOURCE' && src &&
      (src.type === 'YOUTUBE' || src.type === 'SRT' || src.type === 'SDI' || src.type === 'USB' ||
       src.type === 'CLIP' ||
       (src.type === 'IP' && src.url && !src.url.match(/\.m3u8/i)))

    if (!needsServerPreview) {
      if (activeServerPreviewId.current) {
        inputSourcesApi.stopPreview(activeServerPreviewId.current).catch(() => {})
        activeServerPreviewId.current = null
      }
      setServerPreviewUrl(null)
      setServerPreviewError(null)
      return
    }

    const sourceId = src!.id
    activeServerPreviewId.current = sourceId
    setServerPreviewLoading(true)
    setServerPreviewError(null)
    setServerPreviewUrl(null)

    inputSourcesApi.startPreview(sourceId)
      .then(({ hlsUrl }) => setServerPreviewUrl(hlsUrl))
      .catch((e: any) => {
        const d = e.response?.data
        setServerPreviewError(d?.detail ? `${d.error}: ${d.detail}` : d?.error ?? 'Falha ao iniciar preview')
      })
      .finally(() => setServerPreviewLoading(false))

    return () => {
      inputSourcesApi.stopPreview(sourceId).catch(() => {})
      activeServerPreviewId.current = null
    }
  }, [monitorOpen, channel.fallbackSourceId, status]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleMonitor() {
    if (monitorOpen) {
      setMonitorOpen(false)
      setMonitorSrc(null)
    } else {
      if (item?.hlsPath) {
        setMonitorSrc(hlsStreamUrl(item.hlsPath))
        setMonitorStartAt((item.cueIn ?? 0) + position)
      }
      setMonitorOpen(true)
    }
  }

  // ─── Queries ────────────────────────────────────────────────────────────────

  const { data: inputSources = [] } = useQuery({
    queryKey: ['input-sources'],
    queryFn: inputSourcesApi.list,
    staleTime: 30_000,
  })

  const { data: outputs = [] } = useQuery({
    queryKey: ['channel-outputs', channel.id],
    queryFn: () => playoutApi.getOutputs(channel.id),
    refetchInterval: 4000,
  })

  const { data: playlistItems = [], refetch: refetchItems } = useQuery({
    queryKey: ['playout-items', channel.id],
    queryFn: () => playoutApi.getItems(channel.id),
    enabled: !!state?.playlistId,
    refetchInterval: state?.playlistId ? 15_000 : false,
  })

  // ─── Mutations ──────────────────────────────────────────────────────────────

  const toggleOutput = useMutation({
    mutationFn: (outputId: string) => playoutApi.toggleOutput(channel.id, outputId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channel-outputs', channel.id] }),
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao alternar saída'),
  })

  const reconnectOutput = useMutation({
    mutationFn: (outputId: string) => playoutApi.reconnectOutput(channel.id, outputId),
    onSuccess: () => { toast.success('Reconectando...'); qc.invalidateQueries({ queryKey: ['channel-outputs', channel.id] }) },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao reconectar'),
  })

  const fallbackMut = useMutation({
    mutationFn: (data: { fallbackType: FallbackType; fallbackSourceId?: string | null }) =>
      playoutApi.setFallback(channel.id, data.fallbackType, data.fallbackSourceId),
    onSuccess: () => {
      toast.success('Sinal de fallback atualizado')
      setFallbackOpen(true)
      setSignalSelectorOpen(false)
      qc.invalidateQueries({ queryKey: ['channels'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao definir fallback'),
  })

  const cutToInputMut = useMutation({
    mutationFn: (sourceId: string) => playoutApi.cutToInput(channel.id, sourceId),
    onSuccess: () => {
      toast.success('Cortando para entrada...')
      qc.invalidateQueries({ queryKey: ['channels'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao comutar entrada'),
  })

  const toggleLoopMut = useMutation({
    mutationFn: (itemId: string) => playoutApi.toggleItemLoop(channel.id, itemId),
    onSuccess: () => refetchItems(),
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao alterar loop'),
  })

  const [timerEditId, setTimerEditId] = useState<string | null>(null)
  const [timerEditVal, setTimerEditVal] = useState('')

  const setMaxDurationMut = useMutation({
    mutationFn: ({ itemId, maxDuration }: { itemId: string; maxDuration: number | null }) =>
      playlistsApi.updateItem(state?.playlistId ?? '', itemId, { maxDuration }),
    onSuccess: () => refetchItems(),
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao definir timer'),
  })

  function openTimerEdit(item: { id: string; maxDuration: number | null }) {
    setTimerEditId(item.id)
    const v = item.maxDuration
    setTimerEditVal(v ? `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}` : '')
  }

  function commitTimer(itemId: string) {
    const raw = timerEditVal.trim()
    let secs: number | null = null
    if (raw) {
      if (raw.includes(':')) {
        const [m, s] = raw.split(':').map(Number)
        secs = (m || 0) * 60 + (s || 0)
      } else {
        secs = parseInt(raw, 10) * 60
      }
      if (!secs || secs <= 0) secs = null
    }
    setMaxDurationMut.mutate({ itemId, maxDuration: secs })
    setTimerEditId(null)
  }

  const togglePlaylistLoopMut = useMutation({
    mutationFn: () => playoutApi.togglePlaylistLoop(channel.id),
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao alterar loop da playlist'),
  })

  const reorderMut = useMutation({
    mutationFn: (payload: { id: string; order: number }[]) =>
      playoutApi.reorderItems(state!.playlistId!, payload),
    onSuccess: () => {
      refetchItems()
      toast.success('Ordem atualizada — ativa na próxima transição')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao reordenar'),
  })

  const deleteItemMut = useMutation({
    mutationFn: (itemId: string) => playoutApi.removeItem(channel.id, itemId),
    onSuccess: () => { toast.success('Item removido'); refetchItems() },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao remover item'),
  })

  const clonePlaylistMut = useMutation({
    mutationFn: (name: string) => playlistsApi.clone(state!.playlistId!, name || undefined),
    onSuccess: (pl) => {
      toast.success(`Playlist "${pl.name}" salva`)
      setSaveAsOpen(false)
      setSaveAsName('')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao salvar como'),
  })

  const clearItemsMut = useMutation({
    mutationFn: () => playlistsApi.clearItems(state!.playlistId!),
    onSuccess: () => { toast.success('Grid limpo'); refetchItems() },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao limpar grid'),
  })

  function handleDragStart(idx: number) { setDragIdx(idx) }
  function handleDragOver(e: React.DragEvent, idx: number) { e.preventDefault(); setOverIdx(idx) }
  function handleDragEnd() { setDragIdx(null); setOverIdx(null) }
  function handleDrop(targetIdx: number) {
    if (dragIdx == null || dragIdx === targetIdx) { setDragIdx(null); setOverIdx(null); return }
    const newItems = [...playlistItems]
    const [moved] = newItems.splice(dragIdx, 1)
    newItems.splice(targetIdx, 0, moved)
    const reordered = newItems.map((item, i) => ({ id: item.id, order: i }))
    reorderMut.mutate(reordered)
    setDragIdx(null)
    setOverIdx(null)
  }

  const onErr = (e: any) => toast.error(e.response?.data?.error ?? 'Erro')

  const playMut = useMutation({
    mutationFn: (playlistId: string) => playoutApi.play(channel.id, playlistId),
    onSuccess: () => toast.success('Reprodução iniciada'),
    onError: onErr,
  })
  const pauseMut = useMutation({
    mutationFn: () => playoutApi.pause(channel.id),
    onError: onErr,
  })
  const resumeMut = useMutation({
    mutationFn: () => playoutApi.resume(channel.id),
    onError: onErr,
  })
  const stopMut = useMutation({
    mutationFn: () => playoutApi.stop(channel.id),
    onSuccess: () => toast.success('Parado'),
    onError: onErr,
  })
  const nextMut = useMutation({
    mutationFn: () => playoutApi.next(channel.id),
    onError: onErr,
  })
  const prevMut = useMutation({
    mutationFn: () => playoutApi.prev(channel.id),
    onError: onErr,
  })

  const jumpMut = useMutation({
    mutationFn: (index: number) => playoutApi.jump(channel.id, index),
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao avançar'),
  })

  function handlePlay() {
    if (!state?.playlistId) return
    playMut.mutate(state.playlistId)
  }

  function handleClipPlay(idx: number) {
    if (status === 'STOPPED' || status === 'IDLE') return
    if (idx === currentIndex) {
      if (status === 'PLAYING') pauseMut.mutate()
      else if (status === 'PAUSED') resumeMut.mutate()
    } else {
      jumpMut.mutate(idx, {
        onSuccess: () => { if (status === 'PAUSED') resumeMut.mutate() },
      })
    }
  }

  const availableSources = inputSources.filter(
    (s) => s.active && (!s.channelId || s.channelId === channel.id)
  )

  const activeOutputs = outputs.filter((o) => o.streaming).length
  const streamingUp = activeOutputs > 0

  const statusColor = status === 'PLAYING' ? 'text-emerald-400'
    : status === 'PAUSED' ? 'text-amber-400'
    : (status === 'STOPPED' || status === 'IDLE') && streamingUp ? 'text-sky-400'
    : status === 'STOPPED' ? 'text-red-400'
    : 'text-gray-500'

  const statusLabel = status === 'PLAYING' ? 'AO AR'
    : status === 'PAUSED' ? 'PAUSADO'
    : (status === 'STOPPED' || status === 'IDLE') && streamingUp ? 'FALLBACK UP'
    : status === 'STOPPED' ? 'PARADO'
    : 'AGUARDANDO'

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={clsx(
      'card flex flex-col gap-0 overflow-hidden transition-all',
      status === 'PLAYING' && 'ring-1 ring-emerald-500/30'
    )}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2.5">
          <div className={clsx(
            'h-8 w-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0',
            status === 'PLAYING' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-gray-800 text-gray-400'
          )}>
            {channel.number}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white leading-tight truncate">{channel.name}</p>
            <div className="flex items-center gap-1.5">
              <p className={clsx('text-[11px] font-bold tracking-wider', statusColor)}>{statusLabel}</p>
              {(status === 'PLAYING' || ((status === 'STOPPED' || status === 'IDLE') && streamingUp)) && (
                <span className={`flex items-center gap-0.5 text-[10px] font-semibold ${status === 'PLAYING' ? 'text-emerald-400' : 'text-sky-400'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full animate-pulse ${status === 'PLAYING' ? 'bg-emerald-400' : 'bg-sky-400'}`} />
                  {status === 'PLAYING' ? 'LIVE' : `${activeOutputs} UP`}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {connected
            ? <Wifi className="h-3.5 w-3.5 text-emerald-500" />
            : <WifiOff className="h-3.5 w-3.5 text-red-500" />}
          <button
            onClick={() => setFallbackOpen((v) => !v)}
            className={clsx(
              'p-1 rounded transition-colors',
              fallbackOpen ? 'text-brand-400 hover:text-brand-300' : 'text-gray-500 hover:text-gray-300'
            )}
            title={fallbackOpen ? 'Ocultar sinal/fallback' : 'Mostrar sinal/fallback'}
          >
            <Antenna className="h-4 w-4" />
          </button>
          <button
            onClick={toggleMonitor}
            className={clsx(
              'p-1 rounded transition-colors',
              monitorOpen ? 'text-brand-400 hover:text-brand-300' : 'text-gray-500 hover:text-gray-300'
            )}
            title={monitorOpen ? 'Fechar monitor' : 'Abrir monitor'}
          >
            {monitorOpen
              ? <MonitorOff className="h-4 w-4" />
              : <MonitorPlay className="h-4 w-4" />}
          </button>
          <button
            onClick={() => setCameraOpen(true)}
            className={clsx(
              'p-1 rounded transition-colors',
              camera.active
                ? 'text-red-400 animate-pulse'
                : 'text-gray-500 hover:text-sky-400'
            )}
            title={camera.active ? 'Câmera ao vivo — clique para gerenciar' : 'Câmera — transmitir da webcam'}
          >
            <Camera className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Monitor de vídeo ──────────────────────────────────────────────── */}
      {monitorOpen && (
        <div className="px-3 pt-3 pb-2 border-b border-gray-800">
          <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-black">
            {/* Câmera tem prioridade — substitui qualquer outro conteúdo no monitor */}
            {camera.active && camera.previewStream ? (
              <CameraMonitorPreview stream={camera.previewStream} graphic={state?.activeGraphic} />
            ) : (status === 'PLAYING' || status === 'PAUSED') && !item?.isBreak ? (
              monitorSrc
                ? <>
                    <VideoPlayer src={monitorSrc} startAt={monitorStartAt} autoPlay muted className="w-full h-full" />
                    {state?.activeGraphic && <GraphicOverlay graphic={state.activeGraphic} />}
                  </>
                : item?.sourceType === 'URL'
                  ? (() => {
                      const embed = embedUrlForMonitor(item.sourceUrl)
                      return embed ? (
                        <>
                          <iframe
                            src={embed}
                            className="w-full h-full border-0"
                            allow="autoplay; fullscreen"
                            allowFullScreen
                            title={item.title}
                          />
                          {streamingUp && (
                            <div className="absolute top-2 right-2 flex items-center gap-1 bg-emerald-600/80 backdrop-blur-sm px-1.5 py-0.5 rounded text-[9px] font-bold text-white">
                              <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                              ON AIR
                            </div>
                          )}
                          {state?.activeGraphic && <GraphicOverlay graphic={state.activeGraphic} />}
                        </>
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-black">
                          <Antenna className="h-5 w-5 text-sky-500 animate-pulse" />
                          <p className="text-xs text-sky-400 font-medium">Streaming via yt-dlp</p>
                          {item.sourceUrl && (
                            <p className="text-[10px] text-gray-500 truncate max-w-[90%] text-center">{item.sourceUrl}</p>
                          )}
                        </div>
                      )
                    })()
                  : <div className="w-full h-full flex items-center justify-center"><Radio className="h-6 w-6 text-gray-700" /></div>
            ) : (
              (() => {
                if (channel.fallbackType === 'COLORBARS') return <ColorBars />
                if (channel.fallbackType === 'INPUT_SOURCE') {
                  const src = channel.fallbackSource
                  if (!src) return <div className="w-full h-full bg-black" />
                  if (src.type === 'IP' && src.url?.match(/\.m3u8/i))
                    return <VideoPlayer src={src.url} autoPlay muted className="w-full h-full" />
                  if (serverPreviewLoading) {
                    const isYtUrl = /youtube\.com|youtu\.be|twitch\.tv/i.test(src.url ?? '')
                    const isYt = src.type === 'YOUTUBE' || isYtUrl
                    return (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                        <Antenna className="h-5 w-5 text-gray-600 animate-pulse" />
                        <p className="text-[10px] text-gray-500">
                          {isYt ? 'Resolvendo via yt-dlp...' : 'Iniciando preview...'}
                        </p>
                      </div>
                    )
                  }
                  if (serverPreviewError) return (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-1 px-4">
                      <Antenna className="h-5 w-5 text-red-500/60" />
                      <p className="text-xs text-gray-400 font-medium text-center">{src.name}</p>
                      <p className="text-[10px] text-red-400/70 text-center">{serverPreviewError}</p>
                    </div>
                  )
                  if (serverPreviewUrl)
                    return <VideoPlayer src={serverPreviewUrl} autoPlay muted className="w-full h-full" />
                  return (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-1">
                      <Antenna className="h-5 w-5 text-gray-600" />
                      <p className="text-xs text-gray-400 font-medium">{src.name}</p>
                      <p className="text-[10px] text-gray-600">{src.type}</p>
                    </div>
                  )
                }
                return <div className="w-full h-full bg-black" />
              })()
            )}
          </div>
        </div>
      )}


      {/* ── Seletor de sinal / Fallback ───────────────────────────────────── */}
      {fallbackOpen && (
        <div className="px-3 py-2 border-b border-gray-800">
          {/* Seletor de sinal + CUT buttons */}
          <div className="flex items-center gap-1 flex-wrap">
            <button
              onClick={() => setSignalSelectorOpen((v) => !v)}
              className={clsx(
                'text-[10px] font-semibold mr-1 transition-colors flex items-center gap-0.5',
                signalSelectorOpen ? 'text-brand-400' : 'text-gray-600 hover:text-gray-400'
              )}
              title={signalSelectorOpen ? 'Ocultar seletor de sinal' : 'Mostrar seletor de sinal'}
            >
              <ChevronDown className={clsx('h-2.5 w-2.5 transition-transform', signalSelectorOpen ? 'rotate-180' : '')} />
              Sinal:
            </button>
            {/* Label da seleção atual (sempre visível, compacto) */}
            <span className="text-[10px] text-gray-500">
              {channel.fallbackType === 'BLACK' && '⬛ Black'}
              {channel.fallbackType === 'COLORBARS' && '🎨 Barras'}
              {channel.fallbackType === 'INPUT_SOURCE' && (
                <span className="flex items-center gap-0.5"><Antenna className="h-2.5 w-2.5" />{channel.fallbackSource?.name ?? '—'}</span>
              )}
            </span>

            {/* Botões expandidos — só aparecem quando signalSelectorOpen */}
            {signalSelectorOpen && (
              <>
                {(['BLACK', 'COLORBARS'] as FallbackType[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => fallbackMut.mutate({ fallbackType: t, fallbackSourceId: null })}
                    className={clsx(
                      'text-[10px] px-2 py-0.5 rounded transition-colors',
                      channel.fallbackType === t
                        ? 'bg-brand-600/30 text-brand-300 ring-1 ring-brand-500/30'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    )}
                  >
                    {t === 'BLACK' ? '⬛ Black' : '🎨 Barras'}
                  </button>
                ))}
                {availableSources.map((s) => {
                  const isActive = channel.fallbackType === 'INPUT_SOURCE' && channel.fallbackSourceId === s.id
                  const isPlaying = status === 'PLAYING' || status === 'PAUSED'
                  return (
                    <div key={s.id} className="flex items-center gap-0.5">
                      <button
                        onClick={() => fallbackMut.mutate({ fallbackType: 'INPUT_SOURCE', fallbackSourceId: s.id })}
                        className={clsx(
                          'text-[10px] px-2 py-0.5 rounded-l transition-colors flex items-center gap-1',
                          isActive
                            ? 'bg-brand-600/30 text-brand-300 ring-1 ring-brand-500/30'
                            : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                        )}
                      >
                        <Antenna className="h-2.5 w-2.5" />{s.name}
                      </button>
                      <button
                        onClick={() => cutToInputMut.mutate(s.id)}
                        disabled={cutToInputMut.isPending}
                        title="Cortar para esta entrada agora"
                        className={clsx(
                          'text-[10px] px-1.5 py-0.5 rounded-r font-bold transition-colors disabled:opacity-40',
                          isPlaying
                            ? 'bg-red-600/30 text-red-300 hover:bg-red-600/50 ring-1 ring-red-500/30'
                            : 'bg-gray-700 text-gray-500 hover:bg-gray-600 hover:text-gray-300'
                        )}
                      >
                        CUT
                      </button>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Saídas de streaming ───────────────────────────────────────────── */}
      {outputs.length > 0 && (
        <div className="border-b border-gray-800/60 bg-gray-900/20">
          <div className="flex items-center justify-between px-3 pt-1.5 pb-0.5">
            <span className="text-[10px] uppercase tracking-widest text-gray-600 font-semibold">
              Saídas
              {!outputsOpen && (
                <span className="ml-1.5 text-gray-700 normal-case tracking-normal">
                  ({outputs.filter((o) => o.streaming).length} ao ar)
                </span>
              )}
            </span>
            <button
              onClick={() => setOutputsOpen((v) => !v)}
              className="text-gray-700 hover:text-gray-400 transition-colors"
              title={outputsOpen ? 'Ocultar saídas' : 'Mostrar saídas'}
            >
              {outputsOpen
                ? <ChevronUp className="h-3 w-3" />
                : <ChevronDown className="h-3 w-3" />}
            </button>
          </div>
          {outputsOpen && (
            <div className="px-2 pb-1.5">
              {outputs.map((o) => (
                <OutputRow
                  key={o.id}
                  output={o}
                  channelId={channel.id}
                  isPlaying={status === 'PLAYING'}
                  onToggle={() => toggleOutput.mutate(o.id)}
                  onReconnect={() => reconnectOutput.mutate(o.id)}
                  toggling={toggleOutput.isPending && toggleOutput.variables === o.id}
                  reconnecting={reconnectOutput.isPending && reconnectOutput.variables === o.id}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Playlist de itens ─────────────────────────────────────────────── */}
      {state?.playlistId ? (
        <div className="border-t border-gray-800">
          {/* Header da playlist com transport controls integrados */}
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-gray-800/50">
            {/* Controles de transporte */}
            <button
              onClick={() => prevMut.mutate()}
              disabled={status === 'IDLE' || prevMut.isPending}
              title="Clipe anterior"
              className="p-1 rounded text-gray-500 hover:text-white hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <SkipBack className="h-3.5 w-3.5" />
            </button>

            {status === 'PLAYING' ? (
              <button
                onClick={() => pauseMut.mutate()}
                disabled={pauseMut.isPending}
                title="Pausar"
                className="p-1 rounded text-amber-400 hover:bg-amber-900/30 disabled:opacity-40 transition-colors"
              >
                <Pause className="h-3.5 w-3.5" />
              </button>
            ) : status === 'PAUSED' ? (
              <button
                onClick={() => resumeMut.mutate()}
                disabled={resumeMut.isPending}
                title="Retomar"
                className="p-1 rounded text-emerald-400 hover:bg-emerald-900/30 disabled:opacity-40 transition-colors"
              >
                <Play className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                onClick={handlePlay}
                disabled={playMut.isPending}
                title="Play"
                className="p-1 rounded text-emerald-400 hover:bg-emerald-900/30 disabled:opacity-40 transition-colors"
              >
                <Play className="h-3.5 w-3.5" />
              </button>
            )}

            <button
              onClick={() => stopMut.mutate()}
              disabled={status === 'IDLE' || stopMut.isPending}
              title="Stop"
              className="p-1 rounded text-red-400 hover:bg-red-900/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <Square className="h-3.5 w-3.5" />
            </button>

            <button
              onClick={() => nextMut.mutate()}
              disabled={status === 'IDLE' || nextMut.isPending}
              title="Próximo clipe"
              className="p-1 rounded text-gray-500 hover:text-white hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <SkipForward className="h-3.5 w-3.5" />
            </button>

            {selectedItemId && (
              <span className="flex items-center gap-1 text-[9px] text-cyan-400 border border-cyan-700/40 rounded px-1.5 py-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
                #{(playlistItems.findIndex(p => p.id === selectedItemId) + 1)}
                <button onClick={() => setSelectedItemId(null)} className="ml-0.5 text-cyan-600 hover:text-cyan-300">✕</button>
              </span>
            )}

            <div className="flex-1" />

            {/* Loop da playlist */}
            <button
              onClick={() => togglePlaylistLoopMut.mutate()}
              disabled={togglePlaylistLoopMut.isPending}
              title={state?.loop ? 'Loop ativo — clique para desativar' : 'Ativar loop da playlist'}
              className={clsx(
                'flex-shrink-0 p-0.5 rounded transition-colors disabled:opacity-40',
                state?.loop ? 'text-emerald-400 hover:text-emerald-300' : 'text-gray-600 hover:text-gray-400'
              )}
            >
              <Repeat className="h-3.5 w-3.5" />
            </button>

            {/* Limpar grid — apenas em stop/idle com playlist ativa */}
            {(status === 'STOPPED' || status === 'IDLE') && state?.playlistId && (
              <>
                <button
                  onClick={() => {
                    if (playlistItems.length === 0) return
                    if (!confirm('Remover todos os itens do grid?')) return
                    clearItemsMut.mutate()
                  }}
                  disabled={clearItemsMut.isPending || playlistItems.length === 0}
                  title="Limpar grid (remover todos os itens)"
                  className="flex-shrink-0 text-gray-600 hover:text-red-400 transition-colors disabled:opacity-30"
                >
                  <Eraser className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            {playlistItems.length > 0 && (
              <span className="text-[10px] text-gray-700 flex-shrink-0">
                {playlistItems.length} · {formatTime(totalPlaylistDuration)}
              </span>
            )}

            <button
              onClick={() => setPlaylistOpen((v) => !v)}
              className="flex-shrink-0 text-gray-600 hover:text-gray-400 transition-colors"
              title={playlistOpen ? 'Ocultar playlist' : 'Mostrar playlist'}
            >
              {playlistOpen
                ? <ChevronUp className="h-3.5 w-3.5" />
                : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>

          {/* Barras de progresso compactas */}
          {item && (
            <div className="px-3 pt-1.5 pb-1 space-y-1 border-b border-gray-800/40">
              <ClipProgressBar position={position} duration={item.duration} />
              {totalPlaylistDuration > 0 && (
                <PlaylistProgressBar elapsed={totalElapsed} total={totalPlaylistDuration} />
              )}
            </div>
          )}

          {/* Cabeçalho das colunas do grid */}
          {playlistOpen && (
            <div className="flex items-center gap-1.5 px-2 py-2 border-b-2 border-gray-600 bg-gray-800 select-none">
              <span className="w-3.5 flex-shrink-0" />
              <span className="text-[11px] font-extrabold uppercase tracking-widest text-gray-200 w-5 text-right flex-shrink-0">#</span>
              <span className="text-[11px] font-extrabold uppercase tracking-widest text-gray-200 w-8 flex-shrink-0">Tipo</span>
              <span className="text-[11px] font-extrabold uppercase tracking-widest text-gray-500 w-14 flex-shrink-0 pl-2">Cód.</span>
              <span className="text-[11px] font-extrabold uppercase tracking-widest text-gray-200 flex-1 min-w-0 pl-1">Título</span>
              <span className="text-[11px] font-extrabold uppercase tracking-widest text-gray-500 w-8 text-center flex-shrink-0">GFX</span>
              <span className="text-[11px] font-extrabold uppercase tracking-widest text-gray-200 w-10 text-center flex-shrink-0">Mídia</span>
              <span className="text-[11px] font-extrabold uppercase tracking-widest text-gray-200 w-10 text-right flex-shrink-0">Dur.</span>
              <span className="w-8 flex-shrink-0" />
              <span className="text-[11px] font-extrabold uppercase tracking-widest text-gray-200 flex-shrink-0 px-0.5">Loop</span>
              <span className="w-4 flex-shrink-0" />
            </div>
          )}

          {/* Itens com DnD */}
          {playlistOpen && (
            <div ref={playlistScrollRef} className="max-h-72 overflow-y-auto py-1">
              {playlistItems.length === 0 ? (
                <p className="text-[11px] text-gray-600 text-center py-3">Carregando...</p>
              ) : (
                playlistItems.map((pi, idx) => (
                  <div key={pi.id} ref={idx === currentIndex ? currentItemRef : undefined}>
                    <PlaylistItemRow
                      item={pi}
                      isCurrent={idx === currentIndex}
                      isPlayed={idx < currentIndex}
                      isDragging={dragIdx === idx}
                      isDragOver={overIdx === idx && dragIdx !== idx}
                      playoutStatus={status}
                      rowIdx={idx}
                      isSelected={pi.id === selectedItemId}
                      onSelect={() => setSelectedItemId(pi.id === selectedItemId ? null : pi.id)}
                      onJump={() => jumpMut.mutate(idx)}
                      onClipPlay={() => handleClipPlay(idx)}
                      onClipStop={() => stopMut.mutate()}
                      onToggleLoop={() => toggleLoopMut.mutate(pi.id)}
                      onDelete={() => deleteItemMut.mutate(pi.id)}
                      onSetTimer={() => openTimerEdit(pi)}
                      loopPending={toggleLoopMut.isPending && toggleLoopMut.variables === pi.id}
                      deletePending={deleteItemMut.isPending && deleteItemMut.variables === pi.id}
                      graphicName={pi.graphicName}
                      timerEditId={timerEditId}
                      timerEditVal={timerEditVal}
                      setTimerEditId={setTimerEditId}
                      setTimerEditVal={setTimerEditVal}
                      commitTimer={commitTimer}
                      clipPlayPending={(jumpMut.isPending || pauseMut.isPending || resumeMut.isPending) && idx === currentIndex}
                      clipStopPending={stopMut.isPending}
                      onDragStart={() => handleDragStart(idx)}
                      onDragOver={(e) => handleDragOver(e, idx)}
                      onDragEnd={handleDragEnd}
                      onDrop={() => handleDrop(idx)}
                      liveElapsed={idx === currentIndex && pi.sourceType === 'URL' ? position : null}
                    />
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="px-4 py-3 border-t border-gray-800">
          <p className="text-[11px] text-gray-600 italic">Selecione um roteiro na Biblioteca.</p>
        </div>
      )}

      {/* ── Modal: salvar como ───────────────────────────────────────────── */}
      <Modal
        open={saveAsOpen}
        onClose={() => setSaveAsOpen(false)}
        title="Salvar Roteiro Como"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-400">
            Cria uma cópia da playlist atual com todos os itens. O original não é alterado.
          </p>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Nome da nova playlist</label>
            <input
              autoFocus
              value={saveAsName}
              onChange={(e) => setSaveAsName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') clonePlaylistMut.mutate(saveAsName) }}
              placeholder="Deixe vazio para gerar nome automático"
              className="w-full rounded-lg bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-600 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 transition-colors text-sm px-3 py-2"
            />
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="secondary" onClick={() => setSaveAsOpen(false)}>Cancelar</Button>
            <Button
              loading={clonePlaylistMut.isPending}
              icon={<Copy className="h-4 w-4" />}
              onClick={() => clonePlaylistMut.mutate(saveAsName)}
            >
              Salvar cópia
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Modal: câmera ────────────────────────────────────────────────── */}
      <CameraModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        channelName={channel.name}
        camera={camera}
      />
    </div>
  )
}
