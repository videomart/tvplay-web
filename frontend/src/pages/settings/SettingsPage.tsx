import { useState, useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Settings, Building2, Tv2, LayoutDashboard, Save, Upload, GitCommit } from 'lucide-react'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import { settingsApi } from '../../api/settings.api'
import { channelsApi } from '../../api/channels.api'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'

const inputCls = 'w-full rounded-lg bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 transition-colors text-sm px-3 py-2'

type Tab = 'empresa' | 'canais' | 'playout'

export default function SettingsPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('empresa')

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  })

  const { data: channels = [] } = useQuery({
    queryKey: ['channels'],
    queryFn: channelsApi.list,
  })

  const saveMut = useMutation({
    mutationFn: settingsApi.update,
    onSuccess: () => {
      toast.success('Configurações salvas')
      qc.invalidateQueries({ queryKey: ['settings'] })
    },
    onError: () => toast.error('Erro ao salvar'),
  })

  const saveChannelMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name: string; description?: string } }) =>
      channelsApi.update(id, data),
    onSuccess: () => {
      toast.success('Canal atualizado')
      qc.invalidateQueries({ queryKey: ['channels'] })
    },
    onError: () => toast.error('Erro ao atualizar canal'),
  })

  // ─── Estado local dos formulários ──────────────────────────────────────────

  const [empresa, setEmpresa] = useState({ companyName: '', logoUrl: '', email: '' })
  const [logoUploading, setLogoUploading] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [playoutDefaults, setPlayoutDefaults] = useState({
    defaultMonitorOpen: true,
    defaultFallbackOpen: true,
    defaultOutputsOpen: true,
    defaultPlaylistOpen: true,
  })
  const [clockOffsetHours,      setClockOffsetHours]      = useState(0)
  const [defaultBreakDuration,  setDefaultBreakDuration]  = useState(300)
  const [defaultSlideDuration,  setDefaultSlideDuration]  = useState(15)
  const [defaultUrlDuration,    setDefaultUrlDuration]    = useState(0)
  const [channelNames, setChannelNames] = useState<Record<string, { name: string; description: string }>>({})

  useEffect(() => {
    if (settings) {
      setEmpresa({
        companyName: settings.companyName,
        logoUrl: settings.logoUrl ?? '',
        email: settings.email ?? '',
      })
      setPlayoutDefaults({
        defaultMonitorOpen:  settings.defaultMonitorOpen,
        defaultFallbackOpen: settings.defaultFallbackOpen,
        defaultOutputsOpen:  settings.defaultOutputsOpen,
        defaultPlaylistOpen: settings.defaultPlaylistOpen,
      })
      setClockOffsetHours(settings.clockOffsetHours ?? 0)
      setDefaultBreakDuration(settings.defaultBreakDuration ?? 300)
      setDefaultSlideDuration(settings.defaultSlideDuration ?? 15)
      setDefaultUrlDuration(settings.defaultUrlDuration ?? 0)
    }
  }, [settings])

  useEffect(() => {
    if (channels.length) {
      const initial: Record<string, { name: string; description: string }> = {}
      channels.forEach((ch) => { initial[ch.id] = { name: ch.name, description: ch.description ?? '' } })
      setChannelNames(initial)
    }
  }, [channels])

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoUploading(true)
    try {
      const { logoUrl } = await settingsApi.uploadLogo(file)
      setEmpresa((s) => ({ ...s, logoUrl }))
      toast.success('Logo carregado')
      qc.invalidateQueries({ queryKey: ['settings'] })
    } catch {
      toast.error('Erro ao enviar logo')
    } finally {
      setLogoUploading(false)
      if (logoInputRef.current) logoInputRef.current.value = ''
    }
  }

  // ─── Tabs ─────────────────────────────────────────────────────────────────

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'empresa',  label: 'Empresa',         icon: Building2 },
    { id: 'canais',   label: 'Canais',           icon: Tv2 },
    { id: 'playout',  label: 'Padrões Playout',  icon: LayoutDashboard },
  ]

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-2.5">
        <Settings className="h-6 w-6 text-brand-400" />
        <h1 className="text-2xl font-bold text-white">Configurações</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900 p-1 rounded-lg">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={clsx(
              'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors',
              tab === id
                ? 'bg-brand-600/30 text-brand-300 ring-1 ring-brand-500/30'
                : 'text-gray-500 hover:text-gray-300'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Aba: Empresa ───────────────────────────────────────────────────── */}
      {tab === 'empresa' && (
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-white">Dados da Empresa</h2>

          <Input
            label="Nome da empresa / emissora"
            value={empresa.companyName}
            onChange={(e) => setEmpresa((s) => ({ ...s, companyName: e.target.value }))}
            placeholder="Ex.: TV Exemplo"
          />

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-300">Logotipo</label>

            {/* Upload a partir de arquivo local */}
            <div className="flex items-center gap-2">
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/svg+xml,image/jpeg,image/webp"
                className="hidden"
                onChange={handleLogoUpload}
              />
              <Button
                size="sm"
                variant="secondary"
                icon={<Upload className="h-3.5 w-3.5" />}
                loading={logoUploading}
                onClick={() => logoInputRef.current?.click()}
              >
                Enviar arquivo local
              </Button>
              <span className="text-[11px] text-gray-600">PNG, SVG, JPEG ou WebP</span>
            </div>

            {/* Separador */}
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-gray-700" />
              <span className="text-[11px] text-gray-600">ou informe URL</span>
              <div className="flex-1 h-px bg-gray-700" />
            </div>

            <Input
              value={empresa.logoUrl}
              onChange={(e) => setEmpresa((s) => ({ ...s, logoUrl: e.target.value }))}
              placeholder="https://..."
            />
            <p className="text-[11px] text-gray-600">
              Formato ideal: <strong className="text-gray-400">400 × 120 px</strong>, paisagem (horizontal), fundo transparente — PNG ou SVG.
              Aparece em largura total na barra lateral.
            </p>
            {empresa.logoUrl && (
              <div className="mt-2 space-y-1">
                <span className="text-[11px] text-gray-500">Pré-visualização (proporção real na sidebar):</span>
                <div className="bg-gray-900 rounded-lg p-3 border border-gray-700" style={{ width: 224 }}>
                  <img
                    src={empresa.logoUrl}
                    alt="preview"
                    className="w-full max-h-20 object-contain rounded-xl bg-white/5 p-2"
                  />
                </div>
              </div>
            )}
          </div>

          <Input
            label="E-mail de contato"
            type="email"
            value={empresa.email}
            onChange={(e) => setEmpresa((s) => ({ ...s, email: e.target.value }))}
            placeholder="contato@empresa.com"
          />

          <div className="flex justify-end pt-2">
            <Button
              icon={<Save className="h-4 w-4" />}
              loading={saveMut.isPending}
              onClick={() => saveMut.mutate({
                companyName: empresa.companyName || 'TVPlay',
                logoUrl: empresa.logoUrl || null,
                email: empresa.email || null,
              })}
            >
              Salvar
            </Button>
          </div>
        </div>
      )}

      {/* ── Aba: Canais ────────────────────────────────────────────────────── */}
      {tab === 'canais' && (
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-white">Designação dos Canais</h2>
          <p className="text-xs text-gray-500">
            Defina nomes e descrições para cada canal conforme a finalidade (ex.: "Canal Broadcast", "Transmissão YouTube").
          </p>

          {channels.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-4">Nenhum canal cadastrado.</p>
          )}

          {channels.map((ch) => {
            const local = channelNames[ch.id] ?? { name: ch.name, description: ch.description ?? '' }
            return (
              <div key={ch.id} className="space-y-3 p-3 bg-gray-800/40 rounded-lg">
                <div className="flex items-center gap-2">
                  <span className="h-7 w-7 rounded bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-300">
                    {ch.number}
                  </span>
                  <span className="text-xs text-gray-500">Canal {ch.number}</span>
                </div>
                <input
                  value={local.name}
                  onChange={(e) =>
                    setChannelNames((s) => ({ ...s, [ch.id]: { ...local, name: e.target.value } }))
                  }
                  className={inputCls}
                  placeholder="Ex.: Canal Broadcast"
                />
                <input
                  value={local.description}
                  onChange={(e) =>
                    setChannelNames((s) => ({ ...s, [ch.id]: { ...local, description: e.target.value } }))
                  }
                  className={inputCls}
                  placeholder="Descrição (opcional)"
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Save className="h-3.5 w-3.5" />}
                    loading={saveChannelMut.isPending && (saveChannelMut.variables as any)?.id === ch.id}
                    onClick={() =>
                      saveChannelMut.mutate({ id: ch.id, data: { name: local.name, description: local.description } })
                    }
                  >
                    Salvar canal
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Aba: Padrões Playout ──────────────────────────────────────────── */}
      {tab === 'playout' && (
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-white">Visibilidade Padrão dos Blocos no Playout</h2>
          <p className="text-xs text-gray-500">
            Define o estado inicial (aberto/fechado) de cada bloco ao carregar o painel de playout.
          </p>

          {(
            [
              { key: 'defaultMonitorOpen',  label: 'Monitor de vídeo' },
              { key: 'defaultFallbackOpen', label: 'Seletor de Sinal / Fallback' },
              { key: 'defaultOutputsOpen',  label: 'Saídas de Streaming' },
              { key: 'defaultPlaylistOpen', label: 'Playlist (lista de itens)' },
            ] as { key: keyof typeof playoutDefaults; label: string }[]
          ).map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between gap-3 p-3 rounded-lg hover:bg-gray-800/30">
              <span className="text-sm text-gray-300">{label}</span>
              <button
                type="button"
                onClick={() => setPlayoutDefaults((s) => ({ ...s, [key]: !s[key] }))}
                className={clsx(
                  'relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0',
                  playoutDefaults[key] ? 'bg-brand-600' : 'bg-gray-700'
                )}
              >
                <span className={clsx(
                  'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
                  playoutDefaults[key] ? 'translate-x-[18px]' : 'translate-x-0.5'
                )} />
              </button>
            </div>
          ))}

          {/* Relógio de gráfico — fuso horário */}
          <div className="border-t border-gray-800 pt-4 space-y-2">
            <h3 className="text-sm font-semibold text-white">Relógio do Gráfico</h3>
            <p className="text-xs text-gray-500">
              Ajusta o fuso horário do relógio exibido no stream. Ex.: Brasil (UTC-3) → <code className="bg-gray-800 px-1 rounded">-3</code>.
              Afeta novos processos de streaming iniciados após salvar.
            </p>
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-300 flex-shrink-0">Offset UTC (horas):</label>
              <select
                value={clockOffsetHours}
                onChange={(e) => setClockOffsetHours(Number(e.target.value))}
                className={inputCls + ' w-40'}
              >
                {Array.from({ length: 27 }, (_, i) => i - 12).map((h) => (
                  <option key={h} value={h}>
                    {h === 0 ? 'UTC (0)' : `UTC${h > 0 ? '+' : ''}${h}`}
                  </option>
                ))}
              </select>
              <span className="text-xs text-gray-500">
                Agora no stream: {(() => {
                  const d = new Date()
                  d.setUTCHours(d.getUTCHours() + clockOffsetHours)
                  return d.toISOString().slice(11, 19)
                })()}
              </span>
            </div>
          </div>

          {/* Duração padrão do BREAK */}
          <div className="border-t border-gray-800 pt-4 space-y-2">
            <h3 className="text-sm font-semibold text-white">BREAK — Duração Padrão</h3>
            <p className="text-xs text-gray-500">
              Tempo aplicado automaticamente ao inserir um item BREAK na playlist. Pode ser ajustado individualmente em cada BREAK.
            </p>
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-300 flex-shrink-0">Duração (segundos):</label>
              <input
                type="number"
                min={0}
                max={86400}
                value={defaultBreakDuration}
                onChange={(e) => setDefaultBreakDuration(Math.max(0, Number(e.target.value)))}
                className={inputCls + ' w-28'}
              />
              <span className="text-xs text-gray-500">
                {Math.floor(defaultBreakDuration / 60)}:{String(defaultBreakDuration % 60).padStart(2, '0')} min
              </span>
            </div>
          </div>

          {/* Duração padrão de slides (imagens) */}
          <div className="border-t border-gray-800 pt-4 space-y-2">
            <h3 className="text-sm font-semibold text-white">Slide (Imagem) — Duração Padrão</h3>
            <p className="text-xs text-gray-500">
              Tempo aplicado automaticamente ao inserir um clipe de imagem (PNG, JPG, etc.) na playlist.
              Pode ser ajustado individualmente com o ⏱ por item.
            </p>
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-300 flex-shrink-0">Duração (segundos):</label>
              <input
                type="number" min={1} max={3600}
                value={defaultSlideDuration}
                onChange={(e) => setDefaultSlideDuration(Math.max(1, Number(e.target.value)))}
                className={inputCls + ' w-28'}
              />
              <span className="text-xs text-gray-500">
                {Math.floor(defaultSlideDuration / 60)}:{String(defaultSlideDuration % 60).padStart(2, '0')} min
              </span>
            </div>
          </div>

          {/* Duração padrão de clipes URL (YouTube, SRT) */}
          <div className="border-t border-gray-800 pt-4 space-y-2">
            <h3 className="text-sm font-semibold text-white">YouTube / URL — Duração Máxima Padrão</h3>
            <p className="text-xs text-gray-500">
              Limite automático ao inserir clipes URL (YouTube, SRT) na playlist. Use <code className="bg-gray-800 px-1 rounded">0</code> para sem limite (avança só manualmente ou pelo timer do clipe).
            </p>
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-300 flex-shrink-0">Duração máx. (segundos):</label>
              <input
                type="number" min={0} max={86400}
                value={defaultUrlDuration}
                onChange={(e) => setDefaultUrlDuration(Math.max(0, Number(e.target.value)))}
                className={inputCls + ' w-28'}
              />
              <span className="text-xs text-gray-500">
                {defaultUrlDuration === 0 ? 'sem limite' : `${Math.floor(defaultUrlDuration / 60)}:${String(defaultUrlDuration % 60).padStart(2, '0')} min`}
              </span>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button
              icon={<Save className="h-4 w-4" />}
              loading={saveMut.isPending}
              onClick={() => saveMut.mutate({ ...playoutDefaults, clockOffsetHours, defaultBreakDuration, defaultSlideDuration, defaultUrlDuration })}
            >
              Salvar
            </Button>
          </div>
        </div>
      )}
      {/* ── Rodapé: versão do build ─────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-1 pt-2 border-t border-gray-800">
        <GitCommit className="h-3.5 w-3.5 text-gray-600 flex-shrink-0" />
        <span className="text-[11px] text-gray-600 font-mono select-all">
          TVPlay <span className="text-gray-400">v{__APP_BUILD__}</span>
          <span className="mx-1.5 text-gray-700">·</span>
          {__BUILD_TIME__}
        </span>
      </div>
    </div>
  )
}
