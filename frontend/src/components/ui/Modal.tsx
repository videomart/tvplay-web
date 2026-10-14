import { X } from 'lucide-react'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | '2xl' | 'xl'
  // false = sem overlay escurecendo o fundo (clique fora ainda fecha) — usado
  // quando o conteúdo atrás do modal precisa continuar visível/monitorável
  dim?: boolean
  // Sobrescreve o fundo do painel (por padrão usa a classe .card) — ex.: 'bg-blue-950'
  panelClassName?: string
}

const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', '2xl': 'max-w-3xl', xl: 'max-w-5xl' }

export function Modal({ open, onClose, title, children, size = 'md', dim = true, panelClassName }: ModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (open) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  // Portal pro <body>: um modal renderizado dentro de um ancestral com opacity<1
  // (ex.: linha de playlist já exibida, com opacity-60) fica esmaecido junto —
  // position:fixed escapa do LAYOUT do ancestral, mas não do seu compositing de
  // opacidade/transform. O portal tira o modal dessa árvore inteiramente.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className={clsx('absolute inset-0', dim && 'bg-black/60 backdrop-blur-sm')} onClick={onClose} />
      <div className={clsx(
        'relative w-full shadow-2xl flex flex-col',
        panelClassName ? panelClassName : 'card',
        'max-h-[90vh]',   // nunca ultrapassa 90% da altura da tela
        sizes[size],
      )}>
        {/* Header fixo */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-800 flex-shrink-0">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>
        {/* Conteúdo rolável */}
        <div className="overflow-y-auto flex-1 px-6 py-5">
          {children}
        </div>
      </div>
    </div>,
    document.body
  )
}
