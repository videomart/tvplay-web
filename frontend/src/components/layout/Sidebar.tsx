import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Tv2, Users, Tag, Film, LogOut, Radio, ListVideo, Cast, Antenna, ClipboardList, UserCog, Settings } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../../stores/auth.store'
import { settingsApi } from '../../api/settings.api'
import { clsx } from 'clsx'

const nav = [
  { to: '/dashboard',      icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/playout',        icon: Radio,            label: 'Playout' },
  { to: '/playlists',      icon: ListVideo,        label: 'Playlists' },
  { to: '/channels',       icon: Tv2,              label: 'Canais' },
  { to: '/clips',          icon: Film,             label: 'Clipes' },
  { to: '/clients',        icon: Users,            label: 'Clientes' },
  { to: '/clip-types',     icon: Tag,              label: 'Tipos' },
  { to: '/stream-outputs', icon: Cast,             label: 'Saídas' },
  { to: '/input-sources',  icon: Antenna,          label: 'Entradas' },
  { to: '/logs',           icon: ClipboardList,    label: 'Logs' },
]

const adminNav = [
  { to: '/users',    icon: UserCog, label: 'Usuários' },
  { to: '/settings', icon: Settings, label: 'Configurações' },
]

export default function Sidebar() {
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
    <aside className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col h-full">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-gray-800">
        <div className="flex items-center gap-2.5">
          {logoUrl ? (
            <img src={logoUrl} alt={companyName} className="h-7 w-7 rounded-lg object-contain bg-white/5 p-0.5" />
          ) : (
            <div className="p-1.5 bg-brand-600 rounded-lg">
              <Radio className="h-4 w-4 text-white" />
            </div>
          )}
          <div>
            <p className="text-sm font-bold text-white leading-tight truncate max-w-[120px]">{companyName}</p>
            <p className="text-[10px] text-gray-500 leading-tight">Web Playout</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {nav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              clsx('sidebar-item', isActive && 'active')
            }
          >
            <Icon className="h-4 w-4 flex-shrink-0" />
            {label}
          </NavLink>
        ))}
        {isAdmin && (
          <>
            <div className="pt-2 pb-1 px-2">
              <span className="text-[10px] uppercase tracking-widest text-gray-600 font-semibold">Admin</span>
            </div>
            {adminNav.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  clsx('sidebar-item', isActive && 'active')
                }
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                {label}
              </NavLink>
            ))}
          </>
        )}
      </nav>

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
