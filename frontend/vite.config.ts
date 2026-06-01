import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { readFileSync } from 'fs'

// Versão e data vêm do arquivo buildInfo.ts (commitado no git)
// Atualizado pelo agente a cada commit — não depende de quando o Docker faz o build
const buildInfoSrc = readFileSync('./src/buildInfo.ts', 'utf-8')
const versionMatch = buildInfoSrc.match(/BUILD_VERSION\s*=\s*'([^']+)'/)
const dateMatch    = buildInfoSrc.match(/BUILD_DATE\s*=\s*'([^']+)'/)
const APP_VERSION  = versionMatch?.[1] ?? '0.0.0'
const BUILD_TIME   = dateMatch?.[1]    ?? '—'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  define: {
    __APP_BUILD__:  JSON.stringify(APP_VERSION),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
})
