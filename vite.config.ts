/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Em desenvolvimento, a API do Supabase local fica acessível pelo mesmo endereço do site
  // (http://localhost:5173/supabase → http://127.0.0.1:54321). Evita CORS e bloqueios de
  // navegadores a outra porta. Em produção não é usado (VITE_SUPABASE_URL aponta para o Supabase).
  server: {
    proxy: {
      '/supabase': {
        target: process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321',
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/supabase/, ''),
      },
    },
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'supabase/functions/**/*.test.ts'],
  },
})
