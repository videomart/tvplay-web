import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Tv2, Users, Tag, LogOut, Radio, ListVideo, Cast, Antenna, ClipboardList, UserCog, Settings, Layers, HardDrive, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../../stores/auth.store'
import { settingsApi } from '../../api/settings.api'
import { clsx } from 'clsx'

const primaryNav = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/playout',   icon: Radio,           label: 'Playout' },
  { to: '/roteiros',  icon: ListVideo,       label: 'Roteiros' },
  { to: '/media',     icon: HardDrive,       label: 'Mídias' },
  { to: '/graphics', icon: Layers, label: 'Gráficos' },
]

const setupNav = [
  { to: '/channels',       icon: Tv2,           label: 'Canais' },
  { to: '/stream-outputs', icon: Cast,          label: 'Saídas' },
  { to: '/input-sources',  icon: Antenna,       label: 'Entradas' },
  { to: '/clients',        icon: Users,         label: 'Clientes' },
  { to: '/clip-types',     icon: Tag,           label: 'Tipos' },
  { to: '/logs',           icon: ClipboardList, label: 'Logs' },
]

const adminNav = [
  { to: '/users',    icon: UserCog, label: 'Usuários' },
  { to: '/settings', icon: Settings, label: 'Configurações' },
]

interface SidebarProps {
  isOpen?: boolean
  onClose?: () => void
}

export default function Sidebar({ isOpen = true, onClose }: SidebarProps) {
  const { user, logout } = useAuthStore()
  const isAdmin = user?.level === 'ADMIN'

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
    staleTime: 60_000,
  })

  const companyName = settings?.companyName || 'TVPlay'
  const logoUrl = settings?.logoUrl

  return (
    <aside className={clsx(
      'w-56 bg-gray-900 border-r border-gray-800 flex flex-col h-full flex-shrink-0',
      // Mobile: drawer overlay que desliza da esquerda
      'fixed inset-y-0 left-0 z-30 transition-transform duration-300 ease-in-out',
      'md:relative md:translate-x-0 md:z-auto',
      isOpen ? 'translate-x-0' : '-translate-x-full',
    )}>
      {/* Botão fechar — só mobile */}
      <button
        onClick={onClose}
        className="md:hidden absolute top-3 right-3 p-1 rounded text-gray-500 hover:text-white hover:bg-gray-800 transition-colors"
        aria-label="Fechar menu"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Logo — topo, sem margens, largura total */}
      <div className="border-b border-gray-800">
        <NavLink to="/playout" onClick={onClose} className="block hover:opacity-80 transition-opacity">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={companyName}
              className="w-full h-auto block"
            />
          ) : (
            <div className="flex items-center justify-center py-5 bg-brand-600/20">
              <Radio className="h-8 w-8 text-brand-400" />
            </div>
          )}
        </NavLink>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2 overflow-y-auto">
        {/* Área principal */}
        <div className="space-y-0.5">
          {primaryNav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              onClick={onClose}
              className={({ isActive }) => clsx('sidebar-item', isActive && 'active')}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              {label}
            </NavLink>
          ))}
        </div>

        {/* Divisor — Configuração */}
        <div className="pt-4 pb-1 px-2">
          <span className="text-[10px] uppercase tracking-widest text-gray-600 font-semibold">Configuração</span>
        </div>
        <div className="space-y-0.5">
          {setupNav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              onClick={onClose}
              className={({ isActive }) => clsx('sidebar-item', isActive && 'active')}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              {label}
            </NavLink>
          ))}
        </div>

        {/* Admin */}
        {isAdmin && (
          <>
            <div className="pt-4 pb-1 px-2">
              <span className="text-[10px] uppercase tracking-widest text-gray-600 font-semibold">Admin</span>
            </div>
            <div className="space-y-0.5">
              {adminNav.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={onClose}
                  className={({ isActive }) => clsx('sidebar-item', isActive && 'active')}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  {label}
                </NavLink>
              ))}
            </div>
          </>
        )}
      </nav>

      {/* Nome da empresa — acima do usuário */}
      <div className="px-4 py-3 border-t border-gray-800/60 text-center">
        <p className="text-sm font-bold text-white leading-tight truncate">{companyName}</p>
        <p className="text-[10px] text-gray-500 leading-tight mt-0.5">Web Playout</p>
      </div>

      {/* User */}
      <div className="p-3 border-t border-gray-800">
        <div className="flex items-center gap-3 px-2 py-1.5">
          <div className="h-8 w-8 rounded-full bg-brand-600/20 flex items-center justify-center text-brand-300 text-sm font-semibold">
            {user?.name?.[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{user?.name}</p>
            <p className="text-[11px] text-gray-500 truncate">{user?.level}</p>
          </div>
          <button onClick={logout} className="text-gray-600 hover:text-red-400 transition-colors" title="Sair">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  )
}
