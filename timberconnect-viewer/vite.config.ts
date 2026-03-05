import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/timberconnect/',
  server: {
    proxy: {
      // Proxy API requests to the RML converter backend during development
      '/api/converter': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
    },
  },
})
