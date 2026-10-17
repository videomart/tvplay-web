import { useState, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { settingsApi } from '../../api/settings.api'
import { useThemeStore } from '../../stores/theme.store'
import Sidebar from './Sidebar'

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get, staleTime: 60_000 })
  const theme = useThemeStore((s) => s.theme)

  useEffect(() => {
    document.title = settings?.appTitle || 'TVPlay Web'
  }, [settings?.appTitle])

  // Aplica/remove a classe `dark` no <html> — Tailwind com darkMode:'class' usa
  // isso pra decidir quais variantes dark: ativar em toda a árvore
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-gray-950">
      {/* Backdrop mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-20 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="flex-1 overflow-y-auto flex flex-col min-w-0">
        {/* Topbar mobile — hamburger + nome (painel: sempre escuro, como o resto) */}
        <div className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-gray-800 bg-gray-900 flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold text-white">TVPlay</span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
