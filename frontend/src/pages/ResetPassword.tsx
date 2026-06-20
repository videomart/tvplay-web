import { useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { Radio, Eye, EyeOff, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { authApi } from '../api/auth.api'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token) { toast.error('Link inválido — solicite um novo reset de senha'); return }
    if (password.length < 6) { toast.error('A senha deve ter ao menos 6 caracteres'); return }
    if (password !== confirmPassword) { toast.error('As senhas não coincidem'); return }

    setLoading(true)
    try {
      await authApi.resetPassword(token, password)
      setDone(true)
      setTimeout(() => navigate('/login'), 2500)
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Erro ao redefinir senha')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="p-3 bg-brand-600 rounded-2xl mb-4">
            <Radio className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">TVPlay Web</h1>
          <p className="text-gray-500 text-sm mt-1">Redefinir senha</p>
        </div>

        {!token ? (
          <div className="card p-6 space-y-4 text-center">
            <p className="text-red-400 text-sm">Link inválido ou incompleto.</p>
            <Link to="/forgot-password" className="text-sm text-brand-400 hover:text-brand-300">
              Solicitar novo link
            </Link>
          </div>
        ) : done ? (
          <div className="card p-6 space-y-4 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-400 mx-auto" />
            <p className="text-gray-300 text-sm">Senha redefinida com sucesso! Redirecionando para o login...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="card p-6 space-y-4">
            <div className="relative">
              <Input
                label="Nova senha"
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoFocus
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-3 top-7 text-gray-500 hover:text-gray-300"
              >
                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <Input
              label="Confirmar nova senha"
              type={showPwd ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
            <Button type="submit" loading={loading} className="w-full mt-2">
              Redefinir senha
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
