import { clsx } from 'clsx'
import type { InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  icon?: React.ReactNode
}

export function Input({ label, error, icon, className, id, ...props }: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="text-xs font-medium text-gray-400 uppercase tracking-wide">
          {label}
        </label>
      )}
      <div className="relative">
        {icon && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">{icon}</span>}
        <input
          id={inputId}
          {...props}
          className={clsx(
            'w-full rounded-lg bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500',
            'focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30',
            'transition-colors text-sm',
            icon ? 'pl-9 pr-3 py-2' : 'px-3 py-2',
            error && 'border-red-500 focus:border-red-500',
            className,
          )}
        />
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
}

export function Select({ label, error, children, className, id, ...props }: SelectProps) {
  const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={selectId} className="text-xs font-medium text-gray-400 uppercase tracking-wide">
          {label}
        </label>
      )}
      <select
        id={selectId}
        {...props}
        className={clsx(
          'w-full rounded-lg bg-gray-800 border border-gray-700 text-gray-100',
          'focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30',
          'transition-colors text-sm px-3 py-2',
          error && 'border-red-500',
          className,
        )}
      >
        {children}
      </select>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
