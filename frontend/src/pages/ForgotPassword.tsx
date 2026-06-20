import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Radio, ArrowLeft, MailCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { authApi } from '../api/auth.api'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email) return
    setLoading(true)
    try {
      await authApi.forgotPassword(email)
      setSent(true)
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Erro ao solicitar redefinição de senha')
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
          <p className="text-gray-500 text-sm mt-1">Recuperação de senha</p>
        </div>

        {sent ? (
          <div className="card p-6 space-y-4 text-center">
            <MailCheck className="h-10 w-10 text-emerald-400 mx-auto" />
            <p className="text-gray-300 text-sm">
              Se o email <strong>{email}</strong> estiver cadastrado, você receberá um link para
              redefinir sua senha. Verifique também a caixa de spam.
            </p>
            <Link to="/login" className="inline-flex items-center gap-1.5 text-sm text-brand-400 hover:text-brand-300">
              <ArrowLeft className="h-3.5 w-3.5" />Voltar ao login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="card p-6 space-y-4">
            <p className="text-gray-400 text-sm">
              Informe o email cadastrado na sua conta para receber um link de redefinição de senha.
            </p>
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              autoFocus
              autoComplete="email"
            />
            <Button type="submit" loading={loading} className="w-full mt-2">
              Enviar link de redefinição
            </Button>
            <Link to="/login" className="flex items-center justify-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 mt-2">
              <ArrowLeft className="h-3.5 w-3.5" />Voltar ao login
            </Link>
          </form>
        )}
      </div>
    </div>
  )
}
