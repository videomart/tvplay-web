import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Layers, Upload } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../../api/client'
import { graphicsApi, type Graphic } from '../../api/graphics.api'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Table, Thead, Th, Tbody, Tr, Td } from '../../components/ui/Table'
import { StatusBadge } from '../../components/ui/Badge'

const LOGO_POSITIONS = [
  { value: 'top-right',    label: 'Superior direito' },
  { value: 'top-left',     label: 'Superior esquerdo' },
  { value: 'bottom-right', label: 'Inferior direito' },
  { value: 'bottom-left',  label: 'Inferior esquerdo' },
]

const empty = {
  name: '', logoUrl: '', logoPosition: 'top-right',
  showClock: false, lowerText: '',
}

export default function GraphicsPage() {
  const qc = useQueryClient()
  const [open, setOpen]       = useState(false)
  const [editing, setEditing] = useState<Graphic | null>(null)
  const [form, setForm]       = useState(empty)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const logoFileRef = useRef<HTMLInputElement>(null)

  const { data = [], isLoading } = useQuery({ queryKey: ['graphics'], queryFn: graphicsApi.list })

  const f = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((v) => ({ ...v, [k]: e.target.value }))

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name:        form.name,
        logoUrl:     form.logoUrl  || null,
        logoPosition: form.logoUrl ? form.logoPosition : null,
        showClock:   form.showClock,
        lowerText:   form.lowerText || null,
      }
      return editing ? graphicsApi.update(editing.id, payload) : graphicsApi.create(payload)
    },
    onSuccess: () => {
      toast.success(editing ? 'Gráfico atualizado' : 'Gráfico criado')
      qc.invalidateQueries({ queryKey: ['graphics'] })
      setOpen(false)
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erro ao salvar'),
  })

  const remove = useMutation({
    mutationFn: graphicsApi.delete,
    onSuccess: () => { toast.success('Gráfico removido'); qc.invalidateQueries({ queryKey: ['graphics'] }) },
    onError: () => toast.error('Não é possível remover gráfico em uso'),
  })

  const toggle = useMutation({
    mutationFn: (g: Graphic) => graphicsApi.update(g.id, { active: !g.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['graphics'] }),
  })

  function openNew() {
    setEditing(null); setForm(empty); setOpen(true)
  }
  function openEdit(g: Graphic) {
    setEditing(g)
    setForm({
      name:        g.name,
      logoUrl:     g.logoUrl      ?? '',
      logoPosition: g.logoPosition ?? 'top-right',
      showClock:   g.showClock,
      lowerText:   g.lowerText    ?? '',
    })
    setOpen(true)
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Layers className="h-6 w-6 text-brand-400" />
            Gráficos
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Sobreposições de logo, relógio e texto aplicáveis a clipes, playlists e saídas de streaming.
          </p>
        </div>
        <Button onClick={openNew} icon={<Plus className="h-4 w-4" />}>Novo Gráfico</Button>
      </div>

      <div className="card">
        <Table>
          <Thead>
            <Th>Nome</Th>
            <Th>Elementos</Th>
            <Th>Posição do Logo</Th>
            <Th>Situação</Th>
            <Th className="w-24 text-right">Ações</Th>
          </Thead>
          <Tbody>
            {isLoading ? (
              <Tr><Td colSpan={5} className="text-center text-gray-500 py-8">Carregando...</Td></Tr>
            ) : data.length === 0 ? (
              <Tr><Td colSpan={5} className="text-center text-gray-500 py-8">Nenhum gráfico cadastrado.</Td></Tr>
            ) : data.map((g) => (
              <Tr key={g.id}>
                <Td><span className="font-medium text-white">{g.name}</span></Td>
                <Td>
                  <div className="flex gap-1 flex-wrap">
                    {g.logoUrl    && <span className="text-[10px] bg-violet-900/50 text-violet-300 px-1.5 py-0.5 rounded font-mono">LOGO</span>}
                    {g.showClock  && <span className="text-[10px] bg-violet-900/50 text-violet-300 px-1.5 py-0.5 rounded font-mono">CLK</span>}
                    {g.lowerText  && <span className="text-[10px] bg-violet-900/50 text-violet-300 px-1.5 py-0.5 rounded font-mono">TXT</span>}
                    {!g.logoUrl && !g.showClock && !g.lowerText && (
                      <span className="text-gray-600 text-xs">vazio</span>
                    )}
                  </div>
                  {g.lowerText && (
                    <p className="text-[11px] text-gray-500 mt-0.5 truncate max-w-xs">{g.lowerText}</p>
                  )}
                </Td>
                <Td>
                  {g.logoUrl
                    ? <span className="text-xs text-gray-400">{LOGO_POSITIONS.find(p => p.value === g.logoPosition)?.label ?? g.logoPosition}</span>
                    : <span className="text-gray-700 text-xs">—</span>
                  }
                </Td>
                <Td>
                  <button onClick={() => toggle.mutate(g)} className="focus:outline-none">
                    <StatusBadge active={g.active} />
                  </button>
                </Td>
                <Td className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => openEdit(g)} />
                    <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => remove.mutate(g.id)} />
                  </div>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Editar Gráfico' : 'Novo Gráfico'} size="md">
        <div className="space-y-4">
          <Input label="Nome *" value={form.name} onChange={f('name')} placeholder="Branding Canal 1" />

          {/* Relógio */}
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <div
              onClick={() => setForm((v) => ({ ...v, showClock: !v.showClock }))}
              className={`relative w-9 h-5 rounded-full transition-colors ${form.showClock ? 'bg-brand-500' : 'bg-gray-700'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.showClock ? 'translate-x-4' : ''}`} />
            </div>
            <span className="text-sm text-gray-300">Relógio em tempo real (canto superior direito)</span>
          </label>

          {/* Logo */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-300">URL do Logo</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={form.logoUrl}
                onChange={f('logoUrl')}
                placeholder="http://minio:9000/tvplay/logo.png"
                className="flex-1 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm px-3 py-2 focus:outline-none focus:border-brand-500 placeholder-gray-600"
              />
              <input
                ref={logoFileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  setUploadingLogo(true)
                  try {
                    const fd = new FormData()
                    fd.append('file', file)
                    const res = await api.post<{ imageUrl: string }>('/graphics/upload-image', fd, {
                      headers: { 'Content-Type': 'multipart/form-data' },
                    })
                    setForm((v) => ({ ...v, logoUrl: res.data.imageUrl }))
                    toast.success('Logo enviado')
                  } catch {
                    toast.error('Erro ao enviar logo')
                  } finally {
                    setUploadingLogo(false)
                    if (logoFileRef.current) logoFileRef.current.value = ''
                  }
                }}
              />
              <Button
                size="sm"
                variant="secondary"
                loading={uploadingLogo}
                icon={<Upload className="h-3.5 w-3.5" />}
                onClick={() => logoFileRef.current?.click()}
                title="Enviar arquivo de logo"
              >
                Upload
              </Button>
            </div>
          </div>
          {form.logoUrl && (
            <>
              <Select label="Posição do Logo" value={form.logoPosition} onChange={f('logoPosition')}>
                {LOGO_POSITIONS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </Select>
            </>
          )}

          {/* Faixa inferior */}
          <Input
            label="Texto na faixa inferior"
            value={form.lowerText}
            onChange={f('lowerText')}
            placeholder="TV EXEMPLO — CANAL 1"
          />

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button loading={save.isPending} onClick={() => {
              if (!form.name) { toast.error('Nome é obrigatório'); return }
              save.mutate()
            }}>Salvar</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
