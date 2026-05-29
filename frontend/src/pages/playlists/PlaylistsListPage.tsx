import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Pencil, Trash2, ListVideo, CalendarDays, Clock, Upload, Repeat, Tv2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { playlistsApi, type Playlist } from '../../api/playlists.api'
import { channelsApi } from '../../api/channels.api'
import { graphicsApi } from '../../api/graphics.api'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Table, Thead, Th, Tbody, Tr, Td } from '../../components/ui/Table'
import PlaylistImportModal from './PlaylistImportModal'
import { clsx } from 'clsx'

const today = new Date().toISOString().slice(0, 10)
const empty = { name: '', date: today, channelId: '', notes: '', autoStart: false, loop: false, startTime: '', graphicId: '' }

export default function PlaylistsListPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [editing, setEditing] = useState<Playlist | null>(null)
  const [filterChannel, setFilterChannel] = useState('')
  const [form, setForm] = useState(empty)

  const { data: channels = [] } = useQuery({ queryKey: ['channels'], queryFn: channelsApi.list })
  const { data: graphics = [] } = useQuery({ queryKey: ['graphics'], queryFn: graphicsApi.list })
  const { data = [], isLoading } = useQuery({
    queryKey: ['playlists', filterChannel],
    queryFn: () => playlistsApi.list(filterChannel ? { channelId: filterChannel } : undefined),
  })

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name:      form.name || undefined,
        date:      form.date,
        channelId: form.channelId || null,
        notes:     form.notes || undefined,
        autoStart: form.autoStart,
        loop:      form.loop,
        startTime: form.autoStart && form.startTime ? form.startTime : null,
        graphicId: form.graphicId || null,
      }
      return editing
        ? playlistsApi.update(editing.id, payload)
        : playlistsApi.create(payload)
    },
    onSuccess: () => {
      toast.success(editing ? 'Roteiro atualizado' : 'Roteiro criado')
      qc.invalidateQueries({ queryKey: ['playlists'] })
      setOpen(false)
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro'),
  })

  const remove = useMutation({
    mutationFn: playlistsApi.delete,
    onSuccess: () => { toast.success('Roteiro removido'); qc.invalidateQueries({ queryKey: ['playlists'] }) },
  })

  function f(k: keyof typeof empty) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((v) => ({ ...v, [k]: e.target.value }))
  }
  function openNew() { setEditing(null); setForm(empty); setOpen(true) }
  function openEdit(pl: Playlist) {
    setEditing(pl)
    setForm({
      name:      pl.name,
      date:      pl.date.slice(0, 10),
      channelId: pl.channelId ?? '',
      notes:     pl.notes ?? '',
      autoStart: pl.autoStart ?? false,
      loop:      (pl as any).loop ?? false,
      startTime: pl.startTime ?? '',
      graphicId: (pl as any).graphicId ?? '',
    })
    setOpen(true)
  }

  const selectedChannel = channels.find((ch) => ch.id === filterChannel)

  return (
    <div className="p-6 space-y-6">

      {/* Cabeçalho */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Roteiros</h1>
          <p className="text-gray-500 text-sm mt-1">
            {filterChannel
              ? `${data.length} roteiro(s) — ${selectedChannel?.name ?? ''}`
              : `${data.length} roteiro(s) em todos os canais`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setImportOpen(true)} icon={<Upload className="h-4 w-4" />}>
            Importar
          </Button>
          <Button onClick={openNew} icon={<Plus className="h-4 w-4" />}>Novo Roteiro</Button>
        </div>
      </div>

      {/* Seletor de canal — destaque visual */}
      <div className="card p-4 space-y-2">
        <div className="flex items-center gap-2 mb-3">
          <Tv2 className="h-4 w-4 text-gray-500" />
          <span className="text-sm font-semibold text-gray-300">Selecione o canal</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilterChannel('')}
            className={clsx(
              'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              filterChannel === ''
                ? 'bg-brand-600/30 text-brand-300 ring-1 ring-brand-500/40'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
            )}
          >
            Todos os canais
          </button>
          {channels.map((ch) => (
            <button
              key={ch.id}
              onClick={() => setFilterChannel(ch.id)}
              className={clsx(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                filterChannel === ch.id
                  ? 'bg-brand-600/30 text-brand-300 ring-1 ring-brand-500/40'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
              )}
            >
              <span className="h-5 w-5 rounded bg-gray-700 flex items-center justify-center text-[10px] font-bold text-gray-300 flex-shrink-0">
                {ch.number}
              </span>
              {ch.name}
            </button>
          ))}
        </div>
      </div>

      {/* Tabela de roteiros */}
      <div className="card">
        <Table>
          <Thead>
            <Th>Roteiro</Th>
            <Th>Canal</Th>
            <Th>Data</Th>
            <Th>Itens</Th>
            <Th>Gráfico</Th>
            <Th className="w-24 text-right">Ações</Th>
          </Thead>
          <Tbody>
            {isLoading ? (
              <Tr><Td colSpan={6} className="text-center text-gray-500 py-8">Carregando...</Td></Tr>
            ) : data.length === 0 ? (
              <Tr>
                <Td colSpan={6} className="text-center text-gray-600 py-10">
                  {filterChannel
                    ? 'Nenhum roteiro para este canal. Crie um novo roteiro.'
                    : 'Nenhum roteiro cadastrado.'}
                </Td>
              </Tr>
            ) : data.map((pl) => (
              <Tr key={pl.id} onClick={() => navigate(`/roteiros/${pl.id}`)}>
                <Td>
                  <div className="flex items-center gap-2">
                    <ListVideo className="h-4 w-4 text-gray-600 shrink-0" />
                    <span className="font-medium text-white font-mono">{pl.name}</span>
                    {pl.locked && <span className="text-[10px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">Bloqueado</span>}
                    {(pl as any).loop && (
                      <span className="flex items-center gap-1 text-[10px] bg-emerald-900/40 text-emerald-400 px-1.5 py-0.5 rounded">
                        <Repeat className="h-2.5 w-2.5" />Loop
                      </span>
                    )}
                    {pl.autoStart && pl.startTime && (
                      <span className="flex items-center gap-1 text-[10px] bg-brand-900/40 text-brand-300 px-1.5 py-0.5 rounded">
                        <Clock className="h-2.5 w-2.5" />{pl.startTime}
                      </span>
                    )}
                  </div>
                </Td>
                <Td>
                  <span className="text-xs text-gray-400">
                    {pl.channel ? `${pl.channel.number} — ${pl.channel.name}` : '—'}
                  </span>
                </Td>
                <Td>
                  <div className="flex items-center gap-1.5 text-sm">
                    <CalendarDays className="h-3.5 w-3.5 text-gray-600" />
                    {new Date(pl.date).toLocaleDateString('pt-BR')}
                  </div>
                </Td>
                <Td>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm text-gray-400 mr-0.5">{pl._count?.items ?? 0}</span>
                    {(pl._fileCount ?? 0) > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700/50 font-mono font-medium">
                        FILE {pl._fileCount}
                      </span>
                    )}
                    {(pl._urlTypes ?? []).map((t) => (
                      <span key={t} className={clsx(
                        'text-[10px] px-1.5 py-0.5 rounded border font-mono font-medium',
                        t === 'YT'   && 'bg-red-900/50 text-red-400 border-red-700/40',
                        t === 'LIVE' && 'bg-purple-900/50 text-purple-400 border-purple-700/40',
                        t === 'SRT'  && 'bg-blue-900/50 text-blue-300 border-blue-700/40',
                        t === 'RTMP' && 'bg-orange-900/50 text-orange-400 border-orange-700/40',
                        t === 'RTSP' && 'bg-sky-900/50 text-sky-400 border-sky-700/40',
                        t === 'UDP'  && 'bg-gray-800 text-gray-500 border-gray-600/40',
                        t === 'URL'  && 'bg-sky-900/50 text-sky-400 border-sky-700/40',
                      )}>
                        {t}
                      </span>
                    ))}
                    {(pl._noMediaCount ?? 0) > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-900/50 text-orange-400 border border-orange-700/40 font-medium">
                        {pl._noMediaCount} s/arq
                      </span>
                    )}
                  </div>
                </Td>
                <Td>
                  {pl.graphic
                    ? <span className="text-[10px] bg-violet-900/50 text-violet-300 px-1.5 py-0.5 rounded font-mono">{pl.graphic.name}</span>
                    : <span className="text-gray-700 text-xs">—</span>}
                </Td>
                <Td className="text-right">
                  <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => openEdit(pl)} />
                    <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => remove.mutate(pl.id)} />
                  </div>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>

      {/* Modal: criar / editar roteiro */}
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Editar Roteiro' : 'Novo Roteiro'}>
        <div className="space-y-4">
          <div className="space-y-1">
            <Input
              label="Identificador"
              value={form.name}
              onChange={f('name')}
              placeholder="Deixe em branco para gerar automaticamente (ex: 040526-1)"
            />
            <p className="text-[11px] text-gray-600">
              Se não informado, será gerado automaticamente no formato DDMMAA-N baseado na data.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Data *" type="date" value={form.date} onChange={f('date')} />
            <Select label="Canal" value={form.channelId} onChange={f('channelId')}>
              <option value="">Ambos os canais</option>
              {channels.map((ch) => <option key={ch.id} value={ch.id}>{ch.number} — {ch.name}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Observações" value={form.notes} onChange={f('notes')} placeholder="Opcional" />
            <Select label="Gráfico" value={form.graphicId} onChange={f('graphicId')}>
              <option value="">Nenhum</option>
              {graphics.filter(g => g.active).map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </Select>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <div
                onClick={() => setForm((v) => ({ ...v, loop: !v.loop }))}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${form.loop ? 'bg-emerald-600' : 'bg-gray-700'}`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${form.loop ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
              <span className="flex items-center gap-1.5 text-sm text-gray-300">
                <Repeat className="h-3.5 w-3.5 text-emerald-500" />
                Repetir roteiro em loop
              </span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <div
                onClick={() => setForm((v) => ({ ...v, autoStart: !v.autoStart }))}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${form.autoStart ? 'bg-brand-600' : 'bg-gray-700'}`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${form.autoStart ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
              <span className="text-sm text-gray-300">Iniciar automaticamente</span>
            </label>
            {form.autoStart && (
              <div className="flex items-center gap-2 pl-12">
                <Clock className="h-4 w-4 text-gray-500 shrink-0" />
                <Input label="Horário (HH:MM)" type="time" value={form.startTime} onChange={f('startTime')} className="w-36" />
              </div>
            )}
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button loading={save.isPending} onClick={() => save.mutate()} disabled={!form.date}>
              Salvar
            </Button>
          </div>
        </div>
      </Modal>

      <PlaylistImportModal open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  )
}
