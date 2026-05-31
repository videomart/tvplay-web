import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { execSync } from 'child_process'

function gitHash(): string {
  // Docker builds passam o hash via VITE_APP_BUILD (build arg no Dockerfile)
  if (process.env.VITE_APP_BUILD) return process.env.VITE_APP_BUILD
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['pipe', 'pipe', 'ignore'] })
      .toString().trim()
  } catch {
    return 'dev'
  }
}

const APP_BUILD   = gitHash()
const BUILD_TIME  = new Date().toLocaleString('pt-BR', {
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
})

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  define: {
    __APP_BUILD__:  JSON.stringify(APP_BUILD),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
})
