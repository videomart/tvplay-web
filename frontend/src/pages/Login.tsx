import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Radio, Eye, EyeOff } from 'lucide-react'
import toast from 'react-hot-toast'
import { authApi } from '../api/auth.api'
import { useAuthStore } from '../stores/auth.store'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'

export default function LoginPage() {
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!username || !password) return
    setLoading(true)
    try {
      const { token, user } = await authApi.login(username, password)
      login(token, user)
      navigate('/dashboard')
    } catch {
      toast.error('Usuário ou senha inválidos')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="p-3 bg-brand-600 rounded-2xl mb-4">
            <Radio className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">TVPlay Web</h1>
          <p className="text-gray-500 text-sm mt-1">Sistema de Playout Multi-Canal</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="card p-6 space-y-4">
          <Input
            label="Usuário"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="login"
            autoFocus
            autoComplete="username"
          />
          <div className="relative">
            <Input
              label="Senha"
              type={showPwd ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPwd((v) => !v)}
              className="absolute right-3 top-7 text-gray-500 hover:text-gray-300"
            >
              {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <Button type="submit" loading={loading} className="w-full mt-2">
            Entrar
          </Button>
        </form>

        <p className="text-center text-xs text-gray-600 mt-6 font-mono">
          TVPlay Web &middot; v{__APP_BUILD__} &middot; {__BUILD_TIME__}
        </p>
      </div>
    </div>
  )
}
