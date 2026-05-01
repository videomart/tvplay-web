import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Play, Pause, Square, SkipForward, SkipBack,
  Radio, Wifi, WifiOff, ListVideo, Clock
} from 'lucide-react'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import { playoutApi } from '../../api/playout.api'
import { playlistsApi } from '../../api/playlists.api'
import type { Channel } from '../../api/channels.api'
import { usePlayoutSocket } from '../../hooks/usePlayoutSocket'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Modal } from '../../components/ui/Modal'

function formatTime(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  const remaining = Math.max(0, max - value)
  return (
    <div className="space-y-1">
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-brand-500 rounded-full transition-all duration-1000 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-[11px] font-mono text-gray-500">
        <span>{formatTime(value)}</span>
        <span>-{formatTime(remaining)}</span>
      </div>
    </div>
  )
}

interface ChannelPanelProps {
  channel: Channel
}

export default function ChannelPanel({ channel }: ChannelPanelProps) {
  const qc = useQueryClient()
  const { state, connected } = usePlayoutSocket(channel.id)
  const [selectPlaylistOpen, setSelectPlaylistOpen] = useState(false)
  const [selectedPlaylistId, setSelectedPlaylistId] = useState('')

  const status = state?.status ?? 'IDLE'
  const item = state?.currentItem ?? null
  const position = state?.position ?? 0

  const { data: playlists = [] } = useQuery({
    queryKey: ['playlists', channel.id],
    queryFn: () => playlistsApi.list({ channelId: channel.id }),
    enabled: selectPlaylistOpen,
  })

  const cmdMutation = (fn: () => Promise<any>, successMsg?: string) =>
    useMutation({
      mutationFn: fn,
      onSuccess: () => { if (successMsg) toast.success(successMsg) },
      onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro'),
    })

  const playMut = cmdMutation(
    () => playoutApi.play(channel.id, selectedPlaylistId),
    'Reprodução iniciada'
  )
  const pauseMut = cmdMutation(() => playoutApi.pause(channel.id))
  const resumeMut = cmdMutation(() => playoutApi.resume(channel.id))
  const stopMut = cmdMutation(() => playoutApi.stop(channel.id), 'Parado')
  const nextMut = cmdMutation(() => playoutApi.next(channel.id))
  const prevMut = cmdMutation(() => playoutApi.prev(channel.id))

  function handlePlay() {
    if (!selectedPlaylistId) { setSelectPlaylistOpen(true); return }
    playMut.mutate()
  }

  const statusColor = {
    PLAYING: 'text-emerald-400',
    PAUSED:  'text-amber-400',
    STOPPED: 'text-red-400',
    IDLE:    'text-gray-500',
  }[status]

  const statusLabel = { PLAYING: 'AO AR', PAUSED: 'PAUSADO', STOPPED: 'PARADO', IDLE: 'AGUARDANDO' }[status]

  return (
    <div className={clsx(
      'card flex flex-col gap-0 overflow-hidden transition-all',
      status === 'PLAYING' && 'ring-1 ring-emerald-500/30'
    )}>
      {/* Header do canal */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2.5">
          <div className={clsx(
            'h-8 w-8 rounded-lg flex items-center justify-center text-xs font-bold',
            status === 'PLAYING' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-gray-800 text-gray-400'
          )}>
            {channel.number}
          </div>
          <div>
            <p className="text-sm font-semibold text-white leading-tight">{channel.name}</p>
            <p className={clsx('text-[11px] font-bold tracking-wider', statusColor)}>{statusLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {connected
            ? <Wifi className="h-3.5 w-3.5 text-emerald-500" />
            : <WifiOff className="h-3.5 w-3.5 text-red-500" />}
          {status === 'PLAYING' && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-semibold">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              LIVE
            </span>
          )}
        </div>
      </div>

      {/* Clip atual */}
      <div className="px-4 py-3 min-h-[90px] flex flex-col justify-center gap-2">
        {item ? (
          <>
            <div className="flex items-start gap-2">
              {item.typeCode && (
                <Badge
                  bg={item.typeBg ?? '#374151'}
                  color={item.typeColor ?? '#fff'}
                  className="text-[10px] mt-0.5 shrink-0"
                >
                  {item.typeCode}
                </Badge>
              )}
              <p className="text-sm font-semibold text-white leading-tight line-clamp-2">{item.title}</p>
            </div>
            {item.clientName && (
              <p className="text-[11px] text-gray-500">{item.clientName}</p>
            )}
            <ProgressBar value={position} max={item.duration} />
          </>
        ) : (
          <div className="flex items-center gap-2 text-gray-600">
            <Radio className="h-4 w-4" />
            <span className="text-sm">Nenhum clipe carregado</span>
          </div>
        )}
      </div>

      {/* Playlist selecionada */}
      {state?.programName && (
        <div className="px-4 pb-2 flex items-center gap-1.5 text-[11px] text-gray-500">
          <ListVideo className="h-3.5 w-3.5" />
          <span>{state.programName}</span>
          {state.totalElapsed > 0 && (
            <>
              <span className="text-gray-700">·</span>
              <Clock className="h-3 w-3" />
              <span>{formatTime(state.totalElapsed)} total</span>
            </>
          )}
        </div>
      )}

      {/* Controles */}
      <div className="px-4 py-3 border-t border-gray-800 flex items-center gap-1.5">
        <Button
          size="sm" variant="ghost"
          icon={<SkipBack className="h-4 w-4" />}
          disabled={status === 'IDLE' || prevMut.isPending}
          onClick={() => prevMut.mutate()}
        />

        {status === 'PLAYING' ? (
          <Button
            size="sm" variant="secondary"
            icon={<Pause className="h-4 w-4" />}
            loading={pauseMut.isPending}
            onClick={() => pauseMut.mutate()}
          >
            Pause
          </Button>
        ) : status === 'PAUSED' ? (
          <Button
            size="sm"
            icon={<Play className="h-4 w-4" />}
            loading={resumeMut.isPending}
            onClick={() => resumeMut.mutate()}
          >
            Retomar
          </Button>
        ) : (
          <Button
            size="sm"
            icon={<Play className="h-4 w-4" />}
            loading={playMut.isPending}
            onClick={handlePlay}
          >
            {selectedPlaylistId ? 'Play' : 'Selecionar...'}
          </Button>
        )}

        <Button
          size="sm" variant="ghost"
          icon={<SkipForward className="h-4 w-4" />}
          disabled={status === 'IDLE' || nextMut.isPending}
          onClick={() => nextMut.mutate()}
        />

        <div className="flex-1" />

        <Button
          size="sm" variant="danger"
          icon={<Square className="h-4 w-4" />}
          loading={stopMut.isPending}
          disabled={status === 'IDLE'}
          onClick={() => stopMut.mutate()}
        />
      </div>

      {/* Modal: selecionar playlist */}
      <Modal
        open={selectPlaylistOpen}
        onClose={() => setSelectPlaylistOpen(false)}
        title={`Selecionar Playlist — ${channel.name}`}
      >
        <div className="space-y-3">
          {playlists.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">
              Nenhuma playlist cadastrada para este canal.
            </p>
          ) : (
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {playlists.map((pl) => (
                <button
                  key={pl.id}
                  onClick={() => setSelectedPlaylistId(pl.id)}
                  className={clsx(
                    'w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors',
                    selectedPlaylistId === pl.id
                      ? 'bg-brand-600/20 text-brand-300 ring-1 ring-brand-500/30'
                      : 'hover:bg-white/5 text-gray-300'
                  )}
                >
                  <p className="font-medium">{pl.programName}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {new Date(pl.date).toLocaleDateString('pt-BR')}
                    {pl._count && ` · ${pl._count.items} clipes`}
                  </p>
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="secondary" onClick={() => setSelectPlaylistOpen(false)}>Cancelar</Button>
            <Button
              disabled={!selectedPlaylistId}
              onClick={() => { setSelectPlaylistOpen(false); playMut.mutate() }}
              loading={playMut.isPending}
              icon={<Play className="h-4 w-4" />}
            >
              Iniciar
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
