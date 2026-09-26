import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // in sviluppo le API sono servite dal backend locale
    proxy: { '/api': 'http://localhost:3000' },
    fs: { allow: ['..'] },
  },
})
