import { clsx } from 'clsx'
import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: React.ReactNode
}

const variants = {
  primary: 'bg-brand-600 hover:bg-brand-700 text-white',
  secondary: 'bg-gray-800 hover:bg-gray-700 text-gray-100 border border-gray-700',
  ghost: 'hover:bg-white/5 text-gray-400 hover:text-white',
  danger: 'bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/30',
}

const sizes = {
  sm: 'px-2.5 py-1.5 text-xs gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
  lg: 'px-5 py-2.5 text-base gap-2',
}

export function Button({ variant = 'primary', size = 'md', loading, icon, children, className, disabled, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/50 disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {children}
    </button>
  )
}
