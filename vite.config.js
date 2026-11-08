import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Para GitHub Pages em um repositório chamado 'soeletricos'.
// Se o nome do repositório for diferente, troque '/soeletricos/' pelo nome correto.
// Na Vercel, a base permanece '/' automaticamente.
export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_ACTIONS ? '/soeletricos/' : '/'
})
