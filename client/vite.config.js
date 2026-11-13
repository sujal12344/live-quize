import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
        onError: (err, _req, _res) => {
          // Silence transient startup ECONNREFUSED while backend establishes connection
          if (err.code !== 'ECONNREFUSED') console.error('Proxy error:', err);
        },
      },
      '/api': {
        target: 'http://localhost:3000',
      },
      '/health': {
        target: 'http://localhost:3000',
      },
    },
  },
})
